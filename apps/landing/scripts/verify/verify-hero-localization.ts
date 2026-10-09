import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  heroLessonAssets,
  heroLessonLocaleFromSignals,
  heroLessonLocaleLabel,
} from '../../src/components/hero-lesson/heroLessonLocale.ts'
import narrations from '../../src/components/hero-lesson/lessonNarration.json' with { type: 'json' }
import lesson from '../../src/components/hero-lesson/lessonAsset.json' with { type: 'json' }

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

assert.equal(heroLessonLocaleFromSignals({ country: 'IN' }), 'hi-IN')
assert.equal(heroLessonLocaleFromSignals({ country: 'GB', language: 'en-IN', timeZone: 'Asia/Kolkata' }), 'en-GB')
assert.equal(heroLessonLocaleFromSignals({ country: 'US' }), 'en-GB')
assert.equal(heroLessonLocaleFromSignals({ country: null, language: 'en-IN' }), 'hi-IN')
assert.equal(heroLessonLocaleFromSignals({ country: null, timeZone: 'Asia/Calcutta' }), 'hi-IN')
assert.equal(heroLessonLocaleFromSignals({ country: null, language: 'en-US', timeZone: 'America/New_York' }), 'en-GB')

assert.equal(heroLessonLocaleLabel('hi-IN'), 'Hinglish')
assert.equal(heroLessonLocaleLabel('en-GB'), 'UK English')
assert.deepEqual(heroLessonAssets('hi-IN'), {
  audio: '/hero/lesson-hi-in.mp3',
  timings: '/hero/lesson-timings-hi-in.json',
})
assert.deepEqual(heroLessonAssets('en-GB'), {
  audio: '/hero/lesson-en-gb.mp3',
  timings: '/hero/lesson-timings-en-gb.json',
})

for (const locale of ['en-GB', 'hi-IN'] as const) {
  assert.equal(narrations[locale].length, lesson.segments.length, `${locale} covers every lesson segment`)
  assert.ok(narrations[locale].every((line) => line.trim().length > 0), `${locale} has no silent segment`)
}
assert.ok(narrations['en-GB'].every((line) => !/\p{Script=Devanagari}/u.test(line)))
assert.ok(narrations['en-GB'].some((line) => /centimetres/.test(line)), 'UK copy uses UK spelling')
for (const line of narrations['hi-IN']) {
  assert.match(line, /\p{Script=Devanagari}/u, `Hinglish mixes Hindi into every segment: ${line}`)
  assert.doesNotMatch(line, /\d/, `Hinglish speaks every number as English words: ${line}`)
  assert.ok(!line.includes('।'), 'Sarvam narration uses a full stop')
}

const window = read('src/components/lesson-showcase/LiveLessonWindow.tsx')
assert.match(window, /DashboardMockup/, 'the demo uses the live whiteboard renderer')
assert.doesNotMatch(window, /<video|lesson-loop\.mp4/, 'the low-cadence screen recording is gone')
assert.match(window, /compact=/, 'mobile gets a responsive product layout')
assert.match(window, /whitespace-nowrap/, 'the locale CTA stays a compact one-line control on phones')

const showcase = read('src/components/LessonShowcase.tsx')
assert.doesNotMatch(showcase, /rotateX\(|scale\(/, 'the desktop lesson window never zooms or tilts')

const css = read('src/components/hero-lesson/heroProduct.css')
assert.match(css, /data-compact/, 'the live product has an explicit compact layout')
assert.match(css, /display:\s*none/, 'compact mode removes the sidebar rather than cropping pixels')

console.log('verify-hero-localization: India gets Hinglish; everyone else UK English; live board stays fully framed')
