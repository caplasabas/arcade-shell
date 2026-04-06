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

const SERVICE_DIR = process.env.ARCADE_SERVICE_DIR || process.cwd()
const ARCADE_RUNTIME_DIR = process.env.ARCADE_RUNTIME_DIR || path.resolve(SERVICE_DIR, '..')
const ROMS_ROOT = process.env.ARCADE_ROMS_DIR || path.join(ARCADE_RUNTIME_DIR, 'roms')

const DIST_DIR = process.env.ARCADE_UI_DIST_DIR || path.join(ARCADE_RUNTIME_DIR, 'ui/dist')
const DEFAULT_RUNTIME_DIR =
  process.platform === 'linux' ? '/dev/shm/arcade-games' : path.join(os.tmpdir(), 'arcade-games')

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
const HOPPER_NO_PULSE_TIMEOUT_MS = 5000
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

async function withTimeout(promise, ms = 5000) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  return Promise.race([promise, timeout])
}

function noteArcadeBalancePush(nextBalance) {
  if (!Number.isFinite(nextBalance)) return
  arcadeBalancePushFloor = toMoney(nextBalance, 0)
  arcadeBalancePushFloorUntil = Date.now() + 8000
}

function clearArcadeBalancePushFloor() {
  arcadeBalancePushFloor = null
  arcadeBalancePushFloorUntil = 0
}

