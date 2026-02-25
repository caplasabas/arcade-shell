// balance.js

let balance = 0

function addBalance(amount) {
    balance += amount
    console.log('[BALANCE] +', amount, '→', balance)
}

function deductBalance(amount) {
    if (balance < amount) return false
    balance -= amount
    console.log('[BALANCE] -', amount, '→', balance)
    return true
}

function getBalance() {
    return balance
}

export {
    addBalance,
    deductBalance,
    getBalance,
}
