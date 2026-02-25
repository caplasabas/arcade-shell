// inject-toggle-lock-input.js
import {exec} from 'child_process'

export function toggleLockInput() {
    exec(`
    osascript -e '
      tell application "RetroArch" to activate
      delay 0.1
      tell application "System Events" to key code 111
    '
  `)
}
