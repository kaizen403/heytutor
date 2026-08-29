/**
 * Recorder for the hero lesson video (public/hero/lesson-loop.{webm,mp4} + poster).
 *
 * /record.html runs the dashboard mockup on an endless loop whose period is
 * fixed by lessonScript.ts — typing + submit + spoken total + hold + clear. We
 * capture exactly one period starting at the seam, so the clip cuts where it
 * repeats and the narration in public/hero/lesson.mp3 lands on the same frame
 * every time round.
 *
 * Frames are stepped with CDP virtual time rather than the wall clock: rAF,
 * timers, CSS animations and performance.now() all advance by exactly one frame
 * per step, so a busy machine yields the same frames as an idle one and nothing
 * is dropped or doubled. Two things about virtual time are load-bearing:
 *
 *  - a frame is only produced when something asks for the surface, so each step
 *    is paired with a screenshot (a tiny one while seeking, the real one while
 *    capturing). Without it Chromium coalesces a whole budget into a couple of
 *    rAF ticks and the page barely advances.
 *  - the timestamp handed to a rAF callback advances per composited frame, not
 *    by the granted budget, so it slips ~12% behind performance.now() over a
 *    30s capture. See the shim below.
 *
 *   node scripts/record-hero-lesson.mjs \
 *     --url http://localhost:4319/record.html --out ./frames \
 *     --chromium "/path/to/Chromium" [--playwright <node_modules dir>]
 *
 * Then encode (fps and the audio offset both come from the constants below):
 *   ffmpeg -framerate 25 -i frame-%05d.png -i public/hero/lesson.mp3 \
 *     -filter_complex "[1:a]atempo=1.25,adelay=2708:all=1,apad[a]" -map 0:v -map "[a]" \
 *     -c:v libx264 -pix_fmt yuv420p -crf 23 -shortest -movflags +faststart lesson-loop.mp4
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((v, i, arr) => (v.startsWith('--') ? [[v.slice(2), arr[i + 1]]] : [])),
)

const URL_ = args.url ?? 'http://localhost:4319/record.html'
const OUT = args.out ?? './hero-frames'
const WIDTH = 1600
const HEIGHT = 953
const FPS = 25
const FRAME_MS = 1000 / FPS

/* ── The loop period, mirrored from lessonScript.ts ─────────────────────── */
const QUESTION_CHARS = 82 // [...QUESTION_TEXT].length
const TYPING_CHARS_PER_SECOND = 38
const SUBMIT_PAUSE = 0.55
const HOLD_DURATION = 3.0
const CLEAR_DURATION = 1.2
const PLAYBACK_SPEED = 1.25
/** Seconds of loop before the voice becomes audible — the audio's mux offset. */
const TEACH_START = QUESTION_CHARS / TYPING_CHARS_PER_SECOND + SUBMIT_PAUSE

