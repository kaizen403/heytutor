/** Real accounting consumer with deterministic, read-only object metadata. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import type { StorageAccountingSnapshot } from "../../lib/boards/storageAccounting";

const app = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const owner = { boardId: "historical-board", turnId: "historical-turn" };
const prefix = `lectures/${owner.boardId}/${owner.turnId}/`;
const audioKey = `${prefix}0.mp3`;
const heldKey = `${prefix}2.wav`;
const publicBase = "https://fixture-public-media.example/archive";
const environmentKeys = ["S3_BUCKET", "R2_BUCKET", "S3_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL"] as const;
const beforeEnvironment = Object.fromEntries(environmentKeys.map(name => [name, process.env[name]]));
process.env.S3_BUCKET = "historical-fixture-bucket";
process.env.R2_PUBLIC_BASE_URL = publicBase;
delete process.env.S3_PUBLIC_BASE_URL;
const aliases = [
  `${publicBase}/${audioKey}`,
  `/api/lecture-audio?src=${encodeURIComponent(`${publicBase}/${audioKey}`)}`,
  `https://historical-fixture-bucket.s3.ap-south-2.amazonaws.com/${audioKey}`,
  `https://s3.ap-south-2.amazonaws.com/historical-fixture-bucket/${audioKey}`,
  `/api/media?key=${encodeURIComponent(audioKey)}`,
];
const listedObjects = [
  { key: audioKey, bytes: 100 },
  { key: `${prefix}metadata.json`, bytes: 17 },
  { key: prefix, bytes: 3 },
  { key: `${prefix}1.mp3`, bytes: 41 },
];
let inventory = structuredClone(listedObjects);
const reads: { list: string[]; head: string[] } = { list: [], head: [] };
mock.module(resolve(app, "lib/object-store/s3.ts"), { namedExports: {
  listObjectSizes: async (requested: string) => {
    reads.list.push(requested);
    assert.equal(requested, prefix, "LIST is restricted to the owned turn prefix");
    return structuredClone(inventory);
  },
  headObjectSize: async (requested: string) => {
    reads.head.push(requested);
    assert.equal(requested, heldKey, "HEAD is restricted to the normalized held clip key");
    return { status: "found", bytes: 31 };
  },
} });
// A deliberate dependency mutation proves this gate exercises the consumer's
// historical normalization, instead of merely testing the parser in isolation.
if (process.env.STORAGE_ACCOUNTING_URL_CONTROL === "old-parser") {
  const actual = load(resolve(app, "lib/object-store/mediaUrl.ts")) as typeof import("../../lib/object-store/mediaUrl");
  mock.module(resolve(app, "lib/object-store/mediaUrl.ts"), { namedExports: {
    ...actual, lectureKeyForStorageMeasurement: actual.mediaKeyFromUrl,
  } });
}
if (process.env.STORAGE_ACCOUNTING_URL_CONTROL === "discard-auxiliary") {
  inventory = inventory.filter(object => object.key.endsWith(".mp3"));
}
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Historical URL measurement must not fetch arbitrary sources"); };
const accounting = load(resolve(app, "lib/boards/storageAccounting.ts")) as typeof import("../../lib/boards/storageAccounting");
const fixture = {
  userId: "historical-user", boards: [{ id: owner.boardId }], notes: [], jobs: [],
  storage: { reservedBytes: 262144n + BigInt(aliases.length) * 8388608n, pendingTurns: 0 },
  turns: [{
    id: owner.turnId, boardId: owner.boardId, userId: "historical-user", question: "Historical lesson",
    rawResponse: "Stored narration", storageBytes: 0n, metadataBytes: 0n, status: "complete", kind: "lesson",
    speedMultiplier: 1, sceneDocument: null, sceneArtifacts: null, validationReport: null,
    sceneEngineVersion: null, visualStatus: "text_only", resumeState: null,
    submittedSegments: { v: 1, rows: [{ audioUrl: `/api/lecture-audio?src=${encodeURIComponent(`${publicBase}/${heldKey}`)}` }] },
    segments: aliases.map((audioUrl, orderIndex) => ({
      orderIndex, narration: "Fixture", spokenText: "Fixture", command: null, audioUrl,
      audioFormat: "audio/mpeg", durationMs: 1_000, audioRef: orderIndex, timings: null,
    })),
  }],
} as unknown as StorageAccountingSnapshot;

async function main() {
  const before = structuredClone(fixture);
  const plan = await accounting.measureStorageAccounting(fixture);
  assert.equal(plan.measuredAudioBytes, 192n, "five aliases charge one 100-byte clip, plus every stored object and the held clip");
  assert.equal(plan.orphanAudioBytes, 61n, "17-byte metadata, 3-byte folder marker and 41-byte unreferenced audio all remain charged");
  assert.equal(plan.orphanObjects, 3);
  assert.equal(plan.unresolvedReferences, 0);
  assert.equal(plan.missingObjects, 0);
  assert.deepEqual(reads.list, [prefix]);
  assert.deepEqual(reads.head, [heldKey], "listed clip aliases do not produce redundant HEAD requests");
  assert.equal(plan.turnUpdates.length, 1);
  assert(plan.turnUpdates[0].metadataBytes > 0n);
  assert.equal(plan.turnUpdates[0].storageBytes - plan.turnUpdates[0].metadataBytes, 192n);
  assert.equal(plan.afterBytes, plan.turnUpdates[0].storageBytes, "legacy ceiling is replaced by measured objects plus retained metadata");
  assert.equal(plan.releasedBytes, fixture.storage!.reservedBytes - plan.afterBytes);
  assert.deepEqual(fixture, before, "read-only measurement never edits retained lessons or the ledger");
  console.log("PASS: real accounting normalizes old R2/src/S3 references, deduplicates aliases and retains held/auxiliary/orphan bytes");

  for (const reference of [
    `https://unknown-historical.example/${audioKey}`,
    `/api/media?key=${encodeURIComponent("lectures/foreign-board/historical-turn/0.mp3")}`,
  ]) {
    const changed = structuredClone(fixture);
    changed.turns[0].segments[0].audioUrl = reference;
    reads.head.length = 0; reads.list.length = 0;
    await assert.rejects(accounting.measureStorageAccounting(changed), accounting.StorageVerificationError);
    assert.deepEqual(reads, { list: [], head: [] }, "unknown or foreign references fail before any object-store query");
    assert.equal(changed.storage!.reservedBytes, before.storage!.reservedBytes);
  }
  console.log("PASS: real accounting conservatively rejects unknown/foreign references without fetching or changing the ledger");

  for (const invalid of [
    { key: "lectures/foreign-board/historical-turn/metadata.json", bytes: 17 },
    { key: `${prefix}../another-turn/metadata.json`, bytes: 17 },
    { key: audioKey, bytes: -1 },
  ]) {
    inventory = [invalid]; reads.head.length = 0; reads.list.length = 0;
    await assert.rejects(accounting.measureStorageAccounting(fixture), accounting.StorageVerificationError);
    assert.equal(reads.list.length, 1); assert.equal(reads.head.length, 0);
    assert.deepEqual(fixture, before);
  }
  console.log("PASS: real accounting rejects cross-owner, traversal and invalid LIST sizes without assuming zero bytes");
  console.log("verify-storage-historical-accounting: 3 groups; object store is stubbed, no DB/provider/network writes");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = savedFetch;
  for (const name of environmentKeys) {
    const previous = beforeEnvironment[name];
    if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
  }
});
