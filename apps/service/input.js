/**
 * Arcade Input Service (Raspberry Pi)
 * ----------------------------------
 * - USB arcade encoder (joystick)
 * - Coin acceptor (pulse-based)
 * - Coin hopper (12V via relay + hopper coin slot feedback)
 *
 * GPIO handled via libgpiod CLI (gpioset / gpiomon)
 */

import http from 'http'
import { WebSocketServer } from 'ws'
import { exec, spawn, spawnSync } from 'child_process'
import { createDecipheriv, createHash } from 'crypto'
import os from 'os'

import fs from 'fs'

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const ROMS_ROOT = path.join(PROJECT_ROOT, 'roms')

const DIST_DIR = path.join(__dirname, '../ui/dist')
const DEFAULT_RUNTIME_DIR =
  process.platform === 'linux' ? '/dev/shm/arcade-games' : path.join(os.tmpdir(), 'arcade-games')

const RUNTIME_GAMES_DIR = process.env.ARCADE_RUNTIME_GAMES_DIR || DEFAULT_RUNTIME_DIR
const IS_LINUX = process.platform === 'linux'
const FORCE_PI_MODE = process.env.ARCADE_FORCE_PI === '1'
const PI_MODEL_PATH = '/sys/firmware/devicetree/base/model'
const IS_PI =
  FORCE_PI_MODE ||
  (IS_LINUX &&
    fs.existsSync(PI_MODEL_PATH) &&
    (() => {
      try {
        return fs.readFileSync(PI_MODEL_PATH, 'utf8').includes('Raspberry Pi')
      } catch {
        return false
      }
    })())
// ============================
// CONFIG
// ============================

const GPIOCHIP = 'gpiochip0'
const HOPPER_PAY_PIN = 17

const HOPPER_TIMEOUT_MS = 60000
const HOPPER_NO_PULSE_TIMEOUT_MS = 3000
const INTERNET_PROBE_TIMEOUT_SEC = 2
const INTERNET_MONITOR_INTERVAL_MS = 2000
const INTERNET_FAIL_THRESHOLD = 2
const INTERNET_RESTORE_THRESHOLD = 2

const JOYSTICK_BUTTON_MAP = {
  0: 'SPIN',
  1: 'BET_DOWN',
  2: 'BET_UP',
  3: 'AUTO',
  4: 'COIN', // deposit coin pulses
  5: 'WITHDRAW', // UI request
  6: 'WITHDRAW_COIN', // hopper coin slot pulses
  7: 'TURBO',
  8: 'BUY',
  9: 'MENU',
  10: 'AUDIO',
  11: 'HOPPER_COIN',
}

const RAW_BUTTON_MAP = {
  288: 0,
  289: 1,
  290: 2,
  291: 3,
  292: 4,
  293: 5,
  294: 6,
  295: 7,
  296: 8,
  297: 9,
  298: 10,
  299: 11,
}

const HOPPER_TOPUP_COIN_VALUE = 20

// Coin timing (measured FAST mode)
const COIN_IDLE_GAP_MS = 130
const COIN_BATCH_GAP_MS = 180

// ============================
// STATE
// ============================

let shuttingDown = false
let joystick = null
let player1 = null
let player2 = null

// -------- Deposit coins --------
let depositPulseCount = 0
let depositIdleTimer = null
let depositBatchCredits = 0
let depositBatchTimer = null
let depositLastPulseTime = 0
let depositStartTime = 0

// -------- Hopper / withdrawal --------
let hopperActive = false
let hopperTarget = 0
let hopperDispensed = 0
let hopperTimeout = null
let hopperGpioProcess = null
let hopperNoPulseTimeout = null
let hopperLastPulseAt = 0

let serverInstance = null

let virtualP1 = null
let virtualP2 = null
const VIRTUAL_DEVICE_STAGGER_MS = 350

let retroarchActive = false
let retroarchProcess = null
let retroarchStopping = false
let lastExitTime = 0
let retroarchStartedAt = 0
let retroarchLogFd = null

const GAME_VT = process.env.ARCADE_GAME_VT || '1'
const UI_VT = process.env.ARCADE_UI_VT || '2'
const RETROARCH_STOP_GRACE_MS = 3000
const RETROARCH_LOG_PATH = '/tmp/retroarch.log'
const RETROARCH_TERM_FALLBACK_MS = 1200
const RETROARCH_USE_TTY_MODE = process.env.RETROARCH_TTY_MODE === '1'
const RETROARCH_PRIMARY_INPUT = String(process.env.RETROARCH_PRIMARY_INPUT || 'P1').toUpperCase()
const CASINO_MENU_EXITS_RETROARCH = process.env.CASINO_MENU_EXITS_RETROARCH !== '0'

