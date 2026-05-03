import express, { type Express } from 'express'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { BackendClient } from '../device/backend.js'
import type { DeviceIdentity } from '../device/identity.js'
import { getNetworkInfo } from '../device/network.js'
import type { DevicePresenceTracker } from '../device/presence.js'
import { getGameDefinition, listGameDefinitions } from '../games/catalog.js'
import type { GameLauncher } from '../runtime/launcher.js'
import type { ProcessSupervisor } from '../runtime/processSupervisor.js'
import type { RuntimeStateStore } from '../state/runtimeState.js'
import type { BalanceStore } from '../state/balanceStore.js'
import type { ServiceConfig } from '../types.js'
import type { SessionManager } from '../session/sessionManager.js'
import { buildOverlayState } from '../ui/overlayState.js'
import type { LocalWebSocketHub } from './ws.js'

export interface HttpApiDependencies {
  config: ServiceConfig
  identity: DeviceIdentity
  backendClient: BackendClient
  balanceStore: BalanceStore
  sessionManager: SessionManager
  runtimeStateStore: RuntimeStateStore
  presenceTracker: DevicePresenceTracker
  processSupervisor: ProcessSupervisor
  launcher: GameLauncher
  eventHub: LocalWebSocketHub
}

export function createHttpApi(deps: HttpApiDependencies): Express {
  const app = express()
  let retroarchProcess: ChildProcessWithoutNullStreams | null = null

  app.use(express.json())
  app.use((_: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    next()
  })

  app.get('/health', (_: any, res: any) => {
    res.json({
      ok: true,
      authority: 'input-service',
      origin: deps.config.localApiOrigin,
    })
  })

  app.get('/device-id', (_: any, res: any) => {
    res.json({
      deviceId: deps.identity.deviceId,
      isPi: deps.identity.isPi,
      compatMode: deps.identity.compatMode,
      devInputBypass: deps.identity.devInputBypassEnabled,
      platform: deps.identity.platform,
    })
  })

  app.get('/runtime/auth-context', (_: any, res: any) => {
    res.json(deps.backendClient.getRuntimeAuthContext())
  })

  app.get('/device-state', async (_: any, res: any) => {
    deps.presenceTracker.touchSeen()
    const backendState = await deps.backendClient.getDeviceState()
    const overlay = buildOverlayState(deps.sessionManager.getSnapshot(), deps.balanceStore.get())

    res.json({
      ...backendState,
      overlay,
      retroarchActive: deps.runtimeStateStore.getFlags().retroarchActive,
      activePid: deps.processSupervisor.getActivePid(),
    })
  })

  app.get('/cabinet-games', async (req: any, res: any) => {
    const requestedDeviceId = String(req.query?.deviceId || deps.identity.deviceId || '').trim() || undefined
    res.json({
      success: true,
      deviceId: requestedDeviceId ?? deps.identity.deviceId,
      games: await deps.backendClient.listCabinetGames(requestedDeviceId),
    })
  })

  app.get('/network-info', (_: any, res: any) => {
    res.json(getNetworkInfo(deps.identity.isPi))
  })

  app.get('/withdraw-limits', async (_: any, res: any) => {
    res.json(await deps.backendClient.getWithdrawLimits())
  })

  app.post('/device-register', async (req: any, res: any) => {
    const requestedDeviceId = String(req.body?.deviceId || deps.identity.deviceId || '').trim() || undefined
    const result = await deps.backendClient.ensureDeviceRegistered(requestedDeviceId)
    res.json(result)
  })

  app.post('/dev-input', (req: any, res: any) => {
    if (!deps.identity.devInputBypassEnabled) {
      res.status(403).json({ success: false, error: 'DEV_INPUT_DISABLED' })
      return
    }

    const payload = req.body
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).json({ success: false, error: 'INVALID_PAYLOAD' })
      return
    }

    deps.eventHub.broadcast({ type: 'DEV_INPUT', payload })
    res.json({ success: true, forwarded: true })
  })

  app.get('/events', (req: any, res: any) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('\n')

    const unsubscribe = deps.eventHub.subscribe(message => {
      res.write(`data: ${JSON.stringify(message)}\n\n`)
    })

    req.on('close', () => {
      unsubscribe()
    })
  })

  app.post('/launch/:game', (req: any, res: any) => {
    const game = getGameDefinition(req.params.game)
    if (!game) {
      res.status(404).json({ ok: false, error: 'unknown_game' })
      return
    }

    if (!deps.sessionManager.startLaunch(game)) {
      res.status(409).json({ ok: false, error: 'session_busy' })
      return
    }

    retroarchProcess = deps.launcher.launch(game)
    if (retroarchProcess) {
      deps.runtimeStateStore.setRetroarchActive(true)
      deps.processSupervisor.register({
        pid: retroarchProcess.pid,
        stop(signal = 'SIGTERM') {
          retroarchProcess?.kill(signal)
        },
      })
      deps.eventHub.broadcast({ type: 'GAME_LAUNCHED', payload: { gameId: game.id } })
    }
    retroarchProcess?.on('exit', () => {
      console.log('[PROCESS] RetroArch exited')
      retroarchProcess = null
      deps.runtimeStateStore.setRetroarchActive(false)
      deps.processSupervisor.clear()
      deps.sessionManager.endSession()
      deps.eventHub.broadcast({ type: 'GAME_EXITED', payload: { gameId: game.id } })
    })

    res.json({ ok: true, game })
  })

  app.post('/session/start', (_: any, res: any) => {
    if (!deps.sessionManager.startGame()) {
      res.status(402).json({ ok: false, error: 'insufficient_balance_or_invalid_state' })
      return
    }

    deps.presenceTracker.touchActivity()
    deps.eventHub.broadcast({ type: 'SESSION_STARTED', payload: deps.sessionManager.getSnapshot() })
    res.json({ ok: true })
  })

  app.post('/session/end', (_: any, res: any) => {
    if (retroarchProcess) {
      retroarchProcess.kill('SIGTERM')
      retroarchProcess = null
    }

    deps.runtimeStateStore.setRetroarchActive(false)
    deps.processSupervisor.clear()
    deps.sessionManager.endSession()
    deps.eventHub.broadcast({ type: 'SESSION_ENDED', payload: null })
    res.json({ ok: true })
  })

  app.post('/session/heartbeat', (_: any, res: any) => {
    deps.sessionManager.notifyInput()
    deps.presenceTracker.touchActivity()
    res.json({ ok: true })
  })

  app.post('/coin', (req: any, res: any) => {
    const amount = Number(req.body?.amount ?? 10)
    deps.balanceStore.add(Number.isFinite(amount) ? amount : 10)
    deps.presenceTracker.touchActivity()
    deps.eventHub.broadcast({ type: 'BALANCE_CHANGED', payload: { balance: deps.balanceStore.get() } })
    res.json({ ok: true, balance: deps.balanceStore.get() })
  })

  app.get('/overlay', (_: any, res: any) => {
    res.json(buildOverlayState(deps.sessionManager.getSnapshot(), deps.balanceStore.get()))
  })

  app.post('/withdraw', (_: any, res: any) => {
    res.status(501).json({
      ok: false,
      error: 'not_implemented',
      note: 'Withdraw flow still lives in input.js during migration.',
    })
  })

  app.get('/games', (_: any, res: any) => {
    res.json({
      games: listGameDefinitions(),
    })
  })

  return app
}
