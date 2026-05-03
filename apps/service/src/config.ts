import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ServiceConfig } from './types.js'

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.trunc(parsed)
}

export function loadServiceConfig(): ServiceConfig {
  const serviceDir = process.env.ARCADE_SERVICE_DIR || process.cwd()
  const runtimeDir = process.env.ARCADE_RUNTIME_DIR || path.resolve(serviceDir, '..')
  const romsRoot = process.env.ARCADE_ROMS_DIR || path.join(runtimeDir, 'roms')
  const uiDistDir = process.env.ARCADE_UI_DIST_DIR || path.join(runtimeDir, 'ui/dist')
  const defaultRuntimeDir =
    process.platform === 'linux' ? '/dev/shm/arcade-games' : path.join(os.tmpdir(), 'arcade-games')
  const runtimeGamesDir = process.env.ARCADE_RUNTIME_GAMES_DIR || defaultRuntimeDir
  const retroarchReadyFile = process.env.ARCADE_RETRO_READY_FILE || '/tmp/arcade-retro-session.ready'

  const isLinux = process.platform === 'linux'
  const isMacOs = process.platform === 'darwin'
  const forcePiMode = process.env.ARCADE_FORCE_PI === '1'
  const piModelPath = '/sys/firmware/devicetree/base/model'
  const isPi =
    forcePiMode ||
    (isLinux &&
      fs.existsSync(piModelPath) &&
      (() => {
        try {
          return fs.readFileSync(piModelPath, 'utf8').includes('Raspberry Pi')
        } catch {
          return false
        }
      })())

  const host = process.env.ARCADE_SERVICE_HOST || '127.0.0.1'
  const port = readPort(process.env.ARCADE_SERVICE_PORT, 3001)
  const supabaseUrl = String(process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
  const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const arcadeLifePriceDefault = (() => {
    const parsed = Number(process.env.ARCADE_LIFE_PRICE_DEFAULT || 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
  })()

  return {
    host,
    port,
    localApiOrigin: `http://${host}:${port}`,
    serviceDir,
    runtimeDir,
    romsRoot,
    uiDistDir,
    runtimeGamesDir,
    retroarchReadyFile,
    supabaseUrl,
    supabaseServiceKey,
    arcadeLifePriceDefault,
    isLinux,
    isMacOs,
    forcePiMode,
    isPi,
    devInputBypassEnabled: !isPi && isMacOs,
  }
}

export const hopperConfig = {
  gpioChip: 'gpiochip0',
  payPin: 17,
  coinInhibitPin: 22,
  timeoutMs: 60_000,
  noPulseTimeoutMs: 5_000,
  topupCoinValue: 20,
}

export const coinConfig = {
  idleGapMs: 130,
  pesoByPulseCount: {
    1: 5,
    2: 10,
    4: 20,
  },
}

export const internetConfig = {
  probeTimeoutSec: 2,
  monitorIntervalMs: 2_000,
  failThreshold: 2,
  restoreThreshold: 2,
}

export const buyFlowConfig = {
  confirmWindowMs: 5_000,
  arcadeTimePurchaseMs: 10 * 60 * 1_000,
}

export const joystickButtonMap = {
  0: 'SPIN',
  1: 'BET_DOWN',
  2: 'BET_UP',
  3: 'AUTO',
  4: 'COIN',
  5: 'WITHDRAW',
  6: 'WITHDRAW_COIN',
  7: 'TURBO',
  8: 'BUY',
  9: 'MENU',
  10: 'AUDIO',
  11: 'HOPPER_COIN',
} as const

export const rawButtonMap = {
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
} as const
