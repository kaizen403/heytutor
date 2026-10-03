/**
 * Speculative scene planning during ProblemIR, on fake planners and a fake clock.
 *
 * Every dependency of runScenePlanningOverlap is scripted, so each scenario
 * states the order of events it expects: when the scene planner started, on
 * which plan, what was aborted, what restarted with which budget, and which
 * plan the selected candidates were validated against.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import {
  decideSpeculation,
  runScenePlanningOverlap,
  shouldStartSpeculativeScene,
  type SceneGateCore,
} from "../../features/tutor-session/lib/scene/planningOverlap";

type Authority = { id: string; contradiction?: boolean; plan?: TurnPlanV3 };
type Gate = SceneGateCore & { planId: string };
type Fast = { figure: string };
type Result = {
  tag: string;
  candidates: unknown[];
  validation: { valid: boolean };
  repairRounds: number;
  validatedAgainst: TurnPlanV3;
};

const QUESTION = "A projectile is launched at 20 m/s at 30 degrees. Find its range.";
const plan = (value: number): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3",
  question: QUESTION,
  givens: [{ id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" }],
  unknowns: [{ id: "range", symbol: "R", unit: "m" }],
  derived: [{ id: "range", symbol: "R", value, unit: "m", provenance: "derived", sourceText: "R" }],
  qualitativeClaims: [],
  lawIds: ["projectile"],
  assumptions: [],
  visualRequirement: "required",
} as unknown as TurnPlanV3);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

type Event = { name: string; atMs: number; data?: Record<string, unknown>; parent?: string };
type PlanCall = {
  gate: Gate;
  plan: TurnPlanV3;
  signal: AbortSignal;
  timeoutMs: number;
  atMs: number;
  reply: ReturnType<typeof deferred<Result | null>>;
};

interface Script {
  initialPlan?: TurnPlanV3;
  authority?: "none" | "pending" | "resolved";
  speculationAllowed?: boolean;
  /** Gate per plan and authority. Defaults to one stable projectile gate. */
  gate?: (plan: TurnPlanV3, authority: Authority | null) => Partial<Gate>;
  fast?: (plan: TurnPlanV3, authority: Authority | null) => Fast | null;
  recover?: Result | null;
  guard?: <T>(operation: Promise<T>) => Promise<T>;
  plannerStartedAt?: number;
}

function harness(script: Script) {
  let nowMs = 0;
  const events: Event[] = [];
  const planCalls: PlanCall[] = [];
  const revalidations: TurnPlanV3[] = [];
  const authority = deferred<Authority | null>();
  const initialPlan = script.initialPlan ?? plan(35.35);
  const record = (name: string, data?: Record<string, unknown>, parent?: string) =>
    events.push({ name, atMs: nowMs, data, parent });
  const telemetry = {
    mark: (name: string, data?: Record<string, unknown>) => record(name, data),
    span: (name: string, parent?: string) => {
      record(`${name}:start`, undefined, parent);
      return { end: (data?: Record<string, unknown>) => record(`${name}:end`, data, parent) };
    },
  };
  const deriveGate = (gatePlan: TurnPlanV3, gateAuthority: Authority | null): Gate => ({
    shouldPlanExactScene: true,
    shouldAttemptLlmScene: true,
    families: ["projectile"],
    archetypeId: "projectile_trajectory",
    request: { conversationContext: JSON.stringify(gatePlan), guidance: ["trajectory"] },
    planId: gateAuthority ? "final" : "speculative",
    ...script.gate?.(gatePlan, gateAuthority),
  });
  const authorityPromise = script.authority === "none"
    ? null
    : script.authority === "resolved"
      ? Promise.resolve<Authority | null>({ id: "ir" })
      : authority.promise;
  const outcome = runScenePlanningOverlap<Authority, Gate, Fast, Result>({
    turnPlan: initialPlan,
    problemAuthority: authorityPromise,
    speculationAllowed: script.speculationAllowed ?? true,
    plannerStartedAt: script.plannerStartedAt ?? 0,
    deadlineMs: 60_000,
    now: () => nowMs,
    guard: script.guard,
    telemetry,
    parentSpan: "planner",
    deriveGate,
    applyAuthority: (authorityPlan, answered) => ({
      turnPlan: answered.plan ?? authorityPlan,
      authority: answered,
    }),
    fastFigureBlocked: (answered) => answered?.contradiction === true,
    recover: script.recover === undefined ? undefined : () => script.recover ?? null,
    selectFast: (fastPlan, fastAuthority) => script.fast?.(fastPlan, fastAuthority) ?? null,
    planScene: (gate, scenePlan, run) => {
      const reply = deferred<Result | null>();
      planCalls.push({ gate, plan: scenePlan, signal: run.signal, timeoutMs: run.timeoutMs, atMs: nowMs, reply });
      record("plan-scene", { plan: gate.planId });
      return reply.promise;
    },
    revalidate: async (result, finalPlan) => {
      revalidations.push(finalPlan);
      return { ...result, tag: `${result.tag}+revalidated`, validatedAgainst: finalPlan };
    },
  });
  void outcome.catch(() => {});
  return {
    outcome,
    events,
    planCalls,
    revalidations,
    authority,
    initialPlan,
    advance: (ms: number) => {
      nowMs += ms;
    },
    result: (tag: string, call: PlanCall, valid = true): Result => ({
      tag,
      candidates: [{}, {}],
      validation: { valid },
      repairRounds: 1,
      validatedAgainst: call.plan,
    }),
  };
}

