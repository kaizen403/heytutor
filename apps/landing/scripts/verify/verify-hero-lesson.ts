import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const asset = JSON.parse(read('src/components/hero-lesson/lessonAsset.json'))
assert.equal(asset.tier, 'qualitative_verified', 'retain the actual source-bound figure tier')
assert.equal(asset.question, 'A pyramid has a square base of side 6 cm and a perpendicular height of 4 cm. Find its volume and total surface area.')
const side = 6, height = 4
const slantHeight = Math.hypot(height, side / 2)
const volume = side ** 2 * height / 3
const surfaceArea = side ** 2 + 4 * (side * slantHeight / 2)
assert.equal(slantHeight, 5)
assert.equal(volume, 48)
assert.equal(surfaceArea, 96)
const commands = asset.segments.flatMap((segment: { commands: { type: string; text?: string; narrationBefore: string }[] }) => segment.commands ?? [])
const rows = commands.filter((command: { type: string }) => command.type === 'WRITE').map((command: { text: string }) => command.text)
assert.ok(rows.includes(`V = ${volume} cm^3`))
assert.ok(rows.includes(`l = ${slantHeight} cm`))
assert.ok(rows.includes(`TSA = ${surfaceArea} cm^2`))
for (const command of commands) assert.equal(typeof command.narrationBefore, 'string', 'every command must carry its spoken anchor')
const edges = asset.diagram.commands.filter((command: { type: string; semanticRef?: { entityId: string } }) => command.type === 'DRAW_LINE' && command.semanticRef?.entityId === 'pyramid')
assert.equal(edges.length, 5, 'one closed square base and four edges to the apex')
const base = edges[0].params
assert.equal(base.length, 10)
assert.deepEqual(base.slice(0, 2), base.slice(-2), 'the base must close')
assert.equal(new Set([0, 2, 4, 6].map((i) => base.slice(i, i + 2).join(','))).size, 4)
for (const edge of edges.slice(1)) assert.deepEqual(edge.params.slice(-2), edges[1].params.slice(-2), 'all faces meet at one apex')
const labels = asset.diagram.commands.filter((command: { type: string }) => command.type === 'LABEL').map((command: { text: string }) => command.text)
assert.ok(labels.includes('s = 6 cm'))
assert.ok(labels.includes('h = 4 cm'))
const introLabels = asset.segments.filter((segment: { verifiedDiagramIntro: boolean }) => segment.verifiedDiagramIntro)
  .flatMap((segment: { commands: { type: string; text?: string }[] }) => segment.commands ?? [])
  .filter((command: { type: string }) => command.type === 'LABEL').map((command: { text: string }) => command.text)
assert.ok(introLabels.includes('s = 6 cm'), 'the base-side label must be drawn during the figure introduction')
assert.ok(introLabels.includes('h = 4 cm'), 'the perpendicular-height label must be drawn during the figure introduction')
assert.equal(asset.grade.passed, true)
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
  assert.ok(kind === 'vide' || kind === 'soun', 'the exported lesson must have no subtitle or text track')
}
assert.ok(hasVideo && hasAudio, 'the recording must contain both the desktop picture and speech')
assert.ok(mp4.includes(Buffer.from('avc1')), 'widely supported H.264 video')
const metadata = JSON.parse(read('src/components/hero-lesson/lessonMetadata.json'))
assert.equal(createHash('sha256').update(mp4).digest('hex').slice(0, 12), metadata.version, 'the landing must reference the newly exported video')
assert.equal(metadata.title, asset.title)
assert.equal(metadata.sceneTier, asset.tier)
assert.ok(metadata.duration > 100 && metadata.duration < 180)
console.log('verify-hero-lesson: square-pyramid volume and surface area, verified solid geometry, current renderer, desktop video with audio and no subtitles')
