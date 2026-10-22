/** Live turn-plan failure telemetry. Synthetic fixtures only; no network. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import { planTurnV3 } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import { TURN_PLAN_DEADLINE_MS } from "../../features/tutor-session/lib/scene/diagramGeneration";
import { buildFailedTurnSentryEvent, readFailedTurnTelemetry, turnPlanFailureTelemetry } from "../../lib/obs/failedTurnTelemetry";

const appRoot = process.cwd();
const handlerText = readFileSync(join(appRoot, "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
const handler = ts.createSourceFile("useQuestionHandler.ts", handlerText, ts.ScriptTarget.Latest, true);
const awaitCurrentTurn = handler.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "awaitCurrentTurn");
assert.ok(awaitCurrentTurn, "the production turn-continuation guard must exist");
const start = handlerText.indexOf("const turnPlanStartedAt = Date.now();");
const end = handlerText.indexOf("tel.meta({ diagram_subject: diagramSubject });");
assert.ok(start >= 0 && end > start, "the production planner outcome block must exist");
assert.equal(handlerText.indexOf("const turnPlanStartedAt = Date.now();", start + 1), -1);
const block = handlerText.slice(start, end);
const question = "Explain a public test concept.";
const plan = {
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none",
};
const originalFetch = globalThis.fetch;

function envelope(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function compile(source: string): string {
  return ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
}

async function runStoppedPlan(fetchImpl: typeof fetch): Promise<{ telemetry: ReturnType<typeof readFailedTurnTelemetry>; error: unknown }> {
  globalThis.fetch = fetchImpl;
  const page: { failureTelemetry?: ReturnType<typeof readFailedTurnTelemetry> } = {
    failureTelemetry: { subject: "other" },
  };
  const context = createContext({
    exports: {}, Date, DOMException, AbortController, question, planTurnV3, TURN_PLAN_DEADLINE_MS,
    plannerUrl: "http://planner.test", sessionId: undefined, turnTraceId: undefined,
    abortController: new AbortController(), recentConversation: "", fastModeRef: { current: false },
    billed: { diagramStrictSubjects: [] },
    // The turn is no longer current once planning settles, so the post-plan
    // assignment that would drop a stale code never runs.
    isCurrentTurn: () => false,
    page, readFailedTurnTelemetry, turnPlanFailureTelemetry,
    subjectFromRejectedTurnPlanOutcomes: () => "other",
    tel: { span: () => ({ end() {} }), meta() {}, mark() {} },
  });
  const source = `${awaitCurrentTurn.getText(handler)}\n(async () => {\n${block}\n})()`;
  let error: unknown;
  try {
    await new Script(compile(source), { filename: "live-turn-plan-outcome.cjs" }).runInContext(context);
  } catch (caught) {
    error = caught;
  }
  return { telemetry: page.failureTelemetry, error };
}

function sentryEvent(telemetry: ReturnType<typeof readFailedTurnTelemetry>) {
  return buildFailedTurnSentryEvent({
    visualStatus: "text_only",
    status: "stopped",
    sceneArtifacts: { failureTelemetry: telemetry },
    segments: [{ narration: "Synthetic.", spokenText: "Synthetic." }],
  }, { FIREWORKS_API_KEY: "synthetic", SENTRY_RELEASE: "a".repeat(40) });
}

async function main() {
  try {
    const mixed = await runStoppedPlan(async (_url, init) => {
      const lane = new Headers(init?.headers).get("x-turn-planner-lane");
      if (lane === "primary") throw new TypeError("synthetic-transport");
      return envelope(JSON.stringify(plan));
    });
    assert.equal((mixed.error as Error | undefined)?.name, "AbortError", "a stopped turn leaves planning before the post-plan assignment");
    assert.equal(mixed.telemetry?.requestCount, 2);
    assert.equal(mixed.telemetry?.code, undefined, "an accepted plan must not keep an earlier transport code when the turn stops");
    assert.equal(mixed.telemetry?.stage, undefined);
    assert.equal(sentryEvent(mixed.telemetry), null, "one saved segment must not be reported as turn-plan transport_error after a plan was accepted");

    const cancelledPeer = await runStoppedPlan(async (_url, init) => {
      const lane = new Headers(init?.headers).get("x-turn-planner-lane");
      if (lane === "primary") throw new TypeError("synthetic-transport");
      throw new DOMException("synthetic-abort", "AbortError");
    });
    assert.equal(cancelledPeer.telemetry?.requestCount, 3, "the aborted alternate and retry are still counted");
    assert.equal(cancelledPeer.telemetry?.code, "transport_error", "an abort on another attempt must not hide a real fetch failure");
    assert.ok(!JSON.stringify(cancelledPeer.telemetry).includes("synthetic-abort"));

    const transport = await runStoppedPlan(async () => { throw new TypeError("synthetic-transport"); });
    assert.equal((transport.error as Error | undefined)?.name, "AbortError");
    assert.equal(transport.telemetry?.requestCount, 3, "both initial lanes and the existing retry still count");
    assert.equal(transport.telemetry?.code, "transport_error", "a fetch throw on every plan attempt stays a transport failure");
    assert.equal(transport.telemetry?.stage, "turn_plan");
    const event = sentryEvent(transport.telemetry);
    assert.ok(event, "a genuine transport failure is still reported");
    assert.equal(event.tags.code, "transport_error");
    assert.equal(event.tags.stage, "turn_plan");
    assert.equal(event.extra.request_count, 3);
    assert.equal(event.extra.segment_count, 1);
    assert.ok(!JSON.stringify(mixed.telemetry).includes("synthetic-transport"));
    assert.ok(!JSON.stringify(transport.telemetry).includes("synthetic-transport"));
    console.log("Turn-plan transport outcome telemetry passed: 3 scenarios.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
