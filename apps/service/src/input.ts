// @ts-nocheck
// ============================
// INTERNET REACHABILITY POLLING
// ============================

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
import { exec, execFile, spawn, spawnSync } from 'child_process'
import { createDecipheriv, createHash } from 'crypto'
import dgram from 'dgram'
import os from 'os'

import fs from 'fs'

import path from 'path'
import {
  formatArcadeTime,
  getArcadeSessionPrice as getArcadeSessionPriceHelper,
  isArcadeTimeLockActive as isArcadeTimeLockActiveHelper,
  noteArcadeBalancePush as noteArcadeBalancePushHelper,
  resetArcadeTimeoutPauseState as resetArcadeTimeoutPauseStateHelper,
  shouldDeferArcadeBalanceSync as shouldDeferArcadeBalanceSyncHelper,
} from './arcade-time/helpers.js'
import { createArcadeTimeBackendSync } from './arcade-time/backendSync.js'
import { createArcadeBuyFlow } from './arcade-time/buyFlow.js'
import { createArcadePromptController } from './arcade-time/prompt.js'
import { createArcadeTimeService } from './arcade-time/service.js'
import { createDeviceBackendReads, createDeviceBackendWrites } from './device/backend.js'
import { createCoinAcceptor } from './hardware/coinAcceptor.js'
import { createControlRouter } from './hardware/controlRouter.js'
import { createGpioController } from './hardware/gpio.js'
import { createHopperController } from './hardware/hopper.js'
import { createInputDeviceManager } from './hardware/inputDevices.js'
import { createRawInputMapper } from './hardware/rawInputMapper.js'
import { createDisplayRuntime } from './runtime/displayRuntime.js'
import { createRetroarchLaunchRuntime } from './runtime/retroarchLaunch.js'
import { createRetroarchRuntimeOrchestrator } from './runtime/retroarchRuntime.js'
import { createVirtualInputRuntime } from './runtime/virtualInput.js'

const SERVICE_DIR = process.env.ARCADE_SERVICE_DIR || process.cwd()
const ARCADE_RUNTIME_DIR = process.env.ARCADE_RUNTIME_DIR || path.resolve(SERVICE_DIR, '..')
const ROMS_ROOT = process.env.ARCADE_ROMS_DIR || path.join(ARCADE_RUNTIME_DIR, 'roms')

const DIST_DIR = process.env.ARCADE_UI_DIST_DIR || path.join(ARCADE_RUNTIME_DIR, 'ui/dist')
const DEFAULT_RUNTIME_DIR =
  process.platform === 'linux' ? '/dev/shm/arcade-games' : path.join(os.tmpdir(), 'arcade-games')
const RETROARCH_READY_FILE =
  process.env.ARCADE_RETRO_READY_FILE || '/tmp/arcade-retro-session.ready'

const RUNTIME_GAMES_DIR = process.env.ARCADE_RUNTIME_GAMES_DIR || DEFAULT_RUNTIME_DIR
const IS_LINUX = process.platform === 'linux'
const IS_MACOS = process.platform === 'darwin'
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
const DEV_INPUT_BYPASS_ENABLED = !IS_PI && IS_MACOS
// ============================
// CONFIG
// ============================

const GPIOCHIP = 'gpiochip0'
const HOPPER_PAY_PIN = 17
const COIN_INHIBIT_PIN = 22

const HOPPER_TIMEOUT_MS = 60000
const HOPPER_NO_PULSE_TIMEOUT_MS = 4000
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

let buyState = 'idle' // 'idle' | 'confirm' | 'processing'
let buyConfirmAt = 0

const BUY_CONFIRM_WINDOW_MS = 5000

const HOPPER_TOPUP_COIN_VALUE = 20
const ARCADE_TIME_PURCHASE_MS = 10 * 60 * 1000

// Coin timing (measured FAST mode)
const COIN_IDLE_GAP_MS = 130
const COIN_PESO_BY_PULSE_COUNT = {
  1: 5,
  2: 10,
  4: 20,
}

// ============================
// STATE
// ============================

let shuttingDown = false
const joystick = null
const player1 = null
const player2 = null

// -------- Deposit coins --------
let depositPulseCount = 0
let depositIdleTimer = null
let depositLastPulseTime = 0
let depositStartTime = 0

// -------- Hopper / withdrawal --------
let hopperActive = false
let hopperTarget = 0
let hopperDispensed = 0
const hopperTimeout = null
const hopperGpioProcess = null
const hopperNoPulseTimeout = null
let hopperLastPulseAt = 0
let activeWithdrawalContext = null

let serverInstance = null

let virtualP1 = null
let virtualP2 = null
const VIRTUAL_DEVICE_STAGGER_MS = 650

let retroarchActive = false
let retroarchProcess = null
let retroarchStopping = false
let lastExitTime = 0
let retroarchStartedAt = 0
let retroarchLogFd = null
let retroarchStopTermTimer = null
let retroarchStopForceTimer = null
let pendingUiFallbackTimer = null
let retroarchExitConfirmUntil = 0
let retroarchCurrentGameId = null

let lastGameInputAt = 0

let lastExitedGameId = null
let arcadeShellUpdateChild = null
let arcadeShellUpdateTriggered = false
let arcadeShellUpdateState = {
  status: 'idle',
  phase: null,
  label: '',
  detail: null,
  startedAt: null,
  finishedAt: null,
  message: '',
  reason: null,
  exitCode: null,
}
let arcadeBalancePushFloor = null
let arcadeBalancePushFloorUntil = 0
let arcadeTimePersistTimer = null
let arcadeTimePersistInFlight = false
let arcadeTimePersistRequestedMs = null
let arcadeTimePersistCommittedMs = null

async function withTimeout(promise, ms = 5000) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  return Promise.race([promise, timeout])
}

function noteArcadeBalancePush(nextBalance) {
  const nextState = noteArcadeBalancePushHelper(nextBalance, toMoney)
  if (!nextState) return
  arcadeBalancePushFloor = nextState.floor
  arcadeBalancePushFloorUntil = nextState.until
}

function clearArcadeBalancePushFloor() {
  arcadeBalancePushFloor = null
  arcadeBalancePushFloorUntil = 0
}

function clearArcadeTimePersistTimer() {
  if (arcadeTimePersistTimer === null) return
  clearTimeout(arcadeTimePersistTimer)
  arcadeTimePersistTimer = null
}

function shouldDeferArcadeBalanceSync(nextBalance) {
  const decision = shouldDeferArcadeBalanceSyncHelper(
    nextBalance,
    arcadeBalancePushFloor,
    arcadeBalancePushFloorUntil,
  )
  if (decision.expired) {
    clearArcadeBalancePushFloor()
    return false
  }
  return decision.defer
}

function isRetroarchSessionReady() {
  if (!retroarchActive) return false
  if (RETROARCH_TTY_X_SESSION) return fs.existsSync(RETROARCH_READY_FILE)
  if (!retroarchStartedAt) return false
  return Date.now() - retroarchStartedAt >= RETROARCH_START_INPUT_GUARD_MS
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        maxBuffer: 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout
          error.stderr = stderr
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

async function requestJsonWithCurl(
  url,
  { method = 'GET', body = null, headers = {}, timeoutMs = 2500 } = {},
) {
  const args = [
    '-sS',
    '-L',
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    '--write-out',
    '\n%{http_code}',
  ]

  if (method && method !== 'GET') {
    args.push('-X', method)
  }

  for (const [key, value] of Object.entries(headers)) {
    args.push('-H', `${key}: ${value}`)
  }

  if (body !== null && body !== undefined) {
    args.push('--data-binary', typeof body === 'string' ? body : JSON.stringify(body))
  }

  args.push(url)

  const { stdout } = await execFileAsync('curl', args)
  const text = String(stdout || '')
  const splitIndex = text.lastIndexOf('\n')
  const responseText = splitIndex >= 0 ? text.slice(0, splitIndex) : text
  const statusRaw = splitIndex >= 0 ? text.slice(splitIndex + 1).trim() : ''
  const status = Number.parseInt(statusRaw, 10)

  if (!Number.isFinite(status)) {
    throw new Error(`curl response missing status for ${url}`)
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    text: responseText,
    json() {
      return responseText ? JSON.parse(responseText) : null
    },
  }
}

const GAME_VT = process.env.ARCADE_GAME_VT || '1'
const UI_VT = process.env.ARCADE_UI_VT || '2'
const SPLASH_VT = process.env.ARCADE_SPLASH_VT || '3'
const RETROARCH_STOP_GRACE_MS = 3000
const RETROARCH_LOG_PATH = '/tmp/retroarch.log'
const RETROARCH_TERM_FALLBACK_MS = 1200
const SINGLE_X_MODE = process.env.RETROARCH_SINGLE_X === '1'
const RETROARCH_USE_TTY_MODE = !SINGLE_X_MODE && process.env.RETROARCH_TTY_MODE === '1'
const RETROARCH_TTY_X_SESSION = !SINGLE_X_MODE && process.env.RETROARCH_TTY_X_SESSION === '1'
const RETROARCH_TTY_X_PREWARM = !SINGLE_X_MODE && process.env.RETROARCH_TTY_X_PREWARM !== '0'
const RETROARCH_RUN_USER = process.env.RETROARCH_RUN_USER || 'arcade1'
const RETROARCH_RUN_UID = String(process.env.RETROARCH_RUN_UID || '1000')
const RETROARCH_RUN_HOME = process.env.RETROARCH_RUN_HOME || `/home/${RETROARCH_RUN_USER}`
const RETROARCH_RUNTIME_DIR =
  process.env.RETROARCH_XDG_RUNTIME_DIR || `/run/user/${RETROARCH_RUN_UID}`
const RETROARCH_DBUS_ADDRESS =
  process.env.RETROARCH_DBUS_ADDRESS || `unix:path=${RETROARCH_RUNTIME_DIR}/bus`
const RETROARCH_PULSE_SERVER =
  process.env.RETROARCH_PULSE_SERVER || `unix:${RETROARCH_RUNTIME_DIR}/pulse/native`
const RETROARCH_BIN = process.env.ARCADE_RETRO_BIN || '/usr/bin/retroarch'
const RETROARCH_USE_DBUS_RUN_SESSION = process.env.RETROARCH_USE_DBUS_RUN_SESSION === '1'
const RETROARCH_PRIMARY_INPUT = String(process.env.RETROARCH_PRIMARY_INPUT || 'P1').toUpperCase()
const CASINO_MENU_EXITS_RETROARCH = process.env.CASINO_MENU_EXITS_RETROARCH !== '0'
const RETROARCH_P2_SWAP_AXES = process.env.RETROARCH_P2_SWAP_AXES === '1'
const SUPABASE_URL = String(process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
const SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

console.log('[RETRO MODE]', {
  SINGLE_X_MODE,
  RETROARCH_USE_TTY_MODE,
  RETROARCH_TTY_X_SESSION,
  RETROARCH_P2_SWAP_AXES,
  DISPLAY: process.env.DISPLAY || null,
  XAUTHORITY: process.env.XAUTHORITY || null,
})

function parseNonNegativeMs(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

const RETROARCH_EXIT_GUARD_MS = parseNonNegativeMs(process.env.RETROARCH_EXIT_GUARD_MS, 1500)
const RETROARCH_START_INPUT_GUARD_MS = parseNonNegativeMs(
  process.env.RETROARCH_START_INPUT_GUARD_MS,
  3500,
)
const RETROARCH_EXIT_CONFIRM_WINDOW_MS = parseNonNegativeMs(
  process.env.RETROARCH_EXIT_CONFIRM_WINDOW_MS,
  2500,
)
const RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS = parseNonNegativeMs(
  process.env.RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS,
  1500,
)
const RETROARCH_CONFIG_PATH = process.env.RETROARCH_CONFIG_PATH || ''
const RESTART_UI_ON_EXIT = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ARCADE_RESTART_UI_ON_GAME_EXIT || '').toLowerCase(),
)
const KEEP_UI_ALIVE_DURING_TTY_X = process.env.ARCADE_UI_KEEPALIVE_DURING_TTY_X !== '0'
const USE_SPLASH_TRANSITIONS = process.env.ARCADE_SPLASH_TRANSITIONS === '1'
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
const ARCADE_LIFE_PRICE_DEFAULT = (() => {
  const parsed = Number(process.env.ARCADE_LIFE_PRICE_DEFAULT || 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
})()
const ARCADE_LIFE_FAIL_OPEN = process.env.ARCADE_LIFE_FAIL_OPEN === '1'
const ARCADE_RETRO_OSD_ENABLED = process.env.ARCADE_RETRO_OSD !== '0'
const RETROARCH_NETCMD_HOST = process.env.RETROARCH_NETCMD_HOST || '127.0.0.1'
const RETROARCH_NETCMD_PORT = Number(process.env.RETROARCH_NETCMD_PORT || 55355)
const RETROARCH_OSD_COMMAND = String(process.env.RETROARCH_OSD_COMMAND || 'AUTO')
  .trim()
  .toUpperCase()
const ARCADE_RETRO_OSD_COOLDOWN_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_COOLDOWN_MS,
  750,
)
const ARCADE_RETRO_OSD_RETRY_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_RETRY_INTERVAL_MS,
  180,
)
const ARCADE_RETRO_OSD_RETRY_COUNT = (() => {
  const parsed = Number(process.env.ARCADE_RETRO_OSD_RETRY_COUNT || 1)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(8, Math.round(parsed)))
})()
const ARCADE_RETRO_OSD_PROMPT_PERSIST = process.env.ARCADE_RETRO_OSD_PROMPT_PERSIST !== '0'
const ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS,
  1200,
)
const ARCADE_RETRO_OSD_PROMPT_BLINK = process.env.ARCADE_RETRO_OSD_PROMPT_BLINK === '1'
const ARCADE_RETRO_OSD_STYLE = (() => {
  const style = String(process.env.ARCADE_RETRO_OSD_STYLE || 'footer')
    .toLowerCase()
    .trim()
  if (style === 'hud' || style === 'legacy' || style === 'footer') return style
  return 'footer'
})()
const ARCADE_RETRO_OSD_LABEL = String(process.env.ARCADE_RETRO_OSD_LABEL || '')
  .replace(/\s+/g, ' ')
  .trim()
const ARCADE_RETRO_OSD_SHOW_SESSION_STATS = process.env.ARCADE_RETRO_OSD_SHOW_SESSION_STATS !== '0'
const ARCADE_RETRO_OVERLAY_HIDE_AFTER_CREDIT_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OVERLAY_HIDE_AFTER_CREDIT_MS,
  10000,
)
const ARCADE_LIFE_CONTINUE_SECONDS = (() => {
  const parsed = Number(process.env.ARCADE_LIFE_CONTINUE_SECONDS || 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(30, Math.round(parsed)))
})()
const ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS,
  1000,
)
const ARCADE_LIFE_PURCHASE_BUTTON_INDEXES = (() => {
  const raw = String(process.env.ARCADE_LIFE_PURCHASE_BUTTON_INDEXES || '8')
  const parsed = raw
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v >= 0 && v <= 31)
  if (parsed.length > 0) return new Set(parsed)
  return new Set([8])
})()
const ARCADE_LIFE_PURCHASE_LABEL =
  String(process.env.ARCADE_LIFE_PURCHASE_LABEL || 'Buy')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 16) || 'Buy'
const START_BUTTON_INDEXES = new Set([7, 9])
const RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS = parseNonNegativeMs(
  process.env.RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS,
  120,
)

