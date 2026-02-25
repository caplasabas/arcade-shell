import { useEffect, useRef } from 'react'

type Props = {
  onConnect: () => void
}

export function NoInternetModal({ onConnect }: Props) {
  const connectButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    connectButtonRef.current?.focus()

    const onArcadeInput = (event: Event) => {
      const customEvent = event as CustomEvent<{ button?: string | number }>
      if (customEvent.detail?.button === 0) {
        onConnect()
      }
    }

    window.addEventListener('ARCADE_MODAL_INPUT', onArcadeInput)
    return () => window.removeEventListener('ARCADE_MODAL_INPUT', onArcadeInput)
  }, [onConnect])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="no-internet-title"
      onMouseDown={event => event.preventDefault()}
    >
      <div className="modal-card" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2 id="no-internet-title">Network Required</h2>
        </div>

        <div className="modal-body">
          <div className="modal-row">
            <span>This arcade machine requires an active internet connection to operate.</span>
          </div>

          <div className="modal-row">
            <strong>Please connect to WiFi to continue.</strong>
          </div>
        </div>

        <div className="modal-actions">
          <button ref={connectButtonRef} className="modal-confirm" onClick={onConnect}>
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}
