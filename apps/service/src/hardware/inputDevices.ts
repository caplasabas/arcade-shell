import type fs from 'node:fs'

export interface InputLinkState {
  casino: number | null
  player1: number | null
  player2: number | null
  missing: {
    casino: boolean
    player1: boolean
    player2: boolean
  }
  waiting: string[]
  healthy: boolean
}

export interface InputDeviceManager {
  logInputLinks(reason?: string): void
  getInputLinkState(): InputLinkState
  startEventDevice(path: string, label: string): void
}

interface InputDeviceState {
  path: string
  label: string
  fd: number | null
  retryTimer: NodeJS.Timeout | null
  opening: boolean
  generation: number
  realPath: string | null
}

export interface InputDeviceManagerOptions {
  isPi: boolean
  fsModule: typeof fs
  retryMissingMs: number
  retryErrorMs: number
  retryEnodevMs: number
  devicePaths: {
    casino: string
    player1: string
    player2: string
  }
  onRawEvent: (label: string, type: number, code: number, value: number) => void
  logger?: Pick<typeof console, 'log' | 'error'>
}

export function createInputDeviceManager(options: InputDeviceManagerOptions): InputDeviceManager {
  const waitingInputDevices = new Set<string>()
  const inputDeviceStates = new Map<string, InputDeviceState>()

  const getJsIndexFromSymlink = (devicePath: string) => {
    try {
      const target = options.fsModule.readlinkSync(devicePath)
      const match = target.match(/(\d+)$/)
      return match ? Number(match[1]) : null
    } catch {
      return null
    }
  }

  const describeInputPath = (devicePath: string) => {
    try {
      const realPath = options.fsModule.realpathSync(devicePath)
      return {
        path: devicePath,
        exists: true,
        realPath,
      }
    } catch (error: any) {
      return {
        path: devicePath,
        exists: options.fsModule.existsSync(devicePath),
        realPath: null,
        error: error?.message || String(error || 'unknown error'),
      }
    }
  }

  const getInputDeviceState = (path: string, label: string) => {
    let state = inputDeviceStates.get(path)
    if (state) return state

    state = {
      path,
      label,
      fd: null,
      retryTimer: null,
      opening: false,
      generation: 0,
      realPath: null,
    }
    inputDeviceStates.set(path, state)
    return state
  }

  const clearInputDeviceRetry = (state?: InputDeviceState | null) => {
    if (state?.retryTimer) {
      clearTimeout(state.retryTimer)
      state.retryTimer = null
    }
  }

  const closeInputDeviceFd = (state?: InputDeviceState | null) => {
    if (!state || state.fd === null) return
    const fd = state.fd
    state.fd = null
    options.fsModule.close(fd, () => {})
  }

  const scheduleInputDeviceRestart = (state: InputDeviceState, reason: string, delay: number) => {
    closeInputDeviceFd(state)
    state.opening = false

    if (state.retryTimer) return

    state.retryTimer = setTimeout(() => {
      state.retryTimer = null
      startEventDevice(state.path, state.label)
    }, delay)

    options.logger?.log?.(`[${state.label}] restart scheduled`, { reason, delay })
  }

  const logInputLinks = (reason = 'snapshot') => {
    options.logger?.log?.('[INPUT LINK]', {
      reason,
      casino: getJsIndexFromSymlink(options.devicePaths.casino),
      player1: getJsIndexFromSymlink(options.devicePaths.player1),
      player2: getJsIndexFromSymlink(options.devicePaths.player2),
    })
  }

  const getInputLinkState = (): InputLinkState => {
    const casino = getJsIndexFromSymlink(options.devicePaths.casino)
    const player1 = getJsIndexFromSymlink(options.devicePaths.player1)
    const player2 = getJsIndexFromSymlink(options.devicePaths.player2)

    return {
      casino,
      player1,
      player2,
      missing: {
        casino: casino === null,
        player1: player1 === null,
        player2: player2 === null,
      },
      waiting: Array.from(waitingInputDevices.values()),
      healthy: casino !== null && player1 !== null && player2 !== null,
    }
  }

  const startEventDevice = (path: string, label: string) => {
    if (!options.isPi) {
      options.logger?.log?.(`[${label}] compat-mode skipping ${path}`)
      return
    }

    const state = getInputDeviceState(path, label)
    clearInputDeviceRetry(state)

    if (state.fd !== null || state.opening) return

    if (!options.fsModule.existsSync(path)) {
      if (!waitingInputDevices.has(path)) {
        waitingInputDevices.add(path)
        options.logger?.log?.(`[WAIT] ${label} waiting for ${path}`)
        logInputLinks(`${label.toLowerCase()}-waiting`)
      }
      scheduleInputDeviceRestart(state, 'missing', options.retryMissingMs)
      return
    }

    if (waitingInputDevices.delete(path)) {
      options.logger?.log?.(`[READY] ${label} detected`, describeInputPath(path))
      logInputLinks(`${label.toLowerCase()}-ready`)
    }

    const openDetail = describeInputPath(path)
    options.logger?.log?.(`[${label}] Opening`, openDetail)
    state.opening = true
    const generation = ++state.generation

    options.fsModule.open(path, 'r', (err, fd) => {
      if (generation !== state.generation) {
        state.opening = false
        if (!err && Number.isInteger(fd)) options.fsModule.close(fd, () => {})
        return
      }

      if (err) {
        state.opening = false
        options.logger?.error?.(`[${label}] open error`, {
          path,
          detail: describeInputPath(path),
          error: (err as any)?.message || err,
        })
        scheduleInputDeviceRestart(state, 'open-error', options.retryErrorMs)
        return
      }

      state.opening = false
      state.fd = fd
      state.realPath = openDetail.realPath || null

      const buffer = Buffer.alloc(24)

      const readLoop = () => {
        options.fsModule.read(fd, buffer, 0, 24, null, (readErr, bytesRead) => {
          if (generation !== state.generation || state.fd !== fd) {
            options.fsModule.close(fd, () => {})
            return
          }

          if (readErr || bytesRead !== 24) {
            const errorMessage = (readErr as any)?.message || readErr || null
            const retryDelay =
              typeof errorMessage === 'string' && errorMessage.includes('ENODEV')
                ? options.retryEnodevMs
                : options.retryErrorMs

            options.logger?.error?.(`[${label}] read error`, {
              path,
              bytesRead,
              detail: describeInputPath(path),
              error: errorMessage,
            })
            logInputLinks(`${label.toLowerCase()}-read-error`)
            closeInputDeviceFd(state)
            scheduleInputDeviceRestart(state, 'read-error', retryDelay)
            return
          }

          const type = buffer.readUInt16LE(16)
          const code = buffer.readUInt16LE(18)
          const value = buffer.readInt32LE(20)

          options.onRawEvent(label, type, code, value)
          readLoop()
        })
      }

      readLoop()
    })
  }

  return {
    logInputLinks,
    getInputLinkState,
    startEventDevice,
  }
}
