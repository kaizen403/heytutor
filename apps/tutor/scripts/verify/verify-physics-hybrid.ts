import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIGURE_SOURCES, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  decideDiagramStrategy, diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision,
  parsePhysicsDiagramMode, PHYSICS_HYBRID_POLICY_VERSION,
  type DiagramStrategyContext, type DiagramStrategyDecision,
} from "../../features/tutor-session/lib/scene/diagramStrategy";
import { deriveSceneGate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { resolvePhysicsDiagramMode } from "../../lib/scene/diagramStrategy.server";
import { beginTurn } from "../../lib/billing/billingClient";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildHybridAllowlist, simulatePhysicsHybrid, hybridMetrics, type HybridRow } from "../lecture-lab/physicsHybrid";

assert.equal(parsePhysicsDiagramMode(undefined), null, "live physics hybrid is default-off");
assert.equal(parsePhysicsDiagramMode("hybrid"), "hybrid", "only the exact approved value enables hybrid");

const figure: HybridRow = {
  id: "same", question: "same question", chapter: "physics|2", source: "fast_family", family: "motion_path",
  archetype: null, drawn: true, required: true, verdict: "partial",
};
const empty: HybridRow = { ...figure, source: "text_only", drawn: false, verdict: "empty_bad" };
const key = "fast_family:motion_path";
assert.equal(buildHybridAllowlist(Array(4).fill(figure), .1)[0]!.qualifies, false);
assert.equal(buildHybridAllowlist(Array(5).fill(figure), .1)[0]!.qualifies, true);
const oneWrong = [...Array(9).fill(figure), { ...figure, verdict: "wrong" as const }];
assert.equal(buildHybridAllowlist(oneWrong, .1)[0]!.qualifies, true, "10% boundary inclusive");
assert.equal(buildHybridAllowlist(oneWrong.slice(1), .1)[0]!.qualifies, false);
assert.equal(simulatePhysicsHybrid(figure, empty, new Set([key])), figure);
assert.equal(simulatePhysicsHybrid(figure, empty, new Set()), empty);
assert.equal(simulatePhysicsHybrid(figure, { ...figure, source: "planner", verdict: "wrong" }, new Set([key])).verdict, "wrong", "strict accepted always wins");
assert.equal(simulatePhysicsHybrid({ ...figure, source: "planner" }, empty, new Set([key])), empty, "never use current planner as a deterministic fallback");
assert.throws(() => simulatePhysicsHybrid({ ...figure, question: "different" }, empty, new Set([key])), /identical/);
assert.deepEqual(hybridMetrics([figure, empty]), { tested: 2, useful: 1, wrong: 0, requiredEmpty: 1 });
console.log("physics hybrid verification passed (zero model calls)");

// Live policy fixtures are independently frozen from the approved contract,
// not imported from the implementation's allowlist or evaluation chapters.
const POLICY = "physics-hybrid/preplanning-signals-v1";
const currentFamilies = [
  "ray_path", "axis_view", "interface", "instrument_chain", "aperture", "screen_pattern", "polarizer",
] as const;
const currentArchetypes = [
  "vernier_calliper", "screw_gauge", "spring_mass", "shm_energy", "simple_pendulum",
  "standing_wave", "shm_superposition", "wave_profile", "wave_types", "resistor_network",
  "two_loop_network", "wheatstone_bridge", "meter_bridge", "potentiometer", "straight_wire_field",
  "parallel_wires", "bar_magnet",
] as const;
const physicsContext: DiagramStrategyContext & { assignedStrategy: "current" } = {
  assignedStrategy: "current", subject: "physics", chemistryLane: false,
  codeLesson: false, dsa: false, doubt: false,
};
function assertPolicy(decision: DiagramStrategyDecision, expected: {
  strategy: "current" | "strict";
  reason: DiagramStrategyDecision["strategyReason"];
  signal?: string | null;
  policy?: string | null;
}, name: string): void {
  assert.deepEqual({
    strategy: decision.strategy, selectionOrder: decision.selectionOrder,
    usePickedExamples: decision.usePickedExamples, strategyReason: decision.strategyReason,
    hybridSignal: decision.hybridSignal, policyVersion: decision.policyVersion,
  }, {
    strategy: expected.strategy, selectionOrder: expected.strategy === "strict" ? "planner_first" : "current",
    usePickedExamples: expected.strategy === "strict", strategyReason: expected.reason,
    hybridSignal: expected.signal ?? null, policyVersion: expected.policy ?? null,
  }, name);
}

