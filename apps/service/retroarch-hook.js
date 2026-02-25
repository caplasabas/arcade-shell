// retroarch-hook.js

import readline from 'readline'

export function attachRetroarchStartHook(onStart) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    console.log('[HOOK] Waiting for START input (type: START)')

    rl.on('line', line => {
        if (line.trim() !== 'START') return
        console.log('[HOOK] START detected')
        onStart()
    })
}
