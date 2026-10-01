/** Package actual tutor frames with the audio it played, on their shared wall clock. */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const frames = process.argv[2]
if (!frames) throw new Error('Usage: node scripts/encode-hero-video.mjs /path/to/native-capture')
const capture = JSON.parse(readFileSync(resolve(frames, 'capture.json'), 'utf8'))
if (capture.kind !== 'native-tutor-session') throw new Error('The landing requires a recording of the actual tutor')
const played = capture.audio.flatMap((audio) => {
  const start = audio.events.find((event) => event.type === 'playing')
  const end = audio.events.find((event) => event.type === 'ended')
  if (!start || !end) throw new Error(`Speech clip ${audio.id} did not play completely`)
  const duringPlayback = audio.events.filter((event) => event.epoch >= start.epoch && event.epoch <= end.epoch)
  if (start.muted || duringPlayback.some((event) => event.type === 'error' || event.rate !== start.rate)) throw new Error('The captured speech must be audible and uninterrupted at its native rate')
  if (end.epoch - start.epoch < 0.1) return []
  const bytes = readFileSync(resolve(frames, audio.file))
  if (createHash('sha256').update(bytes).digest('hex') !== audio.sha256) throw new Error('The played speech bytes changed')
  return [{ ...audio, start, end }]
})
if (played.length === 0) throw new Error('No native tutor speech was recorded')
// Remove blank model preparation only. Keep every spoken/ink beat and all
// pauses within the actual lecture, with one second of the real board first.
const trimStart = Math.max(0, played[0].start.epoch - capture.startEpoch - 1)
const duration = capture.duration - trimStart
const mp4 = resolve(root, 'public/hero/lesson-loop.mp4')
const inputs = played.flatMap((audio) => ['-i', resolve(frames, audio.file)])
const audioFilters = played.map((audio, index) => {
  const delay = Math.round((audio.start.epoch - capture.startEpoch - trimStart) * 1000)
  // The measured playbackRate is the live app's rate. It is not an editorial
  // speed-up: reproduce exactly what its native HTML audio played.
  const heard = Math.max(0, audio.end.mediaTime - audio.start.mediaTime)
  return `[${index}:a]atrim=start=${audio.start.mediaTime}:duration=${heard},asetpts=PTS-STARTPTS,atempo=${audio.start.rate},adelay=${delay}:all=1[a${index}]`
})
// Seed the mix with a full, zero-based silent timeline. Audio's origin must
// stay independent of trimming the preceding model preparation from video.
const silence = `anullsrc=r=48000:cl=mono:d=${duration}[silence]`
const mix = `[silence]${played.map((_, index) => `[a${index}]`).join('')}amix=inputs=${played.length + 1}:duration=first:normalize=0:dropout_transition=0[a]`
const recordedAudio = resolve(frames, 'native-speech.wav')
execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', [...audioFilters, silence, mix].join(';'), '-map', '[a]', '-c:a', 'pcm_s16le', recordedAudio])
const video = `[0:v]trim=start=${trimStart}:duration=${duration},setpts=PTS-STARTPTS,fps=30[v]`
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', resolve(frames, 'frames.txt'), '-i', recordedAudio,
  '-filter_complex', video, '-map', '[v]', '-map', '1:a', '-t', String(duration),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4])
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-c:v', 'libvpx-vp9', '-crf', '25', '-b:v', '0', '-row-mt', '1', '-cpu-used', '4', '-threads', '6', '-c:a', 'libopus', '-b:a', '96k', resolve(root, 'public/hero/lesson-loop.webm')])
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(duration - 3), '-i', mp4, '-frames:v', '1', '-q:v', '2', resolve(root, 'public/hero/lesson-poster.jpg')])
// Retain an audio-only download made from the recording, never a new TTS take.
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', resolve(root, 'public/hero/lesson.mp3')])
const version = createHash('sha256').update(readFileSync(mp4)).digest('hex').slice(0, 12)
const provenance = { ...capture, startEpoch: undefined, audio: played.map(({ id, sha256, start, end }) => ({
  id, sha256, startSeconds: start.epoch - capture.startEpoch - trimStart,
  endSeconds: end.epoch - capture.startEpoch - trimStart,
  mediaStart: start.mediaTime, mediaEnd: end.mediaTime, playbackRate: start.rate,
})), trimStartSeconds: trimStart, duration, videoSha256: createHash('sha256').update(readFileSync(mp4)).digest('hex') }
writeFileSync(resolve(root, 'src/components/hero-lesson/lessonCapture.json'), JSON.stringify(provenance, null, 2) + '\n')
writeFileSync(resolve(root, 'public/hero/lesson-timings.json'), JSON.stringify({ starts: provenance.audio.map((audio) => audio.startSeconds), total: duration, kind: capture.kind }, null, 2) + '\n')
writeFileSync(resolve(root, 'src/components/hero-lesson/lessonMetadata.json'), JSON.stringify({
  title: capture.title, question: capture.question, version, duration,
  audioOffsetSeconds: provenance.audio[0].startSeconds, sceneTier: capture.turn.sceneArtifacts.representationTier,
  sourceCommit: capture.sourceCommit, recordingKind: capture.kind, turnId: capture.turn.id,
}, null, 2) + '\n')
console.log(`Saved actual tutor recording: ${duration.toFixed(1)}s; ${played.length} original speech clips; version ${version}.`)
