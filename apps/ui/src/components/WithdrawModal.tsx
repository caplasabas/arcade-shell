import {formatPeso} from '../utils'

type Props = {
  withdrawAmount: number
  isWithdrawing: boolean
  balance: number
  onAddAmount: () => void
  onMinusAmount: () => void
  onConfirm: () => void
  onCancel: () => void
}

export function WithdrawModal({
                                withdrawAmount,
                                isWithdrawing,
                                balance,
                                onAddAmount,
                                onMinusAmount,
                                onConfirm,
                                onCancel,
                              }: Props) {
  const canAfford = balance >= withdrawAmount

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Withdraw Balance</h2>
        </div>

        <div className="modal-body">
          <div className="modal-row">
            <span>Withdraw Amount</span>
            <div className="amount-adjust">
              <button disabled={isWithdrawing} onClick={onMinusAmount} className="modal-toggle">
                −
              </button>
              <span>{formatPeso(withdrawAmount)}</span>
              <button disabled={isWithdrawing} onClick={onAddAmount} className="modal-toggle">
                +
              </button>
            </div>
          </div>

          {!canAfford && <div className="modal-warning">Insufficient balance</div>}
        </div>
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
