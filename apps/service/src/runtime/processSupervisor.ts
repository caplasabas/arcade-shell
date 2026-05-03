export interface ProcessHandle {
  pid?: number
  stop(signal?: NodeJS.Signals): void
}

export interface ProcessSupervisor {
  register(handle: ProcessHandle): void
  clear(): void
  stopActive(signal?: NodeJS.Signals): void
  hasActiveProcess(): boolean
  getActivePid(): number | null
}

export function createProcessSupervisor(): ProcessSupervisor {
  let activeHandle: ProcessHandle | null = null

  return {
    register(handle) {
      activeHandle = handle
    },
    clear() {
      activeHandle = null
    },
    stopActive(signal = 'SIGTERM') {
      activeHandle?.stop(signal)
      activeHandle = null
    },
    hasActiveProcess() {
      return activeHandle !== null
    },
    getActivePid() {
      return activeHandle?.pid ?? null
    },
  }
}
