import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import { type TurnPlanV3 } from "@heytutor/scene-engine";
import { planTurnV3Lane } from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import { fetchPlannerCompletion } from "../../lib/llm/plannerTransport";
import { plannerTimingRequestCap, resolvePlannerTimingProfile } from "../../lib/llm/plannerTiming";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import {
  isLectureLabPlannerProbe,
  lectureLabPlannerDeadlineCapMs,
  LECTURE_LAB_HEADER,
  LECTURE_LAB_PLANNER_PROBE_HEADER,
  LECTURE_LAB_STANDARD_MODEL_HEADER,
} from "../../lib/billing/flags";
import { runLecture } from "../lecture-lab/lecturePipeline";
import { assertPlannerOnlyRequest, labSampleFingerprint, parseOptions } from "../lecture-lab/run";

// Synthetic fixture only. Fetch never falls through to the network, and these
// tests never load .env.local, start the app, use a DB or call a paid provider.
const question = "Draw a named line.";
const turnPlan = {
  schemaVersion: "turn-plan/v3",
  question,
  visualRequirement: "required",
  givens: [],
  unknowns: [],
  derived: [],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
} satisfies TurnPlanV3;
const declinedScene = {
  schemaVersion: "scene-document/v2",
  source: { question },
  visualDecision: { mode: "text_only", reason: "Synthetic source does not specify a faithful line construction." },
  quantities: [],
  entities: [],
  constructions: [],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: [],
  revealGroups: [],
  teachingTimeline: [],
};
const labelledScene = {
  ...declinedScene,
  visualDecision: { mode: "scene", reason: "A labelled segment represents the named line." },
  entities: [
    { id: "a", kind: "point", role: "construction helper", provenance: { engineOwned: true } },
    { id: "b", kind: "point", role: "construction helper", provenance: { engineOwned: true } },
    { id: "ab", kind: "segment", role: "segment", label: "AB" },
  ],
  constructions: [
    { id: "point_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "point_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "segment_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
  ],
  assertions: [{ id: "named_line_exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
  requiredEntityIds: ["ab"],
  revealGroups: [{ id: "setup", entityIds: ["ab"], dependsOn: [], narrationCue: "Draw the named line." }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw the named line." }],
};
const syntheticEnv = { NODE_ENV: "test" as const, LECTURE_LAB_TOKEN: "synthetic-only-lab-token" } satisfies NodeJS.ProcessEnv;
const probeHeaders = {
  [LECTURE_LAB_HEADER]: syntheticEnv.LECTURE_LAB_TOKEN,
  [LECTURE_LAB_STANDARD_MODEL_HEADER]: "1",
  [LECTURE_LAB_PLANNER_PROBE_HEADER]: "1",
  "x-planner": "1",
  "x-turn-planner-version": "3",
  "x-planner-deadline-ms": "120000",
};
function request(headers: HeadersInit): Request {
  return new Request("http://offline.test/api/chat", { method: "POST", headers });
}

const appRoot = resolve(import.meta.dirname, "../..");
function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(resolve(appRoot, path), "utf8"), ts.ScriptTarget.Latest, true);
}
function nodesWhere<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const nodes: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
}
function singleCall(root: ts.Node, file: ts.SourceFile, name: string): ts.CallExpression {
  const calls = nodesWhere(root, (node): node is ts.CallExpression =>
    ts.isCallExpression(node) && node.expression.getText(file) === name);
  assert.equal(calls.length, 1, `execute the actual single ${name} wiring`);
  return calls[0]!;
}
function variable(root: ts.Node, name: string): ts.VariableDeclaration {
  const declarations = nodesWhere(root, (node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
  assert.equal(declarations.length, 1, `the actual ${name} wiring must be unambiguous`);
  assert(declarations[0]!.initializer);
  return declarations[0]!;
}
function property(object: ts.Node | undefined, file: ts.SourceFile, name: string): ts.Expression {
  assert(object && ts.isObjectLiteralExpression(object));
  const found = object.properties.find((entry) =>
    (ts.isPropertyAssignment(entry) || ts.isShorthandPropertyAssignment(entry)) && entry.name.getText(file) === name);
  assert(found && (ts.isPropertyAssignment(found) || ts.isShorthandPropertyAssignment(found)), `${name} must be wired`);
  return ts.isShorthandPropertyAssignment(found) ? found.name : found.initializer;
}
function evaluateExpression(node: ts.Node, file: ts.SourceFile, bindings: Record<string, unknown>): unknown {
  const context = createContext({ exports: {}, ...bindings });
  const code = ts.transpileModule(`exports.value = (${node.getText(file)});`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  new Script(code, { filename: "actual-planner-probe-source-wiring.cjs" }).runInContext(context);
  return context.exports.value;
}

/** Execute actual route option expressions with synthetic auth/env, without Next/DB imports. */
async function verifyRouteWiring(): Promise<void> {
  const route = sourceFile("app/api/chat/route.ts");
  const handle = singleCall(route, route, "handlePlannerRequest");
  const transport = singleCall(route, route, "fetchPlannerCompletion");
  const extended = variable(route, "extendedEvaluationScenePlanner").initializer!;
  const outerDeadline = singleCall(variable(route, "requestSignal"), route, "AbortSignal.timeout").arguments[0]!;
  const scene = new Headers(probeHeaders);
  scene.delete("x-turn-planner-version");
  scene.set("x-scene-planner-version", "2");
  const ordinary = new Headers(probeHeaders);
  ordinary.delete(LECTURE_LAB_PLANNER_PROBE_HEADER);
  const anonymous = new Headers(probeHeaders);
  anonymous.delete(LECTURE_LAB_HEADER);
  const cases = [
    { headers: new Headers(probeHeaders), provider: "fireworks", probe: true, deadline: 120_000, outer: 125_000, attempts: 1, attemptMs: 120_000 },
    { headers: scene, provider: "fireworks", probe: true, deadline: 120_000, outer: 125_000, attempts: 1, attemptMs: 120_000 },
    { headers: ordinary, provider: "fireworks", probe: false, deadline: 60_000, outer: 120_000, attempts: undefined, attemptMs: undefined },
    { headers: anonymous, provider: "fireworks", probe: false, deadline: 60_000, outer: 120_000, attempts: undefined, attemptMs: undefined },
    { headers: ordinary, provider: "fireworks", flag: "balanced", probe: false, deadline: 30_000, outer: 120_000, attempts: undefined, attemptMs: 30_000 },
    { headers: ordinary, provider: "fireworks", flag: "legacy", probe: false, deadline: 60_000, outer: 120_000, attempts: undefined, attemptMs: undefined },
    { headers: new Headers(probeHeaders), provider: "azure", probe: false, deadline: 60_000, outer: 120_000, attempts: undefined, attemptMs: undefined },
    { headers: scene, provider: "azure", probe: false, deadline: 120_000, outer: 125_000, attempts: undefined, attemptMs: 30_000 },
  ];
  for (const fixture of cases) {
    const env = { ...syntheticEnv, LLM_PROVIDER: fixture.provider, FIREWORKS_PLANNER_TIMING_PROFILE: fixture.flag };
    const input = request(fixture.headers);
    const bindings = {
      request: input,
      isLectureLabPlannerProbe: (candidate: Request) => isLectureLabPlannerProbe(candidate, env),
      lectureLabPlannerDeadlineCapMs: (candidate: Request) => lectureLabPlannerDeadlineCapMs(candidate, env),
      semanticSceneV2: fixture.headers.get("x-turn-planner-version") !== "3" && fixture.headers.get("x-scene-planner-version") === "2",
      turnPlanV3: fixture.headers.get("x-turn-planner-version") === "3",
      problemIRV1: false,
      codeLessonV1: false,
      diagramExamplePicker: false,
      llm: { provider: fixture.provider },
      deadlineMs: fixture.deadline,
      plannerProbe: fixture.probe,
      resolvePlannerTimingProfile: (provider: string) => resolvePlannerTimingProfile(provider, env),
      plannerTimingRequestCap,
    };
    const timingCap = evaluateExpression(variable(route, "timingCap").initializer!, route, bindings);
    const deadlineBindings = { ...bindings, timingCap };
    assert.equal(evaluateExpression(property(handle.arguments[0], route, "plannerProbe"), route, bindings), fixture.probe,
      "the actual POST call must pass authenticated eligibility to the planner handler");
    assert.equal(evaluateExpression(property(handle.arguments[0], route, "deadlineMs"), route, deadlineBindings), fixture.deadline);
    const extendedValue = evaluateExpression(extended, route, bindings);
    assert.equal(evaluateExpression(outerDeadline, route, { ...bindings, extendedEvaluationScenePlanner: extendedValue }), fixture.outer);
    assert.equal(evaluateExpression(property(transport.arguments[0], route, "maxAttemptsPerModel"), route, bindings), fixture.attempts);
    assert.equal(evaluateExpression(property(transport.arguments[0], route, "attemptTimeoutMs"), route, bindings), fixture.attemptMs);
  }
  let dispatched = 0;
  const response = await fetchPlannerCompletion({
    apiKey: "synthetic-not-a-key", url: "http://offline.test/upstream", body: {},
    models: ["accounts/fireworks/models/kimi-k3"], maxAttemptsPerModel: 1, attemptTimeoutMs: 120_000,
    fetchImpl: async () => { dispatched += 1; return new Response("synthetic transient error", { status: 503 }); },
    sleep: async () => { assert.fail("the single-attempt probe must not back off for another paid attempt"); },
  });
  assert.equal(dispatched, 1);
  assert.equal(response.attemptCount, 1);
  assert.equal(response.response.status, 503);
}

/** Optional independent pre-edit comparison; CI does not need a local main ref. */
async function verifyInitialPromptParity(): Promise<void> {
  const flag = process.argv.indexOf("--compare-ref");
  if (flag < 0) return;
  const ref = process.argv[flag + 1];
  assert(ref && /^[\w./-]+$/.test(ref), "--compare-ref requires a local git ref");
  const source = execFileSync("git", ["show", `${ref}:packages/tutor-core/src/planners/turnPlannerV3.ts`], {
    cwd: appRoot, encoding: "utf8", maxBuffer: 2_000_000,
  });
  const originalModule = { exports: {} };
  const bodies: string[] = [];
  const mockFetch: typeof fetch = async (_input, init) => {
    assert.equal(typeof init?.body, "string");
    bodies.push(String(init!.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(turnPlan) } }] });
  };
  const context = createContext({
    module: originalModule, exports: originalModule.exports,
    require: createRequire(resolve(appRoot, "../../packages/tutor-core/src/planners/turnPlannerV3.ts")),
    fetch: mockFetch, Date, console, setTimeout, clearTimeout, AbortController, DOMException, structuredClone,
  });
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  new Script(compiled, { filename: "independent-pre-edit-turn-planner.cjs" }).runInContext(context);
  const original = originalModule.exports as { planTurnV3: typeof import("../../../../packages/tutor-core/src/planners/turnPlannerV3").planTurnV3 };
  const options = { proxyUrl: "http://offline.test/api/chat", timeoutMs: 120_000, traceId: "parity", fastMode: false,
    conversationContext: "  Existing conversation context.  " };
  await original.planTurnV3(question, options);
  assert.equal(bodies.length, 2, "the independent baseline must expose both initial request bodies");
  const expected = [...bodies];
  bodies.length = 0;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await planTurnV3Lane(question, options, "primary");
    await planTurnV3Lane(question, options, "alternate");
  } finally { globalThis.fetch = nativeFetch; }
  const hash = (body: string) => createHash("sha256").update(body).digest("hex");
  assert.deepEqual(bodies.map(hash), expected.map(hash), "both extracted initial lanes retain byte-identical bodies/prompts");
}

