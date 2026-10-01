import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const asset = JSON.parse(read('src/components/hero-lesson/lessonAsset.json'))
assert.equal(asset.tier, 'exact_verified')
assert.match(asset.question, /30 cm.*convex lens.*10 cm/)
const imageDistance = 1 / (1 / 10 - 1 / 30)
const signedHeight = (-imageDistance / 30) * 3
assert.ok(Math.abs(imageDistance - 15) < 1e-10)
assert.ok(Math.abs(signedHeight + 1.5) < 1e-10)
const commands = asset.segments.flatMap((segment: { commands: { type: string; text?: string; narrationBefore: string }[] }) => segment.commands ?? [])
const rows = commands.filter((command: { type: string }) => command.type === 'WRITE').map((command: { text: string }) => command.text)
assert.ok(rows.includes('v = 15 cm'))
assert.ok(rows.includes('m = -15/30 = -1/2'))
assert.ok(rows.includes('h_i = -1.5 cm'))
for (const command of commands) assert.equal(typeof command.narrationBefore, 'string', 'every command must carry its spoken anchor')
const objectAndImage = asset.diagram.commands.filter((command: { type: string }) => command.type === 'ARROW')
assert.equal(objectAndImage.length, 2)
const [object, image] = objectAndImage.map((command: { params: number[] }) => command.params)
assert.ok(object[3] < object[1], 'the object is upright')
assert.ok(image[3] > image[1], 'the real image is inverted')
assert.ok(Math.abs((image[3] - image[1]) / (object[3] - object[1]) + 0.5) < 1e-8, 'verified geometry must agree with magnification')
assert.match(read('src/components/hero-lesson/heroLessonPlayer.ts'), /drawSegmentInk/, 'use the current tutor sync conductor')
assert.match(read('src/components/hero-lesson/useHeroInk.ts'), /useCommandExecution/, 'use the current tutor command executor')
assert.doesNotMatch(read('src/components/hero-lesson/LiveLessonBoard.tsx'), /ResponseBubble|Narration bubble/)
const showcase = read('src/components/lesson-showcase/LiveLessonWindow.tsx')
assert.match(showcase, /lesson-loop\.mp4/)
assert.match(showcase, /playsInline/)
assert.match(showcase, /muted=\{sound !== 'on'\}/)
assert.match(read('src/components/LessonShowcase.tsx'), /lazy\(\(\) => import\('\.\/lesson-showcase\/LiveLessonWindow'\)\)/, 'retain the lazy-loaded window on main')
assert.doesNotMatch(read('src/components/lesson-showcase/SafariChrome.tsx'), /hero-lesson\/lessonScript/, 'the initial browser frame must not load the recording renderer or its full lesson asset')
const mp4 = readFileSync(resolve(root, 'public/hero/lesson-loop.mp4'))
function boxes(start: number, end: number) {
  const result: { type: string; start: number; end: number }[] = []
  for (let offset = start; offset + 8 <= end;) {
    const size = mp4.readUInt32BE(offset)
    assert.ok(size >= 8 && offset + size <= end, 'valid MP4 container')
    result.push({ type: mp4.toString('ascii', offset + 4, offset + 8), start: offset + 8, end: offset + size })
    offset += size
  }
  return result
}
const moov = boxes(0, mp4.length).find((box) => box.type === 'moov')!
assert.ok(moov, 'fast-start video must have movie metadata')
const tracks = boxes(moov.start, moov.end).filter((box) => box.type === 'trak')
let hasVideo = false, hasAudio = false
for (const track of tracks) {
  const children = boxes(track.start, track.end)
  const mdia = children.find((box) => box.type === 'mdia')!
  const hdlr = boxes(mdia.start, mdia.end).find((box) => box.type === 'hdlr')!
  const kind = mp4.toString('ascii', hdlr.start + 8, hdlr.start + 12)
  if (kind === 'vide') {
    hasVideo = true
    const tkhd = children.find((box) => box.type === 'tkhd')!
    assert.equal(mp4.readUInt32BE(tkhd.end - 8) / 65536, 1600)
    assert.equal(mp4.readUInt32BE(tkhd.end - 4) / 65536, 952)
  }
  if (kind === 'soun') hasAudio = true
}
assert.ok(hasVideo && hasAudio, 'the recording must contain both the desktop picture and speech')
assert.ok(mp4.includes(Buffer.from('avc1')), 'widely supported H.264 video')
const metadata = JSON.parse(read('src/components/hero-lesson/lessonMetadata.json'))
assert.equal(createHash('sha256').update(mp4).digest('hex').slice(0, 12), metadata.version, 'the landing must reference the newly exported video')
assert.equal(metadata.title, asset.title)
assert.ok(metadata.duration > 100 && metadata.duration < 180)
console.log('verify-hero-lesson: correct lens calculations, verified ray geometry, current renderer, desktop video with audio')