let lastUiVT = UI_VT
let lastUiRestartAt = 0

let chromiumUiHidden = false
let arcadeUiStoppedForRetroarch = false
let splashStartedForRetroarch = false
let retroXWarmRequested = false
let retroarchReadyWatchTimer = null

function getXClientEnv() {
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':0',
    XAUTHORITY: process.env.XAUTHORITY || `${RETROARCH_RUN_HOME}/.Xauthority`,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || RETROARCH_RUNTIME_DIR,
  }
}

function runXClientCommand(command, args, label) {
  try {
    const proc = spawn(command, args, {
      env: getXClientEnv(),
      detached: true,
      stdio: 'ignore',
    })
    proc.on('error', err => {
      console.warn(`[UI] ${label} failed: ${err.message}`)
    })
    proc.unref()
    return true
  } catch (err) {
    console.warn(`[UI] ${label} failed: ${err.message}`)
    return false
  }
}

function stopArcadeUiForRetroarch() {
  displayRuntime.stopArcadeUiForRetroarch()
}

function restartArcadeUiAfterRetroarch(reason, forceRestart = false) {
  displayRuntime.restartArcadeUiAfterRetroarch(reason, forceRestart)
}

function ensureRetroXWarm(reason = 'boot') {
  displayRuntime.ensureRetroXWarm(reason)
}

/**
 * OFFLINE QUEUE FLUSH LOOP
 */
setInterval(async () => {
  if (internetState !== 'ok') return
  if (flushingOfflineQueue) return
  if (offlineQueue.length === 0) return

  flushingOfflineQueue = true

  while (offlineQueue.length > 0) {
    const item = offlineQueue[0]

    try {
      const res = await item.fn(item.payload)

      if (!res || res.ok === false) {
        throw new Error('flush failed')
      }

      offlineQueue.shift()
    } catch {
      break
    }
  }

  flushingOfflineQueue = false
}, 2000)

function startSplashForRetroarch() {
  displayRuntime.startSplashForRetroarch()
}

function stopSplashForRetroarch(reason) {
  displayRuntime.stopSplashForRetroarch(reason)
}

function ensureSplashReady(reason = 'boot') {
  displayRuntime.ensureSplashReady(reason)
}

function clearRetroarchReadyWatch() {
  displayRuntime.clearRetroarchReadyWatch()
}

function scheduleRetroarchReadyWatch(onReady) {
  displayRuntime.scheduleRetroarchReadyWatch(onReady)
}

function hasCommand(name) {
  const result = spawnSync('sh', ['-lc', `command -v ${name} >/dev/null 2>&1`], {
    stdio: 'ignore',
  })
  return result.status === 0
}

const UI_DISABLE_FLAG_PATH = '/tmp/arcade-ui-disabled'

function hideChromiumUiForRetroarch() {
  displayRuntime.hideChromiumUiForRetroarch()
}

/**
 * OFFLINE QUEUE (in-memory, minimal)
 */
const offlineQueue = []
let flushingOfflineQueue = false

const MAX_OFFLINE_QUEUE = 200

function enqueueOffline(item) {
  if (offlineQueue.length >= MAX_OFFLINE_QUEUE) {
    offlineQueue.shift() // drop oldest
  }
  offlineQueue.push(item)
}

function hasInternet() {
  return internetState === 'ok'
}

async function safeRpcCall(fn, payload) {
  if (!hasInternet()) {
    enqueueOffline({ fn, payload })
    return { queued: true }
  }

  try {
    const res = await fn(payload)

    if (!res || res.ok === false) {
      throw new Error(`RPC failed (${res?.status})`)
    }

    return res
  } catch (err) {
    enqueueOffline({ fn, payload })
    return { queued: true }
  }
}

function restoreChromiumUiAfterRetroarch() {
  displayRuntime.restoreChromiumUiAfterRetroarch()
}

let arcadeSession = null
// --- LIFE LOSS HEURISTIC STATE ---
const lastGameplayInputAt = { P1: 0, P2: 0 }
const lastLifeLossAt = 0
const retroarchStartPressState = {
  P1: { pressed: false, sent: false, suppressed: false, pressedAt: 0, timer: null },
  P2: { pressed: false, sent: false, suppressed: false, pressedAt: 0, timer: null },
}

let arcadeTimeLoopTimer = null
const ARCADE_TIME_GRACE_MS = 0
let arcadeTimeoutPauseApplied = false
let arcadeTimeoutPauseConfirmed = false
let arcadeTimeoutPausePending = false

const gameOverState = { P1: false, P2: false }
const gameOverTimer = { P1: null, P2: null }
const GAME_OVER_DISPLAY_MS = 3000

const LIFE_LOSS_IDLE_THRESHOLD_MS = 15000 // 15 seconds
const LIFE_LOSS_GRACE_MS = 1500 // start-after-death window
let lastArcadeOsdMessage = ''
let lastArcadeOsdAt = 0
const arcadeContinueCountdownTimers = { P1: null, P2: null }
let arcadePromptLoopTimer = null
let buyIntentState = 'idle'
const buyIntentUntil = 0
let arcadePromptBlinkPhase = false
let lastArcadePromptLoopMessage = ''
let lastArcadePromptLoopSentAt = 0
let arcadeBalanceSyncTimer = null
let arcadeBalanceSyncInFlight = false

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

const displayRuntime = createDisplayRuntime({
  logger: console,
  isPi: IS_PI,
  singleXMode: SINGLE_X_MODE,
  useSplashTransitions: USE_SPLASH_TRANSITIONS,
  retroarchTtyXSession: RETROARCH_TTY_X_SESSION,
  retroarchTtyXPrewarm: RETROARCH_TTY_X_PREWARM,
  keepUiAliveDuringTtyX: KEEP_UI_ALIVE_DURING_TTY_X,
  retroarchReadyFile: RETROARCH_READY_FILE,
  getSplashStartedForRetroarch: () => splashStartedForRetroarch,
  setSplashStartedForRetroarch(value) {
    splashStartedForRetroarch = value
  },
  getArcadeUiStoppedForRetroarch: () => arcadeUiStoppedForRetroarch,
  setArcadeUiStoppedForRetroarch(value) {
    arcadeUiStoppedForRetroarch = value
  },
  getRetroXWarmRequested: () => retroXWarmRequested,
  setRetroXWarmRequested(value) {
    retroXWarmRequested = value
  },
  getRetroarchReadyWatchTimer: () => retroarchReadyWatchTimer,
  setRetroarchReadyWatchTimer(value) {
    retroarchReadyWatchTimer = value
  },
  getRetroarchActive: () => retroarchActive,
  getRetroarchProcess: () => retroarchProcess,
  getTargetUiVT,
  switchToVTWithRetry,
  switchToVT,
  splashVT: SPLASH_VT,
  runXClientCommand,
  getChromiumUiHidden: () => chromiumUiHidden,
  setChromiumUiHidden(value) {
    chromiumUiHidden = value
  },
})

// ============================
// BOOT
// ============================

console.log(`
ARCADE INPUT SERVICE
--------------------
USB Encoder : /dev/input/casino
GPIO Chip   : ${GPIOCHIP}
Runtime Mode: ${IS_PI ? 'Raspberry Pi (hardware)' : `compat (${process.platform})`}
Display Mode : ${SINGLE_X_MODE ? 'single-x(:0)' : `tty ui=${UI_VT} game=${GAME_VT}`}
Splash VT    : ${SPLASH_VT}
UI Keepalive : ${KEEP_UI_ALIVE_DURING_TTY_X ? 'tty-x on' : 'tty-x off'}
Splash Transit: ${USE_SPLASH_TRANSITIONS ? 'enabled' : 'disabled'}
Retro P1 In : ${RETROARCH_PRIMARY_INPUT}
Casino Exit : ${CASINO_MENU_EXITS_RETROARCH ? 'enabled' : 'disabled'}
Exit Guard  : ${RETROARCH_EXIT_GUARD_MS}ms
Start Guard : ${RETROARCH_START_INPUT_GUARD_MS}ms
Exit Confirm: ${RETROARCH_EXIT_CONFIRM_WINDOW_MS}ms
Exit Cooldown: ${RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS}ms
RA Config   : ${RETROARCH_CONFIG_PATH || '(default)'}
RA Binary   : ${RETROARCH_BIN}
RA OSD Cmd  : ${ARCADE_RETRO_OSD_ENABLED ? RETROARCH_OSD_COMMAND : 'disabled'} (${ARCADE_RETRO_OSD_COOLDOWN_MS}ms)
RA OSD Retry: ${ARCADE_RETRO_OSD_RETRY_COUNT}x/${ARCADE_RETRO_OSD_RETRY_INTERVAL_MS}ms
RA OSD Prompt: ${ARCADE_RETRO_OSD_PROMPT_PERSIST ? `on/${ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS}ms` : 'off'} (${ARCADE_RETRO_OSD_PROMPT_BLINK ? 'blink' : 'steady'})
RA OSD Style: ${ARCADE_RETRO_OSD_STYLE}${ARCADE_RETRO_OSD_STYLE === 'hud' ? ` (${ARCADE_RETRO_OSD_LABEL || 'HUD'})` : ''}
Continue OSD: ${ARCADE_LIFE_CONTINUE_SECONDS > 0 ? `${ARCADE_LIFE_CONTINUE_SECONDS}s` : 'disabled'}
Life Buy Btn : ${[...ARCADE_LIFE_PURCHASE_BUTTON_INDEXES].join(',')} (${ARCADE_LIFE_PURCHASE_LABEL})
Life Bal Sync: ${hasSupabaseRpcConfig() ? `on/${ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS}ms` : 'off'}
UI Restart  : ${RESTART_UI_ON_EXIT ? 'enabled' : 'disabled'} (${UI_RESTART_COOLDOWN_MS}ms)
Arcade Time : default=₱${ARCADE_LIFE_PRICE_DEFAULT} failOpen=${ARCADE_LIFE_FAIL_OPEN ? 'yes' : 'no'}
Supabase RPC: ${SUPABASE_URL ? 'configured' : 'missing'} / key=${SUPABASE_SERVICE_KEY ? 'set' : 'missing'}

Ctrl+C to exit
`)

ensureSplashReady()
ensureRetroXWarm()

const sseClients = new Set()

function sendSse(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    return true
  } catch (err) {
    console.error('[SSE SEND ERROR]', err.message)
    return false
  }
}

function broadcast(payload) {
  for (const client of [...sseClients]) {
    if (!sendSse(client, payload)) {
      try {
        client.end()
      } catch {}
      sseClients.delete(client)
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

function hasSupabaseRpcConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY)
}

function getSupabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

const arcadeTimeBackendSync = createArcadeTimeBackendSync({
  logger: console,
  deviceId: DEVICE_ID,
  supabaseUrl: SUPABASE_URL,
  arcadeLifeBalanceSyncIntervalMs: ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS,
  hasSupabaseRpcConfig,
  getSupabaseHeaders,
  requestJsonWithCurl,
  safeRpcCall,
  toMoney,
  getArcadeSession: () => arcadeSession,
  getArcadeTimePersistRequestedMs: () => arcadeTimePersistRequestedMs,
  setArcadeTimePersistRequestedMs(value) {
    arcadeTimePersistRequestedMs = value
  },
  getArcadeTimePersistCommittedMs: () => arcadeTimePersistCommittedMs,
  setArcadeTimePersistCommittedMs(value) {
    arcadeTimePersistCommittedMs = value
  },
  getArcadeTimePersistInFlight: () => arcadeTimePersistInFlight,
  setArcadeTimePersistInFlight(value) {
    arcadeTimePersistInFlight = value
  },
  getArcadeTimePersistTimer: () => arcadeTimePersistTimer,
  setArcadeTimePersistTimer(value) {
    arcadeTimePersistTimer = value
  },
  clearArcadeTimePersistTimer,
  getArcadeBalanceSyncTimer: () => arcadeBalanceSyncTimer,
  setArcadeBalanceSyncTimer(value) {
    arcadeBalanceSyncTimer = value
  },
  getArcadeBalanceSyncInFlight: () => arcadeBalanceSyncInFlight,
  setArcadeBalanceSyncInFlight(value) {
    arcadeBalanceSyncInFlight = value
  },
  shouldDeferArcadeBalanceSync,
  getArcadeBalancePushFloor: () => arcadeBalancePushFloor,
  clearArcadeBalancePushFloor,
  broadcastArcadeLifeState,
  refreshArcadeOsdMessage,
})
const deviceBackendReads = createDeviceBackendReads({
  logger: console,
  deviceId: DEVICE_ID,
  supabaseUrl: SUPABASE_URL,
  hasSupabaseRpcConfig,
  getSupabaseHeaders,
  requestJsonWithCurl,
  toMoney,
  normalizeArcadeJoinMode,
  resolveCorePath,
  resolveRomPath,
  arcadeLifePriceDefault: ARCADE_LIFE_PRICE_DEFAULT,
})
const deviceBackendWrites = createDeviceBackendWrites({
  logger: console,
  deviceId: DEVICE_ID,
  isPi: IS_PI,
  supabaseUrl: SUPABASE_URL,
  hasSupabaseRpcConfig,
  getSupabaseHeaders,
  requestJsonWithCurl,
  safeRpcCall,
  toMoney,
  formatPeso,
  fetchDeviceFinancialState,
  getHopperActive: () => hopperActive,
  getActiveWithdrawalContext: () => activeWithdrawalContext,
})

function toMoney(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.round(parsed * 100) / 100)
}

async function ensureDeviceRegistered(deviceId) {
  return deviceBackendReads.ensureDeviceRegistered(deviceId)
}

async function fetchDeviceFinancialState(deviceId = DEVICE_ID) {
  return deviceBackendReads.fetchDeviceFinancialState(deviceId)
}

function getMaxWithdrawalAmountForHopperBalance(hopperBalance) {
  return deviceBackendWrites.getMaxWithdrawalAmountForHopperBalance(hopperBalance)
}

async function recordWithdrawalDispense(amount) {
  return deviceBackendWrites.recordWithdrawalDispense(amount)
}

async function recordHopperTopup(amount) {
  return deviceBackendWrites.recordHopperTopup(amount)
}

async function recordCoinDeposit(amount) {
  return deviceBackendWrites.recordCoinDeposit(amount)
}

async function validateWithdrawRequest(amount) {
  return deviceBackendWrites.validateWithdrawRequest(amount)
}

function formatPeso(
  amount,
  withSymbol = false,
  withDecimal = true,
  decimalCount = 2,
  abbreviate = false,
) {
  const num = Number(amount)
  if (isNaN(num)) return withSymbol ? '$0' : '0'

  const sign = num < 0 ? '-' : ''
  const abs = Math.abs(num)

  let value

  if (abbreviate) {
    if (abs >= 1_000_000_000) {
      const v = Math.floor((abs / 1_000_000_000) * 100) / 100
      value = v.toString().replace(/\.00$/, '') + 'B'
    } else if (abs >= 1_000_000) {
      const v = Math.floor((abs / 1_000_000) * 100) / 100
      value = v.toString().replace(/\.00$/, '') + 'M'
    } else if (abs >= 10_000) {
      const v = Math.floor((abs / 1_000) * 100) / 100
      value = v.toString().replace(/\.00$/, '') + 'K'
    } else {
      value = abs.toLocaleString()
    }
  } else {
    value = abs.toFixed(withDecimal ? decimalCount : 2).replace(/\d(?=(\d{3})+\.)/g, '$&,')

    if (withDecimal && decimalCount > 2 && value.endsWith('.00')) {
      value = value.slice(0, -3)
    }
  }

  return `${sign}${withSymbol ? '$' : ''}${value}`
}