function parseNonNegativeMs(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

const RETROARCH_EXIT_GUARD_MS = parseNonNegativeMs(process.env.RETROARCH_EXIT_GUARD_MS, 1500)
const RETROARCH_CONFIG_PATH = process.env.RETROARCH_CONFIG_PATH || ''
const RESTART_UI_ON_EXIT = process.env.ARCADE_RESTART_UI_ON_GAME_EXIT !== '0'
const UI_RESTART_COOLDOWN_MS = parseNonNegativeMs(process.env.ARCADE_UI_RESTART_COOLDOWN_MS, 4000)
const LIBRETRO_DIR_CANDIDATES = [
  process.env.RETROARCH_CORE_DIR,
  '/usr/lib/aarch64-linux-gnu/libretro',
  '/usr/lib/arm-linux-gnueabihf/libretro',
  '/usr/lib/libretro',
].filter(Boolean)
const PS1_CORE_ALIASES = String(
  process.env.PS1_CORE_PRIORITY || 'pcsx_rearmed,mednafen_psx,beetle_psx',
)
  .split(',')
  .map(v => v.trim().toLowerCase().replace(/-/g, '_'))
  .filter(Boolean)

let lastUiVT = UI_VT
let lastUiRestartAt = 0

function getActiveVT() {
  if (!RETROARCH_USE_TTY_MODE) return null
  if (!IS_PI) return null

  const result = spawnSync('fgconsole', [], { encoding: 'utf8' })
  if (result.status !== 0) return null

  const value = String(result.stdout || '').trim()
  return value || null
}

function getTargetUiVT() {
  return lastUiVT || UI_VT
}

// ============================
// BOOT
// ============================

console.log(`
ARCADE INPUT SERVICE
--------------------
USB Encoder : /dev/input/casino
GPIO Chip   : ${GPIOCHIP}
Runtime Mode: ${IS_PI ? 'Raspberry Pi (hardware)' : `compat (${process.platform})`}
VT Map      : ui=${UI_VT} game=${GAME_VT}
Retro P1 In : ${RETROARCH_PRIMARY_INPUT}
Casino Exit : ${CASINO_MENU_EXITS_RETROARCH ? 'enabled' : 'disabled'}
Exit Guard  : ${RETROARCH_EXIT_GUARD_MS}ms
RA Config   : ${RETROARCH_CONFIG_PATH || '(default)'}
UI Restart  : ${RESTART_UI_ON_EXIT ? 'enabled' : 'disabled'} (${UI_RESTART_COOLDOWN_MS}ms)

Ctrl+C to exit
`)

const wss = new WebSocketServer({ port: 5175 })

wss.on('error', err => {
  console.error('[WS SERVER ERROR]', err)
})

wss.on('listening', () => {
  console.log('[WS] listening on port 5175')
})

wss.on('connection', async ws => {
  console.log('[WS] client connected')

  const online = await checkInternetOnce()
  ws.send(
    JSON.stringify({
      type: online ? 'INTERNET_OK' : 'INTERNET_LOST',
    }),
  )

  ws.on('close', () => {
    console.log('[WS] client disconnected')
  })

  ws.on('error', err => {
    console.error('[WS CLIENT ERROR]', err.message)
  })
})

function broadcast(payload) {
  const data = JSON.stringify(payload)

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(data)
      } catch (err) {
        console.error('[WS SEND ERROR]', err.message)
      }
    }
  }
}

// ============================
// DISPATCH
// ============================

async function dispatch(payload) {
  if (shuttingDown) return

  try {
    console.log('[SEND]', payload)
    broadcast(payload)

    // await fetch(API, {
    //     method: 'POST',
    //     headers: {'Content-Type': 'application/json'},
    //     body: JSON.stringify(payload),
    // })
  } catch (err) {
    console.error('[DISPATCH ERROR]', err.message)
  }
}

// ============================
// DEPOSIT COIN HANDLING
// ============================

function handleDepositPulse() {
  const now = Date.now()

  if (depositPulseCount === 0) {
    depositStartTime = now
    console.log('\n[DEPOSIT] START')
  }

  const gap = depositLastPulseTime ? now - depositLastPulseTime : 0
  depositLastPulseTime = now
  depositPulseCount++

  dispatch({
    type: 'COIN',
    credits: 5,
  })

  console.log(`[DEPOSIT] PULSE #${depositPulseCount} (+${gap}ms)`)

  if (depositIdleTimer) clearTimeout(depositIdleTimer)
  depositIdleTimer = setTimeout(finalizeDepositCoin, COIN_IDLE_GAP_MS)
}

function finalizeDepositCoin() {
  const pulses = depositPulseCount
  const duration = Date.now() - depositStartTime

  resetDepositCoin()

  console.log(`[DEPOSIT] COIN pulses=${pulses} duration=${duration}ms`)

  depositBatchCredits += pulses

  if (depositBatchTimer) clearTimeout(depositBatchTimer)
  depositBatchTimer = setTimeout(flushDepositBatch, COIN_BATCH_GAP_MS)
}

function flushDepositBatch() {
  if (depositBatchCredits <= 0) return

  const finalCredits = depositBatchCredits * 5

  console.log(`[DEPOSIT] BATCH FINAL credits=${finalCredits}`)

  // dispatch({
  //   type: 'COIN',
  //   credits: finalCredits,
  // })

  depositBatchCredits = 0
  depositBatchTimer = null
}

function resetDepositCoin() {
  depositPulseCount = 0
  depositIdleTimer = null
  depositLastPulseTime = 0
  depositStartTime = 0
}

// ============================
// HOPPER CONTROL
// ============================

const HARD_MAX_MS = 90_000

function startHopper(amount) {
  if (shuttingDown || hopperActive || amount <= 0) return

  if (!IS_PI) {
    console.log('[HOPPER] compat-mode simulated payout target=', amount)
    const totalPulses = Math.max(0, Math.ceil(amount / 20))
    let emitted = 0

    const tick = () => {
      if (emitted >= totalPulses) {
        dispatch({
          type: 'WITHDRAW_COMPLETE',
          dispensed: emitted * 20,
        })
        return
      }
      emitted += 1
      dispatch({
        type: 'WITHDRAW_DISPENSE',
        dispensed: 20,
      })
      setTimeout(tick, 120)
    }

    tick()
    return
  }

  hopperActive = true
  hopperTarget = amount
  hopperDispensed = 0
  hopperLastPulseAt = Date.now()

  console.log('[HOPPER] START target=', amount)

  gpioOn(HOPPER_PAY_PIN)

  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout)
  }

  hopperNoPulseTimeout = setTimeout(() => {
    if (!hopperActive) return

    const elapsed = Date.now() - hopperLastPulseAt
    console.error(`[HOPPER] NO PULSE ${elapsed}ms — FORCED STOP`)
    stopHopper()
  }, HOPPER_NO_PULSE_TIMEOUT_MS)

  hopperTimeout = setTimeout(
    () => {
      console.error('[HOPPER] TIMEOUT — FORCED STOP')
      stopHopper()
    },
    Math.min((amount / 20) * 1200, HOPPER_TIMEOUT_MS, HARD_MAX_MS),
  )
}

function handleWithdrawPulse() {
  if (!hopperActive) return

  hopperLastPulseAt = Date.now()

  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout)
  }

  hopperNoPulseTimeout = setTimeout(() => {
    if (!hopperActive) return

    const elapsed = Date.now() - hopperLastPulseAt
    console.error(`[HOPPER] NO PULSE ${elapsed}ms — FORCED STOP`)
    stopHopper()
  }, HOPPER_NO_PULSE_TIMEOUT_MS)

  hopperDispensed += 20

  console.log(`[HOPPER] DISPENSED ${hopperDispensed}/${hopperTarget}`)

  dispatch({
    type: 'WITHDRAW_DISPENSE',
    dispensed: 20,
  })
  if (hopperDispensed >= hopperTarget) {
    stopHopper()
  }
}

