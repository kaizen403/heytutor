import assert from "node:assert/strict";
import { type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildSceneDocumentPlannerPrompt, compactSceneExampleDocument,
  normalizeSceneDocumentModelOutput, planSceneDocument, repairSceneDocument,
  selectConstructionInputContracts,
} from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

async function main(): Promise<void> {
let checks = 0;
const failures: string[] = [];
function check(value: unknown, message: string): void {
  checks++;
  if (!value) failures.push(message);
}
const planFor = (question: string): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [],
  unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
});
function document(question: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "operator contract witness" },
    source: { question, representationTier: "qualitative_verified", nonMetric: true },
    quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [],
    requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
  };
}
function production(scene: SceneDocument) {
  const question = String(scene.source.question);
  return validateProductionSceneCandidate({
    candidate: normalizeSceneDocumentModelOutput(scene as unknown as Record<string, unknown>, question),
    question, turnPlan: planFor(question),
  });
}

// The live production path must retain operator-owned display coordinates;
// converting these origins to point IDs is not an equivalent schema.
const torque = document("Show the signed torque for r=(1,0) m and F=(0,2) N.");
torque.entities = [{ id: "T", kind: "polyline", role: "torque", label: "tau" }];
torque.constructions = [{ id: "torque", operator: "planar_torque", inputs: {
  leverArm: [1, 0], force: [0, 2], lengthUnit: "m", forceUnit: "N", origin: [1, 1], displayLength: 0.7,
}, outputs: ["T"] }];
torque.requiredEntityIds = ["T"];
torque.revealGroups = [{ id: "g", entityIds: ["T"], dependsOn: [], narrationCue: "signed torque" }];
const torqueResult = production(torque);
check(torqueResult.valid, `inline planar_torque origin survives production: ${JSON.stringify(torqueResult.errors)}`);
check(Array.isArray(torqueResult.value?.document.constructions.find((item) => item.operator === "planar_torque")?.inputs.origin), "torque origin stays inline, not a foreign point ID");
const motion = document("Show circular position at radius 2 m, angle 0 rad, angular velocity 3 rad/s and angular acceleration 4 rad/s^2.");
motion.entities = [{ id: "P", kind: "point", role: "circular position", label: "P" }];
motion.constructions = [{ id: "motion", operator: "rotational_motion", inputs: {
  radius: 2, angle: 0, angleUnit: "rad", angularVelocity: 3, angularAcceleration: 4,
  units: { length: "m", time: "s" }, angularVelocityUnit: "rad/s", angularAccelerationUnit: "rad/s^2",
  origin: [2, -1], displayScale: 1,
}, outputs: ["P"] }];
motion.requiredEntityIds = ["P"];
motion.revealGroups = [{ id: "g", entityIds: ["P"], dependsOn: [], narrationCue: "circular position" }];
check(production(motion).valid, "rotation class retains its operator-owned inline display origin");
const wrongTorque = structuredClone(torque);
wrongTorque.constructions[0]!.inputs.forceUnit = "kg";
check(!production(wrongTorque).valid, "origin repair does not weaken physical input units");

