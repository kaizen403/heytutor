/** Verify the live landing lesson retains its deterministic mathematical authority. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseStoredSegmentCommands } from '@heytutor/drawing'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const asset = JSON.parse(read('src/components/hero-lesson/lessonAsset.json'))
const narrations = JSON.parse(read('src/components/hero-lesson/lessonNarration.json'))

assert.equal(asset.tier, 'qualitative_verified')
assert.equal(asset.question, 'A pyramid has a square base of side 6 cm and a perpendicular height of 4 cm. Find its volume and total surface area.')
const commands = asset.segments.flatMap((segment: { command: unknown }) => parseStoredSegmentCommands(segment.command))
const rows = commands.filter((command) => command.type === 'WRITE').map((command) => command.text)
const side = 6, height = 4
const slantHeight = Math.hypot(height, side / 2)
const volume = side ** 2 * height / 3
const surfaceArea = side ** 2 + 4 * side * slantHeight / 2
assert.ok(rows.some((row) => /^V\b/i.test(row ?? '') && row?.includes(`${volume} cm^3`)))
assert.ok(rows.some((row) => /^l\b/i.test(row ?? '') && row?.includes(`${slantHeight} cm`)))
assert.ok(rows.some((row) => /\bTSA\b/i.test(row ?? '') && row?.includes(`${surfaceArea} cm^2`)))

const sceneCommands = asset.diagram.commands
const edges = sceneCommands.filter((command: { type: string; semanticRef?: { entityId?: string } }) =>
  command.type === 'DRAW_LINE' && command.semanticRef?.entityId === 'pyramid',
)
assert.equal(edges.length, 5, 'one closed square base and four edges to the apex')
const base = edges[0].params
assert.equal(base.length, 10)
assert.deepEqual(base.slice(0, 2), base.slice(-2))
assert.equal(new Set([0, 2, 4, 6].map((index) => base.slice(index, index + 2).join(','))).size, 4)
for (const edge of edges.slice(1)) assert.deepEqual(edge.params.slice(-2), edges[1].params.slice(-2))
const labels = sceneCommands.filter((command: { type: string }) => command.type === 'LABEL').map((command: { text: string }) => command.text)
assert.ok(labels.includes('s = 6 cm'))
assert.ok(labels.includes('h = 4 cm'))

for (const locale of ['en-GB', 'hi-IN']) {
  const speech = narrations[locale].map((text: string) => text.toLowerCase())
  const assumptionIndex = speech.findIndex((text: string) => /assum|assumption/.test(text) && /right square pyramid|apex/.test(text))
  const slantIndex = speech.findIndex((text: string) => /slant height/.test(text))
  assert.ok(assumptionIndex >= 0 && assumptionIndex < slantIndex, `${locale} states the centred-apex assumption before using it`)
  assert.ok(speech.some((text: string) => /ninety-six square centimetres/.test(text)), `${locale} speaks the qualified answer`)
}

const showcase = read('src/components/lesson-showcase/LiveLessonWindow.tsx')
assert.match(showcase, /DashboardMockup/)
assert.doesNotMatch(showcase, /<video|lesson-loop\.mp4/)
assert.match(read('src/components/LessonShowcase.tsx'), /lazy\(\(\) => import\('\.\/lesson-showcase\/LiveLessonWindow'\)\)/, 'retain the lazy-loaded lesson on main')
assert.match(read('src/components/hero-lesson/LiveLessonBoard.tsx'), /<Whiteboard/)
assert.match(read('src/components/hero-lesson/heroLessonPlayer.ts'), /drawSegmentInk/)

console.log('verify-hero-lesson: verified scene and exact results play through the live whiteboard renderer')
