import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface GpioController {
  gpioOn(pin: number): void
  gpioOff(pin: number): void
  setCoinInhibit(disabled: boolean): void
  cleanup(): void
  getSnapshot(): {
    lastCoinState: boolean | null
  }
}

export interface GpioControllerOptions {
  isPi: boolean
  gpioChip: string
  coinInhibitPin: number
  logger?: Pick<typeof console, 'log'>
}

export function createGpioController(options: GpioControllerOptions): GpioController {
  let hopperCtl: ChildProcessWithoutNullStreams | null = null
  let coinCtl: ChildProcessWithoutNullStreams | null = null
  let lastCoinState: boolean | null = null

  function stopProc(proc: ChildProcessWithoutNullStreams | null) {
    if (!proc) return null
    proc.kill('SIGTERM')
    return null
  }

  return {
    gpioOn(pin) {
      if (!options.isPi) return
      hopperCtl = stopProc(hopperCtl)
      hopperCtl = spawn('gpioset', [options.gpioChip, `${pin}=0`])
    },
    gpioOff(pin) {
      if (!options.isPi) return
      hopperCtl = stopProc(hopperCtl)
      hopperCtl = spawn('gpioset', [options.gpioChip, `${pin}=1`])
    },
    setCoinInhibit(disabled) {
      if (!options.isPi) return
      if (lastCoinState === disabled) return

      coinCtl = stopProc(coinCtl)
      const value = disabled ? 0 : 1
      coinCtl = spawn('gpioset', [options.gpioChip, `${options.coinInhibitPin}=${value}`])
      lastCoinState = disabled
      options.logger?.log?.(`[COIN] ${disabled ? 'REJECT' : 'ACCEPT'}`)
    },
    cleanup() {
      hopperCtl = stopProc(hopperCtl)
      coinCtl = stopProc(coinCtl)
    },
    getSnapshot() {
      return {
        lastCoinState,
      }
    },
  }
}