assert.equal(PHYSICS_HYBRID_POLICY_VERSION, POLICY, "held-out measurement must identify the frozen policy");
for (const raw of [undefined, null, "", "current", "strict", "HYBRID", "Hybrid", " hybrid", "hybrid ",
  "hybrid,strict", 1, true, [], ["hybrid"], { mode: "hybrid" }, new String("hybrid")]) {
  assert.equal(parsePhysicsDiagramMode(raw), null, "unknown values/types cannot enable a default-off live switch");
}
assert.equal(resolvePhysicsDiagramMode("hybrid"), "hybrid");
assert.equal(resolvePhysicsDiagramMode(""), null);
assert.equal(resolvePhysicsDiagramMode("HYBRID"), null);
const previousPhysicsMode = process.env.DIAGRAM_PHYSICS_MODE;
try {
  Reflect.deleteProperty(process.env, "DIAGRAM_PHYSICS_MODE");
  assert.equal(resolvePhysicsDiagramMode(), null, "server setting defaults off when absent");
  process.env.DIAGRAM_PHYSICS_MODE = "hybrid";
  assert.equal(resolvePhysicsDiagramMode(), "hybrid", "the server reads its configured opt-in");
  assert.equal(resolvePhysicsDiagramMode(""), null, "an explicit raw value cannot inherit the environment's opt-in");
  process.env.DIAGRAM_PHYSICS_MODE = "unknown";
  assert.equal(resolvePhysicsDiagramMode(), null);
} finally {
  if (previousPhysicsMode === undefined) Reflect.deleteProperty(process.env, "DIAGRAM_PHYSICS_MODE");
  else process.env.DIAGRAM_PHYSICS_MODE = previousPhysicsMode;
}

for (const mode of [undefined, null] as const) {
  assertPolicy(decideDiagramStrategy({ ...physicsContext, physicsMode: mode,
    sceneSignal: { families: ["ray_path"], archetypeId: "bar_magnet" } }),
  { strategy: "current", reason: "current" }, "disabled hybrid preserves current even when an approved signal exists");
}
for (const subject of [undefined, "maths", "chemistry", "other"] as const) {
  assertPolicy(decideDiagramStrategy({ ...physicsContext, subject, physicsMode: "hybrid" }),
    { strategy: "current", reason: "current" }, "hybrid cannot change an unclassified or nonphysics turn");
}
// Malformed runtime input is a boundary adversary, not an extra supported subject.
for (const subject of [null, "Physics", "biology", 1, true, {}, ["physics"]]) {
  const malformed = { ...physicsContext, subject, physicsMode: "hybrid" } as unknown as
    Parameters<typeof decideDiagramStrategy>[0];
  assertPolicy(decideDiagramStrategy(malformed), { strategy: "current", reason: "current" },
    "unknown subject values/types cannot be interpreted as classified physics");
}
for (const subject of ["maths", "physics", "chemistry", "other"] as const) {
  assertPolicy(decideDiagramStrategy({ ...physicsContext, subject, assignedStrategy: "strict", physicsMode: "hybrid" }),
    { strategy: "strict", reason: "strict_assignment", policy: subject === "physics" ? POLICY : null },
    "explicit strict assignment retains its existing meaning for every subject");
}
for (const exempt of ["chemistryLane", "codeLesson", "dsa", "doubt"] as const) {
  assertPolicy(decideDiagramStrategy({ ...physicsContext, physicsMode: "hybrid", assignedStrategy: "strict",
    strictSubjects: ["physics"], sceneSignal: { families: ["ray_path"], archetypeId: "bar_magnet" }, [exempt]: true }),
  { strategy: "current", reason: "turn_exempt", policy: POLICY },
  "existing turn exemptions precede both strict overrides and hybrid routing");
}
assertPolicy(decideDiagramStrategy({ ...physicsContext, physicsMode: "hybrid", strictSubjects: ["physics"],
  sceneSignal: { families: ["ray_path"], archetypeId: "bar_magnet" } }),
{ strategy: "strict", reason: "strict_subject", policy: POLICY }, "physics subject strict overrides the hybrid current signal");
assertPolicy(decideDiagramStrategy({ ...physicsContext, subject: "maths", physicsMode: "hybrid", strictSubjects: ["maths"] }),
  { strategy: "strict", reason: "strict_subject" }, "maths strict is unchanged and does not claim a physics policy");
assertPolicy(decideDiagramStrategy({ ...physicsContext, physicsMode: "hybrid", assignedStrategy: "strict",
  strictSubjects: ["physics"] }), { strategy: "strict", reason: "strict_assignment", policy: POLICY },
"assignment precedence remains explicit when both strict controls are active");

