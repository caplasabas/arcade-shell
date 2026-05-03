export function createArcadePromptController(options: any) {
  const {
    arcadeRetroOsdPromptPersist,
    arcadeRetroOsdPromptBlink,
    arcadeRetroOsdPromptIntervalMs,
    logger = console,
    getArcadeSession,
    getContinueCountdownTimers,
    getPromptLoopTimer,
    setPromptLoopTimer,
    getPromptBlinkPhase,
    setPromptBlinkPhase,
    getLastPromptLoopMessage,
    setLastPromptLoopMessage,
    getLastPromptLoopSentAt,
    setLastPromptLoopSentAt,
    getBuyIntentState,
    setBuyIntentState,
    getBuyIntentUntil,
    getGameOverTimer,
    getGameOverState,
    isArcadeTimeLockActive,
    normalizeArcadeJoinMode,
    isArcadePurchaseAllowed,
    getArcadeSessionPrice,
    getArcadeLifePromptActionLabel,
    composeArcadeOsdOverlay,
    showArcadeOsdMessage,
  } = options

  function clearArcadeContinueCountdown(player: any = null) {
    const timers = getContinueCountdownTimers()
    const players =
      player && timers[player] !== undefined ? [player] : Object.keys(timers)

    for (const currentPlayer of players) {
      const timer = timers[currentPlayer]
      if (!timer) continue
      clearTimeout(timer)
      timers[currentPlayer] = null
    }
  }

  function clearArcadePromptLoop() {
    const promptLoopTimer = getPromptLoopTimer()
    if (promptLoopTimer !== null) {
      clearTimeout(promptLoopTimer)
      setPromptLoopTimer(null)
    }

    setPromptBlinkPhase(false)
    setLastPromptLoopMessage('')
    setLastPromptLoopSentAt(0)
  }

  function buildArcadePromptMessage() {
    const arcadeSession = getArcadeSession()
    if (!arcadeSession?.active) return ''

    const hasTime = !isArcadeTimeLockActive()
    const joinMode = normalizeArcadeJoinMode(arcadeSession.joinMode)
    const sessionPhase = String(arcadeSession.sessionPhase || 'prestart')
    const p2PurchaseAllowed = isArcadePurchaseAllowed('P2')

    if (!hasTime) {
      const priceText = getArcadeSessionPrice().toFixed(2)
      const actionLabel = getArcadeLifePromptActionLabel()
      if (!p2PurchaseAllowed) {
        return composeArcadeOsdOverlay(
          joinMode === 'alternating' && sessionPhase === 'live' ? 'P2 NEXT TURN' : '1 PLAYER ONLY',
        )
      }
      return composeArcadeOsdOverlay(`TIME LOCKED | PRESS ${actionLabel} (P${priceText})`)
    }

    return ''
  }

  function scheduleArcadePromptLoop() {
    clearArcadePromptLoop()
    if (!arcadeRetroOsdPromptPersist) return

    const HEARTBEAT_MS = 4000

    const tick = () => {
      const arcadeSession = getArcadeSession()
      if (!arcadeSession?.active) {
        clearArcadePromptLoop()
        return
      }

      if (getBuyIntentState() === 'armed' && Date.now() > getBuyIntentUntil()) {
        setBuyIntentState('idle')
      }

      const promptMessage = buildArcadePromptMessage()
      if (promptMessage) {
        if (arcadeRetroOsdPromptBlink) {
          const nextBlink = !getPromptBlinkPhase()
          setPromptBlinkPhase(nextBlink)
          if (nextBlink) {
            showArcadeOsdMessage(promptMessage, { bypassCooldown: true })
          } else {
            showArcadeOsdMessage('', { allowBlank: true, bypassCooldown: true })
          }
        } else {
          const now = Date.now()
          const changed = promptMessage !== getLastPromptLoopMessage()
          const heartbeatDue = now - getLastPromptLoopSentAt() >= HEARTBEAT_MS

          if (changed || heartbeatDue) {
            showArcadeOsdMessage(promptMessage, { bypassCooldown: changed })
            setLastPromptLoopMessage(promptMessage)
            setLastPromptLoopSentAt(now)
          }
        }
      } else {
        setPromptBlinkPhase(false)
        setLastPromptLoopMessage('')
        setLastPromptLoopSentAt(0)
      }

      setPromptLoopTimer(setTimeout(tick, arcadeRetroOsdPromptIntervalMs))
    }

    tick()
  }

  function startArcadeContinueCountdown(player: any) {
    if (player !== 'P1' && player !== 'P2') return

    const gameOverTimer = getGameOverTimer()
    const gameOverState = getGameOverState()

    if (gameOverTimer[player]) {
      clearTimeout(gameOverTimer[player])
      gameOverTimer[player] = null
    }

    clearArcadeContinueCountdown(player)
    gameOverState[player] = false
    logger.log('[ARCADE] continue countdown reset', { player })
  }

  return {
    clearArcadeContinueCountdown,
    clearArcadePromptLoop,
    buildArcadePromptMessage,
    scheduleArcadePromptLoop,
    startArcadeContinueCountdown,
  }
}