function isStartButton(index) {
  return START_BUTTON_INDEXES.has(index)
}

function isLifePurchaseButton(index) {
  return ARCADE_LIFE_PURCHASE_BUTTON_INDEXES.has(index)
}

function getArcadeLifePromptActionLabel() {
  const label = String(ARCADE_LIFE_PURCHASE_LABEL || 'BUY')
    .trim()
    .toUpperCase()
  return label === 'START' ? 'BUY' : label
}

function normalizeArcadeJoinMode(value) {
  const mode = String(value || 'simultaneous')
    .toLowerCase()
    .trim()
  if (mode === 'alternating' || mode === 'single_only') return mode
  return 'simultaneous'
}

function normalizeArcadePlayer(source) {
  const mapped = resolveRetroInputSource(source)
  if (mapped === 'P1' || mapped === 'P2') return mapped
  return null
}

function sendRetroarchNetCommand(command, options = {}) {
  if (!ARCADE_RETRO_OSD_ENABLED) return
  if (!retroarchActive) return
  if (RETROARCH_TTY_X_SESSION && !fs.existsSync(RETROARCH_READY_FILE)) return

  const clean = String(command || '').trim()
  const message = `${clean}\n`
  if (!message.trim()) return
  const urgent = options?.urgent === true
  const retryCount = Math.max(1, ARCADE_RETRO_OSD_RETRY_COUNT)
  const retryIntervalMs = urgent ? 60 : ARCADE_RETRO_OSD_RETRY_INTERVAL_MS

  const sendViaStdin = attempt => {
    if (RETROARCH_TTY_X_SESSION) return false
    if (!retroarchProcess?.stdin?.writable) return false
    try {
      retroarchProcess.stdin.write(message)
      console.log(
        `[RETROARCH OSD] #${attempt}/${retryCount}${urgent ? ' urgent' : ''} stdin ${clean}`,
      )
      return true
    } catch (err) {
      console.error('[RETROARCH OSD] stdin send failed', err?.message || err)
      return false
    }
  }

  const sendOnce = attempt => {
    if (sendViaStdin(attempt)) return
    if (!Number.isFinite(RETROARCH_NETCMD_PORT) || RETROARCH_NETCMD_PORT <= 0) return
    const udpSocket = dgram.createSocket('udp4')
    const udpPayload = Buffer.from(message, 'utf8')
    udpSocket.send(udpPayload, RETROARCH_NETCMD_PORT, RETROARCH_NETCMD_HOST, err => {
      if (err) {
        console.error('[RETROARCH OSD] UDP send failed', err.message)
      }
      udpSocket.close()
    })
    console.log(`[RETROARCH OSD] #${attempt}/${retryCount}${urgent ? ' urgent' : ''} ${clean}`)
  }

  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    const delay = (attempt - 1) * retryIntervalMs
    if (delay <= 0) {
      sendOnce(attempt)
      continue
    }
    setTimeout(() => {
      if (!retroarchActive) return
      sendOnce(attempt)
    }, delay)
  }
}

async function requestRetroarchNetResponse(command, timeoutMs = 250) {
  if (!retroarchActive) return null
  if (!Number.isFinite(RETROARCH_NETCMD_PORT) || RETROARCH_NETCMD_PORT <= 0) return null

  const clean = String(command || '').trim()
  if (!clean) return null

  return new Promise(resolve => {
    const udpSocket = dgram.createSocket('udp4')
    let settled = false

    const settle = value => {
      if (settled) return
      settled = true
      try {
        udpSocket.close()
      } catch {}
      resolve(value)
    }

    const timeout = setTimeout(() => settle(null), Math.max(50, Math.round(timeoutMs)))

    udpSocket.on('error', () => {
      clearTimeout(timeout)
      settle(null)
    })

    udpSocket.on('message', message => {
      clearTimeout(timeout)
      settle(String(message || '').trim() || null)
    })

    udpSocket.bind(0, '0.0.0.0', () => {
      const payload = Buffer.from(`${clean}\n`, 'utf8')
      udpSocket.send(payload, RETROARCH_NETCMD_PORT, RETROARCH_NETCMD_HOST, err => {
        if (err) {
          clearTimeout(timeout)
          settle(null)
        }
      })
    })
  })
}

async function queryRetroarchPlaybackStatus() {
  const response = await requestRetroarchNetResponse('GET_STATUS', 300)
  if (!response) return null
  if (response.includes('GET_STATUS PAUSED')) return 'PAUSED'
  if (response.includes('GET_STATUS PLAYING')) return 'PLAYING'
  return null
}

async function ensureArcadeTimeoutPause() {
  if (!arcadeSession?.active) return
  if (!retroarchActive) return
  if (arcadeTimeoutPauseConfirmed || arcadeTimeoutPausePending) return

  arcadeTimeoutPausePending = true

  try {
    const status = await queryRetroarchPlaybackStatus()
    if (!arcadeSession?.active || !retroarchActive) return
    if ((arcadeSession.arcadeTimeMs || 0) > 0) return

    if (status === 'PAUSED') {
      arcadeTimeoutPauseConfirmed = true
      console.log('[ARCADE TIME] expiry pause skipped (already paused)')
      return
    }

    // Fallback to toggling pause even if status probing failed, since protecting the session is higher priority.
    sendRetroarchNetCommand('PAUSE_TOGGLE', { urgent: true })
    arcadeTimeoutPauseApplied = true
    arcadeTimeoutPauseConfirmed = true
    setArcadeOverlayNotice('TIME UP - PAUSED', 1500, 'center')
    refreshArcadeOsdMessage()
    console.log('[ARCADE TIME] expiry pause triggered', {
      remainingMs: arcadeSession.arcadeTimeMs || 0,
      status: status || 'unknown',
    })
  } finally {
    arcadeTimeoutPausePending = false
  }
}

function resetArcadeTimeoutPauseState() {
  const nextState = resetArcadeTimeoutPauseStateHelper()
  arcadeTimeoutPauseApplied = nextState.applied
  arcadeTimeoutPauseConfirmed = nextState.confirmed
  arcadeTimeoutPausePending = nextState.pending
}

function isArcadeTimeLockActive() {
  return isArcadeTimeLockActiveHelper(arcadeSession, arcadeTimeoutPauseConfirmed)
}

function showArcadeOsdMessage(message, options = {}) {
  if (RETROARCH_OSD_COMMAND === 'OFF' || RETROARCH_OSD_COMMAND === 'NONE') return

  const allowBlank = options?.allowBlank === true
  const bypassCooldown = options?.bypassCooldown === true
  const urgent = options?.urgent === true
  const source = String(message || '').replace(/[\r\n\t]/g, ' ')
  const normalized =
    ARCADE_RETRO_OSD_STYLE === 'footer'
      ? source.slice(0, 180)
      : source.replace(/\s+/g, ' ').slice(0, 120)
  const text = allowBlank ? normalized : normalized.trim()
  if (!text && !allowBlank) return

  const messageKey = text || '__BLANK__'

  const now = Date.now()
  if (!bypassCooldown && messageKey === lastArcadeOsdMessage) {
    if (now - lastArcadeOsdAt < ARCADE_RETRO_OSD_COOLDOWN_MS) return
  }
  lastArcadeOsdMessage = messageKey
  lastArcadeOsdAt = now

  const osdCommands = (() => {
    if (RETROARCH_OSD_COMMAND === 'AUTO') return ['SHOW_MESG', 'SHOW_MSG']
    if (RETROARCH_OSD_COMMAND === 'SHOW_MSG') return ['SHOW_MSG']
    if (RETROARCH_OSD_COMMAND === 'SHOW_MESG') return ['SHOW_MESG']
    return [RETROARCH_OSD_COMMAND]
  })()

  const seen = new Set()
  for (const osdCommand of osdCommands) {
    if (seen.has(osdCommand)) continue
    seen.add(osdCommand)
    const command = text ? `${osdCommand} ${text}` : osdCommand
    sendRetroarchNetCommand(command, { urgent })
  }
}

function formatArcadeBalanceForOsd(rawBalance) {
  if (rawBalance === null || rawBalance === undefined) return '0.00'
  return formatPeso(toMoney(rawBalance, 0))
}

function isBlockedCasinoActionDuringRetroarch(action) {
  return action === 'WITHDRAW' || action === 'WITHDRAW_COIN'
}

function composeArcadeOsdOverlay(message, balanceOverride = null, options = null) {
  const base = String(message || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!arcadeSession?.active) return base

  const rawBalance =
    balanceOverride === null || balanceOverride === undefined
      ? arcadeSession.lastKnownBalance
      : balanceOverride
  const balanceText = formatArcadeBalanceForOsd(rawBalance)
  const balanceBanner = `Balance ₱${balanceText}`

  if (ARCADE_RETRO_OSD_STYLE === 'footer') {
    const footerState = getArcadeRetroFooterState(balanceOverride)
    const leftText = footerState.leftText
    const centerText = footerState.centerText
    const rightText = footerState.rightText

    const centerIn = (txt, w) => {
      const lines = String(txt || '').split('\n')

      return lines
        .map(line => {
          const clean = line.trim()

          if (clean.length >= w) return clean.slice(0, w)

          const leftPad = Math.floor((w - clean.length) / 2)
          const rightPad = w - clean.length - leftPad

          return `${' '.repeat(leftPad)}${clean}${' '.repeat(rightPad)}`
        })
        .join('\n')
    }
    // 3 equal visual zones inside one OSD line.
    const colW = 20
    const gap = '       '

    const leftCol = centerIn(leftText, colW)
    const centerCol = centerIn(centerText, colW)
    const rightCol = centerIn(rightText, colW)

    return `${leftCol}${gap}${centerCol}${gap}${rightCol}`
  }

  if (ARCADE_RETRO_OSD_STYLE === 'hud') {
    const hudParts = []
    if (ARCADE_RETRO_OSD_LABEL) hudParts.push(ARCADE_RETRO_OSD_LABEL)
    const isOffline = typeof hasLocalNetworkLink === 'function' && !hasLocalNetworkLink()

    hudParts.push(isOffline ? 'OFFLINE' : balanceBanner)
    hudParts.push(arcadeOverlayNotice || base)
    if (ARCADE_RETRO_OSD_SHOW_SESSION_STATS) {
      hudParts.push(
        `TIME:${formatArcadeTime(arcadeSession?.arcadeTimeMs || 0)}`,
        `Balance:P${balanceText}`,
      )
    }
    const continueSeconds = Number(options?.continueSeconds)
    if (Number.isFinite(continueSeconds) && continueSeconds >= 0) {
      hudParts.push(`CONTINUE:${String(Math.round(continueSeconds)).padStart(2, '0')}`)
    }
    return hudParts.join(' | ')
  }

  return `${arcadeOverlayNotice || base} | TIME:${formatArcadeTime(arcadeSession?.arcadeTimeMs || 0)} Balance:P${balanceText}`
}

function getArcadeRetroFooterState(balanceOverride = null) {
  const rawBalance =
    balanceOverride === null || balanceOverride === undefined
      ? arcadeSession?.lastKnownBalance
      : balanceOverride
  const balanceText = formatArcadeBalanceForOsd(rawBalance)
  const now = Date.now()
  const exitConfirmArmed = Number(retroarchExitConfirmUntil || 0) > now
  const hasTime = Number(arcadeSession?.arcadeTimeMs || 0) > 0
  const joinMode = normalizeArcadeJoinMode(arcadeSession?.joinMode)
  const sessionPhase = String(arcadeSession?.sessionPhase || 'prestart')
  const p2BlockedMidRun = joinMode === 'alternating' && sessionPhase === 'live'
  const p2Disabled = joinMode === 'single_only'

  const isOffline = typeof hasLocalNetworkLink === 'function' && !hasLocalNetworkLink()

  let leftBase

  if (gameOverState.P1) {
    leftBase = 'P1 · GAME OVER'
  } else if (isOffline) {
    leftBase = 'P1 · OFFLINE'
  } else if (hasTime) {
    leftBase = 'P1 · READY'
  } else {
    leftBase = 'P1 · LOCKED'
  }
  const timeText = formatArcadeTime(arcadeSession?.arcadeTimeMs || 0)

  const centerBase = exitConfirmArmed
    ? 'EXIT GAME?'
    : isOffline
      ? 'OFFLINE'
      : `TIME ${timeText} | ₱${balanceText}`

  let rightBase

  if (gameOverState.P2) {
    rightBase = 'P2 · GAME OVER'
  } else if (isOffline) {
    rightBase = 'P2 · OFFLINE'
  } else if (!hasTime) {
    if (p2Disabled) {
      rightBase = 'P2 · SOLO'
    } else if (p2BlockedMidRun) {
      rightBase = 'P2 · WAIT TURN'
    } else {
      rightBase = 'P2 · LOCKED'
    }
  } else {
    rightBase = p2Disabled ? 'P2 · SOLO' : p2BlockedMidRun ? 'P2 · WAIT TURN' : 'P2 · READY'
  }

  const visible = true

  return {
    active: Boolean(arcadeSession?.active),
    visible,
    gameName: arcadeSession?.gameName || null,
    balanceText,
    leftText: arcadeOverlayNotice?.slot === 'left' ? arcadeOverlayNotice.text : leftBase,
    centerText: arcadeOverlayNotice?.slot === 'center' ? arcadeOverlayNotice.text : centerBase,
    rightText: arcadeOverlayNotice?.slot === 'right' ? arcadeOverlayNotice.text : rightBase,
    p1HasCredit: hasTime,
    p2HasCredit: hasTime,
    joinMode,
    sessionPhase,
    p1ConfirmArmed: false,
    p2ConfirmArmed: false,
    exitConfirmArmed,
    notice: arcadeOverlayNotice
      ? {
          text: arcadeOverlayNotice.text,
          slot: arcadeOverlayNotice.slot,
        }
      : null,
  }
}

function getArcadeRetroOverlayState() {
  return {
    active: Boolean(arcadeSession?.active),
    retroarchActive,
    gameName: arcadeSession?.gameName || null,
    gameId: arcadeSession?.gameId || null,
    pricePerLife: arcadeSession?.active ? getArcadeSessionPrice() : null,
    joinMode: arcadeSession?.active ? normalizeArcadeJoinMode(arcadeSession?.joinMode) : null,
    sessionPhase: arcadeSession?.active ? arcadeSession?.sessionPhase || 'prestart' : null,
    balance:
      arcadeSession?.lastKnownBalance === null || arcadeSession?.lastKnownBalance === undefined
        ? null
        : arcadeSession.lastKnownBalance,
    footer: getArcadeRetroFooterState(),
    updatedAt: Date.now(),
  }
}

function pulseVirtualKey(proc, keyCode, holdMs = 45) {
  sendVirtual(proc, EV_KEY, keyCode, 1)
  setTimeout(
    () => {
      sendVirtual(proc, EV_KEY, keyCode, 0)
    },
    Math.max(10, holdMs),
  )
}

function getArcadeSessionPrice() {
  return getArcadeSessionPriceHelper(arcadeSession, ARCADE_LIFE_PRICE_DEFAULT, toMoney)
}

function clearArcadeContinueCountdown(player = null) {
  arcadePromptController.clearArcadeContinueCountdown(player)
}

