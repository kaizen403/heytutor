#!/usr/bin/env node
/**
 * Rasterize board SVGs to PNG with headless Firefox over WebDriver BiDi.
 *
 * There is no Chrome, ImageMagick or resvg on this machine, and qlmanage
 * rescales a 1200x700 board into a square thumbnail. Firefox renders the SVG
 * at its declared size, so a reviewer sees the frame at board scale.
 *
 * Usage:
 *   node scripts/lecture-lab/svg2png.mjs <file-or-dir> [...more]
 * Every .svg found (recursively for a directory) gets a sibling .png.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
const PORT = 9333 + Math.floor(Math.random() * 400);

function collect(target, out) {
  const full = resolve(target);
  const info = statSync(full);
  if (info.isDirectory()) {
    for (const entry of readdirSync(full)) collect(join(full, entry), out);
  } else if (full.endsWith(".svg")) {
    out.push(full);
  }
  return out;
}

const files = process.argv.slice(2).flatMap((target) => collect(target, []));
if (files.length === 0) {
  console.error("no .svg files found");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "ff-svg-"));
writeFileSync(join(profile, "user.js"), 'user_pref("remote.active-protocols", 1);\n');
const firefox = spawn(
  FIREFOX,
  ["--headless", "--no-remote", "--new-instance", "--profile", profile, "--remote-debugging-port", String(PORT), "about:blank"],
  { stdio: "ignore" },
);
const cleanup = () => {
  try { firefox.kill("SIGKILL"); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
const watchdog = setTimeout(() => { console.error("watchdog: giving up"); cleanup(); process.exit(2); }, 60_000 + files.length * 4_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      return ws;
    } catch {
      await sleep(500);
    }
  }
  throw new Error("could not reach Firefox BiDi");
}

const ws = await connect();
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve: res, reject: rej } = pending.get(message.id);
    pending.delete(message.id);
    if (message.type === "error") rej(new Error(message.message));
    else res(message.result);
  }
};
const send = (method, params) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("session.new", { capabilities: {} });
const tree = await send("browsingContext.getTree", {});
const context = tree.contexts[0].context;
await send("browsingContext.setViewport", { context, viewport: { width: 1200, height: 700 } });

let done = 0;
for (const file of files) {
  try {
    await send("browsingContext.navigate", { context, url: pathToFileURL(file).href, wait: "complete" });
    await sleep(120);
    const shot = await send("browsingContext.captureScreenshot", { context });
    writeFileSync(file.replace(/\.svg$/, ".png"), Buffer.from(shot.data, "base64"));
    done += 1;
  } catch (error) {
    console.error(`failed ${file}: ${error.message}`);
  }
}
console.log(`rasterized ${done}/${files.length}`);
clearTimeout(watchdog);
ws.close();
cleanup();
process.exit(0);
