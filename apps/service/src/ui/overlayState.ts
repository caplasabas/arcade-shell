import type { OverlayState, SessionSnapshot } from '../types.js'

export function buildOverlayState(session: SessionSnapshot, balance: number): OverlayState {
  let mode: OverlayState['mode'] = 'WAIT_COIN'
  let continueSeconds: number | null = null

  switch (session.state) {
    case 'IDLE':
      mode = 'WAIT_COIN'
      break
    case 'LAUNCHING':
      mode = 'READY_TO_START'
      break
    case 'RUNNING':
      mode = 'RUNNING'
      break
    case 'CONTINUE_WAIT':
      mode = 'CONTINUE'
      continueSeconds = Math.max(0, Math.ceil(((session.continueDeadline ?? Date.now()) - Date.now()) / 1000))
      break
  }

  return {
    mode,
    balancePeso: balance,
    gameId: session.game?.id ?? null,
    price: session.game?.price ?? null,
    paid: session.paid,
    continueSeconds,
  }
}

export function formatArcadeTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
