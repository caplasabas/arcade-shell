export function formatPeso(
  amount: number | string,
  withSymbol = false,
  withDecimal = true,
  decimalCount = 2,
  abbreviate = false,
): string {
  const num = Number(amount)
  if (isNaN(num)) return withSymbol ? '$0' : '0'

  const sign = num < 0 ? '-' : ''
  const abs = Math.abs(num)

  let value: string

  if (abbreviate) {
    if (abs >= 1_000_000_000) {
      const v = Math.floor((abs / 1_000_000_000) * 100) / 100
      value = v.toString().replace(/\.00$/, '') + 'B'
    } else if (abs >= 1_000_000) {
      const v = Math.floor((abs / 1_000_000) * 100) / 100
      value = v.toString().replace(/\.00$/, '') + 'M'
    } else if (abs >= 10_000) {
      const v = Math.floor((abs / 1_000) * 100) / 100
      value = v.toString().replace(/\.00$/, '') + 'K'
    } else {
      value = abs.toLocaleString()
    }
  } else {
    value = abs.toFixed(withDecimal ? decimalCount : 2).replace(/\d(?=(\d{3})+\.)/g, '$&,')

    if (withDecimal && decimalCount > 2 && value.endsWith('.00')) {
      value = value.slice(0, -3)
    }
  }

  return `${sign}${withSymbol ? '$' : ''}${value}`
}
