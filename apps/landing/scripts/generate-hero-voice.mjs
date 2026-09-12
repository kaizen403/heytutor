#!/usr/bin/env node
/**
 * Regenerates the hero lesson voiceover for the landing page.
 *
 * Usage:  node apps/landing/scripts/generate-hero-voice.mjs
 *         (or: pnpm --filter @heytutor/landing gen:hero-voice)
 *
 * Reads ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID from the process env, the repo
 * root .env, or apps/tutor/.env.local (first match wins). Writes:
 *   apps/landing/public/hero/lesson.mp3
 *   apps/landing/public/hero/lesson-timings.json   (per-segment start offsets)
 *
 * KEEP `SEGMENTS` IN SYNC with src/components/hero-lesson/lessonScript.ts —
 * the timings JSON is indexed against that array (and validated by length at
 * runtime; a mismatch falls back to estimated timing).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SEGMENTS = [
  "Let's find the final velocity of this car.",
  'It starts from rest, accelerates at two metres per second squared, for five seconds.',
  'We use the first equation of motion: v equals u plus a t.',
  "On a velocity time graph, that's a straight line rising from the origin.",
  'Substituting the values: v equals zero, plus two times five.',
  'So the final velocity is ten metres per second.',
]

// Same voice + settings as the live tutor (packages/tutor-core/src/tts/voiceSettings.ts).
// `speed` is generation pace, not HTML playbackRate — speeding the MP3 up later
// shifts pitch and is what made the old hero clip sound like a chipmunk.
const MODEL_ID = 'eleven_multilingual_v2'
const VOICE_SETTINGS = { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true, speed: 0.88 }
const OUTPUT_FORMAT = 'mp3_44100_128'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

async function loadEnvFile(file) {
  try {
    const text = await readFile(file, 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* file absent — fine */
  }
}

await loadEnvFile(path.join(root, '.env'))
await loadEnvFile(path.join(root, 'apps/tutor/.env.local'))
await loadEnvFile(path.join(root, 'apps/tutor/.env'))

const apiKey = process.env.ELEVENLABS_API_KEY
const voiceId = process.env.ELEVENLABS_VOICE_ID || 'ecp3DWciuUyW7BYM7II1'
if (!apiKey) {
  console.error('ELEVENLABS_API_KEY not found in env, root .env, or apps/tutor/.env.local')
  process.exit(1)
}

// One take, sentences separated by a newline so the model breathes between
// teaching steps without a concat click. Offsets stay character-indexed
// against that joined string (the runtime validates starts.length).
const text = SEGMENTS.join('\n')
const offsets = []
let acc = 0
for (const s of SEGMENTS) {
  offsets.push(acc)
  acc += s.length + 1
}

console.log(`Requesting TTS (${text.length} chars, voice ${voiceId})…`)
const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
  {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  },
)
if (!res.ok) {
  console.error(`ElevenLabs error ${res.status}:`, await res.text())
  process.exit(1)
}

const data = await res.json()
const chars = data.alignment.characters
const starts = data.alignment.character_start_times_seconds
const ends = data.alignment.character_end_times_seconds

const segStarts = offsets.map((off) => {
  let i = off
  while (i < chars.length && /\s/.test(chars[i])) i++
  return starts[Math.min(i, starts.length - 1)]
})
const total = ends[ends.length - 1]

const outDir = path.join(root, 'apps/landing/public/hero')
await mkdir(outDir, { recursive: true })
await writeFile(path.join(outDir, 'lesson.mp3'), Buffer.from(data.audio_base64, 'base64'))
await writeFile(path.join(outDir, 'lesson-timings.json'), JSON.stringify({ starts: segStarts, total }, null, 2) + '\n')

console.log(`Wrote public/hero/lesson.mp3 + lesson-timings.json (total ${total.toFixed(2)}s)`)
console.log('Segment starts:', segStarts.map((s) => s.toFixed(2)).join(', '))
