export interface RuntimeFlags {
  retroarchActive: boolean
  shuttingDown: boolean
}

export interface RuntimeStateStore {
  getFlags(): RuntimeFlags
  setRetroarchActive(active: boolean): void
  setShuttingDown(shuttingDown: boolean): void
}

export function createRuntimeStateStore(initial?: Partial<RuntimeFlags>): RuntimeStateStore {
  const flags: RuntimeFlags = {
    retroarchActive: initial?.retroarchActive ?? false,
    shuttingDown: initial?.shuttingDown ?? false,
  }

  return {
    getFlags() {
      return { ...flags }
    },
    setRetroarchActive(active) {
      flags.retroarchActive = active
    },
    setShuttingDown(shuttingDown) {
      flags.shuttingDown = shuttingDown
    },
  }
}
