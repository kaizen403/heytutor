/**
 * Drive one live lesson in headless Chrome and record everything the runtime
 * says about speech and ink, with wall timestamps, plus periodic screenshots.
 *
 * The before/after gate for "the pen follows the voice" (10 Sep 2026): run the
 * same questions on two builds, then `node sync-analyser.mjs <runs...> --md out.md`
 * and `python3 ab-table.py` for the lesson by metric table. Needs the dev server
 * up (Postgres too), playwright-core somewhere on disk (the npx cache is used
 * below; pass --playwright <dir> to point elsewhere) and a Chrome for Testing
 * binary (--chromium <path>). Uses real TTS credits.
 *
 *   node lesson-probe.mjs --q "question" --out ./run-01 [--timeout 240000] [--shot 1500]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((v, i, arr) => (v.startsWith("--") ? [[v.slice(2), arr[i + 1]]] : [])),
);
const question = args.q ?? "A ball is thrown upward at 20 m/s. How high does it go?";
const out = args.out ?? "./probe-run";
const timeoutMs = Number(args.timeout ?? 240_000);
const shotEveryMs = Number(args.shot ?? 1500);
const base = args.base ?? "http://localhost:3000";
mkdirSync(join(out, "shots"), { recursive: true });

const require_ = createRequire(import.meta.url);
const PLAYWRIGHT_DIR =
  args.playwright ?? process.env.PLAYWRIGHT_CORE_DIR ?? "/Users/kaizen/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core";
const { chromium } = require_(PLAYWRIGHT_DIR);
const CHROME =
  args.chromium ??
  process.env.CHROME_FOR_TESTING ??
  "/Users/kaizen/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-gpu",
    "--use-fake-ui-for-media-stream",
    "--window-size=1600,1000",
  ],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const lines = [];
const t0 = Date.now();
let done = false;
page.on("console", (msg) => {
  const text = msg.text();
  const wall = Date.now() - t0;
  lines.push({ wall, type: msg.type(), text });
  if (text.includes("[tutor:turn]") && text.includes("turn complete")) done = true;
  if (text.includes("[tutor:turn]") && text.includes("turn failed")) done = true;
});
page.on("pageerror", (err) => lines.push({ wall: Date.now() - t0, type: "pageerror", text: String(err) }));

const url = `${base}/?q=${encodeURIComponent(question)}`;
lines.push({ wall: 0, type: "probe", text: `goto ${url}` });
await page.goto(url, { waitUntil: "domcontentloaded" });

let shotIndex = 0;
const started = Date.now();
while (!done && Date.now() - started < timeoutMs) {
  try {
    await page.screenshot({ path: join(out, "shots", `s${String(shotIndex).padStart(4, "0")}_${Date.now() - t0}.png`), timeout: 8000 });
    shotIndex++;
  } catch (err) {
    lines.push({ wall: Date.now() - t0, type: "probe", text: `screenshot failed: ${String(err).split("\n")[0]}` });
  }
  await page.waitForTimeout(shotEveryMs);
}
try { await page.screenshot({ path: join(out, "final.png"), timeout: 8000 }); } catch {}
lines.push({ wall: Date.now() - t0, type: "probe", text: done ? "turn complete seen" : "timeout" });
writeFileSync(join(out, "console.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
writeFileSync(join(out, "console.txt"), lines.map((l) => `${String(l.wall).padStart(7)} ${l.type} ${l.text}`).join("\n"));
await browser.close();
console.log(`wrote ${lines.length} lines, ${shotIndex} shots to ${out}; done=${done}`);
