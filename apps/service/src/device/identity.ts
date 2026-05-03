import fs from 'node:fs'
import os from 'node:os'

import type { RuntimeMode } from '../types.js'

export interface DeviceIdentity {
  deviceId: string | null
  runtimeMode: RuntimeMode
  isPi: boolean
  compatMode: boolean
  devInputBypassEnabled: boolean
  platform: NodeJS.Platform
}

function readHardwareSerial(isPi: boolean): string | null {
  if (!isPi) {
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
      .replace(/[^a-fA-F0-9]/g, '')
      .trim()
  } catch (error) {
    console.error('[DEVICE] Failed to read hardware serial', error)
    return null
  }
}

export function loadDeviceIdentity(options?: {
  isPi?: boolean
  devInputBypassEnabled?: boolean
}): DeviceIdentity {
  const runtimeMode = process.env.ARCADE_RUNTIME_MODE === 'web' ? 'web' : 'cabinet'
  const isPi = options?.isPi ?? false
  const devInputBypassEnabled = options?.devInputBypassEnabled ?? false
  const deviceId = String(process.env.DEVICE_ID || '').trim() || readHardwareSerial(isPi)

  return {
    deviceId,
    runtimeMode,
    isPi,
    compatMode: !isPi,
    devInputBypassEnabled,
    platform: process.platform,
  }
}