/** Inspect actual capped-fetch wiring and execute its private response capture in memory. */
async function verifyCappedFetchWiring(): Promise<void> {
  const runner = sourceFile("scripts/lecture-lab/run.ts");
  const assignments = nodesWhere(runner, (node): node is ts.BinaryExpression =>
    ts.isBinaryExpression(node) && node.left.getText(runner) === "globalThis.fetch" &&
    node.right.getText(runner).includes("async (input:"));
  assert.equal(assignments.length, 1);
  const arrows = nodesWhere(assignments[0]!.right, ts.isArrowFunction);
  const wrapper = arrows[0]!;
  assert(wrapper && ts.isBlock(wrapper.body));
  const topLevelGuard = wrapper.body.statements.find((statement): statement is ts.IfStatement =>
    ts.isIfStatement(statement) && statement.expression.getText(runner) === "options.plannerOnly");
  assert(topLevelGuard, "the no-ancillary guard must run outside the allowed-origin header branch");
  singleCall(topLevelGuard, runner, "assertPlannerOnlyRequest");
  const dispatch = singleCall(wrapper, runner, "nativeFetch");
  const reservation = singleCall(wrapper, runner, "reserveLabRequest");
  assert(topLevelGuard.getStart(runner) < reservation.getStart(runner));
  assert(reservation.getStart(runner) < dispatch.getStart(runner), "every probe dispatch must reserve first");
  const headers = new Headers(probeHeaders);
  headers.set("x-heytutor-trace-id", "synthetic-probe-trace");
  assert.doesNotThrow(() => assertPlannerOnlyRequest("http://offline.test/api/chat", headers, "http://offline.test"));
  for (const url of ["https://forbidden.invalid/api/chat", "http://offline.test/api/visual-need", "http://offline.test/api/notes"]) {
    assert.throws(() => assertPlannerOnlyRequest(url, headers, "http://offline.test"), /planner.only/i,
      "other origins and ancillary endpoints fail before paid dispatch");
  }
  for (const forbiddenHeader of ["x-problem-ir-version", "x-code-lesson-version", "x-diagram-example-picker", "x-scene-planner-version"]) {
    const mixed = new Headers(headers);
    mixed.set(forbiddenHeader, forbiddenHeader === "x-scene-planner-version" ? "2" : "1");
    assert.throws(() => assertPlannerOnlyRequest("http://offline.test/api/chat", mixed, "http://offline.test"), /planner.only/i);
  }
  const anonymous = new Headers(headers);
  anonymous.delete("x-heytutor-trace-id");
  assert.throws(() => assertPlannerOnlyRequest("http://offline.test/api/chat", anonymous, "http://offline.test"), /planner.only/i,
    "a missing accounting trace cannot bypass reservation classification");
  const attempts = variable(wrapper, "maxAttempts").initializer!;
  assert.equal(evaluateExpression(attempts, runner, { chatRequest: true, plannerRequest: true, options: { plannerOnly: true } }), 1);
  assert.equal(evaluateExpression(attempts, runner, { chatRequest: true, plannerRequest: true, options: { plannerOnly: false } }), 2);
  assert.equal(evaluateExpression(attempts, runner, { chatRequest: true, plannerRequest: false, options: { plannerOnly: false } }), 3);
  const ceiling = variable(wrapper, "requestWorstCaseUsd").initializer!;
  const costBindings = { chatRequest: true, plannerRequest: true, directProviderRequest: false, init: {},
    requestModel: "accounts/fireworks/models/kimi-k3", inputBound: undefined,
    serverConfig: { plannerOutputCap: 5200, planningSpeed: { priority: false } },
    plannerRequestWorstCaseUsd: (_init: unknown, _model: string, cap: number) => {
      assert.equal(cap, 5200, "the existing cap wrapper must still honor the effective server output bound");
      return 0.125;
    } };
  assert.equal(evaluateExpression(ceiling, runner, { ...costBindings, maxAttempts: 1 }), 0.125);
  assert.equal(evaluateExpression(ceiling, runner, { ...costBindings, maxAttempts: 2 }), 0.25);

  const captures = nodesWhere(wrapper, (node): node is ts.IfStatement => ts.isIfStatement(node) &&
    node.expression.getText(runner) === "options.plannerOnly && traceId");
  assert.equal(captures.length, 1);
  const capture = captures[0]!;
  const settlement = singleCall(wrapper, runner, "usageTracker.recordResponse");
  assert(capture.getStart(runner) < settlement.getStart(runner), "raw paid evidence must be saved before usage settlement/checkpoint");
  const attachment = nodesWhere(runner, (node): node is ts.BinaryExpression => ts.isBinaryExpression(node) &&
    node.left.getText(runner) === "run.plannerProbe.responses");
  assert.equal(attachment.length, 1, "completed probe raw responses must be attached to saved row evidence");
  for (const rawResponseText of [
    JSON.stringify({ choices: [{ message: { content: "synthetic-private-content" }, finish_reason: "length" }],
      usage: { prompt_tokens: 200, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 7 } } }),
    "synthetic-malformed-response-envelope",
  ]) {
    const responses = new Map<string, Array<Record<string, unknown>>>();
    let clock = 1000;
    let releaseBody: (() => void) | undefined;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      releaseBody = () => { controller.enqueue(new TextEncoder().encode(rawResponseText)); controller.close(); };
    } }), { headers: { "x-heytutor-planner-model": "accounts/fireworks/models/kimi-k3" } });
    const writes: string[] = [];
    const context = createContext({
      response, Date: { now: () => clock }, traceId: "raw-probe", requestStartedAt: 1000,
      requestProfile: { requestKind: "turn_plan" }, init: { body: "synthetic-request" },
      labSampleFingerprint, probeResponses: responses, outDir: "/offline-only",
      mkdirSync: () => {}, writeFileSync: (_path: string, content: string, options: { mode: number }) => {
        assert.equal(options.mode, 0o600, "private raw evidence is created with private file permissions");
        writes.push(content);
      },
    });
    const code = ts.transpileModule(`(async () => ${capture.thenStatement.getText(runner)})()`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    const pending = new Script(code, { filename: "actual-private-probe-capture.cjs" }).runInContext(context);
    await Promise.resolve();
    assert.equal(writes.length, 0, "a header-only response cannot become completed raw evidence");
    clock = 1800;
    assert(releaseBody);
    releaseBody();
    await pending;
    const saved = responses.get("raw-probe");
    assert(saved && saved.length === 1);
    assert.equal(saved[0]!.elapsedMs, 800, "reported latency includes full response-body completion");
    assert.equal(saved[0]!.rawResponseText, rawResponseText, "malformed envelopes survive private raw capture");
    assert.equal(writes.length, 1);
    const run = { plannerProbe: { responses: [] } };
    const attached = evaluateExpression(attachment[0]!, runner, { run, probeResponses: responses, traceId: "raw-probe" });
    assert.equal(attached, saved, "the row receives its own complete raw per-call evidence");
  }
}

