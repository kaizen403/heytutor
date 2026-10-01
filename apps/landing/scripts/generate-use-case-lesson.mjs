/** Bake verified geometry and the product's handwriting into a small demo asset.
 * The scene engine stays out of the marketing site's browser bundle.
 * Run after building the workspace packages: pnpm gen:use-case-lesson.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { synthesizeFamilyScene } from '@heytutor/scene-engine'
import {
  textToStrokePaths,
  measureTextWidth,
  BOARD_TYPE_SCALE,
} from '@heytutor/drawing'
import {
  instrumentPalette,
  instrumentShapes,
  instrumentInkStyle,
} from '../../../packages/whiteboard/src/instruments.ts'

const question =
  'Three 12 ohm resistors in series and in parallel. Find both equivalent resistances and draw each circuit.'
const scene = synthesizeFamilyScene({ question })
assert(
  scene?.validationReport.valid,
  'The demo must have an independently verified scene',
)
assert.equal(scene.family, 'circuit_network')

async function lettering(text, x, y, size) {
  const characters = await textToStrokePaths(text, x, y, size)
  return characters.flatMap((character) =>
    character.strokes.map((stroke) => stroke.pathData),
  )
}

const diagram = await Promise.all(
  scene.renderScene.primitives.map(async (primitive) => {
    assert(
      ['polyline', 'line', 'label'].includes(primitive.kind),
      `Unsupported demo primitive: ${primitive.kind}`,
    )
    if (primitive.kind === 'label') {
      const bounds = primitive.provenance?.labelBounds
      assert(bounds, 'Use the compiler’s label layout')
      return {
        id: primitive.id,
        group: primitive.groupId,
        label: true,
        paths: await lettering(primitive.text, bounds.x, bounds.y, 24),
      }
    }
    return {
      id: primitive.id,
      group: primitive.groupId,
      label: false,
      paths: [
        primitive.points
          .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
          .join(' '),
      ],
    }
  }),
)

const resistance = 12
const count = 3
const series = resistance * count
const parallel = 1 / (count / resistance)
const size = BOARD_TYPE_SCALE.workNarrow
const rows = [
  ['Given: 3 × 12 Ω', 90, 70, size],
  ['Series', 90, 155, size],
  ['R_s = 12 + 12 + 12', 90, 215, size],
  [`R_s = ${series} Ω`, 90, 275, size],
  ['Parallel', 90, 355, size],
  ['1/R_p = 3/12', 90, 415, size],
  [`R_p = ${parallel} Ω`, 90, 475, size],
]
const work = await Promise.all(
  rows.map(async ([text, x, y, size]) => {
    assert(
      x + measureTextWidth(text, size) < 400,
      'Working must stay in the work area',
    )
    return {
      text,
      x,
      y,
      width: measureTextWidth(text, size),
      size,
      paths: await lettering(text, x, y, size),
    }
  }),
)
const answer = await Promise.all(
  [[`R_p = R/3 = ${parallel} Ω`, 90, 565, size]].map(
    async ([text, x, y, size]) => ({
      text,
      paths: await lettering(text, x, y, size),
    }),
  ),
)

const asset = {
  question,
  title: 'Series & parallel resistors',
  tier: scene.tier,
  engineVersion: scene.renderScene.engineVersion,
  pencilInk: instrumentInkStyle('pencil', '#1B2A4A'),
  pen: {
    shapes: instrumentShapes('pen'),
    palette: instrumentPalette('pen', '#1B2A4A'),
  },
  pencil: {
    shapes: instrumentShapes('pencil'),
    palette: instrumentPalette('pencil', '#1B2A4A'),
  },
  highlighter: {
    shapes: instrumentShapes('highlighter'),
    palette: instrumentPalette('highlighter', '#4A9EFF'),
  },
  diagram,
  work,
  answer,
}

// The preview is scoped to the shipping tutor palette, not the landing palette.
const css = readFileSync(
  new URL('../../tutor/app/globals.css', import.meta.url),
  'utf8',
)
const names = [
  'ink-950',
  'ink-900',
  'ink-850',
  'ink-800',
  'ink-750',
  'ink-700',
  'ink-600',
  'ink-500',
  'frost',
  'sky-500',
  'sky-400',
  'sky-300',
  'stroke',
  'stroke-strong',
  'text-soft',
  'text-faint',
  'wb-paper',
  'wb-paper-muted',
  'board-ink',
  'wb-accent-soft',
]
asset.theme = Object.fromEntries(
  names.map((name) => {
    const value = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]
    assert(value, `Missing production token: ${name}`)
    return [`--${name}`, value.trim()]
  }),
)
const markingSource = readFileSync(
  new URL(
    '../../tutor/features/tutor-session/lib/board/boardMarking.ts',
    import.meta.url,
  ),
  'utf8',
)
const followUpSource = readFileSync(
  new URL(
    '../../tutor/features/tutor-session/lib/turn/lessonFollowUp.ts',
    import.meta.url,
  ),
  'utf8',
)
asset.copy = Object.fromEntries(
  [
    ['MARK_MODE_HINT', markingSource],
    ['MARK_MODE_EMPTY_HINT', markingSource],
    ['MARK_SUBMIT_LABEL', markingSource],
    ['PAUSED_LECTURE_TITLE', followUpSource],
    ['PAUSED_LECTURE_BODY', followUpSource],
    ['PAUSED_LECTURE_CONTINUE_LABEL', followUpSource],
    ['PAUSED_LECTURE_ANOTHER_DOUBT_LABEL', followUpSource],
    ['PAUSED_LECTURE_PLACEHOLDER', followUpSource],
  ].map(([name, source]) => {
    const value = source.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`))?.[1]
    assert(value, `Missing production copy: ${name}`)
    return [name, value]
  }),
)
const output = new URL(
  '../src/components/use-cases/lessonAsset.json',
  import.meta.url,
)
const content = `${JSON.stringify(asset)}\n`
if (process.argv.includes('--check')) {
  assert.equal(
    readFileSync(output, 'utf8'),
    content,
    'The demo asset is stale. Run pnpm gen:use-case-lesson after building the packages.',
  )
  console.log(
    'Use-case geometry and handwriting match the current scene engine',
  )
} else {
  writeFileSync(output, content)
  console.log(
    `Generated ${diagram.length} verified primitives and ${work.length} work rows`,
  )
}
