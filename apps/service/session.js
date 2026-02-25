// session.js

import {deductBalance} from './balance.js'

let inactivityTimer = null
let continueTimer = null

const INACTIVITY_MS = 15_000
const CONTINUE_MS = 10_000

const session = {
    state: 'IDLE', // IDLE | LAUNCHING | RUNNING | CONTINUE_WAIT
    game: null,
    startedAt: null,
    paid: false,
    continueDeadline: null,
}

/* ---------------- CORE TRANSITIONS ---------------- */

function startLaunch(game) {
    if (session.state !== 'IDLE') return false

    session.state = 'LAUNCHING'
    session.game = game
    session.startedAt = Date.now()
    session.paid = false

    console.log('[SESSION] LAUNCH', game.id)
    return true
}

function startGame() {
    if (
        session.state !== 'LAUNCHING' &&
        session.state !== 'CONTINUE_WAIT'
    ) return false

    if (!deductBalance(session.game.price)) {
        console.log('[BALANCE] insufficient')
        return false
    }

    session.state = 'RUNNING'
    session.paid = true
    armInactivity()

    console.log('[SESSION] RUNNING')
    return true
}

function armInactivity() {
    clearTimeout(inactivityTimer)

    inactivityTimer = setTimeout(() => {
        console.log('[GAME] inactivity → CONTINUE')
        enterContinue()
    }, INACTIVITY_MS)
}

function notifyInput() {
    if (session.state === 'RUNNING') {
        armInactivity()
    }
}

function enterContinue() {
    if (session.state !== 'RUNNING') return

    session.state = 'CONTINUE_WAIT'
    session.continueDeadline = Date.now() + CONTINUE_MS

    clearTimeout(continueTimer)
    continueTimer = setTimeout(() => {
        console.log('[CONTINUE] timeout')
        endSession()
    }, CONTINUE_MS)
}

function endSession() {
    console.log('[SESSION] EXIT')

    clearTimeout(inactivityTimer)
    clearTimeout(continueTimer)

    inactivityTimer = null
    continueTimer = null

    session.state = 'IDLE'
    session.game = null
    session.startedAt = null
    session.paid = false
    session.continueDeadline = null
}

function getSession() {
    return {...session}
}

export {
    startLaunch,
    startGame,
    notifyInput,
    endSession,
    getSession,
}
