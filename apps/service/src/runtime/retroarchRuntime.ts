import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

export function createRetroarchRuntimeOrchestrator(options: any) {
  const {
    logger = console,
    isPi,
    singleXMode,
    retroarchUseTtyMode,
    restartUiOnExit,
    retroarchTermFallbackMs,
    retroarchStopGraceMs,
    getPendingUiFallbackTimer,
    setPendingUiFallbackTimer,
    getRetroarchStopTermTimer,
    setRetroarchStopTermTimer,
    getRetroarchStopForceTimer,
    setRetroarchStopForceTimer,
    getRetroarchProcess,
    setRetroarchProcess,
    getRetroarchActive,
    setRetroarchActive,
    getRetroarchStopping,
    setRetroarchStopping,
    getRetroarchStartedAt,
    setRetroarchStartedAt,
    getRetroarchCurrentGameId,
    setRetroarchCurrentGameId,
    getRetroarchLogFd,
    setRetroarchLogFd,
    getLastExitTime,
    setLastExitTime,
    getLastExitedGameId,
    setLastExitedGameId,
    getArcadeSession,
    getShuttingDown,
    getLastUiRestartAt,
    setLastUiRestartAt,
    uiRestartCooldownMs,
    getTargetUiVT,
    clearRetroarchExitConfirm,
    clearRetroarchReadyWatch,
    resetRetroarchStartPressState,
    stopArcadeTimeLoop,
    stopSplashForRetroarch,
    restoreChromiumUiAfterRetroarch,
    clearArcadeLifeSession,
    dispatch,
    maybeRestartUiAfterRetroarch,
  } = options

  function switchToVT(vt: any, reason: any) {
    if (singleXMode) return true
    if (!retroarchUseTtyMode) return true
    if (!isPi) return true

    const result = spawnSync('chvt', [vt], { encoding: 'utf8' })
    if (result.status !== 0) {
      logger.error(
        `[VT] chvt ${vt} failed (${reason})`,
        result.stderr?.trim() || result.error?.message || '',
      )
      return false
    }

    logger.log(`[VT] switched to ${vt} (${reason})`)
    return true
  }

  function switchToVTWithRetry(vt: any, reason: any, attempts = 5, delayMs = 150) {
    if (singleXMode) return
    if (!retroarchUseTtyMode) return
    if (!isPi) return

    let remaining = attempts
    const attempt = () => {
      const ok = switchToVT(vt, `${reason}#${attempts - remaining + 1}`)
      if (ok) return
      remaining -= 1
      if (remaining <= 0) return
      setTimeout(attempt, delayMs)
    }

    attempt()
  }

  function scheduleForceSwitchToUI(reason: any, delayMs = 300) {
    if (singleXMode) return
    if (!retroarchUseTtyMode || !isPi) return

    const pending = getPendingUiFallbackTimer()
    if (pending !== null) {
      clearTimeout(pending)
      setPendingUiFallbackTimer(null)
    }

    const targetUiVT = getTargetUiVT()
    const waitMs = Math.max(0, Math.round(delayMs))
    const timer = setTimeout(() => {
      setPendingUiFallbackTimer(null)
      switchToVTWithRetry(targetUiVT, `${reason}-timer`)
      setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-timer-post`), 120)
    }, waitMs)
    setPendingUiFallbackTimer(timer)
    logger.log(`[VT] scheduled fallback to ${targetUiVT} (${reason})`)
  }

  function clearScheduledForceSwitchToUI() {
    const pending = getPendingUiFallbackTimer()
    if (pending === null) return
    clearTimeout(pending)
    setPendingUiFallbackTimer(null)
  }

  function clearRetroarchStopTimers() {
    const term = getRetroarchStopTermTimer()
    if (term !== null) {
      clearTimeout(term)
      setRetroarchStopTermTimer(null)
    }
    const force = getRetroarchStopForceTimer()
    if (force !== null) {
      clearTimeout(force)
      setRetroarchStopForceTimer(null)
    }
  }

  function killRetroarchProcess(signal: any, reason: any) {
    const retroarchProcess = getRetroarchProcess()
    if (!retroarchProcess) return

    const pid = retroarchProcess.pid
    try {
      process.kill(-pid, signal)
      logger.log(`[RETROARCH] group ${signal} (${reason}) pid=${pid}`)
      return
    } catch {}

    try {
      retroarchProcess.kill(signal)
      logger.log(`[RETROARCH] child ${signal} (${reason}) pid=${pid}`)
    } catch (err: any) {
      logger.error('[RETROARCH] kill failed', err.message)
    }
  }

  function sendRetroarchSignal(signal: any, reason: any) {
    if (!getRetroarchProcess()) return
    killRetroarchProcess(signal, reason)
  }

  function finalizeRetroarchExit(reason: any) {
    if (!getRetroarchActive() && !getRetroarchProcess()) return

    const wasActive = getRetroarchActive()
    const targetUiVT = getTargetUiVT()
    const abnormalExit =
      typeof reason === 'string' &&
      (reason.includes('crash') || reason.includes('segfault') || reason.includes('abnormal'))

    clearRetroarchStopTimers()
    clearRetroarchExitConfirm()
    clearRetroarchReadyWatch()
    setRetroarchActive(false)
    setRetroarchStopping(false)
    setRetroarchProcess(null)
    setLastExitTime(Date.now())
    setLastExitedGameId(
      getArcadeSession()?.gameId || getRetroarchCurrentGameId() || getLastExitedGameId(),
    )
    setRetroarchCurrentGameId(null)
    setRetroarchStartedAt(0)
    resetRetroarchStartPressState('P1')
    resetRetroarchStartPressState('P2')

    stopArcadeTimeLoop()

    const arcadeSession = getArcadeSession()
    if (arcadeSession) {
      arcadeSession.arcadeSessionStartedAt = null
      arcadeSession.arcadeTimeLastDeductedAt = null
    }

    const logFd = getRetroarchLogFd()
    if (logFd !== null) {
      try {
        fs.closeSync(logFd)
      } catch {}
      setRetroarchLogFd(null)
    }

    stopSplashForRetroarch(reason)

    if (singleXMode) {
      restoreChromiumUiAfterRetroarch()
    } else {
      switchToVTWithRetry(targetUiVT, reason)
      setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-post`), 120)
      scheduleForceSwitchToUI(`${reason}-detached`)
      if (abnormalExit) {
        setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-crash-retry`, 8, 250), 300)
        setTimeout(() => maybeRestartUiAfterRetroarch(`${reason}-crash-ui-restart`), 400)
      }
    }

    if (wasActive) {
      clearArcadeLifeSession(reason)
      dispatch({ type: 'GAME_EXITED' })
      setTimeout(() => maybeRestartUiAfterRetroarch(reason), 50)
    }
  }

  function maybeRestartUiAfterExit(reason: any) {
    const abnormalExit =
      typeof reason === 'string' &&
      (reason.includes('crash') || reason.includes('segfault') || reason.includes('abnormal'))

    if (!isPi || !retroarchUseTtyMode || !restartUiOnExit || getShuttingDown()) return

    const now = Date.now()
    if (now - getLastUiRestartAt() < uiRestartCooldownMs) return
    setLastUiRestartAt(now)
    maybeRestartUiAfterRetroarch(reason, abnormalExit)
  }

  function requestRetroarchStop(reason: any) {
    clearRetroarchExitConfirm()
    if (!getRetroarchActive()) return
    dispatch({ type: 'GAME_EXITING', reason })
    const targetUiVT = getTargetUiVT()
    const retroarchProcess = getRetroarchProcess()

    if (!retroarchProcess) {
      logger.warn('[RETROARCH] stop requested with no process')
      finalizeRetroarchExit(`${reason}-missing-process`)
      return
    }

    if (getRetroarchStopping()) return
    setRetroarchStopping(true)
    clearRetroarchStopTimers()
    const stopTargetPid = retroarchProcess.pid

    sendRetroarchSignal('SIGINT', `${reason}-graceful`)

    if (singleXMode) {
      logger.log('[DISPLAY] waiting for RetroArch exit on DISPLAY=:0')
    } else {
      logger.log(`[VT] waiting for RetroArch exit before returning to ${targetUiVT}`)
    }

    setRetroarchStopTermTimer(
      setTimeout(() => {
        setRetroarchStopTermTimer(null)
        if (!getRetroarchActive()) return
        const currentProcess = getRetroarchProcess()
        if (!currentProcess || currentProcess.pid !== stopTargetPid) return
        sendRetroarchSignal('SIGTERM', `${reason}-term-fallback`)
      }, retroarchTermFallbackMs),
    )

    setRetroarchStopForceTimer(
      setTimeout(() => {
        setRetroarchStopForceTimer(null)
        if (!getRetroarchActive()) return
        const currentProcess = getRetroarchProcess()
        if (!currentProcess || currentProcess.pid !== stopTargetPid) return

        logger.warn('[RETROARCH] force-killing hung process')
        killRetroarchProcess('SIGKILL', `${reason}-force`)
        finalizeRetroarchExit(`${reason}-force-ui`)
      }, retroarchStopGraceMs),
    )
  }

  return {
    switchToVT,
    switchToVTWithRetry,
    scheduleForceSwitchToUI,
    clearScheduledForceSwitchToUI,
    clearRetroarchStopTimers,
    killRetroarchProcess,
    sendRetroarchSignal,
    finalizeRetroarchExit,
    maybeRestartUiAfterExit,
    requestRetroarchStop,
  }
}
