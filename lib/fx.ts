import { query } from './db'

const BASE_URL = 'https://v6.exchangerate-api.com/v6'
const API_KEY  = process.env.EXCHANGERATE_API_KEY

export const SUPPORTED_CURRENCIES = ['USD', 'SGD', 'PHP', 'EUR', 'GBP']

export async function getRate(fromCurrency: string, date: string): Promise<number> {
  if (fromCurrency === 'USD') return 1
  try {
    const cached = await query(
      'SELECT rate FROM fx_rates WHERE from_currency = $1 AND date = $2',
      [fromCurrency, date]
    )
    if (cached.rows[0]) return parseFloat(cached.rows[0].rate)
  } catch {}
  try {
    const res  = await fetch(`${BASE_URL}/${API_KEY}/history/USD/${date.replace(/-/g, '/')}`)
    const data = await res.json()
    if (data.result !== 'success') return getFallbackRate(fromCurrency)
    const rates = data.conversion_rates || {}
    for (const [currency, usdRate] of Object.entries(rates)) {
      if (SUPPORTED_CURRENCIES.includes(currency)) {
        const toUsd = 1 / (usdRate as number)
        await query(
          `INSERT INTO fx_rates (date, from_currency, rate) VALUES ($1, $2, $3) ON CONFLICT (date, from_currency) DO UPDATE SET rate = $3`,
          [date, currency, toUsd]
        ).catch(() => {})
      }
    }
    const targetRate = rates[fromCurrency]
    return targetRate ? 1 / (targetRate as number) : getFallbackRate(fromCurrency)
  } catch {
    return getFallbackRate(fromCurrency)
  }
}

export async function toUSD(amount: number, fromCurrency: string, date: string): Promise<number> {
  if (!amount || fromCurrency === 'USD') return amount
  const rate = await getRate(fromCurrency, date)
  return Math.round(amount * rate * 100) / 100
}

export async function getLatestRates(): Promise<Record<string, number>> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const rates: Record<string, number> = { USD: 1 }
    for (const currency of SUPPORTED_CURRENCIES.filter(c => c !== 'USD')) {
      rates[currency] = await getRate(currency, today)
    }
    return rates
  } catch {
    return { USD: 1, SGD: 0.74, PHP: 0.017, EUR: 1.08, GBP: 1.27 }
  }
}

function getFallbackRate(currency: string): number {
  const fallbacks: Record<string, number> = { SGD: 0.74, PHP: 0.017, EUR: 1.08, GBP: 1.27 }
  return fallbacks[currency] || 1
}
