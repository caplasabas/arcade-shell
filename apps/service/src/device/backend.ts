import { execFile } from 'node:child_process'

import { listGameDefinitions } from '../games/catalog.js'
import type { GameLauncher } from '../runtime/launcher.js'
import type { DeviceStateSnapshot, RuntimeAuthContext, WithdrawLimits } from '../types.js'
import type { DeviceIdentity } from './identity.js'
import type { DevicePresenceTracker } from './presence.js'
import type { BalanceStore } from '../state/balanceStore.js'
import type { ProcessSupervisor } from '../runtime/processSupervisor.js'
import type { ServiceConfig } from '../types.js'

export interface BackendClient {
  getRuntimeAuthContext(): RuntimeAuthContext
  ensureDeviceRegistered(deviceId?: string): Promise<{ success: boolean; deviceId: string | null }>
  getDeviceState(): Promise<DeviceStateSnapshot>
  getWithdrawLimits(): Promise<WithdrawLimits>
  listCabinetGames(deviceId?: string): Promise<ReturnType<typeof listGameDefinitions>>
}

export interface BackendClientDependencies {
  config: ServiceConfig
  identity: DeviceIdentity
  presenceTracker: DevicePresenceTracker
  balanceStore: BalanceStore
  processSupervisor: ProcessSupervisor
  launcher: GameLauncher
}

