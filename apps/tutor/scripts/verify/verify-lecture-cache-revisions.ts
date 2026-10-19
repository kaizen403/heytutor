/** Actual cache against a transactional IDB fake: numeric versions, commit and abort. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { LECTURE_PAGE_CACHE_REVISION } from "../../lib/lecture-export/canExportLectureMp4";
import { LECTURE_RENDER_FINGERPRINT } from "../../lib/lecture-export/lectureRenderFingerprint";

type Handler = (() => void) | null;
function fakeIdb(initialVersion: number, seed: Map<IDBValidKey, unknown>, abortWrites = false) {
  let version = initialVersion, hasStore = version > 0, upgrades = 0, closes = 0, commits = 0, aborts = 0;
  const rows = new Map(seed), opens: Array<number | undefined> = [];
  const db = {
    objectStoreNames: { contains: () => hasStore }, createObjectStore() { hasStore = true; },
    onversionchange: null as Handler, close() { closes++; },
    transaction(_name: string, mode: string) {
      assert(hasStore);
      const copy = new Map(rows); let pending = 0, done = false, dirty = false;
      const transaction = { oncomplete: null as Handler, onerror: null as Handler, onabort: null as Handler, error: null as Error | null, objectStore: () => store };
      const settle = () => queueMicrotask(() => {
        if (pending || done) return; done = true;
        if (dirty && abortWrites) { aborts++; transaction.error = new Error("QuotaExceededError"); transaction.onabort?.(); return; }
        if (mode === "readwrite") { rows.clear(); for (const [key, value] of copy) rows.set(key, value); }
        commits++; transaction.oncomplete?.();
      });
      const request = (operation: () => unknown) => {
        pending++;
        const job = { result: undefined as unknown, onsuccess: null as Handler, onerror: null as Handler };
        queueMicrotask(() => { assert(!done); job.result = operation(); job.onsuccess?.(); pending--; settle(); });
        return job;
      };
      const store = {
        get: (key: IDBValidKey) => request(() => copy.get(key)),
        put: (value: unknown, key: IDBValidKey) => request(() => { assert.equal(mode, "readwrite"); dirty = true; copy.set(key, value); return key; }),
        openCursor() {
          pending++; const keys = [...copy.keys()]; let index = 0;
          const job = { result: null as unknown, onsuccess: null as Handler, onerror: null as Handler };
          const advance = () => queueMicrotask(() => {
            const key = keys[index++];
            if (key === undefined) { job.result = null; job.onsuccess?.(); pending--; settle(); return; }
            job.result = { key, delete: () => request(() => { assert.equal(mode, "readwrite"); dirty = true; copy.delete(key); }), continue: advance };
            job.onsuccess?.();
          });
          advance(); return job;
        },
      };
      return transaction;
    },
  };
  const indexedDB = { open(_name: string, nextVersion?: number) {
    opens.push(nextVersion);
    const job = { result: db, error: null as Error | null, onupgradeneeded: null as Handler, onsuccess: null as Handler, onerror: null as Handler, onblocked: null as Handler };
    queueMicrotask(() => {
      if (nextVersion !== undefined && nextVersion < version) { job.error = new Error("VersionError"); job.onerror?.(); return; }
      const requested = nextVersion ?? (version || 1);
      if (requested > version) { version = requested; upgrades++; job.onupgradeneeded?.(); }
      job.onsuccess?.();
    }); return job;
  } };
  return { indexedDB, rows, opens, db, stats: () => ({ version, upgrades, closes, commits, aborts }) };
}
const file = path.resolve(import.meta.dirname, "../../lib/lecture-export/lectureExportCache.ts");
const require = createRequire(file);
const js = ts.transpileModule(readFileSync(process.env.LECTURE_CACHE_TEST_SOURCE ?? file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function load(indexedDB?: ReturnType<typeof fakeIdb>["indexedDB"], hash: string | null = LECTURE_RENDER_FINGERPRINT) {
  const fixtureModule = { exports: {} as typeof import("../../lib/lecture-export/lectureExportCache") };
  new Function("require", "module", "exports", "indexedDB", js)((id: string) => id === "./lectureRenderFingerprint" ? { LECTURE_RENDER_FINGERPRINT: hash } : require(id), fixtureModule, fixtureModule.exports, indexedDB);
  return fixtureModule.exports;
}
const value = { blob: new Blob(["current export"]), noVoice: false, missingAudioCues: 0, mimeType: "video/mp4", extension: "mp4" as const };
const key = `revision-gate:1:@1@${LECTURE_PAGE_CACHE_REVISION}`;
const legacyKeys = [6, 7, 8, 9, 10, 11, 12, 13].flatMap(version => [`revision-gate:1:@1.25@video${version}`, `revision-gate:1:@1.25@video${version}.webm`]);
const stale = `revision-gate:1:@1@render-${"f".repeat(64)}`;
async function verifyMigration(fromVersion: number) {
  const seed = new Map<IDBValidKey, unknown>([...legacyKeys.map(old => [old, value] as [string, unknown]), [stale, value], [stale + ".webm", value], [key, value], [key + ".webm", value], ["another-page@1@video10", value], ["unrelated-key", value]]);
  const fake = fakeIdb(fromVersion, seed), cache = load(fake.indexedDB);
  assert.equal(await cache.getCachedLectureExport(stale), null, "stale cached files never return even before cleanup");
  assert.equal(await cache.getCachedLectureExport(legacyKeys[0]!), null, "legacy cached files never return before cleanup");
  assert.equal(fake.opens.length, 0, "invalid identity never opens the database");
  assert.equal((await cache.getCachedLectureExport(key))?.blob, value.blob, "current MP4 bytes and voice evidence survive");
  assert.equal((await cache.getCachedLectureExport(key + ".webm"))?.missingAudioCues, 0, "current WebM survives");
  assert(fake.opens.every(version => version === undefined), "render identity must never be a schema version");
  assert.equal(fake.stats().version, fromVersion || 1, "numeric schemas open without downgrade or renderer-triggered version churn");
  assert.equal(fake.stats().upgrades, fromVersion === 0 ? 1 : 0);
  for (const old of [...legacyKeys, stale, stale + ".webm"]) assert(!fake.rows.has(old), `obsolete same-page file is freed: ${old}`);
  for (const preserved of [key, key + ".webm", "another-page@1@video10", "unrelated-key"]) assert(fake.rows.has(preserved), `preserve current build, other pages and unknown: ${preserved}`);
  assert.equal(await cache.getCachedLectureExport(legacyKeys[0]!), null, "legacy keys never return");
  assert.equal(await cache.getCachedLectureExport(stale), null, "stale hashes never return");
  cache.rememberLectureExport(key, { ...value, noVoice: true, missingAudioCues: 2 });
  for (let count = 0; count < 50; count++) await Promise.resolve();
  const stored = await load(fake.indexedDB).getCachedLectureExport(key);
  assert.equal(stored?.blob, value.blob); assert.equal(stored?.noVoice, true); assert.equal(stored?.missingAudioCues, 2, "write/reopen retains missing-voice evidence");
  assert(fake.stats().commits >= 3); assert(fake.stats().closes >= 3); assert.equal(typeof fake.db.onversionchange, "function");
}
async function main() {
  assert.match(LECTURE_PAGE_CACHE_REVISION, /^render-[a-f0-9]{64}$/);
  for (const version of new Set([0, 8, 9, 10, 11, 12, 13, 100, ...process.argv.slice(2).map(Number)])) { assert(Number.isSafeInteger(version) && version >= 0); await verifyMigration(version); }
  const fake = fakeIdb(12, new Map([[key, value]]), true), cache = load(fake.indexedDB);
  cache.rememberLectureExport(key, { ...value, noVoice: true, missingAudioCues: 5 });
  for (let count = 0; count < 50; count++) await Promise.resolve();
  assert.equal(fake.stats().aborts, 1); assert.equal((fake.rows.get(key) as typeof value).noVoice, false, "aborted transaction never commits partial writes");
  assert.equal((await cache.getCachedLectureExport(key))?.noVoice, true, "quota failure preserves useful memory cache");
  const noBuild = fakeIdb(12, new Map([[key, value]])), unavailable = load(noBuild.indexedDB, null);
  unavailable.rememberLectureExport(key, value); assert.equal(await unavailable.getCachedLectureExport(key), null);
  unavailable.rememberLectureExport("page@1@uncached", value); assert.equal(await unavailable.getCachedLectureExport("page@1@uncached"), null);
  assert.equal(noBuild.opens.length, 0, "missing browser injection bypasses memory and IDB without blocking export");
  const shared = fakeIdb(12, new Map());
  const otherHash = "c".repeat(64), otherKey = key.replace(LECTURE_PAGE_CACHE_REVISION, `render-${otherHash}`);
  const firstTab = load(shared.indexedDB), secondTab = load(shared.indexedDB, otherHash);
  firstTab.rememberLectureExport(key, value);
  for (let count = 0; count < 50; count++) await Promise.resolve();
  const otherBlob = new Blob(["different renderer export"]);
  secondTab.rememberLectureExport(otherKey, { ...value, blob: otherBlob });
  for (let count = 0; count < 50; count++) await Promise.resolve();
  assert.equal(await firstTab.getCachedLectureExport(otherKey), null);
  assert.equal(await secondTab.getCachedLectureExport(key), null, "another build cannot poison the current build's memory lookup");
  assert.equal((await firstTab.getCachedLectureExport(key))?.blob, value.blob, "older open tab retains only its own valid in-memory bytes");
  assert.equal((await load(shared.indexedDB, otherHash).getCachedLectureExport(otherKey))?.blob, otherBlob, "second build reopens its own committed bytes, never the older blob");
  const versionProbe = fakeIdb(12, new Map());
  await new Promise<void>(resolve => { const request = versionProbe.indexedDB.open("test", 10); request.onerror = () => { assert.match(request.error!.message, /VersionError/); resolve(); }; });
  const noDb = load(undefined); noDb.rememberLectureExport(key, value);
  assert.equal((await noDb.getCachedLectureExport(key))?.blob, value.blob, "memory still works when IDB is unavailable");
  console.log("verify-lecture-cache-revisions: numeric schemas, hash pruning, preserved pages, actual read/write/commit/abort and uncached fallback pass");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