function shouldDeferArcadeBalanceSync(nextBalance) {
  if (!Number.isFinite(nextBalance)) return false
  if (!Number.isFinite(arcadeBalancePushFloor)) return false
  if (Date.now() > arcadeBalancePushFloorUntil) {
    clearArcadeBalancePushFloor()
    return false
  }

  return nextBalance < arcadeBalancePushFloor
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
const ARCADE_LIFE_DEDUCT_MODE =
  String(process.env.ARCADE_LIFE_DEDUCT_MODE || 'every_start').toLowerCase() === 'unlock_once'
    ? 'unlock_once'
    : 'every_start'
const ARCADE_LIFE_DEDUCT_COOLDOWN_MS = parseNonNegativeMs(
  process.env.ARCADE_LIFE_DEDUCT_COOLDOWN_MS,
  500,
)
const ARCADE_LIFE_START_CONFIRM_WINDOW_MS = parseNonNegativeMs(
  process.env.ARCADE_LIFE_START_CONFIRM_WINDOW_MS,
  2500,
)
const ARCADE_LIFE_CREDIT_TTL_MS = parseNonNegativeMs(process.env.ARCADE_LIFE_CREDIT_TTL_MS, 300000)
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

let lastUiVT = UI_VT
let lastUiRestartAt = 0

let chromiumUiHidden = false
let arcadeUiStoppedForRetroarch = false
let splashStartedForRetroarch = false
let retroXWarmRequested = false

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
  if (!RETROARCH_TTY_X_SESSION) return
  if (arcadeUiStoppedForRetroarch) return
  if (KEEP_UI_ALIVE_DURING_TTY_X) {
    console.log('[UI] keeping arcade-ui.service alive during tty X RetroArch launch')
    return
  }

  const proc = spawn('systemctl', ['stop', '--no-block', 'arcade-ui.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  arcadeUiStoppedForRetroarch = true
  console.log('[UI] stop requested before tty X RetroArch launch')
}

function restartArcadeUiAfterRetroarch(reason, forceRestart = false) {
  if (!RETROARCH_TTY_X_SESSION) return
  if (KEEP_UI_ALIVE_DURING_TTY_X && !forceRestart) {
    console.log(`[UI] arcade-ui.service kept alive during tty X RetroArch session (${reason})`)
    return
  }
  if (!forceRestart && !arcadeUiStoppedForRetroarch) return

  arcadeUiStoppedForRetroarch = false
  const action = forceRestart ? 'restart' : 'start'
  const proc = spawn('systemctl', [action, '--no-block', 'arcade-ui.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  console.log(`[UI] ${action} requested after tty X RetroArch exit (${reason})`)
}

function ensureRetroXWarm(reason = 'boot') {
  if (!RETROARCH_TTY_X_SESSION) return
  if (!RETROARCH_TTY_X_PREWARM) return
  if (retroXWarmRequested) return

  const proc = spawn('systemctl', ['start', '--no-block', 'arcade-retro-x.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  retroXWarmRequested = true
  console.log(`[RETRO-X] warm start requested (${reason})`)

  if (reason === 'boot') {
    // Boot starts the prewarmed RetroArch X server on tty1. Force the cabinet back
    // to the menu VT after that warm-up so the user lands on the UI instead.
    setTimeout(() => {
      switchToVTWithRetry(getTargetUiVT(), 'boot-ui')
      setTimeout(() => switchToVTWithRetry(getTargetUiVT(), 'boot-ui-post'), 250)
    }, 3000)
  }
}

setInterval(() => {
  if (!arcadeSession?.active) return

  const now = Date.now()

  for (const player of ['P1', 'P2']) {
    const lastInputAt = lastGameplayInputAt[player] || 0

    if (!lastInputAt) continue

    // 🚫 already dead
    if (gameOverState[player]) continue

    // 🚫 no life
    if (!playerHasStoredCredit(player)) continue

    // 🧠 HARD GATE — nothing happens before gameplay
    if (arcadeSession.sessionPhase !== 'live') continue

    const idleTime = now - lastInputAt

    // 🧠 sustained inactivity AFTER gameplay
    if (idleTime < LIFE_LOSS_IDLE_THRESHOLD_MS) continue

    console.log('[LIFE LOSS DETECTED]', {
      player,
      idleTime,
    })

    lastLifeLossAt = now
    startArcadeContinueCountdown(player)
  }
}, 500)

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
  if (!USE_SPLASH_TRANSITIONS) return
  if (splashStartedForRetroarch) return

  const proc = spawn('systemctl', ['start', '--no-block', 'arcade-splash.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  splashStartedForRetroarch = true
  console.log('[SPLASH] start requested for RetroArch transition')
}

function stopSplashForRetroarch(reason) {
  if (!splashStartedForRetroarch) return

  splashStartedForRetroarch = false
  const proc = spawn('systemctl', ['stop', '--no-block', 'arcade-splash.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  console.log(`[SPLASH] stop requested after RetroArch transition (${reason})`)
}

function ensureSplashReady(reason = 'boot') {
  if (!USE_SPLASH_TRANSITIONS) return
  if (splashStartedForRetroarch) return

  const proc = spawn('systemctl', ['start', '--no-block', 'arcade-splash.service'], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
  splashStartedForRetroarch = true
  console.log(`[SPLASH] warm start requested (${reason})`)
}

function hasCommand(name) {
  const result = spawnSync('sh', ['-lc', `command -v ${name} >/dev/null 2>&1`], {
    stdio: 'ignore',
  })
  return result.status === 0
}

const UI_DISABLE_FLAG_PATH = '/tmp/arcade-ui-disabled'

function hideChromiumUiForRetroarch() {
  if (!SINGLE_X_MODE) return
  if (chromiumUiHidden) return

  let attempted = false

  if (hasCommand('xdotool')) {
    attempted = true
    runXClientCommand(
      'sh',
      [
        '-lc',
        'xdotool search --onlyvisible --class chromium windowunmap %@ >/dev/null 2>&1 || true',
      ],
      'xdotool minimize chromium',
    )
  }

  if (hasCommand('wmctrl')) {
    attempted = true
    runXClientCommand(
      'sh',
      ['-lc', 'wmctrl -x -r chromium.Chromium -b add,hidden >/dev/null 2>&1 || true'],
      'wmctrl hide chromium',
    )
  }

  if (attempted) {
    chromiumUiHidden = true
    console.log('[UI] Chromium hide requested before RetroArch launch')
  } else {
    console.log('[UI] Chromium hide skipped (xdotool/wmctrl not installed)')
  }
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
  if (!SINGLE_X_MODE) return
  if (!chromiumUiHidden) return

  let attempted = false

  if (hasCommand('xdotool')) {
    attempted = true
    runXClientCommand(
      'sh',
      [
        '-lc',
        'xdotool search --class chromium windowmap %@ windowraise %@ >/dev/null 2>&1 || true',
      ],
      'xdotool restore chromium',
    )
  }

  if (hasCommand('wmctrl')) {
    attempted = true
    runXClientCommand(
      'sh',
      [
        '-lc',
        'wmctrl -x -r chromium.Chromium -b remove,hidden >/dev/null 2>&1 || true; wmctrl -x -a chromium.Chromium >/dev/null 2>&1 || true',
      ],
      'wmctrl restore chromium',
    )
  }

  chromiumUiHidden = false

  if (attempted) {
    console.log('[UI] Chromium restore requested after RetroArch exit')
  }
}

let arcadeSession = null
// --- LIFE LOSS HEURISTIC STATE ---
let lastGameplayInputAt = { P1: 0, P2: 0 }
let lastLifeLossAt = 0

let gameOverState = { P1: false, P2: false }
let gameOverTimer = { P1: null, P2: null }
const GAME_OVER_DISPLAY_MS = 3000

const LIFE_LOSS_IDLE_THRESHOLD_MS = 15000 // 15 seconds
const LIFE_LOSS_GRACE_MS = 1500 // start-after-death window
let lastArcadeOsdMessage = ''
let lastArcadeOsdAt = 0
const arcadeContinueCountdownTimers = { P1: null, P2: null }
const arcadeCreditExpiryTimers = { P1: null, P2: null }
let arcadePromptLoopTimer = null
let buyIntentState = 'idle'
let buyIntentUntil = 0
let arcadePromptBlinkPhase = false
let lastArcadePromptLoopMessage = ''
let lastArcadePromptLoopSentAt = 0
let arcadeBalanceSyncTimer = null
let arcadeBalanceSyncInFlight = false
let arcadeCredit = 0
let arcadeCreditSyncInFlight = false
let lastArcadeCreditSyncAt = 0

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
Arcade Life : mode=${ARCADE_LIFE_DEDUCT_MODE} default=₱${ARCADE_LIFE_PRICE_DEFAULT} failOpen=${ARCADE_LIFE_FAIL_OPEN ? 'yes' : 'no'}
Start Confirm: ${ARCADE_LIFE_START_CONFIRM_WINDOW_MS}ms
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

function toMoney(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.round(parsed * 100) / 100)
}

async function fetchDeviceFinancialState(deviceId = DEVICE_ID) {
  if (!hasSupabaseRpcConfig()) return null

  const safeDeviceId = String(deviceId || '').trim()
  if (!safeDeviceId) return null

  const url =
    `${SUPABASE_URL}/rest/v1/devices?` +
    `select=device_id,balance,hopper_balance,arcade_credit&device_id=eq.${encodeURIComponent(safeDeviceId)}&limit=1`

  const response = await requestJsonWithCurl(url, {
    method: 'GET',
    headers: getSupabaseHeaders(),
    timeoutMs: 2500,
  })

  if (!response.ok) {
    throw new Error(`device state fetch failed (${response.status})`)
  }

  const rows = response.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) {
    return {
      deviceId: safeDeviceId,
      balance: 0,
      hopperBalance: 0,
      arcadeCredit: 0,
    }
  }

  return {
    deviceId: String(row.device_id || safeDeviceId),
    balance: toMoney(row.balance, 0),
    hopperBalance: toMoney(row.hopper_balance, 0),
    arcadeCredit: Number(row.arcade_credit || 0),
  }
}

function getMaxWithdrawalAmountForHopperBalance(hopperBalance) {
  const safeHopperBalance = toMoney(hopperBalance, 0)

  if (safeHopperBalance <= 0) return 0
  if (safeHopperBalance <= 300) return 60
  if (safeHopperBalance <= 500) return 100
  if (safeHopperBalance <= 1000) return 300
  if (safeHopperBalance <= 1500) return 500
  return 1000
}

async function recordWithdrawalDispense(amount) {
  const dispenseAmount = toMoney(amount, 0)
  if (dispenseAmount <= 0 || !hasSupabaseRpcConfig()) return

  const context = activeWithdrawalContext
  const requestId = context?.requestId || `withdraw-${Date.now()}`
  const requestedAmount = toMoney(context?.requestedAmount, dispenseAmount)
  const nextDispensedTotal = toMoney(
    (context?.dispensedTotal || 0) + dispenseAmount,
    dispenseAmount,
  )

  if (context) {
    context.dispensedTotal = nextDispensedTotal
  }

  const eventTs = new Date().toISOString()
  const metadata = {
    source: 'hopper',
    request_id: requestId,
    requested_amount: requestedAmount,
    dispensed_total: nextDispensedTotal,
  }

  try {
    await safeRpcCall(
      body =>
        requestJsonWithCurl(`${SUPABASE_URL}/rest/v1/rpc/apply_metric_event`, {
          method: 'POST',
          headers: getSupabaseHeaders(),
          timeoutMs: 3500,
          body,
        }),
      {
        p_device_id: DEVICE_ID,
        p_event_type: 'withdrawal',
        p_amount: dispenseAmount,
        p_event_ts: eventTs,
        p_metadata: metadata,
        p_write_ledger: true,
      },
    )
  } catch (error) {
    console.error('[WITHDRAW] dispense accounting failed', {
      amount: dispenseAmount,
      requestId,
      error: error?.message || error,
    })
  }
}

async function recordHopperTopup(amount) {
  const topupAmount = toMoney(amount, 0)
  if (topupAmount <= 0 || !hasSupabaseRpcConfig()) return

  const eventTs = new Date().toISOString()
  const metadata = {
    source: 'hopper_topup_slot',
  }

  try {
    await safeRpcCall(
      body =>
        requestJsonWithCurl(`${SUPABASE_URL}/rest/v1/rpc/apply_metric_event`, {
          method: 'POST',
          headers: getSupabaseHeaders(),
          timeoutMs: 3500,
          body,
        }),
      {
        p_device_id: DEVICE_ID,
        p_event_type: 'hopper_in',
        p_amount: topupAmount,
        p_event_ts: eventTs,
        p_metadata: metadata,
        p_write_ledger: true,
      },
    )
  } catch (error) {
    console.error('[HOPPER] topup accounting failed', {
      amount: topupAmount,
      error: error?.message || error,
    })
  }
}

async function validateWithdrawRequest(amount) {
  const requestedAmount = toMoney(amount, 0)
  if (requestedAmount <= 0) {
    return { ok: false, status: 400, error: 'Invalid withdraw amount' }
  }

  if (hopperActive) {
    return { ok: false, status: 409, error: 'Withdrawal already in progress' }
  }

  if (!IS_PI || !hasSupabaseRpcConfig()) {
    return { ok: true, amount: requestedAmount }
  }

  const state = await fetchDeviceFinancialState(DEVICE_ID)
  const balance = toMoney(state?.balance, 0)
  const hopperBalance = toMoney(state?.hopperBalance, 0)
  const hopperCap = getMaxWithdrawalAmountForHopperBalance(hopperBalance)
  const maxWithdrawalAmount = Math.max(0, Math.min(balance, hopperBalance, hopperCap))

  if (balance < requestedAmount) {
    return { ok: false, status: 409, error: 'Insufficient balance' }
  }

  if (hopperBalance < requestedAmount) {
    return { ok: false, status: 409, error: 'Insufficient hopper balance' }
  }

  if (requestedAmount > maxWithdrawalAmount) {
    return {
      ok: false,
      status: 409,
      error: `Max withdrawal amount is ${formatPeso(maxWithdrawalAmount)}`,
      balance,
      hopperBalance,
      maxWithdrawalAmount,
    }
  }

  return {
    ok: true,
    amount: requestedAmount,
    balance,
    hopperBalance,
    maxWithdrawalAmount,
  }
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
  if (retroarchActive) return 'START'
  if (ARCADE_LIFE_PURCHASE_LABEL === 'START') return 'START'
  return `START OR ${ARCADE_LIFE_PURCHASE_LABEL}`
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

  const clean = String(command || '').trim()
  const message = `${clean}\n`
  if (!message.trim()) return
  const urgent = options?.urgent === true
  const retryCount = Math.max(1, ARCADE_RETRO_OSD_RETRY_COUNT)
  const retryIntervalMs = urgent ? 60 : ARCADE_RETRO_OSD_RETRY_INTERVAL_MS

  const sendViaStdin = attempt => {
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
  return action === 'WITHDRAW' || action === 'WITHDRAW_COIN' || action === 'HOPPER_COIN'
}

function composeArcadeOsdOverlay(message, balanceOverride = null, options = null) {
  const base = String(message || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!arcadeSession?.active) return base

  const p1Lives = Number(arcadeSession.playerLivesPurchased?.P1 || 0)
  const p2Lives = Number(arcadeSession.playerLivesPurchased?.P2 || 0)
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
      hudParts.push(`P1:${p1Lives}`, `P2:${p2Lives}`, `Balance:P${balanceText}`)
    }
    const continueSeconds = Number(options?.continueSeconds)
    if (Number.isFinite(continueSeconds) && continueSeconds >= 0) {
      hudParts.push(`CONTINUE:${String(Math.round(continueSeconds)).padStart(2, '0')}`)
    }
    return hudParts.join(' | ')
  }

  return `${arcadeOverlayNotice || base} | P1:${p1Lives} P2:${p2Lives} Balance:P${balanceText}`
}

function getArcadeRetroFooterState(balanceOverride = null) {
  const rawBalance =
    balanceOverride === null || balanceOverride === undefined
      ? arcadeSession?.lastKnownBalance
      : balanceOverride
  const balanceText = formatArcadeBalanceForOsd(rawBalance)
  const now = Date.now()
  const p1ConfirmArmed = Number(arcadeSession?.startConfirmUntil?.P1 || 0) > now
  const p2ConfirmArmed = Number(arcadeSession?.startConfirmUntil?.P2 || 0) > now
  const exitConfirmArmed = Number(retroarchExitConfirmUntil || 0) > now
  const p1HasCredit = Number(arcadeSession?.playerLivesPurchased?.P1 || 0) > 0
  const p2HasCredit = Number(arcadeSession?.playerLivesPurchased?.P2 || 0) > 0
  const joinMode = normalizeArcadeJoinMode(arcadeSession?.joinMode)
  const sessionPhase = String(arcadeSession?.sessionPhase || 'prestart')
  const p2BlockedMidRun = joinMode === 'alternating' && sessionPhase === 'live'
  const p2Disabled = joinMode === 'single_only'

  let leftBase

  if (gameOverState.P1) {
    leftBase = 'P1 · GAME OVER'
  } else if (arcadeCredit > 0) {
    if (p1HasCredit) {
      leftBase = p1ConfirmArmed ? 'P1 · START' : 'P1 · PLAY'
    } else {
      leftBase = 'P1 · START'
    }
  } else {
    leftBase = 'P1 · BUY'
  }

  const isOffline = typeof hasLocalNetworkLink === 'function' && !hasLocalNetworkLink()

  const centerBase = exitConfirmArmed
    ? 'EXIT GAME?'
    : isOffline
      ? 'OFFLINE'
      : `CREDITS ${arcadeCredit} | ₱${balanceText}`

  let rightBase

  if (gameOverState.P2) {
    rightBase = 'P2 · GAME OVER'
  } else if (arcadeCredit > 0) {
    if (!p2HasCredit) {
      if (p2Disabled) {
        rightBase = 'SOLO'
      } else if (p2BlockedMidRun) {
        rightBase = 'WAIT'
      } else {
        rightBase = 'P2 · START'
      }
    } else if (p2ConfirmArmed) {
      rightBase = 'P2 · START'
    } else {
      rightBase = 'P2 · PLAY'
    }
  } else {
    rightBase = 'P2 · BUY'
  }

  const visible = Boolean(
    arcadeOverlayNotice ||
    exitConfirmArmed ||
    p1ConfirmArmed ||
    p2ConfirmArmed ||
    !p1HasCredit ||
    !p2HasCredit,
  )

  return {
    active: Boolean(arcadeSession?.active),
    visible,
    gameName: arcadeSession?.gameName || null,
    balanceText,
    leftText: arcadeOverlayNotice?.slot === 'left' ? arcadeOverlayNotice.text : leftBase,
    centerText: arcadeOverlayNotice?.slot === 'center' ? arcadeOverlayNotice.text : centerBase,
    rightText: arcadeOverlayNotice?.slot === 'right' ? arcadeOverlayNotice.text : rightBase,
    p1HasCredit,
    p2HasCredit,
    joinMode,
    sessionPhase,
    p1ConfirmArmed,
    p2ConfirmArmed,
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
  if (!arcadeSession?.active) return ARCADE_LIFE_PRICE_DEFAULT
  return toMoney(arcadeSession.pricePerLife, ARCADE_LIFE_PRICE_DEFAULT)
}

function clearArcadeContinueCountdown(player = null) {
  const players =
    player && arcadeContinueCountdownTimers[player] !== undefined
      ? [player]
      : Object.keys(arcadeContinueCountdownTimers)

  for (const currentPlayer of players) {
    const timer = arcadeContinueCountdownTimers[currentPlayer]
    if (!timer) continue
    clearTimeout(timer)
    arcadeContinueCountdownTimers[currentPlayer] = null
  }
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

function clearArcadeCreditExpiry(player = null) {
  const players =
    player && arcadeCreditExpiryTimers[player] !== undefined
      ? [player]
      : Object.keys(arcadeCreditExpiryTimers)

  for (const currentPlayer of players) {
    const timer = arcadeCreditExpiryTimers[currentPlayer]
    if (!timer) continue
    clearTimeout(timer)
    arcadeCreditExpiryTimers[currentPlayer] = null
  }
}

function playerHasStoredCredit(player) {
  if (!arcadeSession?.active) return false
  if (player !== 'P1' && player !== 'P2') return false
  return Number(arcadeSession.playerLivesPurchased?.[player] || 0) > 0
}

function shouldPromoteArcadeSessionToLive(player, index) {
  if (!arcadeSession?.active) return false
  if (!playerHasStoredCredit(player)) return false
  if (isStartButton(index)) return false
  return true
}

function markArcadeSessionLive(reason = 'gameplay_input') {
  if (!arcadeSession?.active) return
  if (arcadeSession.sessionPhase === 'live') return
  arcadeSession.sessionPhase = 'live'
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
  if (arcadePromptLoopTimer !== null) {
    clearTimeout(arcadePromptLoopTimer)
    arcadePromptLoopTimer = null
  }
  arcadePromptBlinkPhase = false
  lastArcadePromptLoopMessage = ''
  lastArcadePromptLoopSentAt = 0
}

function buildArcadePromptMessage() {
  if (!arcadeSession?.active) return ''

  const p1HasCredit = playerHasStoredCredit('P1')
  const p2HasCredit = playerHasStoredCredit('P2')
  const joinMode = normalizeArcadeJoinMode(arcadeSession.joinMode)
  const sessionPhase = String(arcadeSession.sessionPhase || 'prestart')
  const p2PurchaseAllowed = isArcadePurchaseAllowed('P2')

  const waitingP1 = !p1HasCredit && !arcadeContinueCountdownTimers.P1
  const waitingP2 = !p2HasCredit && !arcadeContinueCountdownTimers.P2

  if (waitingP1 || waitingP2) {
    const priceText = getArcadeSessionPrice().toFixed(2)
    const actionLabel = getArcadeLifePromptActionLabel()

    if (waitingP1 && waitingP2) {
      return composeArcadeOsdOverlay(`PRESS ${actionLabel} TO PLAY (P${priceText}/CREDIT)`)
    }
    if (waitingP1) {
      return composeArcadeOsdOverlay(`P1 PRESS ${actionLabel} (P${priceText})`)
    }
    if (!p2PurchaseAllowed) {
      return composeArcadeOsdOverlay(
        joinMode === 'alternating' && sessionPhase === 'live' ? 'P2 NEXT TURN' : '1 PLAYER ONLY',
      )
    }
    return composeArcadeOsdOverlay(`P2 PRESS ${actionLabel} (P${priceText})`)
  }

  if (!p1HasCredit || !p2HasCredit) {
    const priceText = getArcadeSessionPrice().toFixed(2)
    const actionLabel = getArcadeLifePromptActionLabel()

    if (!p1HasCredit && !p2HasCredit) {
      return composeArcadeOsdOverlay(`LOCKED | PRESS ${actionLabel} (P${priceText}/CREDIT)`)
    }
    if (!p1HasCredit) {
      return composeArcadeOsdOverlay(`P1 LOCKED | PRESS ${actionLabel} (P${priceText})`)
    }
    if (!p2PurchaseAllowed) {
      return composeArcadeOsdOverlay(
        joinMode === 'alternating' && sessionPhase === 'live' ? 'P2 NEXT TURN' : '1 PLAYER ONLY',
      )
    }
    return composeArcadeOsdOverlay(`P2 LOCKED | PRESS ${actionLabel} (P${priceText})`)
  }

  return ''
}

function scheduleArcadePromptLoop() {
  clearArcadePromptLoop()
  if (!ARCADE_RETRO_OSD_PROMPT_PERSIST) return
  const HEARTBEAT_MS = 4000

  const tick = () => {
    if (!arcadeSession?.active) {
      clearArcadePromptLoop()
      return
    }

    if (buyIntentState === 'armed' && Date.now() > buyIntentUntil) {
      buyIntentState = 'idle'
    }

    const promptMessage = buildArcadePromptMessage()
    if (promptMessage) {
      if (ARCADE_RETRO_OSD_PROMPT_BLINK) {
        arcadePromptBlinkPhase = !arcadePromptBlinkPhase
        if (arcadePromptBlinkPhase) {
          showArcadeOsdMessage(promptMessage, { bypassCooldown: true })
        } else {
          // Best-effort clear frame for blinking.
          showArcadeOsdMessage('', { allowBlank: true, bypassCooldown: true })
        }
      } else {
        const now = Date.now()
        const changed = promptMessage !== lastArcadePromptLoopMessage
        const heartbeatDue = now - lastArcadePromptLoopSentAt >= HEARTBEAT_MS

        if (changed || heartbeatDue) {
          showArcadeOsdMessage(promptMessage, { bypassCooldown: changed })
          lastArcadePromptLoopMessage = promptMessage
          lastArcadePromptLoopSentAt = now
        }
      }
    } else {
      arcadePromptBlinkPhase = false
      lastArcadePromptLoopMessage = ''
      lastArcadePromptLoopSentAt = 0
    }

    arcadePromptLoopTimer = setTimeout(tick, ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS)
  }

  tick()
}

function startArcadeContinueCountdown(player) {
  if (!arcadeSession?.active) return
  if (player !== 'P1' && player !== 'P2') return
  if (arcadeContinueCountdownTimers[player]) return

  // --- GAME OVER DETECTION ---
  gameOverState[player] = true

  if (gameOverTimer[player]) {
    clearTimeout(gameOverTimer[player])
  }

  gameOverTimer[player] = setTimeout(() => {
    gameOverState[player] = false
  }, GAME_OVER_DISPLAY_MS)

  console.log('[ARCADE] GAME OVER detected', { player })

  if (arcadeSession?.active) {
    arcadeSession.playerLivesPurchased[player] = 0
    console.log('[ARCADE] LIFE EXPIRED', { player })
  }

  clearArcadeContinueCountdown(player)

  // No continue countdown — immediate GAME OVER behavior
  broadcastArcadeLifeState('game_over', {
    player,
  })

  refreshArcadeOsdMessage()
}

function broadcastArcadeLifeState(status = 'state', extra = {}) {
  if (!arcadeSession?.active) {
    dispatch({
      type: 'ARCADE_LIFE_STATE',
      active: false,
      status,
      ...extra,
    })
    return
  }

  dispatch({
    type: 'ARCADE_LIFE_STATE',
    active: true,
    status,
    gameId: arcadeSession.gameId,
    gameName: arcadeSession.gameName,
    pricePerLife: arcadeSession.pricePerLife,
    joinMode: normalizeArcadeJoinMode(arcadeSession.joinMode),
    sessionPhase: arcadeSession.sessionPhase || 'prestart',
    p1Unlocked: playerHasStoredCredit('P1'),
    p2Unlocked: playerHasStoredCredit('P2'),
    p1LivesPurchased: Number(arcadeSession.playerLivesPurchased?.P1 || 0),
    p2LivesPurchased: Number(arcadeSession.playerLivesPurchased?.P2 || 0),
    balance: arcadeSession.lastKnownBalance,
    ...extra,
  })
}

async function fetchDeviceBalanceSnapshot() {
  if (!hasSupabaseRpcConfig()) return null

  const url =
    `${SUPABASE_URL}/rest/v1/devices?` +
    `select=balance&device_id=eq.${encodeURIComponent(DEVICE_ID)}&limit=1`

  const response = await requestJsonWithCurl(url, {
    method: 'GET',
    headers: getSupabaseHeaders(),
    timeoutMs: 2500,
  })
  if (!response.ok) {
    throw new Error(`balance fetch failed (${response.status})`)
  }

  const rows = response.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null
  if (row.balance === null || row.balance === undefined) return null
  return toMoney(row.balance, 0)
}

function clearArcadeBalanceSyncLoop() {
  if (arcadeBalanceSyncTimer !== null) {
    clearTimeout(arcadeBalanceSyncTimer)
    arcadeBalanceSyncTimer = null
  }
}

async function syncArcadeSessionBalance(options = {}) {
  if (!arcadeSession?.active) return
  if (!hasSupabaseRpcConfig()) return
  if (arcadeBalanceSyncInFlight) return

  const forceBroadcast = options?.forceBroadcast === true
  arcadeBalanceSyncInFlight = true
  try {
    const latestBalance = await fetchDeviceBalanceSnapshot()
    if (!arcadeSession?.active) return
    if (latestBalance === null || latestBalance === undefined) return
    if (shouldDeferArcadeBalanceSync(latestBalance)) {
      console.log('[ARCADE LIFE BALANCE] deferred stale sync', {
        current: arcadeSession.lastKnownBalance,
        next: latestBalance,
        floor: arcadeBalancePushFloor,
      })
      return
    }

    // 🔒 prevent stale overwrite after recent mutation
    if (
      arcadeSession.lastBalanceMutationAt &&
      Date.now() - arcadeSession.lastBalanceMutationAt < 1500 &&
      latestBalance < (arcadeSession.lastKnownBalance || 0)
    ) {
      console.log('[ARCADE LIFE BALANCE] ignored stale post-mutation sync', {
        latestBalance,
      })
      return
    }

    const previous = arcadeSession.lastKnownBalance
    if (previous !== null && previous > 0 && latestBalance === 0) {
      console.log('[ARCADE LIFE BALANCE] rejected zero regression', {
        previous,
        next: latestBalance,
      })
      return
    }
    if (
      previous !== null &&
      latestBalance < previous &&
      Date.now() - (arcadeSession.lastBalanceMutationAt || 0) < 3000
    ) {
      console.log('[ARCADE LIFE BALANCE] rejected regression', {
        previous,
        next: latestBalance,
      })
      return
    }

    arcadeSession.lastKnownBalance = latestBalance

    if (Number.isFinite(arcadeBalancePushFloor) && latestBalance >= arcadeBalancePushFloor) {
      clearArcadeBalancePushFloor()
    }

    if (previous !== latestBalance) {
      console.log('[ARCADE LIFE BALANCE] applied', { previous, next: latestBalance })
      broadcastArcadeLifeState('balance_sync', { balance: latestBalance })
      refreshArcadeOsdMessage()
    }
  } catch {
    // Keep loop alive; transient Supabase/network failures are expected.
  } finally {
    arcadeBalanceSyncInFlight = false
  }
}

async function syncArcadeCredit() {
  if (!hasSupabaseRpcConfig()) return
  if (arcadeCreditSyncInFlight) return

  arcadeCreditSyncInFlight = true
  try {
    const state = await fetchDeviceFinancialState(DEVICE_ID)
    if (!state) return

    const nextCredit = Number(state.arcadeCredit || 0)

    if (arcadeCredit !== nextCredit) {
      console.log('[ARCADE CREDIT] sync', {
        previous: arcadeCredit,
        next: nextCredit,
      })
    }

    arcadeCredit = nextCredit

    // 🔒 Desync guard: prevent negative drift after purchase/consume
    if (arcadeCredit < 0) {
      console.warn('[ARCADE CREDIT] corrected negative drift', { nextCredit })
      arcadeCredit = 0
    }

    // mark last authoritative sync
    arcadeSession && (arcadeSession.lastCreditSyncAt = Date.now())

    // 🔁 Force overlay consistency after credit change
    broadcastArcadeLifeState('credit_sync', {
      arcadeCredit,
    })

    lastArcadeCreditSyncAt = Date.now()
    arcadeSession.lastBalanceMutationAt = Date.now()

    refreshArcadeOsdMessage()
  } catch (err) {
    console.warn('[ARCADE CREDIT] sync failed', err?.message || err)
  } finally {
    arcadeCreditSyncInFlight = false
  }
}

function scheduleArcadeBalanceSyncLoop() {
  clearArcadeBalanceSyncLoop()
  if (!hasSupabaseRpcConfig()) return

  const tick = async () => {
    if (!arcadeSession?.active) {
      clearArcadeBalanceSyncLoop()
      return
    }

    // 🔒 sequential to avoid race conditions (credit depends on balance mutations)
    await syncArcadeSessionBalance()
    await syncArcadeCredit()
    arcadeBalanceSyncTimer = setTimeout(tick, ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS)
  }

  tick()
}

function startArcadeLifeSession({
  gameId,
  gameName,
  pricePerLife,
  initialBalance = null,
  joinMode = 'simultaneous',
}) {
  clearArcadeBalanceSyncLoop()
  clearArcadePromptLoop()
  clearArcadeContinueCountdown()
  clearArcadeCreditExpiry()
  clearArcadeOverlayNotice()
  arcadeSession = {
    active: true,
    gameId: String(gameId || '').trim() || 'unknown',
    gameName: String(gameName || '').trim() || String(gameId || '').trim() || 'Arcade Game',
    pricePerLife: toMoney(pricePerLife, ARCADE_LIFE_PRICE_DEFAULT),
    joinMode: normalizeArcadeJoinMode(joinMode),
    sessionPhase: 'prestart',
    playerUnlocked: { P1: false, P2: false },
    playerLivesPurchased: { P1: 0, P2: 0 },
    purchaseInFlight: { P1: false, P2: false },
    startConfirmUntil: { P1: 0, P2: 0 },
    lastChargeAt: { P1: 0, P2: 0 },
    successfulChargeAt: { P1: 0, P2: 0 },
    lastKnownBalance:
      initialBalance === null || initialBalance === undefined ? null : toMoney(initialBalance, 0),
  }

  const priceText = getArcadeSessionPrice().toFixed(2)
  const actionLabel = getArcadeLifePromptActionLabel()
  showArcadeOsdMessage(
    composeArcadeOsdOverlay(`PRESS ${actionLabel} TO PLAY (P${priceText}/CREDIT)`),
  )
  broadcastArcadeLifeState('started')

  // RetroArch netcmd can come up a bit after launch; resend the prompt once.
  const sessionRef = arcadeSession
  setTimeout(() => {
    if (!arcadeSession?.active || arcadeSession !== sessionRef) return
    if (playerHasStoredCredit('P1') || playerHasStoredCredit('P2')) return
    const promptPriceText = getArcadeSessionPrice().toFixed(2)
    const promptActionLabel = getArcadeLifePromptActionLabel()
    showArcadeOsdMessage(
      composeArcadeOsdOverlay(`PRESS ${promptActionLabel} TO PLAY (P${promptPriceText}/CREDIT)`),
    )
  }, 2000)
  scheduleArcadePromptLoop()
  scheduleArcadeBalanceSyncLoop()
  syncArcadeSessionBalance({ forceBroadcast: true })
}

function clearArcadeLifeSession(reason = 'ended') {
  if (!arcadeSession?.active) return

  const endedSession = arcadeSession
  arcadeSession = null
  clearArcadeBalancePushFloor()
  clearArcadeBalanceSyncLoop()
  clearArcadePromptLoop()
  clearArcadeContinueCountdown()
  clearArcadeCreditExpiry()
  clearArcadeOverlayNotice()
  dispatch({
    type: 'ARCADE_LIFE_SESSION_ENDED',
    status: reason,
    gameId: endedSession.gameId,
    gameName: endedSession.gameName,
    p1LivesPurchased: Number(endedSession.playerLivesPurchased?.P1 || 0),
    p2LivesPurchased: Number(endedSession.playerLivesPurchased?.P2 || 0),
    balance: endedSession.lastKnownBalance,
  })
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
  if (!hasSupabaseRpcConfig()) return []

  const safeDeviceId = String(deviceId || '').trim()
  if (!safeDeviceId) return []

  const url =
    `${SUPABASE_URL}/rest/v1/cabinet_games?` +
    `select=device_id,game_id,games!inner(` +
    `id,name,type,price,join_mode,box_art_url,emulator_core,rom_path,package_url,version,enabled` +
    `)&device_id=eq.${encodeURIComponent(safeDeviceId)}&installed=eq.true`

  try {
    const response = await requestJsonWithCurl(url, {
      method: 'GET',
      headers: getSupabaseHeaders(),
      timeoutMs: 2500,
    })
    if (!response.ok) {
      const text = response.text || ''
      console.error('[CABINET GAMES] fetch failed', response.status, text)
      return []
    }

    const rows = response.json()
    if (!Array.isArray(rows)) return []

    return rows
      .map(row => row?.games)
      .filter(Boolean)
      .map(game => ({
        id: game.id,
        name: game.name,
        type: game.type,
        enabled: game.enabled !== false,
        price: toMoney(game.price, 0),
        join_mode: normalizeArcadeJoinMode(game.join_mode),
        art: String(game.box_art_url || '').startsWith('assets/boxart/')
          ? `/roms/boxart/${String(game.box_art_url).slice('assets/boxart/'.length)}`
          : String(game.box_art_url || ''),
        emulator_core: game.emulator_core || null,
        rom_path: game.rom_path || null,
        package_url: game.package_url || null,
        version: Number(game.version || 1),
      }))
      .filter(game => game.type !== 'casino' || game.enabled !== false)
      .sort((a, b) => {
        const enabledDelta = Number(b.enabled !== false) - Number(a.enabled !== false)
        if (enabledDelta !== 0) return enabledDelta
        return String(a.name || '').localeCompare(String(b.name || ''))
      })
  } catch (err) {
    console.error('[CABINET GAMES] fetch error', err?.message || err)
    return []
  }
}

async function rpcBuyArcadeCredit({ deviceId, gameId }) {
  if (!hasSupabaseRpcConfig()) {
    return { ok: false, error: 'missing_config' }
  }

  try {
    const response = await requestJsonWithCurl(
      `${SUPABASE_URL}/rest/v1/rpc/buy_arcade_credit`, // ✅ FIXED
      {
        method: 'POST',
        headers: getSupabaseHeaders(),
        timeoutMs: 3500,
        body: {
          p_device_id: deviceId,
          p_game_id: gameId,
        },
      },
    )

    if (!response.ok) {
      const text = response.text || ''
      console.error('[BUY CREDIT RPC] failed', response.status, text)
      return { ok: false, error: 'rpc_failed' }
    }

    const body = response.json()
    const row = Array.isArray(body) ? body[0] : body

    const ok =
      row?.ok === true || row?.ok === 1 || row?.ok === '1' || row?.ok === 't' || row?.ok === 'true'

    return {
      ok,
      data: row,
    }
  } catch (err) {
    console.error('[BUY CREDIT RPC] exception', err?.message || err)
    return { ok: false, error: err?.message || 'exception' }
  }
}

async function rpcConsumeArcadeCredit({ deviceId }) {
  if (!hasSupabaseRpcConfig()) {
    return { ok: false, error: 'missing_config' }
  }

  try {
    const response = await requestJsonWithCurl(
      `${SUPABASE_URL}/rest/v1/rpc/consume_arcade_credit`,
      {
        method: 'POST',
        headers: getSupabaseHeaders(),
        timeoutMs: 3500,
        body: {
          p_device_id: deviceId,
        },
      },
    )

    if (!response.ok) {
      console.error('[CONSUME CREDIT RPC] failed', response.status, response.text)
      return { ok: false, error: 'rpc_failed' }
    }

    const body = response.json()
    const row = Array.isArray(body) ? body[0] : body

    const ok =
      row?.ok === true || row?.ok === 1 || row?.ok === '1' || row?.ok === 't' || row?.ok === 'true'

    return {
      ok,
      arcadeCredit: Number(row?.arcade_credit ?? 0),
      data: row,
    }
  } catch (err) {
    console.error('[CONSUME CREDIT RPC] exception', err?.message || err)
    return { ok: false, error: err?.message || 'exception' }
  }
}

function requestArcadeLifePurchase(player, target, keyCode, reason = 'start') {
  if (!arcadeSession?.active) return
  if (!player || !target) return

  if (!hasLocalNetworkLink()) {
    setArcadeOverlayNotice('OFFLINE', 1500, 'center')
    return
  }

  if (arcadeCredit <= 0) {
    setArcadeOverlayNotice('NO CREDIT', 1500, 'center')
    return
  }

  const sessionRef = arcadeSession
  if (sessionRef.purchaseInFlight[player]) return

  const now = Date.now()
  const lastAt = Number(sessionRef.lastChargeAt[player] || 0)
  if (now - lastAt < ARCADE_LIFE_DEDUCT_COOLDOWN_MS) return

  const hasStoredCredit = Number(sessionRef.playerLivesPurchased?.[player] || 0) > 0

  if (ARCADE_LIFE_DEDUCT_MODE === 'unlock_once' && hasStoredCredit) {
    pulseVirtualKey(target, keyCode)
    return
  }

  sessionRef.lastChargeAt[player] = now
  sessionRef.purchaseInFlight[player] = true
  // 🛑 safety: auto-reset stuck purchase
  setTimeout(() => {
    if (!arcadeSession || arcadeSession !== sessionRef) return
    if (sessionRef.purchaseInFlight[player]) {
      console.warn('[ARCADE CREDIT] purchase timeout reset', { player })
      sessionRef.purchaseInFlight[player] = false
    }
  }, 4000)
  setArcadeOverlayNotice(`P${player.slice(1)} PROCESSING...`, 0, 'center')

  console.log('[ARCADE CREDIT] consume request', {
    player,
    deviceId: DEVICE_ID,
    currentCredit: arcadeCredit,
    phase: arcadeSession.sessionPhase,
  })

  rpcConsumeArcadeCredit({
    deviceId: DEVICE_ID,
  })
    .then(async res => {
      console.log('[ARCADE CREDIT] consume result', {
        player,
        ok: res?.ok,
        arcadeCredit: res?.arcadeCredit,
        raw: res,
      })
      if (!arcadeSession?.active || arcadeSession !== sessionRef) return
      sessionRef.purchaseInFlight[player] = false

      if (!res || res.ok === false) {
        setArcadeOverlayNotice('NO CREDIT', 1500, 'center')
        return
      }

      // 🔴 ALWAYS resync (source of truth)
      await syncArcadeCredit()
      // 🔒 ensure credit + balance consistency window
      await syncArcadeSessionBalance({ forceBroadcast: true })

      clearArcadeContinueCountdown(player)
      sessionRef.startConfirmUntil[player] = 0
      sessionRef.playerLivesPurchased[player] = 1
      lastGameplayInputAt[player] = Date.now()
      // Optimistically reflect credit locally to avoid prompt fallback
      arcadeCredit = Math.max(0, arcadeCredit - 1)
      sessionRef.successfulChargeAt[player] = Date.now()

      pulseVirtualKey(target, keyCode)

      setArcadeOverlayNotice(`P${player.slice(1)} READY`, 1500, 'center')

      broadcastArcadeLifeState('started', {
        player,
        arcadeCredit,
      })
    })
    .catch(err => {
      if (arcadeSession?.active && arcadeSession === sessionRef) {
        sessionRef.purchaseInFlight[player] = false
      }
      console.error('[ARCADE CREDIT] consume failed', err?.message || err)
      setArcadeOverlayNotice('ERROR', 1500, 'center')
    })
}

let lastBuyAt = 0
const BUY_COOLDOWN_MS = 1500

async function handleBuyPressed() {
  const now = Date.now()

  if (Date.now() - lastBuyAt < BUY_COOLDOWN_MS) {
    console.log('[BUY] cooldown active')
    return
  }

  console.log('[BUY] pressed', {
    state: buyState,
    sinceConfirm: now - buyConfirmAt,
  })

  if (buyState === 'processing') {
    console.log('[BUY] blocked: processing in progress')
    return
  }

  // STEP 1: confirm
  if (buyState === 'idle') {
    buyState = 'confirm'
    buyConfirmAt = now

    console.log('[BUY] confirm required')
    setArcadeOverlayNotice('BUY CREDIT?', BUY_CONFIRM_WINDOW_MS, 'center')
    return
  }

  // STEP 2: expired
  if (buyState === 'confirm' && now - buyConfirmAt > BUY_CONFIRM_WINDOW_MS) {
    console.log('[BUY] confirm expired')
    buyState = 'idle'
    setArcadeOverlayNotice('BUY CREDIT?', BUY_CONFIRM_WINDOW_MS, 'center')
    return
  }

  // STEP 3: execute
  if (buyState === 'confirm') {
    buyState = 'processing'

    const sessionRef = arcadeSession

    console.log('[BUY] processing...')
    setArcadeOverlayNotice('PROCESSING...', 0, 'center')

    try {
      const gameId = sessionRef?.gameId

      if (!gameId) {
        throw new Error('missing_game_id')
      }

      console.log('[BUY CREDIT] sending RPC...', {
        deviceId: DEVICE_ID,
        gameId,
      })

      const res = await withTimeout(
        rpcBuyArcadeCredit({
          deviceId: DEVICE_ID,
          gameId,
        }),
        5000,
      )

      console.log('[BUY CREDIT] response', res)

      if (!res || !res.ok) {
        throw new Error('rpc_failed')
      }

      // 🔒 session changed guard
      if (!arcadeSession || arcadeSession !== sessionRef) {
        console.warn('[BUY CREDIT] session changed mid-flight')
        return
      }

      console.log('[BUY CREDIT] success')
      lastBuyAt = Date.now()

      // 🔁 sync BOTH (critical)
      await syncArcadeCredit()
      await syncArcadeSessionBalance({ forceBroadcast: true })

      setArcadeOverlayNotice('CREDIT ADDED', 1500, 'center')
    } catch (err) {
      console.error('[BUY CREDIT] failed', err?.message || err)

      setArcadeOverlayNotice(
        err?.message === 'missing_game_id' ? 'ERROR' : 'BUY FAILED',
        1500,
        'center',
      )
    } finally {
      buyState = 'idle'
    }
  }
}

// ============================
// DEPOSIT COIN HANDLING
// ============================

function handleDepositPulse() {
  if (arcadeSession?.active) {
    arcadeSession.lastBalanceMutationAt = Date.now()
  }
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
  if (arcadeSession?.active) {
    arcadeSession.lastBalanceMutationAt = Date.now()
  }

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

  setCoinInhibit(true)

  activeWithdrawalContext = {
    requestId: `withdraw-${Date.now()}`,
    requestedAmount: toMoney(amount, 0),
    dispensedTotal: 0,
    startedAt: Date.now(),
  }

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
        activeWithdrawalContext = null
        return
      }
      emitted += 1
      dispatch({
        type: 'WITHDRAW_DISPENSE',
        dispensed: 20,
      })
      void recordWithdrawalDispense(20)
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

  const estimated = (amount / 20) * 1200
  const buffer = 3000 // +3 seconds safety
  const minRuntime = 5000 // minimum 5 seconds

  const runtime = Math.max(estimated + buffer, minRuntime)

  hopperTimeout = setTimeout(
    () => {
      console.error('[HOPPER] TIMEOUT — FORCED STOP')
      stopHopper()
    },
    Math.min(runtime, HOPPER_TIMEOUT_MS, HARD_MAX_MS),
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
  void recordWithdrawalDispense(20)
  if (hopperDispensed >= hopperTarget) {
    stopHopper()
  }
}

function stopHopper() {
  if (!hopperActive) return
  //
  gpioOff(HOPPER_PAY_PIN)
  hopperActive = false

  setCoinInhibit(false)

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

  const wasAborted = hopperDispensed < hopperTarget

  dispatch({
    type: wasAborted ? 'WITHDRAW_ABORTED' : 'WITHDRAW_COMPLETE',
    dispensed: hopperDispensed,
    requested: hopperTarget,
    aborted: wasAborted,
  })
  activeWithdrawalContext = null
}

// ============================
// GPIO HELPERS
// ============================

let hopperCtl = null
let coinCtl = null

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

let lastCoinState = null

function setCoinInhibit(disabled) {
  if (!IS_PI) return

  if (lastCoinState === disabled) return

  if (coinCtl) {
    coinCtl.kill('SIGTERM')
    coinCtl = null
  }

  // CONFIRMED:
  // 0 = reject (relay ON)
  // 1 = accept (relay OFF)
  const value = disabled ? 0 : 1

  coinCtl = spawn('gpioset', [GPIOCHIP, `${COIN_INHIBIT_PIN}=${value}`])

  lastCoinState = disabled

  console.log(`[COIN] ${disabled ? 'REJECT' : 'ACCEPT'}`)
}

let internetOkCount = 0
let internetFailCount = 0
let internetState = 'unknown'
let internetDebounceTimer = null
let internetLastStableState = 'unknown'
let internetBootGraceUntil = Date.now() + 3000 // 3s boot grace

async function checkInternetReachability() {
  try {
    const res = await requestJsonWithCurl('https://clients3.google.com/generate_204', {
      method: 'GET',
      timeoutMs: 2000,
    })

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
            setCoinInhibit(false)
          }, 800)
        }
      }
    } else {
      throw new Error('not ok')
    }
  } catch {
    internetFailCount++
    internetOkCount = 0

    if (internetFailCount >= INTERNET_FAIL_THRESHOLD) {
      if (internetLastStableState !== 'offline') {
        clearTimeout(internetDebounceTimer)
        internetDebounceTimer = setTimeout(() => {
          if (Date.now() < internetBootGraceUntil) return

          internetState = 'offline'
          internetLastStableState = 'offline'
          dispatch({ type: 'INTERNET_LOST' })

          // 🔒 HARD SAFETY: immediately stop hopper on internet loss
          if (hopperActive) {
            console.warn('[HOPPER] FORCE STOP due to internet loss')
            stopHopper()
          }

          setCoinInhibit(true)
        }, 1200)
      }
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
setInterval(checkInternetReachability, 5000)

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

  const helperPath = process.env.UINPUT_HELPER_PATH || '/opt/arcade/bin/uinput-helper'
  const proc = spawn(helperPath, [name], {
    stdio: ['pipe', 'ignore', 'ignore'],
  })

  proc.on('spawn', () => {
    console.log(`[VIRTUAL] ${name} created (pid=${proc.pid})`)
  })

  proc.on('error', err => {
    console.error(`[VIRTUAL] ${name} failed (${helperPath})`, err.message)
  })

  return proc
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

function triggerArcadeShellUpdate(reason = 'manual') {
  if (arcadeShellUpdateChild) {
    return { started: false, alreadyRunning: true, status: getArcadeShellUpdateStatus() }
  }

  if (arcadeShellUpdateTriggered) {
    return { started: false, alreadyTriggered: true, status: getArcadeShellUpdateStatus() }
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
  // Create in strict order to reduce race risk in /dev/input enumeration.
  virtualP1 = startVirtualDevice('Arcade Virtual P1')
  await sleep(VIRTUAL_DEVICE_STAGGER_MS)
  virtualP2 = startVirtualDevice('Arcade Virtual P2')

  console.log('[VIRTUAL] P1 then P2 initialized')
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

function getJsIndexFromSymlink(path) {
  try {
    const target = fs.readlinkSync(path)
    const match = target.match(/(\d+)$/)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

const INPUT_DEVICE_RETRY_MISSING_MS = 250
const INPUT_DEVICE_RETRY_ERROR_MS = 1000
const waitingInputDevices = new Set()

function logInputLinks(reason = 'snapshot') {
  console.log('[INPUT LINK]', {
    reason,
    casino: getJsIndexFromSymlink('/dev/input/casino'),
    player1: getJsIndexFromSymlink('/dev/input/player1'),
    player2: getJsIndexFromSymlink('/dev/input/player2'),
  })
}

logInputLinks('boot')

function getInputLinkState() {
  const casino = getJsIndexFromSymlink('/dev/input/casino')
  const player1 = getJsIndexFromSymlink('/dev/input/player1')
  const player2 = getJsIndexFromSymlink('/dev/input/player2')

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

function startEventDevice(path, label) {
  if (!IS_PI) {
    console.log(`[${label}] compat-mode skipping ${path}`)
    return
  }

  if (!fs.existsSync(path)) {
    if (!waitingInputDevices.has(path)) {
      waitingInputDevices.add(path)
      console.log(`[WAIT] ${label} waiting for ${path}`)
      logInputLinks(`${label.toLowerCase()}-waiting`)
    }
    return setTimeout(() => startEventDevice(path, label), INPUT_DEVICE_RETRY_MISSING_MS)
  }

  if (waitingInputDevices.delete(path)) {
    console.log(`[READY] ${label} detected ${path}`)
    logInputLinks(`${label.toLowerCase()}-ready`)
  }

  console.log(`[${label}] Opening ${path}`)

  fs.open(path, 'r', (err, fd) => {
    if (err) {
      console.error(`[${label}] open error`, err)
      return setTimeout(() => startEventDevice(path, label), INPUT_DEVICE_RETRY_ERROR_MS)
    }

    const buffer = Buffer.alloc(24)

    function readLoop() {
      fs.read(fd, buffer, 0, 24, null, (err, bytesRead) => {
        if (err || bytesRead !== 24) {
          console.error(`[${label}] read error`)
          fs.close(fd, () => {})
          return setTimeout(() => startEventDevice(path, label), INPUT_DEVICE_RETRY_ERROR_MS)
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
  // if (retroarchActive && (source === 'P1' || source === 'P2') && type === EV_KEY) {
  //   console.log('[RETRO RAW KEY]', { source, code, mappedIndex: resolveKeyName(code), value })
  // }
  if (type === EV_KEY) {
    const index = resolveKeyName(code)
    if (index === null) return

    const player = normalizeArcadePlayer(source)
    if (player && value === 1) {
      lastGameplayInputAt[player] = Date.now()
    }

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
  const shouldSwapP2Axes = source === 'P2' && retroarchActive && RETROARCH_P2_SWAP_AXES
  const effectiveCode = shouldSwapP2Axes ? (code === 0 ? 1 : code === 1 ? 0 : code) : code
  const effectiveValue =
    shouldSwapP2Axes && effectiveCode === 0 && Number.isFinite(value) ? 255 - value : value

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

  // if (!RETROARCH_USE_TTY_MODE) {
  //   // Single-X mode: RetroArch reads real devices directly.
  //   return
  // }

  const mappedSource = resolveRetroInputSource(source)
  const target = getRetroVirtualTarget(source)
  if (!target || !retroarchActive) return
  if (value !== 0 && shouldPromoteArcadeSessionToLive(mappedSource, -1)) {
    markArcadeSessionLive('axis_input')
  }

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
  if (effectiveCode === 0) {
    if (effectiveValue < DEAD_LOW) {
      press('left', BTN_DPAD_LEFT)
      release('right', BTN_DPAD_RIGHT)
    } else if (effectiveValue > DEAD_HIGH) {
      press('right', BTN_DPAD_RIGHT)
      release('left', BTN_DPAD_LEFT)
    } else {
      release('left', BTN_DPAD_LEFT)
      release('right', BTN_DPAD_RIGHT)
    }
  }

  // Y axis
  if (effectiveCode === 1) {
    if (effectiveValue < DEAD_LOW) {
      press('up', BTN_DPAD_UP)
      release('down', BTN_DPAD_DOWN)
    } else if (effectiveValue > DEAD_HIGH) {
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

  const player = normalizeArcadePlayer(source)

  // --- HARD INPUT GATE ---
  if (arcadeSession?.active && player) {
    const hasLife = playerHasStoredCredit(player)

    // No life → ONLY allow START
    if (!hasLife && !isStartButton(index)) {
      return
    }

    // During GAME OVER → block everything
    if (gameOverState[player]) {
      return
    }
  }

  if (source === 'CASINO') {
    const casinoAction = JOYSTICK_BUTTON_MAP[index]

    // ============================
    // UNIFIED HEURISTIC STATE MACHINE
    // ============================

    if (value === 1 && arcadeSession?.active && retroarchActive) {
      const now = Date.now()

      const isStart = isStartButton(index)
      const isPurchase = isLifePurchaseButton(index)
      const isGameplay = !isStart && !isPurchase

      const prevAny =
        typeof lastGameInputAt === 'number' && lastGameInputAt > 0 ? lastGameInputAt : 0
      const idleMs = prevAny > 0 ? now - prevAny : 0

      console.log('[HEURISTIC]', {
        phase: arcadeSession?.sessionPhase,
        idleMs,
        lastGameInputAt,
        lastLifeLossAt,
      })

      lastGameInputAt = now

      // ---- STATE: LIVE -> PRESTART (game ended) ----
      if (
        prevAny > 0 &&
        idleMs > LIFE_LOSS_IDLE_THRESHOLD_MS &&
        arcadeSession.sessionPhase === 'live'
      ) {
        console.log('[HEURISTIC] SESSION END DETECTED', {
          idleMs,
          phase: arcadeSession.sessionPhase,
        })

        lastLifeLossAt = now
        arcadeSession.sessionPhase = 'prestart'

        // start continue countdowns safely
        if (!arcadeContinueCountdownTimers['P1'] && !playerHasStoredCredit('P1')) {
          startArcadeContinueCountdown('P1')
        }
        if (!arcadeContinueCountdownTimers['P2'] && !playerHasStoredCredit('P2')) {
          startArcadeContinueCountdown('P2')
        }

        broadcastArcadeLifeState('session_end_detected', {
          reason: 'idle_timeout',
          idleMs,
        })

        refreshArcadeOsdMessage()
      }

      // ---- CONTINUE DETECTION ----
      if (isStart && arcadeSession.sessionPhase === 'prestart' && lastLifeLossAt > 0) {
        const sinceLifeLoss = now - lastLifeLossAt

        if (sinceLifeLoss < LIFE_LOSS_GRACE_MS) {
          console.log('[HEURISTIC] CONTINUE DETECTED', { sinceLifeLoss })

          clearArcadeContinueCountdown('P1')
          clearArcadeContinueCountdown('P2')

          broadcastArcadeLifeState('continue_detected', {
            sinceLifeLoss,
          })
        }
      }

      // ---- STATE: PRESTART -> LIVE ----
      if (isStart && arcadeSession.sessionPhase === 'prestart') {
        console.log('[HEURISTIC] SESSION START DETECTED', {
          from: 'prestart',
        })

        arcadeSession.sessionPhase = 'live'

        broadcastArcadeLifeState('session_start_detected', {
          reason: 'start_pressed',
        })
      }

      if (isGameplay) {
        const player = normalizeArcadePlayer(source)
        if (player) {
          lastGameplayInputAt[player] = now
        }
      }
    }

    // (LIFE LOSS block removed as unified state machine now handles this logic)

    if (value === 1 && casinoAction === 'GAME_OVER') {
      if (arcadeSession?.active && arcadeSession.sessionPhase === 'live') {
        console.log('[ARCADE] GAME OVER')

        const now = Date.now()
        lastLifeLossAt = now
        arcadeSession.sessionPhase = 'prestart'

        if (!playerHasStoredCredit('P1')) {
          startArcadeContinueCountdown('P1')
        }

        if (!playerHasStoredCredit('P2')) {
          startArcadeContinueCountdown('P2')
        }

        broadcastArcadeLifeState('game_over', {
          sessionPhase: arcadeSession.sessionPhase,
        })
      }
      return
    }

    if (retroarchActive && isBlockedCasinoActionDuringRetroarch(casinoAction)) {
      console.log(`[CASINO] blocked during RetroArch: ${casinoAction}`)
      return
    }

    // 🔴 GLOBAL BUY HANDLER (always intercept before dispatch)
    if (value === 1 && JOYSTICK_BUTTON_MAP[index] === 'BUY') {
      if (buyState === 'processing') return

      handleBuyPressed()
      return
    }

    if (retroarchActive && RETROARCH_PRIMARY_INPUT === 'CASINO') {
      if (value === 1 && JOYSTICK_BUTTON_MAP[index] === 'MENU' && CASINO_MENU_EXITS_RETROARCH) {
        handleRetroarchMenuExitIntent()
        return
      }

      routePlayerInput('P1', index, value)
      return
    }

    if (retroarchActive && arcadeSession?.active) {
      const primaryPlayer = normalizeArcadePlayer(RETROARCH_PRIMARY_INPUT) || 'P1'
      const primaryLocked = !playerHasStoredCredit(primaryPlayer)
      const casinoAction = JOYSTICK_BUTTON_MAP[index]

      if (primaryLocked) {
        if (casinoAction === 'MENU' && CASINO_MENU_EXITS_RETROARCH) {
          if (value === 1) handleRetroarchMenuExitIntent()
          return
        }
      }
    }

    if (!retroarchActive && value === 1) {
      if (index === 7) {
        dispatch({ type: 'PLAYER', player: 'CASINO', button: 7 })
        return
      }
    }

    if (value !== 1) return // only act on press for casino

    if (retroarchActive && casinoAction === 'MENU' && CASINO_MENU_EXITS_RETROARCH) {
      handleRetroarchMenuExitIntent()
      return
    }

    switch (casinoAction) {
      case 'COIN':
        handleDepositPulse()
        break
      case 'HOPPER_COIN':
        void recordHopperTopup(HOPPER_TOPUP_COIN_VALUE)
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
    // if (!RETROARCH_USE_TTY_MODE) {
    //   // Single-X mode: RetroArch reads real devices directly.
    //   return
    // }

    const target = getRetroVirtualTarget(source)
    if (!target) return

    const player = normalizeArcadePlayer(source)
    if (!player) return
    const playerAction = JOYSTICK_BUTTON_MAP[index]

    const hasStoredCredit = playerHasStoredCredit(player)
    const needsCredit = !hasStoredCredit

    if (arcadeSession?.active) {
      const player = normalizeArcadePlayer(source)
      if (!player) return
      const hasStoredCredit = playerHasStoredCredit(player)
      const needsCredit = !hasStoredCredit

      if (isStartButton(index)) {
        if (value === 1) {
          clearRetroarchExitConfirm()
        }

        if (value === 1 && arcadeContinueCountdownTimers[player]) {
          console.log('[ARCADE] CONTINUE', { player })

          clearArcadeContinueCountdown(player)

          broadcastArcadeLifeState('continue', {
            player,
          })

          // do NOT return → allow normal start/purchase flow
        }

        if (!canAcceptRetroarchStartInput()) {
          if (value === 1) {
            console.log('[RETROARCH] START ignored by launch guard', {
              elapsedMs: retroarchStartedAt ? Date.now() - retroarchStartedAt : null,
              guardMs: RETROARCH_START_INPUT_GUARD_MS,
              player,
            })
          }
          return
        }

        if (needsCredit) {
          if (value === 1) {
            if (!isArcadePurchaseAllowed(player)) {
              setArcadeOverlayNotice(
                getBlockedPurchaseMessage(player),
                1800,
                player === 'P1' ? 'left' : 'right',
              )
              showArcadeOsdMessage(composeArcadeOsdOverlay(getBlockedPurchaseMessage(player)), {
                bypassCooldown: true,
                urgent: true,
              })
              broadcastArcadeLifeState('purchase_blocked', {
                player,
                joinMode: normalizeArcadeJoinMode(arcadeSession.joinMode),
                sessionPhase: arcadeSession.sessionPhase || 'prestart',
              })
              return
            }

            const now = Date.now()
            const confirmUntil = Number(arcadeSession.startConfirmUntil?.[player] || 0)

            if (confirmUntil > now) {
              arcadeSession.startConfirmUntil[player] = 0
              requestArcadeLifePurchase(player, target, keyCode, 'start_button')
            } else {
              arcadeSession.startConfirmUntil[player] = now + ARCADE_LIFE_START_CONFIRM_WINDOW_MS
              setArcadeOverlayNotice(
                'START GAME?',
                ARCADE_LIFE_START_CONFIRM_WINDOW_MS,
                player === 'P1' ? 'left' : 'right',
              )
              showArcadeOsdMessage(composeArcadeOsdOverlay('START GAME?'), {
                bypassCooldown: true,
                urgent: true,
              })
              broadcastArcadeLifeState('start_confirm_required', {
                player,
                confirmWindowMs: ARCADE_LIFE_START_CONFIRM_WINDOW_MS,
                balance: arcadeSession.lastKnownBalance,
              })
            }
          }
          return
        }

        arcadeSession.startConfirmUntil[player] = 0
        if (arcadeOverlayNotice?.slot === (player === 'P1' ? 'left' : 'right')) {
          clearArcadeOverlayNotice()
        }
        sendVirtual(target, EV_KEY, keyCode, value)
        return
      }
    }

    if (
      value === 1 &&
      playerAction === 'MENU' &&
      !isStartButton(index) &&
      CASINO_MENU_EXITS_RETROARCH
    ) {
      handleRetroarchMenuExitIntent()
      return
    }

    if (value === 1 && shouldPromoteArcadeSessionToLive(player, index)) {
      markArcadeSessionLive('player_input')
    }

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
  if (SINGLE_X_MODE) return true
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
  if (SINGLE_X_MODE) return
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

function scheduleForceSwitchToUI(reason, delayMs = 300) {
  if (SINGLE_X_MODE) return
  if (!RETROARCH_USE_TTY_MODE || !IS_PI) return

  if (pendingUiFallbackTimer !== null) {
    clearTimeout(pendingUiFallbackTimer)
    pendingUiFallbackTimer = null
  }

  const targetUiVT = getTargetUiVT()
  const waitMs = Math.max(0, Math.round(delayMs))

  pendingUiFallbackTimer = setTimeout(() => {
    pendingUiFallbackTimer = null
    switchToVTWithRetry(targetUiVT, `${reason}-timer`)
    setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-timer-post`), 120)
  }, waitMs)

  console.log(`[VT] scheduled fallback to ${targetUiVT} (${reason})`)
}

function scheduleArcadeCreditExpiry(player) {
  if (!arcadeSession?.active) return
  if (player !== 'P1' && player !== 'P2') return

  clearArcadeCreditExpiry(player)

  if (ARCADE_LIFE_CREDIT_TTL_MS <= 0) return

  arcadeCreditExpiryTimers[player] = setTimeout(() => {
    if (!arcadeSession?.active) return

    arcadeSession.playerLivesPurchased[player] = 0
    arcadeSession.startConfirmUntil[player] = 0
    arcadeCreditExpiryTimers[player] = null

    if (
      arcadeOverlayNotice?.slot === (player === 'P1' ? 'left' : 'right') ||
      arcadeOverlayNotice?.text === 'START GAME?'
    ) {
      clearArcadeOverlayNotice()
    }

    showArcadeOsdMessage(composeArcadeOsdOverlay(`P${player.slice(1)} CREDIT CONSUMED`), {
      bypassCooldown: true,
    })

    setTimeout(() => {
      if (!arcadeSession?.active) return
      if (playerHasStoredCredit(player)) return

      showArcadeOsdMessage(composeArcadeOsdOverlay(''), {
        bypassCooldown: true,
      })
    }, 700)

    broadcastArcadeLifeState('credit_consumed', {
      player,
      ttlMs: ARCADE_LIFE_CREDIT_TTL_MS,
    })
  }, ARCADE_LIFE_CREDIT_TTL_MS)
}

function clearScheduledForceSwitchToUI() {
  if (pendingUiFallbackTimer === null) return
  clearTimeout(pendingUiFallbackTimer)
  pendingUiFallbackTimer = null
}

function clearRetroarchStopTimers() {
  if (retroarchStopTermTimer !== null) {
    clearTimeout(retroarchStopTermTimer)
    retroarchStopTermTimer = null
  }
  if (retroarchStopForceTimer !== null) {
    clearTimeout(retroarchStopForceTimer)
    retroarchStopForceTimer = null
  }
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
  if (!promptMessage) return
  const changed = promptMessage !== lastArcadePromptLoopMessage
  showArcadeOsdMessage(promptMessage, { bypassCooldown: changed })
  lastArcadePromptLoopMessage = promptMessage
  lastArcadePromptLoopSentAt = Date.now()
}

function maybeRestartUiAfterExit(reason) {
  const abnormalExit =
    typeof reason === 'string' &&
    (reason.includes('crash') || reason.includes('segfault') || reason.includes('abnormal'))

  if (RETROARCH_TTY_X_SESSION) {
    restartArcadeUiAfterRetroarch(reason, abnormalExit)
    return
  }
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
  if (!retroarchActive && !retroarchProcess) return

  const wasActive = retroarchActive
  const targetUiVT = getTargetUiVT()
  const abnormalExit =
    typeof reason === 'string' &&
    (reason.includes('crash') || reason.includes('segfault') || reason.includes('abnormal'))
  clearRetroarchStopTimers()
  clearRetroarchExitConfirm()
  retroarchActive = false
  retroarchStopping = false
  retroarchProcess = null
  lastExitTime = Date.now()
  lastExitedGameId = arcadeSession?.gameId || retroarchCurrentGameId || lastExitedGameId
  retroarchCurrentGameId = null
  retroarchStartedAt = 0
  if (retroarchLogFd !== null) {
    try {
      fs.closeSync(retroarchLogFd)
    } catch {}
    retroarchLogFd = null
  }

  if (SINGLE_X_MODE) {
    restoreChromiumUiAfterRetroarch()
  } else {
    switchToVTWithRetry(targetUiVT, reason)
    setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-post`), 120)
    scheduleForceSwitchToUI(`${reason}-detached`)
    if (abnormalExit) {
      setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-crash-retry`, 8, 250), 300)
      setTimeout(() => maybeRestartUiAfterExit(`${reason}-crash-ui-restart`), 400)
    }
  }

  if (wasActive) {
    clearArcadeLifeSession(reason)
    dispatch({ type: 'GAME_EXITED' })
    setTimeout(() => maybeRestartUiAfterExit(reason), 50)
  }
}

function requestRetroarchStop(reason) {
  clearRetroarchExitConfirm()
  if (!retroarchActive) return
  dispatch({ type: 'GAME_EXITING', reason })
  const targetUiVT = getTargetUiVT()

  if (!retroarchProcess) {
    console.warn('[RETROARCH] stop requested with no process')
    finalizeRetroarchExit(`${reason}-missing-process`)
    return
  }

  if (retroarchStopping) return
  retroarchStopping = true
  clearRetroarchStopTimers()
  const stopTargetPid = retroarchProcess.pid

  sendRetroarchSignal('SIGINT', `${reason}-graceful`)

  if (SINGLE_X_MODE) {
    console.log('[DISPLAY] waiting for RetroArch exit on DISPLAY=:0')
  } else {
    console.log(`[VT] waiting for RetroArch exit before returning to ${targetUiVT}`)
  }

  retroarchStopTermTimer = setTimeout(() => {
    retroarchStopTermTimer = null
    if (!retroarchActive) return
    if (!retroarchProcess || retroarchProcess.pid !== stopTargetPid) return
    sendRetroarchSignal('SIGTERM', `${reason}-term-fallback`)
  }, RETROARCH_TERM_FALLBACK_MS)

  retroarchStopForceTimer = setTimeout(() => {
    retroarchStopForceTimer = null
    if (!retroarchActive) return
    if (!retroarchProcess || retroarchProcess.pid !== stopTargetPid) return

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

    gpioOff(COIN_INHIBIT_PIN)

    if (coinCtl) {
      coinCtl.kill('SIGTERM')
      coinCtl = null
    }

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
        const configuredMax = state ? getMaxWithdrawalAmountForHopperBalance(hopperBalance) : null
        const maxWithdrawalAmount =
          configuredMax === null
            ? null
            : Math.max(0, Math.min(balance, hopperBalance, configuredMax))

        return sendJson(res, 200, {
          success: true,
          balance,
          hopperBalance,
          maxWithdrawalAmount,
          configuredMax,
          enabled: Boolean(IS_PI && hasSupabaseRpcConfig()),
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
    req.on('end', () => {
      let reason = 'manual'
      try {
        const payload = body ? JSON.parse(body) : {}
        if (typeof payload.reason === 'string' && payload.reason.trim()) {
          reason = payload.reason.trim()
        }
      } catch {
        // Ignore invalid body for this endpoint.
      }

      const result = triggerArcadeShellUpdate(reason)
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

        console.log('[ARCADE LIFE BALANCE] push', {
          nextBalance,
          active: Boolean(arcadeSession?.active),
        })

        if (arcadeSession?.active) {
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

      if (payload.type === 'LAUNCH_GAME') {
        if (typeof payload.core !== 'string' || typeof payload.rom !== 'string') {
          res.writeHead(400)
          return res.end('Missing core or rom')
        }

        const payloadGameId = String(payload.id || '').trim()
        const payloadGameName = String(payload.name || '').trim()
        const payloadPrice = toMoney(payload.price, ARCADE_LIFE_PRICE_DEFAULT)
        const payloadBalance = toMoney(payload.balance, 0)
        const payloadJoinMode = normalizeArcadeJoinMode(payload.joinMode)

        const duplicateLaunchDuringRecovery =
          Boolean(payloadGameId) &&
          Boolean(lastExitedGameId) &&
          payloadGameId === lastExitedGameId &&
          Date.now() - lastExitTime < RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS

        let gameProfile = {
          gameId: payloadGameId || path.basename(payload.rom || '') || 'unknown',
          gameName: payloadGameName || payloadGameId || 'Arcade Game',
          pricePerLife: payloadPrice > 0 ? payloadPrice : ARCADE_LIFE_PRICE_DEFAULT,
          joinMode: payloadJoinMode,
          initialBalance: payloadBalance,
        }

        if (retroarchStopping) {
          console.warn('[LAUNCH] Ignored — RetroArch stopping')
          res.writeHead(409)
          return res.end('Stopping')
        }

        if (retroarchActive) {
          console.warn('[LAUNCH] Ignored — RetroArch already active')
          res.writeHead(409)
          return res.end('Already running')
        }

        if (payloadPrice > 0 && payloadBalance < payloadPrice) {
          console.warn('[LAUNCH] Ignored — insufficient balance', {
            gameId: payloadGameId,
            balance: payloadBalance,
            price: payloadPrice,
          })
          res.writeHead(402)
          return res.end('Insufficient balance')
        }

        if (Date.now() - lastExitTime < RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS) {
          if (duplicateLaunchDuringRecovery) {
            console.log('[LAUNCH] Ignored — duplicate launch during exit recovery', {
              gameId: payloadGameId,
              cooldownMs: RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS,
            })
            res.writeHead(409)
            return res.end('Duplicate launch during recovery')
          }

          console.log('[LAUNCH] Ignored — cooldown', {
            cooldownMs: RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS,
          })
          res.writeHead(409)
          return res.end('Cooling down')
        }

        const needsGameProfileFetch =
          payloadGameId &&
          (!payloadGameName ||
            payloadPrice <= 0 ||
            !payload.joinMode ||
            normalizeArcadeJoinMode(payload.joinMode) !== payloadJoinMode)

        if (needsGameProfileFetch) {
          const fetchedGameProfile = await fetchGameProfileForArcadeLife(payloadGameId)
          if (fetchedGameProfile) {
            gameProfile = {
              ...gameProfile,
              ...fetchedGameProfile,
              initialBalance: payloadBalance,
            }
          }
        }

        if (!IS_PI) {
          console.log('[LAUNCH] compat-mode simulated arcade launch')
          retroarchActive = true
          retroarchStopping = false
          clearRetroarchExitConfirm()
          retroarchStartedAt = Date.now()
          startArcadeLifeSession(gameProfile)
          setTimeout(() => {
            finalizeRetroarchExit('compat-simulated')
          }, 250)
          res.writeHead(200)
          return res.end('OK')
        }

        console.log('[LAUNCH] emulator')

        retroarchActive = true
        retroarchStopping = false
        retroarchCurrentGameId = gameProfile.gameId
        clearRetroarchExitConfirm()
        retroarchStartedAt = Date.now()

        const romPath = resolveRomPath(payload.rom)
        if (!romPath) {
          retroarchActive = false
          retroarchStopping = false
          retroarchCurrentGameId = null
          retroarchStartedAt = 0
          clearArcadeLifeSession('launch-rom-missing')
          console.error('[LAUNCH] ROM not found', { rom: payload.rom })
          res.writeHead(400)
          return res.end(`ROM not found: ${payload.rom}`)
        }

        const core = resolveCorePath(payload.core)
        if (!core.path) {
          retroarchActive = false
          retroarchStopping = false
          retroarchCurrentGameId = null
          retroarchStartedAt = 0
          clearArcadeLifeSession('launch-core-missing')
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
          gameId: gameProfile.gameId,
          pricePerLife: gameProfile.pricePerLife,
        })

        startArcadeLifeSession(gameProfile)
        retroarchLogFd = fs.openSync(RETROARCH_LOG_PATH, 'a')
        clearScheduledForceSwitchToUI()
        dispatch({
          type: 'GAME_LAUNCHING',
          gameId: gameProfile.gameId,
          gameName: gameProfile.gameName,
        })

        if (SINGLE_X_MODE) {
          hideChromiumUiForRetroarch()
          console.log('[DISPLAY] launching RetroArch into DISPLAY=:0')
        } else {
          const activeVT = getActiveVT()
          if (activeVT) {
            lastUiVT = activeVT
            console.log(`[VT] captured UI VT ${lastUiVT} before launch`)
          }
          if (RETROARCH_TTY_X_SESSION) {
            stopArcadeUiForRetroarch()
            if (USE_SPLASH_TRANSITIONS) {
              startSplashForRetroarch()
              switchToVT(SPLASH_VT, 'launch-splash')
            }
          } else {
            switchToVT(GAME_VT, 'launch')
          }
        }

        const command = ['-u', RETROARCH_RUN_USER, 'env']

        if (SINGLE_X_MODE) {
          command.push('DISPLAY=:0', `XAUTHORITY=${RETROARCH_RUN_HOME}/.Xauthority`)
        } else if (!RETROARCH_TTY_X_SESSION) {
          command.push('-u', 'DISPLAY', '-u', 'XAUTHORITY', '-u', 'WAYLAND_DISPLAY')
        }

        command.push(
          `HOME=${RETROARCH_RUN_HOME}`,
          `USER=${RETROARCH_RUN_USER}`,
          `LOGNAME=${RETROARCH_RUN_USER}`,
          `XDG_RUNTIME_DIR=${RETROARCH_RUNTIME_DIR}`,
          `DBUS_SESSION_BUS_ADDRESS=${RETROARCH_DBUS_ADDRESS}`,
          `PULSE_SERVER=${RETROARCH_PULSE_SERVER}`,
        )

        let launchCommand = 'sudo'
        let launchArgs

        if (RETROARCH_TTY_X_SESSION) {
          const launcherScript =
            process.env.RETROARCH_TTY_X_LAUNCHER_SCRIPT ||
            path.join(ARCADE_RUNTIME_DIR, 'os', 'bin', 'arcade-retro-launch.sh')
          const sessionScript =
            process.env.RETROARCH_TTY_X_SESSION_SCRIPT ||
            path.join(ARCADE_RUNTIME_DIR, 'os', 'bin', 'arcade-retro-session.sh')

          launchCommand = 'env'
          launchArgs = [
            `ARCADE_RETRO_DISPLAY=:1`,
            `ARCADE_RETRO_VT=vt${GAME_VT}`,
            `ARCADE_RETRO_SESSION_SCRIPT=${sessionScript}`,
            `ARCADE_RETRO_RUN_USER=${RETROARCH_RUN_USER}`,
            `ARCADE_RETRO_RUN_HOME=${RETROARCH_RUN_HOME}`,
            `ARCADE_RETRO_XDG_RUNTIME_DIR=${RETROARCH_RUNTIME_DIR}`,
            `ARCADE_RETRO_DBUS_ADDRESS=${RETROARCH_DBUS_ADDRESS}`,
            `ARCADE_RETRO_PULSE_SERVER=${RETROARCH_PULSE_SERVER}`,
            `ARCADE_RETRO_BIN=${RETROARCH_BIN}`,
            `ARCADE_RETRO_SWITCH_TO_VT=${GAME_VT}`,
            `ARCADE_RETRO_PREWARMED_X=${RETROARCH_TTY_X_PREWARM ? '1' : '0'}`,
            `ARCADE_RETRO_CORE_PATH=${core.path}`,
            `ARCADE_RETRO_ROM_PATH=${romPath}`,
            `ARCADE_RETRO_OVERLAY_URL=http://127.0.0.1:${PORT}/retro-overlay.html`,
            ...(RETROARCH_CONFIG_PATH ? [`ARCADE_RETRO_CONFIG_PATH=${RETROARCH_CONFIG_PATH}`] : []),
            launcherScript,
          ]
          console.log('[LAUNCH] tty-x-session argv', launchArgs)
        } else {
          if (RETROARCH_USE_DBUS_RUN_SESSION) command.push('dbus-run-session', '--')
          command.push(RETROARCH_BIN, '--fullscreen', '--verbose')

          if (RETROARCH_CONFIG_PATH) {
            command.push('--config', RETROARCH_CONFIG_PATH)
          }

          command.push('-L', core.path, romPath)
          launchArgs = command
          console.log('[LAUNCH] sudo argv', launchArgs)
        }

        retroarchProcess = spawn(launchCommand, launchArgs, {
          stdio: ['pipe', retroarchLogFd, retroarchLogFd],
          detached: true,
        })

        retroarchProcess.unref()

        retroarchProcess.on('error', err => {
          console.error('[PROCESS] RetroArch spawn error', err.message)
          retroarchCurrentGameId = null
          clearArcadeLifeSession('spawn-error')
          finalizeRetroarchExit('spawn-error')
        })

        retroarchProcess.on('exit', (code, signal) => {
          console.log(`[PROCESS] RetroArch exited code=${code} signal=${signal}`)
          const abnormal =
            code !== 0 &&
            code !== 130 &&
            code !== 143 &&
            signal !== 'SIGINT' &&
            signal !== 'SIGTERM'
          finalizeRetroarchExit(abnormal ? `abnormal-exit-code-${code ?? 'null'}` : 'normal-exit')
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
