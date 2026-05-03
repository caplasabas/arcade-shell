import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { GameDefinition } from '../types.js'
import type { ServiceConfig } from '../types.js'

export interface GameLauncher {
  resolveCorePath(coreValue?: string): string | null
  resolveRomPath(romValue?: string): string | null
  launch(game: GameDefinition): ChildProcessWithoutNullStreams | null
}

const LIBRETRO_DIR_CANDIDATES = [
  '/usr/lib/libretro',
  '/usr/lib/aarch64-linux-gnu/libretro',
  '/usr/lib/arm-linux-gnueabihf/libretro',
]

export function createGameLauncher(config: ServiceConfig): GameLauncher {
  const resolveCorePath = (coreValue?: string) => {
    const normalized = String(coreValue ?? '')
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/')
      .replace(/^.*\//, '')
      .replace(/\.so$/i, '')
      .replace(/_libretro$/i, '')

    if (!normalized) return null

    for (const baseDir of LIBRETRO_DIR_CANDIDATES) {
      const candidate = path.join(baseDir, `${normalized}_libretro.so`)
      if (fs.existsSync(candidate)) return candidate
    }

    return null
  }

  const resolveRomPath = (romValue?: string) => {
    const raw = String(romValue ?? '').trim()
    if (!raw) return null

    const normalizedRaw = raw.replace(/\\/g, '/').trim()
    const romRelative = normalizedRaw
      .replace(/^\/+/, '')
      .replace(/^(\.\.\/)+roms\//, '')
      .replace(/^roms\//, '')

    const candidates = [
      raw,
      path.resolve(config.serviceDir, raw),
      path.resolve(config.runtimeDir, raw),
      path.resolve(config.romsRoot, raw),
      path.join(config.romsRoot, romRelative),
    ]

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate)
      if (fs.existsSync(resolved)) return resolved
    }

    return null
  }

  return {
    resolveCorePath,
    resolveRomPath,
    launch(game) {
      if (!game.core || !game.rom) return null

      const resolvedRomPath = resolveRomPath(game.rom) || game.rom
      console.log('[LAUNCH] emulator', game.id)
      return spawn('bash', ['../../scripts/launch_arcade.sh', game.core, resolvedRomPath])
    },
  }
}
