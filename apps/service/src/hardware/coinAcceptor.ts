export interface CoinAcceptorSnapshot {
  pulseCount: number
  lastPulseTime: number
  startTime: number
}

export interface DepositResult {
  pulses: number
  durationMs: number
  credits: number
}

export interface CoinAcceptor {
  handleDepositPulse(now?: number): void
  finalizeDepositCoin(now?: number): DepositResult | null
  resolveDepositCredits(pulses: number): number
  resetDepositCoin(): void
  getSnapshot(): CoinAcceptorSnapshot
}

export interface CoinAcceptorOptions {
  idleGapMs: number
  pesoByPulseCount: Record<number, number>
  setIdleTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout
  clearIdleTimer: (timer: NodeJS.Timeout) => void
  onPulse?: (snapshot: CoinAcceptorSnapshot & { gapMs: number }) => void
  onDepositResolved?: (result: DepositResult) => void
}

export function createCoinAcceptor(options: CoinAcceptorOptions): CoinAcceptor {
  let depositPulseCount = 0
  let depositIdleTimer: NodeJS.Timeout | null = null
  let depositLastPulseTime = 0
  let depositStartTime = 0

  const resetDepositCoin = () => {
    if (depositIdleTimer) {
      options.clearIdleTimer(depositIdleTimer)
      depositIdleTimer = null
    }
    depositPulseCount = 0
    depositLastPulseTime = 0
    depositStartTime = 0
  }

  const resolveDepositCredits = (pulses: number) => {
    const normalizedPulses = Number(pulses || 0)
    if (normalizedPulses <= 0) return 0

    const mappedCredits = options.pesoByPulseCount[normalizedPulses]
    if (Number.isFinite(mappedCredits)) return mappedCredits
    return normalizedPulses * 5
  }

  const finalizeDepositCoin = (now = Date.now()) => {
    const pulses = depositPulseCount
    const durationMs = depositStartTime ? now - depositStartTime : 0

    resetDepositCoin()
    if (pulses <= 0) return null

    const result = {
      pulses,
      durationMs,
      credits: resolveDepositCredits(pulses),
    }

    if (result.credits > 0) {
      options.onDepositResolved?.(result)
    }

    return result
  }

  return {
    handleDepositPulse(now = Date.now()) {
      if (depositPulseCount === 0) {
        depositStartTime = now
      }

      const gapMs = depositLastPulseTime ? now - depositLastPulseTime : 0
      depositLastPulseTime = now
      depositPulseCount += 1

      options.onPulse?.({
        pulseCount: depositPulseCount,
        lastPulseTime: depositLastPulseTime,
        startTime: depositStartTime,
        gapMs,
      })

      if (depositIdleTimer) {
        options.clearIdleTimer(depositIdleTimer)
      }

      depositIdleTimer = options.setIdleTimer(() => {
        finalizeDepositCoin()
      }, options.idleGapMs)
    },
    finalizeDepositCoin,
    resolveDepositCredits,
    resetDepositCoin,
    getSnapshot() {
      return {
        pulseCount: depositPulseCount,
        lastPulseTime: depositLastPulseTime,
        startTime: depositStartTime,
      }
    },
  }
}
