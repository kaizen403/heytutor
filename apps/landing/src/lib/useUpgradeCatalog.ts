import { useEffect, useState } from 'react'
import { TUTOR_BILLING_CATALOG_HREF } from './tutorAppHref'

export type Currency = 'USD' | 'INR'
export type UpgradePrice = { amount: number; currency: Currency }
export type UpgradePrices = Partial<Record<'plus' | 'lesson_top_up', UpgradePrice>>
const PREFERENCE = 'accelute:checkout-currency'

export function useUpgradeCatalog() {
  const [currency, setCurrency] = useState<Currency | null>(null)
  const [prices, setPrices] = useState<UpgradePrices>({})
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const detect = async () => {
      try {
        const preferred = localStorage.getItem(PREFERENCE)
        if (preferred === 'USD' || preferred === 'INR') { setCurrency(preferred); return }
      } catch { /* optional preference */ }
      try {
        const response = await fetch('/api/region', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]) })
        const value = await response.json() as { country?: unknown }
        if (response.ok && typeof value.country === 'string' && /^[A-Z]{2}$/.test(value.country)) {
          if (!controller.signal.aborted) setCurrency(value.country === 'IN' ? 'INR' : 'USD')
          return
        }
      } catch { /* development/offline fallback */ }
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (!controller.signal.aborted) setCurrency(['Asia/Kolkata', 'Asia/Calcutta'].includes(zone) || navigator.language.endsWith('-IN') ? 'INR' : 'USD')
    }
    void detect()
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!currency) return
    const controller = new AbortController()
    const url = new URL(TUTOR_BILLING_CATALOG_HREF)
    url.searchParams.set('currency', currency)
    void fetch(url, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
      .then(async response => {
        if (!response.ok) throw new Error()
        const value = await response.json() as { plans?: UpgradePrices }
        const next: UpgradePrices = {}
        for (const id of ['plus', 'lesson_top_up'] as const) {
          const price = value.plans?.[id]
          if (price && Number.isSafeInteger(price.amount) && price.amount > 0 && price.currency === currency) next[id] = price
        }
        if (!controller.signal.aborted) { setPrices(next); setFailed(!next.plus) }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [currency])
  return { currency, prices, failed, selectCurrency: (value: Currency) => {
    if (value === currency) return;
    setPrices({})
    setFailed(false)
    setCurrency(value)
    try { localStorage.setItem(PREFERENCE, value) } catch { /* optional preference */ }
  } }
}

export function formatUpgradePrice(price: UpgradePrice): string {
  return new Intl.NumberFormat(price.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: price.currency, maximumFractionDigits: price.amount % 100 ? 2 : 0 }).format(price.amount / 100)
}
