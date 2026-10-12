import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { LECTURE_PAGE_CACHE_REVISION } from "../../lib/lecture-export/canExportLectureMp4";

async function main() {
  const current = Number(LECTURE_PAGE_CACHE_REVISION.slice("video".length));
  const prefix = "revision-gate:1:@1.25@video";
  const retained = { blob: new Blob(["current export"]), noVoice: false, missingAudioCues: 0, mimeType: "video/mp4", extension: "mp4" };
  const records = new Map<IDBValidKey, unknown>([
    [prefix + (current - 1), { ...retained, blob: new Blob(["old mp4"]) }],
    [prefix + (current - 2) + ".webm", { ...retained, blob: new Blob(["old webm"]) }],
    [prefix + current, retained],
    [prefix + (current + 1), retained],
    ["unrelated-key", retained],
  ]);
  let version = 1;
  let upgrades = 0;
  let pendingUpgradeRequests = 0;
  let finishOpen = () => {};
  const request = <T>(result: T) => {
    const job = { result, error: null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
    queueMicrotask(() => job.onsuccess?.());
    return job;
  };
  const store = {
    get: (key: IDBValidKey) => request(records.get(key)),
    openCursor: () => {
      pendingUpgradeRequests++;
      const keys = Array.from(records.keys());
      let index = 0;
      const job = { result: null as unknown, error: null, onsuccess: null as (() => void) | null };
      const advance = () => {
        const key = keys[index++];
        job.result = key === undefined ? null : { key, delete: () => { records.delete(key); }, continue: () => queueMicrotask(advance) };
        job.onsuccess?.();
        if (key === undefined) { pendingUpgradeRequests--; finishOpen(); }
      };
      queueMicrotask(advance);
      return job;
    },
  };
  const db = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => store }), close: () => {} };
  const indexedDb = {
    open: (_name: string, nextVersion: number) => {
      const job = { result: db, transaction: { objectStore: () => store }, onupgradeneeded: null as (() => void) | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      queueMicrotask(() => {
        if (nextVersion > version) { upgrades++; version = nextVersion; job.onupgradeneeded?.(); }
        // IDB open success follows the completed upgrade transaction/cursor.
        finishOpen = () => { if (pendingUpgradeRequests === 0) queueMicrotask(() => job.onsuccess?.()); };
        finishOpen();
      });
      return job;
    },
  };
  const file = path.resolve(import.meta.dirname, "../../lib/lecture-export/lectureExportCache.ts");
  const source = readFileSync(process.env.LECTURE_CACHE_TEST_SOURCE ?? file, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const cacheModule = { exports: {} as { getCachedLectureExport: (key: string) => Promise<unknown> } };
  const require = createRequire(file);
  new Function("require", "module", "exports", "indexedDB", js)(require, cacheModule, cacheModule.exports, indexedDb);
  assert.equal(await cacheModule.exports.getCachedLectureExport(prefix + current), retained, "The current cached video remains usable.");
  assert.equal(upgrades, 1, "Opening an old cache triggers the revision upgrade.");
  assert(!records.has(prefix + (current - 1)), "Old MP4 blobs are removed, not only ignored by new cache keys.");
  assert(!records.has(prefix + (current - 2) + ".webm"), "Old WebM blobs are removed too.");
  assert(records.has(prefix + current));
  assert(records.has(prefix + (current + 1)), "A future revision is never deleted by an older client.");
  assert(records.has("unrelated-key"), "Unrecognized keys are preserved.");
  console.log("verify-lecture-cache-revisions: old IndexedDB revisions pruned on upgrade; current/future/unknown retained");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
