import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

const landing = createRequire(resolve("apps/landing/package.json"));
const tailwind = createRequire(landing.resolve("tailwindcss/package.json"));
const fastGlob = createRequire(tailwind.resolve("fast-glob/package.json"));
const micromatch = createRequire(fastGlob.resolve("micromatch/package.json"));
const chokidar = createRequire(tailwind.resolve("chokidar/package.json"));

test("glob and watch consumers resolve the same hardened package", () => {
  const patched = realpathSync(chokidar.resolve("braces"));
  assert.match(patched, /braces@3\.0\.3_patch_hash=/);
  assert.equal(realpathSync(micromatch.resolve("braces")), patched);
  const eslint = createRequire(resolve("packages/eslint-config/package.json"));
  const nextConfig = createRequire(eslint.resolve("eslint-config-next/package.json"));
  const next = createRequire(nextConfig.resolve("@next/eslint-plugin-next/package.json"));
  const glob = createRequire(next.resolve("fast-glob/package.json"));
  const match = createRequire(glob.resolve("micromatch/package.json"));
  assert.equal(realpathSync(match.resolve("braces")), patched);
});

test("micromatch retains alternatives, extglobs and negation", () => {
  const match = fastGlob("micromatch");
  const files = ["src/a.ts", "src/b.tsx", "src/c.js", "src/a.test.ts"];
  assert.deepEqual(match(files, ["src/*.{ts,tsx}", "!**/*.test.ts"]), ["src/a.ts", "src/b.tsx"]);
  assert.deepEqual(match(files, "src/@(a|b).{ts,tsx}"), ["src/a.ts", "src/b.tsx"]);
  assert.throws(() => match.braces("{".repeat(3500) + "a,b" + "}".repeat(3500)), /exceeds max depth/);
});

test("fast-glob and chokidar still find normal Tailwind content patterns", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "heytutor-braces-consumers-"));
  let watcher;
  let timer;
  try {
    mkdirSync(resolve(directory, "src/nested"), { recursive: true });
    for (const file of ["src/a.ts", "src/nested/b.tsx", "src/c.js"]) writeFileSync(resolve(directory, file), "fixture");
    const glob = tailwind("fast-glob");
    assert.deepEqual(glob.sync("src/**/*.{ts,tsx}", { cwd: directory }).sort(), ["src/a.ts", "src/nested/b.tsx"]);
    const watch = tailwind("chokidar");
    const observed = [];
    watcher = watch.watch("src/**/*.{ts,tsx}", { cwd: directory, persistent: false, ignoreInitial: false });
    watcher.on("add", (file) => observed.push(file.replaceAll("\\", "/")));
    await new Promise((resolveReady, reject) => {
      watcher.once("ready", resolveReady);
      watcher.once("error", reject);
      timer = setTimeout(() => reject(new Error("content watcher did not become ready")), 5000);
    });
    assert.deepEqual(observed.sort(), ["src/a.ts", "src/nested/b.tsx"]);
  } finally {
    clearTimeout(timer);
    await watcher?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