for (const family of currentFamilies) {
  assertPolicy(liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
    sceneSignal: { families: ["circuit_network", family], archetypeId: "bar_magnet" } }),
  { strategy: "current", reason: "hybrid_current_signal", signal: `family:${family}`, policy: POLICY },
  "each approved gate family is current and takes precedence over an approved archetype");
}
for (const archetypeId of currentArchetypes) {
  assertPolicy(liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
    sceneSignal: { families: ["circuit_network", "point_field"], archetypeId } }),
  { strategy: "current", reason: "hybrid_current_signal", signal: `archetype:${archetypeId}`, policy: POLICY },
  "only an approved existing gate archetype sharpens generic families into a current branch");
}
for (const families of [[], ["circuit_network"], ["point_field"], ["analytic_curve"], ["contact_body"],
  ["wavefront", "transverse_field", "energy_level"], ["ray_path_extra"], ["RAY_PATH"]]) {
  assertPolicy(liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
    sceneSignal: { families, archetypeId: "unknown" } }),
  { strategy: "strict", reason: "hybrid_strict_default", policy: POLICY },
  "generic or unknown gate families do not silently widen the current allowlist");
}
for (const archetypeId of [null, "unknown", "bar_magnet_extra", "BAR_MAGNET", " bar_magnet", "lens_maker"]) {
  assertPolicy(liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
    sceneSignal: { families: ["point_field"], archetypeId } }),
  { strategy: "strict", reason: "hybrid_strict_default", policy: POLICY },
  "unknown/case/prefix archetypes cannot widen the frozen current set");
}
assertPolicy(liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid" }),
  { strategy: "strict", reason: "hybrid_strict_default", policy: POLICY }, "missing live signal defaults to strict, not an oracle");
assertPolicy(liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
  sceneSignal: { families: ["unknown", "polarizer", "ray_path"], archetypeId: "bar_magnet" } }),
{ strategy: "current", reason: "hybrid_current_signal", signal: "family:polarizer", policy: POLICY },
"the first approved family follows the live gate's existing family order");
const frozenContext = Object.freeze({ ...physicsContext, physicsMode: "hybrid" as const,
  sceneSignal: Object.freeze({ families: Object.freeze(["ray_path"]), archetypeId: "bar_magnet" }) });
const frozenBefore = JSON.stringify(frozenContext);
liveDiagramStrategyDecision(frozenContext);
assert.equal(JSON.stringify(frozenContext), frozenBefore, "policy selection is pure and leaves the live gate input untouched");

const currentBranch = liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
  sceneSignal: { families: ["ray_path"], archetypeId: null } });
const strictBranch = liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
  sceneSignal: { families: ["point_field"], archetypeId: null } });
for (const source of FIGURE_SOURCES) {
  assert.equal(diagramStrategyAllowsFigureSource(currentBranch, source), true,
    "hybrid current retains current source admission rather than inventing a new geometry lane");
  assert.equal(diagramStrategyAllowsFigureSource(strictBranch, source),
    ["planner", "verified_recovery", "text_only"].includes(source),
    "hybrid strict retains the same strict source boundary");
}
function publicPlan(question: string): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [],
    derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
}
for (const fixture of [
  { question: "Draw a convex lens with an object on its principal axis.", strategy: "current", signal: "family" },
  { question: "Draw a simple pendulum: a bob suspended by a string from a pivot.", strategy: "current", signal: "archetype:simple_pendulum" },
  { question: "Show two long parallel current-carrying wires.", strategy: "current", signal: "archetype:parallel_wires" },
  { question: "Show the electric field due to a point charge.", strategy: "strict", signal: null },
  { question: "Draw a free-body diagram of a block on a rough incline.", strategy: "strict", signal: null },
] as const) {
  const turnPlan = publicPlan(fixture.question);
  const before = JSON.stringify(turnPlan);
  const gate = deriveSceneGate({ question: fixture.question, turnPlan, problemIR: null });
  const decision = liveDiagramStrategyDecision({ ...physicsContext, physicsMode: "hybrid",
    chemistryLane: gate.chemistryLane, sceneSignal: { families: gate.families, archetypeId: gate.archetypeId } });
  assert.equal(decision.strategy, fixture.strategy, "real shared gate signals—not test chapter labels—select the policy");
  assert.equal(decision.policyVersion, POLICY);
  if (fixture.signal === "family") {
    assert(["family:ray_path", "family:axis_view", "family:interface"].includes(decision.hybridSignal!),
      "the optics fixture must carry an actual approved family signal");
  } else assert.equal(decision.hybridSignal, fixture.signal);
  assert.equal(JSON.stringify(turnPlan), before, "real scene-gate admission does not mutate the plan");
}

