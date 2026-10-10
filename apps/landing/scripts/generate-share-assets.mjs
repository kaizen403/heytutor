/** Derive share previews from the latest native tutor recording, keeping the whole UI visible. */
import { copyFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE } from '../src/lib/seo.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tutorPublic = resolve(root, '../tutor/public')
const source = resolve(root, 'public/hero/lesson-loop.mp4')
const capture = JSON.parse(readFileSync(resolve(root, 'src/components/hero-lesson/lessonCapture.json'), 'utf8'))
if (capture.kind !== 'native-tutor-session') throw new Error('Share previews must use a native tutor recording')

const probe = (file) => JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file,
], { encoding: 'utf8' }))

const start = 135
const duration = 40
const still = 183
if (Number(probe(source).format.duration) <= Math.max(start + duration, still)) {
  throw new Error('Update the selected preview times for the new recording')
}

const image = resolve(root, 'public', basename(SITE.ogImage))
const video = resolve(root, 'public', basename(SITE.ogVideo))
const fit = `scale=${SITE.previewWidth}:${SITE.previewHeight}:force_original_aspect_ratio=decrease,pad=${SITE.previewWidth}:${SITE.previewHeight}:(ow-iw)/2:(oh-ih)/2:color=0x131312`
const encode = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })

encode(['-ss', String(still), '-i', source, '-vf', fit, '-frames:v', '1', '-update', '1', image])
encode([
  '-ss', String(start), '-i', source, '-t', String(duration), '-an', '-vf', `${fit},fps=25`,
  '-c:v', 'libx264', '-profile:v', 'baseline', '-level:v', '3.1', '-preset', 'slow',
  '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video,
])

const output = probe(video)
const stream = output.streams.find((entry) => entry.codec_name === 'h264')
if (output.streams.length !== 1 || stream?.width !== SITE.previewWidth || stream?.height !== SITE.previewHeight) {
  throw new Error('Expected a muted H.264 preview at the declared metadata dimensions')
}

// Keep old, already-shared asset URLs useful when a service retains old HTML.
copyFileSync(image, resolve(root, 'public/og-image.png'))
copyFileSync(image, resolve(root, 'public/og-card.png'))
copyFileSync(video, resolve(root, 'public/preview.mp4'))
copyFileSync(image, resolve(tutorPublic, basename(image)))
copyFileSync(video, resolve(tutorPublic, basename(video)))
console.log(`Share assets: ${SITE.previewWidth}×${SITE.previewHeight}; ${duration}s; native recording ${capture.recordedAt} (${capture.sourceCommit.slice(0, 12)})`)
