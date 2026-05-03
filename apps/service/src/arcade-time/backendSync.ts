export function createArcadeTimeBackendSync(options: any) {
  const {
    logger = console,
    deviceId,
    supabaseUrl,
    arcadeLifeBalanceSyncIntervalMs,
    hasSupabaseRpcConfig,
    getSupabaseHeaders,
    requestJsonWithCurl,
    safeRpcCall,
    toMoney,
    getArcadeSession,
    getArcadeTimePersistRequestedMs,
    setArcadeTimePersistRequestedMs,
    getArcadeTimePersistCommittedMs,
    setArcadeTimePersistCommittedMs,
    getArcadeTimePersistInFlight,
    setArcadeTimePersistInFlight,
    getArcadeTimePersistTimer,
    setArcadeTimePersistTimer,
    clearArcadeTimePersistTimer,
    getArcadeBalanceSyncTimer,
    setArcadeBalanceSyncTimer,
    getArcadeBalanceSyncInFlight,
    setArcadeBalanceSyncInFlight,
    shouldDeferArcadeBalanceSync,
    getArcadeBalancePushFloor,
    clearArcadeBalancePushFloor,
    broadcastArcadeLifeState,
    refreshArcadeOsdMessage,
  } = options

  async function fetchDeviceBalanceSnapshot() {
    if (!hasSupabaseRpcConfig()) return null

    const url =
      `${supabaseUrl}/rest/v1/devices?` +
      `select=balance&device_id=eq.${encodeURIComponent(deviceId)}&limit=1`

    const response = await requestJsonWithCurl(url, {
      method: 'GET',
      headers: getSupabaseHeaders(),
      timeoutMs: 2500,
    })
    if (!response.ok) {
      throw new Error(`balance fetch failed (${response.status})`)
    }

    const rows = response.json()
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) return null
    if (row.balance === null || row.balance === undefined) return null
    return toMoney(row.balance, 0)
  }

  async function persistDeviceArcadeTimeSnapshot(timeMs: any) {
    if (!hasSupabaseRpcConfig()) return { ok: true, skipped: true }

    const safeTimeMs = Math.max(0, Math.floor(Number(timeMs || 0)))
    const url = `${supabaseUrl}/rest/v1/devices?` + `device_id=eq.${encodeURIComponent(deviceId)}`

    const response = await requestJsonWithCurl(url, {
      method: 'PATCH',
      headers: {
        ...getSupabaseHeaders(),
        Prefer: 'return=representation',
      },
      timeoutMs: 3500,
      body: {
        arcade_time_ms: safeTimeMs,
      },
    })

    if (!response.ok) {
      throw new Error(`arcade time persist failed (${response.status})`)
    }

    return { ok: true, timeMs: safeTimeMs, data: response.json() }
  }

  async function flushArcadeTimePersistence(options: any = {}) {
    const arcadeSession = getArcadeSession()
    const force = options?.force === true
    const targetTimeMs = Math.max(
      0,
      Math.floor(
        Number(
          options?.timeMs ??
            getArcadeTimePersistRequestedMs() ??
            arcadeSession?.arcadeTimeMs ??
            0,
        ),
      ),
    )

    if (!force && targetTimeMs === getArcadeTimePersistCommittedMs()) return
    if (getArcadeTimePersistInFlight()) return

    setArcadeTimePersistInFlight(true)
    try {
      await safeRpcCall((body: any) => persistDeviceArcadeTimeSnapshot(body.arcade_time_ms), {
        arcade_time_ms: targetTimeMs,
      })
      setArcadeTimePersistCommittedMs(targetTimeMs)
    } catch (error: any) {
      logger.error('[ARCADE TIME] persist failed', error?.message || error)
    } finally {
      setArcadeTimePersistInFlight(false)
      if (
        getArcadeTimePersistRequestedMs() !== null &&
        getArcadeTimePersistRequestedMs() !== targetTimeMs
      ) {
        void flushArcadeTimePersistence()
      }
    }
  }

  function scheduleArcadeTimePersistence(timeMs: any, options: any = {}) {
    const immediate = options?.immediate === true
    setArcadeTimePersistRequestedMs(Math.max(0, Math.floor(Number(timeMs || 0))))

    if (immediate) {
      clearArcadeTimePersistTimer()
      void flushArcadeTimePersistence()
      return
    }

    if (getArcadeTimePersistTimer() !== null) return
    const timer = setTimeout(() => {
      setArcadeTimePersistTimer(null)
      void flushArcadeTimePersistence()
    }, 1000)
    setArcadeTimePersistTimer(timer)
  }

  function clearArcadeBalanceSyncLoop() {
    const timer = getArcadeBalanceSyncTimer()
    if (timer !== null) {
      clearTimeout(timer)
      setArcadeBalanceSyncTimer(null)
    }
  }

  async function syncArcadeSessionBalance(options: any = {}) {
    const arcadeSession = getArcadeSession()
    if (!arcadeSession?.active) return
    if (!hasSupabaseRpcConfig()) return
    if (getArcadeBalanceSyncInFlight()) return

    const forceBroadcast = options?.forceBroadcast === true
    setArcadeBalanceSyncInFlight(true)
    try {
      const latestBalance = await fetchDeviceBalanceSnapshot()
      const currentSession = getArcadeSession()
      if (!currentSession?.active) return
      if (latestBalance === null || latestBalance === undefined) return
      if (shouldDeferArcadeBalanceSync(latestBalance)) {
        logger.log('[ARCADE LIFE BALANCE] deferred stale sync', {
          current: currentSession.lastKnownBalance,
          next: latestBalance,
          floor: getArcadeBalancePushFloor(),
        })
        return
      }

      const previous = currentSession.lastKnownBalance
      const now = Date.now()
      const lastMutation = currentSession?.lastBalanceMutationAt || 0

      if (previous !== null && latestBalance < previous && now - lastMutation < 2000) {
        logger.log('[ARCADE LIFE BALANCE] ignored stale regression', {
          previous,
          next: latestBalance,
        })
        return
      }

      currentSession.lastKnownBalance = latestBalance

      if (Number.isFinite(getArcadeBalancePushFloor()) && latestBalance >= getArcadeBalancePushFloor()) {
        clearArcadeBalancePushFloor()
      }

      if (forceBroadcast || previous !== latestBalance) {
        logger.log('[ARCADE LIFE BALANCE] applied', { previous, next: latestBalance })
        broadcastArcadeLifeState('balance_sync', { balance: latestBalance })
        refreshArcadeOsdMessage()
      }
    } catch {
      // Keep loop alive; transient Supabase/network failures are expected.
    } finally {
      setArcadeBalanceSyncInFlight(false)
    }
  }

  function scheduleArcadeBalanceSyncLoop() {
    clearArcadeBalanceSyncLoop()
    if (!hasSupabaseRpcConfig()) return

    const tick = async () => {
      const arcadeSession = getArcadeSession()
      if (!arcadeSession?.active) {
        clearArcadeBalanceSyncLoop()
        return
      }

      await syncArcadeSessionBalance()
      setArcadeBalanceSyncTimer(setTimeout(tick, arcadeLifeBalanceSyncIntervalMs))
    }

    tick()
  }

  return {
    fetchDeviceBalanceSnapshot,
    persistDeviceArcadeTimeSnapshot,
    flushArcadeTimePersistence,
    scheduleArcadeTimePersistence,
    clearArcadeBalanceSyncLoop,
    syncArcadeSessionBalance,
    scheduleArcadeBalanceSyncLoop,
  }
}