function stopHopper() {
  if (!hopperActive) return
  //
  gpioOff(HOPPER_PAY_PIN)
  hopperActive = false

  if (hopperTimeout) {
    clearTimeout(hopperTimeout)
    hopperTimeout = null
  }
  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout)
    hopperNoPulseTimeout = null
  }
  hopperLastPulseAt = 0

  console.log('[HOPPER] STOP dispensed=', hopperDispensed)

  dispatch({
    type: 'WITHDRAW_COMPLETE',
    dispensed: hopperDispensed,
  })
}

// ============================
// GPIO HELPERS
// ============================

let hopperCtl = null

function gpioOn(pin) {
  if (!IS_PI) return

  if (hopperCtl) {
    hopperCtl.kill('SIGTERM')
    hopperCtl = null
  }

  hopperCtl = spawn('gpioset', [GPIOCHIP, `${pin}=0`])
}

function gpioOff(pin) {
  if (!IS_PI) return

  if (hopperCtl) {
    hopperCtl.kill('SIGTERM')
    hopperCtl = null
  }

  hopperCtl = spawn('gpioset', [GPIOCHIP, `${pin}=1`])
}

// ============================
// USB ENCODER
// ============================

// ---- Linux input constants ----
const EV_SYN = 0
const SYN_REPORT = 0
const EV_KEY = 1
const EV_ABS = 3

const BTN_SOUTH = 304
const BTN_EAST = 305
const BTN_NORTH = 307
const BTN_WEST = 308
const BTN_SELECT = 314
const BTN_START = 315

const BTN_TL = 310
const BTN_TR = 311
const BTN_TL2 = 312
const BTN_TR2 = 313

const BTN_DPAD_UP = 544
const BTN_DPAD_DOWN = 545
const BTN_DPAD_LEFT = 546
const BTN_DPAD_RIGHT = 547

const dpadState = {
  P1: { up: false, down: false, left: false, right: false },
  P2: { up: false, down: false, left: false, right: false },
}

