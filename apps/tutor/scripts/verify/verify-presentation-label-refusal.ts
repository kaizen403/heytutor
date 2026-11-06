/**
 * A figure whose label finds no place on the board is refused with a code at
 * the label step, never thrown. Both save routes answer 400 with that code,
 * and the browser's text resend saves the lesson. A saved figure's resume
 * save is unchanged; a resume of a refused figure saves as text. Reopen skips
 * a refused figure, and the live lesson and figure plans see no ink.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as drawing from "@heytutor/drawing";
import * as sceneEngine from "@heytutor/scene-engine";
import { SCENE_DOCUMENT_VERSION, compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import * as requestBody from "../../lib/http/requestBody";
import * as keys from "../../lib/object-store/keys";
import * as mediaUrl from "../../lib/object-store/mediaUrl";
import * as uploadLimits from "../../lib/scene/turnUploadLimits";
import * as turnStatus from "../../lib/boards/turnStatus";
import * as boardContinuation from "../../lib/boards/boardContinuation";
import * as doubtFigureRef from "../../lib/boards/doubtFigureRef";
import * as turnSaveRejection from "../../lib/boards/turnSaveRejection";
import * as storedSceneSource from "../../lib/scene/storedSceneSource";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { turnMetadataStorageBytes } from "../../lib/boards/storageAccounting";
import { sceneKeepsReferencePictureRows } from "../../lib/scene/referencePicturePersistence";
import { sentryBeforeSendLog } from "../../lib/obs/sentryPrivacy";
import { buildVerifiedDiagramPresentation, presentVerifiedDiagram } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { lessonPageRecord, partialTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";

// The adapter deliberately accepts Prisma's query and JSON row shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
console.warn = () => {};

const root = resolve(__dirname, "../..");
const QUESTION = "Mark the points on the figure.";
const plan = { schemaVersion: "turn-plan/v3", question: QUESTION, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
const artifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: plan, diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true };

/** Numbered points `gap` apart, each with its badge note, and two far points. */
function pointsFigure(count: number, gap: number): SceneDocument {
  const ids = Array.from({ length: count }, (_, index) => `p${index}`);
  const all = [...ids, "a", "b"];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: "figure" },
    source: { question: QUESTION, nonMetric: true, representationTier: "qualitative_verified" },
    entities: all.map((id) => ({ id, kind: "point", role: "point" })),
    constructions: [
      ...ids.map((id, index) => ({ id: `c_${id}`, operator: "point", inputs: { x: 700 + gap * (index % 4), y: 300 + gap * Math.floor(index / 4), coordinateSpace: "layout" }, outputs: [id] })),
      { id: "c_a", operator: "point", inputs: { x: 450, y: 120, coordinateSpace: "layout" }, outputs: ["a"] },
      { id: "c_b", operator: "point", inputs: { x: 1100, y: 600, coordinateSpace: "layout" }, outputs: ["b"] },
    ],
    requiredEntityIds: all,
    revealGroups: [{ id: "g", dependsOn: [], entityIds: all, narrationCue: "the points" }],
    assertions: [],
    annotations: ids.map((id, index) => ({ id: `n${index}`, kind: "badge", text: `${index + 1}`, targetIds: [id] })),
    quantities: [], relations: [], teachingTimeline: [],
  } as unknown as SceneDocument;
}
const crowded = pointsFigure(8, 0.5);
const spaced = pointsFigure(8, 40);
const rows = [{ orderIndex: 0, narration: "Here are the points.", spokenText: "Here are the points.", command: null }];
const metadataOf = (sceneDocument: SceneDocument, extra: Row = {}): SubmittedTurnSceneMetadata => ({
  question: QUESTION, rawResponse: "Here are the points.", segments: rows, visualStatus: "validated", sceneDocument,
  sceneArtifacts: artifacts, ...extra,
} as unknown as SubmittedTurnSceneMetadata);
const compiled = (document: SceneDocument) => {
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, "the figure compiles");
  return result.renderScene;
};

