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

import fs from 'fs'

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DIST_DIR = path.join(__dirname, '../ui/dist')
// ============================
// CONFIG
// ============================

const GPIOCHIP = 'gpiochip0'
const HOPPER_PAY_PIN = 17

const HOPPER_TIMEOUT_MS = 60000

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

let serverInstance = null

let virtualP1 = null
let virtualP2 = null

let retroarchActive = false
// ============================
// BOOT
// ============================

console.log(`
ARCADE INPUT SERVICE
--------------------
USB Encoder : /dev/input/casino
GPIO Chip   : ${GPIOCHIP}

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

  hopperActive = true
  hopperTarget = amount
  hopperDispensed = 0

  console.log('[HOPPER] START target=', amount)

  gpioOn(HOPPER_PAY_PIN)

  hopperTimeout = setTimeout(
    () => {
      console.error('[HOPPER] TIMEOUT — FORCED STOP')
      stopHopper()
    },
    Math.min((amount / 20) * 1200, HARD_MAX_MS),
  )
}

function handleWithdrawPulse() {
  if (!hopperActive) return

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
  if (hopperCtl) {
    hopperCtl.kill('SIGTERM')
    hopperCtl = null
  }

  hopperCtl = spawn('gpioset', [GPIOCHIP, `${pin}=0`])
}

function gpioOff(pin) {
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

function startVirtualDevices() {
  virtualP1 = spawn('uinput-helper', ['Arcade Virtual P1'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  })

  virtualP2 = spawn('uinput-helper', ['Arcade Virtual P2'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  })

  console.log('[VIRTUAL] P1 + P2 created')
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

function sendVirtual(proc, type, code, value) {
  if (!proc || !proc.stdin.writable) return

  proc.stdin.write(`${type} ${code} ${value}\n`)
  proc.stdin.write(`${EV_SYN} ${SYN_REPORT} 0\n`)
}

function getJsIndexFromSymlink(path) {
  const target = fs.readlinkSync(path) // returns "js2"
  return parseInt(target.replace('js', ''), 10)
}

const casinoIndex = getJsIndexFromSymlink('/dev/input/casino')
const p1Index = getJsIndexFromSymlink('/dev/input/player1')
const p2Index = getJsIndexFromSymlink('/dev/input/player2')

function startEventDevice(path, label) {
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

  const target = source === 'P1' ? virtualP1 : virtualP2
  if (!target || !retroarchActive) return

  const state = dpadState[source]

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
    if (value !== 1) return // only act on press for casino
    const casinoAction = JOYSTICK_BUTTON_MAP[index]

    if (casinoAction === 'MENU') {
      if (retroarchActive && retroarchProcess) {
        retroarchProcess.kill('SIGTERM')

        setTimeout(() => {
          if (retroarchProcess) {
            console.warn('[FORCE KILL] RetroArch still alive')
            retroarchProcess.kill('SIGKILL')
          }
        }, 3000)
      } else {
        dispatch({ type: 'ACTION', action: 'MENU' })
      }
      return
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
    const target = source === 'P1' ? virtualP1 : virtualP2
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

    if (retroarchProcess) {
      retroarchProcess.kill('SIGTERM')
      retroarchProcess = null
    }

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
startVirtualDevices()

startEventDevice('/dev/input/casino', 'CASINO')
startEventDevice('/dev/input/player1', 'P1')
startEventDevice('/dev/input/player2', 'P2')

const PORT = 5174

let retroarchProcess = null
let lastExitTime = 0

function readHardwareSerial() {
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

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/device-id') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ deviceId: DEVICE_ID }))
    return
  }
  if (req.method === 'GET' && req.url === '/wifi-scan') {
    exec(
      'sudo nmcli device wifi rescan; sudo nmcli -t -f SSID,SIGNAL device wifi list',
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
            const [ssid, signal] = line.split(':')
            return { ssid, signal: Number(signal) }
          })
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
        if (!payload.core || !payload.rom) {
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

        console.log('[LAUNCH] emulator')

        retroarchActive = true

        const ROM_PATH = path.resolve(__dirname, payload.rom)

        spawnSync('chvt', ['1'])

        retroarchProcess = spawn(
          'sudo',
          [
            '-u',
            'arcade1',
            'retroarch',
            '--fullscreen',
            '--verbose',
            '-L',
            `/usr/lib/aarch64-linux-gnu/libretro/${payload.core}_libretro.so`,
            ROM_PATH,
          ],
          {
            stdio: 'ignore',
            detached: false,
          },
        )

        retroarchProcess.on('exit', () => {
          console.log('[PROCESS] RetroArch exited')
          lastExitTime = Date.now()
          spawnSync('sleep', ['0.4'])

          // Force VT reset
          spawnSync('chvt', ['2'])

          spawnSync('sleep', ['0.2'])

          retroarchActive = false
          retroarchProcess = null

          dispatch({ type: 'GAME_EXITED' })
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

function checkInternetOnce() {
  return new Promise(resolve => {
    exec('curl -s --max-time 3 https://clients3.google.com/generate_204', err => {
      resolve(!err)
    })
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
    return
  }

  if (online !== lastInternetState) {
    lastInternetState = online

    if (!online) {
      console.warn('[NETWORK] Internet LOST')
      broadcast({ type: 'INTERNET_LOST' })
    } else {
      console.log('[NETWORK] Internet RESTORED')
      broadcast({ type: 'INTERNET_RESTORED' })
    }
  }
}

let wifiReading = false

function readWifiSignal() {
  if (wifiReading) return
  wifiReading = true

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
      broadcastWifi({ type: 'WIFI_STATUS', connected: false, signal: null })
      return
    }

    exec('nmcli -t -f IN-USE,SIGNAL dev wifi list', (err2, stdout2) => {
      wifiReading = false

      if (err2 || !stdout2) return

      const activeLine = stdout2
        .trim()
        .split('\n')
        .find(line => line.startsWith('*:'))

      if (!activeLine) {
        broadcastWifi({ type: 'WIFI_STATUS', connected: true, signal: null })
        return
      }

      const signal = Number(activeLine.split(':')[1] ?? 0)

      broadcastWifi({
        type: 'WIFI_STATUS',
        connected: true,
        signal,
      })
    })
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

setInterval(monitorInternet, 3000)
