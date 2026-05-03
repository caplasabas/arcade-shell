export function createArcadeTimeService(options: any) {
  const {
    logger = console,
    arcadeTimeGraceMs,
    arcadeLifePriceDefault,
    getArcadeSession,
    setArcadeSession,
    getRetroarchActive,
    getArcadeTimeLoopTimer,
    setArcadeTimeLoopTimer,
    getArcadeTimeoutPausePending,
    setArcadeTimeoutPausePending,
    getArcadeTimeoutPauseConfirmed,
    scheduleArcadeTimePersistence,
    ensureArcadeTimeoutPause,
    refreshArcadeOsdMessage,
    dispatch,
    normalizeArcadeJoinMode,
    getArcadeSessionPrice,
    getArcadeLifePromptActionLabel,
    composeArcadeOsdOverlay,
    showArcadeOsdMessage,
    clearArcadeBalanceSyncLoop,
    clearArcadePromptLoop,
    clearArcadeContinueCountdown,
    clearArcadeOverlayNotice,
    resetArcadeTimeoutPauseState,
    clearArcadeBalancePushFloor,
    clearArcadeTimePersistTimer,
    seedArcadeTimePersistence,
    scheduleArcadePromptLoop,
    scheduleArcadeBalanceSyncLoop,
    syncArcadeSessionBalance,
    toMoney,
    isRetroarchSessionReady,
  } = options

  function broadcastArcadeLifeState(status: any = 'state', extra: any = {}) {
    const arcadeSession = getArcadeSession()
    if (!arcadeSession?.active) {
      dispatch({
        type: 'ARCADE_LIFE_STATE',
        active: false,
        status,
        ...extra,
      })
      return
    }

    dispatch({
      type: 'ARCADE_LIFE_STATE',
      active: true,
      status,
      gameId: arcadeSession.gameId,
      gameName: arcadeSession.gameName,
      pricePerLife: arcadeSession.pricePerLife,
      joinMode: normalizeArcadeJoinMode(arcadeSession.joinMode),
      sessionPhase: arcadeSession.sessionPhase || 'prestart',
      p1Unlocked: Number(arcadeSession.arcadeTimeMs || 0) > 0,
      p2Unlocked:
        Number(arcadeSession.arcadeTimeMs || 0) > 0 &&
        normalizeArcadeJoinMode(arcadeSession.joinMode) !== 'single_only',
      p1LivesPurchased: 0,
      p2LivesPurchased: 0,
      balance: arcadeSession.lastKnownBalance,
      ...extra,
    })
  }

  function maybeStartArcadeTimeSession(reason: any = 'ready') {
    const arcadeSession = getArcadeSession()
    if (!arcadeSession?.active) return false
    if (Number(arcadeSession.arcadeTimeMs || 0) <= 0) return false
    if (arcadeSession.arcadeSessionStartedAt) return false
    if (!isRetroarchSessionReady()) return false

    const now = Date.now()
    arcadeSession.arcadeSessionStartedAt = now
    arcadeSession.arcadeTimeLastDeductedAt = now
    logger.log(`[ARCADE TIME] session start (${reason})`)
    return true
  }

  function startArcadeTimeLoop() {
    if (getArcadeTimeLoopTimer()) return

    const timer = setInterval(async () => {
      const arcadeSession = getArcadeSession()
      if (!arcadeSession?.active) return
      if (!getRetroarchActive()) {
        stopArcadeTimeLoop()
        return
      }

      const now = Date.now()
      if (!arcadeSession.arcadeSessionStartedAt) {
        if (!maybeStartArcadeTimeSession('retroarch_ready')) return
      }

      const elapsedSinceStart = now - arcadeSession.arcadeSessionStartedAt
      if (elapsedSinceStart < arcadeTimeGraceMs) {
        arcadeSession.arcadeTimeLastDeductedAt = now
        return
      }

      const last = arcadeSession.arcadeTimeLastDeductedAt || arcadeSession.arcadeSessionStartedAt
      const delta = now - last
      if (delta < 1000) return

      const remaining = arcadeSession.arcadeTimeMs || 0
      if (remaining <= 0) return

      const deduct = Math.min(delta, remaining)
      arcadeSession.arcadeTimeMs -= deduct
      arcadeSession.arcadeTimeLastDeductedAt = now
      scheduleArcadeTimePersistence(arcadeSession.arcadeTimeMs)

      if (arcadeSession.arcadeTimeMs <= 0) {
        arcadeSession.arcadeTimeMs = 0
        scheduleArcadeTimePersistence(0, { immediate: true })
        if (!getArcadeTimeoutPausePending() && !getArcadeTimeoutPauseConfirmed()) {
          void ensureArcadeTimeoutPause()
        }
      }

      if (typeof refreshArcadeOsdMessage === 'function') {
        refreshArcadeOsdMessage()
      }
    }, 500)

    setArcadeTimeLoopTimer(timer)
  }

  function stopArcadeTimeLoop() {
    const timer = getArcadeTimeLoopTimer()
    if (!timer) return
    clearInterval(timer)
    setArcadeTimeLoopTimer(null)
    setArcadeTimeoutPausePending(false)
  }

  function startArcadeLifeSession({
    gameId,
    gameName,
    pricePerLife,
    initialBalance = null,
    initialArcadeTimeMs = 0,
    joinMode = 'simultaneous',
  }: any) {
    clearArcadeBalanceSyncLoop()
    clearArcadePromptLoop()
    clearArcadeContinueCountdown()
    clearArcadeOverlayNotice()
    resetArcadeTimeoutPauseState()

    const arcadeSession = {
      active: true,
      gameId: String(gameId || '').trim() || 'unknown',
      gameName: String(gameName || '').trim() || String(gameId || '').trim() || 'Arcade Game',
      pricePerLife: toMoney(pricePerLife, arcadeLifePriceDefault),
      joinMode: normalizeArcadeJoinMode(joinMode),
      sessionPhase: 'prestart',
      arcadeTimeMs: Math.max(0, Number(initialArcadeTimeMs || 0)),
      arcadeSessionStartedAt: null,
      arcadeTimeLastDeductedAt: null,
      lastKnownBalance:
        initialBalance === null || initialBalance === undefined ? null : toMoney(initialBalance, 0),
    }

    setArcadeSession(arcadeSession)
    seedArcadeTimePersistence(arcadeSession.arcadeTimeMs)

    if (arcadeSession.arcadeTimeMs > 0) {
      showArcadeOsdMessage(composeArcadeOsdOverlay('PRESS START TO PLAY'))
      startArcadeTimeLoop()
    } else {
      const priceText = getArcadeSessionPrice().toFixed(2)
      const actionLabel = getArcadeLifePromptActionLabel()
      showArcadeOsdMessage(
        composeArcadeOsdOverlay(`TIME LOCKED | PRESS ${actionLabel} (P${priceText})`),
      )
    }

    broadcastArcadeLifeState('started')

    const sessionRef = arcadeSession
    setTimeout(() => {
      const currentSession = getArcadeSession()
      if (!currentSession?.active || currentSession !== sessionRef) return
      if (currentSession.arcadeTimeMs > 0) return
      const promptPriceText = getArcadeSessionPrice().toFixed(2)
      const promptActionLabel = getArcadeLifePromptActionLabel()
      showArcadeOsdMessage(
        composeArcadeOsdOverlay(`TIME LOCKED | PRESS ${promptActionLabel} (P${promptPriceText})`),
      )
    }, 2000)

    scheduleArcadePromptLoop()
    scheduleArcadeBalanceSyncLoop()
    syncArcadeSessionBalance({ forceBroadcast: true })
  }

  function clearArcadeLifeSession(reason: any = 'ended') {
    const arcadeSession = getArcadeSession()
    if (!arcadeSession?.active) return

    const endedSession = arcadeSession
    scheduleArcadeTimePersistence(endedSession.arcadeTimeMs || 0, { immediate: true })
    stopArcadeTimeLoop()
    resetArcadeTimeoutPauseState()
    setArcadeSession(null)

    clearArcadeBalancePushFloor()
    clearArcadeBalanceSyncLoop()
    clearArcadePromptLoop()
    clearArcadeContinueCountdown()
    clearArcadeOverlayNotice()
    clearArcadeTimePersistTimer()
    dispatch({
      type: 'ARCADE_LIFE_SESSION_ENDED',
      status: reason,
      gameId: endedSession.gameId,
      gameName: endedSession.gameName,
      p1LivesPurchased: 0,
      p2LivesPurchased: 0,
      balance: endedSession.lastKnownBalance,
    })
  }

  return {
    broadcastArcadeLifeState,
    maybeStartArcadeTimeSession,
    startArcadeTimeLoop,
    stopArcadeTimeLoop,
    startArcadeLifeSession,
    clearArcadeLifeSession,
  }
}
