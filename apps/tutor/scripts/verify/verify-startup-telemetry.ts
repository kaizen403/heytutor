/**
 * Startup latency telemetry: the clock starts at the Ask click, checkpoints
 * send each event once, a hidden or closed page keeps what was measured, the
 * startup timeline survives a full buffer, first audible fires once per turn,
 * and the report reads it all back. Fake clocks and fake transports only; no
 * network, no dev server.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-startup-telemetry.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { TutorSegment } from "@heytutor/drawing";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import type { TurnTelemetryEvent } from "../../lib/obs/langfuse";
import type { PlaybackStartSignal } from "@heytutor/tutor-core";
import {
  MAX_TELEMETRY_BODY_BYTES,
  MAX_TURN_TELEMETRY_EVENTS,
  STARTUP_PRIORITY_EVENTS,
  createTurnTelemetry,
  measureSceneCandidateValidation,
  measureSceneSelection,
  recordFirstAudible,
  recordTtsFirstByte,
  type TurnTelemetry,
  type TurnTelemetryEnv,
} from "../../lib/obs/turnTelemetry";
import { createPageLoadTiming } from "../../lib/obs/pageLoadTiming";
import {
  STAGE_CAPS_MS,
  formatSummary,
  formatTurn,
  parseArgs,
  parseLabRun,
  parseLangfuseTrace,
  percentile,
  summarizeTurns,
} from "../latency/startup-report";
import type { UseSegmentRunnerParams } from "../../features/tutor-session/hooks/turn/types";
import { StreamingSpeechClient } from "../../../../packages/tutor-core/src/tts/streamingSpeechClient";

const WALL_AT_ZERO = Date.UTC(2026, 9, 4, 9, 0, 0);
/** Student text that must never reach a telemetry payload. */
const STUDENT_TEXT = "A 2 kg block slides down a 30 degree incline";

interface SentBatch {
  traceId: string;
  sessionId?: string;
  events: TurnTelemetryEvent[];
  traceMetadata?: Record<string, unknown>;
  beacon: boolean;
}

