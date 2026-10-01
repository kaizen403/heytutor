import assert from 'node:assert/strict'
import {
  demoCamera,
  LAPTOP,
} from '../../src/components/use-cases/demoCamera.ts'
import { readFileSync } from 'node:fs'
import { DEMO_DOUBT } from '../../src/components/use-cases/demoCopy.ts'
import {
  DEMO_DURATION,
  demoFrame,
  type BeatId,
} from '../../src/components/use-cases/demoTimeline.ts'

// A marked doubt must show the actual student journey, keeping the lecture
// available while the explanation is appended below it.
for (const beat of ['ask', 'replay'] as const) {
  let previous = demoFrame(beat, 0)
  for (let t = 0.01; t <= DEMO_DURATION[beat]; t += 0.01) {
    const frame = demoFrame(beat, t)
    const drawing = frame.diagram > previous.diagram + 0.00001
    const writing = frame.work > previous.work + 0.00001
    assert.ok(
      !(drawing && writing),
      `${beat}: the figure and working must never draw at the same time (${t})`,
    )
    previous = frame
  }
}
assert.equal(demoFrame('ask', 7.2).diagram, 1, 'Finish the figure first')
assert.equal(demoFrame('ask', 7.2).work, 0, 'Wait before starting the working')
assert.ok(demoFrame('ask', 8).work > 0, 'Then write the solution')

assert.equal(
  demoFrame('doubt', 2.7).pressed,
  true,
  'First show the Ask Doubt click',
)
assert.equal(
  demoFrame('doubt', 6).input,
  DEMO_DOUBT,
  'The student types a complete question',
)
assert.equal(demoFrame('doubt', 6).circle, 0, 'Typing precedes the circle')
assert.ok(
  demoFrame('doubt', 8.8).circle > 0 && demoFrame('doubt', 8.8).circle < 1,
  'The gesture is visibly drawn',
)
assert.equal(
  demoFrame('doubt', 10).circle,
  1,
  'The mark is recognised before submission',
)
assert.equal(
  demoFrame('doubt', 10).answer,
  0,
  'Do not answer before the doubt is submitted',
)
assert.equal(
  demoFrame('doubt', 12.6).pressed,
  true,
  'Show Explain this being pressed',
)
assert.equal(
  demoFrame('doubt', 14).thinking,
  true,
  'Think beside the existing board',
)
assert.equal(
  demoFrame('doubt', 18).answer,
  1,
  'The full explanation must be visible',
)
assert.equal(
  demoFrame('doubt', 21).continued,
  true,
  'Offer to continue after answering',
)

for (let t = 0; t <= DEMO_DURATION.doubt; t += 0.1) {
  const frame = demoFrame('doubt', t)
  const camera = demoCamera('doubt', t)
  assert.ok(camera.scale >= 1 && camera.scale <= 1.8)
  assert.ok(camera.x <= 0 && camera.y <= 0)
  assert.ok(camera.x + LAPTOP.width * camera.scale >= LAPTOP.width - 0.001)
  assert.ok(camera.y + LAPTOP.height * camera.scale >= LAPTOP.height - 0.001)
  assert.equal(
    frame.work,
    7,
    'A doubt must retain the original working throughout',
  )
  assert.equal(
    frame.diagram,
    1,
    'A doubt must retain the original verified figure throughout',
  )
}

for (const beat of Object.keys(DEMO_DURATION) as BeatId[]) {
  const final = demoFrame(beat, DEMO_DURATION[beat])
  assert.equal(final.step, 3, 'Reduced-motion users see the completed outcome')
  assert.equal(final.progress, 1)
  assert.equal(final.work, 7)
  assert.equal(final.diagram, 1)
  assert.equal(demoFrame(beat, -1).progress, 0)
  assert.equal(demoFrame(beat, 1000).progress, 1)
}

const asset = JSON.parse(
  readFileSync(
    new URL('../../src/components/use-cases/lessonAsset.json', import.meta.url),
    'utf8',
  ),
)
assert.ok(
  asset.diagram.some(
    (primitive: { group: string }) => primitive.group === 'series_group',
  ),
)
assert.ok(
  asset.diagram.some(
    (primitive: { group: string }) => primitive.group === 'parallel_group',
  ),
)
assert.ok(asset.work.some((row: { text: string }) => row.text === 'R_s = 36 Ω'))
assert.ok(asset.work.some((row: { text: string }) => row.text === 'R_p = 4 Ω'))
assert.equal(asset.answer.length, 1, 'A doubt gets one concise work row')
assert.equal(demoCamera('doubt', 0).scale, 1, 'Start on the full laptop view')
assert.equal(
  demoCamera('doubt', 24).scale,
  1,
  'End with the board and composer in context',
)
assert.ok(
  demoCamera('doubt', 2.8).scale > 1,
  'Focus on Ask Doubt before the click',
)
assert.ok(
  demoCamera('doubt', 8.8).x > demoCamera('doubt', 2.8).x,
  'Pan from the composer to the marked working',
)
console.log(
  'verify-use-case-demo: click → question → circle → same-board answer → continue; all demos complete',
)