async function loadChromium() {
  const require_ = createRequire(pathToFileURL(`${process.cwd()}/`))
  for (const c of [args.playwright && `${args.playwright}/playwright-core`, 'playwright-core'].filter(Boolean)) {
    try {
      const m = await import(pathToFileURL(require_.resolve(c)).href)
      const chromium = m.chromium ?? m.default?.chromium
      if (chromium) return chromium
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('playwright-core not found — pass --playwright <node_modules dir>')
}

const main = async () => {
  const chromium = await loadChromium()
  const rawTotal = Number(args.total ?? 31.719) // lesson-timings.json → .total
  const loopMs = (TEACH_START + rawTotal / PLAYBACK_SPEED + HOLD_DURATION + CLEAR_DURATION) * 1000
  const frames = Number(args.frames ?? Math.floor(loopMs / FRAME_MS))

  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({
    executablePath: args.chromium || undefined,
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--disable-new-content-rendering-timeout'],
  })
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  const cdp = await page.context().newCDPSession(page)

  let waiter = null
  cdp.on('Emulation.virtualTimeBudgetExpired', () => {
    const w = waiter
    waiter = null
    w?.()
  })
  const step = (ms) =>
    new Promise((resolve) => {
      waiter = resolve
      cdp
        .send('Emulation.setVirtualTimePolicy', {
          policy: 'pauseIfNetworkFetchesPending',
          budget: ms,
          maxVirtualTimeTaskStarvationCount: 100000,
        })
        .catch(resolve)
    })

  /** Force a composited frame. 8×8 is enough while seeking and far cheaper. */
  const pump = () => page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 8, height: 8 } })
  const capture = (file) =>
    page
      .screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
      .then((buf) => writeFileSync(file, buf))

  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })

  // useLessonSimulation dates the chrome from the rAF timestamp while
  // heroLessonPlayer reads performance.now() directly. Under virtual time those
  // two clocks diverge, and the board ends up racing the captions and erasing
  // the answer seconds early. Hand rAF the real virtual clock so they agree.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()))
  })

  page.on('pageerror', (e) => console.error('page error:', String(e).slice(0, 300)))
  await page.goto(URL_, { waitUntil: 'commit' })

  // Wait for the Konva stage and the webfonts. The simulation re-anchors its
  // clock the moment the board handle exists, so seek only after that.
  for (let i = 0; i < 200 && (await page.locator('canvas').count()) === 0; i++) await step(100)
  await page.evaluate(() => document.fonts.ready)
  // Pumped, not one blind grant: the board handle now exists, so the player is
  // already running and must keep getting frames (see the seam note below).
  for (let i = 0; i < 25; i++) {
    await pump()
    await step(FRAME_MS)
  }

  /* ── Align to the loop seam ───────────────────────────────────────────────
     typedCount is the only value in the loop that steps 0 → 1: it does so 1/38 s
     after the top and nowhere else (submit drops 82 → 0 in one go). So the first
     character to appear dates the seam.

     Seeking pumps a frame every 40ms exactly as capturing does. Granting a large
     budget in one go instead would advance the page incoherently: setTimeout is
     fully virtualised, so heroLessonPlayer's polling loop would sprint through
     its gates, while the board animations it awaits — which need composited
     frames — would stall. The player comes out of a blind jump seconds out of
     phase with the captions. */
  const typedLen = () =>
    page.evaluate(() => {
      const t = document.querySelector('.mockup-input')?.textContent ?? ''
      return t.startsWith('Ask a question') ? 0 : t.length
    })

  const seekUntil = async (predicate, limitMs) => {
    for (let waited = 0; waited < limitMs; waited += FRAME_MS) {
      if (await predicate()) return true
      await pump()
      await step(FRAME_MS)
    }
    return false
  }

  if (!(await seekUntil(async () => (await typedLen()) === 0, 2 * loopMs)))
    throw new Error('the input never cleared — is the mockup running?')
  if (!(await seekUntil(async () => (await typedLen()) > 0, 2 * loopMs)))
    throw new Error('never saw the loop restart')

  // n characters showing ⇒ we are (n + ½)/38 s past the top of the loop. Capture
  // starts here rather than riding round to a cleaner seam: every extra lap puts
  // the board further out of phase with the chrome, and this is under a frame.
  const n = await typedLen()
  const intoLoopMs = ((n + 0.5) / TYPING_CHARS_PER_SECOND) * 1000
  const adelayMs = Math.round(TEACH_START * 1000 - intoLoopMs)
  console.log(`seam: ${n} char(s) typed, ${intoLoopMs.toFixed(1)}ms in; loop ${loopMs.toFixed(1)}ms`)

  console.log(`capturing ${frames} frames at ${FPS}fps → ${OUT}`)
  for (let i = 0; i < frames; i++) {
    await capture(`${OUT}/frame-${String(i + 1).padStart(5, '0')}.png`)
    if (i % 200 === 0) console.log(`  ${i + 1}/${frames}`)
    await step(FRAME_MS)
  }

  await browser.close()
  console.log(`done — mux the voice with atempo=${PLAYBACK_SPEED}, adelay=${adelayMs}ms`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
