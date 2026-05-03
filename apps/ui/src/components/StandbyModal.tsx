type Props = {
  elevated?: boolean
}

export function StandbyModal({ elevated = false }: Props) {
  return (
    <div
      className={`modal-backdrop${elevated ? ' modal-backdrop-elevated' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="standby-title"
      onMouseDown={event => event.preventDefault()}
    >
      <div className="modal-card modal-card-standby" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-body standby-modal-body">
          <div className="standby-modal-label">Standby</div>
          <h1 id="standby-title" className="standby-modal-title">
            UNDER MAINTENANCE
          </h1>
        </div>
      </div>
    </div>
  )
}