function releaseAllVirtualInputsForPlayer(player) {
  const target = player === 'P1' ? virtualP1 : player === 'P2' ? virtualP2 : null
  if (!target) return

  sendVirtual(target, EV_KEY, BTN_SOUTH, 0)
  sendVirtual(target, EV_KEY, BTN_EAST, 0)
  sendVirtual(target, EV_KEY, BTN_NORTH, 0)
  sendVirtual(target, EV_KEY, BTN_WEST, 0)
  sendVirtual(target, EV_KEY, BTN_TL, 0)
  sendVirtual(target, EV_KEY, BTN_TR, 0)
  sendVirtual(target, EV_KEY, BTN_SELECT, 0)
  sendVirtual(target, EV_KEY, BTN_START, 0)
  sendVirtual(target, EV_KEY, BTN_DPAD_UP, 0)
  sendVirtual(target, EV_KEY, BTN_DPAD_DOWN, 0)
  sendVirtual(target, EV_KEY, BTN_DPAD_LEFT, 0)
  sendVirtual(target, EV_KEY, BTN_DPAD_RIGHT, 0)

  dpadState[player] = { up: false, down: false, left: false, right: false }
}

function getOtherArcadePlayer(player) {
  if (player === 'P1') return 'P2'
  if (player === 'P2') return 'P1'
  return null
}

function clearPendingRetroarchStartTimer(player) {
  const state = retroarchStartPressState[player]
  if (!state || !state.timer) return
  clearTimeout(state.timer)
  state.timer = null
}

function resetRetroarchStartPressState(player) {
  const state = retroarchStartPressState[player]
  if (!state) return
  clearPendingRetroarchStartTimer(player)
  state.pressed = false
  state.sent = false
  state.suppressed = false
  state.pressedAt = 0
}

function releaseRetroarchStartIfSent(player) {
  const state = retroarchStartPressState[player]
  const target = getRetroVirtualTarget(player)
  if (!state || !state.sent || !target) return
  sendVirtual(target, EV_KEY, BTN_START, 0)
  state.sent = false
}

function handleSimultaneousRetroarchStart(player, target, value) {
  const state = retroarchStartPressState[player]
  const otherPlayer = getOtherArcadePlayer(player)
  const otherState = otherPlayer ? retroarchStartPressState[otherPlayer] : null

  if (!state || !otherState) return false

  if (value === 1) {
    state.pressed = true
    state.suppressed = false
    state.pressedAt = Date.now()

    if (
      otherState.pressed &&
      state.pressedAt - Number(otherState.pressedAt || 0) <=
        RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS
    ) {
      clearPendingRetroarchStartTimer(player)
      clearPendingRetroarchStartTimer(otherPlayer)
      releaseRetroarchStartIfSent(player)
      releaseRetroarchStartIfSent(otherPlayer)
      state.suppressed = true
      otherState.suppressed = true
      console.log('[RETROARCH] simultaneous START suppressed', {
        players: [otherPlayer, player],
        windowMs: RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS,
      })
      return true
    }

    clearPendingRetroarchStartTimer(player)
    state.timer = setTimeout(() => {
      state.timer = null
      if (!state.pressed || state.suppressed || state.sent) return
      sendVirtual(target, EV_KEY, BTN_START, 1)
      state.sent = true
    }, RETROARCH_SIMULTANEOUS_START_SUPPRESS_WINDOW_MS)
    return true
  }

  if (value === 0) {
    clearPendingRetroarchStartTimer(player)
    if (state.sent) {
      sendVirtual(target, EV_KEY, BTN_START, 0)
    }
    state.pressed = false
    state.sent = false
    state.suppressed = false
    state.pressedAt = 0
    return true
  }

  return false
}

function playerHasStoredCredit(player) {
  if (!arcadeSession?.active) return false
  if (player !== 'P1' && player !== 'P2') return false
  return Number(arcadeSession.arcadeTimeMs || 0) > 0
}

function shouldPromoteArcadeSessionToLive(player, index) {
  if (!arcadeSession?.active) return false
  if (!playerHasStoredCredit(player)) return false
  if (isStartButton(index)) return false
  if (retroarchActive && !canAcceptRetroarchStartInput()) return false
  return true
}

function markArcadeSessionLive(reason = 'gameplay_input') {
  if (!arcadeSession?.active) return
  if (arcadeSession.sessionPhase === 'live') return

  arcadeSession.sessionPhase = 'live'
  maybeStartArcadeTimeSession(reason)
  startArcadeTimeLoop()

  broadcastArcadeLifeState('live', { reason, sessionPhase: 'live' })
  refreshArcadeOsdMessage()
}

function isArcadePurchaseAllowed(player) {
  if (!arcadeSession?.active) return true
  if (player !== 'P1' && player !== 'P2') return false

  const joinMode = normalizeArcadeJoinMode(arcadeSession.joinMode)
  const sessionPhase = String(arcadeSession.sessionPhase || 'prestart')

  if (joinMode === 'single_only') return player === 'P1'
  if (joinMode === 'alternating' && sessionPhase === 'live' && player === 'P2') return false
  return true
}

function getBlockedPurchaseMessage(player) {
  const joinMode = normalizeArcadeJoinMode(arcadeSession?.joinMode)
  if (joinMode === 'single_only') return '1 PLAYER ONLY'
  if (joinMode === 'alternating' && player === 'P2') return 'P2 NEXT TURN'
  return 'START UNAVAILABLE'
}

function clearArcadePromptLoop() {
  arcadePromptController.clearArcadePromptLoop()
}

function startArcadeTimeLoop() {
  arcadeTimeService.startArcadeTimeLoop()
}

function stopArcadeTimeLoop() {
  arcadeTimeService.stopArcadeTimeLoop()
}

function buildArcadePromptMessage() {
  return arcadePromptController.buildArcadePromptMessage()
}

function scheduleArcadePromptLoop() {
  arcadePromptController.scheduleArcadePromptLoop()
}

function startArcadeContinueCountdown(player) {
  arcadePromptController.startArcadeContinueCountdown(player)
}

function broadcastArcadeLifeState(status = 'state', extra = {}) {
  arcadeTimeService.broadcastArcadeLifeState(status, extra)
}

async function fetchDeviceBalanceSnapshot() {
  return arcadeTimeBackendSync.fetchDeviceBalanceSnapshot()
}

async function persistDeviceArcadeTimeSnapshot(timeMs) {
  return arcadeTimeBackendSync.persistDeviceArcadeTimeSnapshot(timeMs)
}

async function flushArcadeTimePersistence(options = {}) {
  return arcadeTimeBackendSync.flushArcadeTimePersistence(options)
}

function scheduleArcadeTimePersistence(timeMs, options = {}) {
  return arcadeTimeBackendSync.scheduleArcadeTimePersistence(timeMs, options)
}

function maybeStartArcadeTimeSession(reason = 'ready') {
  return arcadeTimeService.maybeStartArcadeTimeSession(reason)
}

function clearArcadeBalanceSyncLoop() {
  arcadeTimeBackendSync.clearArcadeBalanceSyncLoop()
}

async function syncArcadeSessionBalance(options = {}) {
  return arcadeTimeBackendSync.syncArcadeSessionBalance(options)
}

function scheduleArcadeBalanceSyncLoop() {
  arcadeTimeBackendSync.scheduleArcadeBalanceSyncLoop()
}

function startArcadeLifeSession({
  gameId,
  gameName,
  pricePerLife,
  initialBalance = null,
  initialArcadeTimeMs = 0,
  joinMode = 'simultaneous',
}) {
  arcadeTimeService.startArcadeLifeSession({
    gameId,
    gameName,
    pricePerLife,
    initialBalance,
    initialArcadeTimeMs,
    joinMode,
  })
}

function clearArcadeLifeSession(reason = 'ended') {
  arcadeTimeService.clearArcadeLifeSession(reason)
}

async function fetchGameProfileForArcadeLife(gameId) {
  if (!hasSupabaseRpcConfig()) return null

  const safeId = String(gameId || '').trim()
  if (!safeId) return null

  const url =
    `${SUPABASE_URL}/rest/v1/games?` +
    `select=id,name,price,type,enabled,join_mode&id=eq.${encodeURIComponent(safeId)}&type=eq.arcade&limit=1`

  try {
    const response = await requestJsonWithCurl(url, {
      method: 'GET',
      headers: getSupabaseHeaders(),
      timeoutMs: 2500,
    })
    if (!response.ok) {
      const text = response.text || ''
      console.error('[ARCADE LIFE] game profile fetch failed', response.status, text)
      return null
    }

    const rows = response.json()
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || row.enabled === false) return null

    return {
      gameId: row.id || safeId,
      gameName: row.name || safeId,
      pricePerLife: toMoney(row.price, ARCADE_LIFE_PRICE_DEFAULT),
      joinMode: normalizeArcadeJoinMode(row.join_mode),
    }
  } catch (err) {
    console.error('[ARCADE LIFE] game profile fetch error', err?.message || err)
    return null
  }
}

async function fetchCabinetGamesForDevice(deviceId = DEVICE_ID) {
  return deviceBackendReads.fetchCabinetGamesForDevice(deviceId)
}

async function rpcBuyArcadeCredit({ deviceId, gameId }) {
  return arcadeBuyFlow.rpcBuyArcadeCredit({ deviceId, gameId })
}

let lastBuyAt = 0
const BUY_COOLDOWN_MS = 1500

function addArcadeTime(ms) {
  if (!arcadeSession?.active) return

  arcadeSession.arcadeTimeMs = (arcadeSession.arcadeTimeMs || 0) + ms
  arcadeTimePersistRequestedMs = arcadeSession.arcadeTimeMs

  refreshArcadeOsdMessage?.()
}

const arcadeBuyFlow = createArcadeBuyFlow({
  logger: console,
  deviceId: DEVICE_ID,
  supabaseUrl: SUPABASE_URL,
  buyConfirmWindowMs: BUY_CONFIRM_WINDOW_MS,
  buyCooldownMs: BUY_COOLDOWN_MS,
  arcadeTimePurchaseMs: ARCADE_TIME_PURCHASE_MS,
  hasSupabaseRpcConfig,
  getSupabaseHeaders,
  requestJsonWithCurl,
  withTimeout,
  toMoney,
  getArcadeSession: () => arcadeSession,
  getBuyState: () => buyState,
  setBuyState(value) {
    buyState = value
  },
  getBuyConfirmAt: () => buyConfirmAt,
  setBuyConfirmAt(value) {
    buyConfirmAt = value
  },
  getLastBuyAt: () => lastBuyAt,
  setLastBuyAt(value) {
    lastBuyAt = value
  },
  getArcadeTimeoutPauseConfirmed: () => arcadeTimeoutPauseConfirmed,
  addArcadeTime,
  noteArcadeBalancePush,
  broadcastArcadeLifeState,
  showArcadeOsdMessage,
  composeArcadeOsdOverlay,
  setArcadeOverlayNotice,
  resetArcadeTimeoutPauseState,
  maybeStartArcadeTimeSession,
  startArcadeTimeLoop,
  scheduleArcadeTimePersistence,
})

async function handleBuyPressed() {
  return arcadeBuyFlow.handleBuyPressed()
}

// ============================
// DEPOSIT COIN HANDLING
// ============================

function handleDepositPulse() {
  coinAcceptor.handleDepositPulse()
  syncCoinAcceptorState()
}

function resolveDepositCredits(pulses) {
  return coinAcceptor.resolveDepositCredits(pulses)
}

function finalizeDepositCoin() {
  coinAcceptor.finalizeDepositCoin()
  syncCoinAcceptorState()
}

function resetDepositCoin() {
  coinAcceptor.resetDepositCoin()
  syncCoinAcceptorState()
  depositIdleTimer = null
}

// ============================
// HOPPER CONTROL
// ============================

const HARD_MAX_MS = 90_000

function startHopper(amount) {
  const started = hopperController.startHopper(toMoney(amount, 0))
  if (!started) return
  syncHopperState()
}

function handleWithdrawPulse() {
  hopperController.handleWithdrawPulse()
  syncHopperState()
}

function stopHopper() {
  hopperController.stopHopper()
  syncHopperState()
}

// ============================
// GPIO HELPERS
// ============================

const hopperCtl = null
const coinCtl = null

function gpioOn(pin) {
  gpioController.gpioOn(pin)
}

function gpioOff(pin) {
  gpioController.gpioOff(pin)
}

let lastCoinState = null

const gpioController = createGpioController({
  isPi: IS_PI,
  gpioChip: GPIOCHIP,
  coinInhibitPin: COIN_INHIBIT_PIN,
  logger: console,
})

function syncCoinAcceptorState() {
  const snapshot = coinAcceptor.getSnapshot()
  depositPulseCount = snapshot.pulseCount
  depositLastPulseTime = snapshot.lastPulseTime
  depositStartTime = snapshot.startTime
}

function syncHopperState() {
  const snapshot = hopperController.getSnapshot()
  hopperActive = snapshot.active
  hopperTarget = snapshot.target
  hopperDispensed = snapshot.dispensed
  hopperLastPulseAt = snapshot.lastPulseAt
  activeWithdrawalContext = snapshot.activeWithdrawalContext
  lastCoinState = gpioController.getSnapshot().lastCoinState
}

const coinAcceptor = createCoinAcceptor({
  idleGapMs: COIN_IDLE_GAP_MS,
  pesoByPulseCount: COIN_PESO_BY_PULSE_COUNT,
  setIdleTimer(callback, delayMs) {
    depositIdleTimer = setTimeout(callback, delayMs)
    return depositIdleTimer
  },
  clearIdleTimer(timer) {
    clearTimeout(timer)
    if (depositIdleTimer === timer) {
      depositIdleTimer = null
    }
  },
  onPulse(snapshot) {
    syncCoinAcceptorState()
    if (arcadeSession?.active) {
      arcadeSession.lastBalanceMutationAt = Date.now()
    }
    if (snapshot.pulseCount === 1) {
      console.log('\n[DEPOSIT] START')
    }
    console.log(`[DEPOSIT] PULSE #${snapshot.pulseCount} (+${snapshot.gapMs}ms)`)
  },
  onDepositResolved(result) {
    syncCoinAcceptorState()
    if (arcadeSession?.active) {
      arcadeSession.lastBalanceMutationAt = Date.now()
    }

    console.log(
      `[DEPOSIT] COIN pulses=${result.pulses} duration=${result.durationMs}ms credits=${result.credits}`,
    )

    if (result.credits <= 0) return

    if (arcadeSession?.active) {
      const previousBalance = arcadeSession.lastKnownBalance
      const optimisticBalance = toMoney(
        (previousBalance || 0) + result.credits,
        previousBalance || 0,
      )

      arcadeSession.lastKnownBalance = optimisticBalance
      noteArcadeBalancePush(optimisticBalance)
      broadcastArcadeLifeState('balance_push', { balance: optimisticBalance })
      showArcadeOsdMessage(composeArcadeOsdOverlay(''), { bypassCooldown: true })
    }

    dispatch({
      type: 'COIN',
      credits: result.credits,
    })
    void recordCoinDeposit(result.credits)
  },
})