// --- The label step ---------------------------------------------------------
const refused = presentVerifiedDiagram(crowded, compiled(crowded), { originalQuestion: QUESTION });
assert.deepEqual(refused, { ok: false, code: "label_unplaced" }, "a label with no place refuses the figure with a code");
let noInk!: ReturnType<typeof buildVerifiedDiagramPresentation>;
assert.doesNotThrow(() => { noInk = buildVerifiedDiagramPresentation(crowded, compiled(crowded), { originalQuestion: QUESTION }); }, "the board's entry never throws on it");
assert.equal(verifiedDiagramHasDrawableInk(noInk.diagram), false, "a refused figure has no ink, which every board caller takes as no figure");
assert.equal(noInk.diagram.commands.length + noInk.diagram.anchors.length + noInk.introSegments.length, 0, "and no part, pointing target or intro row");
assert.equal(buildVerifiedDiagramPresentation(crowded, compiled(crowded), { layout: "code_lesson" }).diagram.layout, "code_lesson", "a refused code lesson figure keeps its board split");
const drawn = presentVerifiedDiagram(spaced, compiled(spaced), { originalQuestion: QUESTION });
assert(drawn.ok && verifiedDiagramHasDrawableInk(drawn.presentation.diagram), "the same points spaced out present with ink");
assert.deepEqual(buildVerifiedDiagramPresentation(spaced, compiled(spaced), { originalQuestion: QUESTION }), drawn.presentation, "both entries give one presentation for a figure that draws");
console.log("PASS label step: refusal code, no ink on the board entry, spaced figure unchanged");

// --- Admission and the canonicalizer, with each route's options ---------------
const admitted = admitStoredScene({ sceneDocument: crowded, sceneQuestion: QUESTION, turnPlan: sceneEngine.validateTurnPlanV3(plan, QUESTION).plan, submittedTier: "qualitative_verified" });
assert(!admitted.ok && admitted.code === "scene_label_unplaced", `admission refuses with its code: ${JSON.stringify(admitted).slice(0, 120)}`);
const logged = sentryBeforeSendLog({ message: "[turn-save-rejected]", attributes: { code: "scene_label_unplaced", status: 400, entryPoint: "checkpoint_put" } });
assert.equal(logged?.attributes?.code, "scene_label_unplaced", "the save log keeps the code");
console.log("PASS admission: refused with its code, and the save log keeps it");

// --- Both save routes, real handlers and canonicalizer ------------------------
const userId = "label-owner";
const boardId = "label-board";
const mp3 = new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2, 3, 4, 5, 6]);
class StorageQuotaError extends Error {
  constructor(message: string, public status = 413, public code?: string) { super(message); }
}
class KnownRequestError extends Error {}
const DB_NULL = Symbol("DbNull");

