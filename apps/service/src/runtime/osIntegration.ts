import { spawn } from 'node:child_process'

export interface OsIntegration {
  start(): Promise<void>
  stop(): Promise<void>
  scheduleSystemPowerAction(action: 'restart' | 'poweroff'): void
  scheduleManagedServiceRestart(serviceName: string, delayMs?: number): void
}

export function createOsIntegration(isPi = false): OsIntegration {
  return {
    async start() {
      console.log('[OS] integration scaffold start')
    },
    async stop() {
      console.log('[OS] integration scaffold stop')
    },
    scheduleSystemPowerAction(action) {
      const command = action === 'restart' ? 'reboot' : 'poweroff'
      setTimeout(() => {
        if (!isPi) {
          console.log(`[SYSTEM] ${command} simulated (compat mode)`)
          return
        }

        const proc = spawn('systemctl', [command], {
          stdio: 'ignore',
          detached: true,
        })
        proc.unref()
      }, 400)
    },
    scheduleManagedServiceRestart(serviceName, delayMs = 400) {
      const safeServiceName = String(serviceName || '').trim()
      if (!safeServiceName) return

      setTimeout(() => {
        if (!isPi) {
          console.log(`[SYSTEM] restart simulated for ${safeServiceName} (compat mode)`)
          return
        }

        const restartCommand = `sleep 0.5; systemctl restart ${safeServiceName}`
        const proc = spawn('sh', ['-lc', restartCommand], {
          stdio: 'ignore',
          detached: true,
        })
        proc.unref()
      }, delayMs)
    },
  }
}
