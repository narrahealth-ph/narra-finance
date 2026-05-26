export function fmt(n: number, decimals = 0) {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function fmtSigned(n: number) {
  return n < 0 ? `($${fmt(Math.abs(n))})` : `$${fmt(n)}`
}

export function shortLabel(label: string) {
  const [month, year] = label.split('_')
  return month.slice(0, 3) + ' ' + year.slice(2)
}
