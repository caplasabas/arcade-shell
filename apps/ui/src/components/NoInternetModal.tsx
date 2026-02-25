// components/NoInternetModal.tsx

type Props = {
  onConnect: () => void
}

export function NoInternetModal({ onConnect }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Network Required</h2>
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
          <button className="modal-confirm" onClick={onConnect}>
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}
