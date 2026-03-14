export type ExitConfirmContext = 'menu' | 'casino' | 'keyboard'

type Props = {
  context: ExitConfirmContext
  onConfirm: () => void
  onCancel: () => void
}

export function ExitConfirmModal({ context, onConfirm, onCancel }: Props) {
  const modeLabel = context === 'casino' ? 'casino game' : 'current game'

  return (
    <div className="modal-backdrop modal-backdrop-elevated">
      <div className="modal-card modal-card-exit">
        <div className="modal-header">
          <h2>Exit {modeLabel}?</h2>
        </div>

        <div className="modal-body">
          <div className="modal-exit-message">Press MENU again to confirm exit.</div>
          <div className="modal-exit-hint">A/START = Confirm, B = Cancel</div>
        </div>

        <div className="modal-actions">
          <button onClick={onCancel} className="modal-cancel">
            Cancel
          </button>
          <button onClick={onConfirm} className="modal-confirm">
            Confirm Exit
          </button>
        </div>
      </div>
    </div>
  )
}
