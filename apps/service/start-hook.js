// start-hook.js
import readline from 'readline'

export function attachStartHook(onStart) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    console.log('[HOOK] Listening for ENTER (START)')

    rl.on('line', () => {
        // ENTER key produces empty line
        onStart()
    })
}
