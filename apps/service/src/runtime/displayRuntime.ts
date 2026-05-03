import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

export function createDisplayRuntime(options: any) {
  const {
    logger = console,
    isPi,
    singleXMode,
    useSplashTransitions,
    retroarchTtyXSession,
    retroarchTtyXPrewarm,
    keepUiAliveDuringTtyX,
    retroarchReadyFile,
    getSplashStartedForRetroarch,
    setSplashStartedForRetroarch,
    getArcadeUiStoppedForRetroarch,
    setArcadeUiStoppedForRetroarch,
    getRetroXWarmRequested,
    setRetroXWarmRequested,
    getRetroarchReadyWatchTimer,
    setRetroarchReadyWatchTimer,
    getRetroarchActive,
    getRetroarchProcess,
    getTargetUiVT,
    switchToVTWithRetry,
    switchToVT,
    splashVT,
    runXClientCommand,
    getChromiumUiHidden,
    setChromiumUiHidden,
  } = options

  function restartArcadeUiAfterRetroarch(reason: any, forceRestart = false) {
    if (!retroarchTtyXSession) return
    if (keepUiAliveDuringTtyX && !forceRestart) {
      logger.log(`[UI] arcade-ui.service kept alive during tty X RetroArch session (${reason})`)
      return
    }
    if (!forceRestart && !getArcadeUiStoppedForRetroarch()) return

    setArcadeUiStoppedForRetroarch(false)
    const action = forceRestart ? 'restart' : 'start'
    const proc = spawn('systemctl', [action, '--no-block', 'arcade-ui.service'], {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    logger.log(`[UI] ${action} requested after tty X RetroArch exit (${reason})`)
  }

  function stopArcadeUiForRetroarch() {
    if (!retroarchTtyXSession) return
    if (getArcadeUiStoppedForRetroarch()) return
    if (keepUiAliveDuringTtyX) {
      logger.log('[UI] keeping arcade-ui.service alive during tty X RetroArch launch')
      return
    }

    const proc = spawn('systemctl', ['stop', '--no-block', 'arcade-ui.service'], {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    setArcadeUiStoppedForRetroarch(true)
    logger.log('[UI] stop requested before tty X RetroArch launch')
  }

  function ensureRetroXWarm(reason = 'boot') {
    if (!retroarchTtyXSession) return
    if (!retroarchTtyXPrewarm) return
    if (getRetroXWarmRequested()) return

    const proc = spawn('systemctl', ['start', '--no-block', 'arcade-retro-x.service'], {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    setRetroXWarmRequested(true)
    logger.log(`[RETRO-X] warm start requested (${reason})`)

    if (reason === 'boot') {
      setTimeout(() => {
        switchToVTWithRetry(getTargetUiVT(), 'boot-ui')
        setTimeout(() => switchToVTWithRetry(getTargetUiVT(), 'boot-ui-post'), 250)
      }, 3000)
    }
  }

  function startSplashForRetroarch() {
    if (!useSplashTransitions) return
    if (getSplashStartedForRetroarch()) return

    const proc = spawn('systemctl', ['start', '--no-block', 'arcade-splash.service'], {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    setSplashStartedForRetroarch(true)
    logger.log('[SPLASH] start requested for RetroArch transition')
  }

  function stopSplashForRetroarch(reason: any) {
    if (!getSplashStartedForRetroarch()) return

    setSplashStartedForRetroarch(false)
    const proc = spawn('systemctl', ['stop', '--no-block', 'arcade-splash.service'], {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    logger.log(`[SPLASH] stop requested after RetroArch transition (${reason})`)
  }

  function ensureSplashReady(reason = 'boot') {
    if (!useSplashTransitions) return
    if (getSplashStartedForRetroarch()) return

    const proc = spawn('systemctl', ['start', '--no-block', 'arcade-splash.service'], {
      detached: true,
      stdio: 'ignore',
    })
    proc.unref()
    setSplashStartedForRetroarch(true)
    logger.log(`[SPLASH] warm start requested (${reason})`)
  }

  function clearRetroarchReadyWatch() {
    const timer = getRetroarchReadyWatchTimer()
    if (timer === null) return
    clearTimeout(timer)
    setRetroarchReadyWatchTimer(null)
  }

  function scheduleRetroarchReadyWatch(onReady: any) {
    if (!retroarchTtyXSession) return

    clearRetroarchReadyWatch()
    const startedAt = Date.now()
    const READY_WATCH_TIMEOUT_MS = 20000
    const READY_WATCH_INTERVAL_MS = 120

    const tick = () => {
      if (!getRetroarchActive() || !getRetroarchProcess()) {
        clearRetroarchReadyWatch()
        return
      }

      if (fs.existsSync(retroarchReadyFile)) {
        clearRetroarchReadyWatch()
        try {
          onReady()
        } catch (error) {
          logger.error('[RETROARCH] ready handoff failed', error)
        }
        return
      }

      if (Date.now() - startedAt >= READY_WATCH_TIMEOUT_MS) {
        clearRetroarchReadyWatch()
        logger.warn(
          `[RETROARCH] ready file not observed within ${READY_WATCH_TIMEOUT_MS}ms: ${retroarchReadyFile}`,
        )
        return
      }

      setRetroarchReadyWatchTimer(setTimeout(tick, READY_WATCH_INTERVAL_MS))
    }

    setRetroarchReadyWatchTimer(setTimeout(tick, READY_WATCH_INTERVAL_MS))
  }

  function hasCommand(name: any) {
    const result = spawnSync('sh', ['-lc', `command -v ${name} >/dev/null 2>&1`], {
      stdio: 'ignore',
    })
    return result.status === 0
  }

  function hideChromiumUiForRetroarch() {
    if (!singleXMode) return
    if (getChromiumUiHidden()) return

    let attempted = false
    if (hasCommand('xdotool')) {
      attempted = true
      runXClientCommand(
        'sh',
        ['-lc', 'xdotool search --onlyvisible --class chromium windowunmap %@ >/dev/null 2>&1 || true'],
        'xdotool minimize chromium',
      )
    }
    if (hasCommand('wmctrl')) {
      attempted = true
      runXClientCommand(
        'sh',
        ['-lc', 'wmctrl -x -r chromium.Chromium -b add,hidden >/dev/null 2>&1 || true'],
        'wmctrl hide chromium',
      )
    }

    if (attempted) {
      setChromiumUiHidden(true)
      logger.log('[UI] Chromium hide requested before RetroArch launch')
    } else {
      logger.log('[UI] Chromium hide skipped (xdotool/wmctrl not installed)')
    }
  }

  function restoreChromiumUiAfterRetroarch() {
    if (!singleXMode) return
    if (!getChromiumUiHidden()) return

    let attempted = false
    if (hasCommand('xdotool')) {
      attempted = true
      runXClientCommand(
        'sh',
        [
          '-lc',
          'xdotool search --class chromium windowmap %@ windowraise %@ >/dev/null 2>&1 || true',
        ],
        'xdotool restore chromium',
      )
    }
    if (hasCommand('wmctrl')) {
      attempted = true
      runXClientCommand(
        'sh',
        [
          '-lc',
          'wmctrl -x -r chromium.Chromium -b remove,hidden >/dev/null 2>&1 || true; wmctrl -x -a chromium.Chromium >/dev/null 2>&1 || true',
        ],
        'wmctrl restore chromium',
      )
    }

    setChromiumUiHidden(false)
    if (attempted) {
      logger.log('[UI] Chromium restore requested after RetroArch exit')
    }
  }

  function prepareDisplayForLaunch() {
    if (singleXMode) {
      hideChromiumUiForRetroarch()
      logger.log('[DISPLAY] launching RetroArch into DISPLAY=:0')
      return
    }

    if (retroarchTtyXSession) {
      stopArcadeUiForRetroarch()
      if (useSplashTransitions) {
        startSplashForRetroarch()
        switchToVT(splashVT, 'launch-splash')
      }
      return
    }
  }

  return {
    restartArcadeUiAfterRetroarch,
    stopArcadeUiForRetroarch,
    ensureRetroXWarm,
    startSplashForRetroarch,
    stopSplashForRetroarch,
    ensureSplashReady,
    clearRetroarchReadyWatch,
    scheduleRetroarchReadyWatch,
    hideChromiumUiForRetroarch,
    restoreChromiumUiAfterRetroarch,
    prepareDisplayForLaunch,
  }
}