function harness(options: { canonicalize?: (metadata: Row, options?: Row) => Promise<unknown> } = {}) {
  const env = { NODE_ENV: "production", S3_BUCKET: "fixture-bucket" };
  const turns: Row[] = [], segments: Row[] = [];
  // One save allowance per trace, as each lesson and resume has its own.
  const allowances = new Map<string, Row>();
  const allowanceOf = (traceId: string) => {
    if (!allowances.has(traceId)) allowances.set(traceId, { traceId, userId, expiresAt: new Date(Date.now() + 60_000), savedTurnId: null });
    return allowances.get(traceId)!;
  };
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);
  const withSegments = (turn: Row | undefined) => turn ? { ...turn, segments: segments.filter(row => row.turnId === turn.id) } : null;
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
      findMany: async ({ where }: Row) => segments.filter(row => matches(row, where)),
      createManyAndReturn: async ({ data }: Row) => {
        const inserted = data.map((row: Row) => ({ ...row, id: crypto.randomUUID() }));
        segments.push(...inserted);
        return inserted;
      },
      deleteMany: async ({ where }: Row) => {
        for (let index = segments.length - 1; index >= 0; index--) if (segments[index].turnId === where.turnId) segments.splice(index, 1);
      },
    },
    ownedTrace: {
      findUnique: async ({ where }: Row) => allowanceOf(where.traceId),
      update: async ({ where, data }: Row) => Object.assign(allowanceOf(where.traceId), data),
    },
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
    const code = ts.transpileModule(readFileSync(resolve(root, relativePath), "utf8"), {
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
  const policy = load("lib/object-store/lectureAudioPersistence.ts", { "./config": config });
  const reserve = async (input: Row) => ({ ...input, state: "open" });
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
    "@/lib/object-store/s3": { uploadAudio: async (key: string) => mediaUrl.mediaProxyUrl(key) },
    "@/lib/http/requestBody": requestBody,
    "@/lib/boards/storageAccounting": { turnMetadataStorageBytes },
    "@/lib/boards/storageQuota": {
      StorageQuotaError, reserveTurnStorage: reserve, reserveTurnGrowthStorage: reserve,
      prepareStorageAccounting: async () => {}, refundTurnMetadataStorage: async () => {},
      abandonTurnStorage: async (reservation: Row) => { reservation.state = "abandoned"; },
      settleTurnStorage: async (reservation: Row) => { reservation.state = "settled"; },
      withUserStorageLock: (_owner: string, run: (tx: Row) => Promise<unknown>) => prisma.$transaction(run),
    },
    "@/lib/obs/traceOwnership": { assertOwnedTrace: async () => true },
    "@/lib/obs/failedTurnSentry": { queueFailedTurnSentry: async () => null },
    "@/lib/boards/boardContinuation": boardContinuation,
    "@/lib/boards/doubtFigureRef": doubtFigureRef,
    "@/lib/scene/pageFigureLoader": { pageFigureLoaderFor: () => async () => null, pageLessonFigureQuestionFor: () => async () => null, pageLessonCurveLabelsFor: () => async () => null, doubtFigurePageCheckFor: () => async () => false, lessonFigureStartFor: () => async () => "figure_1" },
    "@/lib/scene/turnPersistencePolicy": { isTurnMetadataPersistable: () => true },
    "@/lib/scene/referencePicturePersistence": { sceneKeepsReferencePictureRows },
    // Each route's own options reach the real canonicalizer: the kind, the stored question and the page loaders.
    "@/lib/scene/turnScenePersistence": { canonicalizeTurnSceneMetadata: options.canonicalize ?? ((metadata: Row, routeOptions?: Row) =>
      canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(metadata)), routeOptions)) },
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
  async function postTurn(metadata: Row) {
    const form = new FormData();
    form.append("metadata", JSON.stringify({ traceId: crypto.randomUUID(), ...metadata }));
    form.append("audio-0", new Blob([mp3], { type: "audio/mpeg" }));
    const response = await post.POST(new Request(`https://example.test/api/boards/${boardId}/turns`, { method: "POST", body: form }), { params: Promise.resolve({ boardId }) });
    return { status: response.status, body: await response.json() as Row };
  }
  async function putCheckpoint(turnId: string, seq: number, metadata: Row) {
    const form = new FormData();
    const { segments: rowsToSend, ...header } = metadata;
    form.append("metadata", JSON.stringify({ traceId: `trace-${turnId}`, ...header, seq, baseCount: seq - 1, status: "live",
      appendSegments: (rowsToSend as Row[]).map(row => ({ ...row, orderIndex: seq - 1 })) }));
    form.append(`audio-${seq - 1}`, new Blob([mp3], { type: "audio/mpeg" }));
    const response = await checkpoint.handleTurnCheckpoint(new Request(`https://example.test/api/boards/${boardId}/turns/${turnId}`, { method: "PUT", body: form }), { boardId, turnId });
    return { status: response.status, body: await response.json() as Row };
  }
  async function closeTurn(turnId: string, body: Row) {
    const response = await checkpoint.handleTurnClose(new Request(`https://example.test/api/boards/${boardId}/turns/${turnId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ traceId: `trace-${turnId}`, ...body }),
    }), { boardId, turnId });
    return { status: response.status, body: await response.json() as Row };
  }
  return { postTurn, putCheckpoint, closeTurn, turns, client };
}

/** What the browser resends after a 400: the page's plan, no figure (Decision 7, `partialTurnScene`). */
function textResend(kind: "lesson" | "resume", sceneArtifacts: Row): Row {
  const page = lessonPageRecord(boardId, QUESTION);
  const scene = partialTurnScene({ ...page, figureDrawn: false, turn: { ...page.turn, kind, scene: { sceneDocument: crowded, sceneEngineVersion: null, validationReport: null, visualStatus: "validated", sceneArtifacts } } });
  return { question: QUESTION, rawResponse: "Here are the points.", segments: rows, ...scene };
}

const LESSON_ID = "6c3f1d0e-5b7a-4c2e-9f10-2a6b8d4e1c01";
const RESUME_ID = "6c3f1d0e-5b7a-4c2e-9f10-2a6b8d4e1c02";
const REFUSED_LESSON_ID = "6c3f1d0e-5b7a-4c2e-9f10-2a6b8d4e1c03";
const REFUSED_RESUME_ID = "6c3f1d0e-5b7a-4c2e-9f10-2a6b8d4e1c04";
const resumeArtifacts = { ...artifacts, ...boardContinuationArtifacts(QUESTION) };

async function main() {
  // The lesson route (POST).
  {
    const fixture = harness();
    const rejected = await fixture.postTurn(metadataOf(crowded));
    assert.equal(rejected.status, 400, `the lesson route answers 400, not a server error: ${JSON.stringify(rejected.body).slice(0, 160)}`);
    assert.equal(rejected.body.code, "scene_label_unplaced");
    assert.equal(fixture.turns.length, 0, "nothing is written for the refused figure");
    const failure = fixture.client.classifySaveFailure(rejected.status, rejected.body);
    assert.equal(failure.reason, "refused", "the browser reads it as a refusal, so it resends the lesson as text");
    assert.equal(failure.retryable, false, "and does not retry the figure");
    const resent = await fixture.postTurn(textResend("lesson", artifacts));
    assert.equal(resent.status, 200, `the text resend saves: ${JSON.stringify(resent.body).slice(0, 160)}`);
    assert.equal(fixture.turns[0]?.visualStatus, "text_only");
    assert.equal(fixture.turns[0]?.sceneDocument ?? null, null, "with no figure");
    const drawnPost = await harness().postTurn(metadataOf(spaced));
    assert.equal(drawnPost.status, 200, "the same points spaced out save with their figure");
    assert.equal(drawnPost.body.turn.visualStatus, "validated");
    console.log("PASS lesson route: 400 with the code, the text resend saves, a figure that draws is unchanged");
  }

  // The checkpoint route (PUT), a lesson and its resume.
  {
    const fixture = harness();
    const lesson = await fixture.putCheckpoint(LESSON_ID, 1, metadataOf(spaced, { kind: "lesson" }));
    assert.equal(lesson.status, 200, `a lesson with a figure that draws saves: ${JSON.stringify(lesson.body).slice(0, 160)}`);
    assert.equal(lesson.body.turn.visualStatus, "validated");
    // Rule 3: the saved figure's next resume save passes as on dev.
    const resume = await fixture.putCheckpoint(RESUME_ID, 1, metadataOf(spaced, { kind: "resume", sceneArtifacts: resumeArtifacts }));
    assert.equal(resume.status, 200, `the saved figure's resume save passes: ${JSON.stringify(resume.body).slice(0, 160)}`);
    assert.equal(resume.body.turn.visualStatus, "validated", "with its figure");
    const again = await fixture.putCheckpoint(RESUME_ID, 2, metadataOf(spaced, { kind: "resume", sceneArtifacts: resumeArtifacts }));
    assert.equal(again.status, 200, "and its next checkpoint too");

    const rejected = await fixture.putCheckpoint(REFUSED_LESSON_ID, 1, metadataOf(crowded, { kind: "lesson" }));
    assert.equal(rejected.status, 400, `the checkpoint route answers 400, not a server error: ${JSON.stringify(rejected.body).slice(0, 160)}`);
    assert.equal(rejected.body.code, "scene_label_unplaced");
    assert.equal(fixture.turns.some(turn => turn.id === REFUSED_LESSON_ID), false, "nothing is written for the refused figure");
    assert.equal(fixture.client.classifySaveFailure(rejected.status, rejected.body).reason, "refused");
    const resent = await fixture.putCheckpoint(REFUSED_LESSON_ID, 1, textResend("lesson", artifacts));
    assert.equal(resent.status, 200, `the text resend saves: ${JSON.stringify(resent.body).slice(0, 160)}`);
    assert.equal(resent.body.turn.visualStatus, "text_only");

    // A resume of a figure that no longer presents (a board saved before an engine change) saves as text.
    const resumeRejected = await fixture.putCheckpoint(REFUSED_RESUME_ID, 1, metadataOf(crowded, { kind: "resume", sceneArtifacts: resumeArtifacts }));
    assert.equal(resumeRejected.status, 400, `a resume of a refused figure answers 400: ${JSON.stringify(resumeRejected.body).slice(0, 160)}`);
    assert.equal(resumeRejected.body.code, "scene_label_unplaced");
    const resumeResent = await fixture.putCheckpoint(REFUSED_RESUME_ID, 1, { ...textResend("resume", resumeArtifacts), kind: "resume" });
    assert.equal(resumeResent.status, 200, `the resume's text resend saves: ${JSON.stringify(resumeResent.body).slice(0, 160)}`);
    assert.equal(resumeResent.body.turn.visualStatus, "text_only");
    assert(boardContinuation.boardContinuationOf(fixture.turns.find(turn => turn.id === REFUSED_RESUME_ID)?.sceneArtifacts), "and stays on the lesson's page");
    console.log("PASS checkpoint route: lesson and resume refuse with the code, text resends save, a saved figure's resume passes");
  }

  // The keepalive close of a live turn whose stored figure no longer presents
  // (a board saved before an engine change): its rows are refused, the turn closes.
  {
    const CLOSE_ID = "6c3f1d0e-5b7a-4c2e-9f10-2a6b8d4e1c05";
    const PLACED_ID = "6c3f1d0e-5b7a-4c2e-9f10-2a6b8d4e1c06";
    const fixture = harness();
    const row = (orderIndex: number) => ({ orderIndex, narration: "And the last point.", spokenText: "And the last point.", command: null });
    assert.equal((await fixture.putCheckpoint(CLOSE_ID, 1, metadataOf(spaced, { kind: "lesson" }))).status, 200);
    assert.equal((await fixture.putCheckpoint(PLACED_ID, 1, metadataOf(spaced, { kind: "lesson" }))).status, 200);
    const live = fixture.turns.find(turn => turn.id === CLOSE_ID)!;
    assert.equal(live.status, "live");
    live.sceneDocument = JSON.parse(JSON.stringify(crowded));
    const closed = await fixture.closeTurn(CLOSE_ID, { seq: 2, status: "stopped", baseCount: 1, appendSegments: [row(1)] });
    assert.equal(closed.status, 400, `the close answers 400, not a server error: ${JSON.stringify(closed.body).slice(0, 160)}`);
    assert.equal(closed.body.code, "scene_label_unplaced");
    assert.equal(live.status, "stopped", "and the live turn still closes to stopped");
    const placed = await fixture.closeTurn(PLACED_ID, { seq: 2, status: "stopped", baseCount: 1, appendSegments: [row(1)] });
    assert.equal(placed.status, 200, `a close on a figure that places saves: ${JSON.stringify(placed.body).slice(0, 160)}`);
    assert.equal(placed.body.turn.visualStatus, "validated");
    assert(placed.body.turn.segments.some((segment: Row) => segment.narration === "And the last point."), "with its appended row");
    console.log("PASS close: a stored figure that no longer presents answers 400 and the turn stops; one that places saves");
  }

  // Only a label with no place is a refusal. Any other throw from the save is
  // not turned into one: both routes let it out, which Next answers with a 500
  // (verify-presentation-throw-escapes holds the step from presentation to here).
  {
    const throwing = harness({ canonicalize: async () => { throw new TypeError("presentation failed"); } });
    await assert.rejects(throwing.postTurn(metadataOf(spaced)), TypeError, "the lesson route lets another error out");
    await assert.rejects(throwing.putCheckpoint(REFUSED_LESSON_ID, 1, metadataOf(spaced, { kind: "lesson" })), TypeError, "the checkpoint route lets another error out");
    assert.equal(throwing.turns.length, 0, "and writes nothing");
    console.log("PASS other errors: both routes let a save error out instead of refusing it");
  }

  // Reopen skips a refused figure; a figure that draws reopens.
  const storedTurn = (sceneDocument: SceneDocument) => ({ question: QUESTION, sceneDocument, sceneArtifacts: artifacts }) as Parameters<typeof restoreVerifiedPresentationFromTurn>[0];
  let reopened: ReturnType<typeof restoreVerifiedPresentationFromTurn> = null;
  assert.doesNotThrow(() => { reopened = restoreVerifiedPresentationFromTurn(storedTurn(crowded)); }, "reopen never throws on it");
  assert.equal(reopened, null, "reopen skips the refused figure");
  assert(restoreVerifiedPresentationFromTurn(storedTurn(spaced)), "a figure that draws reopens");
  console.log("PASS reopen: a refused figure is skipped, a figure that draws reopens");
  console.log("PASS presentation label refusal: 7 groups");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
