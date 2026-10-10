import assert from "node:assert/strict";
import { type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildSceneDocumentPlannerPrompt, compactSceneExampleDocument, inferSceneCapabilities,
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
for (const detailed of [undefined, []] as const) {
  const contracts = selectConstructionInputContracts(["rectangle", "right_angle_mark", "dimension", "wave_sample", "vector"], detailed);
  check(/- rectangle: \{[^\n]*axis\?:/.test(contracts), "rectangle axis is offered in full and compact contracts");
  check(contracts.includes("infinite line"), "right-angle incidence semantics survive compaction");
  check(contracts.includes("same wave") && contracts.includes("xScale=yScale=1"), "wave dimension physical-authority restriction survives compaction");
  check(contracts.includes("glyph diameter") && contracts.includes("space_vector"), "page-normal and mixed spatial vector cases remain distinct in compact contracts");
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

// A slope annotation belongs to its analytic curve; first/second define a
// secant, not the derivative at either point. Incomplete pairs must reject.
const secant = document("Show secant rise/run for y=x^2 between x=0.5 and x=2.");
secant.entities = [{ id: "F", kind: "polyline", role: "source function", label: "f" }];
secant.constructions = [{ id: "curve", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 3, samples: 65 }, outputs: ["F"] }];
secant.annotations = [{ id: "slope", kind: "slope_triangle", targetIds: ["F"], curve: "F", first: 0.5, second: 2 }];
secant.requiredEntityIds = ["F"];
secant.revealGroups = [{ id: "g", entityIds: ["F"], dependsOn: [], narrationCue: "secant rise and run" }];
check(production(secant).valid, "paired analytic parameters define production secant geometry");
const unpaired = structuredClone(secant); delete unpaired.annotations[0]!.second;
check(!production(unpaired).valid, "unpaired slope parameter rejects on production path");
const wrongOwner = structuredClone(secant);
wrongOwner.entities.push({ id: "P", kind: "point", role: "source point" });
wrongOwner.constructions.push({ id: "point", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["P"] });
wrongOwner.annotations[0]!.targetIds = ["P"];
check(!production(wrongOwner).valid, "slope annotation cannot substitute a point for its declared analytic curve");
const wrongParameterUnit = structuredClone(secant);
wrongParameterUnit.annotations[0]!.first = { value: 0.5, unit: "s" };
check(!production(wrongParameterUnit).valid, "slope parameters must match the curve's source parameter units");

const pageNormal = document("Show a into-page vector as a cross.");
pageNormal.entities = [{ id: "O", kind: "point", role: "vector origin" }, { id: "V", kind: "vector", role: "into-page vector", label: "v" }];
pageNormal.constructions = [
  { id: "origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
  { id: "normal", operator: "vector", inputs: { start: "O", direction: [0, 0, -1], length: 0.25 }, outputs: ["V"] },
];
pageNormal.requiredEntityIds = ["V"];
pageNormal.revealGroups = [{ id: "g", entityIds: ["O", "V"], dependsOn: [], narrationCue: "into-page direction" }];
const normalResult = production(pageNormal);
check(normalResult.valid, "pure page-normal direction compiles through production normalization");
check(normalResult.value?.document.constructions.some((item) => item.operator === "vector" && JSON.stringify(item.inputs.direction) === "[0,0,-1]"), "normalization preserves typed page-normal source direction");
check(normalResult.value?.renderScene.primitives.some((mark) => mark.entityId === "V" && mark.kind === "polyline"), "page-normal glyph is owned by its vector");
const mixedDirection = structuredClone(pageNormal); mixedDirection.constructions[1]!.inputs.direction = [1, 0, 1];
check(!production(mixedDirection).valid, "mixed spatial direction cannot become a planar glyph");

// The directed predicate distinguishes reversed arrows where a supporting
// line angle cannot. Mathematical derivatives may compose without inheriting
// a physical field's unit authority.
const derivative = document("For y=x^2 at x=1, draw its tangent vector and twice that vector in the same direction.");
derivative.entities = [
  { id: "F", kind: "polyline", role: "source function", label: "f" },
  { id: "D", kind: "vector", role: "derivative vector", label: "d" },
  { id: "R", kind: "vector", role: "twice derivative", label: "r" },
];
derivative.constructions = [
  { id: "curve", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 2, samples: 65 }, outputs: ["F"] },
  { id: "derivative", operator: "curve_derivative", inputs: { curve: "F", at: 1, parameterScale: 1 }, outputs: ["D"] },
  { id: "scale", operator: "vector_scale", inputs: { vector: "D", factor: 2, origin: [0, 0] }, outputs: ["R"] },
];
derivative.assertions = [{ id: "sense", predicate: "same_direction", entities: ["D", "R"], expected: true, severity: "fatal" }];
derivative.requiredEntityIds = ["F", "D", "R"];
derivative.revealGroups = [{ id: "g", entityIds: ["F", "D", "R"], dependsOn: [], narrationCue: "derivative vectors" }];
check(production(derivative).valid, "ordinary mathematical derivative composes on production path");
const reversedDerivative = structuredClone(derivative); reversedDerivative.constructions[2]!.inputs.factor = -2;
check(!production(reversedDerivative).valid, "reversed derivative cannot prove same_direction");
for (const question of ["Resolve a planar vector into components.", "Explain electric dipole field.", "Explain electromagnetic waves."]) {
  const caps = inferSceneCapabilities(question, { turnPlan: planFor(question) });
  check(caps.proofPredicates.includes("same_direction"), "existing vector/field families offer directed-sense proof");
  check(buildSceneDocumentPlannerPrompt(question, caps).includes("same_direction"), "directed-sense proof reaches scoped prompt");
}

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
    check(content.includes("same_direction") && content.includes("planar angle_between is unsigned"), "directed-sense semantics survive transport");
    check(content.includes('slope_triangle:{kind:"slope_triangle",targetIds:[curve],curve?,first,second}'), "exact slope parameter inputs survive transport");
    check(/- rectangle: \{[^\n]*axis\?:/.test(content), "rectangle proof-axis input survives transport");
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
