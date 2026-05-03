export type BuyStateValue = 'idle' | 'confirm' | 'processing'

export interface BuyStateSnapshot {
  state: BuyStateValue
  confirmAt: number
}

export interface BuyStateStore {
  set(state: BuyStateValue, confirmAt?: number): BuyStateSnapshot
  reset(): BuyStateSnapshot
  getSnapshot(): BuyStateSnapshot
}

export function createBuyStateStore(): BuyStateStore {
  const snapshot: BuyStateSnapshot = {
    state: 'idle',
    confirmAt: 0,
  }

  return {
    set(state, confirmAt = snapshot.confirmAt) {
      snapshot.state = state
      snapshot.confirmAt = confirmAt
      return { ...snapshot }
    },
    reset() {
      snapshot.state = 'idle'
      snapshot.confirmAt = 0
      return { ...snapshot }
    },
    getSnapshot() {
      return { ...snapshot }
    },
  }
}