const hopperController = createHopperController({
  isPi: IS_PI,
  shuttingDown: () => shuttingDown,
  payPin: HOPPER_PAY_PIN,
  timeoutMs: HOPPER_TIMEOUT_MS,
  noPulseTimeoutMs: HOPPER_NO_PULSE_TIMEOUT_MS,
  gpio: gpioController,
  logger: console,
  onDispense(amount) {
    syncHopperState()
    dispatch({
      type: 'WITHDRAW_DISPENSE',
      dispensed: amount,
    })
    void recordWithdrawalDispense(amount)
  },
  onCompatComplete() {
    syncHopperState()
  },
  onComplete(result) {
    syncHopperState()
    dispatch({
      type: result.aborted ? 'WITHDRAW_ABORTED' : 'WITHDRAW_COMPLETE',
      dispensed: result.dispensed,
      requested: result.requested,
      aborted: result.aborted,
    })
  },
})

function setCoinInhibit(disabled) {
  gpioController.setCoinInhibit(disabled)
  lastCoinState = gpioController.getSnapshot().lastCoinState
}

let internetOkCount = 0
let internetFailCount = 0
let internetState = 'unknown'
let internetDebounceTimer = null
let internetLastStableState = 'unknown'
let internetBootGraceUntil = Date.now() + 3000 // 3s boot grace
let coinInhibitedByNetwork = false // Track if coins are inhibited due to network

async function checkInternetReachability() {
  try {
    const res = await checkCabinetBackendReachability()

    if (res.ok) {
      internetOkCount++
      internetFailCount = 0

      if (internetOkCount >= INTERNET_RESTORE_THRESHOLD) {
        if (internetLastStableState !== 'ok') {
          clearTimeout(internetDebounceTimer)
          internetDebounceTimer = setTimeout(() => {
            if (Date.now() < internetBootGraceUntil) return

            internetState = 'ok'
            internetLastStableState = 'ok'
            dispatch({ type: 'INTERNET_OK' })

            // Re-enable coins only if we inhibited them due to network
            if (coinInhibitedByNetwork) {
              setCoinInhibit(false)
              coinInhibitedByNetwork = false
            }
          }, 800)
        }
      }
    } else {
      throw new Error('not ok')
    }
  } catch {
    internetFailCount++
    internetOkCount = 0

    // 🔒 INSTANT COIN SAFETY: Inhibit coins IMMEDIATELY on first failure
    // No threshold wait - protect coins from day one
    if (internetLastStableState !== 'offline' && Date.now() >= internetBootGraceUntil) {
      console.warn('[COIN] Network failure detected - immediately inhibiting coins')

      // Only dispatch and stop hopper once, not on every failure
      if (internetState !== 'offline') {
        internetState = 'offline'
        internetLastStableState = 'offline'
        dispatch({ type: 'INTERNET_LOST' })

        // 🔒 HARD SAFETY: immediately stop hopper on internet loss
        if (hopperActive) {
          console.warn('[HOPPER] FORCE STOP due to internet loss')
          stopHopper()
        }
      }

      // Immediately inhibit coins - no debounce
      if (!coinInhibitedByNetwork) {
        setCoinInhibit(true)
        coinInhibitedByNetwork = true
      }
    }
  }
}

async function checkCabinetBackendReachability() {
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      return await requestJsonWithCurl(`${SUPABASE_URL}/rest/v1/devices?select=device_id&limit=1`, {
        method: 'GET',
        headers: getSupabaseHeaders(),
        timeoutMs: 2000,
      })
    } catch (error) {
      console.warn(
        '[NETWORK] Supabase reachability probe failed, falling back',
        error?.message || error,
      )
    }
  }

  try {
    return await requestJsonWithCurl('https://clients3.google.com/generate_204', {
      method: 'GET',
      timeoutMs: 2000,
    })
  } catch (error) {
    console.warn('[NETWORK] public internet probe failed', error?.message || error)
    return {
      ok: false,
      status: 0,
      text: '',
      json() {
        return null
      },
    }
  }
}

// Default to safe (reject coins) during boot stabilization
setCoinInhibit(true)
// Ensure first stable state resolves after boot
setTimeout(() => {
  internetBootGraceUntil = 0
}, 3000)
// start polling loop
setInterval(checkInternetReachability, 2000) // Check every 2 seconds for faster detection

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

const virtualInputRuntime = createVirtualInputRuntime({
  logger: console,
  isPi: IS_PI,
  helperPath: process.env.UINPUT_HELPER_PATH || '/opt/arcade/bin/uinput-helper',
  staggerMs: VIRTUAL_DEVICE_STAGGER_MS,
  setVirtualP1(value) {
    virtualP1 = value
  },
  setVirtualP2(value) {
    virtualP2 = value
  },
})

