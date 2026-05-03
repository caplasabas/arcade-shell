import { spawn } from 'node:child_process'
import fs from 'node:fs'

export function createRetroarchLaunchRuntime(options: any) {
  const {
    logger = console,
    isPi,
    singleXMode,
    retroarchTtyXSession,
    useSplashTransitions,
    port,
    gameVT,
    splashVT,
    arcadeRuntimeDir,
    retroarchRunUser,
    retroarchRunHome,
    retroarchRuntimeDir,
    retroarchDbusAddress,
    retroarchPulseServer,
    retroarchBin,
    retroarchConfigPath,
    retroarchUseDbusRunSession,
    retroarchLogPath,
    getLastExitTime,
    getLastExitedGameId,
    setLastExitedGameId,
    retroarchPostExitLaunchCooldownMs,
    arcadeLifePriceDefault,
    hasSupabaseRpcConfig,
    fetchDeviceFinancialState,
    fetchGameProfileForArcadeLife,
    normalizeArcadeJoinMode,
    toMoney,
    getRetroarchActive,
    setRetroarchActive,
    getRetroarchStopping,
    setRetroarchStopping,
    setRetroarchCurrentGameId,
    setRetroarchStartedAt,
    clearRetroarchExitConfirm,
    stopArcadeTimeLoop,
    getArcadeSession,
    clearArcadeLifeSession,
    startArcadeLifeSession,
    dispatch,
    getActiveVT,
    getLastUiVT,
    setLastUiVT,
    switchToVT,
    resolveCorePath,
    resolveRomPath,
    prepareDisplayForLaunch,
    scheduleRetroarchReadyWatch,
    stopSplashForRetroarch,
    setRetroarchProcess,
    setRetroarchLogFd,
    finalizeRetroarchExit,
  } = options

  async function launchGame(payload: any, onRetroarchStarted: any) {
    if (typeof payload.core !== 'string' || typeof payload.rom !== 'string') {
      return { ok: false, status: 400, error: 'Missing core or rom' }
    }

    const payloadGameId = String(payload.id || '').trim()
    const payloadGameName = String(payload.name || '').trim()
    const payloadPrice = toMoney(payload.price, arcadeLifePriceDefault)
    const payloadBalance = toMoney(payload.balance, 0)
    const payloadJoinMode = normalizeArcadeJoinMode(payload.joinMode)

    const duplicateLaunchDuringRecovery =
      Boolean(payloadGameId) &&
      Boolean(getLastExitedGameId()) &&
      payloadGameId === getLastExitedGameId() &&
      Date.now() - getLastExitTime() < retroarchPostExitLaunchCooldownMs

    let gameProfile: any = {
      gameId: payloadGameId || 'unknown',
      gameName: payloadGameName || payloadGameId || 'Arcade Game',
      pricePerLife: payloadPrice > 0 ? payloadPrice : arcadeLifePriceDefault,
      joinMode: payloadJoinMode,
      initialBalance: payloadBalance,
    }

    if (getRetroarchStopping()) {
      logger.warn('[LAUNCH] Ignored — RetroArch stopping')
      return { ok: false, status: 409, error: 'Stopping' }
    }

    if (getRetroarchActive()) {
      logger.warn('[LAUNCH] Ignored — RetroArch already active')
      return { ok: false, status: 409, error: 'Already running' }
    }

    if (payloadPrice > 0 && payloadBalance < payloadPrice) {
      logger.warn('[LAUNCH] Ignored — insufficient balance', {
        gameId: payloadGameId,
        balance: payloadBalance,
        price: payloadPrice,
      })
      return { ok: false, status: 402, error: 'Insufficient balance' }
    }

    if (Date.now() - getLastExitTime() < retroarchPostExitLaunchCooldownMs) {
      if (duplicateLaunchDuringRecovery) {
        logger.log('[LAUNCH] Ignored — duplicate launch during exit recovery', {
          gameId: payloadGameId,
          cooldownMs: retroarchPostExitLaunchCooldownMs,
        })
        return { ok: false, status: 409, error: 'Duplicate launch during recovery' }
      }

      logger.log('[LAUNCH] Ignored — cooldown', {
        cooldownMs: retroarchPostExitLaunchCooldownMs,
      })
      return { ok: false, status: 409, error: 'Cooling down' }
    }

    const needsGameProfileFetch =
      payloadGameId &&
      (!payloadGameName ||
        payloadPrice <= 0 ||
        !payload.joinMode ||
        normalizeArcadeJoinMode(payload.joinMode) !== payloadJoinMode)

    if (needsGameProfileFetch) {
      const fetchedGameProfile = await fetchGameProfileForArcadeLife(payloadGameId)
      if (fetchedGameProfile) {
        gameProfile = {
          ...gameProfile,
          ...fetchedGameProfile,
          initialBalance: payloadBalance,
        }
      }
    }

    if (hasSupabaseRpcConfig()) {
      try {
        const deviceState = await fetchDeviceFinancialState()
        if (deviceState) {
          gameProfile = {
            ...gameProfile,
            initialBalance: deviceState.balance,
            initialArcadeTimeMs: deviceState.arcadeTimeMs,
          }
        }
      } catch (error: any) {
        logger.warn('[ARCADE LIFE] launch state hydrate failed', error?.message || error)
      }
    }

    if (!isPi) {
      logger.log('[LAUNCH] compat-mode simulated arcade launch')
      setRetroarchActive(true)
      setRetroarchStopping(false)
      clearRetroarchExitConfirm()
      setRetroarchStartedAt(Date.now())
      startArcadeLifeSession(gameProfile)
      setTimeout(() => {
        finalizeRetroarchExit('compat-simulated')
      }, 250)
      return { ok: true, status: 200 }
    }

    logger.log('[LAUNCH] emulator')
    setRetroarchActive(true)
    setRetroarchStopping(false)
    setRetroarchCurrentGameId(gameProfile.gameId)
    clearRetroarchExitConfirm()
    setRetroarchStartedAt(Date.now())

    const romPath = resolveRomPath(payload.rom)
    if (!romPath) {
      setRetroarchActive(false)
      stopArcadeTimeLoop()
      const arcadeSession = getArcadeSession()
      if (arcadeSession) {
        arcadeSession.arcadeSessionStartedAt = null
        arcadeSession.arcadeTimeLastDeductedAt = null
      }
      setRetroarchStopping(false)
      setRetroarchCurrentGameId(null)
      setRetroarchStartedAt(0)
      clearArcadeLifeSession('launch-rom-missing')
      logger.error('[LAUNCH] ROM not found', { rom: payload.rom })
      return { ok: false, status: 400, error: `ROM not found: ${payload.rom}` }
    }

    const core = resolveCorePath(payload.core)
    if (!core.path) {
      setRetroarchActive(false)
      stopArcadeTimeLoop()
      const arcadeSession = getArcadeSession()
      if (arcadeSession) {
        arcadeSession.arcadeSessionStartedAt = null
        arcadeSession.arcadeTimeLastDeductedAt = null
      }
      setRetroarchStopping(false)
      setRetroarchCurrentGameId(null)
      setRetroarchStartedAt(0)
      clearArcadeLifeSession('launch-core-missing')
      logger.error('[LAUNCH] Core not found', {
        core: payload.core,
        attempted: core.attempted,
      })
      return { ok: false, status: 400, error: `Core not found: ${payload.core}` }
    }

    logger.log('[LAUNCH] resolved', {
      core: core.coreName,
      corePath: core.path,
      romPath,
      gameId: gameProfile.gameId,
      pricePerLife: gameProfile.pricePerLife,
    })

    startArcadeLifeSession(gameProfile)
    setRetroarchLogFd(fs.openSync(retroarchLogPath, 'a'))
    dispatch({
      type: 'GAME_LAUNCHING',
      gameId: gameProfile.gameId,
      gameName: gameProfile.gameName,
    })

    prepareDisplayForLaunch()
    if (!singleXMode && !retroarchTtyXSession) {
      const activeVT = getActiveVT()
      if (activeVT) {
        setLastUiVT(activeVT)
        logger.log(`[VT] captured UI VT ${getLastUiVT()} before launch`)
      }
      switchToVT(gameVT, 'launch')
    }

    const command = ['-u', retroarchRunUser, 'env']
    if (singleXMode) {
      command.push('DISPLAY=:0', `XAUTHORITY=${retroarchRunHome}/.Xauthority`)
    } else if (!retroarchTtyXSession) {
      command.push('-u', 'DISPLAY', '-u', 'XAUTHORITY', '-u', 'WAYLAND_DISPLAY')
    }

    command.push(
      `HOME=${retroarchRunHome}`,
      `USER=${retroarchRunUser}`,
      `LOGNAME=${retroarchRunUser}`,
      `XDG_RUNTIME_DIR=${retroarchRuntimeDir}`,
      `DBUS_SESSION_BUS_ADDRESS=${retroarchDbusAddress}`,
      `PULSE_SERVER=${retroarchPulseServer}`,
    )

    let launchCommand = 'sudo'
    let launchArgs
    if (retroarchTtyXSession) {
      const launcherScript =
        process.env.RETROARCH_TTY_X_LAUNCHER_SCRIPT ||
        `${arcadeRuntimeDir}/os/bin/arcade-retro-launch.sh`
      const sessionScript =
        process.env.RETROARCH_TTY_X_SESSION_SCRIPT ||
        `${arcadeRuntimeDir}/os/bin/arcade-retro-session.sh`

      launchCommand = 'env'
      launchArgs = [
        `ARCADE_RETRO_DISPLAY=:1`,
        `ARCADE_RETRO_VT=vt${gameVT}`,
        `ARCADE_RETRO_SESSION_SCRIPT=${sessionScript}`,
        `ARCADE_RETRO_RUN_USER=${retroarchRunUser}`,
        `ARCADE_RETRO_RUN_HOME=${retroarchRunHome}`,
        `ARCADE_RETRO_XDG_RUNTIME_DIR=${retroarchRuntimeDir}`,
        `ARCADE_RETRO_DBUS_ADDRESS=${retroarchDbusAddress}`,
        `ARCADE_RETRO_PULSE_SERVER=${retroarchPulseServer}`,
        `ARCADE_RETRO_BIN=${retroarchBin}`,
        `ARCADE_RETRO_SWITCH_TO_VT=${gameVT}`,
        `ARCADE_RETRO_PREWARMED_X=${process.env.ARCADE_RETRO_TTY_X_PREWARM ? '1' : '0'}`,
        `ARCADE_RETRO_CORE_PATH=${core.path}`,
        `ARCADE_RETRO_ROM_PATH=${romPath}`,
        `ARCADE_RETRO_OVERLAY_URL=http://127.0.0.1:${port}/retro-overlay.html`,
        ...(retroarchConfigPath ? [`ARCADE_RETRO_CONFIG_PATH=${retroarchConfigPath}`] : []),
        launcherScript,
      ]
      logger.log('[LAUNCH] tty-x-session argv', launchArgs)
    } else {
      if (retroarchUseDbusRunSession) command.push('dbus-run-session', '--')
      command.push(retroarchBin, '--fullscreen', '--verbose')
      if (retroarchConfigPath) command.push('--config', retroarchConfigPath)
      command.push('-L', core.path, romPath)
      launchArgs = command
      logger.log('[LAUNCH] sudo argv', launchArgs)
    }

    const retroarchProcess = spawn(launchCommand, launchArgs, {
      stdio: ['pipe', options.getRetroarchLogFd(), options.getRetroarchLogFd()],
      detached: true,
    })
    setRetroarchProcess(retroarchProcess)
    retroarchProcess.unref()

    retroarchProcess.on('error', (err: any) => {
      logger.error('[PROCESS] RetroArch spawn error', err.message)
      setRetroarchCurrentGameId(null)
      clearArcadeLifeSession('spawn-error')
      finalizeRetroarchExit('spawn-error')
    })

    retroarchProcess.on('exit', (code: any, signal: any) => {
      logger.log(`[PROCESS] RetroArch exited code=${code} signal=${signal}`)
      const abnormal =
        code !== 0 && code !== 130 && code !== 143 && signal !== 'SIGINT' && signal !== 'SIGTERM'
      finalizeRetroarchExit(abnormal ? `abnormal-exit-code-${code ?? 'null'}` : 'normal-exit')
    })

    scheduleRetroarchReadyWatch(onRetroarchStarted)
    return { ok: true, status: 200 }
  }

  return {
    launchGame,
  }
}
