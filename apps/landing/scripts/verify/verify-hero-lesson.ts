import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseStoredSegmentCommands } from '@heytutor/drawing'
const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const capture = JSON.parse(read('src/components/hero-lesson/lessonCapture.json'))
assert.equal(capture.kind, 'native-tutor-session')
assert.equal(capture.question, 'A pyramid has a square base of side 6 cm and a perpendicular height of 4 cm. Find its volume and total surface area.')
assert.equal(capture.turn.question, capture.question)
assert.equal(capture.turn.validationReport.valid, true)
assert.equal(capture.turn.sceneArtifacts.representationTier, 'qualitative_verified')
const commands = capture.turn.segments.flatMap((segment: { command: unknown }) => parseStoredSegmentCommands(segment.command))
const rows = commands.filter((command) => command.type === 'WRITE').map((command) => command.text)
const side = 6, height = 4
const slantHeight = Math.hypot(height, side / 2)
const volume = side ** 2 * height / 3
const surfaceArea = side ** 2 + 4 * side * slantHeight / 2
assert.ok(rows.some((row) => /^V\b/i.test(row) && row.includes(`${volume} cm^3`)))
assert.ok(rows.some((row) => /^l\b/i.test(row) && row.includes(`${slantHeight} cm`)))
const surfaceRowIndex = rows.findIndex((row) => /\bTSA\b/i.test(row) && row.includes(`${surfaceArea} cm^2`))
assert.ok(surfaceRowIndex >= 0)
assert.match([rows[surfaceRowIndex - 1] ?? '', rows[surfaceRowIndex]].join(' '), /assum|right.*pyramid|apex.*cent(?:er|re)/i, 'the surface-area answer must retain its condition in the saved notes')
const edges = commands.filter((command) => command.type === 'DRAW_LINE' && command.semanticRef?.entityId === 'pyramid')
assert.equal(edges.length, 5, 'one closed square base and four edges to the apex')
const base = edges[0].params
assert.equal(base.length, 10)
assert.deepEqual(base.slice(0, 2), base.slice(-2))
assert.equal(new Set([0, 2, 4, 6].map((index) => base.slice(index, index + 2).join(','))).size, 4)
for (const edge of edges.slice(1)) assert.deepEqual(edge.params.slice(-2), edges[1].params.slice(-2))
const intro = capture.turn.segments.find((segment: { command: unknown }) => parseStoredSegmentCommands(segment.command).some((command) => command.type === 'DRAW_LINE' && command.semanticRef?.entityId === 'pyramid'))
const labels = parseStoredSegmentCommands(intro.command).filter((command) => command.type === 'LABEL').map((command) => command.text)
assert.ok(labels.includes('s = 6 cm'), 'native introduction labels the base side')
assert.ok(labels.includes('h = 4 cm'), 'native introduction labels the perpendicular height')
const speech = capture.turn.segments.map((segment: { narration: string }) => segment.narration.toLowerCase())
const assumptionIndex = speech.findIndex((text: string) => /assum|treat.*as/.test(text) && /right.*pyramid|apex.*cent(?:er|re)/.test(text))
const slantIndex = speech.findIndex((text: string) => /slant height.*hypotenuse|l equals.*square root|l squared equals/.test(text))
assert.ok(assumptionIndex >= 0 && assumptionIndex < slantIndex, 'state the centred-apex assumption before using it')
assert.ok(speech.some((text: string) => /not.*(?:determin|enough|specif|fixed)|cannot.*determin|need.*(?:apex|condition)|depend.*apex/.test(text)), 'explain that the givens alone do not determine surface area')
const surfaceAnswer = speech.find((text: string) => /(?:ninety six|ninety-six|96).*square cent(?:imeters|imetres)/.test(text))
assert.match(surfaceAnswer ?? '', /under.*assumption|assum|for.*right.*pyramid|if.*apex|with.*apex/, 'qualify surface area in the actual spoken answer')
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
const frameRate = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'default=nw=1:nk=1', resolve(root, 'public/hero/lesson-loop.mp4')], { encoding: 'utf8' }).trim()
assert.equal(frameRate, '60/1', 'preserve the pen movement in a 60 fps delivery file')
const metadata = JSON.parse(read('src/components/hero-lesson/lessonMetadata.json'))
assert.equal(createHash('sha256').update(mp4).digest('hex').slice(0, 12), metadata.version, 'the landing must reference the newly exported video')
assert.equal(metadata.title, capture.title)
assert.equal(metadata.sceneTier, capture.turn.sceneArtifacts.representationTier)
assert.equal(metadata.recordingKind, capture.kind)
assert.equal(metadata.turnId, capture.turn.id)
assert.equal(metadata.sourceCommit, capture.sourceCommit)
assert.equal(createHash('sha256').update(mp4).digest('hex'), capture.videoSha256)
assert.equal(metadata.duration, capture.duration)
assert.ok(metadata.duration > 60 && metadata.duration < 600, 'retain the actual complete lecture length')
console.log('verify-hero-lesson: actual tutor session, native intro labels, correct results, desktop video with original audio and no subtitles')
