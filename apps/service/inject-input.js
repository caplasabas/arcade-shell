// inject-input.js
import {exec} from 'child_process'

function sendF12() {
    exec(`
    osascript -e '
      tell application "RetroArch" to activate
      delay 0.15
      tell application "System Events" to key code 111
    '
  `)
}

export function lockInput() {
    console.log('[INPUT] LOCK')
    sendF12()
}

export function unlockInput() {
    console.log('[INPUT] UNLOCK')
    sendF12()
}
