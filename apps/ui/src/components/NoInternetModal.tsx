import { useEffect, useRef } from 'react'

type Props = {
  onConnect: () => void
  currentSsid?: string | null
  wifiConnected?: boolean
}

export function NoInternetModal({ onConnect, currentSsid, wifiConnected }: Props) {
  const connectButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    connectButtonRef.current?.focus()

    const isConfirm = (button: string | number) =>
      button === 0 ||
      button === '0' ||
      button === 1 ||
      button === '1' ||
      button === 'A' ||
      button === 'START' ||
      button === 'ENTER'

    const onArcadeInput = (event: Event) => {
      const customEvent = event as CustomEvent<{ button?: string | number }>
      const button = customEvent.detail?.button
      if (button === undefined || button === null) return

      if (isConfirm(button)) {
        event.preventDefault?.()
        event.stopImmediatePropagation?.()
        onConnect()
      }
    }

    window.addEventListener('ARCADE_MODAL_INPUT', onArcadeInput, true)
    return () => window.removeEventListener('ARCADE_MODAL_INPUT', onArcadeInput, true)
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
          {wifiConnected && currentSsid && (
            <div className="modal-network-status">
              Connected to <strong>{currentSsid}</strong>, but no internet access.
            </div>
          )}

          <div className="modal-row">
            <span>This arcade machine requires an active internet connection to operate.</span>
          </div>

          <div className="modal-row connect-wifi-text">
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
