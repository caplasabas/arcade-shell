export function formatArcadeTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function getArcadeSessionPrice(
  arcadeSession: any,
  defaultPrice: number,
  toMoney: (value: unknown, fallback?: number) => number,
) {
  if (!arcadeSession?.active) return defaultPrice
  return toMoney(arcadeSession.pricePerLife, defaultPrice)
}

export function isArcadeTimeLockActive(
  arcadeSession: any,
  arcadeTimeoutPauseConfirmed: boolean,
) {
  if (!arcadeSession?.active) return false
  if (Number(arcadeSession.arcadeTimeMs || 0) > 0) return false
  return arcadeTimeoutPauseConfirmed
}

export function noteArcadeBalancePush(
  nextBalance: unknown,
  toMoney: (value: unknown, fallback?: number) => number,
) {
  if (!Number.isFinite(nextBalance)) {
    return null
  }

  return {
    floor: toMoney(nextBalance, 0),
    until: Date.now() + 8000,
  }
}

export function shouldDeferArcadeBalanceSync(
  nextBalance: unknown,
  arcadeBalancePushFloor: number | null,
  arcadeBalancePushFloorUntil: number,
) {
  if (!Number.isFinite(nextBalance)) {
    return { defer: false, expired: false }
  }

  if (!Number.isFinite(arcadeBalancePushFloor)) {
    return { defer: false, expired: false }
  }

  if (Date.now() > arcadeBalancePushFloorUntil) {
    return { defer: false, expired: true }
  }

  return { defer: Number(nextBalance) < Number(arcadeBalancePushFloor), expired: false }
}

export function resetArcadeTimeoutPauseState() {
  return {
    applied: false,
    confirmed: false,
    pending: false,
  }
}