function startVirtualDevice(name) {
  if (!IS_PI) {
    console.log(`[VIRTUAL] compat-mode skipping ${name}`)
    return null
  }

  const proc = spawn('uinput-helper', [name], {
    stdio: ['pipe', 'ignore', 'ignore'],
  })

  proc.on('spawn', () => {
    console.log(`[VIRTUAL] ${name} created (pid=${proc.pid})`)
  })

  proc.on('error', err => {
    console.error(`[VIRTUAL] ${name} failed`, err.message)
  })

  return proc
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function startVirtualDevices() {
  // Create in strict order to reduce race risk in /dev/input enumeration.
  virtualP1 = startVirtualDevice('Arcade Virtual P1')
  await sleep(VIRTUAL_DEVICE_STAGGER_MS)
  virtualP2 = startVirtualDevice('Arcade Virtual P2')

  console.log('[VIRTUAL] P1 then P2 initialized')
}

function mapIndexToKey(index) {
  switch (index) {
    case 0:
      return BTN_SOUTH
    case 1:
      return BTN_EAST
    case 2:
      return BTN_NORTH
    case 3:
      return BTN_WEST
    case 4:
      return BTN_TL
    case 5:
      return BTN_TR
    case 6:
      return BTN_SELECT
    case 7:
      return BTN_START
    default:
      return null
  }
}

function resolveRetroInputSource(source) {
  if (source === 'CASINO' && RETROARCH_PRIMARY_INPUT === 'CASINO') {
    return 'P1'
  }

  return source
}

function getRetroVirtualTarget(source) {
  const mapped = resolveRetroInputSource(source)
  if (mapped === 'P1') return virtualP1
  if (mapped === 'P2') return virtualP2
  return null
}

function canAcceptRetroarchStop() {
  if (!retroarchActive) return false
  if (!retroarchStartedAt) return true
  return Date.now() - retroarchStartedAt >= RETROARCH_EXIT_GUARD_MS
}

function sendVirtual(proc, type, code, value) {
  if (!proc || !proc.stdin.writable) return

  proc.stdin.write(`${type} ${code} ${value}\n`)
  proc.stdin.write(`${EV_SYN} ${SYN_REPORT} 0\n`)
}

function getJsIndexFromSymlink(path) {
  try {
    const target = fs.readlinkSync(path)
    const match = target.match(/(\d+)$/)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

const casinoIndex = getJsIndexFromSymlink('/dev/input/casino')
const p1Index = getJsIndexFromSymlink('/dev/input/player1')
const p2Index = getJsIndexFromSymlink('/dev/input/player2')

console.log('[INPUT LINK]', {
  casino: casinoIndex,
  player1: p1Index,
  player2: p2Index,
})

function startEventDevice(path, label) {
  if (!IS_PI) {
    console.log(`[${label}] compat-mode skipping ${path}`)
    return
  }

  if (!fs.existsSync(path)) {
    console.log(`[WAIT] ${path} not present`)
    return setTimeout(() => startEventDevice(path, label), 1000)
  }

  console.log(`[${label}] Opening ${path}`)

  fs.open(path, 'r', (err, fd) => {
    if (err) {
      console.error(`[${label}] open error`, err)
      return setTimeout(() => startEventDevice(path, label), 2000)
    }

    const buffer = Buffer.alloc(24)

    function readLoop() {
      fs.read(fd, buffer, 0, 24, null, (err, bytesRead) => {
        if (err || bytesRead !== 24) {
          console.error(`[${label}] read error`)
          fs.close(fd, () => {})
          return setTimeout(() => startEventDevice(path, label), 2000)
        }

        const type = buffer.readUInt16LE(16)
        const code = buffer.readUInt16LE(18)
        const value = buffer.readInt32LE(20)

        handleRawEvent(label, type, code, value)

        readLoop()
      })
    }

    readLoop()
  })
}

function handleRawEvent(source, type, code, value) {
  if (type === EV_KEY) {
    const index = resolveKeyName(code)
    if (index === null) return
    handleKey(source, index, value)
  }

  if (type === EV_ABS) {
    handleRawAxis(source, code, value)
  }
}

function resolveKeyName(code) {
  const index = RAW_BUTTON_MAP[code]
  if (index === undefined) return null
  return index
}

function handleRawAxis(source, code, value) {
  const DEAD_LOW = 40
  const DEAD_HIGH = 215

  if (!retroarchActive) {
    if (code === 0) {
      if (value < DEAD_LOW) {
        if (source === 'P1') {
          console.log('[MODAL DEBUG] P1 joystick LEFT')
        }
        dispatch({ type: 'PLAYER', player: source, button: 'LEFT' })
      } else if (value > DEAD_HIGH) {
        if (source === 'P1') {
          console.log('[MODAL DEBUG] P1 joystick RIGHT')
        }
        dispatch({ type: 'PLAYER', player: source, button: 'RIGHT' })
      }
    }

    if (code === 1) {
      if (value < DEAD_LOW) {
        if (source === 'P1') {
          console.log('[MODAL DEBUG] P1 joystick UP')
        }
        dispatch({ type: 'PLAYER', player: source, button: 'UP' })
      } else if (value > DEAD_HIGH) {
        if (source === 'P1') {
          console.log('[MODAL DEBUG] P1 joystick DOWN')
        }
        dispatch({ type: 'PLAYER', player: source, button: 'DOWN' })
      }
    }

    return
  }

  if (!RETROARCH_USE_TTY_MODE) {
    // Single-X mode: RetroArch reads real devices directly.
    return
  }

  const mappedSource = resolveRetroInputSource(source)
  const target = getRetroVirtualTarget(source)
  if (!target || !retroarchActive) return

  const state = dpadState[mappedSource]

  function press(keyName, keyCode) {
    if (state[keyName]) return
    state[keyName] = true
    sendVirtual(target, EV_KEY, keyCode, 1)
  }

  function release(keyName, keyCode) {
    if (!state[keyName]) return
    state[keyName] = false
    sendVirtual(target, EV_KEY, keyCode, 0)
  }

  // X axis
  if (code === 0) {
    if (value < DEAD_LOW) {
      press('left', BTN_DPAD_LEFT)
      release('right', BTN_DPAD_RIGHT)
    } else if (value > DEAD_HIGH) {
      press('right', BTN_DPAD_RIGHT)
      release('left', BTN_DPAD_LEFT)
    } else {
      release('left', BTN_DPAD_LEFT)
      release('right', BTN_DPAD_RIGHT)
    }
  }

  // Y axis
  if (code === 1) {
    if (value < DEAD_LOW) {
      press('up', BTN_DPAD_UP)
      release('down', BTN_DPAD_DOWN)
    } else if (value > DEAD_HIGH) {
      press('down', BTN_DPAD_DOWN)
      release('up', BTN_DPAD_UP)
    } else {
      release('up', BTN_DPAD_UP)
      release('down', BTN_DPAD_DOWN)
    }
  }
}

function handleKey(source, index, value) {
  if (index === undefined || index === null) return

  if (source === 'CASINO') {
    if (retroarchActive && RETROARCH_PRIMARY_INPUT === 'CASINO') {
      if (value === 1 && JOYSTICK_BUTTON_MAP[index] === 'MENU' && CASINO_MENU_EXITS_RETROARCH) {
        if (canAcceptRetroarchStop()) {
          requestRetroarchStop('menu')
          return
        }
        console.log('[RETROARCH] MENU ignored by guard', {
          elapsedMs: retroarchStartedAt ? Date.now() - retroarchStartedAt : null,
          guardMs: RETROARCH_EXIT_GUARD_MS,
        })
      }

      routePlayerInput('P1', index, value)
      return
    }

    if (!retroarchActive && value === 1) {
      if (index === 7) {
        dispatch({ type: 'PLAYER', player: 'CASINO', button: 7 })
        return
      }
    }

    if (value !== 1) return // only act on press for casino
    const casinoAction = JOYSTICK_BUTTON_MAP[index]

    if (casinoAction === 'MENU' && CASINO_MENU_EXITS_RETROARCH) {
      if (canAcceptRetroarchStop()) {
        requestRetroarchStop('menu')
        return
      }
      console.log('[RETROARCH] MENU ignored by guard', {
        elapsedMs: retroarchStartedAt ? Date.now() - retroarchStartedAt : null,
        guardMs: RETROARCH_EXIT_GUARD_MS,
      })
    }

    switch (casinoAction) {
      case 'COIN':
        handleDepositPulse()
        break
      case 'HOPPER_COIN':
        dispatch({
          type: 'HOPPER_COIN',
          amount: HOPPER_TOPUP_COIN_VALUE,
        })
        break
      case 'WITHDRAW_COIN':
        handleWithdrawPulse()
        break
      default:
        dispatch({ type: 'ACTION', action: casinoAction })
        break
    }
    return
  }

  routePlayerInput(source, index, value)
}

function routePlayerInput(source, index, value) {
  const keyCode = mapIndexToKey(index)
  if (!keyCode) return

  if (retroarchActive) {
    if (!RETROARCH_USE_TTY_MODE) {
      // Single-X mode: RetroArch reads real devices directly.
      return
    }

    const target = getRetroVirtualTarget(source)
    if (!target) return

    // Forward real press/release state
    sendVirtual(target, EV_KEY, keyCode, value)
  } else {
    if (value !== 1) return

    if (source === 'P1' && (index === 0 || index === 1)) {
      console.log(
        `[MODAL DEBUG] P1 button ${index} press (${index === 0 ? 'confirm/select' : 'dismiss keyboard'})`,
      )
    }

    dispatch({
      type: 'PLAYER',
      player: source,
      button: index,
    })
  }
}

function switchToVT(vt, reason) {
  if (!RETROARCH_USE_TTY_MODE) return true
  if (!IS_PI) return true

  const result = spawnSync('chvt', [vt], { encoding: 'utf8' })

  if (result.status !== 0) {
    console.error(
      `[VT] chvt ${vt} failed (${reason})`,
      result.stderr?.trim() || result.error?.message || '',
    )
    return false
  }

  console.log(`[VT] switched to ${vt} (${reason})`)

  return true
}

function switchToVTWithRetry(vt, reason, attempts = 5, delayMs = 150) {
  if (!RETROARCH_USE_TTY_MODE) return
  if (!IS_PI) return

  let remaining = attempts

  const attempt = () => {
    const ok = switchToVT(vt, `${reason}#${attempts - remaining + 1}`)
    if (ok) return
    remaining -= 1
    if (remaining <= 0) return
    setTimeout(attempt, delayMs)
  }

  attempt()
}

function scheduleForceSwitchToUI(reason, delayMs = 900) {
  if (!RETROARCH_USE_TTY_MODE || !IS_PI) return

  const targetUiVT = getTargetUiVT()
  const cmd = `sleep ${Math.max(0, Math.round(delayMs)) / 1000}; chvt ${targetUiVT}`
  const proc = spawn('sh', ['-lc', cmd], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  console.log(`[VT] scheduled fallback to ${targetUiVT} (${reason})`)
}

function maybeRestartUiAfterExit(reason) {
  if (!IS_PI || !RETROARCH_USE_TTY_MODE || !RESTART_UI_ON_EXIT || shuttingDown) return

  const now = Date.now()
  if (now - lastUiRestartAt < UI_RESTART_COOLDOWN_MS) return
  lastUiRestartAt = now

  // Work around intermittent black screen on tty return by refreshing X/Chromium stack.
  const proc = spawn('systemctl', ['restart', 'arcade-ui.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  console.log(`[UI] restart requested after game exit (${reason})`)
}

function killRetroarchProcess(signal, reason) {
  if (!retroarchProcess) return

  const pid = retroarchProcess.pid

  try {
    process.kill(-pid, signal)
    console.log(`[RETROARCH] group ${signal} (${reason}) pid=${pid}`)
    return
  } catch {}

  try {
    retroarchProcess.kill(signal)
    console.log(`[RETROARCH] child ${signal} (${reason}) pid=${pid}`)
  } catch (err) {
    console.error('[RETROARCH] kill failed', err.message)
  }
}

function sendRetroarchSignal(signal, reason) {
  if (!retroarchProcess) return
  killRetroarchProcess(signal, reason)
}

function finalizeRetroarchExit(reason) {
  const wasActive = retroarchActive
  const targetUiVT = getTargetUiVT()
  retroarchActive = false
  retroarchStopping = false
  retroarchProcess = null
  lastExitTime = Date.now()
  retroarchStartedAt = 0
  if (retroarchLogFd !== null) {
    try {
      fs.closeSync(retroarchLogFd)
    } catch {}
    retroarchLogFd = null
  }

  switchToVTWithRetry(targetUiVT, reason)
  setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-post`), 450)
  scheduleForceSwitchToUI(`${reason}-detached`)

  if (wasActive) {
    dispatch({ type: 'GAME_EXITED' })
    setTimeout(() => maybeRestartUiAfterExit(reason), 250)
  }
}

function requestRetroarchStop(reason) {
  if (!retroarchActive) return
  const targetUiVT = getTargetUiVT()

  if (!retroarchProcess) {
    console.warn('[RETROARCH] stop requested with no process')
    finalizeRetroarchExit(`${reason}-missing-process`)
    return
  }

  if (retroarchStopping) return
  retroarchStopping = true

  sendRetroarchSignal('SIGINT', `${reason}-graceful`)
  console.log(`[VT] waiting for RetroArch exit before returning to ${targetUiVT}`)

  setTimeout(() => {
    if (!retroarchActive) return
    sendRetroarchSignal('SIGTERM', `${reason}-term-fallback`)
  }, RETROARCH_TERM_FALLBACK_MS)

  setTimeout(() => {
    if (!retroarchActive) return

    console.warn('[RETROARCH] force-killing hung process')
    killRetroarchProcess('SIGKILL', `${reason}-force`)
    finalizeRetroarchExit(`${reason}-force-ui`)
  }, RETROARCH_STOP_GRACE_MS)
}

// ============================
// SHUTDOWN
// ============================

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  console.log('[SYSTEM] SHUTDOWN START')

  try {
    gpioOff(HOPPER_PAY_PIN)

    if (hopperCtl) {
      hopperCtl.kill('SIGTERM')
      hopperCtl = null
    }

    player1?.removeAllListeners?.()
    player2?.removeAllListeners?.()

    player1?.close?.()
    player2?.close?.()

    requestRetroarchStop('shutdown')

    if (serverInstance) {
      await new Promise(resolve => serverInstance.close(resolve))
    }

    if (wss) {
      for (const client of wss.clients) {
        try {
          client.terminate() // force close immediately
        } catch {}
      }

      await new Promise(resolve => wss.close(resolve))
    }
  } catch (err) {
    console.error('[SHUTDOWN ERROR]', err)
  }

  console.log('[SYSTEM] SHUTDOWN COMPLETE')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

process.on('exit', () => {
  console.log('Process exiting...')
})

// ============================
// START
// ============================
if (IS_PI) {
  await startVirtualDevices()

  startEventDevice('/dev/input/casino', 'CASINO')
  startEventDevice('/dev/input/player1', 'P1')
  startEventDevice('/dev/input/player2', 'P2')
} else {
  console.log('[INPUT] compat-mode: hardware readers disabled')
}

const PORT = 5174

function readHardwareSerial() {
  if (!IS_PI) {
    const host = os.hostname() || 'dev-host'
    return `dev-${host
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 24)
      .toLowerCase()}`
  }

  try {
    const raw = fs.readFileSync('/sys/firmware/devicetree/base/serial-number')

    return raw
      .toString('utf8')
      .replace(/\u0000/g, '')
      .replace(/[^a-fA-F0-9]/g, '') // allow only hex
      .trim()
  } catch (err) {
    console.error('[DEVICE] Failed to read hardware serial', err)
    return null
  }
}

const DEVICE_ID = readHardwareSerial()
if (!DEVICE_ID) {
  console.error('FATAL: No hardware serial found')
  process.exit(1)
}

console.log('[DEVICE] ID =', DEVICE_ID)

function getMimeType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html'
  if (filePath.endsWith('.js')) return 'application/javascript'
  if (filePath.endsWith('.css')) return 'text/css'
  if (filePath.endsWith('.json')) return 'application/json'
  if (filePath.endsWith('.png')) return 'image/png'
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

fs.mkdirSync(RUNTIME_GAMES_DIR, { recursive: true })

function sanitizePathSegment(value, fallback = 'default') {
  const safe = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '')
  return safe || fallback
}

//
function getRuntimeGameDir(gameId, version) {
  return path.join(
    RUNTIME_GAMES_DIR,
    sanitizePathSegment(gameId, 'game'),
    sanitizePathSegment(version, '1'),
  )
}

function getRuntimeGameEntry(gameId, version) {
  const safeId = sanitizePathSegment(gameId, 'game')
  const safeVersion = sanitizePathSegment(version, '1')
  return `/runtime-games/${safeId}/${safeVersion}/index.html`
}

function setJsonCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function getPackageKey() {
  const keyHex = process.env.GAME_PACKAGE_KEY_HEX || ''
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) return null
  return Buffer.from(keyHex, 'hex')
}

async function installEncryptedGamePackage({ id, packageUrl, version, force = false }) {
  const key = getPackageKey()
  if (!key) {
    throw new Error('GAME_PACKAGE_KEY_HEX is missing or invalid')
  }

  const gameId = sanitizePathSegment(id, 'game')
  const gameVersion = sanitizePathSegment(version, '1')
  const installDir = getRuntimeGameDir(gameId, gameVersion)
  const markerPath = path.join(installDir, '.installed.json')
  const entryPath = path.join(installDir, 'index.html')

  if (!force && fs.existsSync(markerPath)) {
    if (normalizeRuntimeIndexHtml(entryPath)) {
      return {
        entry: getRuntimeGameEntry(gameId, gameVersion),
        installed: true,
        cached: true,
      }
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  let response
  try {
    response = await fetch(packageUrl, {
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`package download failed: ${response.status}`)
  }

  const encrypted = Buffer.from(await response.arrayBuffer())
  if (encrypted.length < 29) {
    throw new Error('invalid encrypted payload')
  }

  const iv = encrypted.subarray(0, 12)
  const tag = encrypted.subarray(12, 28)
  const cipherText = encrypted.subarray(28)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  let plainTar
  try {
    plainTar = Buffer.concat([decipher.update(cipherText), decipher.final()])
  } catch {
    throw new Error('decrypt failed: auth check failed')
  }

  fs.rmSync(installDir, { recursive: true, force: true })
  fs.mkdirSync(installDir, { recursive: true })

  const tmpTarPath = path.join(os.tmpdir(), `arcade-${gameId}-${gameVersion}-${Date.now()}.tar.gz`)
  fs.writeFileSync(tmpTarPath, plainTar)

  const untar = spawnSync('tar', ['-xzf', tmpTarPath, '-C', installDir], {
    stdio: 'pipe',
    encoding: 'utf8',
  })

  fs.rmSync(tmpTarPath, { force: true })

  if (untar.status !== 0) {
    throw new Error(`extract failed: ${untar.stderr || untar.stdout || untar.status}`)
  }

  if (!fs.existsSync(entryPath)) {
    throw new Error('invalid package: missing index.html')
  }
  normalizeRuntimeIndexHtml(entryPath)

  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        gameId,
        version: gameVersion,
        installedAt: new Date().toISOString(),
        packageSha256: createHash('sha256').update(encrypted).digest('hex'),
      },
      null,
      2,
    ),
  )

  return {
    entry: getRuntimeGameEntry(gameId, gameVersion),
    installed: true,
    cached: false,
  }
}

function normalizeRuntimeIndexHtml(indexPath) {
  if (!fs.existsSync(indexPath)) return false

  let html = fs.readFileSync(indexPath, 'utf8')
  const original = html

  // Keep packaged games portable when mounted under nested runtime routes.
  html = html.replace(/(src|href)="\/assets\//g, '$1="./assets/')

  if (html !== original) {
    fs.writeFileSync(indexPath, html)
  }

  return true
}

function removeRuntimeGamePackage({ id, version, allVersions = false }) {
  const gameId = sanitizePathSegment(id, 'game')

  if (allVersions) {
    const gameRoot = path.join(RUNTIME_GAMES_DIR, gameId)
    fs.rmSync(gameRoot, { recursive: true, force: true })
    return { removed: true, path: gameRoot }
  }

  const gameVersion = sanitizePathSegment(version, '1')
  const installDir = getRuntimeGameDir(gameId, gameVersion)
  fs.rmSync(installDir, { recursive: true, force: true })
  return { removed: true, path: installDir }
}

function purgeRuntimeGamePackages() {
  fs.rmSync(RUNTIME_GAMES_DIR, { recursive: true, force: true })
  fs.mkdirSync(RUNTIME_GAMES_DIR, { recursive: true })
  return { purged: true }
}

function getNetworkInfo() {
  const nets = os.networkInterfaces()

  const pickIpv4 = name => {
    const entries = nets[name] || []
    const found = entries.find(e => e && e.family === 'IPv4' && !e.internal)
    return found?.address || null
  }

  return {
    ethernet: pickIpv4('eth0'),
    wifi: pickIpv4('wlan0'),
  }
}

function getCoreCandidates(coreValue) {
  const normalized = String(coreValue ?? '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.so$/i, '')
    .replace(/_libretro$/i, '')
    .replace(/-/g, '_')

  const candidates = []
  if (normalized) {
    candidates.push(normalized)
  }

  if (
    normalized === 'ps1' ||
    normalized === 'psx' ||
    normalized === 'playstation' ||
    normalized.includes('psx') ||
    normalized.includes('playstation')
  ) {
    candidates.push(...PS1_CORE_ALIASES)
  }

  return Array.from(new Set(candidates))
}

function resolveCorePath(coreValue) {
  const coreCandidates = getCoreCandidates(coreValue)

  const attempted = []
  for (const coreName of coreCandidates) {
    for (const baseDir of LIBRETRO_DIR_CANDIDATES) {
      const soPath = path.join(baseDir, `${coreName}_libretro.so`)
      attempted.push(soPath)
      if (fs.existsSync(soPath)) {
        return { path: soPath, coreName, attempted }
      }
    }
  }

  return { path: null, coreName: null, attempted }
}

function resolveRomPath(romValue) {
  const raw = String(romValue ?? '').trim()
  if (!raw) return null

  const candidates = [
    raw,
    path.resolve(__dirname, raw),
    path.resolve(PROJECT_ROOT, raw),
    path.resolve(ROMS_ROOT, raw),
  ]

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  return null
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS' && req.url.startsWith('/game-package/')) {
    setJsonCors(res)
    res.writeHead(204)
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/device-id') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ deviceId: DEVICE_ID }))
    return
  }
  if (req.method === 'GET' && req.url === '/network-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(getNetworkInfo()))
    return
  }
  if (req.method === 'GET' && req.url === '/wifi-scan') {
    if (!IS_PI) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify([
          { ssid: 'DEV_WIFI', signal: 85 },
          { ssid: 'DEV_HOTSPOT', signal: 62 },
        ]),
      )
    }

    exec(
      'sudo nmcli device wifi rescan; sudo nmcli -t --escape no -f SSID,SIGNAL device wifi list --rescan no',
      (err, stdout) => {
        if (err) {
          console.error('[WIFI] Scan failed', err)
          res.writeHead(500)
          return res.end('Error')
        }

        const networks = stdout
          .split('\n')
          .filter(Boolean)
          .map(line => {
            const sep = line.lastIndexOf(':')
            if (sep <= 0) return null
            const ssid = line.slice(0, sep).trim()
            const signal = Number(line.slice(sep + 1))
            return { ssid, signal: Number.isFinite(signal) ? signal : 0 }
          })
          .filter(Boolean)
          .filter(n => n.ssid && n.ssid.trim() !== '')
          .sort((a, b) => b.signal - a.signal)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(networks))
      },
    )

    return
  }

  if (req.method === 'GET') {
    const safePath = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '')

    if (safePath.startsWith('/runtime-games/')) {
      const runtimePath = safePath.replace('/runtime-games/', '')
      let filePath = path.join(RUNTIME_GAMES_DIR, runtimePath)

      if (!filePath.startsWith(RUNTIME_GAMES_DIR)) {
        res.writeHead(403)
        return res.end('Forbidden')
      }

      if (safePath.endsWith('/')) {
        filePath = path.join(filePath, 'index.html')
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404)
        return res.end('Not found')
      }

      try {
        const data = fs.readFileSync(filePath)
        const isHtml = filePath.endsWith('.html')
        res.writeHead(200, {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000',
        })
        return res.end(data)
      } catch (err) {
        console.error('Runtime static read error:', err)
        res.writeHead(500)
        return res.end('Server error')
      }
    }

    let filePath = path.join(DIST_DIR, safePath === '/' ? 'index.html' : safePath)

    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403)
      return res.end('Forbidden')
    }

    // If file does not exist, fallback to index.html
    if (!fs.existsSync(filePath)) {
      filePath = path.join(DIST_DIR, 'index.html')
    }

    console.log('Serving:', filePath)

    try {
      const data = fs.readFileSync(filePath)

      const isHtml = filePath.endsWith('.html')

      res.writeHead(200, {
        'Content-Type': getMimeType(filePath),
        'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000',
      })

      return res.end(data)
    } catch (err) {
      console.error('Static read error:', err)
      res.writeHead(500)
      return res.end('Server error')
    }
  }

  if (req.method === 'POST' && req.url === '/wifi-connect') {
    let body = ''

    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', async () => {
      try {
        const { ssid, password } = JSON.parse(body || '{}')

        if (!ssid || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'Missing credentials' }))
        }

        if (!IS_PI) {
          console.log('[WIFI] compat-mode connect accepted for', ssid)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
          broadcast({ type: 'INTERNET_RESTORED' })
          return
        }

        console.log('[WIFI] Attempting connection to', ssid)

        const nm = spawn('sudo', ['nmcli', 'device', 'wifi', 'connect', ssid, 'password', password])

        nm.on('close', async code => {
          if (code !== 0) {
            console.error('[WIFI] nmcli failed with code', code)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: false }))
          }

          // Give NetworkManager time to settle
          setTimeout(async () => {
            const online = await checkInternetOnce()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: online }))

            if (online) {
              broadcast({ type: 'INTERNET_RESTORED' })
            }
          }, 3000)
        })
      } catch (e) {
        console.error('[WIFI] Invalid request', e)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false }))
      }
    })

    return
  }

  if (req.method === 'POST' && req.url === '/game-package/prepare') {
    let body = ''

    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', async () => {
      try {
        setJsonCors(res)
        const { id, packageUrl, version, force } = JSON.parse(body || '{}')
        if (!id || !packageUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'Missing id or packageUrl' }))
        }

        const result = await installEncryptedGamePackage({
          id,
          packageUrl,
          version: version ?? 1,
          force: Boolean(force),
        })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ success: true, ...result }))
      } catch (err) {
        console.error('[GAME PACKAGE] prepare failed', err)
        setJsonCors(res)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }))
      }
    })

    return
  }

  if (req.method === 'POST' && req.url === '/game-package/remove') {
    let body = ''

    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', async () => {
      try {
        setJsonCors(res)
        const { id, version, allVersions } = JSON.parse(body || '{}')
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'Missing id' }))
        }

        const result = removeRuntimeGamePackage({
          id,
          version: version ?? 1,
          allVersions: Boolean(allVersions),
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ success: true, ...result }))
      } catch (err) {
        console.error('[GAME PACKAGE] remove failed', err)
        setJsonCors(res)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }))
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/game-package/purge') {
    try {
      setJsonCors(res)
      const result = purgeRuntimeGamePackages()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ success: true, ...result }))
    } catch (err) {
      console.error('[GAME PACKAGE] purge failed', err)
      setJsonCors(res)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }))
    }
  }

  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end('Method Not Allowed')
    return
  }

  let body = ''

  req.on('data', chunk => {
    body += chunk
  })

  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}')
      console.log('[INPUT HTTP]', payload)

      if (payload.type === 'WITHDRAW') {
        startHopper(payload.amount)
      }

      if (payload.type === 'LAUNCH_GAME') {
        if (typeof payload.core !== 'string' || typeof payload.rom !== 'string') {
          res.writeHead(400)
          return res.end('Missing core or rom')
        }

        if (retroarchActive) {
          console.warn('[LAUNCH] Ignored — RetroArch already active')
          return res.end('Already running')
        }

        if (Date.now() - lastExitTime < 300) {
          console.log('[LAUNCH] Ignored — cooldown')
          return res.end('Cooling down')
        }

        if (!IS_PI) {
          console.log('[LAUNCH] compat-mode simulated arcade launch')
          retroarchActive = true
          retroarchStopping = false
          retroarchStartedAt = Date.now()
          setTimeout(() => {
            finalizeRetroarchExit('compat-simulated')
          }, 250)
          res.writeHead(200)
          return res.end('OK')
        }

        console.log('[LAUNCH] emulator')

        retroarchActive = true
        retroarchStopping = false
        retroarchStartedAt = Date.now()

        const romPath = resolveRomPath(payload.rom)
        if (!romPath) {
          retroarchActive = false
          retroarchStopping = false
          retroarchStartedAt = 0
          console.error('[LAUNCH] ROM not found', { rom: payload.rom })
          res.writeHead(400)
          return res.end(`ROM not found: ${payload.rom}`)
        }

        const core = resolveCorePath(payload.core)
        if (!core.path) {
          retroarchActive = false
          retroarchStopping = false
          retroarchStartedAt = 0
          console.error('[LAUNCH] Core not found', {
            core: payload.core,
            attempted: core.attempted,
          })
          res.writeHead(400)
          return res.end(`Core not found: ${payload.core}`)
        }

        console.log('[LAUNCH] resolved', {
          core: core.coreName,
          corePath: core.path,
          romPath,
        })

        retroarchLogFd = fs.openSync(RETROARCH_LOG_PATH, 'a')

        const activeVT = getActiveVT()
        if (activeVT) {
          lastUiVT = activeVT
          console.log(`[VT] captured UI VT ${lastUiVT} before launch`)
        }

        switchToVT(GAME_VT, 'launch')

        const command = ['-u', 'arcade1']
        if (RETROARCH_USE_TTY_MODE) {
          command.push('env', '-u', 'DISPLAY', '-u', 'XAUTHORITY', '-u', 'WAYLAND_DISPLAY')
        } else {
          command.push('env', 'DISPLAY=:0', 'XAUTHORITY=/home/arcade1/.Xauthority')
        }
        if (RETROARCH_USE_TTY_MODE) {
          command.push('dbus-run-session', '--', 'retroarch', '--fullscreen', '--verbose')
        } else {
          command.push(
            'env',
            'XDG_RUNTIME_DIR=/run/user/1000',
            'dbus-run-session',
            '--',
            'retroarch',
            '--fullscreen',
            '--verbose',
          )
        }

        if (RETROARCH_CONFIG_PATH) {
          command.push('--config', RETROARCH_CONFIG_PATH)
        }

        command.push('-L', core.path, romPath)

        retroarchProcess = spawn('sudo', command, {
          stdio: ['ignore', retroarchLogFd, retroarchLogFd],
          detached: true,
        })

        retroarchProcess.unref()

        retroarchProcess.on('error', err => {
          console.error('[PROCESS] RetroArch spawn error', err.message)
          finalizeRetroarchExit('spawn-error')
        })

        retroarchProcess.on('exit', (code, signal) => {
          console.log(`[PROCESS] RetroArch exited code=${code} signal=${signal}`)
          finalizeRetroarchExit('normal-exit')
        })
      }

      res.writeHead(200)
      res.end('OK')
    } catch (err) {
      console.error('[INPUT HTTP] Invalid JSON', err)
      res.writeHead(400)
      res.end('Invalid JSON')
    }
  })
})

serverInstance = server.listen(PORT, '127.0.0.1', () => {
  console.log(`[INPUT HTTP] Listening on http://localhost:${PORT}`)
})

let lastInternetState = null
let internetFailStreak = 0
let internetOkStreak = 0

function checkInternetOnce() {
  return new Promise(resolve => {
    exec(
      `curl -s --max-time ${INTERNET_PROBE_TIMEOUT_SEC} https://clients3.google.com/generate_204`,
      err => {
        resolve(!err)
      },
    )
  })
}

let checkingNetwork = false

async function monitorInternet() {
  if (checkingNetwork) return
  checkingNetwork = true

  const online = await checkInternetOnce()

  checkingNetwork = false

  if (lastInternetState === null) {
    lastInternetState = online
    internetOkStreak = online ? 1 : 0
    internetFailStreak = online ? 0 : 1
    return
  }

  if (online) {
    internetOkStreak += 1
    internetFailStreak = 0
  } else {
    internetFailStreak += 1
    internetOkStreak = 0
  }

  if (lastInternetState && internetFailStreak >= INTERNET_FAIL_THRESHOLD) {
    lastInternetState = false
    internetFailStreak = 0
    console.warn('[NETWORK] Internet LOST')
    broadcast({ type: 'INTERNET_LOST' })
    return
  }

  if (!lastInternetState && internetOkStreak >= INTERNET_RESTORE_THRESHOLD) {
    lastInternetState = true
    internetOkStreak = 0
    console.log('[NETWORK] Internet RESTORED')
    broadcast({ type: 'INTERNET_RESTORED' })
  }
}

let wifiReading = false

function readWifiSignal() {
  if (wifiReading) return
  wifiReading = true

  if (!IS_PI) {
    const info = getNetworkInfo()
    const connected = Boolean(info.ethernet || info.wifi)
    wifiReading = false
    broadcastWifi({
      type: 'WIFI_STATUS',
      connected,
      signal: null,
      ssid: info.wifi ? 'dev-wifi' : null,
    })
    return
  }

  exec('nmcli -t -f TYPE,STATE dev', (err, stdout) => {
    if (err || !stdout) {
      wifiReading = false
      return
    }

    const lines = stdout.trim().split('\n')

    const wifiConnected = lines.some(line => {
      const [type, state] = line.split(':')
      return type === 'wifi' && state === 'connected'
    })

    if (!wifiConnected) {
      wifiReading = false
      broadcastWifi({ type: 'WIFI_STATUS', connected: false, signal: null, ssid: null })
      return
    }

    exec(
      'nmcli -t --escape no -f ACTIVE,SSID,SIGNAL dev wifi list --rescan no',
      (err2, stdout2) => {
        wifiReading = false

        if (err2 || !stdout2) return

        const activeLine = stdout2
          .trim()
          .split('\n')
          .find(line => line.startsWith('yes:'))

        if (!activeLine) {
          broadcastWifi({ type: 'WIFI_STATUS', connected: true, signal: null, ssid: null })
          return
        }

        const signalSep = activeLine.lastIndexOf(':')
        const left = signalSep > -1 ? activeLine.slice(0, signalSep) : activeLine
        const signalRaw = signalSep > -1 ? activeLine.slice(signalSep + 1) : ''
        const ssid = left.replace(/^yes:/, '').trim() || null
        const signal = Number(signalRaw ?? 0)

        broadcastWifi({
          type: 'WIFI_STATUS',
          connected: true,
          signal: Number.isFinite(signal) ? signal : null,
          ssid,
        })
      },
    )
  })
}

let lastWifiState = null

function broadcastWifi(state) {
  const serialized = JSON.stringify(state)
  if (serialized === lastWifiState) return

  lastWifiState = serialized
  broadcast(state)
}

readWifiSignal()
setInterval(readWifiSignal, 5000)

setInterval(monitorInternet, INTERNET_MONITOR_INTERVAL_MS)
