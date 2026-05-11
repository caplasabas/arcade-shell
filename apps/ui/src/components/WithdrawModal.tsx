import { formatPeso } from '../utils'

type Props = {
  withdrawAmount: number
  isWithdrawing: boolean
  balance: number
  requestedAmount: number
  remainingAmount: number
  maxSelectableAmount: number
  cooldownRemainingMs?: number
  loading?: boolean
  available?: boolean
  elevated?: boolean
  onAddAmount: () => void
  onMinusAmount: () => void
  onConfirm: () => void
  onCancel: () => void
}

export function WithdrawModal({
  withdrawAmount,
  isWithdrawing,
  requestedAmount,
  remainingAmount,
  maxSelectableAmount,
  cooldownRemainingMs = 0,
  loading = false,
  available = true,
  elevated = false,
  onAddAmount,
  onMinusAmount,
  onConfirm,
  onCancel,
}: Props) {
  const canAfford =
    !loading &&
    cooldownRemainingMs <= 0 &&
    available &&
    maxSelectableAmount > 0 &&
    withdrawAmount <= maxSelectableAmount
  const activeAmount = isWithdrawing ? remainingAmount : withdrawAmount
  const unavailable =
    !loading && (!available || maxSelectableAmount <= 0 || cooldownRemainingMs > 0)
  const cooldownSeconds = Math.max(0, Math.ceil(cooldownRemainingMs / 1000))
  const cooldownText = `${Math.floor(cooldownSeconds / 60)}:${String(cooldownSeconds % 60).padStart(2, '0')}`

  return (
    <div className={`modal-backdrop${elevated ? ' modal-backdrop-elevated' : ''}`}>
      <div className="modal-card modal-card-withdraw">
        <div className="modal-header">
          <h2>Withdraw Balance</h2>
        </div>

        <div className="modal-body">
          <div className="modal-row modal-row-withdraw">
            <span className="withdraw-label">
              {isWithdrawing ? 'Remaining to Dispense' : 'Withdraw Amount'}
            </span>
            <div className="amount-adjust">
              <button
                disabled={loading || isWithdrawing || withdrawAmount <= 20}
                onClick={onMinusAmount}
                className={`modal-toggle ${unavailable ? 'withdraw-offline' : ''}`}
              >
                −
              </button>
              <span className={`withdraw-amount-value ${unavailable ? 'withdraw-offline' : ''}`}>
                {formatPeso(activeAmount)}
              </span>
              <button
                disabled={loading || isWithdrawing || withdrawAmount >= maxSelectableAmount}
                onClick={onAddAmount}
                className={`modal-toggle ${unavailable ? 'withdraw-offline' : ''}`}
              >
                +
              </button>
            </div>
          </div>

          {!loading && available && maxSelectableAmount > 0 && (
            <>
              <div className="modal-warning modal-warning-withdraw">
                Min withdrawable amount is 20
              </div>
              {typeof maxSelectableAmount === 'number' && (
                <div className="modal-warning modal-warning-withdraw">
                  Max withdrawable amount is {formatPeso(maxSelectableAmount)}
                </div>
              )}
            </>
          )}

          {!isWithdrawing && cooldownRemainingMs > 0 && (
            <div className="modal-warning modal-warning-withdraw">
              Withdraw available in {cooldownText}
            </div>
          )}

          {!isWithdrawing && cooldownRemainingMs <= 0 && unavailable && (
            <div className="modal-warning">Unavailable</div>
          )}
        </div>
        {!isWithdrawing && loading && (
          <div className="withdraw-progress-overlay">
            <div className="withdraw-loading-card">
              <div className="boot-spinner withdraw-loading-spinner" />
              <div className="withdraw-loading-title">Preparing...</div>
            </div>
          </div>
        )}
        {isWithdrawing && (
          <div className="withdraw-progress-overlay">
            <div className="withdraw-progress-card">
              <div className="withdraw-progress-title">Dispensing</div>
              <div className="withdraw-progress-amount">{formatPeso(remainingAmount)}</div>
              <div className="withdraw-progress-detail">
                Requested {formatPeso(requestedAmount)}
              </div>
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button disabled={isWithdrawing} onClick={onCancel} className="modal-cancel">
            Cancel
          </button>
          <button
            disabled={!canAfford || isWithdrawing}
            onClick={onConfirm}
            className="modal-confirm"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
