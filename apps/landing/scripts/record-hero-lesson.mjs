/** Render the current tutor demo in an isolated browser and export its frames.
 * Real compositor timestamps preserve production pacing, without virtual time.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const args = Object.fromEntries(process.argv.slice(2).flatMap((value, i, all) => value.startsWith('--') ? [[value.slice(2), all[i + 1]]] : []))
const asset = JSON.parse(readFileSync(new URL('../src/components/hero-lesson/lessonAsset.json', import.meta.url), 'utf8'))
const timing = JSON.parse(readFileSync(new URL('../public/hero/lesson-timings.json', import.meta.url), 'utf8'))
const width = 1600, height = 953, fps = 25
const teachStart = asset.question.length / 38 + 5.6
const loopDuration = teachStart + timing.total + 6 + 1.2
const out = args.out ?? '/tmp/heytutor-hero-frames'
const require_ = createRequire(pathToFileURL(`${process.cwd()}/`))
const location = args.playwright ? `${args.playwright}/playwright-core` : 'playwright-core'
const module = await import(pathToFileURL(require_.resolve(location)).href)
const chromium = module.chromium ?? module.default?.chromium
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: args.chromium || undefined, args: ['--force-device-scale-factor=1', '--hide-scrollbars'] })
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  let renderError = null
  page.on('pageerror', (error) => { renderError = error })
  await page.goto(args.url ?? 'http://127.0.0.1:5174/record.html')
  await page.waitForSelector('canvas')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => Number(document.querySelector('.hero-product')?.getAttribute('data-lesson-clock')) > 0)
  const anchor = await page.evaluate(() => ({
    clock: Number(document.querySelector('.hero-product')?.getAttribute('data-lesson-clock')),
    epoch: (performance.timeOrigin + performance.now()) / 1000,
  }))
  if (anchor.clock > teachStart) throw new Error('The lesson started before capture was ready; rerun with warm assets')
  const origin = anchor.epoch - anchor.clock
  const frames = []
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const index = frames.length
    const file = `frame-${String(index + 1).padStart(5, '0')}.jpg`
    writeFileSync(`${out}/${file}`, Buffer.from(data, 'base64'))
    frames.push({ file, timestamp: metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (index % 250 === 0) console.log(`Rendered ${index + 1} frames; lesson ${(metadata.timestamp - origin).toFixed(1)}s/${loopDuration.toFixed(1)}s`)
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 96, maxWidth: width, maxHeight: height, everyNthFrame: 4 })
  const deadline = Date.now() + (loopDuration - anchor.clock) * 1000
  while (Date.now() < deadline) {
    if (renderError) throw renderError
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, deadline - Date.now())))
  }
  await cdp.send('Page.stopScreencast')
  if (frames.length < 100) throw new Error('The browser did not render a complete lesson')
  const start = frames[0].timestamp
  const end = origin + loopDuration
  const concat = frames.flatMap((frame, index) => [
    `file '${frame.file}'`,
    `duration ${Math.max(1 / 1000, (frames[index + 1]?.timestamp ?? end) - frame.timestamp)}`,
  ])
  concat.push(`file '${frames.at(-1).file}'`)
  writeFileSync(`${out}/frames.txt`, concat.join('\n'))
  writeFileSync(`${out}/capture.json`, JSON.stringify({ fps, frames: frames.length, width, height, audioOffsetMs: Math.round((origin + teachStart - start) * 1000), duration: end - start, title: asset.title }, null, 2))
  console.log(`Finished ${frames.length} frames; ${(end - start).toFixed(2)}s.`)
} finally { await browser.close() }
