/** Verify the landing uses the tutor's native UK and Hinglish providers. */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

for (const [slug, locale, provider] of [
  ['en-gb', 'en-GB', 'cartesia'],
  ['hi-in', 'hi-IN', 'sarvam'],
] as const) {
  const audio = resolve(root, `public/hero/lesson-${slug}.mp3`)
  const timing = JSON.parse(read(`public/hero/lesson-timings-${slug}.json`))
  assert.ok(statSync(audio).size > 1_000_000, `${locale} contains the complete lesson`)
  assert.equal(timing.locale, locale)
  assert.equal(timing.voice.provider, provider)
  assert.equal(timing.voice.voiceKey, locale)
  assert.equal(timing.starts.length, 21)
  assert.equal(timing.segments.length, timing.starts.length)
  assert.equal(timing.starts[0], 0)
  for (let index = 1; index < timing.starts.length; index++) {
    assert.ok(timing.starts[index] > timing.starts[index - 1], `${locale} segment starts are monotonic`)
  }
  const duration = Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', audio,
  ], { encoding: 'utf8' }).trim())
  assert.ok(Math.abs(duration - timing.total) < 0.05, `${locale} audio and clock have the same duration`)
  assert.ok(timing.segments.every((segment: { totalDuration: number }) => segment.totalDuration > 0))
  const alignedCharacters = timing.segments.reduce(
    (total: number, segment: { charStartTimes: number[] }) => total + segment.charStartTimes.length,
    0,
  )
  if (locale === 'en-GB') assert.ok(alignedCharacters > 2_000, 'UK ink gets native character alignment')
  else assert.equal(alignedCharacters, 0, 'Sarvam correctly uses duration-only timing')
}

const generator = read('../tutor/scripts/lecture-lab/generateLandingVoice.ts')
assert.match(generator, /ttsConfig\(locale\)/)
assert.match(generator, /\['en-GB', 'hi-IN'\]/)
const hook = read('src/components/hero-lesson/useLessonSimulation.ts')
assert.match(hook, /heroLessonAssets\(locale\)/)
assert.match(hook, /runHeroLessonLoop[\s\S]*timedSegments/)

console.log('verify-hero-voice: complete native UK and Hinglish tracks share the live ink clock')