function harness(start = 0) {
  const clock = { now: start };
  const batches: SentBatch[] = [];
  const pageWindow = new EventTarget();
  const pageDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const env: TurnTelemetryEnv = {
    now: () => clock.now,
    wallNow: () => WALL_AT_ZERO + clock.now,
    send: async (body, { beacon }) => {
      batches.push({ ...(JSON.parse(body) as Omit<SentBatch, "beacon">), beacon });
    },
    window: pageWindow,
    document: pageDocument,
  };
  const names = () => batches.flatMap((batch) => batch.events.map((event) => event.name));
  return { clock, batches, env, pageWindow, pageDocument, names };
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

type BoardCommitOutcome = "created" | "not_created" | "failed" | "not_called";
interface MeasuredBoardCommit {
  committed: boolean;
  metadata: {
    board_commit_ms: number;
    board_commit_total_ms: number | null;
    board_commit_called: boolean;
    board_commit_result: BoardCommitOutcome;
  };
}

/** Execute the production measurement and payload expressions, not a test copy. */
function loadBoardCommitMeasurement(source: string) {
  const file = ts.createSourceFile("useQuestionHandler.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, ts.VariableStatement>();
  let wait: ts.ExpressionStatement | undefined;
  let payload: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, node);
      }
    }
    if (ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression) &&
      node.expression.expression.getText(file) === "boardCommitted") wait = node;
    if (ts.isCallExpression(node) && node.expression.getText(file) === "tel.mark" &&
      node.arguments[0]?.getText(file) === '"startup-ask"' &&
      node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) payload = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(file);
  const declaration = (name: string) => {
    const node = declarations.get(name);
    assert(node, `the actual handler owns the ${name} measurement`);
    return node;
  };
  const start = declaration("boardCommitStartedAt");
  const commit = declaration("boardCommitted");
  const waitStart = declaration("boardCommitWaitStartedAt");
  const waitEnd = declaration("beginTurnStartedAt");
  assert(wait && payload, "execute the actual board await and startup-ask payload");
  assert(start.pos < commit.pos && commit.pos < waitStart.pos && waitStart.pos < wait.pos && wait.pos < waitEnd.pos,
    "callback starts before setup work; remaining wait is measured only around its await");
  const startupPayload = payload;
  const properties = ["board_commit_ms", "board_commit_total_ms", "board_commit_called", "board_commit_result"].map((name) => {
    const property = startupPayload.properties.find((node) => ts.isPropertyAssignment(node) && node.name.getText(file) === name);
    assert(property, `the production payload must expose ${name}`);
    return property.getText(file);
  });
  const compiled = ts.transpileModule(`return (async () => {
    ${source.slice(start.getStart(file), commit.end)}
    workBeforeAwait();
    ${waitStart.getText(file)}
    ${wait.getText(file)}
    ${waitEnd.getText(file)}
    return { metadata: { ${properties.join(",")} }, committed: await boardCommitted };
  })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("commitDraftBoard", "performance", "workBeforeAwait", compiled) as (
    commitDraftBoard: (() => Promise<boolean>) | undefined,
    performance: { now(): number },
    workBeforeAwait: () => void,
  ) => Promise<MeasuredBoardCommit>;
}

async function checkBoardCommitOutcome(source: string, outcome: BoardCommitOutcome) {
  const measure = loadBoardCommitMeasurement(source);
  const clock = { now: 1_000 };
  let resolve!: (created: boolean) => void;
  let reject!: (error: unknown) => void;
  const callbackPromise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  const originalError = new Error(STUDENT_TEXT);
  let called = 0;
  let work = 0;
  const callback = outcome === "not_called" ? undefined : () => {
    called++;
    assert.equal(work, 0, "the actual callback starts immediately, before setup work or await");
    return callbackPromise;
  };
  const pending = measure(callback, { now: () => clock.now }, () => {
    work++;
    clock.now += 350; // UI/title/ref setup overlaps the already-running callback.
  });
  assert.equal(called, outcome === "not_called" ? 0 : 1, "measurement never repeats the callback");
  assert.equal(work, 1, "setup work happens before the commit await");
  if (outcome !== "not_called") {
    clock.now += 300;
    if (outcome === "failed") reject(originalError);
    else resolve(outcome === "created");
  }
  const result = await pending;
  assert.equal(result.committed, outcome === "created", "true/false and the existing rejection-to-false behavior remain unchanged");
  assert.deepEqual(result.metadata, {
    board_commit_ms: outcome === "not_called" ? 0 : 300,
    board_commit_total_ms: outcome === "not_called" ? null : 650,
    board_commit_called: outcome !== "not_called",
    board_commit_result: outcome,
  }, `${outcome}: actual callback total includes work before await; remaining wait does not`);
  assert(!JSON.stringify(result.metadata).includes(STUDENT_TEXT), "callback failures expose only the allowlisted outcome, never error text");
  return result;
}

async function verifyBoardCommitMeasurement() {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  for (const outcome of ["created", "not_created", "failed", "not_called"] as const) {
    await checkBoardCommitOutcome(source, outcome);
  }
  const originalError = new Error(STUDENT_TEXT);
  await assert.rejects(loadBoardCommitMeasurement(source)(() => { throw originalError; }, { now: () => 0 }, () => {}),
    (error: unknown) => error === originalError, "a synchronous callback throw retains its exact original error identity");

  // These mutants passed the old hardcoded report tests. Execute the same
  // production seam to prove the new callback/payload assertions reject them.
  const mutants: Array<[string, string, string, BoardCommitOutcome]> = [
    ["remaining wait as total", "board_commit_total_ms: boardCommitTotalMs", "board_commit_total_ms: Math.round(beginTurnStartedAt - boardCommitWaitStartedAt)", "created"],
    ["swapped boolean outcomes", 'created ? "created" : "not_created"', 'created ? "not_created" : "created"', "created"],
    ["mislabelled rejection", 'boardCommitResult = "failed"', 'boardCommitResult = "not_created"', "failed"],
    ["mislabelled absent callback", '= "not_called";', '= "not_created";', "not_called"],
    ["absent callback counted as called", "board_commit_called: Boolean(commitDraftBoard)", "board_commit_called: true", "not_called"],
  ];
  for (const [name, before, after, outcome] of mutants) {
    assert(source.includes(before), `${name}: the mutation must target the real production expression`);
    await assert.rejects(checkBoardCommitOutcome(source.replace(before, after), outcome), assert.AssertionError,
      `${name}: the measurement gate must fail, not accept a fabricated callback duration/outcome`);
  }
}

/** Completion diagnostics never become a candidate or student-text authority. */
async function verifyCandidateValidationTiming() {
  assert.equal(typeof measureSceneCandidateValidation, "function", "candidate timing helper must exist before instrumentation can claim this stage");
  const h = harness(2_000);
  const tel = createTurnTelemetry({ originPerf: 1_000, env: h.env });
  tel.setTrace("trace-candidate-timing", "board-1");
  const result = { valid: true, value: { sourceText: STUDENT_TEXT }, errors: [] };
  let validations = 0;
  const measured = measureSceneCandidateValidation(tel, { validationCallIndex: 1, context: "search" }, () => {
    validations++;
    h.clock.now += 35;
    return result;
  }, () => h.clock.now);
  assert.equal(measured, result, "diagnostics return the exact validator result, not a reconstructed candidate");
  assert.equal(validations, 1, "measuring must not repeat validation or compile");
  const invalid = { valid: false, errors: [{ message: STUDENT_TEXT }] };
  h.clock.now = 2_100;
  assert.equal(measureSceneCandidateValidation(tel, { validationCallIndex: 2, context: "revalidate" }, () => {
    h.clock.now += 12;
    return invalid;
  }, () => h.clock.now), invalid, "invalid result identity and errors also remain untouched");
  const originalError = new Error(STUDENT_TEXT);
  h.clock.now = 2_200;
  assert.throws(() => measureSceneCandidateValidation(tel, { validationCallIndex: 3, context: "recovery" }, () => {
    h.clock.now += 9;
    throw originalError;
  }, () => h.clock.now), (error: unknown) => error === originalError,
  "the exact validator error must propagate, never a diagnostic replacement");
  await tel.flush();
  const completion = h.batches.flatMap((batch) => batch.events).filter((event) => event.name === "scene-candidate-validation");
  assert.equal(completion.length, 3, "each actual validation reports one fixed-name completion, including a throw");
  assert.deepEqual(completion.map((event) => event.metadata), [
    { validation_call_index: 1, context: "search", start_since_ask_ms: 1_000, duration_ms: 35, valid: true, completed: true, clock_domain: "browser_monotonic" },
    { validation_call_index: 2, context: "revalidate", start_since_ask_ms: 1_100, duration_ms: 12, valid: false, completed: true, clock_domain: "browser_monotonic" },
    { validation_call_index: 3, context: "recovery", start_since_ask_ms: 1_200, duration_ms: 9, valid: null, completed: false, clock_domain: "browser_monotonic" },
  ]);
  assert(!JSON.stringify(h.batches).includes(STUDENT_TEXT), "candidate results, raw errors, questions and source text never enter timing payloads");

  const brokenMark = { ...tel, mark: () => { throw new Error("diagnostic sink failed"); } };
  assert.equal(measureSceneCandidateValidation(brokenMark, { validationCallIndex: 4, context: "search" }, () => result, () => 2_500), result,
    "a throwing completion sink cannot discard a valid candidate");
  assert.throws(() => measureSceneCandidateValidation(brokenMark, { validationCallIndex: 5, context: "search" }, () => { throw originalError; }, () => 2_500),
    (error: unknown) => error === originalError, "a throwing sink cannot replace a genuine validator failure");
  const brokenOrigin = { ...tel, durationMs: () => { throw new Error("diagnostic origin failed"); } };
  assert.equal(measureSceneCandidateValidation(brokenOrigin, { validationCallIndex: 6, context: "search" }, () => result, () => 2_500), result,
    "a throwing telemetry origin does not stop validation");
  assert.equal(measureSceneCandidateValidation(tel, { validationCallIndex: 7, context: "search" }, () => result,
    () => { throw new Error("diagnostic clock failed"); }), result, "a throwing measurement clock does not stop validation");
  assert.equal(measureSceneCandidateValidation(null, { validationCallIndex: 8, context: "recovery" }, () => result, () => 2_500), result,
    "no telemetry is a supported diagnostic no-op, not a refused candidate");
  assert.throws(() => measureSceneCandidateValidation(null, { validationCallIndex: 9, context: "recovery" }, () => { throw originalError; }, () => 2_500),
    (error: unknown) => error === originalError, "no telemetry preserves the original validator failure");
}

/** Pin the real live call, not a detached helper test that can stay green unwired. */
function timedHandlerCall(source: string, operation: string, helper: string, stage?: string) {
  const file = ts.createSourceFile("useQuestionHandler.ts", source, ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === operation) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(calls.length, 1, `one actual live ${operation} call remains in request order`);
  const operationCall = calls[0]!;
  let node: ts.Node | undefined = operationCall.parent;
  while (node && !(ts.isCallExpression(node) && node.expression.getText(file) === helper)) node = node.parent;
  assert(node && ts.isCallExpression(node), `the actual ${operation} call must remain inside ${helper}`);
  const wrapper = node;
  assert.equal(wrapper.arguments[0]?.getText(file), "tel", "the live turn telemetry receives the measured interval");
  assert(wrapper.arguments[2] && ts.isArrowFunction(wrapper.arguments[2]) &&
    !wrapper.arguments[2].modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
  "the timing callback stays synchronous, with no new await or request");
  assert.equal((wrapper.arguments[2] as ts.ArrowFunction).body, operationCall, "the callback only runs the unchanged selection/validation operation");
  if (stage) assert.equal(wrapper.arguments[1]?.getText(file), JSON.stringify(stage), "a fixed selection stage carries no student text");
  else assert.equal(wrapper.arguments[1]?.getText(file), "{ validationCallIndex: ++validationCallIndex, context }",
    "the index is honestly a validation call index, not a candidate identity");
  return { operationCall, wrapper, file };
}

function verifyHandlerTimingWiring() {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  for (const [operation, helper, stage] of [
    ["validateProductionSceneCandidate", "measureSceneCandidateValidation", undefined],
    ["selectFastVerifiedRepresentation", "measureSceneSelection", "fast"],
    ["selectProductionScene", "measureSceneSelection", "final"],
  ] as const) {
    const { operationCall, wrapper, file } = timedHandlerCall(source, operation, helper, stage);
    const passthrough = source.replace(wrapper.getText(file), operationCall.getText(file));
    assert.notEqual(passthrough, source, "the mutation replaces the real handler wrapper");
    assert.throws(() => timedHandlerCall(passthrough, operation, helper, stage),
      new RegExp(`must remain inside ${helper}`), `removing live ${operation} timing must make this gate RED`);
  }
}

async function verifySelectionTiming() {
  const h = harness(2_000);
  const tel = createTurnTelemetry({ originPerf: 1_000, env: h.env });
  tel.setTrace("trace-selection-timing");
  const result = { representation: { sourceText: STUDENT_TEXT } };
  const originalError = new Error(STUDENT_TEXT);
  const order: string[] = [];
  assert.equal(measureSceneSelection(tel, "fast", () => { order.push("fast"); h.clock.now += 30; return result; }, () => h.clock.now), result,
    "timing returns the exact fast selection without copying or inspecting it");
  assert.throws(() => measureSceneSelection(tel, "final", () => { order.push("final"); h.clock.now += 9; throw originalError; }, () => h.clock.now),
    (error: unknown) => error === originalError, "timing preserves the exact final selection error");
  assert.deepEqual(order, ["fast", "final"], "no selection repeats, defers, awaits or changes operation order");
  await tel.flush();
  assert.deepEqual(h.batches.flatMap((batch) => batch.events).map((event) => [event.name, event.metadata]), [
    ["scene-fast-selection", { start_since_ask_ms: 1_000, duration_ms: 30, completed: true, clock_domain: "browser_monotonic" }],
    ["scene-final-selection", { start_since_ask_ms: 1_030, duration_ms: 9, completed: false, clock_domain: "browser_monotonic" }],
  ], "combined callback time has a fixed stage and no result/error/scene metadata");
  assert(!JSON.stringify(h.batches).includes(STUDENT_TEXT), "selection results and errors stay out of telemetry");
  const parsed = parseLangfuseTrace({ id: "trace-selection-timing", observations: h.batches.flatMap((batch) => batch.events) });
  assert(parsed, "a trace of selection callback timings remains reportable");
  assert.deepEqual(parsed.stages, [
    { name: "scene-fast-selection", startMs: 1_000, durationMs: 30, capMs: null, hitCap: false },
    { name: "scene-final-selection", startMs: 1_030, durationMs: 9, capMs: null, hitCap: false },
  ], "the report reads the measured callback clocks, not completion mark offsets");
  const unknown = parseLangfuseTrace({ id: "selection-unknown", observations: [
    observation("scene-fast-selection", 5_000, 5_000, { start_since_ask_ms: 4_000, duration_ms: null }),
    observation("scene-final-selection", 8_000, 8_000, { start_since_ask_ms: 7_000 }),
  ] })!;
  assert(summarizeTurns([unknown]).stages.every((stage) => stage.count === 0 && stage.p50 === null),
    "a missing selection duration never becomes the known Ask-offset");
  const repeated = parseLangfuseTrace({ id: "selection-repeated", observations: [
    observation("scene-fast-selection", 500, 500, { start_since_ask_ms: 100, duration_ms: 30 }),
    observation("scene-fast-selection", 900, 900, { start_since_ask_ms: 800, duration_ms: 10 }),
  ] })!;
  assert.equal(repeated.stages[0]?.durationMs, 40, "repeated selection callbacks contribute recorded work once per turn");
  const brokenMark = { ...tel, mark: () => { throw new Error("diagnostic sink failed"); } };
  assert.equal(measureSceneSelection(brokenMark, "fast", () => result, () => h.clock.now), result);
  assert.throws(() => measureSceneSelection(brokenMark, "final", () => { throw originalError; }, () => h.clock.now),
    (error: unknown) => error === originalError, "a broken sink cannot replace the selection error");
  assert.equal(measureSceneSelection({ ...tel, durationMs: () => { throw new Error("bad origin"); } }, "fast", () => result), result);
  assert.equal(measureSceneSelection(tel, "final", () => null, () => { throw new Error("bad clock"); }), null,
    "a failed clock cannot turn text-only selection into a scene or a refusal");
  assert.equal(measureSceneSelection(null, "fast", () => result, () => { throw new Error("unused clock"); }), result);
  assert.throws(() => measureSceneSelection(null, "final", () => { throw originalError; }), (error: unknown) => error === originalError);
  for (const name of ["scene-fast-selection", "scene-final-selection"]) {
    assert(STARTUP_PRIORITY_EVENTS.some((stage) => String(stage) === name), "selection callback timings survive a noisy startup buffer");
  }
}

async function verifyOriginAtAsk() {
  const h = harness(1_000);
  const askAt = h.clock.now;
  // Board commit, billing and the board epoch take 3.2 s before telemetry exists.
  h.clock.now = 4_200;
  const tel = createTurnTelemetry({ originPerf: askAt, env: h.env });
  tel.setTrace("trace-origin", "board-1");
  assert.equal(tel.durationMs(), 3_200, "durationMs counts from the Ask click");
  tel.mark("startup-ask", { pre_telemetry_ms: tel.durationMs(), board_commit_ms: 400, begin_turn_ms: 2_500, board_epoch_ms: 300 });
  const planner = tel.span("planner");
  h.clock.now = 9_200;
  planner.end();
  await tel.flush();
  const events = h.batches.flatMap((batch) => batch.events);
  const startupAsk = events.find((event) => event.name === "startup-ask")!;
  const origin = Date.parse(startupAsk.startTime) - (startupAsk.metadata!.pre_telemetry_ms as number);
  assert.equal(origin, WALL_AT_ZERO + askAt, "startup-ask minus pre_telemetry_ms lands on the Ask wall time");
  const plannerEvent = events.find((event) => event.name === "planner")!;
  assert.equal(Date.parse(plannerEvent.startTime) - origin, 3_200);
  assert.equal(Date.parse(plannerEvent.endTime) - origin, 8_200);

  // An origin after creation is impossible; it falls back to creation time.
  const later = harness(500);
  const odd = createTurnTelemetry({ originPerf: 9_999, env: later.env });
  assert.equal(odd.durationMs(), 0);
  const noOrigin = createTurnTelemetry({ env: later.env });
  later.clock.now = 800;
  assert.equal(noOrigin.durationMs(), 300, "without an origin the clock starts at creation, as before");
}

async function verifyCheckpointOnce() {
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.mark("before-trace");
  await tel.checkpoint("no-trace-yet");
  assert.equal(h.batches.length, 0, "no trace id: nothing sent, nothing lost");
  tel.setTrace("trace-checkpoint");
  tel.mark("a");
  const planner = tel.span("planner");
  const child = tel.span("turn-plan", "planner");
  h.clock.now = 100;
  child.end({ attempt: 1 });
  tel.meta({ turn_kind: "lesson" });
  await tel.checkpoint("first-audible");
  assert.deepEqual(h.names(), ["before-trace", "a"], "a child waits while its parent span is open");
  assert.equal(h.batches[0]!.traceMetadata?.turn_kind, "lesson");
  h.clock.now = 200;
  planner.end();
  tel.mark("b");
  await tel.checkpoint("again");
  assert.deepEqual(h.names(), ["before-trace", "a", "turn-plan", "planner", "b"]);
  assert.equal(h.batches[1]!.traceMetadata, undefined, "unchanged metadata is not resent on a checkpoint");
  await tel.checkpoint("empty");
  assert.equal(h.batches.length, 2, "an empty checkpoint sends nothing");
  tel.mark("c");
  await tel.flush();
  assert.deepEqual(h.names(), ["before-trace", "a", "turn-plan", "planner", "b", "c"], "the final flush sends only the remainder");
  assert.equal(h.batches.at(-1)!.traceMetadata?.turn_kind, "lesson", "the final flush always carries metadata");
  const counts = new Map<string, number>();
  for (const name of h.names()) counts.set(name, (counts.get(name) ?? 0) + 1);
  assert(![...counts.values()].some((count) => count > 1), "every event is sent at most once");
  await tel.flush();
  assert.equal(h.batches.at(-1)!.events.length, 0, "a second flush cannot duplicate events");

  // A send that rejects never reaches the turn.
  const broken = createTurnTelemetry({ env: { ...h.env, send: async () => { throw new Error("offline"); } } });
  broken.setTrace("trace-broken");
  broken.mark("x");
  await broken.checkpoint("first-audible");
  await broken.flush();
}

async function verifyPageLifecycleCheckpoint() {
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.setTrace("trace-lifecycle");
  tel.watchPageLifecycle();
  tel.watchPageLifecycle();
  tel.mark("startup-ask", { pre_telemetry_ms: 0 });
  tel.span("planner");
  const child = tel.span("turn-plan", "planner");
  h.clock.now = 5_000;
  child.end();
  h.pageDocument.visibilityState = "visible";
  h.pageDocument.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(h.batches.length, 0, "a visible page does not checkpoint");
  h.pageDocument.visibilityState = "hidden";
  h.pageDocument.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(h.batches.length, 1, "the tab going hidden checkpoints once, even with two watch calls");
  const hidden = h.batches[0]!;
  assert.equal(hidden.beacon, true, "lifecycle checkpoints prefer the beacon");
  const marker = hidden.events.find((event) => event.name === "turn-checkpoint")!;
  assert.equal(marker.metadata?.reason, "hidden");
  assert.deepEqual(marker.metadata?.open_spans, ["planner"]);
  const orphan = hidden.events.find((event) => event.name === "turn-plan")!;
  assert.equal(orphan.metadata?.parent_open, true, "an abandoned page still sends a child of an open span, flagged");
  h.clock.now = 6_000;
  tel.mark("teaching-request");
  h.pageWindow.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.equal(h.batches.length, 2);
  assert.deepEqual(h.batches[1]!.events.map((event) => event.name), ["teaching-request", "turn-checkpoint"]);
  await tel.flush();
  const afterFlush = h.batches.length;
  h.pageWindow.dispatchEvent(new Event("pagehide"));
  h.pageDocument.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(h.batches.length, afterFlush, "the final flush unregisters the lifecycle listeners");

  // A page hidden before the trace id exists keeps the events for later.
  const early = harness();
  const pending = createTurnTelemetry({ env: early.env });
  pending.watchPageLifecycle();
  pending.mark("startup-ask");
  early.pageWindow.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.equal(early.batches.length, 0);
  pending.setTrace("trace-late");
  await pending.flush();
  assert(early.names().includes("startup-ask"));

  // No page at all (server, tests): watching is a no-op.
  const headless = createTurnTelemetry({ env: { ...h.env, window: null, document: null } });
  headless.watchPageLifecycle();

  // A flickering tab adds at most three checkpoint markers to one turn.
  const f = harness();
  const flicker = createTurnTelemetry({ env: f.env });
  flicker.setTrace("trace-flicker");
  flicker.watchPageLifecycle();
  f.pageDocument.visibilityState = "hidden";
  for (let i = 0; i < 6; i++) {
    f.pageDocument.dispatchEvent(new Event("visibilitychange"));
    await settle();
  }
  assert.equal(f.names().filter((name) => name === "turn-checkpoint").length, 3);
  await flicker.flush();

  // A turn that never flushed (replaced, or thrown out of planning) sends
  // once at the next page event, then lets go of the page.
  const s = harness();
  let current = true;
  const stranded = createTurnTelemetry({ env: s.env });
  stranded.setTrace("trace-stranded");
  stranded.watchPageLifecycle(() => current);
  stranded.mark("planner-started");
  current = false;
  s.pageWindow.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.equal(s.batches.length, 1, "a stranded turn still sends what it has");
  stranded.mark("late");
  s.pageWindow.dispatchEvent(new Event("pagehide"));
  s.pageDocument.visibilityState = "hidden";
  s.pageDocument.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(s.batches.length, 1, "and its listeners are gone after that");

  // The next turn watching the same page removes the last one's listeners.
  const n = harness();
  const older = createTurnTelemetry({ env: n.env });
  older.setTrace("trace-older");
  older.watchPageLifecycle(() => true);
  const newer = createTurnTelemetry({ env: n.env });
  newer.setTrace("trace-newer");
  newer.watchPageLifecycle(() => true);
  n.pageWindow.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.deepEqual(n.batches.map((batch) => batch.traceId), ["trace-newer"], "only the newest turn watches the page");
  await newer.flush();
}

async function verifyPriorityRetention() {
  assert(STARTUP_PRIORITY_EVENTS.some((name) => String(name) === "scene-candidate-validation"),
    "candidate completion is a protected startup stage, not evictable drawing noise");
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.setTrace("trace-pressure");
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) tel.mark("write-char-start", { index: i });
  for (const name of STARTUP_PRIORITY_EVENTS) {
    if (name === "planner" || name === "thinking") continue;
    tel.mark(name);
  }
  for (let i = 0; i < 40; i++) tel.mark("verified-scene-intro-queued");
  for (let i = 0; i < 500; i++) tel.mark("write-char-start", { index: i });
  const span = tel.span("scene-planner", "planner");
  span.end();
  await tel.flush();
  const sent = h.names();
  assert.equal(sent.length, MAX_TURN_TELEMETRY_EVENTS, "the buffer stays bounded");
  for (const name of STARTUP_PRIORITY_EVENTS) {
    if (name === "planner" || name === "thinking") continue;
    assert(sent.includes(name), `${name} survives a full buffer`);
  }
  assert.equal(sent.filter((name) => name === "verified-scene-intro-queued").length, 40, "decision events survive noise");
  assert(Number(h.batches.at(-1)!.traceMetadata?.telemetry_dropped_events) > 0, "drops are counted");

  // Startup events evict decision events, never the other way round.
  const d = harness();
  const decisions = createTurnTelemetry({ env: d.env });
  decisions.setTrace("trace-decisions");
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) decisions.mark("verified-scene-decision");
  decisions.mark("first-audible");
  decisions.mark("tts-first-byte");
  decisions.mark("write-char-start");
  await decisions.flush();
  const kept = d.names();
  assert(kept.includes("first-audible") && kept.includes("tts-first-byte"));
  assert(!kept.includes("write-char-start"));
  assert.equal(kept.length, MAX_TURN_TELEMETRY_EVENTS);

  // A checkpoint frees the buffer: what follows is not dropped.
  const c = harness();
  const roomy = createTurnTelemetry({ env: c.env });
  roomy.setTrace("trace-room");
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) roomy.mark("write-char-start");
  await roomy.checkpoint("first-audible");
  roomy.mark("write-char-start");
  await roomy.flush();
  assert.equal(c.names().length, MAX_TURN_TELEMETRY_EVENTS + 1);
}

async function verifyLargeBatchesSplit() {
  const h = harness();
  // Keepalive bodies share one quota: the next part may only leave once the
  // previous one has been handed over.
  let inFlight = 0;
  let maxInFlight = 0;
  const bodyBytes: number[] = [];
  const sequentialEnv: TurnTelemetryEnv = { ...h.env, send: async (body, options) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    bodyBytes.push(Buffer.byteLength(body));
    await new Promise((resolve) => setTimeout(resolve, 1));
    await h.env.send(body, options);
    inFlight--;
  } };
  const tel = createTurnTelemetry({ env: sequentialEnv });
  tel.setTrace("trace-split");
  // Two bytes per character: a char count would let these past the limit.
  for (let i = 0; i < MAX_TURN_TELEMETRY_EVENTS; i++) tel.mark("write-char-start", { padding: "é".repeat(120), index: i });
  tel.meta({ turn_kind: "lesson" });
  await tel.flush();
  assert(h.batches.length > 1, "a body past the keepalive limit is split");
  assert.equal(maxInFlight, 1, "split bodies are sent one after another, never together");
  assert(bodyBytes.every((bytes) => bytes <= MAX_TELEMETRY_BODY_BYTES), "every body fits in bytes, not characters");
  assert.equal(h.names().length, MAX_TURN_TELEMETRY_EVENTS);
  assert.equal(h.batches.filter((batch) => batch.traceMetadata).length, 1, "metadata rides on one part only");

  // A page going away gets exactly one body, startup events first.
  const l = harness();
  const leaving = createTurnTelemetry({ originPerf: 0, env: l.env });
  leaving.setTrace("trace-leaving");
  leaving.watchPageLifecycle();
  for (let i = 0; i < 300; i++) leaving.mark("write-char-start", { padding: "é".repeat(120), index: i });
  leaving.mark("startup-ask", { pre_telemetry_ms: 0 });
  leaving.mark("teaching-request");
  l.pageWindow.dispatchEvent(new Event("pagehide"));
  await settle();
  assert.equal(l.batches.length, 1, "a lifecycle checkpoint sends one body");
  assert(Buffer.byteLength(JSON.stringify(l.batches[0]!)) <= MAX_TELEMETRY_BODY_BYTES + 200);
  const leftNames = l.batches[0]!.events.map((event) => event.name);
  assert(leftNames.includes("startup-ask") && leftNames.includes("teaching-request") && leftNames.includes("turn-checkpoint"),
    "startup events go first when the body is full");
  assert(leftNames.length < 303, "what does not fit stays behind");
  await leaving.flush();
  assert.equal(l.names().length, 303, "the rest leaves later if the page comes back, still once each");
}

async function verifyFirstAudibleHelpers() {
  const h = harness();
  const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
  tel.setTrace("trace-audible");
  h.clock.now = 41_000;
  recordTtsFirstByte(tel, { segmentIndex: 0, sinceRequestMs: 812.4, transport: "ws", prefetched: false });
  recordFirstAudible(tel, { segmentIndex: 0, transport: "provider", signal: "audio-context-scheduled", leadMs: 40 });
  h.clock.now = 45_000;
  recordFirstAudible(tel, { segmentIndex: 1, transport: "provider", signal: "html-audio-playing", leadMs: 0 });
  await settle();
  assert.equal(h.batches.length, 1, "first audible checkpoints the turn");
  const audible = h.batches[0]!.events.filter((event) => event.name === "first-audible");
  assert.equal(audible.length, 1, "first-audible is emitted once per turn");
  assert.equal(audible[0]!.metadata?.since_ask_ms, 41_040, "a scheduled source counts its lead");
  assert.equal(h.batches[0]!.traceMetadata?.first_audible_since_ask_ms, 41_040);
  const firstByte = h.batches[0]!.events.find((event) => event.name === "tts-first-byte")!;
  assert.deepEqual(firstByte.metadata, { segment_index: 0, since_request_ms: 812, transport: "ws", prefetched: false });
  // Replay refs and verify fakes carry partial objects; the helpers must not throw.
  recordFirstAudible({ mark() {} } as unknown as TurnTelemetry, { segmentIndex: 0, transport: "browser", signal: "speech-synthesis-start", leadMs: 0 });
  recordFirstAudible(null, { segmentIndex: 0, transport: "browser", signal: "speech-synthesis-start", leadMs: 0 });
  recordTtsFirstByte({} as TurnTelemetry, { segmentIndex: 0, sinceRequestMs: 1, transport: "http", prefetched: true });
  assert.equal(audible[0]!.metadata?.muted, false);
  const m = harness();
  const muted = createTurnTelemetry({ originPerf: 0, env: m.env });
  muted.setTrace("trace-muted");
  recordFirstAudible(muted, { segmentIndex: 0, transport: "provider", signal: "html-audio-playing", leadMs: 0, muted: true });
  await settle();
  assert.equal(m.batches[0]!.events.find((event) => event.name === "first-audible")!.metadata?.muted, true,
    "a muted lesson still fires first-audible, flagged");
}

async function verifyPageLoadClock() {
  const perf = {
    current: 900,
    now() { return this.current; },
    getEntriesByType: (type: string) => type === "navigation"
      ? [{ type: "navigate", responseStart: 120.4, domContentLoadedEventEnd: 640.6, loadEventEnd: 0 }]
      : [],
  };
  const timing = createPageLoadTiming(perf);
  timing.markBoardReady();
  perf.current = 2_000;
  timing.markBoardReady();
  const first = timing.claimFirstTurnMeta(15_250.7);
  assert.deepEqual(first, {
    page_nav_type: "navigate",
    page_response_start_ms: 120,
    page_dom_content_loaded_ms: 641,
    page_load_ms: null,
    page_board_ready_ms: 900,
    ask_since_nav_ms: 15_251,
  });
  assert.equal(timing.claimFirstTurnMeta(30_000), null, "page fields ride on the first turn only");
  assert.equal(createPageLoadTiming(null).claimFirstTurnMeta(1), null);
}

/** Actual useSegmentRunner: one first-audible per turn, one first byte per segment. */
async function verifyRunnerSeam() {
  const requireApp = createRequire(new URL("../../package.json", import.meta.url));
  const react = { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
    useEffect: () => {}, useState: (value: unknown) => [value, () => {}] };
  const file = path.resolve(import.meta.dirname, "../../features/tutor-session/hooks/turn/useSegmentRunner.ts");
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  }, loaded, loaded.exports);
  const runSegmentHook = loaded.exports.useSegmentRunner as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner").useSegmentRunner;

  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener() {}, removeEventListener() {},
  } });
  try {
    const runTurn = async (lastStart: PlaybackStartSignal | null, mutedOutput = false) => {
    const h = harness();
    const tel = createTurnTelemetry({ originPerf: 0, env: h.env });
    tel.setTrace("trace-runner");
    h.clock.now = 30_000;
    let speakCalls = 0;
    const tts: TTSClient = {
      speak: async () => {},
      speakSegment: async (_text: string, options: SpeakSegmentOptions = {}) => {
        speakCalls++;
        // A recovery can re-deliver bytes; the mark stays once per segment.
        options.onFirstAudioByte?.({ transport: "ws", sinceRequestMs: 650, prefetched: speakCalls > 1 });
        options.onFirstAudioByte?.({ transport: "ws", sinceRequestMs: 990, prefetched: false });
        options.onStart?.();
        options.onEnd?.();
      },
      prewarm: async () => {}, playAudio: async () => {}, pause: () => {}, resume: () => {}, stop: () => {},
      get isPlaying() { return false; },
      getPlaybackPositionMs: () => 0,
      setPlaybackRate: () => {}, getPlaybackRate: () => 1,
      getLastPlaybackStart: () => lastStart,
      isMuted: () => mutedOutput,
    };
    const ref = <T,>(current: T) => ({ current });
    const params = {
      sessionId: "board-1", activeVerifiedDiagramRef: ref(null), cancelRef: ref(false), isPausedRef: ref(false),
      turnActiveRef: ref(true), turnGenerationRef: ref(1), turnTelemetryRef: ref(tel),
      turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), recordedSegmentsRef: ref([]), narrationSinceEpochRef: ref(""),
      currentTraceIdRef: ref("trace-runner"), narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()),
      setCurrentSegmentText: () => {}, ensureTTSClient: () => tts,
      cancellableDelay: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5))),
      raceWithCancel: async <T,>(promise: Promise<T>) => promise,
      reserveTextCommandPlacements: async (command: unknown) => [command],
      executeCommandWithCancel: async () => {},
      applyTurnPhase: () => {},
      onSpeechStartupStatus: () => {},
    } as unknown as UseSegmentRunnerParams;
    const runner = runSegmentHook(params);
    const first: TutorSegment = { narration: STUDENT_TEXT, command: null };
    const second: TutorSegment = { narration: "Resolve the weight along the slope.", command: null };
    await runner.runSegment(first, 0, [first, second], 1);
    h.clock.now = 34_000;
    await runner.runSegment(second, 1, [first, second], 1);
    await settle();
    await tel.flush();
    const events = h.batches.flatMap((batch) => batch.events);
    const audible = events.filter((event) => event.name === "first-audible");
    assert.equal(audible.length, 1, "the runner emits first-audible once per turn");
    const firstBytes = events.filter((event) => event.name === "tts-first-byte");
    assert.deepEqual(firstBytes.map((event) => event.metadata?.segment_index), [0, 1], "one first byte per segment");
    assert.equal(firstBytes[0]!.metadata?.since_request_ms, 650);
    assert(h.batches.length >= 2, "first audible checkpointed before the final flush");
    for (const batch of h.batches) {
      const body = JSON.stringify(batch);
      assert(!body.includes(STUDENT_TEXT) && !body.includes("Resolve the weight"), "no narration or question text in telemetry");
    }
    return audible[0]!.metadata!;
    };
    assert.deepEqual(
      { ...(await runTurn({ signal: "html-audio-playing", leadMs: 0 })) },
      { since_ask_ms: 30_000, segment_index: 0, transport: "provider", signal: "html-audio-playing", scheduled_lead_ms: 0, muted: false },
    );
    assert.deepEqual(
      { ...(await runTurn({ signal: "speech-synthesis-start", leadMs: 0 })) },
      { since_ask_ms: 30_000, segment_index: 0, transport: "browser", signal: "speech-synthesis-start", scheduled_lead_ms: 0, muted: false },
      "the provider's own browser fallback (mock mode, a suspended context) is reported as the browser voice",
    );
    assert.deepEqual(
      { ...(await runTurn(null)) },
      { since_ask_ms: 30_000, segment_index: 0, transport: "provider", signal: "unknown", scheduled_lead_ms: 0, muted: false },
      "no signal is unknown with no lead",
    );
    assert.equal((await runTurn({ signal: "audio-context-scheduled", leadMs: 45 }, true)).since_ask_ms, 30_045);
    assert.equal((await runTurn({ signal: "audio-context-scheduled", leadMs: 45 }, true)).muted, true);
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

/** Actual StreamingSpeechClient over HTTP with native audio: first byte and the playing signal. */
async function verifyStreamingClientSeam() {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let now = 10_000;
  class NativeAudio {
    static clips: NativeAudio[] = [];
    playbackRate = 1; preservesPitch = true; muted = false; volume = 1;
    duration = 2; paused = true;
    private startedAt: number | null = null;
    private positionSec = 0;
    onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror = null;
    constructor(public src = "") { if (src.startsWith("blob:")) NativeAudio.clips.push(this); }
    get currentTime() {
      return Math.min(this.duration, this.positionSec + (this.startedAt === null ? 0 : (now - this.startedAt) / 1000 * this.playbackRate));
    }
    set currentTime(position: number) { this.positionSec = position; if (!this.paused) this.startedAt = now; }
    async play() {
      if (!this.src.startsWith("blob:")) return;
      now += 30;
      if (this.paused) { this.paused = false; this.startedAt = now; }
      this.onplaying?.();
    }
    pause() { this.positionSec = this.currentTime; this.startedAt = null; this.paused = true; }
    finish() { this.pause(); this.positionSec = this.duration; this.onended?.(); }
    removeAttribute() { this.src = ""; }
    load() { this.pause(); this.positionSec = 0; }
  }
  const savedAuth = process.env.NEXT_PUBLIC_AUTH_DISABLED;
  delete process.env.NEXT_PUBLIC_AUTH_DISABLED;
  replace("performance", { now: () => now });
  replace("window", { setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms), clearTimeout: (id: number) => clearTimeout(id),
    addEventListener() {}, removeEventListener() {} });
  replace("location", { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" });
  class Utterance {
    onstart: (() => void) | null = null; onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null; onboundary: (() => void) | null = null;
    volume = 1; rate = 1; pitch = 1; lang = ""; voice: unknown = null;
    constructor(readonly text: string) {}
  }
  const utterances: Utterance[] = [];
  (globalThis as unknown as { window: Record<string, unknown> }).window.speechSynthesis = {
    getVoices: () => [], resume() {}, pause() {}, cancel() {}, speaking: false, pending: false,
    speak(utterance: Utterance) { utterances.push(utterance); },
  };
  replace("SpeechSynthesisUtterance", Utterance);
  let failStream = false;
  replace("Audio", NativeAudio);
  replace("WebSocket", class { static OPEN = 1; constructor() { throw new Error("no sockets in this verify"); } });
  replace("fetch", async (url: unknown) => {
    // A missing ticket keeps the client off the socket, so this stays offline.
    if (String(url).includes("ws-ticket")) return Response.json({});
    if (!String(url).includes("/api/tts/stream")) return Response.json({});
    if (failStream) return new Response("refused", { status: 400 });
    now += 700;
    return new Response(`${JSON.stringify({ audio_base64: Buffer.from([73, 68, 51, 1]).toString("base64") })}\n`);
  });
  try {
    const client = new StreamingSpeechClient();
    const firstBytes: unknown[] = [];
    let startSignal: unknown = null;
    const spoken = client.speakSegment("Gravity pulls the block down the slope.", {
      onFirstAudioByte: (info) => firstBytes.push(info),
      onStart: () => { startSignal = client.getLastPlaybackStart(); },
    });
    for (let i = 0; i < 200 && NativeAudio.clips.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(NativeAudio.clips.length, 1);
    await settle();
    const clip = NativeAudio.clips[0]!;
    assert.equal(clip.currentTime, 0);
    assert.equal(startSignal, null, "a playing event without media progress is not first audible");
    now += 150;
    // The client observes progress on its 100 ms native-media watchdog.
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert(clip.currentTime > 0, "the native clip advances before first audible is accepted");
    assert.deepEqual(startSignal, { signal: "html-audio-playing", leadMs: 0 });
    client.pause();
    const pausedAt = clip.currentTime;
    now += 200;
    assert.equal(clip.currentTime, pausedAt, "intentional pause freezes the fake native media clock");
    client.resume(); await settle();
    assert.equal(clip.currentTime, pausedAt, "resuming the same clip preserves its media position");
    now += 100;
    assert(clip.currentTime > pausedAt, "the resumed native media clock advances again");
    clip.finish();
    await spoken;
    assert.deepEqual(firstBytes, [{ transport: "http", sinceRequestMs: 700, prefetched: false }]);
    assert.deepEqual(startSignal, { signal: "html-audio-playing", leadMs: 0 }, "native playback reports the playing signal");

    // The provider fails and the browser voice speaks: its own signal, never
    // the previous segment's leftover.
    failStream = true;
    let fallbackSignal: unknown = "not started";
    const fallback = client.speakSegment("The normal force balances the rest.", {
      onStart: () => { fallbackSignal = client.getLastPlaybackStart(); },
    });
    await settle();
    assert.equal(client.getLastPlaybackStart(), null, "each segment starts with no signal");
    for (let i = 0; i < 200 && utterances.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(utterances.length, 1, "the failed stream fell back to the browser voice");
    utterances[0]!.onstart?.();
    utterances[0]!.onend?.();
    await fallback;
    assert.deepEqual(fallbackSignal, { signal: "speech-synthesis-start", leadMs: 0 });
    client.stop();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (savedAuth !== undefined) process.env.NEXT_PUBLIC_AUTH_DISABLED = savedAuth;
  }
}

function observation(name: string, startMs: number, endMs = startMs, metadata: Record<string, unknown> = {}) {
  return {
    id: `obs-${name}-${startMs}`,
    type: "SPAN",
    name,
    startTime: new Date(WALL_AT_ZERO + startMs).toISOString(),
    endTime: new Date(WALL_AT_ZERO + endMs).toISOString(),
    metadata: { ...metadata, client_reported: true },
  };
}

function verifyValidationTotals() {
  const turn = parseLangfuseTrace({ id: "validation-total", observations: [
    observation("scene-candidate-validation", 100, 100, { validation_call_index: 1, context: "search", duration_ms: 10 }),
    observation("scene-candidate-validation", 200, 200, { validation_call_index: 2, context: "revalidate", duration_ms: 20 }),
    observation("scene-candidate-validation", 300, 300, { validation_call_index: 3, context: "search", duration_ms: 30 }),
  ] })!;
  const durations = (value: typeof turn) => Object.fromEntries(value.stages.map((stage) => [stage.name, stage.durationMs]));
  assert.equal(durations(turn)["scene-candidate-validation-total"], 60, "per-turn validation total includes every recorded call once");
  assert.equal(durations(turn)["scene-candidate-validation-total:search"], 40, "search total includes repeated validations, not distinct candidates");
  assert.equal(durations(turn)["scene-candidate-validation-total:revalidate"], 20);
  assert(turn.stages.some((stage) => stage.name === "scene-candidate-validation:call-3:search"), "detail names honestly identify calls");
  const second = parseLangfuseTrace({ id: "second-total", observations: [
    observation("scene-candidate-validation", 100, 100, { validation_call_index: 1, context: "search", duration_ms: 100 }),
  ] })!;
  const summary = summarizeTurns([turn, second]).stages;
  assert.deepEqual(summary.find((stage) => stage.name === "scene-candidate-validation-total"),
    { name: "scene-candidate-validation-total", count: 2, p50: 60, p90: 100, capHits: 0 }, "aggregate validation samples are turn totals");
  assert(!summary.some((stage) => stage.name.startsWith("scene-candidate-validation:")), "call-position percentiles are not comparable across turns");
  const missing = parseLangfuseTrace({ id: "missing-total", observations: [
    observation("scene-candidate-validation", 100, 100, { validation_call_index: 1, context: "search", duration_ms: 10 }),
    observation("scene-candidate-validation", 200, 200, { validation_call_index: 2, context: "recovery", duration_ms: null }),
  ] })!;
  assert.equal(durations(missing)["scene-candidate-validation-total"], null, "one unknown call keeps the whole-turn total unknown");
  assert.equal(durations(missing)["scene-candidate-validation-total:search"], 10, "known context remains measurable");
  assert.equal(durations(missing)["scene-candidate-validation-total:recovery"], null);
  assert.equal(summarizeTurns([missing]).stages.find((stage) => stage.name === "scene-candidate-validation-total")?.count, 0,
    "unknown totals cannot become completion offsets or partial sums");
  assert(!missing.stages.some((stage) => stage.name === "scene-candidate-validation-total:revalidate"), "an absent context is not reported as zero work");
  const empty = parseLangfuseTrace({ id: "no-validation-events", observations: [observation("planner", 100, 500)] })!;
  assert(!empty.stages.some((stage) => stage.name.startsWith("scene-candidate-validation")), "no recorded validations cannot prove zero validation work");
  const printed = `${formatTurn(turn)}\n${formatSummary([turn])}`;
  assert(printed.includes("recorded call intervals") && printed.includes("not additive wall time"), "reports disclose partial capture and overlapping callback work");
  assert(printed.includes("first useful teaching audio is not measured"), "parser STEP time is never a useful-audio proxy");
}

function verifyReportParsing() {
  // Ask at 0; telemetry created 2.9 s later after commit, billing and the epoch.
  const trace = {
    id: "lf-trace-1",
    observations: [
      observation("startup-ask", 2_900, 2_900, { pre_telemetry_ms: 2_900, board_commit_ms: 300,
        board_commit_total_ms: 650, board_commit_called: true, board_commit_result: "created",
        begin_turn_ms: 2_100, board_epoch_ms: 400, queued_for_board_ms: 0 }),
      observation("thinking", 2_900, 47_000),
      observation("websocket-connect", 2_901, 3_300),
      observation("planner", 2_905, 2_905 + STAGE_CAPS_MS.planner!),
      observation("turn-plan", 2_910, 2_910 + STAGE_CAPS_MS["turn-plan"]! - 100),
      observation("problem-ir", 23_000, 30_000, { outcome: "deadline" }),
      observation("scene-planner", 30_000, 41_000),
      // These are completion marks. Their zero wall duration/mark time is
      // not the interval measured inside the deterministic validator.
      observation("scene-candidate-validation", 40_000, 40_000, { candidate_index: 1, context: "search",
        start_since_ask_ms: 38_000, duration_ms: 1_250, valid: true, completed: true, clock_domain: "browser_monotonic" }),
      observation("scene-candidate-validation", 40_700, 40_700, { candidate_index: 2, context: "search",
        start_since_ask_ms: 39_400, duration_ms: 1_100, valid: false, completed: true, clock_domain: "browser_monotonic" }),
      observation("scene-candidate-validation", 41_000, 41_000, { candidate_index: 3, context: "revalidate",
        start_since_ask_ms: 40_500, duration_ms: 350, valid: true, completed: true, clock_domain: "browser_monotonic" }),
      observation("teaching-request", 63_000),
      observation("teaching-hedge-start", 66_000),
      observation("teaching-first-token", 66_500),
      observation("teaching-hedge-winner", 66_600, 66_600, { winner: "hedge" }),
      observation("teaching-first-step", 67_200),
      observation("tts-first-byte", 68_000, 68_000, { segment_index: 0, since_request_ms: 640, transport: "ws" }),
      observation("tts-first-byte", 72_000, 72_000, { segment_index: 1, since_request_ms: 300, transport: "ws" }),
      observation("tts-browser-recovery", 69_000),
      observation("first-audible", 68_300, 68_300, { since_ask_ms: 68_340, signal: "audio-context-scheduled" }),
      observation("chat-llm", 63_100, 66_000),
    ],
  };
  const turn = parseLangfuseTrace(trace)!;
  assert.equal(turn.origin, "startup-ask");
  assert.equal(turn.askToFirstAudibleMs, 68_340);
  const stage = (name: string) => turn.stages.find((row) => row.name === name)!;
  assert.equal(stage("board-commit").durationMs, 300);
  assert.equal(stage("board-commit-total").durationMs, 650,
    "full commit callback elapsed is separate from remaining critical-path wait, not a replacement or a sum");
  assert.equal(stage("begin-turn").durationMs, 2_100);
  assert.equal(stage("thinking").startMs, 2_900);
  assert.equal(stage("planner").hitCap, true, "a stage at its deadline hit the cap");
  assert.equal(stage("turn-plan").hitCap, true, "within the jitter slack still counts");
  assert.equal(stage("problem-ir").hitCap, true, "a deadline outcome counts even under the cap");
  assert.equal(stage("scene-planner").hitCap, false);
  assert.deepEqual(turn.stages.filter((row) => row.name.startsWith("scene-candidate-validation:")), [
    { name: "scene-candidate-validation:call-1:search", startMs: 38_000, durationMs: 1_250, capMs: null, hitCap: false },
    { name: "scene-candidate-validation:call-2:search", startMs: 39_400, durationMs: 1_100, capMs: null, hitCap: false },
    { name: "scene-candidate-validation:call-3:revalidate", startMs: 40_500, durationMs: 350, capMs: null, hitCap: false },
  ], "each validation call interval survives repeated completion names and reads its local measured interval, not the wall marker");
  assert.equal(stage("teaching-first-token").startMs, 66_500);
  assert.equal(stage("tts-first-byte").durationMs, 640, "the first segment's first byte is reported");
  assert.deepEqual(turn.retries, ["teaching-hedge-start x1", "teaching-hedge-winner x1 (hedge)", "tts-browser-recovery x1"]);
  assert.equal(parseLangfuseTrace({ id: "tts-only", observations: [observation("tts-segment", 0, 10)] }), null);
  const legacy = parseLangfuseTrace({ id: "legacy", observations: [observation("planner", 5_000, 9_000), observation("first-audible", 12_000)] })!;
  assert.equal(legacy.origin, "earliest-event");
  assert.equal(legacy.askToFirstAudibleMs, null, "without startup-ask there is no Ask origin to measure from");
  const oldStartup = parseLangfuseTrace({ id: "old-startup", observations: [
    observation("startup-ask", 1_000, 1_000, { pre_telemetry_ms: 1_000, board_commit_ms: 200 }),
    observation("scene-candidate-validation", 5_000),
    observation("first-audible", 8_000),
  ] })!;
  assert.equal(oldStartup.stages.find((row) => row.name === "board-commit")!.durationMs, 200);
  assert.equal(oldStartup.stages.find((row) => row.name === "board-commit-total")?.durationMs ?? null, null,
    "old traces without a full callback duration stay unknown, not inferred from remaining wait");
  assert.equal(oldStartup.stages.find((row) => row.name.startsWith("scene-candidate-validation"))?.durationMs ?? null, null,
    "an old completion mark without measured interval metadata is unknown, never zero compiler time");
  const brokenClock = parseLangfuseTrace({ id: "broken-clock", observations: [
    observation("startup-ask", 1_000, 1_000, { pre_telemetry_ms: 1_000 }),
    observation("scene-candidate-validation", 8_000, 8_000, {
      candidate_index: 1, context: "search", start_since_ask_ms: 7_500, duration_ms: null,
    }),
  ] })!;
  assert.deepEqual(summarizeTurns([brokenClock]).stages.find((row) => row.name === "scene-candidate-validation-total"), {
    name: "scene-candidate-validation-total", count: 0, p50: null, p90: null, capHits: 0,
  }, "a missing validation duration cannot become its Ask-offset in the aggregate");

  const labRuns = [
    { probeId: "physics|3|impulse|hard", question: STUDENT_TEXT, timings: { planMs: 30_000, teachMs: 40_000, totalMs: 70_000 } },
    { probeId: "physics|4|work|hard", timings: { planMs: 50_000, teachMs: 20_000, totalMs: 70_500,
      stages: { "turn-plan": { ms: 20_000, capped: true }, "problem-ir": 9_000, "first-audible": { startMs: 61_000 } } } },
    { probeId: "physics|5|shm|easy", timings: { planMs: 10_000, teachMs: 15_000, totalMs: 25_000,
      stages: [{ name: "turn-plan", durationMs: 8_000 }, { name: "first-audible", startMs: 21_000 }] } },
  ];
  const labTurns = labRuns.map((run) => parseLabRun(run)!);
  assert.equal(labTurns[0]!.askToFirstAudibleMs, null);
  assert.equal(labTurns[1]!.askToFirstAudibleMs, 61_000);
  assert.equal(labTurns[1]!.stages.find((row) => row.name === "turn-plan")!.hitCap, true);
  assert.equal(labTurns[2]!.stages.find((row) => row.name === "turn-plan")!.durationMs, 8_000);
  assert.equal(parseLabRun({ probeId: "broken" }), null);
  const summary = summarizeTurns(labTurns);
  assert.equal(summary.askToFirstAudible.count, 2);
  assert.equal(summary.askToFirstAudible.p50, 21_000);
  assert.equal(summary.askToFirstAudible.p90, 61_000);
  const plan = summary.stages.find((row) => row.name === "plan")!;
  assert.deepEqual([plan.count, plan.p50, plan.p90], [3, 30_000, 50_000]);
  assert.equal(summary.stages.find((row) => row.name === "turn-plan")!.capHits, 1);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 90), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  const printed = `${formatTurn(turn)}\n${labTurns.map(formatTurn).join("\n")}\n${formatSummary(labTurns)}`;
  assert(printed.includes("ask to first audible: 68340 ms"));
  assert(printed.includes("p90"));
  assert(!printed.includes(STUDENT_TEXT), "the report never prints question text");
  assert.deepEqual(parseArgs(["a", "b", "--limit", "5"]), { traceIds: ["a", "b"], since: null, lab: null, limit: 5 });
  assert.equal(parseArgs(["--since", "2026-10-01T00:00:00Z"]).since, "2026-10-01T00:00:00Z");
  assert.equal(parseArgs(["--lab", "round-01"]).lab, "round-01");
  assert.throws(() => parseArgs(["--since", "yesterday"]));
}

/** Startup payloads carry durations and ids, never question text. */
function verifyHandlerPrivacy() {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  const start = source.indexOf('tel.mark("startup-ask", {');
  assert(start > 0, "the handler emits startup-ask");
  const end = source.indexOf("});", start);
  assert(end > start, "startup-ask payload end anchor");
  const payload = source.slice(start, end);
  assert(!/question|narration|doubt\.title|lessonQuestion/.test(payload.replace(/turn_kind: doubt \? "doubt" : resume \? "resume" : "lesson",/, "")),
    "startup-ask carries no question text");
  assert(/createTurnTelemetry\(\{ originPerf: askOrigin \}\)/.test(source), "telemetry is created with the Ask origin");
  const askLine = source.indexOf("const askStartedAt = performance.now();");
  // The question body is `teachQuestion`; `handleQuestion` only wraps it so every exit saves.
  const handlerStart = source.indexOf("async (rawQuestion: string, options: HandleQuestionOptions | undefined, saveExit: LiveTurnSaveExit) => {");
  assert(handlerStart > 0 && askLine > handlerStart, "the Ask origin is taken inside the handler");
  assert(askLine < source.indexOf("normalizeTutorQuestion(rawQuestion)", handlerStart), "and before anything else");
  const watch = source.indexOf("tel.watchPageLifecycle(");
  assert(watch > source.indexOf("tel.setTrace(turnTraceId"), "lifecycle checkpoints after the trace id");
  const watchEnd = source.indexOf(");", watch);
  assert(watchEnd > watch, "watchPageLifecycle end anchor");
  assert(/turnTelemetryRef\.current === tel && turnGeneration === turnGenerationRef\.current/.test(source.slice(watch, watchEnd)),
    "a replaced turn's listeners let go of the page");
}

async function main() {
  verifyHandlerTimingWiring();
  await verifyBoardCommitMeasurement();
  await verifyCandidateValidationTiming();
  await verifySelectionTiming();
  await verifyOriginAtAsk();
  await verifyCheckpointOnce();
  await verifyPageLifecycleCheckpoint();
  await verifyPriorityRetention();
  await verifyLargeBatchesSplit();
  await verifyFirstAudibleHelpers();
  await verifyPageLoadClock();
  await verifyRunnerSeam();
  await verifyStreamingClientSeam();
  verifyReportParsing();
  verifyValidationTotals();
  verifyHandlerPrivacy();
  console.log("verified actual board callback true/false/reject/absent and five rejected measurement mutants; all three actual handler timing-wrapper removal mutants rejected; validation call index, recorded per-turn/context totals, fast/final combined callback identity/error/clock/sink/privacy, unknown clocks and non-additive report limits, full versus remaining board commit, Ask origin, checkpoint once, pagehide and hidden checkpoints, startup priority under pressure, split bodies, first audible once, page load clock, runner and client seams, and no question text");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