function verifyAdmission(): void {
  const options = parseOptions(["--eval", "synthetic.jsonl", "--planner-only", "--max-usd", "3"]);
  assert.equal(options.plannerOnly, true, "planner-only must be an explicit execution mode");
  assert.equal(options.spendMode, "conservative", "the planner probe must preserve unknown spend exposure");
  assert.equal(options.scenePlannerLimitMs, 120_000, "planner probe defaults must measure the requested 120 s window");
  assert.equal(parseOptions(["--max-usd", "3"]).plannerOnly, false, "ordinary lab execution stays unchanged");
  for (const extra of [
    ["--arm", "planner_examples"],
    ["--spend-mode", "response_usage"],
    ["--model", "fast"],
  ]) {
    assert.throws(() => parseOptions(["--eval", "synthetic.jsonl", "--planner-only", "--max-usd", "3", ...extra]),
      /planner|configured|conservative|current|evaluation/i, "unsupported planner probe profiles must fail before dispatch");
  }
  assert.throws(() => parseOptions(["--planner-only", "--max-usd", "3"]), /eval|planner/i,
    "planner-only requires the identity-bound evaluation sample");

  assert.equal(isLectureLabPlannerProbe(request(probeHeaders), syntheticEnv), true);
  assert.equal(lectureLabPlannerDeadlineCapMs(request(probeHeaders), syntheticEnv), 120_000);
  const sceneHeaders = new Headers(probeHeaders);
  sceneHeaders.delete("x-turn-planner-version");
  sceneHeaders.set("x-scene-planner-version", "2");
  assert.equal(isLectureLabPlannerProbe(request(sceneHeaders), syntheticEnv), true);
  for (const header of [LECTURE_LAB_HEADER, LECTURE_LAB_STANDARD_MODEL_HEADER, LECTURE_LAB_PLANNER_PROBE_HEADER, "x-planner"]) {
    const missing = new Headers(probeHeaders);
    missing.delete(header);
    assert.equal(isLectureLabPlannerProbe(request(missing), syntheticEnv), false,
      `missing ${header} cannot enable the paid probe profile`);
  }
  const wrongToken = new Headers(probeHeaders);
  wrongToken.set(LECTURE_LAB_HEADER, "incorrect-synthetic-token");
  assert.equal(isLectureLabPlannerProbe(request(wrongToken), syntheticEnv), false);
  for (const laneHeaders of [
    { "x-problem-ir-version": "1" },
    { "x-code-lesson-version": "1" },
    { "x-diagram-example-picker": "1" },
  ]) {
    const forbidden = new Headers(probeHeaders);
    forbidden.delete("x-turn-planner-version");
    for (const [name, value] of Object.entries(laneHeaders)) forbidden.set(name, value);
    assert.equal(isLectureLabPlannerProbe(request(forbidden), syntheticEnv), false,
      "the probe exception must not admit an ancillary paid lane");
    forbidden.set("x-turn-planner-version", "3");
    assert.equal(isLectureLabPlannerProbe(request(forbidden), syntheticEnv), false,
      "a turn-plan header cannot disguise an ancillary paid lane");
  }
  assert.equal(isLectureLabPlannerProbe(request(probeHeaders), { ...syntheticEnv, LLM_PROVIDER: "azure" }), false,
    "the Fireworks probe exception cannot change Azure transport settings");
  const conflicting = new Headers(probeHeaders);
  conflicting.set("x-scene-planner-version", "2");
  assert.equal(isLectureLabPlannerProbe(request(conflicting), syntheticEnv), false,
    "ambiguous planner versions cannot enter the single-lane diagnostic");
  const ordinary = request({ "x-planner": "1", "x-turn-planner-version": "3" });
  assert.equal(isLectureLabPlannerProbe(ordinary, { ...syntheticEnv, NODE_ENV: "production" }), false);
  assert.equal(lectureLabPlannerDeadlineCapMs(ordinary, syntheticEnv), 60_000);
  assert.equal(lectureLabPlannerDeadlineCapMs(ordinary, { ...syntheticEnv, LLM_PROVIDER: "azure" }), 60_000,
    "ordinary Azure turn requests keep the existing deadline policy");
}

