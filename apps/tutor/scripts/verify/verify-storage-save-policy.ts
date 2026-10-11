/** Real save handlers and client at the HTTP boundary; only DB and object storage are adapters. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as drawing from "@heytutor/drawing";
import * as sceneEngine from "@heytutor/scene-engine";
import * as requestBody from "../../lib/http/requestBody";
import * as keys from "../../lib/object-store/keys";
import * as mediaUrl from "../../lib/object-store/mediaUrl";
import * as uploadLimits from "../../lib/scene/turnUploadLimits";
import * as turnStatus from "../../lib/boards/turnStatus";
import * as turnSaveRejection from "../../lib/boards/turnSaveRejection";
import * as storedSceneSource from "../../lib/scene/storedSceneSource";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { turnMetadataStorageBytes } from "../../lib/boards/storageAccounting";
import { saveFailureMessage } from "../../features/tutor-session/lib/turn/liveTurnSave";

const root = resolve(__dirname, "../..");
// The adapter deliberately accepts Prisma's query and JSON row shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
class StorageQuotaError extends Error {
  constructor(message: string, public status = 413, public code?: string) { super(message); }
}
class KnownRequestError extends Error {}
const DB_NULL = Symbol("DbNull");
const userId = "policy-owner";
const boardId = "policy-board";
const mp3 = new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2, 3, 4, 5, 6]);

function harness(nodeEnv: string, configured: boolean, uploadSucceeds: boolean) {
  const env = { NODE_ENV: nodeEnv, ...(configured ? { S3_BUCKET: "fixture-bucket" } : {}) };
  const turns: Row[] = [], segments: Row[] = [], reservations: Row[] = [];
  const uploads: string[] = [];
  const allowance = { userId, expiresAt: new Date(Date.now() + 60_000), savedTurnId: null };
  let shortenReservation = false;
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);
  const withSegments = (turn: Row | undefined) => turn ? {
    ...turn, segments: segments.filter(row => row.turnId === turn.id),
  } : null;
  const clean = (value: unknown) => value === DB_NULL ? null : value;
  const prisma: Row = {
    $queryRaw: async () => [{ id: boardId }],
    board: { findFirst: async () => ({ id: boardId, userId }), update: async () => ({}) },
    turn: {
      findFirst: async ({ where }: Row) => withSegments(turns.find(turn => matches(turn, where))),
      count: async () => turns.length,
      create: async ({ data }: Row) => {
        const turn = { status: "complete", kind: "lesson", checkpointSeq: 0, resumeState: null,
          submittedSegments: null, createdAt: new Date(), updatedAt: new Date(),
          ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, clean(value)])) };
        turns.push(turn);
        return { ...turn };
      },
      update: async ({ where, data }: Row) => {
        const turn = turns.find(row => row.id === where.id)!;
        Object.assign(turn, Object.fromEntries(Object.entries(data).map(([key, value]) => [key, clean(value)])));
        return { ...turn };
      },
    },
    segment: {
      createManyAndReturn: async ({ data }: Row) => {
        const inserted = data.map((row: Row) => ({ ...row, id: crypto.randomUUID() }));
        segments.push(...inserted);
        return inserted;
      },
      deleteMany: async ({ where }: Row) => {
        for (let index = segments.length - 1; index >= 0; index--) if (segments[index].turnId === where.turnId) segments.splice(index, 1);
      },
    },
    ownedTrace: { findUnique: async () => allowance, update: async ({ data }: Row) => Object.assign(allowance, data) },
  };
  prisma.$transaction = async (run: (tx: Row) => Promise<unknown>) => {
    const snapshot = { turns: turns.map(row => ({ ...row })), segments: segments.map(row => ({ ...row })) };
    try { return await run(prisma); }
    catch (error) {
      turns.splice(0, turns.length, ...snapshot.turns);
      segments.splice(0, segments.length, ...snapshot.segments);
      throw error;
    }
  };
  function load(relativePath: string, dependencies: Record<string, unknown>): Row {
    const override = relativePath === "lib/boards/turnCheckpoint.ts" ? process.env.CHECKPOINT_TEST_SOURCE
      : relativePath === "app/api/boards/[boardId]/turns/route.ts" ? process.env.TURN_POST_TEST_SOURCE
      : relativePath === "lib/boards/boardsClient.ts" ? process.env.BOARDS_CLIENT_TEST_SOURCE
      : relativePath === "lib/object-store/lectureAudioPersistence.ts" ? process.env.LECTURE_AUDIO_POLICY_TEST_SOURCE : undefined;
    const code = ts.transpileModule(readFileSync(override ?? resolve(root, relativePath), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: Row = {}, compiledModule = { exports };
    vm.runInNewContext(code, {
      module: compiledModule, exports, require: (name: string) => {
        if (!(name in dependencies)) throw new Error(`Missing adapter: ${name}`);
        return dependencies[name];
      },
      FormData, Blob, File, Request, Response, Headers, URL, Uint8Array, TextEncoder, TextDecoder,
      crypto, AbortSignal, console, setTimeout, process: { env },
      fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    }, { filename: relativePath });
    return compiledModule.exports;
  }
  const config = load("lib/object-store/config.ts", {});
  const policyPath = "lib/object-store/lectureAudioPersistence.ts";
  const policy = existsSync(resolve(root, policyPath)) ? load(policyPath, { "./config": config }) : {};
  const reserve = async (input: Row) => {
    const reservation = { ...input, bytes: input.bytes - (shortenReservation ? 1 : 0), state: "open" };
    reservations.push(reservation);
    return reservation;
  };
  const dependencies = {
    "@prisma/client": { Prisma: { DbNull: DB_NULL, PrismaClientKnownRequestError: KnownRequestError } },
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@heytutor/drawing": drawing,
    "@heytutor/scene-engine": sceneEngine,
    "@/lib/auth": { getUserId: async () => userId, ensureUser: async () => {} },
    "@/lib/db/prisma": { prisma },
    "@/lib/object-store/keys": keys,
    "@/lib/object-store/mediaUrl": mediaUrl,
    "@/lib/object-store/lectureAudioPersistence": policy,
    "@/lib/object-store/s3": { uploadAudio: async (key: string) => {
      uploads.push(key);
      return configured && uploadSucceeds ? mediaUrl.mediaProxyUrl(key) : null;
    } },
    "@/lib/http/requestBody": requestBody,
    "@/lib/boards/storageAccounting": { turnMetadataStorageBytes },
    "@/lib/boards/storageQuota": {
      StorageQuotaError, reserveTurnStorage: reserve, reserveTurnGrowthStorage: reserve,
      prepareStorageAccounting: async () => {}, refundTurnMetadataStorage: async () => {},
      abandonTurnStorage: async (reservation: Row) => { reservation.state = "abandoned"; },
      settleTurnStorage: async (reservation: Row, _refund: boolean, _tx: unknown, retained: number) => {
        reservation.state = "settled"; reservation.retained = retained;
      },
      withUserStorageLock: (_owner: string, run: (tx: Row) => Promise<unknown>) => prisma.$transaction(run),
    },
    "@/lib/obs/traceOwnership": { assertOwnedTrace: async () => true },
    "@/lib/scene/turnPersistencePolicy": { isTurnMetadataPersistable: () => true },
    "@/lib/scene/turnScenePersistence": { canonicalizeTurnSceneMetadata: (metadata: Row) =>
      canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(metadata))) },
    "@/lib/scene/turnUploadLimits": uploadLimits,
    "@/lib/boards/turnStatus": turnStatus,
    "@/lib/boards/turnSaveRejection": turnSaveRejection,
  };
  const post = load("app/api/boards/[boardId]/turns/route.ts", dependencies);
  const checkpoint = load("lib/boards/turnCheckpoint.ts", dependencies);
  const client = load("lib/boards/boardsClient.ts", {
    "@/lib/scene/storedSceneSource": storedSceneSource,
    "@heytutor/tutor-core": { speechAudioMimeType: () => "audio/mpeg", resolveApiUrl: (url: string) => `https://example.test${url}` },
    "@/lib/boards/boardTitle": { finalizeBoardTitle: () => "fixture" },
    "@/lib/boards/turnStatus": turnStatus,
  });
  const lesson = {
    question: "Explain constant speed.", rawResponse: "Distance is speed times time.",
    traceId: "policy-trace", visualStatus: "text_only", segments: [{ orderIndex: 0,
      narration: "Distance is speed times time.", spokenText: "Distance is speed times time.",
      command: { type: "WRITE", params: [90, 145, 28], text: "d = vt", charPosition: 0, narrationBefore: "" },
      durationMs: 900 }],
  };
  async function save(kind: "post" | "checkpoint", seq = 1) {
    const form = new FormData();
    const metadata = kind === "post" ? lesson : { ...lesson, segments: undefined, seq,
      baseCount: seq - 1, status: "live", appendSegments: lesson.segments.map(row => ({ ...row, orderIndex: seq - 1 })) };
    form.append("metadata", JSON.stringify(metadata));
    form.append(`audio-${seq - 1}`, new Blob([mp3], { type: "audio/mpeg" }));
    const turnId = "ab72f58e-67c9-4d00-8faa-242342089a04";
    const url = `https://example.test/api/boards/${boardId}/turns${kind === "checkpoint" ? `/${turnId}` : ""}`;
    const request = new Request(url, { method: kind === "post" ? "POST" : "PUT", body: form });
    const response = kind === "post" ? await post.POST(request, { params: Promise.resolve({ boardId }) })
      : await checkpoint.handleTurnCheckpoint(request, { boardId, turnId });
    return { status: response.status, body: await response.json() as Row };
  }
  return { save, turns, segments, uploads, reservations, client, lesson,
    shortenReservation: () => { shortenReservation = true; } };
}

async function main(testCase = process.env.STORAGE_SAVE_POLICY_CASE) {
  if (testCase === "accounting") {
    for (const kind of ["post", "checkpoint"] as const) {
      if (process.env.STORAGE_SAVE_POLICY_HANDLER && process.env.STORAGE_SAVE_POLICY_HANDLER !== kind) continue;
      const fixture = harness("development", true, true);
      fixture.shortenReservation();
      const rejected = await fixture.save(kind);
      assert.equal(rejected.status, 409, "an insufficient admission receipt cannot commit growth");
      assert.equal(rejected.body.code, "storage_accounting_changed", "accounting races identify a retryable refusal");
      assert.equal(fixture.turns.length, 0);
      assert.equal(fixture.reservations[0].state, "abandoned");
      const classified = fixture.client.classifySaveFailure(rejected.status, rejected.body);
      assert.equal(classified.reason, "storage_verification");
      assert.equal(classified.retryable, true);
      console.log(`PASS ${kind}: accounting race is explicit and retryable`);
    }
    return;
  }
  if (testCase === "client") {
    const fixture = harness("development", true, true);
    const classified = fixture.client.classifySaveFailure(409, {
      code: "storage_accounting_changed", error: "storage accounting changed; try saving again",
    });
    assert.equal(classified.reason, "storage_verification");
    assert.equal(classified.retryable, true);
    const originalFetch = globalThis.fetch;
    const requests: Array<{ body: FormData; key: string }> = [];
    globalThis.fetch = async (_url, init) => {
      requests.push({ body: init!.body as FormData, key: new Headers(init!.headers).get("Idempotency-Key")! });
      return requests.length === 1 ? Response.json({ code: "storage_accounting_changed",
        error: "storage accounting changed; try saving again" }, { status: 409 })
        : Response.json({ turn: { id: "recovered-turn", segments: [] } });
    };
    try {
      const payload = { ...fixture.lesson, speedMultiplier: 1,
        segments: fixture.lesson.segments.map(row => ({ ...row, audioBytes: mp3 })) };
      const result = await fixture.client.saveTurnResult(boardId, payload);
      assert.equal(result.ok, true, "the one-shot client retries the accounting race");
      assert.equal(requests.length, 2);
      assert.equal(requests[0].body, requests[1].body, "the pending lesson body survives retry");
      assert.equal(requests[0].key, requests[1].key, "the retry retains logical-save identity");
      assert.deepEqual(new Uint8Array(await (requests[1].body.get("audio-0") as File).arrayBuffer()), mp3);
      assert.equal(fixture.client.classifySaveFailure(409, { error: "refused" }).retryable, false,
        "unrelated 409 refusals remain final");
      globalThis.fetch = async () => Response.json({ code: "storage_accounting_changed",
        error: "storage accounting changed; try saving again" }, { status: 409 });
      const checkpoint = await fixture.client.checkpointTurn(boardId, "pending-turn", {
        seq: 1, status: "live", baseCount: 0, question: fixture.lesson.question,
        rawResponse: fixture.lesson.rawResponse, scene: { visualStatus: "text_only" }, segments: payload.segments,
      });
      assert.equal(checkpoint.ok, false);
      assert.equal(checkpoint.reason, "storage_verification");
      assert.equal(checkpoint.retryable, true, "the progressive consumer also schedules this payload for retry");
      assert.equal(saveFailureMessage(checkpoint),
        "We could not verify your storage, so this lesson has not saved. Keep this tab open and try again.");
      let permanentRequests = 0;
      globalThis.fetch = async () => {
        permanentRequests++;
        return Response.json({ error: "save refused" }, { status: 409 });
      };
      const permanent = await fixture.client.saveTurnResult(boardId, payload);
      assert.equal(permanent.ok, false);
      assert.equal(permanent.retryable, false);
      assert.equal(permanentRequests, 1, "the one-shot consumer does not retry an unrelated permanent 409");
      console.log("PASS client: accounting 409 retries unchanged lesson, idempotency and audio");
    } finally { globalThis.fetch = originalFetch; }
    return;
  }
  for (const kind of ["post", "checkpoint"] as const) {
    if (process.env.STORAGE_SAVE_POLICY_HANDLER && process.env.STORAGE_SAVE_POLICY_HANDLER !== kind) continue;
    for (const env of ["development", "test"]) {
      const fixture = harness(env, false, false);
      const saved = await fixture.save(kind);
      assert.equal(saved.status, 200, `${kind}: ${env} without storage saves the lesson metadata`);
      assert.equal(saved.body.turn.question, fixture.lesson.question);
      assert.equal(saved.body.turn.segments[0].audioUrl, null, "no durable audio URL is fabricated");
      assert.equal(saved.body.turn.segments[0].audioFormat, "audio/mpeg");
      assert.equal(saved.body.turn.segments[0].narration, fixture.lesson.segments[0].narration);
      assert.equal(fixture.uploads.length, 0, "metadata-only mode does not attempt object storage");
      assert.equal(fixture.turns[0].storageBytes, fixture.turns[0].metadataBytes, "absent audio costs zero stored bytes");
      assert.equal(fixture.reservations[0].state, "settled");
      assert.equal(BigInt(fixture.reservations[0].retained), fixture.turns[0].metadataBytes);
      if (kind === "checkpoint") {
        const appended = await fixture.save(kind, 2);
        assert.equal(appended.status, 200, "later metadata-only checkpoints also save");
        assert.equal(appended.body.turn.segments.length, 2);
        assert.equal(fixture.turns[0].storageBytes, fixture.turns[0].metadataBytes, "appending does not charge absent audio");
      }
      console.log(`PASS ${kind}: ${env} unconfigured metadata-only save`);
    }
    for (const [env, configured] of [["development", true], ["test", true], ["production", false], ["staging", false]] as const) {
      const fixture = harness(env, configured, false);
      const rejected = await fixture.save(kind);
      assert.equal(rejected.status, 503, `${kind}: ${env}/${configured} cannot silently drop required audio`);
      assert.equal(rejected.body.code, "storage_verification_failed");
      assert.match(rejected.body.error, /audio upload failed.*try saving again/i);
      assert.equal(fixture.turns.length, 0, "failed upload commits no lesson");
      assert.equal(fixture.reservations[0].state, "abandoned", "failed upload retains its durable cleanup path");
      const failure = fixture.client.classifySaveFailure(rejected.status, rejected.body);
      assert.equal(failure.reason, "storage_verification");
      assert.equal(failure.retryable, true, "the client retains and retries the original lesson payload");
      console.log(`PASS ${kind}: ${env}/${configured} required audio failure`);
    }
    const fixture = harness("development", true, true);
    const saved = await fixture.save(kind);
    assert.equal(saved.status, 200);
    assert.equal(fixture.uploads.length, 1);
    assert.equal(saved.body.turn.segments[0].audioUrl, mediaUrl.mediaProxyUrl(fixture.uploads[0]));
    assert.equal(fixture.turns[0].storageBytes - fixture.turns[0].metadataBytes, BigInt(mp3.length));
    console.log(`PASS ${kind}: configured audio saved and charged exactly`);
  }
  await main("accounting");
  await main("client");
  console.log("PASS storage save policy: 17 groups");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
