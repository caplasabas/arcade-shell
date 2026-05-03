export interface CoinPulseSnapshot {
  pulseCount: number
  lastPulseTime: number
  startTime: number
}

export interface CoinStateStore {
  beginPulse(now?: number): CoinPulseSnapshot
  incrementPulse(now?: number): CoinPulseSnapshot
  reset(): CoinPulseSnapshot
  getSnapshot(): CoinPulseSnapshot
}

export function createCoinStateStore(): CoinStateStore {
  const snapshot: CoinPulseSnapshot = {
    pulseCount: 0,
    lastPulseTime: 0,
    startTime: 0,
  }

  return {
    beginPulse(now = Date.now()) {
      snapshot.pulseCount = 1
      snapshot.lastPulseTime = now
      snapshot.startTime = now
      return { ...snapshot }
    },
    incrementPulse(now = Date.now()) {
      if (snapshot.pulseCount === 0) {
        snapshot.startTime = now
      }

      snapshot.pulseCount += 1
      snapshot.lastPulseTime = now
      return { ...snapshot }
    },
    reset() {
      snapshot.pulseCount = 0
      snapshot.lastPulseTime = 0
      snapshot.startTime = 0
      return { ...snapshot }
    },
    getSnapshot() {
      return { ...snapshot }
    },
  }
}
