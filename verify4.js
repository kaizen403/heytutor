const { chromium } = require('playwright-core')
const path = require('path')
const EXE = path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
async function main() {
  const browser = await chromium.launch({ executablePath: EXE })
  for (const [width, height] of [[1280, 900], [1024, 900], [375, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(6000)
    const r = await page.evaluate(() => {
      const out = { clusters: [], collisions: [] }
      const svgs = [...document.querySelectorAll('.sketch-wallpaper svg')]
      const hero = document.querySelector('.fx-aurora')
      // h1 + its descendant spans: exempt for clusters at <=0.07 opacity
      const h1Rects = []
      const h1 = hero.querySelector('h1')
      if (h1) {
        h1Rects.push(h1.getBoundingClientRect())
        for (const s of h1.querySelectorAll('*')) h1Rects.push(s.getBoundingClientRect())
      }
      // everything else: content text, pen ink, pixel decor
      const rects = []
      const contentEls = [...document.querySelectorAll('h2,h3,h4,p,a,button,li,span')].filter((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return r.width > 20 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.3
      })
      for (const el of contentEls) rects.push(el.getBoundingClientRect())
      const board = hero.querySelector('canvas')
      if (board && board.width > 0) {
        const ctx = board.getContext('2d')
        const d = ctx.getImageData(0, 0, board.width, board.height).data
        const dpr = board.width / hero.getBoundingClientRect().width
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
        for (let y = 0; y < board.height; y += 2) for (let x = 0; x < board.width; x += 2) {
          const i = (y * board.width + x) * 4
          if (d[i + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
        }
        if (x1 > 0) rects.push({ left: x0 / dpr, top: y0 / dpr, right: x1 / dpr, bottom: y1 / dpr })
      }
      for (const el of hero.querySelectorAll('.animate-aurora')) {
        const r = el.getBoundingClientRect()
        if (r.width > 50 && r.width < 300) rects.push(r)
      }
      for (const svg of svgs) {
        const sr = svg.getBoundingClientRect()
        if (sr.width === 0 || sr.height === 0) continue
        const op = parseFloat(getComputedStyle(svg).opacity)
        const checkRects = op <= 0.07 ? rects : [...rects, ...h1Rects]
        for (const er of checkRects) {
          const ix = Math.max(0, Math.min(sr.right, er.right) - Math.max(sr.left, er.left))
          const iy = Math.max(0, Math.min(sr.bottom, er.bottom) - Math.max(sr.top, er.top))
          const inter = ix * iy
          if (inter > 0 && inter / (sr.width * sr.height) > 0.25) {
            out.collisions.push({ cluster: `${Math.round(sr.x)},${Math.round(sr.y)} ${Math.round(sr.width)}x${Math.round(sr.height)} op${op}`, with: `rect ${Math.round(er.left)},${Math.round(er.top)} ${Math.round(er.right - er.left)}x${Math.round(er.bottom - er.top)}`, frac: (inter / (sr.width * sr.height)).toFixed(2) })
          }
        }
      }
      return out
    })
    console.log(`=== ${width}x${height} === clusters: ${r.clusters.length} collisions: ${r.collisions.length}`)
    if (r.collisions.length) console.log(JSON.stringify(r.collisions, null, 1))
    await page.close()
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
