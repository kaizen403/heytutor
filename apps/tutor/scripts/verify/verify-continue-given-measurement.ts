import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileSceneDocument, validateSceneDocument, validateTurnPlanV3, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { scenario, type FrozenStartupFixture } from "./verify-startup-turn";

const question = "A rod has length L = 5 m. Find the equal length R.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [{ id: "L", symbol: "L", value: 5, unit: "m", provenance: "given", sourceText: "L = 5 m" }],
  unknowns: [{ id: "R", symbol: "R", unit: "m" }],
  derived: [{ id: "R", symbol: "R", value: 5, unit: "m", provenance: "derived", sourceText: "R = L = 5 m", dependsOn: ["L"] }],
  qualitativeClaims: [], assumptions: [], lawIds: [],
};
assert(validateTurnPlanV3(plan, question).plan);
const document: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "rod with given and derived equal measurements" },
  quantities: [],
  entities: [
    { id: "a", kind: "point", role: "endpoint" }, { id: "b", kind: "point", role: "endpoint" },
    { id: "c", kind: "point", role: "endpoint" }, { id: "d", kind: "point", role: "endpoint" },
    { id: "rod", kind: "segment", role: "rod" },
    { id: "given", kind: "dimension", role: "given length", label: "L = 5 m" },
    { id: "result", kind: "dimension", role: "equal length", label: "R = 5 m" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 5, y: 0, coordinateSpace: "world" }, outputs: ["b"] },
    { id: "make_c", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "world" }, outputs: ["c"] },
    { id: "make_d", operator: "point", inputs: { x: 5, y: 2, coordinateSpace: "world" }, outputs: ["d"] },
    { id: "make_rod", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["rod"] },
    { id: "make_given", operator: "dimension", inputs: { start: "a", end: "b", offset: 35 }, outputs: ["given"] },
    { id: "make_result", operator: "dimension", inputs: { start: "c", end: "d" }, outputs: ["result"] },
  ],
  relations: [], assertions: [], annotations: [],
  requiredEntityIds: ["rod", "given", "result"],
  revealGroups: [{ id: "setup", entityIds: ["a", "b", "c", "d", "rod", "given", "result"], dependsOn: [], narrationCue: "Show the rod and its measurements." }],
  teachingTimeline: [],
};
const validated = validateSceneDocument(document);
assert(validated.document, JSON.stringify(validated.report));
const compiled = compileSceneDocument(validated.document);
assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report));
const representation: NonNullable<FrozenStartupFixture["stopBeforeFigure"]>["representation"] = {
  sceneDocument: validated.document, renderScene: compiled.renderScene, validationReport: validated.report,
  tier: "exact_verified", nonMetric: false, figureSource: "planner", reason: "frozen compiled planner fixture",
};
export async function verifyContinueGivenMeasurement() {
  for (const [name, options] of [
    ["uninterrupted", { uninterrupted: true, expectGiven: true }],
    ["Stop→Continue", { expectGiven: true }],
    ["stale saved plan and source question", { expectGiven: false, stalePlan: { ...plan, question: "A different rod has length L = 5 m. Find R." } }],
  ] as const) {
    const result = await scenario("ready", false, false, { plan, stopBeforeFigure: { representation, ...options } });
    console.log("verify-continue-given-measurement:", name, result);
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void verifyContinueGivenMeasurement().catch(error => { console.error(error); process.exitCode = 1; });
}
