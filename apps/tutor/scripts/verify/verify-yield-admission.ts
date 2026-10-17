import assert from "node:assert/strict";
import {
  compileSceneDocument,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  validateProductionSceneCandidate,
  selectProductionScene,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";

const question = "Show a body moving with velocity (3,4) m/s.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question,
  visualRequirement: "required",
  givens: [],
  unknowns: [],
  derived: [
    {
      id: "speed",
      symbol: "v",
      value: 5,
      unit: "m/s",
      provenance: "derived",
      dependsOn: [],
    },
  ],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
};
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  source: { question },
  visualDecision: { mode: "scene", reason: "motion" },
  quantities: [],
  entities: [
    { id: "path", kind: "curve", role: "trajectory", label: "path" },
    { id: "v", kind: "vector", role: "velocity", label: "unknown=5 m/s" },
  ],
  constructions: [
    {
      id: "motion",
      operator: "constant_acceleration_trajectory",
      inputs: {
        initialPosition: [0, 0],
        initialVelocity: [3, 4],
        acceleration: [0, 0],
        tMin: 0,
        tMax: 2,
        samples: 5,
        units: { length: "m", time: "s" },
      },
      outputs: ["path"],
    },
    {
      id: "velocity",
      operator: "trajectory_state",
      inputs: { trajectory: "path", time: 1, kind: "velocity", timeScale: 0.3 },
      outputs: ["v"],
    },
  ],
  requiredEntityIds: ["path", "v"],
  relations: [],
  assertions: [],
  annotations: [],
  revealGroups: [
    {
      id: "setup",
      entityIds: ["path", "v"],
      dependsOn: [],
      narrationCue: "Here is the setup.",
    },
  ],
  teachingTimeline: [],
};
const input = { candidate: { ...document }, question, turnPlan: plan };
assert.equal(validateProductionSceneCandidate(input).valid, false);
const recovered = validateProductionSceneCandidate({
  ...input,
  yieldPolicy: "verified_parts",
});
assert(recovered.valid && recovered.value, JSON.stringify(recovered.errors));
assert.deepEqual(
  recovered.value.report,
  compileSceneDocument(recovered.value.document).report,
  "ledger does not alter compiler report/save parity",
);
assert(recovered.value.document.source.yieldDemotions);
const selected = selectProductionScene({
  question,
  turnPlan: plan,
  problemIR: null,
  candidateValidation: recovered,
  policy: {
    allowedFigureSources: ["planner", "verified_recovery"],
    preferPlanner: true,
  },
});
assert(
  selected.representation,
  JSON.stringify({
    reason: selected.reason,
    saveFailure: selected.saveFailure,
  }),
);
assert.equal(
  selectProductionScene({
    question,
    turnPlan: plan,
    problemIR: null,
    candidateValidation: recovered,
    solverAuthorityBlocked: true,
  }).representation,
  null,
  "solver contradiction remains authoritative",
);
const falseValue = structuredClone(document);
falseValue.entities[1]!.label = "v=6 m/s";
assert.equal(
  validateProductionSceneCandidate({
    ...input,
    candidate: { ...falseValue },
    turnPlan: { ...plan, derived: [{ ...plan.derived[0]!, value: 6 }] },
    yieldPolicy: "verified_parts",
  }).valid,
  false,
);
const changedQuestion = "Show a body moving with velocity (8,4) m/s.";
const wrongSource = selectProductionScene({
  question: changedQuestion,
  turnPlan: { ...plan, question: changedQuestion },
  problemIR: null,
  candidateValidation: recovered,
});
assert.equal(
  wrongSource.representation,
  null,
  "recovered candidates keep source binding",
);
console.log(
  "yield admission: proof recovery survives strict save parity; truth, source and solver guards retained",
);
