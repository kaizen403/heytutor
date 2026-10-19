import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import { beginTurn } from "../../lib/billing/billingClient";
import { planSceneDocumentWithRepair } from "../../../../packages/tutor-core/src/planners/scenePlannerV2";
import { createFallbackTurnPlanV3 } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { runLecture, type LectureRun } from "../lecture-lab/lecturePipeline";
import { labSampleFingerprint, parseOptions, parsePlannerSceneContexts } from "../lecture-lab/run";
import { isLectureLabPlannerProbe, lectureLabPlannerDeadlineCapMs } from "../../lib/billing/flags";
import {
  parsePlannerTimingProfile,
  plannerTimingRequestCap,
  resolvePlannerTimingProfile,
  type PlannerTimingProfile,
} from "../../lib/llm/plannerTiming";

// No environment files, application server, database or provider requests.
const balanced = {
  version: "fireworks-planner-timing/v1",
  turnPlanMs: 30_000,
  sceneMs: 120_000,
  sceneCandidateMs: 60_000,
} satisfies PlannerTimingProfile;

// Execute the actual route/hook option expressions without importing Next,
// React hooks or DB-backed grant handlers. No copied policy implementation.
const appRoot = resolve(import.meta.dirname, "../..");
function source(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(resolve(appRoot, path), "utf8"), ts.ScriptTarget.Latest, true);
}
function nodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return matches;
}
function call(root: ts.Node, file: ts.SourceFile, name: string): ts.CallExpression {
  const found = nodes(root, (node): node is ts.CallExpression => ts.isCallExpression(node) && node.expression.getText(file) === name);
  assert.equal(found.length, 1, `inspect the actual ${name} boundary`);
  return found[0]!;
}
function initializer(root: ts.Node, name: string): ts.Expression {
  const found = nodes(root, (node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
  assert.equal(found.length, 1, `inspect the actual ${name} value`);
  assert(found[0]?.initializer);
  return found[0].initializer;
}
function field(object: ts.Node | undefined, file: ts.SourceFile, name: string): ts.Expression {
  assert(object && ts.isObjectLiteralExpression(object));
  const found = object.properties.find(entry => ts.isPropertyAssignment(entry) && entry.name.getText(file) === name);
  assert(found && ts.isPropertyAssignment(found), `the ${name} boundary must receive its explicit value`);
  return found.initializer;
}
function evaluate(expression: ts.Node, file: ts.SourceFile, bindings: Record<string, unknown>): unknown {
  const context = createContext({ exports: {}, ...bindings });
  const compiled = ts.transpileModule(`exports.value = (${expression.getText(file)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Script(compiled).runInContext(context);
  return context.exports.value;
}

function verifyServerAndLiveWiring(): void {
  const carrier = source("app/api/billing/begin-turn/route.ts");
  const carrierBody = call(carrier, carrier, "Response.json").arguments[0]!;
  for (const provider of ["fireworks", "azure"]) for (const flag of [undefined, "balanced", "legacy"]) {
    const env = { FIREWORKS_PLANNER_TIMING_PROFILE: flag };
    const bindings = { resolveLlmEndpoint: () => ({ provider }),
      resolvePlannerTimingProfile: (value: string) => resolvePlannerTimingProfile(value, env),
      result: { grant: { ttsCharsRemaining: 100 }, diagramStrategy: "current" },
      resolveDiagramStrictSubjects: () => [],
    };
    const plannerTiming = evaluate(initializer(carrier, "plannerTiming"), carrier, bindings);
    const body = evaluate(carrierBody, carrier, { ...bindings, plannerTiming });
    assert(body && typeof body === "object");
    assert.equal("plannerTiming" in body, provider === "fireworks" && flag === "balanced",
      "Azure and default/rollback responses omit the experimental profile");
  }

  const route = source("app/api/chat/route.ts");
  const planner = call(route, route, "handlePlannerRequest");
  const transport = call(route, route, "fetchPlannerCompletion");
  const cases = [
    { kind: "turn", provider: "fireworks", requested: "120000", deadline: 60_000, attempt: undefined },
    { kind: "scene", provider: "fireworks", requested: "120000", deadline: 60_000, attempt: undefined },
    { kind: "turn", provider: "fireworks", requested: "120000", flag: "balanced", deadline: 30_000, attempt: 30_000 },
    { kind: "scene", provider: "fireworks", requested: "120000", flag: "balanced", deadline: 60_000, attempt: 60_000 },
    { kind: "scene", provider: "fireworks", requested: "7000", flag: "balanced", deadline: 7_000, attempt: 7_000 },
    { kind: "turn", provider: "fireworks", requested: "120000", flag: "legacy", deadline: 60_000, attempt: undefined },
    { kind: "turn", provider: "azure", requested: "120000", flag: "balanced", deadline: 60_000, attempt: undefined },
    { kind: "scene", provider: "azure", requested: "120000", flag: "balanced", deadline: 60_000, attempt: 30_000 },
    { kind: "ir", provider: "fireworks", requested: "120000", flag: "balanced", deadline: 60_000, attempt: undefined },
    { kind: "code", provider: "fireworks", requested: "120000", flag: "balanced", deadline: 60_000, attempt: undefined },
    { kind: "picker", provider: "fireworks", requested: "120000", flag: "balanced", deadline: 60_000, attempt: undefined },
    { kind: "scene", provider: "fireworks", requested: "120000", probe: true, deadline: 120_000, attempt: 120_000 },
    { kind: "scene", provider: "fireworks", requested: "120000", flag: "balanced", probe: true, deadline: 120_000, attempt: 120_000 },
  ];
  for (const fixture of cases) {
    const headers = new Headers({ "x-planner": "1", "x-planner-deadline-ms": fixture.requested });
    const version = fixture.kind === "turn" ? ["x-turn-planner-version", "3"] : fixture.kind === "ir"
      ? ["x-problem-ir-version", "1"] : fixture.kind === "code" ? ["x-code-lesson-version", "1"] : ["x-scene-planner-version", "2"];
    headers.set(version[0]!, version[1]!);
    if (fixture.kind === "picker") headers.set("x-diagram-example-picker", "1");
    if (fixture.probe) {
      headers.set("x-heytutor-lecture-lab", "synthetic-only-token");
      headers.set("x-heytutor-lecture-lab-standard-model", "1");
      headers.set("x-heytutor-lecture-lab-planner-probe", "1");
    }
    const env = { NODE_ENV: "test" as const, LLM_PROVIDER: fixture.provider, LECTURE_LAB_TOKEN: "synthetic-only-token", FIREWORKS_PLANNER_TIMING_PROFILE: fixture.flag };
    const request = new Request("http://offline.test/api/chat", { method: "POST", headers });
    const bindings: Record<string, unknown> = { request, llm: { provider: fixture.provider }, plannerTimingRequestCap,
      resolvePlannerTimingProfile: (provider: string) => resolvePlannerTimingProfile(provider, env),
      isLectureLabPlannerProbe: (input: Request) => isLectureLabPlannerProbe(input, env),
      lectureLabPlannerDeadlineCapMs: (input: Request) => lectureLabPlannerDeadlineCapMs(input, env),
    };
    for (const name of ["turnPlanV3", "problemIRV1", "codeLessonV1", "semanticSceneV2", "diagramExamplePicker", "plannerProbe", "timingCap"]) {
      bindings[name] = evaluate(initializer(route, name), route, bindings);
    }
    const deadline = evaluate(field(planner.arguments[0], route, "deadlineMs"), route, bindings);
    assert.equal(deadline, fixture.deadline, `${fixture.provider}/${fixture.kind} enforces its own request cap`);
    bindings.deadlineMs = deadline;
    assert.equal(evaluate(field(transport.arguments[0], route, "attemptTimeoutMs"), route, bindings), fixture.attempt,
      "profile upstream timeouts follow the full capped request instead of restarting at 25 seconds");
    assert.equal(evaluate(field(transport.arguments[0], route, "maxAttemptsPerModel"), route, bindings), fixture.probe ? 1 : undefined,
      "ordinary retry defaults remain unchanged; the authenticated probe still has one attempt");
  }
  const transportSource = source("lib/llm/plannerTransport.ts");
  assert.equal(evaluate(initializer(transportSource, "attemptTimeoutMs"), transportSource, { options: {} }), 25_000,
    "omitting the profile retains the actual legacy upstream timeout");
  assert.equal(evaluate(initializer(transportSource, "attemptsPerModel"), transportSource, { options: {} }), 2,
    "ordinary transient retry capacity is preserved");

  const hook = source("features/tutor-session/hooks/turn/useQuestionHandler.ts");
  const pipeline = source("scripts/lecture-lab/lecturePipeline.ts");
  for (const profile of [undefined, balanced]) {
    const bindings = { billed: { plannerTiming: profile }, options: { plannerTiming: profile },
      SCENE_PLANNER_DEADLINE_MS: 60_000, TURN_PLAN_DEADLINE_MS: 20_000 };
    const scenePlannerDeadlineMs = evaluate(initializer(hook, "scenePlannerDeadlineMs"), hook, bindings);
    const turnPlanDeadlineMs = evaluate(initializer(hook, "turnPlanDeadlineMs"), hook, bindings);
    assert.equal(scenePlannerDeadlineMs, profile ? 120_000 : 60_000);
    assert.equal(turnPlanDeadlineMs, profile ? 30_000 : 20_000);
    assert.equal(evaluate(field(call(hook, hook, "planTurnV3").arguments[1], hook, "timeoutMs"), hook,
      { ...bindings, turnPlanDeadlineMs }), profile ? 30_000 : 20_000);
    assert.equal(evaluate(field(call(hook, hook, "runScenePlanningOverlap").arguments[0], hook, "deadlineMs"), hook,
      { ...bindings, scenePlannerDeadlineMs }), profile ? 120_000 : 60_000);
    assert.equal(evaluate(field(call(hook, hook, "planSceneDocumentWithRepair").arguments[2], hook, "candidateTimeoutMs"), hook, bindings), profile?.sceneCandidateMs);
    assert.equal(evaluate(field(call(hook, hook, "planCodeLessonV1").arguments[1], hook, "timeoutMs"), hook, bindings), 60_000,
      "DSA/code planning retains its existing client deadline");
    assert.equal(evaluate(field(call(pipeline, pipeline, "planTurnV3").arguments[1], pipeline, "timeoutMs"), pipeline, bindings), profile ? 30_000 : 20_000);
    assert.equal(evaluate(field(call(pipeline, pipeline, "planSceneDocumentWithRepair").arguments[2], pipeline, "candidateTimeoutMs"), pipeline, bindings), profile?.sceneCandidateMs);
    assert.equal(evaluate(initializer(pipeline, "scenePlannerDeadlineMs"), pipeline, bindings), profile ? 120_000 : 60_000);
    assert.equal(evaluate(initializer(pipeline, "scenePlannerDeadlineMs"), pipeline,
      { ...bindings, options: { plannerTiming: profile, scenePlannerDeadlineMs: 60_000 } }), 60_000,
    "an explicit evaluation overall-budget override keeps precedence");
  }
}

function verifyProfile(): void {
  assert.equal(resolvePlannerTimingProfile("fireworks", {}), undefined,
    "an unproven experiment must not promote itself into the Fireworks default");
  assert.deepEqual(resolvePlannerTimingProfile("fireworks", { FIREWORKS_PLANNER_TIMING_PROFILE: "balanced" }), balanced);
  for (const flag of ["legacy", "unknown", "disabled"]) {
    assert.equal(resolvePlannerTimingProfile("fireworks", { FIREWORKS_PLANNER_TIMING_PROFILE: flag }), undefined,
      `unrecognized or rollback profile '${flag}' retains legacy timing`);
  }
  for (const flag of [undefined, "balanced", "legacy"]) {
    assert.equal(resolvePlannerTimingProfile("azure", { FIREWORKS_PLANNER_TIMING_PROFILE: flag }), undefined,
      "Fireworks timing never changes Azure defaults");
  }
  assert.deepEqual(parsePlannerTimingProfile(balanced), balanced,
    "the begin-turn timing profile survives the client decoder");
  for (const value of [undefined, null, [], "balanced", {},
    { ...balanced, version: "fireworks-planner-timing/v2" },
    { ...balanced, turnPlanMs: "30000" },
    { ...balanced, turnPlanMs: 0 },
    { ...balanced, sceneMs: Number.NaN },
    { ...balanced, sceneCandidateMs: Number.POSITIVE_INFINITY },
    { ...balanced, sceneCandidateMs: -60_000 },
  ]) {
    assert.equal(parsePlannerTimingProfile(value), undefined,
      "malformed timing metadata falls back rather than creating an unbounded client wait");
  }
}

async function verifyBeginTurnClient(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    for (const value of [balanced, undefined, { ...balanced, turnPlanMs: "30000" }]) {
      let requests = 0;
      globalThis.fetch = async (input) => {
        requests += 1;
        assert.equal(new URL(String(input), "http://offline.test").pathname, "/api/billing/begin-turn");
        return Response.json({ planId: "free", ttsCharsRemaining: 100, plannerTiming: value });
      };
      const result = await beginTurn({ traceId: "synthetic-timing", kind: "lesson", ownsTurn: () => true });
      assert.equal(requests, 1);
      assert(result.ok);
      assert.deepEqual(result.plannerTiming, value === balanced ? balanced : undefined,
        "the real billing client returns validated per-turn timing and tolerates old servers");
    }
  } finally { globalThis.fetch = originalFetch; }
}

const question = "Draw a named line.";
const turnPlan = {
  schemaVersion: "turn-plan/v3" as const,
  question, visualRequirement: "required" as const,
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
};
const declinedScene = {
  schemaVersion: "scene-document/v2",
  source: { question },
  visualDecision: { mode: "text_only", reason: "The synthetic source specifies no unique construction." },
  quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [],
  requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
};

function offlineResponse(isTurn: boolean): Response {
  return Response.json({
    model: "accounts/fireworks/models/kimi-k3",
    choices: [{ message: { content: JSON.stringify(isTurn ? turnPlan : declinedScene) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300,
      completion_tokens_details: { reasoning_tokens: 0 } },
  });
}

async function verifyProbePropagation(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    for (const profile of [undefined, balanced]) {
      const captured: Array<{ kind: string; deadline: string | null }> = [];
      globalThis.fetch = async (input, init) => {
        assert.equal(String(input), "http://offline.test/api/chat");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-planner"), "1");
        assert.equal(headers.get("x-problem-ir-version"), null);
        assert.equal(headers.get("x-code-lesson-version"), null);
        assert.equal(headers.get("x-diagram-example-picker"), null);
        const isTurn = headers.get("x-turn-planner-version") === "3";
        captured.push({ kind: isTurn ? "turn" : "scene", deadline: headers.get("x-planner-deadline-ms") });
        return offlineResponse(isTurn);
      };
      const result = await runLecture(question, {
        origin: "http://offline.test", cookie: "", plannerOnly: true, figureOnly: true,
        traceId: "synthetic-timing-probe", plannerTiming: profile,
      });
      assert.deepEqual(captured, [
        { kind: "turn", deadline: profile ? "30000" : "120000" },
        { kind: "scene", deadline: profile ? "60000" : "120000" },
      ], "the real diagnostic keeps its uncensored baseline and applies candidate request bounds only when supplied");
      assert(result.plannerProbe);
      assert.equal(result.plannerProbe.turnTimeoutMs, profile ? 30_000 : 120_000);
      assert.equal(result.plannerProbe.sceneTimeoutMs, profile ? 60_000 : 120_000);
      assert.deepEqual(result.plannerProbe.timingProfile, profile);
      assert.equal(result.plannerProbe.turnAccepted, true);
      assert.equal(result.plannerProbe.sceneStatus, "valid_text_only_decline");
      assert.equal(result.diagram.committed, false);
      assert.equal(result.solver, null);
      assert.equal(result.teaching.rawText, "");
    }
  } finally { globalThis.fetch = originalFetch; }
}

async function verifySceneCandidateTimeout(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    for (const candidateTimeoutMs of [undefined, 60_000]) {
      const deadlines: string[] = [];
      globalThis.fetch = async (input, init) => {
        assert.equal(String(input), "http://offline.test/api/chat");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-scene-planner-version"), "2");
        deadlines.push(headers.get("x-planner-deadline-ms") ?? "missing");
        return offlineResponse(false);
      };
      await planSceneDocumentWithRepair(question,
        candidate => validateProductionSceneCandidate({ candidate, question, turnPlan }), {
          proxyUrl: "http://offline.test/api/chat", timeoutMs: 120_000, candidateTimeoutMs,
        });
      assert.deepEqual(deadlines, candidateTimeoutMs ? ["60000", "60000"] : ["30000", "30000"],
        "real scene requests retain the legacy default unless their caller supplies the new candidate cap");
    }
  } finally { globalThis.fetch = originalFetch; }
}

async function verifyFrozenSceneContext(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const sceneBodies: string[] = [];
  try {
    const run = async (freshValid: boolean, context?: { turnPlan: typeof turnPlan; turnAccepted: boolean }) => {
      globalThis.fetch = async (input, init) => {
        assert.equal(String(input), "http://offline.test/api/chat");
        const headers = new Headers(init?.headers);
        const isTurn = headers.get("x-turn-planner-version") === "3";
        if (!isTurn) {
          assert.equal(typeof init?.body, "string");
          sceneBodies.push(String(init?.body));
        }
        if (isTurn && !freshValid) return Response.json({
          model: "accounts/fireworks/models/kimi-k3",
          choices: [{ message: { content: JSON.stringify({ ...turnPlan,
            unknowns: [{ id: "unanswered", symbol: "x", unit: "m" }] }) }, finish_reason: "stop" }],
        });
        return offlineResponse(isTurn);
      };
      return runLecture(question, {
        origin: "http://offline.test", cookie: "", plannerOnly: true, figureOnly: true,
        traceId: "synthetic-frozen-timing", plannerTiming: balanced, plannerSceneContext: context,
      });
    };
    const reference = await run(true);
    verifyFrozenContextAdmission(reference);
    assert.equal(reference.plannerProbe?.sceneContext, "fresh_turn_plan");
    const frozenAccepted = await run(false, { turnPlan, turnAccepted: true });
    assert.equal(frozenAccepted.plannerProbe?.turnAccepted, false,
      "a frozen scene input does not conceal rejection of the fresh turn response");
    assert.equal(frozenAccepted.plannerProbe?.sceneContext, "frozen_turn_plan");
    assert.equal(sceneBodies[1], sceneBodies[0],
      "the scene request remains byte-identical when its freshly measured turn is rejected");
    const frozenFallback = await run(true, { turnPlan, turnAccepted: false });
    assert.equal(frozenFallback.plannerProbe?.turnAccepted, true);
    assert.equal(frozenFallback.plannerProbe?.authority, "fallback_no_numeric_authority",
      "a fresh accepted turn cannot promote the frozen fallback context to accepted numeric authority");
    assert.equal(frozenFallback.plannerProbe?.sceneContext, "frozen_turn_plan");
    assert.equal(frozenFallback.solver, null);
  } finally { globalThis.fetch = originalFetch; }
}

function verifyFrozenContextAdmission(reference: LectureRun): void {
  const first = { ...structuredClone(reference), probeId: "synthetic-line-a" };
  const second = { ...structuredClone(reference), probeId: "synthetic-line-b" };
  const probes = [
    { id: first.probeId, question: `  ${question}  ` },
    { id: second.probeId, question },
  ];
  const contexts = parsePlannerSceneContexts([first, second], probes);
  assert.equal(contexts.size, 2);
  assert.equal(contexts.get(first.probeId)?.turnPlan.question, question,
    "the loader compares the same normalized question used for planner requests");
  assert.deepEqual(contexts.get(first.probeId)?.turnPlan, first.figureReplayInputs?.selection.turnPlan,
    "an already validated baseline plan retains its scene prompt facts");
  assert.throws(() => parsePlannerSceneContexts([first], probes), /complete.identical.sample/i);
  assert.throws(() => parsePlannerSceneContexts([first, first], probes), /identity/i,
    "duplicate rows cannot stand in for a missing sample member");
  assert.throws(() => parsePlannerSceneContexts([first, { ...second, probeId: "not-in-sample" }], probes), /identity/i);
  assert.throws(() => parsePlannerSceneContexts([first, { ...second, question: "A different question." }], probes), /identity/i);

  // These are deliberately malformed serialized records at the loader seam.
  const missingMetadata = JSON.parse(JSON.stringify(first));
  delete missingMetadata.plannerProbe;
  assert.throws(() => parsePlannerSceneContexts([missingMetadata, second], probes), /identity/i);
  const invalidPlan = JSON.parse(JSON.stringify(first));
  invalidPlan.figureReplayInputs.selection.turnPlan.schemaVersion = "invalid";
  assert.throws(() => parsePlannerSceneContexts([invalidPlan, second], probes), /invalid.turn.plan/i);
  const falseFlag = JSON.parse(JSON.stringify(first));
  falseFlag.plannerProbe.turnAccepted = "false";
  assert.throws(() => parsePlannerSceneContexts([falseFlag, second], probes), /identity/i);

  const numeric = JSON.parse(JSON.stringify(first));
  const numericQuestion = "Draw a segment of length 2 m.";
  numeric.question = numericQuestion;
  numeric.figureReplayInputs.selection.turnPlan = { ...turnPlan, question: numericQuestion,
    givens: [{ id: "length", symbol: "L", value: 2, unit: "m", sourceText: "length 2 m", provenance: "given" }] };
  const numericProbes = [{ id: numeric.probeId, question: numericQuestion }];
  assert.equal(parsePlannerSceneContexts([numeric], numericProbes).size, 1,
    "the numeric fixture is independently admitted before its authority flag is changed");
  numeric.plannerProbe.turnAccepted = false;
  assert.throws(() => parsePlannerSceneContexts([numeric], numericProbes), /no.authority.fallback/i,
    "a refused turn cannot smuggle numeric facts into a frozen fallback context");

  const fallback = JSON.parse(JSON.stringify(first));
  fallback.plannerProbe.turnAccepted = false;
  fallback.figureReplayInputs.selection.turnPlan = createFallbackTurnPlanV3(question);
  const fallbackContexts = parsePlannerSceneContexts([fallback, second], probes);
  assert.equal(fallbackContexts.get(first.probeId)?.turnAccepted, false);
  assert.equal(fallbackContexts.get(first.probeId)?.turnPlan.givens.length, 0);

  const runner = source("scripts/lecture-lab/run.ts");
  const fingerprintExpression = initializer(runner, "sceneContextFingerprint");
  const fingerprint = (sceneContexts: ReturnType<typeof parsePlannerSceneContexts>) =>
    evaluate(fingerprintExpression, runner, { sceneContexts, probes, labSampleFingerprint });
  assert.equal(fingerprint(contexts), fingerprint(parsePlannerSceneContexts([second, first], probes)),
    "filesystem row order cannot change the paired-input identity");
  assert.notEqual(fingerprint(contexts), fingerprint(fallbackContexts),
    "the paired-input identity includes normalized plan facts and authority status");
  const executionConfig = evaluate(initializer(runner, "executionConfig"), runner, {
    serverConfig: { modelProfile: {}, inputBounds: {} },
    PRODUCTION_SCENE_SELECTION_VERSION: "synthetic", options: {}, plannerTiming: undefined,
    sceneContexts: contexts, sceneContextFingerprint: fingerprint(contexts),
    labSampleFingerprint, diagramExamples: [], exampleExclusionFingerprint: "synthetic",
    LAB_VISUAL_NEED_POLICY: {}, replayText: null,
  });
  assert(executionConfig && typeof executionConfig === "object" && "sceneContextFingerprint" in executionConfig);
  assert.equal(executionConfig.sceneContextFingerprint, fingerprint(contexts),
    "the actual execution identity binds frozen scene inputs for resume checks");
}

function verifyCliAdmission(): void {
  const base = ["--eval", "synthetic.jsonl", "--planner-only", "--max-usd", "1.5763"];
  assert.equal(parseOptions(base).plannerProviderDefaults, false);
  assert.equal(parseOptions([...base, "--planner-provider-defaults"]).plannerProviderDefaults, true);
  assert.throws(() => parseOptions(["--max-usd", "1", "--planner-provider-defaults"]), /planner.only|planner-provider-defaults/i,
    "provider-default diagnostic bounds require the explicit planner-only diagnostic");
  assert.throws(() => parseOptions([...base, "--planner-scene-context-round", "synthetic-baseline"]), /planner.provider.defaults|planner-scene-context-round|planner-provider-defaults/i,
    "frozen scene inputs require the explicit candidate diagnostic profile");
}

async function main(): Promise<void> {
  verifyProfile();
  verifyServerAndLiveWiring();
  await verifyBeginTurnClient();
  await verifyProbePropagation();
  await verifySceneCandidateTimeout();
  await verifyFrozenSceneContext();
  verifyCliAdmission();
  console.log("Fireworks planner timing GREEN: rollback/Azure isolation, real billing decoder and planner request bounds (zero network/DB calls)");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