const circuitQuestion = "A 12 V battery is connected across a 4 Ω resistor. Find the current.";
const circuitPlan: TurnPlanV3 = { ...publicPlan(circuitQuestion), givens: [
  { id: "V", symbol: "V", value: 12, unit: "V", provenance: "given", sourceText: "12 V" },
  { id: "R", symbol: "R", value: 4, unit: "Ω", provenance: "given", sourceText: "4 Ω" },
] };
const circuit = selectProductionScene({ question: circuitQuestion, turnPlan: circuitPlan, problemIR: null });
assert(circuit.representation, "the existing source-grounded circuit fixture must still be drawable");
for (const decision of [currentBranch, strictBranch]) {
  const policy = { preferPlanner: decision.strategy === "strict",
    allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) };
  const selected = selectProductionScene({ question: circuitQuestion, turnPlan: circuitPlan, problemIR: null,
    fastRepresentation: circuit.representation, policy });
  assert.equal(selected.representation !== null, decision.strategy === "current",
    "the real final selection uses unchanged current/strict source admission");
  const blocked = selectProductionScene({ question: circuitQuestion, turnPlan: circuitPlan, problemIR: null,
    fastRepresentation: circuit.representation, policy, solverAuthorityBlocked: true });
  assert.equal(blocked.representation, null, "neither hybrid branch bypasses contradictory solver authority");
  assert.equal(blocked.reason, "solver_contradiction");
}

const appRoot = resolve(import.meta.dirname, "../..");
const hookSource = readFileSync(resolve(appRoot, "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
const deriveStart = hookSource.indexOf("const deriveSceneGate =");
const deriveEnd = hookSource.indexOf("const applyDeterministicSourceAuthority =", deriveStart);
assert(deriveStart >= 0 && deriveEnd > deriveStart, "repoint the existing live scene-gate boundary if it moves");
const liveGateConsumer = hookSource.slice(deriveStart, deriveEnd);
assert(liveGateConsumer.includes("deriveProductionSceneGate({"), "live keeps the shared scene admission seam");
assert.match(liveGateConsumer, /physicsMode:\s*billed\.diagramPhysicsMode/,
  "live strategy receives the server-parsed rollout setting");
assert.match(liveGateConsumer, /sceneSignal:\s*\{\s*families:\s*gate\.families,\s*archetypeId:\s*gate\.archetypeId\s*\}/,
  "live hybrid uses only the already-derived gate families/archetype, not chapter or question routing");
const beginSource = readFileSync(resolve(appRoot, "app/api/billing/begin-turn/route.ts"), "utf8");
assert.match(beginSource, /diagramPhysicsMode:\s*resolvePhysicsDiagramMode\(\)/,
  "the begin-turn response communicates the server-owned opt-in to the live client");

async function verifyBillingModeBoundary(): Promise<void> {
  // The persisted source identity is enforced at the real server boundary,
  // independently of which existing representation policy selected the figure.
  for (const decision of [currentBranch, strictBranch]) {
    const selected = circuit.representation!;
    const rejected = await canonicalizeTurnSceneMetadata({
      question: circuitQuestion, visualStatus: "validated", segments: [],
      sceneDocument: { ...selected.sceneDocument, source: { question: "A different public source fixture." } },
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: circuitPlan, candidates: [],
        selectedCandidateId: null, representationTier: selected.tier, nonMetric: selected.nonMetric,
        figureSource: "planner", diagramStrategy: decision.strategy, diagramResultStatus: "ready" },
    });
    assert.equal(rejected.ok, false, "neither hybrid strategy marker bypasses persisted source admission");
    if (!rejected.ok) assert.equal(rejected.code, "scene_source_question_mismatch");
  }
  const nativeFetch = globalThis.fetch;
  try {
    for (const raw of [undefined, null, "hybrid", "HYBRID", "strict", 1, true, ["hybrid"], { mode: "hybrid" }]) {
      let calls = 0;
      globalThis.fetch = async (input) => {
        calls++;
        assert(String(input).endsWith("/api/billing/begin-turn"), "verification forbids external/provider requests");
        return Response.json({ diagramStrategy: "current", diagramStrictSubjects: ["maths"], diagramPhysicsMode: raw,
          remainingPct: 100, planId: "synthetic", ttsCharsRemaining: 1 });
      };
      const billed = await beginTurn({ traceId: "synthetic-physics-hybrid", kind: "lesson", ownsTurn: () => false });
      assert(billed.ok, "the real live begin-turn client accepts the synthetic external HTTP response");
      assert.equal(calls, 1);
      assert.equal(billed.diagramPhysicsMode, raw === "hybrid" ? "hybrid" : null,
        "untrusted HTTP values cannot broaden the rollout setting before the live policy runs");
      assert.deepEqual(billed.diagramStrictSubjects, ["maths"], "the maths strict production setting survives unchanged");
    }
  } finally { globalThis.fetch = nativeFetch; }
}
void verifyBillingModeBoundary().then(() => {
  console.log("live physics hybrid: exact opt-in/default-off, frozen signals, precedence/exemptions, real shared gate, source/solver admission and billing/live wiring pass (zero model calls)");
}).catch((error) => { console.error(error); process.exitCode = 1; });
