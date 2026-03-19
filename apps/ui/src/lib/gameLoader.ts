// gameLoader.ts

export type GameType = 'arcade' | 'casino'

export type GameDescriptor = {
  id: string
  type: GameType
  core?: string
  rom?: string
  entry?: string // for casino
}

let currentGame: GameDescriptor | null = null

export function isGameRunning() {
  return currentGame !== null
}

export function launchGame(game: GameDescriptor): boolean {
  if (currentGame) {
    console.warn('[gameLoader] launch ignored; current game already set', {
      currentGame,
      requestedGame: game,
    })
    return false
  }

  currentGame = game
  return true
}

export function exitGame() {
  currentGame = null
}

export function getRunningGame() {
  return currentGame
}
