import {useEffect} from 'react'

type Params = {
  disabled?: boolean
  onUp: () => void
  onDown: () => void
  onConfirm: () => void
}

export function useGamepad({disabled, onUp, onDown, onConfirm}: Params) {
  useEffect(() => {
    if (disabled) return

    let last = 0

    function tick() {
      const pad = navigator.getGamepads()[0]
      if (!pad) return requestAnimationFrame(tick)

      const now = performance.now()
      if (now - last < 200) return requestAnimationFrame(tick)

      if (pad.buttons[12]?.pressed) onUp()
      if (pad.buttons[13]?.pressed) onDown()
      if (pad.buttons[0]?.pressed) onConfirm()

      last = now
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  }, [disabled])
}
