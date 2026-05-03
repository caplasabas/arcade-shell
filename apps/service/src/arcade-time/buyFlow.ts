export function createArcadeBuyFlow(options: any) {
  const {
    logger = console,
    deviceId,
    supabaseUrl,
    buyConfirmWindowMs,
    buyCooldownMs,
    arcadeTimePurchaseMs,
    hasSupabaseRpcConfig,
    getSupabaseHeaders,
    requestJsonWithCurl,
    withTimeout,
    toMoney,
    getArcadeSession,
    getBuyState,
    setBuyState,
    getBuyConfirmAt,
    setBuyConfirmAt,
    getLastBuyAt,
    setLastBuyAt,
    getArcadeTimeoutPauseConfirmed,
    addArcadeTime,
    noteArcadeBalancePush,
    broadcastArcadeLifeState,
    showArcadeOsdMessage,
    composeArcadeOsdOverlay,
    setArcadeOverlayNotice,
    resetArcadeTimeoutPauseState,
    maybeStartArcadeTimeSession,
    startArcadeTimeLoop,
    scheduleArcadeTimePersistence,
  } = options

  async function rpcBuyArcadeCredit({ deviceId, gameId }: any) {
    if (!hasSupabaseRpcConfig()) {
      return { ok: false, error: 'missing_config' }
    }

    try {
      const response = await requestJsonWithCurl(`${supabaseUrl}/rest/v1/rpc/buy_arcade_credit`, {
        method: 'POST',
        headers: getSupabaseHeaders(),
        timeoutMs: 3500,
        body: {
          p_device_id: deviceId,
          p_game_id: gameId,
        },
      })

      if (!response.ok) {
        const text = response.text || ''
        logger.error('[BUY CREDIT RPC] failed', response.status, text)
        return { ok: false, error: 'rpc_failed' }
      }

      const body = response.json()
      const row = Array.isArray(body) ? body[0] : body
      const ok =
        row?.ok === true ||
        row?.ok === 1 ||
        row?.ok === '1' ||
        row?.ok === 't' ||
        row?.ok === 'true'

      return {
        ok,
        data: row,
      }
    } catch (err: any) {
      logger.error('[BUY CREDIT RPC] exception', err?.message || err)
      return { ok: false, error: err?.message || 'exception' }
    }
  }

  async function handleBuyPressed() {
    const now = Date.now()

    if (Date.now() - getLastBuyAt() < buyCooldownMs) {
      logger.log('[BUY] cooldown active')
      return
    }

    logger.log('[BUY] pressed', {
      state: getBuyState(),
      sinceConfirm: now - getBuyConfirmAt(),
    })

    if (getBuyState() === 'processing') {
      logger.log('[BUY] blocked: processing in progress')
      return
    }

    if (getBuyState() === 'idle') {
      setBuyState('confirm')
      setBuyConfirmAt(now)
      logger.log('[BUY] confirm required')
      setArcadeOverlayNotice('BUY TIME?', buyConfirmWindowMs, 'center')
      return
    }

    if (getBuyState() === 'confirm' && now - getBuyConfirmAt() > buyConfirmWindowMs) {
      logger.log('[BUY] confirm expired')
      setBuyState('idle')
      setArcadeOverlayNotice('BUY TIME?', buyConfirmWindowMs, 'center')
      return
    }

    if (getBuyState() === 'confirm') {
      setBuyState('processing')

      const sessionRef = getArcadeSession()
      logger.log('[BUY] processing...')
      setArcadeOverlayNotice('PROCESSING...', 0, 'center')

      try {
        const gameId = sessionRef?.gameId
        if (!gameId) {
          throw new Error('missing_game_id')
        }

        logger.log('[BUY CREDIT] sending RPC...', { deviceId, gameId })
        const res = await withTimeout(
          rpcBuyArcadeCredit({
            deviceId,
            gameId,
          }),
          5000,
        )

        logger.log('[BUY CREDIT] response', res)
        if (!res || !res.ok) {
          throw new Error('rpc_failed')
        }

        const currentSession = getArcadeSession()
        const nextTimeMs = Number(res?.data?.arcade_time_ms)
        const nextBalance = toMoney(res?.data?.balance, NaN)

        if (Number.isFinite(nextTimeMs)) {
          currentSession.arcadeTimeMs = nextTimeMs
          scheduleArcadeTimePersistence(currentSession.arcadeTimeMs, { immediate: true })
          maybeStartArcadeTimeSession('buy')
          startArcadeTimeLoop()
        } else {
          addArcadeTime(arcadeTimePurchaseMs)
          scheduleArcadeTimePersistence(currentSession.arcadeTimeMs || 0, { immediate: true })
        }

        if (Number.isFinite(nextBalance)) {
          currentSession.lastKnownBalance = nextBalance
          noteArcadeBalancePush(nextBalance)
          broadcastArcadeLifeState('balance_sync', { balance: nextBalance })
        }

        if (getArcadeTimeoutPauseConfirmed() && (currentSession.arcadeTimeMs || 0) > 0) {
          resetArcadeTimeoutPauseState()
        }

        broadcastArcadeLifeState('time_added', {
          arcadeTimeMs: currentSession.arcadeTimeMs || 0,
          balance: currentSession.lastKnownBalance,
        })
        showArcadeOsdMessage(composeArcadeOsdOverlay(''), { bypassCooldown: true })

        if (!getArcadeSession() || getArcadeSession() !== sessionRef) {
          logger.warn('[BUY CREDIT] session changed mid-flight')
          return
        }

        logger.log('[BUY CREDIT] success')
        setLastBuyAt(Date.now())
        setArcadeOverlayNotice('TIME ADDED', 1500, 'center')
      } catch (err: any) {
        logger.error('[BUY CREDIT] failed', err?.message || err)
        setArcadeOverlayNotice(
          err?.message === 'missing_game_id' ? 'ERROR' : 'BUY FAILED',
          1500,
          'center',
        )
      } finally {
        setBuyState('idle')
      }
    }
  }

  return {
    rpcBuyArcadeCredit,
    handleBuyPressed,
  }
}
