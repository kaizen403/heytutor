import assert from "node:assert/strict";
import {
  applySourceQuantityAuthority, compileSceneDocument, readUniformCircularSource,
  synthesizeFamilyScene, validateProblemIR,
  type ProblemIR, type TurnPlanV3, type TurnPlanQuantityV3,
} from "@heytutor/scene-engine";
import { liveSceneSaveFailure } from "@/lib/scene/sceneSaveAdmission";
import { storedTurnSourceIssues } from "@/lib/scene/storedSceneSource";

const quantity = (id: string, value: number, unit: string, provenance: "given" | "derived" = "given"): TurnPlanQuantityV3 => ({ id, symbol: id, value, unit, provenance });
const plan = (question: string, givens: TurnPlanQuantityV3[], derived: TurnPlanQuantityV3[], lawIds: string[]): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, givens, derived, lawIds,
  unknowns: [], assumptions: [], qualitativeClaims: [], visualRequirement: "required",
});
function problem(question: string): ProblemIR {
  const requestStart = question.indexOf("Find");
  const setup = question.slice(0, requestStart < 0 ? question.length : requestStart);
  const entityIds = question.startsWith("Two trains") ? ["A", "B"] : ["particle"];
  const result: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: "sourceTrust", question,
    facts: [{ id: "setup", kind: "given", statement: setup, evidence: { source: "question", start: 0, end: setup.length, quote: setup } },
      ...(requestStart < 0 ? [] : [{ id: "request", kind: "requested" as const, statement: question.slice(requestStart), evidence: { source: "question" as const, start: requestStart, end: question.length, quote: question.slice(requestStart) } }])],
    entities: entityIds.map((id) => ({ id, kind: "body", label: id, evidenceFactIds: ["setup"] })),
    expressions: [], constraints: [], solveRequests: [],
    representationIntents: [{ id: "figure", kind: "conceptual", entityIds, evidenceFactIds: ["setup"] }],
  };
  const validated = validateProblemIR(result, question);
  assert.equal(validated.valid, true, JSON.stringify(validated.issues));
  return result;
}
let checks = 0;
const car = "A car moves on a circular track of radius 50 m at a constant speed of 20 m/s. Find its centripetal acceleration.";
const carPlan = plan(car, [quantity("r", -50, "m"), quantity("v", 20, "m/s")], [quantity("a_c", 10, "m/s^2", "derived")], ["uniform circular motion"]);
const corrected = applySourceQuantityAuthority(carPlan, problem(car), car).plan;
assert.equal(corrected.givens[0]!.value, 50);
assert.equal(corrected.derived[0]!.value, 8); checks += 2;
const carScene = synthesizeFamilyScene({ question: car, turnPlan: corrected, problemIR: problem(car) });
assert.ok(carScene);
assert.equal(liveSceneSaveFailure({ document: carScene.document, question: car, turnPlan: corrected, tier: carScene.tier }), null); checks += 2;