// Cartesian components have an existing head-to-tail construction, including
// the y component starting at the x component's tip. A basis is optional.
const components = document("Show Cartesian components of vector (2,3).");
components.entities = [
  { id: "O", kind: "point", role: "origin" },
  { id: "x", kind: "vector", role: "Cartesian x component", label: "x" },
  { id: "y", kind: "vector", role: "Cartesian y component", label: "y" },
];
components.constructions = [
  { id: "makeO", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
  { id: "components", operator: "vector_components", inputs: { origin: "O", vector: [2, 3] }, outputs: ["x", "y"] },
];
components.requiredEntityIds = ["x", "y"];
components.revealGroups = [{ id: "g", entityIds: ["x", "y"], dependsOn: [], narrationCue: "Cartesian components" }];
const componentResult = production(components);
check(componentResult.valid, `optional basis compiles on production path: ${JSON.stringify(componentResult.errors)}`);
const x = componentResult.value?.renderScene.primitives.find((mark) => mark.entityId === "x" && mark.kind !== "label");
const y = componentResult.value?.renderScene.primitives.find((mark) => mark.entityId === "y" && mark.kind !== "label");
check(x && y && x.points[1]!.x === y.points[0]!.x && x.points[1]!.y === y.points[0]!.y, "Cartesian component ink is head-to-tail");
const dashed = structuredClone(components);
dashed.entities.find((entity) => entity.id === "x")!.provenance = { dashed: true, strokeRole: "construction" };
const dashedResult = production(dashed);
check(dashedResult.valid, "existing dashed construction intent is legal model input");
check(dashedResult.value?.renderScene.primitives.some((mark) => mark.entityId === "x" && mark.provenance?.dashed === true && mark.provenance?.strokeRole === "construction"), "dashed intent reaches compiled physical geometry");
const compactTorque = compactSceneExampleDocument(torque as unknown as Record<string, unknown>);
const compactConstructions = compactTorque.constructions as Array<{ inputs: Record<string, unknown> }>;
check(JSON.stringify(compactConstructions[0]!.inputs.origin) === "[1,1]", "compact example retains the torque's literal origin schema");
const untrusted = structuredClone(dashed);
untrusted.entities.find((entity) => entity.id === "x")!.provenance = { dashed: true, strokeRole: "construction", dsaMark: "excluded", strokeWidth: 4, x: 400 };
const compactStyled = compactSceneExampleDocument(untrusted as unknown as Record<string, unknown>);
const compactX = (compactStyled.entities as Array<Record<string, unknown>>).find((entity) => entity.id === "x");
check(JSON.stringify(compactX?.provenance) === JSON.stringify({ dashed: true, strokeRole: "construction" }), "examples preserve permitted display intent without pixel fields or engine-only metadata");

const fieldOperators = ["coulomb_pair", "point_charge_field", "dipole_field", "dipole_torque", "dipole_energy", "field_lines", "equipotential"];
for (const detailed of [undefined, []] as const) {
  const contracts = selectConstructionInputContracts(fieldOperators, detailed);
  for (const operator of fieldOperators) check(new RegExp(`^- [a-z_/]*${operator}[a-z_/]*: \\{`, "m").test(contracts), `${operator} has a ${detailed ? "compact" : "full"} input contract`);
}
const componentContract = selectConstructionInputContracts(["vector_components"]);
check(componentContract.includes("head-to-tail"), "optional Cartesian component placement is documented accurately");
check(selectConstructionInputContracts(["bar_magnet"]).includes("positive moment end is north"), "bar magnet orientation is its moment vector, not an unsupported angle input");
const namedAxes = document("Draw an Argand plane with Re and Im axes.");
namedAxes.entities = [{ id: "A", kind: "axes", role: "Argand plane" }];
namedAxes.constructions = [{ id: "axes", operator: "axes", inputs: { xMin: -1, xMax: 2, yMin: -1, yMax: 2, xLabel: "Re", yLabel: "Im" }, outputs: ["A"] }];
namedAxes.requiredEntityIds = ["A"];
namedAxes.revealGroups = [{ id: "g", entityIds: ["A"], dependsOn: [], narrationCue: "Argand axes" }];
const axesResult = production(namedAxes);
check(axesResult.valid, "verified axes can name their visible endpoints");
for (const text of ["Re", "Im"]) check(axesResult.value?.renderScene.primitives.some((mark) => mark.kind === "label" && mark.entityId === "A" && mark.text === text), `${text} label belongs to its actual axes geometry`);

// Mock only the paid transport: production normalization above is real.
const originalFetch = globalThis.fetch;
const requests: Array<{ messages: Array<{ content: string }> }> = [];
globalThis.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(torque) } }] }), { status: 200 });
};
try {
  await planSceneDocument("Describe the torque and field.", { proxyUrl: "http://planner.test", timeoutMs: 2000 });
  await repairSceneDocument("Describe the torque and field.", torque as unknown as Record<string, unknown>, [{ code: "invalid_planar_torque_origin", message: "Retain literal origin.", severity: "fatal" }], { proxyUrl: "http://planner.test", timeoutMs: 2000 });
  check(requests.length === 2, "initial and repair transport captured");
  for (const [index, request] of requests.entries()) {
    const content = request.messages.map((message) => message.content).join("\n");
    check(content.length <= (index === 0 ? 24_500 : 27_000), "unchanged transport limit");
    check(content.includes("provenance?:{dashed?:boolean,strokeRole?:\"construction\"}"), "legal dashed intent reaches transport");
    check(/- axes: \{[^\n]*xLabel\?[^\n]*yLabel\?/.test(content), "axis names survive transport");
    check(/- planar_torque: \{[^\n]*origin\?:\[x,y\]/.test(content), "literal torque origin survives compact transport");
    for (const operator of fieldOperators) check(new RegExp(`^- [a-z_/]*${operator}[a-z_/]*: \\{`, "m").test(content), `${operator} survives transport`);
  }
} finally { globalThis.fetch = originalFetch; }
check(buildSceneDocumentPlannerPrompt("Show Cartesian components.", { constructionOperators: ["point", "vector_components"] }).includes("head-to-tail"), "scoped prompt delivers Cartesian semantics");
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`H4 planner contracts: ${checks} checks passed (production normalization, offers and transport)`);

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