function startVirtualDevice(name) {
  return virtualInputRuntime.startVirtualDevice(name)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getArcadeShellUpdateStatus() {
  return {
    ...arcadeShellUpdateState,
    running: Boolean(arcadeShellUpdateChild),
    triggered: arcadeShellUpdateTriggered,
  }
}

function setArcadeShellUpdateState(patch) {
  arcadeShellUpdateState = {
    ...arcadeShellUpdateState,
    ...patch,
  }
}

async function canRunArcadeShellUpdate() {
  if (!IS_PI) {
    return { allowed: true, reason: null, deploymentMode: 'development' }
  }

  if (!hasSupabaseRpcConfig()) {
    return { allowed: false, reason: 'missing_backend_config', deploymentMode: null }
  }

  try {
    const state = await fetchDeviceFinancialState(DEVICE_ID)
    const deploymentMode =
      state?.deploymentMode === null || state?.deploymentMode === undefined
        ? null
        : String(state.deploymentMode).trim().toLowerCase() || null

    if (deploymentMode !== 'maintenance') {
      return {
        allowed: false,
        reason: deploymentMode ? 'device_not_in_maintenance' : 'missing_deployment_mode',
        deploymentMode,
      }
    }

    return { allowed: true, reason: null, deploymentMode }
  } catch (error) {
    console.error('[ARCADE SHELL UPDATE] maintenance check failed', error)
    return { allowed: false, reason: 'maintenance_check_failed', deploymentMode: null }
  }
}

async function triggerArcadeShellUpdate(reason = 'manual') {
  if (arcadeShellUpdateChild) {
    return { started: false, alreadyRunning: true, status: getArcadeShellUpdateStatus() }
  }

  if (arcadeShellUpdateTriggered) {
    return { started: false, alreadyTriggered: true, status: getArcadeShellUpdateStatus() }
  }

  const updateGate = await canRunArcadeShellUpdate()
  if (!updateGate.allowed) {
    const deploymentMode = updateGate.deploymentMode
    const message =
      deploymentMode && deploymentMode !== 'maintenance'
        ? `updates require maintenance mode; current mode is ${deploymentMode}`
        : 'updates require maintenance mode'

    setArcadeShellUpdateState({
      status: 'blocked',
      phase: 'maintenance-gate',
      label: 'Update blocked',
      detail: deploymentMode ? `deployment_mode=${deploymentMode}` : null,
      finishedAt: new Date().toISOString(),
      message,
      reason: updateGate.reason,
      exitCode: null,
    })

    return {
      started: false,
      blocked: true,
      deploymentMode,
      gateReason: updateGate.reason,
      status: getArcadeShellUpdateStatus(),
    }
  }

  const updaterPath =
    process.env.ARCADE_SHELL_UPDATER_BIN || '/usr/local/bin/arcade-shell-updater.mjs'

  if (!fs.existsSync(updaterPath)) {
    setArcadeShellUpdateState({
      status: 'failed',
      finishedAt: new Date().toISOString(),
      message: `missing updater: ${updaterPath}`,
      reason,
      exitCode: null,
    })
    return { started: false, missingUpdater: true, status: getArcadeShellUpdateStatus() }
  }

  arcadeShellUpdateTriggered = true
  setArcadeShellUpdateState({
    status: 'running',
    phase: 'shell-check',
    label: 'Checking for updates',
    detail: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: '[arcade-shell-updater] starting',
    reason,
    exitCode: null,
  })

  const child = spawn(updaterPath, ['--manual'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  arcadeShellUpdateChild = child

  const handleOutput = chunk => {
    const statusPrefix = '[arcade-shell-updater:status] '
    const lines = String(chunk || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return

    for (const line of lines) {
      if (line.startsWith(statusPrefix)) {
        try {
          const payload = JSON.parse(line.slice(statusPrefix.length))
          const nextState = {}

          if (typeof payload.phase === 'string') nextState.phase = payload.phase
          if (typeof payload.label === 'string') nextState.label = payload.label
          if ('detail' in payload) {
            nextState.detail =
              typeof payload.detail === 'string' && payload.detail.trim() ? payload.detail : null
          }
          if (typeof payload.message === 'string') {
            nextState.message = payload.message
          } else if (typeof payload.label === 'string') {
            nextState.message = [payload.label, payload.detail].filter(Boolean).join(': ')
          }
          if (typeof payload.completed === 'number') nextState.completed = payload.completed
          if (typeof payload.total === 'number') nextState.total = payload.total

          setArcadeShellUpdateState(nextState)
          continue
        } catch (error) {
          console.warn('[arcade-shell-updater] failed to parse status line', error)
        }
      }

      setArcadeShellUpdateState({ message: line })
      console.log(line)
    }
  }

  child.stdout.on('data', handleOutput)
  child.stderr.on('data', handleOutput)

  child.on('error', err => {
    arcadeShellUpdateChild = null
    arcadeShellUpdateTriggered = false
    setArcadeShellUpdateState({
      status: 'failed',
      finishedAt: new Date().toISOString(),
      message: err.message,
      exitCode: null,
    })
  })

  child.on('exit', code => {
    arcadeShellUpdateChild = null
    arcadeShellUpdateTriggered = false
    setArcadeShellUpdateState({
      status: code === 0 ? 'completed' : 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: code,
    })
  })

  return { started: true, status: getArcadeShellUpdateStatus() }
}

async function startVirtualDevices() {
  await virtualInputRuntime.startVirtualDevices()
}

function mapIndexToKey(index) {
  switch (index) {
    // Keep the virtual pad in standard RetroPad order.
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
    // Support both legacy 6/7 and modern 8/9 select/start layouts.
    case 6:
    case 8:
      return BTN_SELECT
    case 7:
    case 9:
      return BTN_START
    // Some encoders expose dpad as digital buttons.
    case 10:
      return BTN_DPAD_UP
    case 11:
      return BTN_DPAD_DOWN
    case 12:
      return BTN_DPAD_LEFT
    case 13:
      return BTN_DPAD_RIGHT
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

function canAcceptRetroarchStartInput() {
  if (!retroarchActive) return false
  if (RETROARCH_TTY_X_SESSION && !fs.existsSync(RETROARCH_READY_FILE)) return false
  if (!retroarchStartedAt) return true
  return Date.now() - retroarchStartedAt >= RETROARCH_START_INPUT_GUARD_MS
}

function clearRetroarchExitConfirm() {
  retroarchExitConfirmUntil = 0
  if (arcadeOverlayNotice?.slot === 'center' && arcadeOverlayNotice?.text === 'EXIT GAME?') {
    clearArcadeOverlayNotice()
  }
}

function handleRetroarchMenuExitIntent() {
  if (!CASINO_MENU_EXITS_RETROARCH) return false

  if (retroarchStopping) {
    console.warn('[LAUNCH] Ignored — RetroArch stopping')
    return true
  }

  if (!canAcceptRetroarchStop()) {
    console.log('[RETROARCH] MENU ignored by guard', {
      elapsedMs: retroarchStartedAt ? Date.now() - retroarchStartedAt : null,
      guardMs: RETROARCH_EXIT_GUARD_MS,
    })
    return true
  }

  const now = Date.now()
  if (retroarchExitConfirmUntil > now) {
    clearRetroarchExitConfirm()
    requestRetroarchStop('menu')
    return true
  }

  retroarchExitConfirmUntil = now + RETROARCH_EXIT_CONFIRM_WINDOW_MS
  setArcadeOverlayNotice('EXIT GAME?', RETROARCH_EXIT_CONFIRM_WINDOW_MS, 'center')
  showArcadeOsdMessage(composeArcadeOsdOverlay('EXIT GAME?'), {
    bypassCooldown: true,
    urgent: true,
  })
  console.log('[RETROARCH] MENU exit armed', {
    windowMs: RETROARCH_EXIT_CONFIRM_WINDOW_MS,
  })
  return true
}

function sendVirtual(proc, type, code, value) {
  if (!proc || !proc.stdin.writable) return

  proc.stdin.write(`${type} ${code} ${value}\n`)
  proc.stdin.write(`${EV_SYN} ${SYN_REPORT} 0\n`)
}

const INPUT_DEVICE_RETRY_MISSING_MS = 250
const INPUT_DEVICE_RETRY_ERROR_MS = 1000
const INPUT_DEVICE_RETRY_ENODEV_MS = 150
const arcadePromptController = createArcadePromptController({
  arcadeRetroOsdPromptPersist: ARCADE_RETRO_OSD_PROMPT_PERSIST,
  arcadeRetroOsdPromptBlink: ARCADE_RETRO_OSD_PROMPT_BLINK,
  arcadeRetroOsdPromptIntervalMs: ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS,
  logger: console,
  getArcadeSession: () => arcadeSession,
  getContinueCountdownTimers: () => arcadeContinueCountdownTimers,
  getPromptLoopTimer: () => arcadePromptLoopTimer,
  setPromptLoopTimer(value) {
    arcadePromptLoopTimer = value
  },
  getPromptBlinkPhase: () => arcadePromptBlinkPhase,
  setPromptBlinkPhase(value) {
    arcadePromptBlinkPhase = value
  },
  getLastPromptLoopMessage: () => lastArcadePromptLoopMessage,
  setLastPromptLoopMessage(value) {
    lastArcadePromptLoopMessage = value
  },
  getLastPromptLoopSentAt: () => lastArcadePromptLoopSentAt,
  setLastPromptLoopSentAt(value) {
    lastArcadePromptLoopSentAt = value
  },
  getBuyIntentState: () => buyIntentState,
  setBuyIntentState(value) {
    buyIntentState = value
  },
  getBuyIntentUntil: () => buyIntentUntil,
  getGameOverTimer: () => gameOverTimer,
  getGameOverState: () => gameOverState,
  isArcadeTimeLockActive,
  normalizeArcadeJoinMode,
  isArcadePurchaseAllowed,
  getArcadeSessionPrice,
  getArcadeLifePromptActionLabel,
  composeArcadeOsdOverlay,
  showArcadeOsdMessage,
})
const arcadeTimeService = createArcadeTimeService({
  logger: console,
  arcadeTimeGraceMs: ARCADE_TIME_GRACE_MS,
  arcadeLifePriceDefault: ARCADE_LIFE_PRICE_DEFAULT,
  getArcadeSession: () => arcadeSession,
  setArcadeSession(value) {
    arcadeSession = value
  },
  getRetroarchActive: () => retroarchActive,
  getArcadeTimeLoopTimer: () => arcadeTimeLoopTimer,
  setArcadeTimeLoopTimer(value) {
    arcadeTimeLoopTimer = value
  },
  getArcadeTimeoutPausePending: () => arcadeTimeoutPausePending,
  setArcadeTimeoutPausePending(value) {
    arcadeTimeoutPausePending = value
  },
  getArcadeTimeoutPauseConfirmed: () => arcadeTimeoutPauseConfirmed,
  scheduleArcadeTimePersistence,
  ensureArcadeTimeoutPause,
  refreshArcadeOsdMessage,
  dispatch,
  normalizeArcadeJoinMode,
  getArcadeSessionPrice,
  getArcadeLifePromptActionLabel,
  composeArcadeOsdOverlay,
  showArcadeOsdMessage,
  clearArcadeBalanceSyncLoop,
  clearArcadePromptLoop,
  clearArcadeContinueCountdown,
  clearArcadeOverlayNotice,
  resetArcadeTimeoutPauseState,
  clearArcadeBalancePushFloor,
  clearArcadeTimePersistTimer,
  seedArcadeTimePersistence(value) {
    arcadeTimePersistRequestedMs = value
    arcadeTimePersistCommittedMs = value
  },
  scheduleArcadePromptLoop,
  scheduleArcadeBalanceSyncLoop,
  syncArcadeSessionBalance,
  toMoney,
  isRetroarchSessionReady,
})
const controlRouter = createControlRouter({
  joystickButtonMap: JOYSTICK_BUTTON_MAP,
  evKey: EV_KEY,
  btnDpadUp: BTN_DPAD_UP,
  btnDpadDown: BTN_DPAD_DOWN,
  btnDpadLeft: BTN_DPAD_LEFT,
  btnDpadRight: BTN_DPAD_RIGHT,
  retroarchP2SwapAxes: RETROARCH_P2_SWAP_AXES,
  casinoMenuExitsRetroarch: CASINO_MENU_EXITS_RETROARCH,
  hopperTopupCoinValue: HOPPER_TOPUP_COIN_VALUE,
  logger: console,
  getArcadeSession: () => arcadeSession,
  getRetroarchActive: () => retroarchActive,
  getRetroarchCurrentGameId: () => retroarchCurrentGameId,
  getRetroarchPrimaryInput: () => RETROARCH_PRIMARY_INPUT,
  getBuyState: () => buyState,
  getGameOverState: () => gameOverState,
  getDpadState: () => dpadState,
  getArcadeOverlayNotice: () => arcadeOverlayNotice,
  getArcadeContinueCountdownTimers: () => arcadeContinueCountdownTimers,
  normalizeArcadePlayer,
  isArcadeTimeLockActive,
  isStartButton,
  isLifePurchaseButton,
  dispatch,
  resolveRetroInputSource,
  getRetroVirtualTarget,
  shouldPromoteArcadeSessionToLive,
  markArcadeSessionLive,
  sendVirtual,
  setLastGameInputAt(value) {
    lastGameInputAt = value
  },
  setLastGameplayInputAt(player, value) {
    lastGameplayInputAt[player] = value
  },
  maybeStartArcadeTimeSession,
  startArcadeTimeLoop,
  isBlockedCasinoActionDuringRetroarch,
  handleBuyPressed,
  handleRetroarchMenuExitIntent,
  playerHasStoredCredit,
  handleDepositPulse,
  recordHopperTopup,
  handleWithdrawPulse,
  mapIndexToKey,
  clearRetroarchExitConfirm,
  clearArcadeContinueCountdown,
  canAcceptRetroarchStartInput,
  getArcadeSessionPrice,
  getArcadeLifePromptActionLabel,
  setArcadeOverlayNotice,
  clearArcadeOverlayNotice,
  showArcadeOsdMessage,
  composeArcadeOsdOverlay,
  broadcastArcadeLifeState,
  handleSimultaneousRetroarchStart,
})
const rawInputMapper = createRawInputMapper({
  rawButtonMap: RAW_BUTTON_MAP,
  evKey: EV_KEY,
  evAbs: EV_ABS,
  onKeyEvent(source, index, value) {
    const player = normalizeArcadePlayer(source)
    if (player && value === 1) {
      lastGameplayInputAt[player] = Date.now()
    }

    handleKey(source, index, value)
  },
  onAxisEvent(source, code, value) {
    handleRawAxis(source, code, value)
  },
})

const inputDeviceManager = createInputDeviceManager({
  isPi: IS_PI,
  fsModule: fs,
  retryMissingMs: INPUT_DEVICE_RETRY_MISSING_MS,
  retryErrorMs: INPUT_DEVICE_RETRY_ERROR_MS,
  retryEnodevMs: INPUT_DEVICE_RETRY_ENODEV_MS,
  devicePaths: {
    casino: '/dev/input/casino',
    player1: '/dev/input/player1',
    player2: '/dev/input/player2',
  },
  onRawEvent(label, type, code, value) {
    rawInputMapper.handleRawEvent(label, type, code, value)
  },
  logger: console,
})

function logInputLinks(reason = 'snapshot') {
  inputDeviceManager.logInputLinks(reason)
}

logInputLinks('boot')

function getInputLinkState() {
  return inputDeviceManager.getInputLinkState()
}

function startEventDevice(path, label) {
  inputDeviceManager.startEventDevice(path, label)
}

function handleRawAxis(source, code, value) {
  controlRouter.handleRawAxis(source, code, value)
}

function handleKey(source, index, value) {
  controlRouter.handleKey(source, index, value)
}

function routePlayerInput(source, index, value) {
  controlRouter.routePlayerInput(source, index, value)
}

function switchToVT(vt, reason) {
  return retroarchRuntimeOrchestrator.switchToVT(vt, reason)
}

function switchToVTWithRetry(vt, reason, attempts = 5, delayMs = 150) {
  retroarchRuntimeOrchestrator.switchToVTWithRetry(vt, reason, attempts, delayMs)
}

function scheduleForceSwitchToUI(reason, delayMs = 300) {
  retroarchRuntimeOrchestrator.scheduleForceSwitchToUI(reason, delayMs)
}

function clearScheduledForceSwitchToUI() {
  retroarchRuntimeOrchestrator.clearScheduledForceSwitchToUI()
}

function clearRetroarchStopTimers() {
  retroarchRuntimeOrchestrator.clearRetroarchStopTimers()
}

let arcadeOverlayNotice = null
let arcadeOverlayNoticeTimer = null

function clearArcadeOverlayNotice() {
  if (arcadeOverlayNoticeTimer !== null) {
    clearTimeout(arcadeOverlayNoticeTimer)
    arcadeOverlayNoticeTimer = null
  }
  arcadeOverlayNotice = null
  refreshArcadeOsdMessage()
}

function setArcadeOverlayNotice(text, ttlMs = 1600, slot = 'center') {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!clean) {
    clearArcadeOverlayNotice()
    return
  }

  arcadeOverlayNotice = {
    text: clean,
    slot: slot === 'left' || slot === 'right' || slot === 'center' ? slot : 'center',
  }
  refreshArcadeOsdMessage()

  if (arcadeOverlayNoticeTimer !== null) {
    clearTimeout(arcadeOverlayNoticeTimer)
    arcadeOverlayNoticeTimer = null
  }

  if (Number.isFinite(ttlMs) && ttlMs > 0) {
    arcadeOverlayNoticeTimer = setTimeout(
      () => {
        arcadeOverlayNoticeTimer = null
        arcadeOverlayNotice = null
        refreshArcadeOsdMessage()
      },
      Math.max(250, ttlMs),
    )
  }
}

function refreshArcadeOsdMessage() {
  if (!arcadeSession?.active) return
  const promptMessage = buildArcadePromptMessage()
  const message = promptMessage || composeArcadeOsdOverlay('')
  const changed = promptMessage !== lastArcadePromptLoopMessage
  showArcadeOsdMessage(message, { bypassCooldown: changed || !promptMessage })
  lastArcadePromptLoopMessage = promptMessage
  lastArcadePromptLoopSentAt = Date.now()
}

function performUiRestartAfterExit(reason, abnormalExit = false) {
  if (RETROARCH_TTY_X_SESSION) {
    restartArcadeUiAfterRetroarch(reason, abnormalExit)
    return
  }
  if (!IS_PI || !RETROARCH_USE_TTY_MODE || !RESTART_UI_ON_EXIT || shuttingDown) return

  const proc = spawn('systemctl', ['restart', 'arcade-ui.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  console.log(`[UI] restart requested after game exit (${reason})`)
}

const retroarchRuntimeOrchestrator = createRetroarchRuntimeOrchestrator({
  logger: console,
  isPi: IS_PI,
  singleXMode: SINGLE_X_MODE,
  retroarchUseTtyMode: RETROARCH_USE_TTY_MODE,
  restartUiOnExit: RESTART_UI_ON_EXIT,
  retroarchTermFallbackMs: RETROARCH_TERM_FALLBACK_MS,
  retroarchStopGraceMs: RETROARCH_STOP_GRACE_MS,
  getPendingUiFallbackTimer: () => pendingUiFallbackTimer,
  setPendingUiFallbackTimer(value) {
    pendingUiFallbackTimer = value
  },
  getRetroarchStopTermTimer: () => retroarchStopTermTimer,
  setRetroarchStopTermTimer(value) {
    retroarchStopTermTimer = value
  },
  getRetroarchStopForceTimer: () => retroarchStopForceTimer,
  setRetroarchStopForceTimer(value) {
    retroarchStopForceTimer = value
  },
  getRetroarchProcess: () => retroarchProcess,
  setRetroarchProcess(value) {
    retroarchProcess = value
  },
  getRetroarchActive: () => retroarchActive,
  setRetroarchActive(value) {
    retroarchActive = value
  },
  getRetroarchStopping: () => retroarchStopping,
  setRetroarchStopping(value) {
    retroarchStopping = value
  },
  getRetroarchStartedAt: () => retroarchStartedAt,
  setRetroarchStartedAt(value) {
    retroarchStartedAt = value
  },
  getRetroarchCurrentGameId: () => retroarchCurrentGameId,
  setRetroarchCurrentGameId(value) {
    retroarchCurrentGameId = value
  },
  getRetroarchLogFd: () => retroarchLogFd,
  setRetroarchLogFd(value) {
    retroarchLogFd = value
  },
  getLastExitTime: () => lastExitTime,
  setLastExitTime(value) {
    lastExitTime = value
  },
  getLastExitedGameId: () => lastExitedGameId,
  setLastExitedGameId(value) {
    lastExitedGameId = value
  },
  getArcadeSession: () => arcadeSession,
  getShuttingDown: () => shuttingDown,
  getLastUiRestartAt: () => lastUiRestartAt,
  setLastUiRestartAt(value) {
    lastUiRestartAt = value
  },
  uiRestartCooldownMs: UI_RESTART_COOLDOWN_MS,
  getTargetUiVT,
  clearRetroarchExitConfirm,
  clearRetroarchReadyWatch,
  resetRetroarchStartPressState,
  stopArcadeTimeLoop,
  stopSplashForRetroarch,
  restoreChromiumUiAfterRetroarch,
  clearArcadeLifeSession,
  dispatch,
  maybeRestartUiAfterRetroarch: performUiRestartAfterExit,
})
const retroarchLaunchRuntime = createRetroarchLaunchRuntime({
  logger: console,
  isPi: IS_PI,
  singleXMode: SINGLE_X_MODE,
  retroarchTtyXSession: RETROARCH_TTY_X_SESSION,
  useSplashTransitions: USE_SPLASH_TRANSITIONS,
  port: 5174,
  gameVT: GAME_VT,
  splashVT: SPLASH_VT,
  arcadeRuntimeDir: ARCADE_RUNTIME_DIR,
  retroarchRunUser: RETROARCH_RUN_USER,
  retroarchRunHome: RETROARCH_RUN_HOME,
  retroarchRuntimeDir: RETROARCH_RUNTIME_DIR,
  retroarchDbusAddress: RETROARCH_DBUS_ADDRESS,
  retroarchPulseServer: RETROARCH_PULSE_SERVER,
  retroarchBin: RETROARCH_BIN,
  retroarchConfigPath: RETROARCH_CONFIG_PATH,
  retroarchUseDbusRunSession: RETROARCH_USE_DBUS_RUN_SESSION,
  retroarchLogPath: RETROARCH_LOG_PATH,
  getLastExitTime: () => lastExitTime,
  getLastExitedGameId: () => lastExitedGameId,
  setLastExitedGameId(value) {
    lastExitedGameId = value
  },
  retroarchPostExitLaunchCooldownMs: RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS,
  arcadeLifePriceDefault: ARCADE_LIFE_PRICE_DEFAULT,
  hasSupabaseRpcConfig,
  fetchDeviceFinancialState: () => fetchDeviceFinancialState(DEVICE_ID),
  fetchGameProfileForArcadeLife,
  normalizeArcadeJoinMode,
  toMoney,
  getRetroarchActive: () => retroarchActive,
  setRetroarchActive(value) {
    retroarchActive = value
  },
  getRetroarchStopping: () => retroarchStopping,
  setRetroarchStopping(value) {
    retroarchStopping = value
  },
  setRetroarchCurrentGameId(value) {
    retroarchCurrentGameId = value
  },
  setRetroarchStartedAt(value) {
    retroarchStartedAt = value
  },
  clearRetroarchExitConfirm,
  stopArcadeTimeLoop,
  getArcadeSession: () => arcadeSession,
  clearArcadeLifeSession,
  startArcadeLifeSession,
  dispatch,
  getActiveVT,
  getLastUiVT: () => lastUiVT,
  setLastUiVT(value) {
    lastUiVT = value
  },
  switchToVT,
  resolveCorePath,
  resolveRomPath,
  prepareDisplayForLaunch: displayRuntime.prepareDisplayForLaunch,
  scheduleRetroarchReadyWatch,
  stopSplashForRetroarch,
  setRetroarchProcess(value) {
    retroarchProcess = value
  },
  getRetroarchLogFd: () => retroarchLogFd,
  setRetroarchLogFd(value) {
    retroarchLogFd = value
  },
  finalizeRetroarchExit,
})

function maybeRestartUiAfterExit(reason) {
  retroarchRuntimeOrchestrator.maybeRestartUiAfterExit(reason)
}

function killRetroarchProcess(signal, reason) {
  retroarchRuntimeOrchestrator.killRetroarchProcess(signal, reason)
}

function sendRetroarchSignal(signal, reason) {
  retroarchRuntimeOrchestrator.sendRetroarchSignal(signal, reason)
}

function finalizeRetroarchExit(reason) {
  retroarchRuntimeOrchestrator.finalizeRetroarchExit(reason)
}

function requestRetroarchStop(reason) {
  retroarchRuntimeOrchestrator.requestRetroarchStop(reason)
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

    gpioOff(COIN_INHIBIT_PIN)
    gpioController.cleanup()

    player1?.removeAllListeners?.()
    player2?.removeAllListeners?.()

    player1?.close?.()
    player2?.close?.()

    clearArcadeLifeSession('shutdown')
    requestRetroarchStop('shutdown')
    clearRetroarchStopTimers()
    clearScheduledForceSwitchToUI()

    if (sseClients.size > 0) {
      for (const client of [...sseClients]) {
        try {
          client.end()
        } catch {}
        sseClients.delete(client)
      }
    }

    if (serverInstance) {
      await new Promise(resolve => serverInstance.close(resolve))
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
  startVirtualDevices()
    .then(() => {
      startEventDevice('/dev/input/casino', 'CASINO')
      startEventDevice('/dev/input/player1', 'P1')
      startEventDevice('/dev/input/player2', 'P2')
    })
    .catch(err => {
      console.error('[BOOT] hardware init failed', err)
      process.exit(1)
    })
} else {
  console.log('[INPUT] compat-mode: hardware readers disabled')
}

const PORT = 5174
let wifiOperationInFlight = false

function execCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

async function rescanWifiNetworks() {
  await execCommand('nmcli', ['device', 'wifi', 'rescan'])
}

async function listWifiNetworks({ rescan = false } = {}) {
  if (rescan) {
    try {
      await rescanWifiNetworks()
    } catch (error) {
      console.warn('[WIFI] rescan warning', error?.stderr || error?.message || error)
    }
  }

  const { stdout } = await execCommand('nmcli', [
    '-t',
    '--escape',
    'no',
    '-f',
    'SSID,SIGNAL',
    'device',
    'wifi',
    'list',
    '--rescan',
    'no',
  ])

  const strongestBySsid = new Map()

  for (const line of String(stdout || '')
    .split('\n')
    .filter(Boolean)) {
    const sep = line.lastIndexOf(':')
    if (sep <= 0) continue

    const ssid = line.slice(0, sep).trim()
    const signal = Number(line.slice(sep + 1))

    if (!ssid) continue

    const network = {
      ssid,
      signal: Number.isFinite(signal) ? signal : 0,
    }

    const existing = strongestBySsid.get(ssid)
    if (!existing || network.signal > existing.signal) {
      strongestBySsid.set(ssid, network)
    }
  }

  return [...strongestBySsid.values()].sort((a, b) => b.signal - a.signal)
}

async function listKnownWifiProfiles() {
  const { stdout } = await execCommand('nmcli', [
    '-t',
    '--escape',
    'no',
    '-f',
    'NAME,TYPE',
    'connection',
    'show',
  ])

  const profiles = []
  const seenIds = new Set()

  for (const line of String(stdout || '')
    .split('\n')
    .filter(Boolean)) {
    const parts = line.split(':')
    if (parts.length < 2) continue

    const id = (parts[0] || '').trim()
    const type = (parts[1] || '').trim()

    if (!id) continue
    if (!(type === 'wifi' || type === '802-11-wireless' || type === 'wireless')) continue
    if (seenIds.has(id)) continue

    seenIds.add(id)

    let ssid = id
    try {
      const { stdout: ssidStdout } = await execCommand('nmcli', [
        '--escape',
        'no',
        '-g',
        '802-11-wireless.ssid',
        'connection',
        'show',
        id,
      ])
      const resolvedSsid = String(ssidStdout || '').trim()
      if (resolvedSsid) ssid = resolvedSsid
    } catch (error) {
      console.warn('[WIFI] profile ssid fallback', id, error?.stderr || error?.message || error)
    }

    profiles.push({ id, ssid })
  }

  return profiles
}

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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function scheduleSystemPowerAction(action) {
  const command = action === 'restart' ? 'reboot' : 'poweroff'
  console.log(`[SYSTEM] ${command} requested`)

  setTimeout(() => {
    if (!IS_PI) {
      console.log(`[SYSTEM] ${command} simulated (compat mode)`)
      return
    }

    if (retroarchActive) {
      requestRetroarchStop(`system-${command}`)
    }

    const primary = spawn('systemctl', [command], {
      stdio: 'ignore',
      detached: true,
    })
    primary.on('error', err => {
      console.error(`[SYSTEM] systemctl ${command} failed, trying fallback`, err.message)
      const fallback = spawn(command, [], {
        stdio: 'ignore',
        detached: true,
      })
      fallback.unref()
    })
    primary.unref()
  }, 400)
}

function scheduleManagedServiceRestart(serviceName, delayMs = 400) {
  const safeServiceName = String(serviceName || '').trim()
  if (!safeServiceName) return

  console.log(`[SYSTEM] restart requested for ${safeServiceName}`)

  setTimeout(() => {
    if (!IS_PI) {
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
}

function getPackageKey() {
  const keyHex = process.env.GAME_PACKAGE_KEY_HEX || ''
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) return null
  return Buffer.from(keyHex, 'hex')
}

function getDevCasinoEntryEnvKey(gameId) {
  return `ARCADE_DEV_CASINO_ENTRY_${String(gameId || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()}`
}

function isAllowedCompatEntryUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''))
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    const host = parsed.hostname.toLowerCase()
    if (!['localhost', '127.0.0.1'].includes(host)) return false

    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
    if ([3001, 5173, 5174].includes(port)) return false

    return true
  } catch {
    return false
  }
}

async function probeCompatEntryUrl(entryUrl) {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-sS',
      '-L',
      '--max-time',
      '2',
      '--output',
      '/dev/null',
      '--write-out',
      '%{http_code}',
      entryUrl,
    ])
    const status = Number.parseInt(String(stdout || '').trim(), 10)
    return Number.isFinite(status) && status >= 200 && status < 400
  } catch {
    return false
  }
}

async function resolveCompatGamePackageEntry({ id, packageUrl }) {
  if (IS_PI) return null

  const gameId = String(id || '')
    .trim()
    .toLowerCase()
  const candidates = []
  const gameSpecificEnv = process.env[getDevCasinoEntryEnvKey(gameId)]
  if (gameSpecificEnv) candidates.push(gameSpecificEnv)

  if (gameId === 'ultraace' && process.env.ULTRAACE_DEV_URL) {
    candidates.push(process.env.ULTRAACE_DEV_URL)
  }

  if (isAllowedCompatEntryUrl(packageUrl)) {
    candidates.push(packageUrl)
  }

  if (gameId === 'ultraace') {
    candidates.push(
      'http://127.0.0.1:4173',
      'http://localhost:4173',
      'http://127.0.0.1:4174',
      'http://localhost:4174',
      'http://127.0.0.1:5175',
      'http://localhost:5175',
      'http://127.0.0.1:4175',
      'http://localhost:4175',
    )
  }

  const seen = new Set()
  for (const candidate of candidates) {
    const entry = String(candidate || '').trim()
    if (!entry || seen.has(entry) || !isAllowedCompatEntryUrl(entry)) continue
    seen.add(entry)
    if (await probeCompatEntryUrl(entry)) {
      return {
        entry,
        installed: false,
        cached: false,
        compatBypass: true,
      }
    }
  }

  return null
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

  const downloadPath = path.join(os.tmpdir(), `arcade-${gameId}-${gameVersion}-${Date.now()}.enc`)
  let encrypted
  try {
    await execFileAsync('curl', ['-fsSL', '--max-time', '30', '--output', downloadPath, packageUrl])

    encrypted = fs.readFileSync(downloadPath)
    if (encrypted.length < 29) {
      throw new Error('invalid encrypted payload')
    }
  } finally {
    fs.rmSync(downloadPath, { force: true })
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

const NO_AUDIO_DEVICE_PATTERN =
  /cannot find card|no such file|mixer attach|audio open error|invalid ctl|default.*not found/i

function isNoAudioDeviceError(error, stderr = '') {
  const message = `${error?.message || ''}\n${stderr || ''}`
  return NO_AUDIO_DEVICE_PATTERN.test(message)
}

function parseSpeakerVolumeState(controlStdout, stateStdout) {
  const controlText = String(controlStdout || '')
  const stateText = String(stateStdout || '')

  const rawRangeMatch = controlText.match(/min=(\d+),max=(\d+)/)
  const rawValueMatch = controlText.match(/:\s*values=(\d+)(?:,(\d+))?/)
  const dbRangeMatch = controlText.match(/dBminmaxmute-min=([-\d.]+)dB,max=([-\d.]+)dB/)
  const dbValueMatch = stateText.match(/\[([-\d.]+)dB\]/)

  if (!rawRangeMatch || !rawValueMatch) {
    throw new Error('Unable to parse Speaker control range')
  }

  const rawMin = Number(rawRangeMatch[1])
  const rawMax = Number(rawRangeMatch[2])
  const rawValue = Number(rawValueMatch[1])
  const dbMin = dbRangeMatch ? Number(dbRangeMatch[1]) : null
  const dbMax = dbRangeMatch ? Number(dbRangeMatch[2]) : null
  const dbValue = dbValueMatch ? Number(dbValueMatch[1]) : null
  const percent = rawMax > rawMin ? Math.round(((rawValue - rawMin) / (rawMax - rawMin)) * 100) : 0

  return {
    success: true,
    control: 'Speaker',
    rawValue,
    rawMin,
    rawMax,
    percent: Math.max(0, Math.min(100, percent)),
    db: dbValue,
    dbMin,
    dbMax,
    volume: dbValue === null ? `${percent}%` : `${dbValue.toFixed(1)} dB`,
  }
}

async function getSpeakerVolumeState() {
  try {
    const control = await execFileAsync('amixer', ['-c', '0', 'cget', 'numid=6'])
    const state = await execFileAsync('amixer', ['-c', '0', 'sget', 'Speaker'])
    return parseSpeakerVolumeState(control.stdout, state.stdout)
  } catch (error) {
    if (isNoAudioDeviceError(error, error?.stderr || '')) {
      return {
        success: false,
        error: 'NO_AUDIO_DEVICE',
        volume: 'NO AUDIO DEVICE',
        percent: null,
        db: null,
        dbMin: null,
        dbMax: null,
      }
    }

    throw error
  }
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

  const getExternalIpv4 = name => {
    const entries = nets[name] || []
    return entries.find(e => e && e.family === 'IPv4' && !e.internal) || null
  }

  if (!IS_PI) {
    const entries = Object.entries(nets)
      .map(([name, list]) => ({
        name,
        ipv4:
          (list || []).find(entry => entry && entry.family === 'IPv4' && !entry.internal) || null,
      }))
      .filter(entry => entry.ipv4)

    const wifiEntry =
      entries.find(entry => /^(wi-?fi|wlan|wl|airport|en0)$/i.test(entry.name)) || null
    const ethernetEntry =
      entries.find(
        entry => entry.name !== wifiEntry?.name && /^(eth|en|bridge|lan)/i.test(entry.name),
      ) || null
    const fallbackEntry = entries[0] || null

    return {
      ethernet:
        ethernetEntry?.ipv4?.address || (!wifiEntry ? fallbackEntry?.ipv4?.address || null : null),
      wifi: wifiEntry?.ipv4?.address || null,
      ethernet_name: ethernetEntry?.name || (!wifiEntry ? fallbackEntry?.name || null : null),
      wifi_name: wifiEntry?.name || null,
    }
  }

  return {
    ethernet: getExternalIpv4('eth0')?.address || null,
    wifi: getExternalIpv4('wlan0')?.address || null,
    ethernet_name: getExternalIpv4('eth0') ? 'ETHERNET' : null,
    wifi_name: getExternalIpv4('wlan0') ? 'wlan0' : null,
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

  const normalizedRaw = raw.replace(/\\/g, '/').trim()
  const romRelative = normalizedRaw
    .replace(/^\/+/, '')
    .replace(/^(\.\.\/)+roms\//, '')
    .replace(/^roms\//, '')

  const candidates = [
    raw,
    path.resolve(SERVICE_DIR, raw),
    path.resolve(ARCADE_RUNTIME_DIR, raw),
    path.resolve(ROMS_ROOT, raw),
    path.join(ROMS_ROOT, romRelative),
  ]

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  console.error('[ROM RESOLVE] not found', {
    raw,
    romRelative,
    serviceDir: SERVICE_DIR,
    runtimeDir: ARCADE_RUNTIME_DIR,
    romsRoot: ROMS_ROOT,
    candidates: candidates.map(candidate => path.resolve(candidate)),
  })

  return null
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (req.method === 'OPTIONS' && req.url.startsWith('/game-package/')) {
    setJsonCors(res)
    res.writeHead(204)
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/device-id') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        deviceId: DEVICE_ID,
        isPi: IS_PI,
        compatMode: !IS_PI,
        devInputBypass: DEV_INPUT_BYPASS_ENABLED,
        platform: process.platform,
      }),
    )
    return
  }
  if (req.method === 'POST' && req.url === '/device-register') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 32 * 1024) {
        req.destroy(new Error('Payload too large'))
      }
    })
    req.on('end', async () => {
      try {
        const payload = body ? JSON.parse(body) : {}
        const requestedDeviceId = String(payload?.deviceId || DEVICE_ID || '').trim() || DEVICE_ID

        await ensureDeviceRegistered(requestedDeviceId)

        return sendJson(res, 200, {
          success: true,
          deviceId: requestedDeviceId,
        })
      } catch (error) {
        console.error('[DEVICE] local register failed', error)
        return sendJson(res, 500, {
          success: false,
          error: 'DEVICE_REGISTER_FAILED',
          message: String(error?.message || error || 'unknown error'),
        })
      }
    })
    return
  }
  if (req.method === 'POST' && req.url === '/dev-input') {
    if (!DEV_INPUT_BYPASS_ENABLED) {
      return sendJson(res, 403, { success: false, error: 'DEV_INPUT_DISABLED' })
    }

    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}')
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(res, 400, { success: false, error: 'INVALID_PAYLOAD' })
        }

        broadcast(payload)
        return sendJson(res, 200, { success: true, forwarded: true })
      } catch (error) {
        console.error('[DEV INPUT] invalid payload', error)
        return sendJson(res, 400, { success: false, error: 'INVALID_JSON' })
      }
    })
    return
  }
  if (req.method === 'GET' && req.url === '/network-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(getNetworkInfo()))
    return
  }
  if (req.method === 'GET' && req.url === '/withdraw-limits') {
    ;(async () => {
      try {
        const state =
          IS_PI && hasSupabaseRpcConfig() ? await fetchDeviceFinancialState(DEVICE_ID) : null
        const balance = toMoney(state?.balance, 0)
        const hopperBalance = toMoney(state?.hopperBalance, 0)
        const withdrawEnabled = Boolean(state?.withdrawEnabled)
        const configuredMax = state ? getMaxWithdrawalAmountForHopperBalance(hopperBalance) : null
        const maxWithdrawalAmount =
          !withdrawEnabled || configuredMax === null
            ? null
            : Math.max(0, Math.min(balance, hopperBalance, configuredMax))

        return sendJson(res, 200, {
          success: true,
          balance,
          hopperBalance,
          maxWithdrawalAmount,
          configuredMax,
          enabled: Boolean(IS_PI && hasSupabaseRpcConfig() && withdrawEnabled),
        })
      } catch (error) {
        console.error('[WITHDRAW] limits fetch failed', error)
        return sendJson(res, 500, { success: false, error: 'WITHDRAW_LIMITS_FAILED' })
      }
    })()
    return
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('\n')
    sseClients.add(res)
    console.log('[SSE] client connected')

    checkInternetOnce()
      .then(online => {
        const hasLink = hasLocalNetworkLink()
        const effectiveOnline = getCompatOnlineState(online, hasLink)
        sendSse(res, { type: effectiveOnline ? 'INTERNET_OK' : 'INTERNET_LOST' })
      })
      .catch(() => {
        sendSse(res, { type: hasLocalNetworkLink() ? 'INTERNET_OK' : 'INTERNET_LOST' })
      })

    req.on('close', () => {
      sseClients.delete(res)
      console.log('[SSE] client disconnected')
    })
    return
  }
  if (req.method === 'GET' && req.url === '/arcade-shell-update/status') {
    return sendJson(res, 200, { success: true, ...getArcadeShellUpdateStatus() })
  }
  if (req.method === 'GET' && req.url === '/input-link-status') {
    return sendJson(res, 200, { success: true, ...getInputLinkState() })
  }
  if (req.method === 'GET' && req.url === '/network-state') {
    return sendJson(res, 200, {
      success: true,
      internetState,
      internetLastStableState,
      compatOnline: lastInternetState,
      hasLocalLink: hasLocalNetworkLink(),
      wifi: getNetworkInfo()?.wifi || null,
      ethernet: getNetworkInfo()?.ethernet || null,
    })
  }
  if (req.method === 'GET' && req.url === '/arcade-life/overlay-state') {
    return sendJson(res, 200, { success: true, ...getArcadeRetroOverlayState() })
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

    ;(async () => {
      try {
        const networks = await listWifiNetworks({ rescan: true })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(networks))
      } catch (error) {
        console.error('[WIFI] Scan failed', error?.stderr || error?.message || error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'WIFI_SCAN_FAILED' }))
      }
    })()

    return
  }

  if (req.method === 'GET' && req.url === '/wifi-known') {
    if (!IS_PI) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify([
          { ssid: 'DEV_WIFI', type: 'wifi' },
          { ssid: 'DEV_HOTSPOT', type: 'wifi' },
        ]),
      )
    }

    ;(async () => {
      try {
        const profiles = await listKnownWifiProfiles()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(profiles))
      } catch (error) {
        console.error('[WIFI] Known profiles scan failed', error?.stderr || error?.message || error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'WIFI_KNOWN_FAILED' }))
      }
    })()
    return
  }

  if (req.method === 'GET') {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1')
    const safePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '')

    if (safePath === '/arcade-shell-build.json') {
      const versionFilePath = path.join(ARCADE_RUNTIME_DIR, 'os', '.arcade-shell-version')
      let version = ''
      let createdAt = null

      try {
        if (fs.existsSync(versionFilePath)) {
          version = String(fs.readFileSync(versionFilePath, 'utf8') || '').trim()
          const stats = fs.statSync(versionFilePath)
          createdAt = stats.mtime.toISOString()
        }
      } catch (err) {
        console.error('Build metadata read error:', err)
      }

      if (!version) {
        version = String(process.env.ARCADE_SHELL_VERSION || '').trim()
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      })
      return res.end(
        JSON.stringify({
          version: version || 'unknown',
          created_at: createdAt,
        }),
      )
    }

    if (safePath === '/boot.png') {
      const bootPath = path.join(ARCADE_RUNTIME_DIR, 'os', 'boot', 'boot.png')

      if (!fs.existsSync(bootPath)) {
        res.writeHead(404)
        return res.end('Not found')
      }

      try {
        const data = fs.readFileSync(bootPath)
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        })
        return res.end(data)
      } catch (err) {
        console.error('Boot image read error:', err)
        res.writeHead(500)
        return res.end('Server error')
      }
    }

    if (safePath.startsWith('/roms/')) {
      const romAssetPath = safePath.replace(/^\/roms\//, '')
      const filePath = path.join(ROMS_ROOT, romAssetPath)

      if (!filePath.startsWith(ROMS_ROOT)) {
        res.writeHead(403)
        return res.end('Forbidden')
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404)
        return res.end('Not found')
      }

      try {
        const data = fs.readFileSync(filePath)
        res.writeHead(200, {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': 'public, max-age=3600',
        })
        return res.end(data)
      } catch (err) {
        console.error('ROM static read error:', err)
        res.writeHead(500)
        return res.end('Server error')
      }
    }

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

    if (safePath === '/cabinet-games') {
      const requestedDeviceId = parsedUrl.searchParams.get('deviceId') || DEVICE_ID

      fetchCabinetGamesForDevice(requestedDeviceId)
        .then(games => {
          sendJson(res, 200, { success: true, deviceId: requestedDeviceId, games })
        })
        .catch(error => {
          console.error('[CABINET GAMES] endpoint failed', error?.message || error)
          sendJson(res, 500, { success: false, deviceId: requestedDeviceId, games: [] })
        })
      return
    }

    if (safePath === '/system/volume') {
      getSpeakerVolumeState()
        .then(state => {
          sendJson(res, 200, state)
        })
        .catch(error => {
          console.error('[AUDIO] volume read failed', error?.message || error)
          sendJson(res, 500, { success: false, error: 'VOLUME_READ_FAILED' })
        })
      return
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

        if (wifiOperationInFlight) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'WIFI_BUSY' }))
        }

        wifiOperationInFlight = true
        console.log('[WIFI] Attempting connection to', ssid)

        const nm = spawn('nmcli', ['device', 'wifi', 'connect', ssid, 'password', password])
        let nmStderr = ''
        nm.stderr?.on('data', chunk => {
          nmStderr += String(chunk || '')
        })

        nm.on('close', async code => {
          if (code !== 0) {
            wifiOperationInFlight = false
            console.error('[WIFI] nmcli failed with code', code, nmStderr.trim())
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: false }))
          }

          // Give NetworkManager time to settle
          setTimeout(async () => {
            const online = await checkInternetOnce()
            wifiOperationInFlight = false

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: online }))

            if (online) {
              broadcast({ type: 'INTERNET_RESTORED' })
            }
          }, 3000)
        })
      } catch (e) {
        wifiOperationInFlight = false
        console.error('[WIFI] Invalid request', e)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false }))
      }
    })

    return
  }

  if (req.method === 'POST' && req.url === '/wifi-connect-known') {
    let body = ''

    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', async () => {
      try {
        const { id, ssid } = JSON.parse(body || '{}')
        const profileId = String(id || ssid || '').trim()

        if (!profileId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'Missing profile' }))
        }

        if (!IS_PI) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
          broadcast({ type: 'INTERNET_RESTORED' })
          return
        }

        if (wifiOperationInFlight) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'WIFI_BUSY' }))
        }

        wifiOperationInFlight = true
        console.log('[WIFI] Activating known profile', profileId)
        exec('nmcli device disconnect wlan0 || true', err => {
          if (err) {
            console.warn('[WIFI] wlan0 disconnect pre-step warning', err.message)
          }
        })
        const nm = spawn('nmcli', ['connection', 'up', 'id', profileId])
        let nmStderr = ''
        nm.stderr?.on('data', chunk => {
          nmStderr += String(chunk || '')
        })

        nm.on('close', async code => {
          if (code !== 0) {
            wifiOperationInFlight = false
            console.error('[WIFI] known profile activation failed with code', code, nmStderr.trim())
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: false }))
          }

          setTimeout(async () => {
            const online = await checkInternetOnce()
            wifiOperationInFlight = false

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: online }))

            if (online) {
              broadcast({ type: 'INTERNET_RESTORED' })
            }
          }, 2000)
        })
      } catch (e) {
        wifiOperationInFlight = false
        console.error('[WIFI] Invalid known profile request', e)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false }))
      }
    })

    return
  }

  if (req.method === 'POST' && req.url === '/wifi-delete-known') {
    let body = ''

    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', async () => {
      try {
        const { id, ssid } = JSON.parse(body || '{}')
        const profileId = String(id || '').trim()
        const profileSsid = String(ssid || '').trim()

        if (!profileId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'Missing profile' }))
        }

        if (!IS_PI) {
          console.log('[WIFI] compat-mode delete accepted for', profileId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: true }))
        }

        let activeSsid = ''
        try {
          const { stdout: activeStdout } = await execCommand('nmcli', [
            '-t',
            '--escape',
            'no',
            '-f',
            'ACTIVE,SSID',
            'device',
            'wifi',
            'list',
            '--rescan',
            'no',
          ])

          const activeLine = String(activeStdout || '')
            .split('\n')
            .find(line => line.startsWith('yes:'))
          activeSsid = activeLine ? activeLine.replace(/^yes:/, '').trim() : ''
        } catch (error) {
          console.warn(
            '[WIFI] active SSID lookup failed before delete',
            error?.stderr || error?.message || error,
          )
        }

        if (profileSsid && activeSsid && profileSsid === activeSsid) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ success: false, error: 'CONNECTED_PROFILE' }))
        }

        console.log('[WIFI] Deleting known profile', profileId)
        const { stderr } = await execCommand('nmcli', ['connection', 'delete', 'id', profileId])

        if (stderr && String(stderr).trim()) {
          console.warn('[WIFI] delete known profile stderr', String(stderr).trim())
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        console.error('[WIFI] delete known profile failed', e?.stderr || e?.message || e)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'DELETE_FAILED' }))
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

        const compatResult = await resolveCompatGamePackageEntry({
          id,
          packageUrl,
        })

        const result =
          compatResult ||
          (await installEncryptedGamePackage({
            id,
            packageUrl,
            version: version ?? 1,
            force: Boolean(force),
          }))

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

  if (req.method === 'POST' && req.url === '/system/restart') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      try {
        if (body) JSON.parse(body)
      } catch {
        // Ignore invalid body for this endpoint.
      }
      sendJson(res, 200, { success: true, action: 'restart', scheduled: true })
      scheduleSystemPowerAction('restart')
    })
    return
  }

  if (req.method === 'POST' && req.url === '/system/restart-input') {
    try {
      sendJson(res, 200, { success: true, service: 'arcade-input.service', scheduled: true })
      scheduleManagedServiceRestart('arcade-input.service')
    } catch (error) {
      console.error('[SYSTEM] input restart failed', error)
      return sendJson(res, 500, { success: false, error: 'INPUT_RESTART_FAILED' })
    }
    return
  }

  if (req.method === 'POST' && req.url === '/system/shutdown') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      try {
        if (body) JSON.parse(body)
      } catch {
        // Ignore invalid body for this endpoint.
      }
      sendJson(res, 200, { success: true, action: 'shutdown', scheduled: true })
      scheduleSystemPowerAction('shutdown')
    })
    return
  }

  if (req.method === 'POST' && req.url === '/system/volume') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', async () => {
      let direction = 'up'
      try {
        const payload = body ? JSON.parse(body) : {}
        direction =
          String(payload.direction || 'up')
            .trim()
            .toLowerCase() === 'down'
            ? 'down'
            : 'up'
      } catch {
        // Ignore invalid body and keep the default direction.
      }

      try {
        const current = await getSpeakerVolumeState()
        if (current.error === 'NO_AUDIO_DEVICE') {
          return sendJson(res, 200, current)
        }

        let stepCount = 1
        try {
          const payload = body ? JSON.parse(body) : {}
          const parsedStep = Number(payload.step ?? 1)
          if (Number.isFinite(parsedStep)) {
            stepCount = Math.max(1, Math.min(8, Math.round(parsedStep)))
          }
        } catch {}

        const step = direction === 'down' ? -stepCount : stepCount
        const nextRaw = Math.max(current.rawMin, Math.min(current.rawMax, current.rawValue + step))

        await execFileAsync('amixer', ['-c', '0', 'cset', 'numid=6', `${nextRaw},${nextRaw}`])
        await execFileAsync('amixer', ['-c', '0', 'cset', 'numid=5', 'on,on']).catch(() => {})

        const updated = await getSpeakerVolumeState()
        return sendJson(res, 200, {
          ...updated,
          direction,
        })
      } catch (error) {
        console.error('[AUDIO] volume adjust failed', error?.message || error)
        return sendJson(res, 500, { success: false, error: 'VOLUME_ADJUST_FAILED' })
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/arcade-shell-update/run') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', async () => {
      let reason = 'manual'
      try {
        const payload = body ? JSON.parse(body) : {}
        if (typeof payload.reason === 'string' && payload.reason.trim()) {
          reason = payload.reason.trim()
        }
      } catch {
        // Ignore invalid body for this endpoint.
      }

      const result = await triggerArcadeShellUpdate(reason)
      return sendJson(res, 200, { success: true, ...result })
    })
    return
  }

  if (req.method === 'POST' && req.url === '/arcade-life/balance') {
    let body = ''

    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', () => {
      try {
        const { balance } = JSON.parse(body || '{}')
        const nextBalance = toMoney(balance, NaN)

        if (!Number.isFinite(nextBalance)) {
          console.warn('[ARCADE LIFE BALANCE] invalid payload', body)
          return sendJson(res, 400, { success: false, error: 'Invalid balance' })
        }

        // Guard: reject if no active session
        if (!arcadeSession?.active) {
          console.warn('[ARCADE LIFE BALANCE] rejected (no active session)', {
            nextBalance,
          })
          return sendJson(res, 403, { success: false, error: 'NOT_IN_SESSION' })
        }

        console.log('[ARCADE LIFE BALANCE] push', {
          nextBalance,
          active: Boolean(arcadeSession?.active),
        })

        const previous = arcadeSession.lastKnownBalance
        const changed = previous !== nextBalance
        arcadeSession.lastKnownBalance = nextBalance
        noteArcadeBalancePush(nextBalance)

        if (changed) {
          console.log('[ARCADE LIFE BALANCE] applied', {
            previous,
            next: nextBalance,
          })

          broadcastArcadeLifeState('balance_push', { balance: nextBalance })
          showArcadeOsdMessage(composeArcadeOsdOverlay(''), { bypassCooldown: true })
        }

        return sendJson(res, 200, { success: true, balance: nextBalance })
      } catch (err) {
        console.warn('[ARCADE LIFE BALANCE] invalid JSON', err?.message || err)
        return sendJson(res, 400, { success: false, error: 'Invalid JSON' })
      }
    })

    return
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

  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}')
      console.log('[INPUT HTTP]', payload)

      if (payload.type === 'WITHDRAW') {
        if (retroarchActive) {
          console.log('[HOPPER] blocked HTTP withdraw during RetroArch')
          res.writeHead(409)
          return res.end('Withdraw blocked during RetroArch')
        }
        const validation = await validateWithdrawRequest(payload.amount)
        if (!validation.ok) {
          console.warn('[HOPPER] withdraw rejected', validation)
          res.writeHead(validation.status || 409)
          return res.end(validation.error || 'Withdraw rejected')
        }

        startHopper(validation.amount)
        res.writeHead(200)
        return res.end('OK')
      }

      function onRetroarchStarted() {
        if (!arcadeSession?.active) {
          console.warn('[ARCADE TIME] retroarch started but no session')
        } else {
          maybeStartArcadeTimeSession('retroarch_started')
          startArcadeTimeLoop()
        }

        stopSplashForRetroarch('retroarch-ready')
      }

      if (payload.type === 'LAUNCH_GAME') {
        const result = await retroarchLaunchRuntime.launchGame(payload, onRetroarchStarted)
        if (!result.ok) {
          res.writeHead(result.status || 400)
          return res.end(result.error || 'Launch failed')
        }
      }

      startArcadeTimeLoop()
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
  return checkCabinetBackendReachability().then(res => res.ok)
}

