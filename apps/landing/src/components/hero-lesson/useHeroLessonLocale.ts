import { useEffect, useState } from 'react'
import {
  heroLessonLocaleFromSignals,
  type HeroLessonLocale,
} from './heroLessonLocale'

function browserSignals(): { language: string | null; timeZone: string | null } {
  if (typeof window === 'undefined') return { language: null, timeZone: null }
  return {
    language: navigator.language || null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  }
}

/** Resolve once from the country-only endpoint; never request precise location. */
export function useHeroLessonLocale(): HeroLessonLocale {
  const [locale, setLocale] = useState<HeroLessonLocale>(() =>
    heroLessonLocaleFromSignals(browserSignals()),
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/region', { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`region ${response.status}`)
        return response.json() as Promise<{ country?: unknown }>
      })
      .then((value) => {
        if (controller.signal.aborted) return
        setLocale(
          heroLessonLocaleFromSignals({
            country: typeof value.country === 'string' ? value.country : null,
            ...browserSignals(),
          }),
        )
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  return locale
}
