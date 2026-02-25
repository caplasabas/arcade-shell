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

export function launchGame(game: GameDescriptor) {
  if (currentGame) return
  currentGame = game
}

export function exitGame() {
  currentGame = null
}

export function getRunningGame() {
  return currentGame
}
