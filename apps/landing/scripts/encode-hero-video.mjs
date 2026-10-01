/** Encode the timestamped production-renderer capture, muxing the current voice. */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const frames = process.argv[2]
if (!frames) throw new Error('Usage: node scripts/encode-hero-video.mjs /path/to/capture')
const capture = JSON.parse(readFileSync(resolve(frames, 'capture.json'), 'utf8'))
const asset = JSON.parse(readFileSync(resolve(root, 'src/components/hero-lesson/lessonAsset.json'), 'utf8'))
const mp4 = resolve(root, 'public/hero/lesson-loop.mp4')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', resolve(frames, 'frames.txt'), '-i', resolve(root, 'public/hero/lesson.mp3'),
  '-filter_complex', `[0:v]fps=30,crop=1600:952[v];[1:a]adelay=${capture.audioOffsetMs}:all=1,apad[a]`,
  '-map', '[v]', '-map', '[a]', '-t', String(capture.duration), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4])
// Keep the existing downloadable formats current as well.
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-c:v', 'libvpx-vp9', '-crf', '25', '-b:v', '0', '-row-mt', '1', '-cpu-used', '4', '-threads', '6', '-c:a', 'libopus', '-b:a', '96k', resolve(root, 'public/hero/lesson-loop.webm')])
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(capture.duration - 4), '-i', mp4, '-frames:v', '1', '-q:v', '2', resolve(root, 'public/hero/lesson-poster.jpg')])
const version = createHash('sha256').update(readFileSync(mp4)).digest('hex').slice(0, 12)
writeFileSync(resolve(root, 'src/components/hero-lesson/lessonMetadata.json'), JSON.stringify({
  title: asset.title, question: asset.question, version,
  duration: capture.duration, audioOffsetSeconds: capture.audioOffsetMs / 1000,
  sceneTier: asset.tier, sourceCommit: asset.sourceCommit,
}, null, 2) + '\n')
console.log(`Saved ${capture.duration.toFixed(1)}s desktop video; version ${version}.`)
