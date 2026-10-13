/** Independent app-boundary controls; all questions and geometry are authored fixtures. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateProblemIR, type ProblemIR, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { inferSceneCapabilities, questionRequiresVisual, type ScenePlanWithRepairResult } from "@heytutor/tutor-core";
import {
  applyVisualDecisionToPlan,
  resolveVisualRequirement,
} from "../../features/tutor-session/lib/scene/visualRequirement";
import {
  deriveSceneGate,
  selectProductionScene,
  validateProductionSceneCandidate,
  type ProductionSceneGate,
  type ValidatedSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { runScenePlanningOverlap } from "../../features/tutor-session/lib/scene/planningOverlap";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
const planFor = (question: string, visualRequirement: TurnPlanV3["visualRequirement"]): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement,
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
});
const chemistryQuestions = [
  "On heating, 15 g of calcium carbonate decomposes completely into calcium oxide and carbon dioxide. Calculate the mass of carbon dioxide produced. The molar masses of calcium carbonate and carbon dioxide are 100 g/mol and 44 g/mol.",
  "Calculate the mass of carbon dioxide released when 15 g of calcium carbonate decomposes into calcium oxide and carbon dioxide. Use molar mass values of 100 g/mol for calcium carbonate and 44 g/mol for carbon dioxide.",
];
const relativeMassQuestion = "Calcium carbonate decomposes into calcium oxide and carbon dioxide. Find the mass of carbon dioxide released from 15 g of calcium carbonate. The relative formula masses are 100 for calcium carbonate and 44 for carbon dioxide.";
function scalarPlan(question: string, requirement: TurnPlanV3["visualRequirement"]): TurnPlanV3 {
  return freezeDeep({ ...planFor(question, requirement),
    givens: [{ id: "mass", symbol: "m", value: 15, unit: "g", provenance: "given", sourceText: "15 g" }],
    unknowns: [{ id: "gas_mass", symbol: "m_CO2", unit: "g" }],
    derived: [{ id: "gas_mass", symbol: "m_CO2", value: 6.6, unit: "g", provenance: "derived", sourceText: "m_CO2 = 15 * 44 / 100 = 6.6 g" }],
  });
}

// No draw/graph/plot/parabola request: source-backed typed structure supplies
// only permission for an optional attempt, not scene validity or new numbers.
const curveQuestion = "For t in [0, 3], the trajectory q(t)=t^2 passes through O=(0,0). Describe how q changes.";
const curvePlan = freezeDeep(planFor(curveQuestion, "none"));
const curveProblemIR: ProblemIR = freezeDeep({
  schemaVersion: "problem-ir/v1", id: "trajectory", question: curveQuestion,
  facts: [
    { id: "function", kind: "given", statement: "q(t)=t^2", evidence: { source: "question", start: 0, end: 8, quote: "q(t)=t^2" } },
    { id: "origin", kind: "given", statement: "O=(0,0)", evidence: { source: "question", start: 0, end: 7, quote: "O=(0,0)" } },
    { id: "incidence", kind: "given", statement: "passes through", evidence: { source: "question", start: 0, end: 14, quote: "passes through" } },
  ],
  entities: [
    { id: "path", kind: "curve", evidenceFactIds: ["function"] },
    { id: "anchor", kind: "point", evidenceFactIds: ["origin"] },
  ],
  expressions: [{ id: "trajectory_function", valueType: "function", root: { kind: "binary", operator: "^", left: { kind: "variable", name: "t" }, right: { kind: "number", value: 2 } }, evidenceFactIds: ["function"] }],
  constraints: [{ id: "origin_on_path", kind: "incident", entityIds: ["path", "anchor"], evidenceFactIds: ["incidence"] }],
  representationIntents: [{ id: "trajectory_view", kind: "graph", entityIds: ["path", "anchor"], evidenceFactIds: ["function", "origin", "incidence"] }],
  solveRequests: [],
});
const curveDocument: SceneDocument = freezeDeep({
  schemaVersion: "scene-document/v2", source: { question: curveQuestion },
  visualDecision: { mode: "scene", reason: "The stated trajectory through O." }, quantities: [],
  entities: [{ id: "axes", kind: "axes", role: "coordinate axes" },
    { id: "path", kind: "polyline", role: "stated trajectory", label: "q(t)=t²" },
    { id: "anchor", kind: "point", role: "stated origin", label: "O" }],
  constructions: [
    { id: "make_axes", operator: "axes", inputs: { xMin: 0, xMax: 3, yMin: 0, yMax: 9 }, outputs: ["axes"] },
    { id: "make_path", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 3, samples: 33 }, outputs: ["path"] },
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["anchor"] },
  ],
  relations: [],
  assertions: [{ id: "origin_value", predicate: "function_value", entities: ["path"], expected: { x: 0, y: 0 }, severity: "fatal" }],
  annotations: [], requiredEntityIds: ["axes", "path", "anchor"],
  revealGroups: [{ id: "setup", entityIds: ["axes", "path", "anchor"], dependsOn: [], narrationCue: "The stated trajectory through O." }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Describe q." }],
});

const failures: string[] = [];
let checks = 0;
function check(name: string, run: () => void): void {
  checks++;
  try { run(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
async function scenario(name: string, run: () => Promise<void>): Promise<void> {
  checks++;
  try { await run(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main(): Promise<void> {
  for (const question of chemistryQuestions) {
    const plan = scalarPlan(question, "none");
    const original = JSON.stringify(plan);
    check("authored scalar fixture exposes legacy family minimum", () => {
      assert.equal(questionRequiresVisual(question, { visualDecisionEnabled: false }), true);
      assert(inferSceneCapabilities(question).families.includes("chem_solutions"));
    });
    check("off authority helper retains exact identity and every field", () => {
      const result = applyVisualDecisionToPlan({ question, turnPlan: plan, evaluated: "required", problemIR: curveProblemIR, visualDecisionEnabled: false });
      assert.equal(result, plan);
      assert.equal(JSON.stringify(result), original);
    });
    check("off merger retains the complete legacy scalar-required plan and request", () => {
      const gate = deriveSceneGate({ question, turnPlan: plan, problemIR: null, visualNeedDecision: null, visualDecisionEnabled: false });
      const expected = { ...plan, visualRequirement: "required" };
      assert.deepEqual(gate.turnPlan, expected);
      assert.equal(gate.request.conversationContext, `AUTHORITATIVE TURN PLAN V3\n${JSON.stringify(expected)}\nDo not contradict, replace, or independently recalculate these quantities and claims.`);
      assert.equal(JSON.stringify(plan), original);
    });
    check("enabled scalar none is not promoted by family ownership", () => {
      assert.equal(questionRequiresVisual(question, { visualDecisionEnabled: true }), false);
      const gate = deriveSceneGate({ question, turnPlan: plan, problemIR: null, visualNeedDecision: null, visualDecisionEnabled: true });
      assert.deepEqual(gate.turnPlan, plan);
      assert.equal(gate.shouldPlanExactScene, false);
      assert.equal(gate.shouldAttemptLlmScene, false);
      const selected = selectProductionScene({ question, turnPlan: plan, problemIR: null, visualNeedDecision: null, visualDecisionEnabled: true });
      assert.equal(selected.representation, null);
      assert.equal(selected.attemptedRepresentation, null);
      assert.equal(selected.reason, "the question asks for no figure");
      assert.equal(selected.visualStatus, "text_only");
    });
    for (const requirement of ["none", "optional", "required"] as const) {
      check(`enabled scalar ${requirement} retains full numeric authority`, () => {
        const authored = scalarPlan(question, requirement);
        const applied = applyVisualDecisionToPlan({ question, turnPlan: authored, evaluated: null, problemIR: null, visualDecisionEnabled: true });
        assert.equal(applied, authored);
        const gate = deriveSceneGate({ question, turnPlan: authored, problemIR: null, visualNeedDecision: null, visualDecisionEnabled: true });
        assert.deepEqual(gate.turnPlan, authored);
      });
    }
  }

  check("explicit required and model-required are not lost to Jev none", () => {
    for (const [question, requirement] of [["Draw the labelled trajectory through O.", "none"], [curveQuestion, "required"]] as const) {
      const plan = planFor(question, requirement);
      const gate = deriveSceneGate({ question, turnPlan: plan, problemIR: null, visualNeedDecision: "none", visualDecisionEnabled: true });
      assert.equal(gate.turnPlan.visualRequirement, "required");
    }
  });
  check("saved required with old enforcement provenance cannot be demoted", () => {
    const question = chemistryQuestions[0]!;
    const plan = { ...scalarPlan(question, "required"), assumptions: ["A verified illustration is required by the question's spatial or explicit visual request."] };
    assert.equal(applyVisualDecisionToPlan({ question, turnPlan: plan, evaluated: "none", problemIR: null, visualDecisionEnabled: true }), plan);
  });
  check("legacy merger table is unchanged when injected off", () => {
    for (const planned of ["none", "optional", "required"] as const) for (const evaluated of [null, "none", "optional", "required"] as const) {
      const expected = planned === "required" || evaluated === "required" ? "required" : evaluated ?? planned;
      assert.equal(resolveVisualRequirement(planned, evaluated, false, false,
        { question: curveQuestion, turnPlan: planFor(curveQuestion, planned), problemIR: curveProblemIR, visualDecisionEnabled: false }), expected);
    }
  });
  check("relative-formula-mass wording preserves its already-unforced legacy behavior", () => {
    for (const enabled of [false, true]) {
      assert.equal(questionRequiresVisual(relativeMassQuestion, { visualDecisionEnabled: enabled }), false);
      for (const requirement of ["none", "optional", "required"] as const) {
        const plan = scalarPlan(relativeMassQuestion, requirement);
        const gate = deriveSceneGate({ question: relativeMassQuestion, turnPlan: plan, problemIR: null,
          visualNeedDecision: null, visualDecisionEnabled: enabled });
        assert.deepEqual(gate.turnPlan, plan);
      }
      const selected = selectProductionScene({ question: relativeMassQuestion, turnPlan: scalarPlan(relativeMassQuestion, "none"),
        problemIR: null, visualNeedDecision: null, visualDecisionEnabled: enabled });
      assert.equal(selected.representation, null);
      assert.equal(selected.attemptedRepresentation, null);
      assert.equal(selected.visualStatus, "text_only");
    }
  });
  check("full typed IR fixture is valid and may only reopen to optional", () => {
    assert.equal(validateProblemIR(curveProblemIR, curveQuestion).valid, true);
    const effective = applyVisualDecisionToPlan({ question: curveQuestion, turnPlan: curvePlan, evaluated: null, problemIR: curveProblemIR, visualDecisionEnabled: true });
    assert.equal(effective.visualRequirement, "optional");
    assert.deepEqual({ ...effective, visualRequirement: "none" }, curvePlan);
    assert.equal(curvePlan.visualRequirement, "none");
    assert.equal(applyVisualDecisionToPlan({ question: curveQuestion, turnPlan: curvePlan, evaluated: "none", problemIR: curveProblemIR, visualDecisionEnabled: true }), curvePlan);
  });

  const effectivePlan = applyVisualDecisionToPlan({ question: curveQuestion, turnPlan: curvePlan, evaluated: null, problemIR: curveProblemIR, visualDecisionEnabled: true });
  const validation = validateProductionSceneCandidate({ candidate: structuredClone(curveDocument) as unknown as Record<string, unknown>, question: curveQuestion, turnPlan: effectivePlan });
  const admitted = selectProductionScene({ question: curveQuestion, turnPlan: effectivePlan, problemIR: curveProblemIR,
    candidateValidation: validation, visualDecisionEnabled: true, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
  check("optional permission still requires real validation, compile and save admission", () => {
    assert(validation.valid && validation.value, JSON.stringify(validation.errors));
    assert(admitted.representation, admitted.reason);
    assert.equal(admitted.representation.figureSource, "planner");
    assert.equal(admitted.saveFailure, null);
    assert.equal(liveSceneSaveFailure({ document: admitted.representation.sceneDocument, question: curveQuestion, turnPlan: effectivePlan, tier: admitted.representation.tier }), null);
    assert.equal(sceneSaveAdmissionFailure({ document: admitted.representation.sceneDocument, question: curveQuestion, turnPlan: effectivePlan, tier: admitted.representation.tier }), null);
  });

  await scenario("actual overlap returns the promoted authority to fast, validator and save boundaries", async () => {
    const seen: TurnPlanV3[] = [];
    let plannerRuns = 0;
    let sleepCalls = 0;
    const authority = { problemIR: curveProblemIR };
    const outcome = await runScenePlanningOverlap<typeof authority, ProductionSceneGate, never, ScenePlanWithRepairResult<ValidatedSceneCandidate>>({
      turnPlan: curvePlan, problemAuthority: Promise.resolve(authority), speculationAllowed: false, speculationEnabled: false,
      plannerStartedAt: 100, deadlineMs: 1_000, now: () => 100,
      sleep: async () => { sleepCalls++; },
      deriveGate: (turnPlan, answered) => deriveSceneGate({ question: curveQuestion, turnPlan, problemIR: answered?.problemIR ?? null, visualDecisionEnabled: true }),
      applyAuthority: (turnPlan, answered) => ({
        turnPlan: applyVisualDecisionToPlan({ question: curveQuestion, turnPlan, evaluated: null, problemIR: answered.problemIR, visualDecisionEnabled: true }), authority: answered,
      }),
      fastFigureBlocked: () => false,
      selectFast: (turnPlan) => { seen.push(turnPlan); return null; },
      planScene: async (_gate, turnPlan) => {
        plannerRuns++;
        seen.push(turnPlan);
        const candidate = structuredClone(curveDocument) as unknown as Record<string, unknown>;
        const checked = validateProductionSceneCandidate({ candidate, question: curveQuestion, turnPlan });
        const response = { document: candidate, rawContent: JSON.stringify(candidate), phase: "plan" as const, lane: "primary" as const, elapsedMs: 0 };
        return { response, validation: checked, repaired: false, candidates: [{ candidateId: "authored", response, validation: checked, selected: true, score: 0 }] };
      },
      revalidate: async (result, turnPlan) => { seen.push(turnPlan); return result; },
    });
    assert.equal(outcome.turnPlan.visualRequirement, "optional");
    assert.equal(outcome.gate.turnPlan, outcome.turnPlan);
    assert(seen.length >= 2 && seen.every((plan) => plan === outcome.turnPlan));
    assert.equal(plannerRuns, 1);
    assert.equal(sleepCalls, 0, "the decision itself adds no timer or grace period");
    assert.equal(outcome.authority, authority);
    assert.deepEqual({ ...outcome.turnPlan, visualRequirement: "none" }, curvePlan);
    assert(outcome.scene?.validation.valid, "the real validator must see promoted authority");
    const selected = selectProductionScene({ question: curveQuestion, turnPlan: outcome.turnPlan, problemIR: curveProblemIR,
      candidateValidation: outcome.scene.validation, visualDecisionEnabled: true, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert(selected.representation, selected.reason);
    const persisted = structuredClone({ turnPlan: outcome.turnPlan, document: selected.representation.sceneDocument });
    assert.equal(persisted.turnPlan.visualRequirement, "optional");
    assert.equal(sceneSaveAdmissionFailure({ document: persisted.document, question: curveQuestion, turnPlan: persisted.turnPlan, tier: selected.representation.tier }), null);
  });

  check("solver contradiction and strict source policy cannot be bypassed by promotion", () => {
    const shared = { question: curveQuestion, turnPlan: effectivePlan, problemIR: curveProblemIR, candidateValidation: validation, visualDecisionEnabled: true };
    const blocked = selectProductionScene({ ...shared, solverAuthorityBlocked: true });
    assert.equal(blocked.representation, null);
    assert.equal(blocked.reason, "solver_contradiction");
    const strict = selectProductionScene({ ...shared, policy: { preferPlanner: true, allowedFigureSources: ["text_only"] } });
    assert.equal(strict.representation, null);
    assert.equal(strict.sourceAllowed, false);
    assert.equal(strict.saveFailure, null);
  });
  check("failed metric proof still rejects the candidate", () => {
    const failed = structuredClone(curveDocument);
    failed.assertions[0]!.expected = { x: 0, y: 1 };
    const checked = validateProductionSceneCandidate({ candidate: failed as unknown as Record<string, unknown>, question: curveQuestion, turnPlan: effectivePlan });
    assert.equal(checked.valid, false);
    assert(checked.errors.some((issue) => issue.severity === "fatal"));
    const rejected = selectProductionScene({ question: curveQuestion, turnPlan: effectivePlan, problemIR: curveProblemIR,
      candidateValidation: checked, visualDecisionEnabled: true, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
    assert.equal(rejected.representation, null, "an optional decision cannot admit a failed planner proof");
  });
  check("save rejects invented physical quantities after optional promotion", () => {
    const stale = structuredClone(curveDocument);
    stale.quantities = [{ id: "invented", symbol: "h", value: 9, unit: "m", provenance: "given", sourceText: "9 m" }];
    assert.notEqual(sceneSaveAdmissionFailure({ document: stale, question: curveQuestion, turnPlan: effectivePlan, tier: "exact_verified" }), null);
  });
  check("none guard and exception guard share enabled minimum, while off keeps legacy failure", () => {
    assert(admitted.representation);
    let reads = 0;
    const throwing = { ...admitted.representation, renderScene: { ...admitted.representation.renderScene,
      get primitives(): never { reads++; throw new Error("authored fallback exception"); },
    } };
    for (const question of chemistryQuestions) {
      const none = selectProductionScene({ question, turnPlan: scalarPlan(question, "none"), problemIR: null, visualDecisionEnabled: true, fastRepresentation: throwing });
      assert.equal(none.visualStatus, "text_only");
      assert.equal(reads, 0, "effective none must not invoke fallback ink at all");
      const optional = scalarPlan(question, "optional");
      const on = selectProductionScene({ question, turnPlan: optional, problemIR: null, visualDecisionEnabled: true, fastRepresentation: throwing });
      assert.equal(on.reason, "authored fallback exception");
      assert.equal(on.visualStatus, "text_only");
      const off = selectProductionScene({ question, turnPlan: optional, problemIR: null, visualDecisionEnabled: false, fastRepresentation: throwing });
      assert.equal(off.reason, "authored fallback exception");
      assert.equal(off.visualStatus, "retry_required");
      assert.equal(selectProductionScene({ question, turnPlan: scalarPlan(question, "required"), problemIR: null,
        visualDecisionEnabled: true, fastRepresentation: throwing }).visualStatus, "retry_required");
      reads = 0;
    }
  });
  check("both actual consumers apply final IR decision before returning authority", () => {
    for (const consumer of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
      const source = readFileSync(resolve(process.cwd(), consumer), "utf8");
      const callback = source.slice(source.indexOf("applyAuthority:"), source.indexOf("fastFigureBlocked:", source.indexOf("applyAuthority:")));
      assert(callback.includes("applyVisualDecisionToPlan({"), `${consumer}: final IR decision must not be gate-only`);
      assert(callback.includes("problemIR: authority.problemIR"));
      assert(callback.includes("turnPlan: reconciledPlan"));
      assert(source.includes("turnPlan = planning.turnPlan;"));
    }
  });
  for (const failure of failures) console.error(failure);
  console.log(`Visual-decision admission ${failures.length ? "RED" : "GREEN"}: ${failures.length} failures, ${checks} controls; no service calls or timing waits.`);
  if (failures.length) process.exitCode = 1;
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
