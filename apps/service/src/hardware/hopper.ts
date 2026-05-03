import type { GpioController } from './gpio.js'

export interface HopperSnapshot {
  active: boolean
  target: number
  dispensed: number
  lastPulseAt: number
  activeWithdrawalContext: {
    requestId: string
    requestedAmount: number
    dispensedTotal: number
    startedAt: number
  } | null
}

export interface HopperController {
  startHopper(amount: number, now?: number): boolean
  handleWithdrawPulse(now?: number): boolean
  stopHopper(): HopperStopResult | null
  getSnapshot(): HopperSnapshot
}

export interface HopperStopResult {
  dispensed: number
  requested: number
  aborted: boolean
}

export interface HopperControllerOptions {
  isPi: boolean
  shuttingDown: () => boolean
  payPin: number
  timeoutMs: number
  noPulseTimeoutMs: number
  hardMaxMs?: number
  gpio: GpioController
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  onDispense?: (amount: number) => void
  onComplete?: (result: HopperStopResult) => void
  onCompatComplete?: (dispensed: number) => void
  logger?: Pick<typeof console, 'log' | 'error'>
}

export function createHopperController(options: HopperControllerOptions): HopperController {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const hardMaxMs = options.hardMaxMs ?? 90_000

  let hopperActive = false
  let hopperTarget = 0
  let hopperDispensed = 0
  let hopperTimeout: NodeJS.Timeout | null = null
  let hopperNoPulseTimeout: NodeJS.Timeout | null = null
  let hopperLastPulseAt = 0
  let activeWithdrawalContext: HopperSnapshot['activeWithdrawalContext'] = null

  const clearTimers = () => {
    if (hopperTimeout) {
      clearTimeoutFn(hopperTimeout)
      hopperTimeout = null
    }
    if (hopperNoPulseTimeout) {
      clearTimeoutFn(hopperNoPulseTimeout)
      hopperNoPulseTimeout = null
    }
  }

  const armNoPulseTimeout = () => {
    if (hopperNoPulseTimeout) clearTimeoutFn(hopperNoPulseTimeout)
    hopperNoPulseTimeout = setTimeoutFn(() => {
      if (!hopperActive) return
      const elapsed = Date.now() - hopperLastPulseAt
      options.logger?.error?.(`[HOPPER] NO PULSE ${elapsed}ms — FORCED STOP`)
      stopHopper()
    }, options.noPulseTimeoutMs)
  }

  const stopHopper = (): HopperStopResult | null => {
    if (!hopperActive) return null

    options.gpio.gpioOff(options.payPin)
    hopperActive = false
    options.gpio.setCoinInhibit(false)
    clearTimers()
    hopperLastPulseAt = 0

    options.logger?.log?.('[HOPPER] STOP dispensed=', hopperDispensed)

    const result = {
      dispensed: hopperDispensed,
      requested: hopperTarget,
      aborted: hopperDispensed < hopperTarget,
    }

    activeWithdrawalContext = null
    options.onComplete?.(result)
    return result
  }

  return {
    startHopper(amount, now = Date.now()) {
      if (options.shuttingDown() || hopperActive || amount <= 0) return false

      options.gpio.setCoinInhibit(true)
      activeWithdrawalContext = {
        requestId: `withdraw-${now}`,
        requestedAmount: amount,
        dispensedTotal: 0,
        startedAt: now,
      }

      if (!options.isPi) {
        options.logger?.log?.('[HOPPER] compat-mode simulated payout target=', amount)
        const totalPulses = Math.max(0, Math.ceil(amount / 20))
        let emitted = 0

        const tick = () => {
          if (emitted >= totalPulses) {
            const dispensed = emitted * 20
            options.onCompatComplete?.(dispensed)
            options.onComplete?.({
              dispensed,
              requested: amount,
              aborted: false,
            })
            activeWithdrawalContext = null
            return
          }

          emitted += 1
          if (activeWithdrawalContext) {
            activeWithdrawalContext.dispensedTotal = emitted * 20
          }
          options.onDispense?.(20)
          setTimeoutFn(tick, 120)
        }

        tick()
        return true
      }

      hopperActive = true
      hopperTarget = amount
      hopperDispensed = 0
      hopperLastPulseAt = now

      options.logger?.log?.('[HOPPER] START target=', amount)
      options.gpio.gpioOn(options.payPin)
      armNoPulseTimeout()

      const estimated = (amount / 20) * 1200
      const buffer = 3000
      const minRuntime = 5000
      const runtime = Math.max(estimated + buffer, minRuntime)

      hopperTimeout = setTimeoutFn(() => {
        options.logger?.error?.('[HOPPER] TIMEOUT — FORCED STOP')
        stopHopper()
      }, Math.min(runtime, options.timeoutMs, hardMaxMs))

      return true
    },
    handleWithdrawPulse(now = Date.now()) {
      if (!hopperActive) return false

      hopperLastPulseAt = now
      armNoPulseTimeout()
      hopperDispensed += 20
      if (activeWithdrawalContext) {
        activeWithdrawalContext.dispensedTotal = hopperDispensed
      }

      options.logger?.log?.(`[HOPPER] DISPENSED ${hopperDispensed}/${hopperTarget}`)
      options.onDispense?.(20)
      if (hopperDispensed >= hopperTarget) {
        stopHopper()
      }

      return true
    },
    stopHopper,
    getSnapshot() {
      return {
        active: hopperActive,
        target: hopperTarget,
        dispensed: hopperDispensed,
        lastPulseAt: hopperLastPulseAt,
        activeWithdrawalContext,
      }
    },
  }
}