interface CapturedCall {
  url: string;
  headers: Headers;
  body: { stream?: boolean; messages?: Array<{ role?: string; content?: string }> };
}

async function runOffline(scene: Record<string, unknown>, validTurn = true) {
  const nativeFetch = globalThis.fetch;
  const calls: CapturedCall[] = [];
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const bodyText = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "{}";
    const body = JSON.parse(bodyText) as CapturedCall["body"];
    calls.push({ url, headers, body });
    assert.equal(url, "http://offline.test/api/chat", "planner-only cannot call another paid endpoint or provider origin");
    assert.equal(headers.get("x-planner"), "1", "teaching/notes/audio are outside the probe");
    const isTurn = headers.get("x-turn-planner-version") === "3";
    const isScene = headers.get("x-scene-planner-version") === "2";
    assert(isTurn !== isScene, "every request must be exactly one declared planner lane");
    assert.equal(headers.get("x-problem-ir-version"), null);
    assert.equal(headers.get("x-code-lesson-version"), null);
    assert.equal(headers.get("x-diagram-example-picker"), null);
    return Response.json({
      model: "accounts/fireworks/models/kimi-k3",
      choices: [{ message: { content: JSON.stringify(isTurn
        ? validTurn ? turnPlan : { ...turnPlan, unknowns: [{ id: "synthetic-invalid-unknown" }] }
        : scene) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300, completion_tokens_details: { reasoning_tokens: 0 } },
    }, { headers: { "x-heytutor-planner-model": "accounts/fireworks/models/kimi-k3", "x-heytutor-upstream-attempts": "1" } });
  };
  try {
    const run = await runLecture(question, {
      origin: "http://offline.test", cookie: "", plannerOnly: true, figureOnly: true, traceId: "probe",
    });
    assert.equal(calls.length, 2, "one primary turn + one primary scene are the entire paid probe");
    assert.equal(calls[0]?.headers.get("x-turn-planner-lane"), "primary");
    assert.equal(calls[1]?.headers.get("x-scene-planner-lane"), "primary");
    for (const call of calls) {
      assert.equal(call.headers.get("x-planner-deadline-ms"), "120000", "both request lanes receive the full probe deadline");
      assert.equal(call.body.stream, false);
      assert(call.body.messages?.length, "the real planner prompt must reach the network boundary");
    }
    assert.equal(run.turnPlanStatus, validTurn ? "planned" : "fallback", "turn status reflects real parser admission");
    assert.equal(run.solver, null, "planner-only does not create ProblemIR/solver authority");
    assert.equal(run.teaching.rawText, "");
    return run;
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function main(): Promise<void> {
  const fixtureValidation = validateProductionSceneCandidate({ candidate: declinedScene, question, turnPlan });
  assert.equal(fixtureValidation.valid, true, "the declined-scene fixture must pass the existing production validators");
  verifyAdmission();
  await verifyRouteWiring();
  await verifyInitialPromptParity();
  await verifyCappedFetchWiring();
  const declined = await runOffline(declinedScene);
  assert.equal(declined.diagram.committed, false, "a validated text-only decline must not render");
  assert.equal(declined.diagram.candidateErrorCodes.length, 0,
    "a valid text-only decline must not be reported as malformed scene geometry");
  const invalid = await runOffline({ ...declinedScene, schemaVersion: "synthetic-invalid-schema" });
  assert(invalid.diagram.candidateErrorCodes.length > 0,
    "planner-only still rejects invalid output through the real scene validators");
  const acceptedFixture = validateProductionSceneCandidate({ candidate: labelledScene, question, turnPlan });
  assert.equal(acceptedFixture.valid, true, `the labelled fixture must pass the real scene validator: ${JSON.stringify(acceptedFixture.errors)}`);
  const accepted = await runOffline(labelledScene);
  assert.equal(accepted.error, null);
  assert.equal(accepted.plannerProbe?.sceneAccepted, true);
  assert.equal(accepted.diagram.committed, true, "a real accepted scene reaches production selection and rendering");
  assert(accepted.diagram.entityIds.includes("ab"), "selected entity IDs come from the accepted scene document");
  assert(accepted.diagram.renderedLabels.includes("AB"), "readable verified labels survive diagnostic rendering");
  assert.match(accepted.diagram.svg ?? "", /<svg\b/);
  assert.match(accepted.diagram.svg ?? "", /AB/);
  const fallback = await runOffline(declinedScene, false);
  assert.equal(fallback.plannerProbe?.turnAccepted, false);
  assert.equal(fallback.plannerProbe?.authority, "fallback_no_numeric_authority",
    "rejected turn content never becomes numeric authority for the diagnostic");
  assert(fallback.turnPlanCallOutcomes?.some((outcome) => outcome.code === "plan_validation_failed"),
    "invalid turn-plan admission records the actual rejection outcome");
  console.log("planner-only probe GREEN: authenticated 120 s primary lanes only, real parser/scene validation, no ancillary calls (zero network/model/DB calls)");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