const names = (events: Event[]) => events.map((event) => event.name);
let passed = 0;
async function scenario(name: string, run: () => Promise<void>) {
  await run();
  passed += 1;
  console.log(`verify-planning-overlap: ${name}`);
}

// Pure decisions first.
const baseGate: SceneGateCore = {
  shouldPlanExactScene: true,
  shouldAttemptLlmScene: true,
  families: ["a", "b"],
  archetypeId: null,
  request: { conversationContext: "x" },
};
const start = (overrides: Partial<Parameters<typeof shouldStartSpeculativeScene>[0]>) =>
  shouldStartSpeculativeScene({
    speculationAllowed: true,
    authorityPending: true,
    gate: baseGate,
    remainingMs: 1_000,
    deterministicPredicted: false,
    ...overrides,
  });
assert.equal(start({}), true);
assert.equal(start({ speculationAllowed: false }), false, "a recovered scene never speculates");
assert.equal(start({ authorityPending: false }), false, "nothing to overlap once ProblemIR answered");
assert.equal(start({ gate: { ...baseGate, shouldPlanExactScene: false } }), false, "visual none or chemistry");
assert.equal(start({ gate: { ...baseGate, shouldAttemptLlmScene: false } }), false, "no family and no archetype");
assert.equal(start({ remainingMs: 0 }), false, "no budget");
assert.equal(start({ deterministicPredicted: true }), false, "the turn plan already compiles a figure");
const finalFacts = (overrides: Partial<Parameters<typeof decideSpeculation>[1]> = {}) => ({
  gate: baseGate,
  turnPlan: plan(1),
  deterministicSelected: false,
  recovered: false,
  remainingMs: 1_000,
  ...overrides,
});
const specPlan = plan(1);
assert.deepEqual(decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ turnPlan: specPlan })), { keep: true });
assert.deepEqual(
  decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ turnPlan: structuredClone(specPlan) })),
  { keep: true },
  "a deep-equal plan is the same facts",
);
assert.deepEqual(
  decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ gate: { ...baseGate, families: ["b", "a"] }, turnPlan: specPlan })),
  { keep: true },
  "family order alone is not a family change when the request is identical",
);
assert.equal(
  (decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ deterministicSelected: true })) as { reason: string }).reason,
  "deterministic",
);
assert.equal(
  (decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ gate: { ...baseGate, families: ["a"] } })) as { reason: string }).reason,
  "families_changed",
);
assert.equal(
  (decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ gate: { ...baseGate, archetypeId: "x" } })) as { reason: string }).reason,
  "families_changed",
);
assert.equal(
  (decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ turnPlan: plan(2) })) as { reason: string }).reason,
  "values_changed",
);
assert.equal(
  (decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ turnPlan: specPlan, gate: { ...baseGate, request: { conversationContext: "y" } } })) as { reason: string }).reason,
  "inputs_changed",
);
assert.deepEqual(
  decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ gate: { ...baseGate, shouldAttemptLlmScene: false } })),
  { keep: false, reason: "not_attempted", restart: false },
);
assert.deepEqual(
  decideSpeculation({ gate: baseGate, turnPlan: specPlan }, finalFacts({ turnPlan: specPlan, remainingMs: 0 })),
  { keep: false, reason: "budget", restart: false },
);

