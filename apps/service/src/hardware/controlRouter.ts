export function createControlRouter(options: any) {
  const {
    joystickButtonMap,
    evKey,
    btnDpadUp,
    btnDpadDown,
    btnDpadLeft,
    btnDpadRight,
    retroarchP2SwapAxes,
    casinoMenuExitsRetroarch,
    hopperTopupCoinValue,
    logger = console,
    getArcadeSession,
    getRetroarchActive,
    getRetroarchCurrentGameId,
    getRetroarchPrimaryInput,
    getBuyState,
    getGameOverState,
    getDpadState,
    getArcadeOverlayNotice,
    getArcadeContinueCountdownTimers,
    normalizeArcadePlayer,
    isArcadeTimeLockActive,
    isStartButton,
    isLifePurchaseButton,
    dispatch,
    resolveRetroInputSource,
    getRetroVirtualTarget,
    shouldPromoteArcadeSessionToLive,
    markArcadeSessionLive,
    sendVirtual,
    setLastGameInputAt,
    setLastGameplayInputAt,
    maybeStartArcadeTimeSession,
    startArcadeTimeLoop,
    isBlockedCasinoActionDuringRetroarch,
    handleBuyPressed,
    handleRetroarchMenuExitIntent,
    playerHasStoredCredit,
    handleDepositPulse,
    recordHopperTopup,
    handleWithdrawPulse,
    mapIndexToKey,
    clearRetroarchExitConfirm,
    clearArcadeContinueCountdown,
    canAcceptRetroarchStartInput,
    getArcadeSessionPrice,
    getArcadeLifePromptActionLabel,
    setArcadeOverlayNotice,
    clearArcadeOverlayNotice,
    showArcadeOsdMessage,
    composeArcadeOsdOverlay,
    broadcastArcadeLifeState,
    handleSimultaneousRetroarchStart,
  } = options

  function handleRawAxis(source: any, code: any, value: any) {
    const DEAD_LOW = 40
    const DEAD_HIGH = 215
    const retroarchActive = getRetroarchActive()
    const shouldSwapP2Axes = source === 'P2' && retroarchActive && retroarchP2SwapAxes
    const effectiveCode = shouldSwapP2Axes ? (code === 0 ? 1 : code === 1 ? 0 : code) : code
    const effectiveValue = value

    if (!retroarchActive) {
      if (code === 0) {
        if (value < DEAD_LOW) {
          if (source === 'P1') logger.log('[MODAL DEBUG] P1 joystick LEFT')
          dispatch({ type: 'PLAYER', player: source, button: 'LEFT' })
        } else if (value > DEAD_HIGH) {
          if (source === 'P1') logger.log('[MODAL DEBUG] P1 joystick RIGHT')
          dispatch({ type: 'PLAYER', player: source, button: 'RIGHT' })
        }
      }

      if (code === 1) {
        if (value < DEAD_LOW) {
          if (source === 'P1') logger.log('[MODAL DEBUG] P1 joystick UP')
          dispatch({ type: 'PLAYER', player: source, button: 'UP' })
        } else if (value > DEAD_HIGH) {
          if (source === 'P1') logger.log('[MODAL DEBUG] P1 joystick DOWN')
          dispatch({ type: 'PLAYER', player: source, button: 'DOWN' })
        }
      }

      return
    }

    const mappedSource = resolveRetroInputSource(source)
    const target = getRetroVirtualTarget(source)
    if (!target || !retroarchActive) return

    const arcadeSession = getArcadeSession()
    if (arcadeSession?.active && isArcadeTimeLockActive()) return

    if (value !== 0 && shouldPromoteArcadeSessionToLive(mappedSource, -1)) {
      markArcadeSessionLive('axis_input')
    }

    const state = getDpadState()[mappedSource]
    if (!state) return

    function press(keyName: any, keyCode: any) {
      if (state[keyName]) return
      state[keyName] = true
      sendVirtual(target, evKey, keyCode, 1)
    }

    function release(keyName: any, keyCode: any) {
      if (!state[keyName]) return
      state[keyName] = false
      sendVirtual(target, evKey, keyCode, 0)
    }

    if (effectiveCode === 0) {
      if (effectiveValue < DEAD_LOW) {
        press('left', btnDpadLeft)
        release('right', btnDpadRight)
      } else if (effectiveValue > DEAD_HIGH) {
        press('right', btnDpadRight)
        release('left', btnDpadLeft)
      } else {
        release('left', btnDpadLeft)
        release('right', btnDpadRight)
      }
    }

    if (effectiveCode === 1) {
      if (effectiveValue < DEAD_LOW) {
        press('up', btnDpadUp)
        release('down', btnDpadDown)
      } else if (effectiveValue > DEAD_HIGH) {
        press('down', btnDpadDown)
        release('up', btnDpadUp)
      } else {
        release('up', btnDpadUp)
        release('down', btnDpadDown)
      }
    }
  }

  function handleKey(source: any, index: any, value: any) {
    if (index === undefined || index === null) return

    const player = normalizeArcadePlayer(source)
    const arcadeSession = getArcadeSession()

    if (arcadeSession?.active && player) {
      const hasTime = !isArcadeTimeLockActive()
      const isBuyInput = joystickButtonMap[index] === 'BUY'
      const isMenuInput = joystickButtonMap[index] === 'MENU'

      if (!hasTime && !isBuyInput && !isMenuInput) return
      if (getGameOverState()?.[player]) return
    }

    if (source === 'CASINO') {
      const casinoAction = joystickButtonMap[index]
      const retroarchActive = getRetroarchActive()

      if (value === 1 && arcadeSession?.active && retroarchActive) {
        const now = Date.now()
        const isStart = isStartButton(index)
        const isPurchase = isLifePurchaseButton(index)
        const isGameplay = !isStart && !isPurchase

        setLastGameInputAt(now)

        if (isStart && arcadeSession.sessionPhase === 'prestart') {
          logger.log('[HEURISTIC] SESSION START DETECTED', { from: 'prestart' })
          arcadeSession.sessionPhase = 'live'
          maybeStartArcadeTimeSession('start_pressed')
          startArcadeTimeLoop()
          broadcastArcadeLifeState('session_start_detected', { reason: 'start_pressed' })
        }

        if (isGameplay) {
          const gameplayPlayer = normalizeArcadePlayer(source)
          if (gameplayPlayer) setLastGameplayInputAt(gameplayPlayer, now)
        }
      }

      if (retroarchActive && isBlockedCasinoActionDuringRetroarch(casinoAction)) {
        logger.log(`[CASINO] blocked during RetroArch: ${casinoAction}`)
        return
      }

      if (value === 1 && joystickButtonMap[index] === 'BUY') {
        const isArcadeContext = retroarchActive && !!getRetroarchCurrentGameId()
        if (!isArcadeContext) {
          dispatch({ type: 'ACTION', action: 'BUY' })
          return
        }
        if (getBuyState() === 'processing') return
        handleBuyPressed()
        return
      }

      if (retroarchActive && getRetroarchPrimaryInput() === 'CASINO') {
        if (value === 1 && joystickButtonMap[index] === 'MENU' && casinoMenuExitsRetroarch) {
          handleRetroarchMenuExitIntent()
          return
        }
        routePlayerInput('P1', index, value)
        return
      }

      if (retroarchActive && arcadeSession?.active) {
        const primaryPlayer = normalizeArcadePlayer(getRetroarchPrimaryInput()) || 'P1'
        const primaryLocked = !playerHasStoredCredit(primaryPlayer)

        if (primaryLocked && casinoAction === 'MENU' && casinoMenuExitsRetroarch) {
          if (value === 1) handleRetroarchMenuExitIntent()
          return
        }
      }

      if (!retroarchActive && value === 1 && index === 7) {
        dispatch({ type: 'PLAYER', player: 'CASINO', button: 7 })
        return
      }

      if (value !== 1) return

      if (retroarchActive && casinoAction === 'MENU' && casinoMenuExitsRetroarch) {
        handleRetroarchMenuExitIntent()
        return
      }

      switch (casinoAction) {
        case 'COIN':
          handleDepositPulse()
          break
        case 'HOPPER_COIN':
          void recordHopperTopup(hopperTopupCoinValue)
          dispatch({ type: 'HOPPER_COIN', amount: hopperTopupCoinValue })
          break
        case 'WITHDRAW_COIN':
          handleWithdrawPulse()
          break
        default:
          dispatch({ type: 'ACTION', action: casinoAction })
          break
      }
      return
    }

    routePlayerInput(source, index, value)
  }

  function routePlayerInput(source: any, index: any, value: any) {
    const keyCode = mapIndexToKey(index)
    if (!keyCode) return

    const retroarchActive = getRetroarchActive()
    if (retroarchActive) {
      const target = getRetroVirtualTarget(source)
      if (!target) return

      const player = normalizeArcadePlayer(source)
      if (!player) return
      const playerAction = joystickButtonMap[index]
      const arcadeSession = getArcadeSession()

      if (arcadeSession?.active) {
        const hasTime = Number(arcadeSession.arcadeTimeMs || 0) > 0

        if (isStartButton(index)) {
          if (value === 1) clearRetroarchExitConfirm()

          const continueTimers = getArcadeContinueCountdownTimers()
          if (value === 1 && continueTimers[player]) {
            logger.log('[ARCADE] CONTINUE', { player })
            clearArcadeContinueCountdown(player)
            broadcastArcadeLifeState('continue', { player })
          }

          if (!canAcceptRetroarchStartInput()) {
            if (value === 1) {
              logger.log('[RETROARCH] START ignored by launch guard', { player })
            }
            return
          }

          if (!hasTime) {
            if (value === 1) {
              const priceText = getArcadeSessionPrice().toFixed(2)
              const prompt = `TIME LOCKED | PRESS ${getArcadeLifePromptActionLabel()} (P${priceText})`
              setArcadeOverlayNotice('TIME LOCKED', 1800, player === 'P1' ? 'left' : 'right')
              showArcadeOsdMessage(composeArcadeOsdOverlay(prompt), {
                bypassCooldown: true,
                urgent: true,
              })
              broadcastArcadeLifeState('time_locked', {
                player,
                balance: arcadeSession.lastKnownBalance,
                arcadeTimeMs: arcadeSession.arcadeTimeMs || 0,
              })
            }
            return
          }

          const overlayNotice = getArcadeOverlayNotice()
          if (overlayNotice?.slot === (player === 'P1' ? 'left' : 'right')) {
            clearArcadeOverlayNotice()
          }
          if (handleSimultaneousRetroarchStart(player, target, value)) return
          sendVirtual(target, evKey, keyCode, value)
          return
        }
      }

      if (value === 1 && playerAction === 'MENU' && !isStartButton(index) && casinoMenuExitsRetroarch) {
        handleRetroarchMenuExitIntent()
        return
      }

      if (value === 1 && shouldPromoteArcadeSessionToLive(player, index)) {
        markArcadeSessionLive('player_input')
      }

      sendVirtual(target, evKey, keyCode, value)
      return
    }

    if (value !== 1) return

    if (source === 'P1' && (index === 0 || index === 1)) {
      logger.log(
        `[MODAL DEBUG] P1 button ${index} press (${index === 0 ? 'confirm/select' : 'dismiss keyboard'})`,
      )
    }

    dispatch({
      type: 'PLAYER',
      player: source,
      button: index,
    })
  }

  return {
    handleRawAxis,
    handleKey,
    routePlayerInput,
  }
}
