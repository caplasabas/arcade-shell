export interface BalanceStore {
  add(amount: number): number
  deduct(amount: number): boolean
  set(amount: number): number
  get(): number
  reset(): number
}

export function createBalanceStore(initialBalance = 0): BalanceStore {
  let balance = initialBalance

  return {
    add(amount) {
      balance += amount
      console.log('[BALANCE] +', amount, '->', balance)
      return balance
    },
    deduct(amount) {
      if (balance < amount) return false
      balance -= amount
      console.log('[BALANCE] -', amount, '->', balance)
      return true
    },
    set(amount) {
      balance = amount
      return balance
    },
    get() {
      return balance
    },
    reset() {
      balance = 0
      return balance
    },
  }
}
