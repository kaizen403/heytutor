/** Record the actual tutor UI and the speech it plays. No demo renderer or TTS regeneration. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const args = Object.fromEntries(process.argv.slice(2).flatMap((value, i, all) => value.startsWith('--') ? [[value.slice(2), all[i + 1]]] : []))
const url = new URL(args.url ?? 'http://127.0.0.1:3003/')
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/') throw new Error('Start at the isolated local tutor home page')
const question = 'A pyramid has a square base of side 6 cm and a perpendicular height of 4 cm. Find its volume and total surface area.'
const out = args.out ?? '/tmp/heytutor-native-hero'
const width = 1600, height = 952
const require_ = createRequire(pathToFileURL(`${process.cwd()}/`))
const module = await import(pathToFileURL(require_.resolve(args.playwright ? `${args.playwright}/playwright-core` : 'playwright-core')).href)
const chromium = module.chromium ?? module.default?.chromium
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: args.chromium || undefined, args: ['--force-device-scale-factor=1'] })
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  const audioFiles = new Map()
  await page.exposeFunction('__savePlayedAudio', (id, base64) => {
    const bytes = Buffer.from(base64, 'base64')
    const file = `audio-${String(id).padStart(3, '0')}.bin`
    writeFileSync(`${out}/${file}`, bytes)
    audioFiles.set(id, { file, sha256: createHash('sha256').update(bytes).digest('hex') })
  })
  // Passive media observation: retain native play(), its promise, all tutor
  // state, and the native speech/ink clock. No commands or text are injected.
  await page.addInitScript(() => {
    const captures = [], pending = []
    window.__nativeLectureCapture = { captures, pending }
    const observed = new WeakSet()
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...args_) {
      const source = this.currentSrc || this.src
      if (!observed.has(this) && source.startsWith('blob:')) {
        observed.add(this)
        const id = captures.length
        const record = { id, events: [] }
        captures.push(record)
        const note = (type) => record.events.push({
          type, epoch: (performance.timeOrigin + performance.now()) / 1000,
          mediaTime: this.currentTime, rate: this.playbackRate, muted: this.muted,
        })
        for (const type of ['playing', 'pause', 'ended', 'ratechange', 'error']) this.addEventListener(type, () => note(type), true)
        pending.push(fetch(source).then((response) => response.arrayBuffer()).then((buffer) => {
          const bytes = new Uint8Array(buffer)
          let binary = ''
          for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
          return window.__savePlayedAudio(id, btoa(binary))
        }))
      }
      return Reflect.apply(play, this, args_)
    }
  })
  let savedTurn, captureError
  const saves = []
  page.on('response', (response) => {
    if (response.request().method() !== 'POST' || !/\/api\/boards\/[^/]+\/turns$/.test(new URL(response.url()).pathname)) return
    saves.push(response.json().then((data) => {
      if (response.ok() && data.turn?.question === question) savedTurn = data.turn
    }).catch(() => {}))
  })
  page.on('pageerror', (error) => { captureError = error })
  await page.goto(url.href)
  const input = page.getByRole('textbox', { name: 'Question', exact: true })
  await input.waitFor({ state: 'visible', timeout: 120_000 })
  await page.evaluate(() => document.fonts.ready)
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = `frame-${String(frames.length + 1).padStart(5, '0')}.jpg`
    writeFileSync(`${out}/${file}`, Buffer.from(data, 'base64'))
    frames.push({ file, timestamp: metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 96, maxWidth: width, maxHeight: height, everyNthFrame: 2 })
  await input.pressSequentially(question, { delay: 22 })
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  const stop = page.getByRole('button', { name: 'Stop teaching', exact: true })
  await stop.waitFor({ state: 'visible', timeout: 120_000 })
  const started = Date.now()
  let lastReport = 0
  while (await stop.isVisible() || !savedTurn) {
    if (captureError) throw captureError
    const elapsed = Date.now() - started
    if (elapsed > 600_000) throw new Error('The live tutor did not finish and persist its lecture')
    if (elapsed - lastReport > 15_000) {
      console.log(`Actual tutor ${Math.round(elapsed / 1000)}s; ${frames.length} compositor frames; ${audioFiles.size} native speech clips`)
      lastReport = elapsed
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  await Promise.all(saves)
  await page.evaluate(async () => { await Promise.all(window.__nativeLectureCapture.pending) })
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const end = await page.evaluate(() => (performance.timeOrigin + performance.now()) / 1000)
  const title = await page.locator('header span[title]').last().getAttribute('title')
  const audio = await page.evaluate(() => window.__nativeLectureCapture.captures)
  await cdp.send('Page.stopScreencast')
  if (!savedTurn || frames.length < 100 || audio.length === 0) throw new Error('No complete actual lecture was captured')
  const start = frames[0].timestamp
  const concat = frames.flatMap((frame, index) => [
    `file '${frame.file}'`, `duration ${Math.max(0.001, (frames[index + 1]?.timestamp ?? end) - frame.timestamp)}`,
  ])
  concat.push(`file '${frames.at(-1).file}'`)
  writeFileSync(`${out}/frames.txt`, concat.join('\n'))
  // Omit account/trace fields and private S3 URLs from the public provenance.
  const turn = {
    id: savedTurn.id, question: savedTurn.question, rawResponse: savedTurn.rawResponse,
    speedMultiplier: savedTurn.speedMultiplier, sceneEngineVersion: savedTurn.sceneEngineVersion,
    visualStatus: savedTurn.visualStatus, sceneDocument: savedTurn.sceneDocument,
    validationReport: savedTurn.validationReport, sceneArtifacts: savedTurn.sceneArtifacts,
    segments: savedTurn.segments.map(({ orderIndex, narration, spokenText, command, durationMs, timings, audioUrl }) => ({
      orderIndex, narration, spokenText, command, durationMs, timings, hasAudio: Boolean(audioUrl),
    })),
  }
  const capture = {
    schema: 1, kind: 'native-tutor-session', title, question, width, height,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    recordedAt: new Date().toISOString(), startEpoch: start, duration: end - start,
    frames: frames.length, audio: audio.map((record) => ({ ...record, ...audioFiles.get(record.id) })), turn,
  }
  writeFileSync(`${out}/capture.json`, JSON.stringify(capture, null, 2))
  console.log(`Captured actual tutor: ${title}; ${frames.length} frames; ${capture.duration.toFixed(2)}s; ${audio.length} original speech clips.`)
} finally { await browser.close() }
