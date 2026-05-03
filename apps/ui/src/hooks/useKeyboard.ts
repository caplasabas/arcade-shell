import {useEffect} from 'react'

type Params = {
  disabled?: boolean
  onUp: () => void
  onDown: () => void
  onConfirm: () => void
  onExit: () => void
}

export function useKeyboard({
                              disabled,
                              onUp,
                              onDown,
                              onConfirm,
                              onExit,
                            }: Params) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onExit()
      if (disabled) return

      if (e.key === 'ArrowUp') onUp()
      if (e.key === 'ArrowDown') onDown()
      if (e.key === 'Enter') onConfirm()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabled])
}
