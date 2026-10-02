/** Verify speech came from native playback of this actual tutor turn. */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const capture = JSON.parse(read('src/components/hero-lesson/lessonCapture.json'))
assert.equal(capture.kind, 'native-tutor-session')
assert.equal(capture.audioProvenance.source, 'observed-native-playback')
const spoken = capture.turn.segments.filter((segment: { narration: string }) => segment.narration.trim())
assert.equal(capture.audioProvenance.persistedTurnAudioAvailable, spoken.every((segment: { hasAudio: boolean }) => segment.hasAudio), 'native playback capture must not imply that saved cloud audio was verified')
assert.equal(capture.audio.length, spoken.length, 'retain every original narrated clip')
let previousEnd = 0
for (const audio of capture.audio) {
  assert.match(audio.sha256, /^[a-f0-9]{64}$/, 'retain a fingerprint of the actually played bytes')
  assert.equal(audio.playbackRate, capture.turn.speedMultiplier, 'retain the actual app playback rate')
  assert.ok(audio.startSeconds >= previousEnd - 0.005, 'native speech clips must not overlap')
  assert.ok(audio.endSeconds > audio.startSeconds)
  const audibleDuration = (audio.mediaEnd - audio.mediaStart) / audio.playbackRate
  assert.ok(Math.abs(audibleDuration - (audio.endSeconds - audio.startSeconds)) < 0.2, 'audio placement must match observed native playback')
  previousEnd = audio.endSeconds
}
assert.ok(capture.duration >= previousEnd, 'keep the whole final sentence')
const mp3 = resolve(root, 'public/hero/lesson.mp3')
assert.ok(statSync(mp3).size > 200_000)
const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp3], { encoding: 'utf8' }))
assert.ok(Math.abs(duration - capture.duration) < 0.1, 'audio-only download is extracted from the same recording')
const beforeSpeech = execFileSync('ffmpeg', ['-v', 'error', '-i', mp3, '-t', String(capture.audio[0].startSeconds - 0.05), '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1'])
for (let offset = 0; offset + 4 <= beforeSpeech.length; offset += 4) {
  assert.ok(Math.abs(beforeSpeech.readFloatLE(offset)) < 0.0001, 'speech must not precede its observed native start')
}
const recorder = read('scripts/record-hero-lesson.mjs')
assert.match(recorder, /Page.startScreencast/)
assert.match(recorder, /__savePlayedAudio/)
assert.doesNotMatch(recorder, /lessonAsset|record\.html|reviewLandingLesson|runLecture|generateLandingVoice/, 'record the real app rather than rebuild a lecture')
const encoder = read('scripts/encode-hero-video.mjs')
assert.doesNotMatch(encoder, /requestTts|generateLandingVoice|lessonAsset/)
assert.match(read('src/components/hero-lesson/useHeroVideo.ts'), /video\.play/)
console.log(`verify-hero-voice: ${spoken.length} original clips from the actual tutor; native playback rate and complete speech preserved`)