function hasLocalNetworkLink() {
  const info = getNetworkInfo()
  return Boolean(info?.ethernet || info?.wifi)
}

function getCompatOnlineState(online, hasLink) {
  if (!IS_PI) return Boolean(online || hasLink)
  return Boolean(online)
}

let checkingNetwork = false

async function monitorInternet() {
  if (checkingNetwork) return
  checkingNetwork = true

  const online = await checkInternetOnce()
  const hasLink = hasLocalNetworkLink()
  const effectiveOnline = getCompatOnlineState(online, hasLink)

  checkingNetwork = false

  if (lastInternetState === null) {
    lastInternetState = effectiveOnline
    internetOkStreak = effectiveOnline ? 1 : 0
    internetFailStreak = effectiveOnline ? 0 : 1
    return
  }

  if (effectiveOnline) {
    internetOkStreak += 1
    internetFailStreak = 0
  } else if (hasLink) {
    // Keep the cabinet usable when Wi-Fi is still associated but WAN/DNS is flaky.
    internetOkStreak = 0
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

    ;(async () => {
      try {
        const { stdout: stdout2 } = await execCommand('nmcli', [
          '-t',
          '--escape',
          'no',
          '-f',
          'ACTIVE,SSID,SIGNAL',
          'dev',
          'wifi',
          'list',
          '--rescan',
          'no',
        ])

        wifiReading = false

        const activeLine = String(stdout2 || '')
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
      } catch (error) {
        wifiReading = false
        console.error('[WIFI] status read failed', error?.stderr || error?.message || error)
      }
    })()
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
