import assert from "node:assert/strict";
import { capacitorCircuit, capacitorPlan, capacitorQuestion, freeCapacitorPlates } from "../../../../packages/scene-engine/scripts/verify/fixtures/capacitor-circuit";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const selection = {
  question: capacitorQuestion, turnPlan: capacitorPlan,
  problemIR: { entities: [{ kind: "component", label: "battery" }, { kind: "component", label: "capacitor" }], representationIntents: [{ kind: "network" }], constraints: [], solveRequests: [] },
  policy: { preferPlanner: true, allowedFigureSources: ["planner"] as const },
  completionEnabled: false, requiredRetryEnabled: false,
};
const canonical = capacitorCircuit();
const positive = selectProductionScene({ ...selection, candidate: { ...canonical } });
assert.equal(validateProductionSceneCandidate({ candidate: { ...canonical }, question: capacitorQuestion, turnPlan: capacitorPlan }).valid, true);
assert.equal(positive.representation?.figureSource, "planner");
assert.ok(positive.sourceAllowed && positive.hasReadableInk);
assert.equal(positive.saveFailure, null);

let negatives = 0;
for (const kind of ["plates", "touching", "perpendicular", "missing_return", "unjoined_port", "zero_span"] as const) {
  const candidate = kind === "plates" || kind === "touching" || kind === "perpendicular" ? freeCapacitorPlates() : capacitorCircuit();
  if (kind === "touching") candidate.constructions.find(({ id }) => id === "make_plate2")!.inputs = { start: [3, 1.2], end: [5, 1.2] };
  if (kind === "perpendicular") candidate.constructions.find(({ id }) => id === "make_plate2")!.inputs = { start: [4, 0.5], end: [4, 1.5] };
  if (kind === "missing_return") {
    candidate.constructions = candidate.constructions.filter(({ id }) => id !== "make_bottom");
    candidate.entities = candidate.entities.filter(({ id }) => id !== "bottom");
    candidate.requiredEntityIds = candidate.requiredEntityIds.filter((id) => id !== "bottom");
    candidate.revealGroups[0]!.entityIds = [...candidate.requiredEntityIds];
  }
  if (kind === "unjoined_port") {
    candidate.entities.push({ id: "C2", kind: "point", role: "node" });
    candidate.constructions.push({ id: "make_C2", operator: "point", inputs: { x: 4, y: 2, coordinateSpace: "world" }, outputs: ["C2"] });
    candidate.requiredEntityIds.push("C2");
    candidate.revealGroups[0]!.entityIds.push("C2");
    candidate.constructions.find(({ id }) => id === "make_top")!.inputs.end = "C2";
  }
  if (kind === "zero_span") candidate.constructions.find(({ id }) => id === "make_capacitor")!.inputs.end = "C";
  const validated = validateProductionSceneCandidate({ candidate: { ...candidate }, question: capacitorQuestion, turnPlan: capacitorPlan });
  assert.equal(validated.valid, false, `${kind}: malformed plates/ports cannot stand in for the atomic symbol`);
  const selected = selectProductionScene({ ...selection, candidate: { ...candidate }, candidateValidation: validated });
  assert.equal(selected.representation?.figureSource ?? null, null, `${kind}: no planner or guessed component fallback`);
  negatives++;
}
console.log(`Capacitor production admission: one closed native loop selected/saveable; ${negatives} malformed cases refused`);
