/**
 * Student-text-free figure outcomes, tested with fake telemetry and the actual
 * owned trace route. No model, network, production data, database or images.
 *
 * pnpm --filter @heytutor/tutor exec node --experimental-test-module-mocks --import tsx scripts/verify/verify-figure-outcome-telemetry.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock, test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const STUDENT_TEXT = "Private synthetic question and its answer";
const updates: Array<Record<string, unknown>> = [];
const eventBatches: Array<Record<string, unknown>> = [];
let authenticated = true;
mock.module(resolve(root, "lib/auth.ts"), {
  namedExports: { getUserId: async () => authenticated ? "synthetic-owner" : null, ensureUser: async () => undefined },
});
mock.module(resolve(root, "lib/obs/traceOwnership.ts"), {
  namedExports: { assertOwnedTrace: async (owner: string, trace: string, session?: string) =>
    owner === "synthetic-owner" && trace === "issued-trace" && session !== "foreign-board" },
});
mock.module(resolve(root, "lib/obs/langfuse.ts"), {
  namedExports: {
    recordTurnEvents: (value: Record<string, unknown>) => eventBatches.push(value),
    updateTurnTrace: (value: Record<string, unknown>) => updates.push(value),
    flushSafely: async () => undefined,
  },
});
const route = load(resolve(root, "app/api/trace/event/route.ts")) as typeof import("../../app/api/trace/event/route");
const helpers = () => load(resolve(root, "lib/obs/figureOutcome.ts")) as typeof import("../../lib/obs/figureOutcome");
const stamp = new Date(0).toISOString();
function request(body: Record<string, unknown>): Promise<Response> {
  return route.POST(new Request("https://example.invalid/api/trace/event", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ traceId: "issued-trace", sessionId: "owned-board", ...body }),
  }));
}

test("the route allowlists reserved outcome fields and strips all other scoped event text", async () => {
  updates.length = eventBatches.length = 0;
  const response = await request({
    traceMetadata: {
      figure_trace_schema: "figure-outcome/v1", figure_outcome: STUDENT_TEXT,
      figure_empty_cause: STUDENT_TEXT, figure_question: STUDENT_TEXT,
      figure_candidate_count: Number.MAX_VALUE, turn_terminal_outcome: STUDENT_TEXT,
      diagram_strategy: "strict",
    },
    events: [{ name: "figure-turn-terminal", startTime: stamp, endTime: stamp, parentName: STUDENT_TEXT,
      metadata: { figure_trace_schema: "figure-outcome/v1", figure_outcome: "empty",
        figure_empty_cause: "planner_declined", turn_terminal_outcome: "complete",
        question: STUDENT_TEXT, rawReason: STUDENT_TEXT, commands: [STUDENT_TEXT],
        label: STUDENT_TEXT, figure_id: STUDENT_TEXT, llm_cost_usd: 0 } }],
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(updates).includes(STUDENT_TEXT), false);
  assert.equal(JSON.stringify(eventBatches).includes(STUDENT_TEXT), false);
  const metadata = updates[0]!.metadata as Record<string, unknown>;
  assert.deepEqual(metadata, { client_telemetry: { figure_trace_schema: "figure-outcome/v1", diagram_strategy: "strict" } });
  const event = (eventBatches[0]!.events as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual(event.metadata, { figure_trace_schema: "figure-outcome/v1", figure_outcome: "empty",
    figure_empty_cause: "planner_declined", turn_terminal_outcome: "complete", client_reported: true });
  assert.equal(event.parentName, undefined);
});

test("unknown scoped figure event names cannot smuggle student text", async () => {
  eventBatches.length = 0;
  const response = await request({ events: [{ name: `figure-${STUDENT_TEXT}`, startTime: stamp, endTime: stamp }] });
  assert.equal(response.status, 400);
  assert.equal(eventBatches.length, 0);
});

test("trace ownership, session ownership and authentication remain mandatory", async () => {
  updates.length = eventBatches.length = 0;
  const traceMetadata = { figure_trace_schema: "figure-outcome/v1", figure_outcome: "committed" };
  assert.equal((await request({ traceId: "unissued-trace", traceMetadata })).status, 404);
  assert.equal((await request({ sessionId: "foreign-board", traceMetadata })).status, 404);
  authenticated = false;
  try { assert.equal((await request({ traceMetadata })).status, 401); }
  finally { authenticated = true; }
  assert.equal(updates.length + eventBatches.length, 0);
});

test("valid text_only is a planner decline, even with earlier invalid candidates", () => {
  assert.equal(helpers().classifyFigureEmptyCause({ visualRequirement: "required", plannerDeclined: true,
    fatalIssueCount: 7, candidateCount: 4, plannerCalls: 2, fallbackSuppressed: true }), "planner_declined");
});

test("the classifier distinguishes required empty causes without raw reasons", () => {
  const classify = helpers().classifyFigureEmptyCause;
  assert.equal(classify({ visualRequirement: "none" }), "not_needed");
  assert.equal(classify({ visualRequirement: "required", plannerCalls: 0 }), "not_attempted");
  assert.equal(classify({ visualRequirement: "required", plannerCalls: 2 }), "planner_no_output");
  assert.equal(classify({ visualRequirement: "required", plannerCalls: 2, fatalIssueCount: 1 }), "candidates_invalid");
  assert.equal(classify({ visualRequirement: "required", noReadableInk: true }), "declined_unreadable");
  assert.equal(classify({ visualRequirement: "required", fallbackSuppressed: true }), "fallback_suppressed");
  assert.equal(classify({ visualRequirement: "required", deadlineHit: true }), "deadline");
  assert.equal(classify({ visualRequirement: "required", solverContradiction: true }), "solver_contradiction");
  assert.equal(classify({ visualRequirement: "required", presentationRefused: true }), "presentation_refused");
  assert.equal(classify({ visualRequirement: "required", presentationNoInk: true }), "presentation_no_ink");
});

test("a selected candidate refused by save admission is not mislabelled planner silence", () => {
  const classify = helpers().classifyFigureEmptyCause;
  assert.equal(classify({ visualRequirement: "required", plannerCalls: 2,
    saveAdmissionRejected: true }), "save_admission_rejected");
  assert.equal(helpers().sanitizeFigureOutcomeMetadata({
    figure_empty_cause: "save_admission_rejected",
  }).figure_empty_cause, "save_admission_rejected");
});

function fakeTelemetry() {
  let now = 0;
  const metadata: Record<string, unknown> = {};
  const marks: Array<{ name: string; metadata?: Record<string, unknown> }> = [];
  const checkpoints: string[] = [];
  return { metadata, marks, checkpoints, setNow: (value: number) => { now = value; },
    tel: { durationMs: () => now, meta: (partial: Record<string, unknown>) => Object.assign(metadata, partial),
      mark: (name: string, partial?: Record<string, unknown>) => marks.push({ name, metadata: partial }),
      checkpoint: async (reason: string) => { checkpoints.push(reason); } } };
}

test("selected is not committed; actual commit gets an independent Ask-relative timestamp", () => {
  const h = fakeTelemetry();
  const tracker = helpers().createFigureOutcomeTracker(h.tel);
  assert.equal(helpers().figureOutcomeTrackerFor(h.tel), tracker);
  h.setNow(27_600);
  tracker.decision({ hasSelectedFigure: true, visualRequirement: "required", subject: "maths",
    figureSource: "planner", representationTier: "exact_verified", primitiveCount: 8 });
  assert.equal(tracker.snapshot().figure_outcome, "selected");
  assert.equal(tracker.snapshot().figure_committed_since_ask_ms, null);
  h.setNow(31_000);
  tracker.committed(); tracker.committed();
  assert.equal(tracker.snapshot().figure_outcome, "committed");
  assert.equal(tracker.snapshot().figure_ready_since_ask_ms, 27_600);
  assert.equal(tracker.snapshot().figure_committed_since_ask_ms, 31_000);
  tracker.finish("complete"); tracker.finish("error");
  assert.equal(tracker.snapshot().turn_terminal_outcome, "complete");
  assert.equal(h.marks.filter(mark => mark.name === "figure-committed").length, 1);
  assert.equal(h.marks.filter(mark => mark.name === "figure-turn-terminal").length, 1);
  assert.deepEqual(h.checkpoints, ["figure-turn-terminal"]);
});

test("known decline survives cancellation and stale completion cannot relabel a successor", () => {
  const old = fakeTelemetry();
  const next = fakeTelemetry();
  const former = helpers().createFigureOutcomeTracker(old.tel);
  const successor = helpers().createFigureOutcomeTracker(next.tel);
  former.decision({ hasSelectedFigure: false, visualRequirement: "required", plannerDeclined: true,
    fatalIssueCount: 3 });
  former.finish("cancelled");
  former.decision({ hasSelectedFigure: true, visualRequirement: "required" }); former.committed(); former.finish("complete");
  assert.equal(former.snapshot().figure_empty_cause, "planner_declined");
  assert.equal(former.snapshot().turn_terminal_outcome, "cancelled");
  assert.equal(successor.snapshot().figure_outcome, "pending");
  assert.equal(successor.snapshot().turn_terminal_outcome, null);
});

test("early errors and cancellation generate terminal evidence with no completed decision", () => {
  for (const outcome of ["error", "cancelled", "complete"] as const) {
    const h = fakeTelemetry();
    const tracker = helpers().createFigureOutcomeTracker(h.tel);
    tracker.finish(outcome);
    assert.equal(tracker.snapshot().figure_outcome, "empty");
    assert.equal(tracker.snapshot().figure_empty_cause, outcome === "complete" ? "not_attempted" : outcome);
    assert.equal(h.marks.at(-1)!.name, "figure-turn-terminal");
    assert.deepEqual(h.checkpoints, ["figure-turn-terminal"]);
  }
});

test("a selected figure that never committed is not reported as visible after completion", () => {
  const tracker = helpers().createFigureOutcomeTracker(fakeTelemetry().tel);
  tracker.decision({ hasSelectedFigure: true, visualRequirement: "required" });
  tracker.finish("complete");
  assert.equal(tracker.snapshot().figure_outcome, "empty");
  assert.equal(tracker.snapshot().figure_empty_cause, "intro_failed");
});

test("inherited figure visibility is not a new canvas commit", () => {
  const tracker = helpers().createFigureOutcomeTracker(fakeTelemetry().tel);
  tracker.decision({ hasSelectedFigure: true, inheritedFigure: true, visualRequirement: "required" });
  tracker.finish("complete");
  assert.equal(tracker.snapshot().figure_outcome, "inherited");
  assert.equal(tracker.snapshot().figure_committed_since_ask_ms, null);
});

test("retained verified ink seeds inherited diagnostics before an early error or Stop", () => {
  for (const terminal of ["error", "cancelled"] as const) {
    const evidence = helpers().inheritedFigureEvidence({
      hasRetainedVerifiedInk: true, subject: "physics", visualRequirement: "required",
      sceneArtifacts: { figureSource: "planner", representationTier: "exact_verified" },
    });
    const tracker = helpers().createFigureOutcomeTracker(fakeTelemetry().tel);
    assert(evidence);
    tracker.decision(evidence);
    tracker.finish(terminal);
    assert.equal(tracker.snapshot().figure_outcome, "inherited");
    assert.equal(tracker.snapshot().turn_terminal_outcome, terminal);
    assert.equal(tracker.snapshot().figure_source, "planner");
    assert.equal(tracker.snapshot().figure_representation_tier, "exact_verified");
    assert.equal(tracker.snapshot().figure_subject, "physics");
    assert.equal(tracker.snapshot().figure_primitive_count, null);
    assert.equal(tracker.snapshot().figure_committed_since_ask_ms, null);
  }
});

test("cache flags alone cannot seed visibility; unknown or malicious diagnostics remain unknown", () => {
  assert.equal(helpers().inheritedFigureEvidence({ hasRetainedVerifiedInk: false,
    subject: "maths", sceneArtifacts: { figureSource: "planner" } }), null);
  const evidence = helpers().inheritedFigureEvidence({ hasRetainedVerifiedInk: true,
    subject: STUDENT_TEXT, visualRequirement: STUDENT_TEXT,
    sceneArtifacts: { figureSource: STUDENT_TEXT, representationTier: STUDENT_TEXT },
    diagnostics: { figureSource: STUDENT_TEXT, representationTier: STUDENT_TEXT, primitiveCount: -1 },
  });
  assert(evidence);
  assert.equal(JSON.stringify(evidence).includes(STUDENT_TEXT), false);
  assert.equal(evidence.subject, null);
  assert.equal(evidence.figureSource, null);
  assert.equal(evidence.representationTier, null);
  assert.equal(evidence.primitiveCount, null);
});

test("a later scoped presentation refusal withdraws an early inherited diagnostic seed", () => {
  const tracker = helpers().createFigureOutcomeTracker(fakeTelemetry().tel);
  tracker.decision(helpers().inheritedFigureEvidence({ hasRetainedVerifiedInk: true,
    subject: "chemistry", sceneArtifacts: { figureSource: "chemistry_family" } })!);
  tracker.decision({ hasSelectedFigure: false, presentationRefused: true,
    subject: "chemistry", figureSource: "text_only", primitiveCount: 0 });
  tracker.finish("complete");
  assert.equal(tracker.snapshot().figure_outcome, "empty");
  assert.equal(tracker.snapshot().figure_empty_cause, "presentation_refused");
});

test("runtime-only figure diagnostics survive live doubt, Stop and Continue without marking new ink", () => {
  const pageHelpers = load(resolve(root, "features/tutor-session/lib/turn/doubtTurn.ts")) as typeof import("../../features/tutor-session/lib/turn/doubtTurn");
  const diagnostics = { figureSource: "planner" as const, representationTier: "exact_verified" as const, primitiveCount: 7 };
  const page = pageHelpers.doubtPageRecord({ boardId: "synthetic-board", lessonQuestion: "synthetic question",
    title: "synthetic doubt", continuesBoard: true, figureDrawn: true, turnPlan: null,
    solverProjection: null, figureSubject: "maths", figureDiagnostics: diagnostics });
  const paused = pageHelpers.pausedLessonFromPage(page, false)!;
  const resumed = pageHelpers.resumePageRecord({ ...paused, figureDrawn: false });
  assert.equal(page.figureSubject, "maths");
  assert.deepEqual(paused.figureDiagnostics, diagnostics);
  assert.equal(resumed.figureSubject, "maths");
  assert.deepEqual(resumed.figureDiagnostics, diagnostics);
  assert.equal(resumed.figureDrawn, false);
  const historic = pageHelpers.resumePageRecord({ boardId: "synthetic-board", lessonQuestion: "synthetic question",
    figureDrawn: true, turnPlan: null, solverProjection: null, scene: null });
  assert.equal(historic.figureSubject, null);
});

test("retained Stop beats are partial, never a completed figure intro", () => {
  const tracker = helpers().createFigureOutcomeTracker(fakeTelemetry().tel);
  tracker.decision({ hasSelectedFigure: true, visualRequirement: "required" });
  tracker.committed({ partial: true });
  tracker.finish("cancelled");
  tracker.committed();
  assert.equal(tracker.snapshot().figure_outcome, "partially_committed");
  assert.equal(tracker.snapshot().turn_terminal_outcome, "cancelled");
  assert.equal(tracker.snapshot().figure_empty_cause, null);
  assert.equal(helpers().sanitizeFigureOutcomeMetadata(tracker.snapshot()).figure_outcome, "partially_committed");
});

test("the metadata sanitizer accepts only bounded fixed schema values", () => {
  const safe = helpers().sanitizeFigureOutcomeMetadata({ figure_trace_schema: "figure-outcome/v1",
    figure_outcome: "empty", figure_empty_cause: "presentation_refused", turn_terminal_outcome: "complete",
    figure_subject: "chemistry", figure_visual_requirement: "required", figure_source: "text_only",
    figure_representation_tier: null, figure_candidate_count: 4, figure_ready_since_ask_ms: null,
    figure_committed_since_ask_ms: null, figure_name: STUDENT_TEXT, question: STUDENT_TEXT,
    figure_primitive_count: -1, figure_fatal_issue_count: Infinity, figure_planner_calls: Number.MAX_VALUE,
    figure_decision_since_ask_ms: "27000", llm_cost_usd: 0, commands: [STUDENT_TEXT] });
  assert.equal(JSON.stringify(safe).includes(STUDENT_TEXT), false);
  assert.equal(Object.hasOwn(safe, "figure_name"), false);
  assert.equal(Object.hasOwn(safe, "llm_cost_usd"), false);
  assert.equal(Object.hasOwn(safe, "figure_primitive_count"), false);
  assert.equal(Object.hasOwn(safe, "figure_fatal_issue_count"), false);
  assert.equal(Object.hasOwn(safe, "figure_planner_calls"), false);
  assert.equal(Object.hasOwn(safe, "figure_decision_since_ask_ms"), false);
  assert.equal(safe.figure_subject, "chemistry");
});

test("broken telemetry transport or diagnostics cannot throw into the lesson", () => {
  const tracker = helpers().createFigureOutcomeTracker({ durationMs: () => 0,
    meta: () => { throw new Error("offline"); }, mark: () => { throw new Error("offline"); },
    checkpoint: async () => { throw new Error("offline"); } });
  assert.doesNotThrow(() => { tracker.empty("presentation_refused"); tracker.finish("complete"); });
  assert.equal(tracker.snapshot().figure_empty_cause, "presentation_refused");
});