const coordinate = "A particle moves anticlockwise with uniform speed in a circle of radius 2.5 m about the origin with angular speed 2 rad/s. It is at P=(1.5,-2) m. Find its velocity.";
const positionPlan = plan(coordinate, [], [], ["uniform circular motion"]);
const reading = readUniformCircularSource(coordinate);
assert.equal(reading?.status, "numeric");
if (reading?.status !== "numeric") throw new Error("supported source was not read");
assert.ok(Math.abs(reading.phase! - Math.atan2(-2, 1.5)) < 1e-12);
assert.equal(reading.speed, 5); checks += 3;
const position = synthesizeFamilyScene({ question: coordinate, turnPlan: positionPlan, problemIR: problem(coordinate) });
assert.ok(position);
assert.equal(compileSceneDocument(position.document).ok, true);
assert.equal(liveSceneSaveFailure({ document: position.document, question: coordinate, turnPlan: positionPlan, tier: position.tier }), null); checks += 3;
for (const [field, value] of [["angle", Math.PI / 2], ["angularVelocity", -2], ["radius", 50]] as const) {
  const forged = structuredClone(position.document);
  const motion = forged.constructions.find(({ operator }) => operator === "rotational_motion");
  assert.ok(motion);
  motion.inputs[field] = value;
  const compiled = compileSceneDocument(forged);
  assert.equal(compiled.ok, false);
  assert.equal(compiled.renderScene, null);
  assert.ok(liveSceneSaveFailure({ document: forged, question: coordinate, turnPlan: positionPlan, tier: position.tier })); checks += 4;
  delete forged.source.archetype;
  delete forged.source.slotSources;
  const unmarked = compileSceneDocument(forged);
  assert.equal(unmarked.ok, false);
  assert.equal(unmarked.renderScene, null); checks += 2;
}
const foreign = coordinate.replace("(1.5,-2)", "(-1.5,2)");
assert.ok(storedTurnSourceIssues(position.document, { question: foreign, sceneArtifacts: { turnPlan: positionPlan, representationTier: position.tier } }).some(({ severity }) => severity === "fatal")); checks++;
for (const pair of ["(1 1/2,-2)", "(1/0,-2)", "(1.5*pi,-2)"]) {
  const unsupported = coordinate.replace("(1.5,-2)", pair);
  assert.equal(readUniformCircularSource(unsupported)?.status, "reject");
  assert.equal(synthesizeFamilyScene({ question: unsupported, turnPlan: positionPlan, problemIR: problem(unsupported) }), null); checks += 2;
}
// Correctly role-bound positions have the same unit and different values.
const trains = "Two trains A and B move in the same direction with speeds 72 km/h and 54 km/h respectively. Train A is 100 m behind B. Find how long A takes to catch up with B.";
const trainPlan = plan(trains, [quantity("v_A", 72, "km/h"), quantity("v_B", 54, "km/h")], [quantity("v_AB", 5, "m/s", "derived"), quantity("t", 20, "s", "derived"), quantity("x_meet", 400, "m", "derived")], ["relative velocity"]);
const trainScene = synthesizeFamilyScene({ question: trains, turnPlan: trainPlan, problemIR: problem(trains) });
assert.ok(trainScene);
assert.equal(liveSceneSaveFailure({ document: trainScene.document, question: trains, turnPlan: trainPlan, tier: trainScene.tier }), null); checks += 2;
const unmarkedTrain = structuredClone(trainScene.document);
const forgedBodyVelocity = unmarkedTrain.quantities.find(({ id }) => id === "q_v_A");
assert.ok(forgedBodyVelocity);
forgedBodyVelocity.value = 15;
delete unmarkedTrain.source.sourceModel;
delete unmarkedTrain.source.slotSources;
const unmarkedTrainCompile = compileSceneDocument(unmarkedTrain);
assert.equal(unmarkedTrainCompile.ok, false);
assert.equal(unmarkedTrainCompile.renderScene, null);
assert.ok(unmarkedTrainCompile.report.issues.some(({ code }) => code === "relative_motion_source_mismatch"));
assert.ok(liveSceneSaveFailure({ document: unmarkedTrain, question: trains, turnPlan: trainPlan, tier: trainScene.tier }));
assert.ok(storedTurnSourceIssues(unmarkedTrain, { question: trains, sceneArtifacts: { turnPlan: trainPlan, representationTier: trainScene.tier } }).some(({ severity }) => severity === "fatal")); checks += 5;
const staleTrain = structuredClone(trainPlan);
staleTrain.derived.find(({ id }) => id === "t")!.value = 99;
assert.equal(synthesizeFamilyScene({ question: trains, turnPlan: staleTrain, problemIR: problem(trains) }), null); checks++;
assert.equal(synthesizeFamilyScene({ question: "A cell of emf 2 V and internal resistance r is connected to an external resistor R.", families: ["circuit_network"] }), null); checks++;
assert.ok(synthesizeFamilyScene({ question: "A cell of emf E and internal resistance r is connected to an external resistor R.", families: ["circuit_network"] })); checks++;
console.log(`wave-one source trust: ${checks} checks passed`);
