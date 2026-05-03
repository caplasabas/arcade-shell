import type { GameDefinition } from '../types.js'

export const gameCatalog: Record<string, GameDefinition> = {
  bikermice: {
    id: 'bikermice',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/BikerMiceFromMars.sfc',
  },
  contra: {
    id: 'contra',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/Contra3.sfc',
  },
  gradius: {
    id: 'gradius',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/Gradius3.sfc',
  },
  puzzlebobble: {
    id: 'puzzlebobble',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/PuzzleBobble.sfc',
  },
  streetfighter: {
    id: 'streetfighter',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/StreetFighter2Turbo.sfc',
  },
  bomberman: {
    id: 'bomberman',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/SuperBomberman.sfc',
  },
  mario: {
    id: 'mario',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/SuperMarioWorld.smc',
  },
  topgear: {
    id: 'topgear',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/TopGear.sfc',
  },
  mortalkombat: {
    id: 'mortalkombat',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/UltimateMortalKombat3.md',
  },
  tekken: {
    id: 'tekken',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/Tekken2.sfc',
  },
  xmen: {
    id: 'xmen',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/XMenMutantApocalypse.sfc',
  },
  xmenvsstreet: {
    id: 'xmenvsstreet',
    type: 'arcade',
    price: 10,
    core: 'snes9x',
    rom: '../../roms/snes/XMenVsStreetFighter.smc',
  },
  ultraace: {
    id: 'ultraace',
    type: 'casino',
    price: 0,
  },
}

export function getGameDefinition(gameId: string): GameDefinition | null {
  return gameCatalog[gameId] ?? null
}

export function listGameDefinitions(): GameDefinition[] {
  return Object.values(gameCatalog)
}

export function listGameIds(): string[] {
  return Object.keys(gameCatalog)
}
