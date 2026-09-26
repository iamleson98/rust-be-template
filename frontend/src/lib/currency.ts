// Multi-currency helpers — VND (native) and USD (converted via static rate).
// All amounts are stored/processed as VND integers; USD is a presentation layer only.

import { formatVND } from './types'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

/** Static exchange rate: 1 USD = 24,500 VND */
export const EXCHANGE_RATE = 24500

export type Currency = 'VND' | 'USD'

/**
 * Format an amount (always given in VND) into the requested currency.
 *   - VND: existing formatVND output, e.g. "332.500₫"
 *   - USD: "$13.57" (2 decimal places)
 */
export function formatCurrency(amountVND: number, currency: Currency): string {
  if (currency === 'USD') {
    const usd = amountVND / EXCHANGE_RATE
    // Always show 2 decimal places; use en-US formatting for thousands separators
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(usd)
  }
  return formatVND(amountVND)
}

/** Convert VND amount to USD (rounded to 2 decimal places). */
export function convertToUSD(amountVND: number): number {
  return Math.round((amountVND / EXCHANGE_RATE) * 100) / 100
}

/** Convert USD amount back to VND (rounded to nearest VND — no fractional currency). */
export function convertToVND(amountUSD: number): number {
  return Math.round(amountUSD * EXCHANGE_RATE)
}

/** Short human-readable exchange-rate note used in the footer —
 *  language-reactive: "Tỷ giá: 1 USD = 24.500₫" / "Rate: 1 USD = 24,500₫". */
export function exchangeRateNote(): string {
  const lang = useApp.getState().lang
  const rate = EXCHANGE_RATE.toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN')
  return translate(lang, 'common.exchangeRateNote', { rate })
}

/** Legacy module-level (Vietnamese) constant — kept for tests/back-compat;
 *  prefer calling `exchangeRateNote()` at render time. */
export const EXCHANGE_RATE_NOTE = `Tỷ giá: 1 USD = ${EXCHANGE_RATE.toLocaleString('vi-VN')}₫`
