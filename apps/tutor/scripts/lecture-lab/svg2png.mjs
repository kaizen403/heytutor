#!/usr/bin/env node
/**
 * Rasterize board SVGs with Playwright's cached chrome-headless-shell over CDP.
 *
 * Usage:
 *   node scripts/lecture-lab/svg2png.mjs <file-or-dir> [...more]
 * Every .svg found recursively gets a sibling .png.
 */
import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

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

function findChrome(root) {
  if (!root || !existsSync(root)) return null;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!["chrome-headless-shell", "headless_shell"].includes(basename(path))) continue;
      try {
        accessSync(path, constants.X_OK);
        return path;
      } catch {
        // Keep looking for an executable cache entry.
      }
    }
  }
  return null;
}

const files = process.argv.slice(2).flatMap((target) => collect(target, []));
if (files.length === 0) {
  console.error("no .svg files found");
  process.exit(1);
}

const cacheRoots = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  join(homedir(), "Library", "Caches", "ms-playwright"),
  join(homedir(), ".cache", "ms-playwright"),
];
const chrome = cacheRoots.map(findChrome).find(Boolean);
if (!chrome) {
  console.error("cached Playwright chrome-headless-shell was not found");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "heytutor-chrome-cdp-"));
const browser = spawn(chrome, [
  "--headless",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--allow-file-access-from-files",
  "--disable-background-networking",
  "--disable-default-apps",
  "--no-first-run",
  "about:blank",
], { stdio: "ignore" });
const cleanup = () => {
  try { browser.kill("SIGKILL"); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
const watchdog = setTimeout(() => {
  console.error("watchdog: chrome-headless-shell did not finish");
  cleanup();
  process.exit(2);
}, 60_000 + files.length * 4_000);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function devtoolsUrl() {
  const activePort = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(activePort)) {
      const [port, browserPath] = readFileSync(activePort, "utf8").trim().split(/\r?\n/);
      if (port && browserPath) return `ws://127.0.0.1:${port}${browserPath}`;
    }
    if (browser.exitCode !== null) throw new Error(`chrome-headless-shell exited ${browser.exitCode}`);
    await sleep(100);
  }
  throw new Error("could not discover the chrome-headless-shell CDP endpoint");
}

const ws = new WebSocket(await devtoolsUrl());
await new Promise((resolveOpen, rejectOpen) => {
  ws.once("open", resolveOpen);
  ws.once("error", rejectOpen);
});

let nextId = 1;
const pending = new Map();
ws.on("message", (data) => {
  const message = JSON.parse(data.toString());
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolveSend, rejectSend) => {
  const id = nextId++;
  pending.set(id, { resolve: resolveSend, reject: rejectSend });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

let failures = 0;
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);

  for (const file of files) {
    try {
      await send("Page.navigate", { url: pathToFileURL(file).href }, sessionId);
      await send("Runtime.evaluate", {
        expression: "document.fonts ? document.fonts.ready : Promise.resolve()",
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      }, sessionId);
      writeFileSync(file.replace(/\.svg$/, ".png"), Buffer.from(shot.data, "base64"));
    } catch (error) {
      failures += 1;
      console.error(`failed ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  clearTimeout(watchdog);
  ws.close();
  cleanup();
}

console.log(`rasterized ${files.length - failures}/${files.length}`);
process.exit(failures === 0 ? 0 : 1);
