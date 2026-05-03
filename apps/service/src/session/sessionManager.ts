import type { GameDefinition, SessionSnapshot } from '../types.js'
import type { BalanceStore } from '../state/balanceStore.js'

export interface SessionManagerOptions {
  inactivityMs?: number
  continueMs?: number
  onSessionEnded?: () => void
}

export interface SessionManager {
  startLaunch(game: GameDefinition): boolean
  startGame(): boolean
  notifyInput(): void
  enterContinue(): void
  endSession(): void
  canAcceptInput(): boolean
  getSnapshot(): SessionSnapshot
}

export function createSessionManager(
  balanceStore: BalanceStore,
  options: SessionManagerOptions = {},
): SessionManager {
  const inactivityMs = options.inactivityMs ?? 15_000
  const continueMs = options.continueMs ?? 10_000

  let inactivityTimer: NodeJS.Timeout | null = null
  let continueTimer: NodeJS.Timeout | null = null

  const session: SessionSnapshot = {
    state: 'IDLE',
    game: null,
    startedAt: null,
    paid: false,
    continueDeadline: null,
  }

  function clearTimers() {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    if (continueTimer) clearTimeout(continueTimer)
    inactivityTimer = null
    continueTimer = null
  }

  function enterContinue() {
    if (session.state !== 'RUNNING') return

    session.state = 'CONTINUE_WAIT'
    session.continueDeadline = Date.now() + continueMs

    if (continueTimer) clearTimeout(continueTimer)
    continueTimer = setTimeout(() => {
      console.log('[CONTINUE] timeout')
      endSession()
    }, continueMs)
  }

  function armInactivity() {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => {
      console.log('[GAME] inactivity -> CONTINUE')
      enterContinue()
    }, inactivityMs)
  }

  function endSession() {
    console.log('[SESSION] EXIT')
    clearTimers()
    session.state = 'IDLE'
    session.game = null
    session.startedAt = null
    session.paid = false
    session.continueDeadline = null
    options.onSessionEnded?.()
  }

  return {
    startLaunch(game) {
      if (session.state !== 'IDLE') return false

      session.state = 'LAUNCHING'
      session.game = game
      session.startedAt = Date.now()
      session.paid = false

      console.log('[SESSION] LAUNCH', game.id)
      return true
    },
    startGame() {
      if (session.state !== 'LAUNCHING' && session.state !== 'CONTINUE_WAIT') return false
      if (!session.game) return false
      if (!balanceStore.deduct(session.game.price)) {
        console.log('[BALANCE] insufficient')
        return false
      }

      session.state = 'RUNNING'
      session.paid = true
      session.continueDeadline = null
      armInactivity()

      console.log('[SESSION] RUNNING')
      return true
    },
    notifyInput() {
      if (session.state === 'RUNNING') armInactivity()
    },
    enterContinue,
    endSession,
    canAcceptInput() {
      return session.state === 'RUNNING'
    },
    getSnapshot() {
      return { ...session }
    },
  }
}