export function createBackendClient(deps: BackendClientDependencies): BackendClient {
  const hasSupabaseRpcConfig = () =>
    Boolean(deps.config.supabaseUrl && deps.config.supabaseServiceKey)

  const getSupabaseHeaders = () => ({
    apikey: deps.config.supabaseServiceKey,
    Authorization: `Bearer ${deps.config.supabaseServiceKey}`,
    'Content-Type': 'application/json',
  })

  const execFileAsync = (file: string, args: string[], options: Record<string, unknown> = {}) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        file,
        args,
        {
          maxBuffer: 1024 * 1024,
          ...options,
        },
        (error, stdout, stderr) => {
          if (error) {
            ;(error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout = stdout
            ;(error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr = stderr
            reject(error)
            return
          }
          resolve({ stdout, stderr })
        },
      )
    })

  const requestJsonWithCurl = async (
    url: string,
    {
      method = 'GET',
      body = null,
      headers = {},
      timeoutMs = 2500,
    }: {
      method?: string
      body?: unknown
      headers?: Record<string, string>
      timeoutMs?: number
    } = {},
  ) => {
    const args = [
      '-sS',
      '-L',
      '--max-time',
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '--write-out',
      '\n%{http_code}',
    ]

    if (method && method !== 'GET') {
      args.push('-X', method)
    }

    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`)
    }

    if (body !== null && body !== undefined) {
      args.push('--data-binary', typeof body === 'string' ? body : JSON.stringify(body))
    }

    args.push(url)

    const { stdout } = await execFileAsync('curl', args)
    const text = String(stdout || '')
    const splitIndex = text.lastIndexOf('\n')
    const responseText = splitIndex >= 0 ? text.slice(0, splitIndex) : text
    const statusRaw = splitIndex >= 0 ? text.slice(splitIndex + 1).trim() : ''
    const status = Number.parseInt(statusRaw, 10)

    if (!Number.isFinite(status)) {
      throw new Error(`curl response missing status for ${url}`)
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      text: responseText,
      json() {
        return responseText ? JSON.parse(responseText) : null
      },
    }
  }

  const toMoney = (value: unknown, fallback = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.round(parsed * 100) / 100)
  }

  const formatPeso = (
    amount: unknown,
    withSymbol = false,
    withDecimal = true,
    decimalCount = 2,
    abbreviate = false,
  ) => {
    const num = Number(amount)
    if (Number.isNaN(num)) return withSymbol ? '$0' : '0'

    const sign = num < 0 ? '-' : ''
    const abs = Math.abs(num)

    let value: string
    if (abbreviate) {
      if (abs >= 1_000_000_000) value = `${Math.floor((abs / 1_000_000_000) * 100) / 100}`.replace(/\.00$/, '') + 'B'
      else if (abs >= 1_000_000) value = `${Math.floor((abs / 1_000_000) * 100) / 100}`.replace(/\.00$/, '') + 'M'
      else if (abs >= 10_000) value = `${Math.floor((abs / 1_000) * 100) / 100}`.replace(/\.00$/, '') + 'K'
      else value = abs.toLocaleString()
    } else {
      value = abs.toFixed(withDecimal ? decimalCount : 2).replace(/\d(?=(\d{3})+\.)/g, '$&,')
      if (withDecimal && decimalCount > 2 && value.endsWith('.00')) {
        value = value.slice(0, -3)
      }
    }

    return `${sign}${withSymbol ? '$' : ''}${value}`
  }

  const normalizeArcadeJoinMode = (value: unknown) => {
    const mode = String(value || 'simultaneous')
      .toLowerCase()
      .trim()
    if (mode === 'alternating' || mode === 'single_only') return mode
    return 'simultaneous'
  }

  const safeRpcCall = async <T>(fn: (payload: T) => Promise<any>, payload: T) => {
    const res = await fn(payload)
    if (!res || res.ok === false) {
      throw new Error(`RPC failed (${res?.status ?? 'unknown'})`)
    }
    return res
  }

  return {
    getRuntimeAuthContext() {
      return {
        deviceId: deps.identity.deviceId,
        runtimeMode: deps.identity.runtimeMode,
        backendAuthority: 'input-service',
      }
    },
    async ensureDeviceRegistered(deviceId) {
      const resolvedDeviceId = deviceId ?? deps.identity.deviceId ?? null
      if (!resolvedDeviceId) {
        return {
          success: false,
          deviceId: null,
        }
      }

      const reads = createDeviceBackendReads({
        logger: console,
        deviceId: deps.identity.deviceId,
        supabaseUrl: deps.config.supabaseUrl,
        hasSupabaseRpcConfig,
        getSupabaseHeaders,
        requestJsonWithCurl,
        toMoney,
        normalizeArcadeJoinMode,
        resolveCorePath: (coreValue: string | null) => ({
          path: deps.launcher.resolveCorePath(coreValue || undefined),
        }),
        resolveRomPath: (romValue: string | null) => deps.launcher.resolveRomPath(romValue || undefined),
        arcadeLifePriceDefault: deps.config.arcadeLifePriceDefault,
      })

      await reads.ensureDeviceRegistered(resolvedDeviceId)
      return {
        success: true,
        deviceId: resolvedDeviceId,
      }
    },
    async getDeviceState() {
      const reads = createDeviceBackendReads({
        logger: console,
        deviceId: deps.identity.deviceId,
        supabaseUrl: deps.config.supabaseUrl,
        hasSupabaseRpcConfig,
        getSupabaseHeaders,
        requestJsonWithCurl,
        toMoney,
        normalizeArcadeJoinMode,
        resolveCorePath: (coreValue: string | null) => ({
          path: deps.launcher.resolveCorePath(coreValue || undefined),
        }),
        resolveRomPath: (romValue: string | null) => deps.launcher.resolveRomPath(romValue || undefined),
        arcadeLifePriceDefault: deps.config.arcadeLifePriceDefault,
      })
      const presence = deps.presenceTracker.getSnapshot()
      let state = null
      try {
        if (deps.identity.deviceId) {
          state = await reads.fetchDeviceFinancialState(deps.identity.deviceId)
        }
      } catch (error) {
        console.error('[DEVICE] state fetch failed', error)
      }

      if (state) {
        deps.balanceStore.set(state.balance)
      }

      return {
        deviceId: deps.identity.deviceId,
        runtimeMode: deps.identity.runtimeMode,
        backendAuthority: 'input-service',
        connected: Boolean(state),
        lastSeenAt: presence.lastSeenAt,
        lastActivityAt: presence.lastActivityAt,
        balance: state?.balance ?? deps.balanceStore.get(),
        hopperBalance: state?.hopperBalance ?? 0,
        arcadeCredit: state?.arcadeCredit ?? 0,
        arcadeTimeMs: state?.arcadeTimeMs ?? 0,
        withdrawEnabled: state?.withdrawEnabled ?? false,
        processActive: deps.processSupervisor.hasActiveProcess(),
      }
    },
    async getWithdrawLimits() {
      const reads = createDeviceBackendReads({
        logger: console,
        deviceId: deps.identity.deviceId,
        supabaseUrl: deps.config.supabaseUrl,
        hasSupabaseRpcConfig,
        getSupabaseHeaders,
        requestJsonWithCurl,
        toMoney,
        normalizeArcadeJoinMode,
        resolveCorePath: (coreValue: string | null) => ({
          path: deps.launcher.resolveCorePath(coreValue || undefined),
        }),
        resolveRomPath: (romValue: string | null) => deps.launcher.resolveRomPath(romValue || undefined),
        arcadeLifePriceDefault: deps.config.arcadeLifePriceDefault,
      })
      const writes = createDeviceBackendWrites({
        logger: console,
        deviceId: deps.identity.deviceId,
        isPi: deps.identity.isPi,
        supabaseUrl: deps.config.supabaseUrl,
        hasSupabaseRpcConfig,
        getSupabaseHeaders,
        requestJsonWithCurl,
        safeRpcCall,
        toMoney,
        formatPeso,
        fetchDeviceFinancialState: reads.fetchDeviceFinancialState,
        getHopperActive: () => false,
        getActiveWithdrawalContext: () => null,
      })

      try {
        const state =
          deps.identity.isPi && hasSupabaseRpcConfig() && deps.identity.deviceId
            ? await reads.fetchDeviceFinancialState(deps.identity.deviceId)
            : null
        const balance = toMoney(state?.balance, deps.balanceStore.get())
        const hopperBalance = toMoney(state?.hopperBalance, 0)
        const withdrawEnabled = Boolean(state?.withdrawEnabled)
        const configuredMax = state
          ? writes.getMaxWithdrawalAmountForHopperBalance(hopperBalance)
          : null
        const maxWithdrawalAmount =
          !withdrawEnabled || configuredMax === null
            ? null
            : Math.max(0, Math.min(balance, hopperBalance, configuredMax))

        return {
          success: true,
          enabled: Boolean(deps.identity.isPi && hasSupabaseRpcConfig() && withdrawEnabled),
          balance,
          hopperBalance,
          configuredMax,
          maxWithdrawalAmount,
        }
      } catch (error) {
        console.error('[WITHDRAW] limits fetch failed', error)
        return {
          success: false,
          enabled: false,
          balance: deps.balanceStore.get(),
          hopperBalance: 0,
          configuredMax: null,
          maxWithdrawalAmount: null,
        }
      }
    },
    async listCabinetGames(deviceId) {
      const reads = createDeviceBackendReads({
        logger: console,
        deviceId: deps.identity.deviceId,
        supabaseUrl: deps.config.supabaseUrl,
        hasSupabaseRpcConfig,
        getSupabaseHeaders,
        requestJsonWithCurl,
        toMoney,
        normalizeArcadeJoinMode,
        resolveCorePath: (coreValue: string | null) => ({
          path: deps.launcher.resolveCorePath(coreValue || undefined),
        }),
        resolveRomPath: (romValue: string | null) => deps.launcher.resolveRomPath(romValue || undefined),
        arcadeLifePriceDefault: deps.config.arcadeLifePriceDefault,
      })
      const resolvedDeviceId = deviceId ?? deps.identity.deviceId ?? undefined
      if (!resolvedDeviceId) return listGameDefinitions()
      return reads.fetchCabinetGamesForDevice(resolvedDeviceId)
    },
  }
}

export function createDeviceBackendReads(options: any) {
  const {
    logger = console,
    deviceId,
    supabaseUrl,
    hasSupabaseRpcConfig,
    getSupabaseHeaders,
    requestJsonWithCurl,
    ensureLocalDeviceRegistered,
    toMoney,
    normalizeArcadeJoinMode,
    resolveCorePath,
    resolveRomPath,
    arcadeLifePriceDefault,
  } = options

  async function ensureDeviceRegistered(targetDeviceId: any = deviceId) {
    if (!hasSupabaseRpcConfig()) return

    const safeDeviceId = String(targetDeviceId || '').trim()
    if (!safeDeviceId) return

    const url = `${supabaseUrl}/rest/v1/devices`
    const res = await requestJsonWithCurl(url, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(),
        Prefer: 'resolution=merge-duplicates',
      },
      body: {
        device_id: safeDeviceId,
      },
      timeoutMs: 2500,
    })

    if (!res.ok) {
      throw new Error(`device register failed (${res.status})`)
    }

    if (typeof ensureLocalDeviceRegistered === 'function') {
      await ensureLocalDeviceRegistered(safeDeviceId)
    }

    logger.log('[DEVICE] ensured registered', safeDeviceId)
  }

  async function fetchDeviceFinancialState(targetDeviceId: any = deviceId) {
    if (!hasSupabaseRpcConfig()) return null

    const safeDeviceId = String(targetDeviceId || '').trim()
    if (!safeDeviceId) return null

    const buildDeviceStateUrl = (includeWithdrawEnabled: boolean) =>
      `${supabaseUrl}/rest/v1/devices?select=${encodeURIComponent(
        [
          'device_id',
          'deployment_mode',
          'balance',
          'hopper_balance',
          'arcade_credit',
          'arcade_time_ms',
          includeWithdrawEnabled ? 'withdraw_enabled' : null,
        ]
          .filter(Boolean)
          .join(','),
      )}&device_id=eq.${encodeURIComponent(safeDeviceId)}&limit=1`

    const requestState = async (includeWithdrawEnabled: boolean): Promise<any> => {
      const response = await requestJsonWithCurl(buildDeviceStateUrl(includeWithdrawEnabled), {
        method: 'GET',
        headers: getSupabaseHeaders(),
        timeoutMs: 2500,
      })

      if (
        includeWithdrawEnabled &&
        !response.ok &&
        response.status === 400 &&
        String(response.text || '').toLowerCase().includes('withdraw_enabled')
      ) {
        return requestState(false)
      }

      return response
    }

    const response = await requestState(true)
    if (!response.ok) {
      logger.error('[DEVICE] state fetch failed', {
        deviceId: safeDeviceId,
        status: response.status,
        body: response.text,
      })
      throw new Error(`device state fetch failed (${response.status})`)
    }

    const rows = response.json()
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) {
      logger.warn('[DEVICE] not found, attempting auto-register')

      try {
        await ensureDeviceRegistered(targetDeviceId)
      } catch (err) {
        logger.error('[DEVICE] auto-register failed', err)
        throw new Error('DEVICE_NOT_FOUND')
      }

      const retry = await requestState(true)
      if (!retry.ok) {
        logger.error('[DEVICE] state fetch retry failed', {
          deviceId: safeDeviceId,
          status: retry.status,
          body: retry.text,
        })
        throw new Error(`device state fetch failed (${retry.status})`)
      }

      const retryRows = retry.json()
      const retryRow = Array.isArray(retryRows) ? retryRows[0] : null
      if (!retryRow) {
        throw new Error('DEVICE_NOT_FOUND_AFTER_REGISTER')
      }

      return {
        deviceId: String(retryRow.device_id || safeDeviceId),
        deploymentMode:
          retryRow.deployment_mode === null || retryRow.deployment_mode === undefined
            ? null
            : String(retryRow.deployment_mode || '').trim() || null,
        balance: toMoney(retryRow.balance, 0),
        hopperBalance: toMoney(retryRow.hopper_balance, 0),
        arcadeCredit: Number(retryRow.arcade_credit || 0),
        arcadeTimeMs: Math.max(0, Number(retryRow.arcade_time_ms || 0)),
        withdrawEnabled: Boolean(retryRow.withdraw_enabled),
      }
    }

    return {
      deviceId: String(row.device_id || safeDeviceId),
      deploymentMode:
        row.deployment_mode === null || row.deployment_mode === undefined
          ? null
          : String(row.deployment_mode || '').trim() || null,
      balance: toMoney(row.balance, 0),
      hopperBalance: toMoney(row.hopper_balance, 0),
      arcadeCredit: Number(row.arcade_credit || 0),
      arcadeTimeMs: Math.max(0, Number(row.arcade_time_ms || 0)),
      withdrawEnabled: Boolean(row.withdraw_enabled),
    }
  }

  async function fetchCabinetGamesForDevice(targetDeviceId: any = deviceId) {
    if (!hasSupabaseRpcConfig()) return []

    const safeDeviceId = String(targetDeviceId || '').trim()
    if (!safeDeviceId) return []

    const url =
      `${supabaseUrl}/rest/v1/cabinet_games?` +
      `select=device_id,game_id,games!inner(` +
      `id,name,type,price,join_mode,box_art_url,emulator_core,rom_path,package_url,version,enabled` +
      `)&device_id=eq.${encodeURIComponent(safeDeviceId)}&installed=eq.true`

    try {
      const response = await requestJsonWithCurl(url, {
        method: 'GET',
        headers: getSupabaseHeaders(),
        timeoutMs: 2500,
      })
      if (!response.ok) {
        const text = response.text || ''
        logger.error('[CABINET GAMES] fetch failed', response.status, text)
        return []
      }

      const rows = response.json()
      if (!Array.isArray(rows)) return []

      return rows
        .map(row => row?.games)
        .filter(Boolean)
        .map(game => {
          const core = resolveCorePath(game.emulator_core || null)
          const romPath = game.type === 'arcade' ? resolveRomPath(game.rom_path || null) : null
          const launchable =
            game.type === 'casino'
              ? game.enabled !== false
              : game.enabled !== false && Boolean(core.path) && Boolean(romPath)

          let availabilityReason = null
          if (game.type === 'arcade' && game.enabled !== false) {
            if (!romPath) availabilityReason = 'missing_rom'
            else if (!core.path) availabilityReason = 'missing_core'
          }

          return {
            id: game.id,
            name: game.name,
            type: game.type,
            enabled: game.enabled !== false,
            launchable,
            availability_reason: availabilityReason,
            price: toMoney(game.price, game.type === 'arcade' ? arcadeLifePriceDefault : 0),
            join_mode: normalizeArcadeJoinMode(game.join_mode),
            art: String(game.box_art_url || '').startsWith('assets/boxart/')
              ? `/roms/boxart/${String(game.box_art_url).slice('assets/boxart/'.length)}`
              : String(game.box_art_url || ''),
            emulator_core: game.emulator_core || null,
            rom_path: game.rom_path || null,
            package_url: game.package_url || null,
            version: Number(game.version || 1),
          }
        })
        .filter(game => game.type !== 'casino' || game.enabled !== false)
        .sort((a, b) => {
          const enabledDelta = Number(b.enabled !== false) - Number(a.enabled !== false)
          if (enabledDelta !== 0) return enabledDelta
          const launchableDelta = Number(b.launchable !== false) - Number(a.launchable !== false)
          if (launchableDelta !== 0) return launchableDelta
          return String(a.name || '').localeCompare(String(b.name || ''))
        })
    } catch (err: any) {
      logger.error('[CABINET GAMES] fetch error', err?.message || err)
      return []
    }
  }

  return {
    ensureDeviceRegistered,
    fetchDeviceFinancialState,
    fetchCabinetGamesForDevice,
  }
}

export function createDeviceBackendWrites(options: any) {
  const {
    logger = console,
    deviceId,
    isPi,
    supabaseUrl,
    hasSupabaseRpcConfig,
    getSupabaseHeaders,
    requestJsonWithCurl,
    safeRpcCall,
    toMoney,
    formatPeso,
    fetchDeviceFinancialState,
    getHopperActive,
    getActiveWithdrawalContext,
  } = options

  function getMaxWithdrawalAmountForHopperBalance(hopperBalance: any) {
    const safeHopperBalance = toMoney(hopperBalance, 0)
    const STEP = 20
    if (safeHopperBalance <= 0) return 0
    return Math.floor((safeHopperBalance * 0.3) / STEP) * STEP
  }

  async function recordWithdrawalDispense(amount: any) {
    const dispenseAmount = toMoney(amount, 0)
    if (dispenseAmount <= 0 || !hasSupabaseRpcConfig()) return

    const context = getActiveWithdrawalContext()
    const requestId = context?.requestId || `withdraw-${Date.now()}`
    const requestedAmount = toMoney(context?.requestedAmount, dispenseAmount)
    const nextDispensedTotal = toMoney((context?.dispensedTotal || 0) + dispenseAmount, dispenseAmount)
    if (context) {
      context.dispensedTotal = nextDispensedTotal
    }
    const eventTs = new Date().toISOString()
    const metadata = {
      source: 'hopper',
      request_id: requestId,
      requested_amount: requestedAmount,
      dispensed_total: nextDispensedTotal,
    }

    try {
      await safeRpcCall(
        (body: any) =>
          requestJsonWithCurl(`${supabaseUrl}/rest/v1/rpc/apply_metric_event`, {
            method: 'POST',
            headers: getSupabaseHeaders(),
            timeoutMs: 3500,
            body,
          }),
        {
          p_device_id: deviceId,
          p_event_type: 'withdrawal',
          p_amount: dispenseAmount,
          p_event_ts: eventTs,
          p_metadata: metadata,
          p_write_ledger: true,
        },
      )
    } catch (error: any) {
      logger.error('[WITHDRAW] dispense accounting failed', {
        amount: dispenseAmount,
        requestId,
        error: error?.message || error,
      })
    }
  }

  async function recordHopperTopup(amount: any) {
    const topupAmount = toMoney(amount, 0)
    if (topupAmount <= 0 || !hasSupabaseRpcConfig()) return

    const eventTs = new Date().toISOString()
    const metadata = {
      source: 'hopper_topup_slot',
    }

    try {
      await safeRpcCall(
        (body: any) =>
          requestJsonWithCurl(`${supabaseUrl}/rest/v1/rpc/apply_metric_event`, {
            method: 'POST',
            headers: getSupabaseHeaders(),
            timeoutMs: 3500,
            body,
          }),
        {
          p_device_id: deviceId,
          p_event_type: 'hopper_in',
          p_amount: topupAmount,
          p_event_ts: eventTs,
          p_metadata: metadata,
          p_write_ledger: true,
        },
      )
    } catch (error: any) {
      logger.error('[HOPPER] topup accounting failed', {
        amount: topupAmount,
        error: error?.message || error,
      })
    }
  }

  async function recordCoinDeposit(amount: any) {
    const depositAmount = toMoney(amount, 0)
    if (depositAmount <= 0 || !hasSupabaseRpcConfig()) return

    const eventTs = new Date().toISOString()
    const metadata = {
      source: 'coin_acceptor',
    }

    try {
      await safeRpcCall(
        (body: any) =>
          requestJsonWithCurl(`${supabaseUrl}/rest/v1/rpc/apply_metric_event`, {
            method: 'POST',
            headers: getSupabaseHeaders(),
            timeoutMs: 3500,
            body,
          }),
        {
          p_device_id: deviceId,
          p_event_type: 'coins_in',
          p_amount: depositAmount,
          p_event_ts: eventTs,
          p_metadata: metadata,
          p_write_ledger: true,
        },
      )
    } catch (error: any) {
      logger.error('[COIN] deposit accounting failed', {
        amount: depositAmount,
        error: error?.message || error,
      })
    }
  }

  async function validateWithdrawRequest(amount: any) {
    const requestedAmount = toMoney(amount, 0)
    if (requestedAmount <= 0) {
      return { ok: false, status: 400, error: 'Invalid withdraw amount' }
    }

    if (getHopperActive()) {
      return { ok: false, status: 409, error: 'Withdrawal already in progress' }
    }

    if (!isPi || !hasSupabaseRpcConfig()) {
      return { ok: true, amount: requestedAmount }
    }

    const state = await fetchDeviceFinancialState(deviceId)
    const deploymentMode = String(state?.deploymentMode || 'online')
      .trim()
      .toLowerCase()
    const balance = toMoney(state?.balance, 0)
    const hopperBalance = toMoney(state?.hopperBalance, 0)
    const withdrawEnabled = Boolean(state?.withdrawEnabled)
    const hopperCap = getMaxWithdrawalAmountForHopperBalance(hopperBalance)
    const maxWithdrawalAmount = withdrawEnabled
      ? Math.max(0, Math.min(balance, hopperBalance, hopperCap))
      : 0

    if (deploymentMode !== 'online') {
      return { ok: false, status: 409, error: 'Device is in maintenance mode' }
    }

    if (!withdrawEnabled) {
      return { ok: false, status: 403, error: 'Withdrawal disabled for this device' }
    }

    if (balance < requestedAmount) {
      return { ok: false, status: 409, error: 'Insufficient balance' }
    }

    if (hopperBalance < requestedAmount) {
      return { ok: false, status: 409, error: 'Insufficient hopper balance' }
    }

    if (requestedAmount > maxWithdrawalAmount) {
      return {
        ok: false,
        status: 409,
        error: `Max withdrawal amount is ${formatPeso(maxWithdrawalAmount)}`,
        balance,
        hopperBalance,
        maxWithdrawalAmount,
      }
    }

    return {
      ok: true,
      amount: requestedAmount,
      balance,
      hopperBalance,
      maxWithdrawalAmount,
    }
  }

  return {
    getMaxWithdrawalAmountForHopperBalance,
    recordCoinDeposit,
    recordWithdrawalDispense,
    recordHopperTopup,
    validateWithdrawRequest,
  }
}
