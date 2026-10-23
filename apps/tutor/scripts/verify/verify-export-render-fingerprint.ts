/** Actual build injection, source graph, CLI fallback and browser cache identity. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { lecturePageCacheKey, LECTURE_PAGE_CACHE_REVISION } from "../../lib/lecture-export/canExportLectureMp4";
import { renderFingerprint, renderSourceFiles, RENDER_SOURCE_ROOTS } from "../../lib/lecture-export/buildRenderFingerprint.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const actualHash = renderFingerprint(root);
assert.match(actualHash, /^[a-f0-9]{64}$/);
assert.equal(LECTURE_PAGE_CACHE_REVISION, `render-${actualHash}`, "tsx fallback hashes this checkout, never a shared placeholder");
assert(lecturePageCacheKey([]).endsWith(`@render-${actualHash}`));
assert(lecturePageCacheKey([], "webm").endsWith(`@render-${actualHash}.webm`));
const files = renderSourceFiles(root);
for (const file of [
  "apps/tutor/features/tutor-session/lib/scene/answerLabelReveal.ts",
  "apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation.ts",
  "apps/tutor/features/tutor-session/hooks/useCommandExecution.ts",
  "apps/tutor/features/tutor-session/lib/turn/segmentInk.ts",
  "apps/tutor/features/tutor-session/lib/replay/completeReplayDiagram.ts",
  "apps/tutor/lib/replay/replayTimeline.ts", "apps/tutor/lib/lecture-export/drawLectureTimeline.ts",
  "packages/scene-engine/src/compile/compiler.ts", "packages/whiteboard/src/Whiteboard.tsx",
  "packages/drawing/src/handwriting/handwriting.ts", "packages/drawing/src/handwriting/caveat-glyphData.json",
].filter(file => existsSync(path.join(root, file)))) assert(files.includes(file), `actual export dependency is fingerprinted: ${file}`);
assert(!files.some(file => /scripts\/verify|\.test\.|README/.test(file)));

const fixture = mkdtempSync(path.join(tmpdir(), "heytutor-render-hash-"));
try {
  const put = (file: string, value: string) => { mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true }); writeFileSync(path.join(fixture, file), value); };
  // Independent coverage contract, not derived from the implementation roots.
  const cases = [
    "apps/tutor/lib/lecture-export/fixture.ts", "apps/tutor/lib/code-render/fixture.ts",
    "apps/tutor/lib/code-lesson/persistedCodeLesson.ts", "apps/tutor/lib/replay/fixture.ts",
    "apps/tutor/features/tutor-session/lib/replay/fixture.ts", "apps/tutor/features/tutor-session/lib/scene/fixture.ts",
    "apps/tutor/features/tutor-session/lib/turn/segmentInk.ts", "apps/tutor/features/tutor-session/hooks/useCommandExecution.ts",
    "apps/tutor/features/tutor-session/hooks/useBoardLayout.ts", "packages/drawing/src/fixture.ts",
    "packages/whiteboard/src/fixture.ts", "packages/scene-engine/src/fixture.ts",
  ];
  for (const file of cases) put(file, `export const value = ${JSON.stringify(file)};`);
  put("apps/tutor/.context/irrelevant.ts", "context data");
  put("apps/tutor/lib/lecture-export/node_modules/irrelevant.ts", "dependency install");
  const outside = path.join(fixture, "apps/tutor/app/admin");
  mkdirSync(outside, { recursive: true });
  put("apps/tutor/lib/lecture-export/.context/irrelevant.ts", "context data");
  symlinkSync(outside, path.join(fixture, "packages/drawing/src/external"));
  const first = renderFingerprint(fixture);
  assert.equal(first, renderFingerprint(fixture), "repeated builds are deterministic");
  assert.equal(first, renderFingerprint(fixture, [...RENDER_SOURCE_ROOTS].reverse()), "enumeration order cannot change the identity");
  for (const file of cases) {
    const original = readFileSync(path.join(fixture, file), "utf8");
    put(file, original.replace("value", "other"));
    assert.notEqual(first, renderFingerprint(fixture), `equal-length source content changes the hash: ${file}`);
    put(file, original + "\nexport const changed = true;");
    assert.notEqual(first, renderFingerprint(fixture), `each rendering root changes the hash: ${file}`);
    put(file, original);
    rmSync(path.join(fixture, file));
    assert.notEqual(first, renderFingerprint(fixture), `deleting a renderer changes the hash: ${file}`);
    put(file, original);
    assert.equal(first, renderFingerprint(fixture));
  }
  const rename = cases.at(-1)!;
  const renamed = rename.replace("fixture.ts", "renamed.ts");
  const renameBytes = readFileSync(path.join(fixture, rename), "utf8");
  rmSync(path.join(fixture, rename)); put(renamed, renameBytes);
  assert.notEqual(first, renderFingerprint(fixture), "renaming a source changes the path/content fingerprint");
  rmSync(path.join(fixture, renamed)); put(rename, renameBytes);
  put("packages/drawing/src/newRenderer.ts", "export const added = 1;");
  assert.notEqual(first, renderFingerprint(fixture), "new source in a render root invalidates automatically");
  rmSync(path.join(fixture, "packages/drawing/src/newRenderer.ts"));
  put("apps/tutor/app/admin/unrelated.tsx", "export default function Admin() { return null; }");
  put("packages/drawing/src/README.md", "Documentation only");
  put("packages/drawing/src/fixture.test.ts", "throw Error('test only');");
  assert.equal(first, renderFingerprint(fixture), "unrelated source, docs and tests do not discard caches");
  assert(!renderSourceFiles(fixture).some(file => /(?:^|\/)(?:node_modules|\.context|external)\//.test(file)), "source traversal cannot enter private contexts, installed packages or symlink trees");
  // Shared package barrels also expose non-rendering APIs. Editing an unused
  // teaching/network source must not invalidate an already saved video.
  put("packages/tutor-core/src/index.ts", 'export * from "./sync/speed";\nexport * from "./llm/llmAPI";');
  put("packages/tutor-core/src/sync/speed.ts", "export const renderSpeed = 1;");
  put("packages/tutor-core/src/llm/llmAPI.ts", "export const requestTeaching = 1;");
  const barrelImporter = cases[1]!;
  const beforeImport = readFileSync(path.join(fixture, barrelImporter), "utf8");
  put(barrelImporter, beforeImport + '\nimport { renderSpeed } from "@heytutor/tutor-core";');
  const withRuntimeImport = renderFingerprint(fixture);
  put("packages/tutor-core/src/llm/llmAPI.ts", "export const requestTeaching = 2;");
  assert.equal(withRuntimeImport, renderFingerprint(fixture), "unused teaching exports in a shared barrel are unrelated to rendering");
  put("packages/tutor-core/src/sync/speed.ts", "export const renderSpeed = 2;");
  assert.notEqual(withRuntimeImport, renderFingerprint(fixture), "the actual named rendering dependency remains watched");
  put("packages/tutor-core/src/index.ts", 'export * as helpers from "./sync/speed";');
  put(barrelImporter, beforeImport + '\nimport { helpers } from "@heytutor/tutor-core";');
  const namespaceHash = renderFingerprint(fixture);
  put("packages/tutor-core/src/sync/speed.ts", "export const renderSpeed = 3;");
  assert.notEqual(namespaceHash, renderFingerprint(fixture), "namespace re-exports watch their full rendering target");
  const privateTarget = path.join(outside, "private-source.ts");
  writeFileSync(privateTarget, "export const renderSpeed = 10;");
  symlinkSync(privateTarget, path.join(fixture, "packages/tutor-core/src/privateLink.ts"));
  put("packages/tutor-core/src/index.ts", 'export * from "./privateLink";');
  put(barrelImporter, beforeImport + '\nimport { renderSpeed } from "@heytutor/tutor-core";');
  const escapedTarget = path.join(path.dirname(fixture), `${path.basename(fixture)}-outside.ts`);
  writeFileSync(escapedTarget, "export const paint = 1;");
  const fs = createRequire(import.meta.url)("node:fs");
  const read = fs.readFileSync;
  try {
    Object.defineProperty(fs, "readFileSync", { configurable: true, writable: true, value: (...args: unknown[]) => {
      assert(![privateTarget, escapedTarget, path.join(fixture, "packages/tutor-core/src/privateLink.ts")].includes(path.resolve(String(args[0]))), "dependency discovery cannot read through private symlinks");
      return Reflect.apply(read, fs, args);
    } });
    syncBuiltinESMExports();
    assert(!renderSourceFiles(fixture).some(file => file.endsWith("privateLink.ts")), "extension-appended symlink target is excluded before export inspection");
    for (const id of [`@/../../../${path.basename(escapedTarget)}`, `@heytutor/unused/../../../../${path.basename(escapedTarget)}`]) {
      put(barrelImporter, beforeImport + `\nimport { paint } from "${id}";`);
      assert(!renderSourceFiles(fixture).some(file => file.includes("..")), "alias and package paths cannot escape the repository");
    }
  } finally {
    Object.defineProperty(fs, "readFileSync", { configurable: true, writable: true, value: read });
    syncBuiltinESMExports();
    rmSync(escapedTarget, { force: true });
  }
  put("packages/tutor-core/src/index.ts", 'export * from "./sync/speed";\nexport * from "./register-palette";');
  put("packages/tutor-core/src/register-palette.ts", 'globalThis.palette = 1; export const unused = true;');
  put(barrelImporter, beforeImport + '\nimport { renderSpeed } from "@heytutor/tutor-core";');
  const withEffect = renderFingerprint(fixture);
  put("packages/tutor-core/src/register-palette.ts", 'globalThis.palette = 2; export const unused = true;');
  assert.notEqual(withEffect, renderFingerprint(fixture), "an unrequested re-export with runtime side effects remains watched");
  put("packages/tutor-core/src/index.ts", 'export * from "./destructured";');
  put("packages/tutor-core/src/destructured.ts", 'export const { paint } = { paint: 1 };');
  put(barrelImporter, beforeImport + '\nimport { paint } from "@heytutor/tutor-core";');
  const destructured = renderFingerprint(fixture);
  put("packages/tutor-core/src/destructured.ts", 'export const { paint } = { paint: 2 };');
  assert.notEqual(destructured, renderFingerprint(fixture), "unrecognized exported binding syntax is watched conservatively");
  put(barrelImporter, beforeImport);
  const importer = cases[0]!;
  const original = readFileSync(path.join(fixture, importer), "utf8");
  put(importer, original + '\nimport "@/lib/custom-render-dependency";');
  put("apps/tutor/lib/custom-render-dependency.ts", "export const paint = 1;");
  const imported = renderFingerprint(fixture);
  put("apps/tutor/lib/custom-render-dependency.ts", "export const paint = 2;");
  assert.notEqual(imported, renderFingerprint(fixture), "new runtime import dependencies outside the roots are followed");
} finally { rmSync(fixture, { recursive: true, force: true }); }

const runtimeFile = path.join(root, "apps/tutor/lib/lecture-export/lectureRenderFingerprint.ts");
const runtime = ts.transpileModule(readFileSync(runtimeFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const browserIdentity = (hash: unknown) => {
  const fixtureModule = { exports: {} as { LECTURE_PAGE_CACHE_REVISION: string; LECTURE_RENDER_FINGERPRINT: string | null } };
  new Function("require", "module", "exports", "process", runtime)((id: string) => { assert.equal(id, "./sourceRenderFingerprint"); return { sourceFingerprint: () => null }; }, fixtureModule, fixtureModule.exports, { env: { NEXT_PUBLIC_LECTURE_RENDER_HASH: hash } });
  return fixtureModule.exports;
};
const keySource = path.join(root, "apps/tutor/lib/lecture-export/canExportLectureMp4.ts");
const keyJs = ts.transpileModule(readFileSync(keySource, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const keyRequire = createRequire(keySource);
function browserKey(hash: unknown) {
  const fixtureModule = { exports: {} as { lecturePageCacheKey: (turns: never[]) => string } };
  new Function("require", "module", "exports", keyJs)((id: string) => id === "./lectureRenderFingerprint" ? browserIdentity(hash) : keyRequire(id), fixtureModule, fixtureModule.exports);
  return fixtureModule.exports.lecturePageCacheKey([]);
}
assert.equal(browserKey(actualHash), lecturePageCacheKey([]), "actual browser page key matches the source/build key");
assert(browserKey(undefined).endsWith("@uncached"), "actual page key construction still permits an uncached browser download");
assert.equal(browserIdentity(actualHash).LECTURE_PAGE_CACHE_REVISION, LECTURE_PAGE_CACHE_REVISION, "browser and tsx compute the same identity");
for (const value of [undefined, "", "video11", "bad", "a".repeat(63)]) {
  assert.equal(browserIdentity(value).LECTURE_RENDER_FINGERPRINT, null, "missing/invalid injection disables reuse");
  assert.equal(browserIdentity(value).LECTURE_PAGE_CACHE_REVISION, "uncached", "uncached downloads can still construct a key");
}
const configFile = path.join(root, "apps/tutor/next.config.ts");
const require = createRequire(configFile);
const configJs = ts.transpileModule(readFileSync(configFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const configModule = { exports: {} as { default: { env: { NEXT_PUBLIC_LECTURE_RENDER_HASH: string }; webpack: (config: { resolve: { alias: Record<string, string> } }, options: { dev: boolean; isServer: boolean }) => { resolve: { alias: Record<string, string> } } } } };
new Function("require", "module", "exports", "process", configJs)((id: string) => id === "@sentry/nextjs/config" ? { withSentryConfig: (config: unknown) => config } : require(id), configModule, configModule.exports, { cwd: () => path.join(root, "apps/tutor"), env: {} });
assert.equal(configModule.exports.default.env.NEXT_PUBLIC_LECTURE_RENDER_HASH, actualHash, "actual Next config injects exact source content into browser env");
console.log(`verify-export-render-fingerprint: ${files.length} source files; every root/change/add/delete/order/unrelated/config/browser/fallback control passes; no Git or providers`);

const server = configModule.exports.default.webpack({ resolve: { alias: {} } }, { dev: false, isServer: true });
assert.equal(server.resolve.alias["./sourceRenderFingerprint$"], undefined, "server source fallback remains Node-only");
const client = configModule.exports.default.webpack({ resolve: { alias: {} } }, { dev: false, isServer: false });
const browserFallback = client.resolve.alias["./sourceRenderFingerprint$"];
assert.equal(browserFallback, path.join(root, "apps/tutor/lib/lecture-export/sourceRenderFingerprint.browser.ts"), "actual Next client graph replaces Node fallback");
assert(!/node:|buildRenderFingerprint|existsSync|createRequire|process\.cwd/.test(readFileSync(browserFallback!, "utf8")), "browser fallback contains no filesystem code or private paths");

// Compile the actual browser identity import, not just an alias-shaped object.
// A filesystem fallback in this graph must fail even when env injection works.
async function verifyBrowserBundle(): Promise<void> {
const bundleDir = mkdtempSync(path.join(tmpdir(), "heytutor-browser-hash-"));
try {
  const loader = path.join(bundleDir, "transpile.cjs");
  writeFileSync(loader, `const ts = require(${JSON.stringify(require.resolve("typescript"))}); module.exports = function(source) { return ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText; };`);
  type Compiler = {
    run: (callback: (error: Error | null, stats?: { hasErrors: () => boolean; toString: () => string }) => void) => void;
    close: (callback: (error: Error | null) => void) => void;
  };
  const webpackModule: { init: () => void; webpack: (config: unknown) => Compiler } = require("next/dist/compiled/webpack/webpack");
  webpackModule.init();
  const compiler = webpackModule.webpack({
    mode: "none", target: "web", devtool: false,
    entry: path.join(root, "apps/tutor/lib/lecture-export/lectureRenderFingerprint.ts"),
    output: { path: bundleDir, filename: "identity.js", library: { type: "commonjs2" } },
    resolve: { ...client.resolve, extensions: [".ts", ".js"] },
    module: { rules: [{ test: /\.ts$/, use: loader }] },
  });
  try {
    await new Promise<void>((resolve, reject) => compiler.run((error, stats) => {
      if (error) reject(error);
      else if (!stats || stats.hasErrors()) reject(new Error(stats?.toString() ?? "No webpack result"));
      else resolve();
    }));
    const bundle = readFileSync(path.join(bundleDir, "identity.js"), "utf8");
    assert(!/node:fs|node:crypto|buildRenderFingerprint|existsSync|process\.cwd/.test(bundle), "browser graph excludes Node source traversal");
    const browserModule = { exports: {} as { LECTURE_RENDER_FINGERPRINT: string | null } };
    new Function("module", "exports", "process", bundle)(browserModule, browserModule.exports, { env: {} });
    assert.equal(browserModule.exports.LECTURE_RENDER_FINGERPRINT, null, "real browser bundle without injection disables cache");
    console.log("verify-export-render-fingerprint: actual webpack browser graph is filesystem-free");
  } finally {
    await new Promise<void>((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  }
} finally { rmSync(bundleDir, { recursive: true, force: true }); }

}
void verifyBrowserBundle().catch(error => { console.error(error); process.exitCode = 1; });