async function main(): Promise<void> {
  await scenario("a turn with no ProblemIR plans exactly once, after the gate, as before", async () => {
    const h = harness({ authority: "none" });
    await flush();
    assert.equal(h.planCalls.length, 1);
    assert.equal(h.planCalls[0]!.gate.planId, "speculative", "no authority: the turn plan is the final plan");
    assert.equal(h.planCalls[0]!.plan, h.initialPlan);
    assert(!names(h.events).some((name) => name.startsWith("scene-speculative")));
    h.planCalls[0]!.reply.resolve(h.result("only", h.planCalls[0]!));
    const outcome = await h.outcome;
    assert.equal(outcome.scene?.tag, "only", "an unchanged plan with no authority is not revalidated");
    assert.deepEqual(outcome.speculation, { started: false, kept: false, abortReason: null, restarted: false });
    assert.deepEqual(names(h.events), [
      "deterministic-figure:start", "deterministic-figure:end", "scene-planner:start", "plan-scene",
      "scene-planner:end", "revalidate:start", "revalidate:end",
    ]);
  });

  await scenario("speculation starts while ProblemIR is pending and is kept when the facts hold", async () => {
    const h = harness({ plannerStartedAt: 0 });
    h.advance(9_000);
    await flush();
    assert.equal(h.planCalls.length, 1, "the scene planner starts before ProblemIR answers");
    assert.equal(h.planCalls[0]!.plan, h.initialPlan);
    assert.equal(h.planCalls[0]!.timeoutMs, 51_000, "it runs inside the same 60s planner budget");
    assert.equal(names(h.events).indexOf("scene-speculative-start") > names(h.events).indexOf("plan-scene"), true);
    h.advance(6_000);
    h.authority.resolve({ id: "ir" });
    await flush();
    assert.equal(h.planCalls.length, 1, "kept: no second planner run");
    assert(!h.planCalls[0]!.signal.aborted);
    h.advance(10_000);
    h.planCalls[0]!.reply.resolve(h.result("spec", h.planCalls[0]!));
    const outcome = await h.outcome;
    assert.equal(outcome.speculation.kept, true);
    assert.equal(outcome.speculation.restarted, false);
    assert.equal(outcome.scene?.tag, "spec+revalidated", "solver authority forces the final revalidation");
    assert.deepEqual(h.revalidations, [h.initialPlan], "selection runs on the final plan");
    assert.equal(outcome.timings.scenePlannerMs, 16_000);
    const plannerEnd = h.events.find((event) => event.name === "scene-planner:end");
    assert.deepEqual(plannerEnd?.data, { speculative: true, restarted: false, candidates: 2, repair_rounds: 1, valid: true });
    assert(h.events.filter((event) => event.name.endsWith(":start")).every((event) => event.parent === "planner"));
  });

  await scenario("the deterministic figure on the final facts aborts speculation", async () => {
    const h = harness({ fast: (_plan, answered) => answered ? { figure: "trajectory" } : null });
    await flush();
    assert.equal(h.planCalls.length, 1);
    h.authority.resolve({ id: "ir" });
    const outcome = await h.outcome;
    assert(h.planCalls[0]!.signal.aborted, "the speculative planner is aborted");
    assert.equal(h.planCalls.length, 1, "no restart");
    assert.deepEqual(outcome.fast, { figure: "trajectory" });
    assert.equal(outcome.scene, null);
    assert.deepEqual(h.events.find((event) => event.name === "scene-speculative-abort")?.data, { reason: "deterministic" });
    h.planCalls[0]!.reply.resolve(h.result("late", h.planCalls[0]!));
    await flush();
    assert.equal(outcome.scene, null, "a late speculative answer is never observed");
  });

  await scenario("a family change restarts the planner on the final inputs within the remaining budget", async () => {
    const h = harness({
      gate: (_plan, answered) => answered ? { families: ["projectile", "vector_diagram"] } : {},
    });
    h.advance(10_000);
    await flush();
    h.advance(8_000);
    h.authority.resolve({ id: "ir" });
    await flush();
    assert.equal(h.planCalls.length, 2);
    assert(h.planCalls[0]!.signal.aborted);
    assert.equal(h.planCalls[1]!.gate.planId, "final", "the restart uses the gate inferred with ProblemIR");
    assert.equal(h.planCalls[1]!.timeoutMs, 42_000, "the restart gets only what is left of 60s");
    assert.deepEqual(h.events.find((event) => event.name === "scene-speculative-abort")?.data, { reason: "families_changed" });
    h.planCalls[1]!.reply.resolve(h.result("restart", h.planCalls[1]!));
    const outcome = await h.outcome;
    assert.equal(outcome.speculation.restarted, true);
    assert.equal(outcome.speculation.kept, false);
    assert(outcome.scene?.tag.startsWith("restart"));
    const ends = h.events.filter((event) => event.name === "scene-planner:end").map((event) => event.data);
    assert.deepEqual(ends[0], { speculative: true, restarted: false, aborted: "families_changed" });
    assert.equal(ends[1]?.restarted, true);
  });

  await scenario("a reconciled quantity discards candidates built on stale numbers", async () => {
    const reconciled = plan(36.1);
    const h = harness({});
    await flush();
    h.authority.resolve({ id: "ir", plan: reconciled });
    await flush();
    assert.equal(h.planCalls.length, 2, "values changed: restart");
    assert.equal(h.planCalls[1]!.plan, reconciled, "the restarted validator is bound to the reconciled plan");
    assert.deepEqual(h.events.find((event) => event.name === "scene-speculative-abort")?.data, { reason: "values_changed" });
    h.planCalls[0]!.reply.resolve(h.result("stale", h.planCalls[0]!));
    h.planCalls[1]!.reply.resolve(h.result("fresh", h.planCalls[1]!));
    const outcome = await h.outcome;
    assert(outcome.scene?.tag.startsWith("fresh"), "a stale candidate is never selected");
    assert.equal(outcome.turnPlan, reconciled);
    assert(h.revalidations.every((revalidated) => revalidated === reconciled));
  });

  await scenario("a solver contradiction keeps the serial behaviour: no deterministic figure, planner result kept", async () => {
    let fastCalls = 0;
    const h = harness({ fast: () => { fastCalls += 1; return { figure: "never" }; } });
    await flush();
    // The turn plan alone predicts a deterministic figure, so nothing starts.
    assert.equal(h.planCalls.length, 0);
    assert.deepEqual(h.events.find((event) => event.name === "scene-speculative-skip")?.data, { reason: "deterministic_predicted" });
    h.authority.resolve({ id: "ir", contradiction: true });
    await flush();
    assert.equal(fastCalls, 1, "the contradiction keeps the final deterministic figure off");
    assert.equal(h.planCalls.length, 1, "the planner runs on the final facts as before");
    h.planCalls[0]!.reply.resolve(h.result("serial", h.planCalls[0]!));
    const outcome = await h.outcome;
    assert.equal(outcome.fast, null);
    assert(outcome.scene?.tag.startsWith("serial"));

    const kept = harness({});
    await flush();
    kept.authority.resolve({ id: "ir", contradiction: true });
    await flush();
    assert.equal(kept.planCalls.length, 1, "a speculative run is kept through a contradiction, exactly as the serial planner ran");
    kept.planCalls[0]!.reply.resolve(kept.result("spec", kept.planCalls[0]!));
    assert((await kept.outcome).scene?.tag.startsWith("spec"));
  });

  await scenario("the final exact gate can withdraw the planner: abort without restart", async () => {
    const h = harness({ gate: (_plan, answered) => answered ? { shouldAttemptLlmScene: false, families: [] } : {} });
    await flush();
    h.authority.resolve({ id: "ir" });
    const outcome = await h.outcome;
    assert(h.planCalls[0]!.signal.aborted);
    assert.equal(h.planCalls.length, 1);
    assert.equal(outcome.scene, null);
    assert.equal(outcome.speculation.abortReason, "not_attempted");
  });

  await scenario("paths that never reach the LLM planner never speculate", async () => {
    for (const [label, script] of [
      ["recovered scene", { speculationAllowed: false, recover: null }],
      ["visual none or chemistry", { gate: () => ({ shouldPlanExactScene: false, shouldAttemptLlmScene: false }) }],
      ["no family and no archetype", { gate: () => ({ shouldAttemptLlmScene: false, families: [], archetypeId: null }) }],
      ["budget spent", { plannerStartedAt: -60_000 }],
      ["ProblemIR already answered", { authority: "resolved" }],
    ] as Array<[string, Script]>) {
      const h = harness(script);
      await flush();
      const startedEarly = h.planCalls.length > 0 && h.events.some((event) => event.name === "scene-speculative-start");
      assert(!startedEarly, `${label}: speculation must not start`);
      h.authority.resolve({ id: "ir" });
      await flush();
      for (const call of h.planCalls) call.reply.resolve(h.result("late", call));
      await h.outcome;
    }
  });

  await scenario("a recovered scene skips planning and the deterministic figure", async () => {
    const recovered: Result = { tag: "recovered", candidates: [{}], validation: { valid: true }, repairRounds: 0, validatedAgainst: plan(35.35) };
    let fastCalls = 0;
    const h = harness({ speculationAllowed: false, recover: recovered, fast: () => { fastCalls += 1; return null; } });
    await flush();
    h.authority.resolve({ id: "ir" });
    const outcome = await h.outcome;
    assert.equal(h.planCalls.length, 0);
    assert.equal(fastCalls, 0);
    assert.equal(outcome.recovered, true);
    assert(outcome.scene?.tag.startsWith("recovered"));
  });

  await scenario("a cancelled turn aborts the in-flight planner and rethrows", async () => {
    let cancelled = false;
    const h = harness({
      guard: async (operation) => {
        const value = await operation;
        if (cancelled) throw new DOMException("turn cancelled", "AbortError");
        return value;
      },
    });
    await flush();
    cancelled = true;
    h.authority.resolve({ id: "ir" });
    await assert.rejects(h.outcome, /turn cancelled/);
    assert(h.planCalls[0]!.signal.aborted);

    const failing = harness({});
    await flush();
    failing.authority.reject(new Error("authority transport"));
    await assert.rejects(failing.outcome, /authority transport/);
    assert(failing.planCalls[0]!.signal.aborted, "a thrown authority never leaves a planner running");
  });

  await scenario("telemetry carries no student text", async () => {
    const h = harness({ gate: (_plan, answered) => answered ? { families: ["other"] } : {} });
    await flush();
    h.authority.resolve({ id: "ir" });
    await flush();
    h.planCalls[1]!.reply.resolve(h.result("r", h.planCalls[1]!));
    await h.outcome;
    for (const event of h.events) {
      for (const value of Object.values(event.data ?? {})) {
        assert(["number", "boolean"].includes(typeof value) || value === null ||
          (typeof value === "string" && value.length <= 32 && !QUESTION.includes(value)),
        `${event.name} carries a free text value: ${String(value)}`);
      }
    }
  });

  // Both callers run the same module, so the bench measures the live path.
  const appRoot = join(process.cwd());
  const hook = readFileSync(join(appRoot, "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  const bench = readFileSync(join(appRoot, "scripts/lecture-lab/lecturePipeline.ts"), "utf8");
  assert(/await runScenePlanningOverlap</.test(hook), "the live hook must plan through runScenePlanningOverlap");
  assert(/await runScenePlanningOverlap</.test(bench), "the lecture lab must plan through runScenePlanningOverlap");
  assert(/speculationAllowed: recoveredScene === null/.test(hook), "a recovered scene must never speculate");
  assert(!/planSceneDocumentWithRepair\([\s\S]{0,40}validateCandidate,/.test(hook),
    "the hook must not keep a second, serial scene planner call");
  assert(/tel\.span\("turn-plan", "planner"\)/.test(hook) && /tel\.span\("problem-ir", "planner"\)/.test(hook),
    "turn-plan and problem-ir spans are children of planner");
  passed += 1;
  console.log(`verify-planning-overlap: ${passed} scenarios passed`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
