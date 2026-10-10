export type HeroLessonLocale = 'hi-IN' | 'en-GB'

export interface HeroLessonLocaleSignals {
  country?: string | null
  language?: string | null
  timeZone?: string | null
}

const INDIA_ZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta'])

/** Hosting country wins. Browser signals are only a local-development fallback. */
export function heroLessonLocaleFromSignals({
  country,
  language,
  timeZone,
}: HeroLessonLocaleSignals): HeroLessonLocale {
  const normalizedCountry = country?.trim().toUpperCase() ?? ''
  if (/^[A-Z]{2}$/.test(normalizedCountry) && normalizedCountry !== 'XX') {
    return normalizedCountry === 'IN' ? 'hi-IN' : 'en-GB'
  }
  if (INDIA_ZONES.has(timeZone ?? '') || /-IN$/i.test(language ?? '')) return 'hi-IN'
  return 'en-GB'
}

export function heroLessonLocaleLabel(locale: HeroLessonLocale): string {
  return locale === 'hi-IN' ? 'Hinglish' : 'UK English'
}

export function heroLessonAssets(locale: HeroLessonLocale): { audio: string; timings: string } {
  const slug = locale.toLowerCase()
  return {
    audio: `/hero/lesson-${slug}.mp3`,
    timings: `/hero/lesson-timings-${slug}.json`,
  }
}
