// overlay.js
import {getBalance} from './balance.js'
import {getSession} from './session.js'

export function getOverlayState() {
    const s = getSession()
    const balance = getBalance()

    let mode = 'WAIT_COIN'
    let continueSeconds = null

    switch (s.state) {
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
            continueSeconds = Math.max(
                0,
                Math.ceil((s.continueDeadline - Date.now()) / 1000)
            )
            break
    }

    return {
        mode,
        balancePeso: balance,
        gameId: s.game?.id ?? null,
        price: s.game?.price ?? null,
        paid: s.paid,
        continueSeconds,
    }
}
