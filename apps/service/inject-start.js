import {exec} from 'child_process'

export function injectStart() {
    console.log('[INJECT] START → RetroArch')

    exec(`
    osascript -e '
      tell application "RetroArch" to activate
      delay 0.1
      tell application "System Events" to keystroke return
    '
  `, err => {
        if (err) console.error('[INJECT] failed', err)
    })
}
