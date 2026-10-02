import assert from "node:assert/strict";
import { evaluateMagneticConstruction, magneticConstructionOutputLabels, validateMagneticConstruction, type MagneticEvaluationContext, type MagneticGeometry } from "../../src/compile/magneticGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>();
const quantities = new Map<string, number>([["q", 2], ["vx", 3], ["By", 4], ["length", 2]]);
const context: MagneticEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    return typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
  },
  point(value) {
    const geometry = typeof value === "string" ? geometries.get(value) : undefined;
    if (typeof geometry === "object" && geometry !== null && "point" in geometry) return geometry.point as { x: number; y: number };
    throw new Error("missing point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
const base = { charge: 2, velocity: [3, 0, 0], magneticField: [0, 4, 0], units: { charge: "C", velocity: "m/s", magneticField: "T" }, displayLength: 2 };
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
function close(actual: number, expected: number, message: string): void {
  checks++; assert.ok(actual === expected || Math.abs(actual - expected) <= 1e-12 * Math.abs(expected), `${message}: ${actual} != ${expected}`);
}
function force(overrides: Record<string, unknown> = {}): MagneticGeometry { return evaluateMagneticConstruction("magnetic_force", { ...base, ...overrides }, context)[0]!; }
function reject(overrides: Record<string, unknown>): void { checks++; assert.throws(() => force(overrides), undefined, `invalid magnetic source: ${JSON.stringify(overrides)}`); }
const normal = force(); geometries.set("normal", normal);
check(normal.kind === "multi_path" && normal.paths.length === 2, "q vx By produces an engine-owned page-normal dot glyph");
check(normal.magneticForce.components.z === 24 && normal.magneticForce.pageNormal === "out", "right-hand cross product and charge magnitude are independent authorities");
const negative = force({ charge: -2 }); geometries.set("negative", negative);
check(negative.kind === "multi_path" && negative.paths.length === 3 && negative.magneticForce.components.z === -24 && negative.magneticForce.pageNormal === "in", "negative charge reverses normal force and renders a cross");
check(force({ velocity: [0, 4, 0], magneticField: [3, 0, 0] }).magneticForce.components.z === -24, "interchanging cross-product sources reverses force");
const planar = force({ charge: -2, velocity: [2, 3, 0], magneticField: [0, 0, 5], origin: [7, -3], displayLength: 4 }); geometries.set("planar", planar);
check(planar.kind === "path" && planar.directed, "planar force is an honest directed vector");
check(planar.magneticForce.components.x === -30 && planar.magneticForce.components.y === 20 && planar.magneticForce.components.z === 0, "negative charge planar oracle");
close(planar.magneticForce.magnitude, Math.sqrt(1300), "independent force norm");
close(planar.points[1]!.x, 7 - 120 / Math.sqrt(1300), "display tip scales computed direction");
close(planar.points[1]!.y, -3 + 80 / Math.sqrt(1300), "display tip y component");
close(planar.magneticForce.components.x * 2 + planar.magneticForce.components.y * 3, 0, "force is perpendicular to velocity");
const explicit3d = force({ charge: 1, velocity: [1, 2, 3], magneticField: [2, 4, 7] });
check(explicit3d.kind === "path" && explicit3d.magneticForce.components.x === 2 && explicit3d.magneticForce.components.y === -1 && explicit3d.magneticForce.components.z === 0, "three-dimensional sources may yield an exactly planar resultant");
const rotated = force({ charge: -2, velocity: [-3, 2, 0], magneticField: [0, 0, 5] });
check(rotated.magneticForce.components.x === -20 && rotated.magneticForce.components.y === -30, "rotation commutes with planar Lorentz force");
close(rotated.magneticForce.magnitude, planar.magneticForce.magnitude, "rotation preserves magnitude");
check(force({ charge: 4, velocity: [6, 0, 0], magneticField: [0, 8, 0], displayLength: 200 }).magneticForce.components.z === 192, "charge/velocity/field scale independently of normalized display size");
for (const source of [{ charge: 0 }, { velocity: [0, 0, 0] }, { magneticField: [0, 0, 0] }, { velocity: [1, 2, 3], magneticField: [2, 4, 6] }]) {
  const zero = force(source); check(zero.kind === "point" && zero.magneticForce.zero && zero.magneticForce.magnitude === 0 && zero.magneticForce.pageNormal === null, "true algebraic zero has an honest marker");
}
check(force({ charge: 1, velocity: [1, 1, 0], magneticField: [1, 1 + 2 ** -40, 0] }).magneticForce.components.z === 2 ** -40, "near parallel sources must retain nonzero force");
check(force({ charge: 1, velocity: [4 / 3, 1, 0], magneticField: [4, 3, 0] }).magneticForce.components.z === -(2 ** -52), "rounded products cannot falsely certify exact cancellation");
check(force({ charge: 1, velocity: [Number.MIN_VALUE, 0, 0], magneticField: [0, 1, 0] }).magneticForce.components.z === Number.MIN_VALUE, "a representable nonzero subnormal remains an honest normal force");
reject({ charge: 0.5, velocity: [Number.MIN_VALUE, 0, 0], magneticField: [0, 1, 0] });
reject({ charge: 1, velocity: [Number.MIN_VALUE, Number.MIN_VALUE, 0], magneticField: [0, 0, 1] });
check(force({ charge: "q", velocity: [{ value: "vx", unit: "m/s" }, "0", 0], magneticField: [0, { value: "By", unit: "T" }, 0], displayLength: { value: "length", unit: "1" } }).magneticForce.components.z === 24, "numeric strings and typed quantity references retain source authority");
const components = evaluateMagneticConstruction("magnetic_components", { force: "planar" }, context);
check(components.length === 3 && components[0]!.kind === "path" && components[1]!.kind === "path" && components[2]!.kind === "point", "three components preserve nonzero axes and a zero-z marker");
check(components.every((output, index) => output.magneticForce.component === ["x", "y", "z"][index]), "Cartesian output ordering is fixed");
check(JSON.stringify(magneticConstructionOutputLabels("magnetic_components", components)) === JSON.stringify(["Fx", "Fy", "Fz"]), "component defaults preserve initial setup without computed answers");
check(JSON.stringify(magneticConstructionOutputLabels("magnetic_components", components, ["Fx=-30 N", "Fy=20 N", "Fz=0 N"])) === JSON.stringify(["Fx=-30 N", "Fy=20 N", "Fz=0 N"]), "explicit verified component values may be retained");
check(magneticConstructionOutputLabels("magnetic_force", [normal])[0] === "F ⊙", "normal default reveals direction without its numerical answer");
check(magneticConstructionOutputLabels("magnetic_force", [negative], ["Fz=-24 N ⊗"])[0] === "Fz=-24 N ⊗", "an explicitly supplied accurate normal result remains visible");
for (const requested of ["Fz=24 N ⊗", "Fz=999 N ⊙", "Fz=NaN N ⊙", "Fz=Infinity N ⊙", "Fz=24 T ⊙"]) { checks++; assert.throws(() => magneticConstructionOutputLabels("magnetic_force", [normal], [requested])); }
const normalComponents = evaluateMagneticConstruction("magnetic_components", { force: "normal", displayLength: 4 }, context);
check(normalComponents[0]!.kind === "point" && normalComponents[1]!.kind === "point" && normalComponents[2]!.kind === "multi_path", "page-normal force decomposes into two true zeros and its normal glyph");
geometries.set("component", components[0]);
for (const reference of ["missing", "component"]) { checks++; assert.throws(() => evaluateMagneticConstruction("magnetic_components", { force: reference }, context)); }
for (const mutation of [{ magneticForce: { ...normal.magneticForce, components: { x: 0, y: 0, z: 999 } } }, { magneticForce: { ...normal.magneticForce, zero: true } }, { electricField: { magnitude: 999 } }, { paths: [] }]) {
  geometries.set("tampered", { ...normal, ...mutation }); checks++; assert.throws(() => evaluateMagneticConstruction("magnetic_components", { force: "tampered" }, context), undefined, "tampered source metadata or geometry cannot compose");
}
const badSources: Record<string, unknown>[] = [
  { charge: 0.75, velocity: [Number.MIN_VALUE, 0, 0], magneticField: [0, 1, 0] },
  { charge: "1e-400" }, { velocity: ["1e-400", 0, 0] }, { magneticField: [0, "1e-400", 0] },
  { charge: Infinity }, { charge: null }, { charge: true }, { charge: 1e13 }, { charge: { value: 2, unexpected: 1 } },
  { velocity: [3, 0] }, { velocity: [3, 0, 0, 0] }, { velocity: { x: 3, y: 0, z: 0 } }, { magneticField: [0, NaN, 0] },
  { units: undefined }, { units: { ...base.units, charge: "mC" } }, { units: { ...base.units, velocity: "cm/s" } }, { units: { ...base.units, magneticField: "G" } },
  { charge: { value: 2, unit: "mC" } }, { velocity: [{ value: 3, unit: "m" }, 0, 0] }, { displayLength: { value: 2, unit: "N" } },
  { displayLength: 0 }, { displayLength: 1e-6 }, { displayLength: undefined }, { origin: [0, 0, 0] }, { origin: { x: 0, y: 0, z: 0 } }, { origin: [1e13, 0] }, { origin: [1e12, 1e12] },
  { velocity: [1, 2, 3], magneticField: [4, 5, 6] }, { velocity: [1e-200, 0, 0], magneticField: [0, 1e-200, 0] },
  { charge: 1e12, velocity: [1e12, 0, 0], magneticField: [0, 1e12, 0] }, { unexpected: true },
];
badSources.forEach(reject);
let wrapped: unknown = 2; for (let depth = 0; depth < 34; depth++) wrapped = { value: wrapped }; reject({ charge: wrapped });
geometries.set("world", { kind: "point", point: { x: 0, y: 0 }, world3D: { x: 0, y: 0, z: 4 } }); reject({ origin: "world" });
geometries.set("future", { kind: "point", point: { x: 0, y: 0 }, futurePhysicalAuthority: { value: 4 } }); reject({ origin: "future" });
geometries.set("plain", { kind: "point", point: { x: 3, y: 4 } }); check(force({ origin: "plain" }).magneticForce.origin.x === 3, "a constructed plain 2D origin is reusable placement");

function scene(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit Lorentz sources" }, source: {}, quantities: [],
    entities: ["F", "Fx", "Fy", "Fz"].map((id) => ({ id, kind: "vector", role: id === "F" ? "Lorentz resultant" : "Lorentz component" })),
    constructions: [
      { id: "make_F", operator: "magnetic_force", inputs: { ...base }, outputs: ["F"] },
      { id: "components", operator: "magnetic_components", inputs: { force: "F", displayLength: 4 }, outputs: ["Fx", "Fy", "Fz"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["F", "Fx", "Fy", "Fz"],
    revealGroups: [{ id: "forces", entityIds: ["F", "Fx", "Fy", "Fz"], dependsOn: [], narrationCue: "magnetic force" }], teachingTimeline: [],
  };
}
function issues(document: SceneDocument): SceneIssue[] {
  const result: SceneIssue[] = []; const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  document.constructions.forEach((construction, index) => { if (construction.operator.startsWith("magnetic_")) validateMagneticConstruction(construction, index, document, producers, result); });
  return result;
}
check(issues(scene()).length === 0, "source-explicit Lorentz construction validates");
const quantityScene = scene(); quantityScene.quantities = [{ id: "q", value: 2, unit: "C" }, { id: "vx", value: 3, unit: "m/s" }, { id: "By", value: 4, unit: "T" }];
Object.assign(quantityScene.constructions[0]!.inputs, { charge: "q", velocity: ["vx", 0, 0], magneticField: [0, "By", 0] });
check(issues(quantityScene).length === 0, "known SI source quantities validate consistently");
const malformedQuantity = structuredClone(quantityScene); malformedQuantity.quantities[0]!.value = { value: 2, unexpected: "untrusted source field" };
check(issues(malformedQuantity).some((issue) => issue.severity === "fatal"), "quantity-bound scalar wrappers must retain the strict source schema");
const invalidScenes: SceneDocument[] = [malformedQuantity];
const underflowQuantity = structuredClone(quantityScene); underflowQuantity.quantities[0]!.value = "1e-400";
check(issues(underflowQuantity).some((issue) => issue.severity === "fatal"), "quantity-bound nonzero decimal literals cannot become certified zero charge"); invalidScenes.push(underflowQuantity);
for (const [id, unit] of [["q", "mC"], ["vx", "cm/s"], ["By", "mT"], ["q", ""], ["q", 42]] as const) {
  const candidate = structuredClone(quantityScene); candidate.quantities.find((quantity) => quantity.id === id)!.unit = unit;
  check(issues(candidate).some((issue) => issue.severity === "fatal"), "incompatible or malformed known source units fail closed"); invalidScenes.push(candidate);
}
const stale = scene(); stale.entities[0]!.label = "Fz=999 N ⊙"; invalidScenes.push(stale);
const annotation = scene(); annotation.quantities.push({ id: "answer", value: 999, unit: "N" }); annotation.annotations.push({ id: "wrong_answer", kind: "badge", targetIds: ["F"], quantityId: "answer" }); invalidScenes.push(annotation);
const zeroAnnotation = scene(); zeroAnnotation.constructions[0]!.inputs.charge = 0; zeroAnnotation.quantities.push({ id: "tiny", value: 1e-320, unit: "N" }); zeroAnnotation.annotations.push({ id: "false_zero", kind: "badge", targetIds: ["F"], quantityId: "tiny" }); invalidScenes.push(zeroAnnotation);
for (const candidate of [stale, annotation, zeroAnnotation]) check(issues(candidate).some((issue) => issue.severity === "fatal"), "stale numerical labels or quantity annotations fail authority checks");
const explicitResult = scene(); explicitResult.entities[0]!.label = "Fz=24 N ⊙";
check(issues(explicitResult).length === 0, "explicit verified result text validates");
const chargeSource = scene(); chargeSource.entities.unshift({ id: "particle", kind: "point", role: "charged particle", label: "+q" }); chargeSource.constructions.unshift({ id: "make_particle", operator: "point", inputs: { x: 3, y: 4 }, outputs: ["particle"] }); chargeSource.constructions[1]!.inputs.origin = "particle";
chargeSource.requiredEntityIds.push("particle"); chargeSource.revealGroups[0]!.entityIds.push("particle");
check(issues(chargeSource).length === 0, "consistent source charge sign label remains valid");
const wrongChargeSign = structuredClone(chargeSource); wrongChargeSign.entities[0]!.label = "−q";
check(issues(wrongChargeSign).some((issue) => issue.severity === "fatal"), "origin source charge labels cannot contradict supplied charge sign"); invalidScenes.push(wrongChargeSign);
const wrongSourceAnnotation = structuredClone(chargeSource); wrongSourceAnnotation.quantities.push({ id: "other_charge", value: -2, unit: "C" }); wrongSourceAnnotation.annotations.push({ id: "wrong_charge", kind: "badge", targetIds: ["particle"], quantityId: "other_charge" });
check(issues(wrongSourceAnnotation).some((issue) => issue.severity === "fatal"), "source charge quantity annotations cannot contradict supplied source value"); invalidScenes.push(wrongSourceAnnotation);

if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument } = await import("../../src/index");
  for (const candidate of [scene(), quantityScene, explicitResult, chargeSource]) {
    const before = JSON.stringify(candidate); const result = compileSceneDocument(candidate);
    check(result.ok && result.renderScene, `live magnetic compile: ${JSON.stringify(result.report.issues)}`);
    const expected = candidate.entities.find((entity) => entity.id === "F")?.label ?? "F ⊙";
    check(result.renderScene.primitives.some((primitive) => primitive.entityId === "F" && primitive.kind === "label" && primitive.text === expected), "compiler owns initial-setup symbols and verified requested result text");
    check(result.renderScene.primitives.some((primitive) => primitive.entityId === "F" && primitive.kind === "polyline"), "normal force glyph reaches live rendered ink");
    check(JSON.stringify(candidate) === before, "compilation does not mutate the input document");
    check(JSON.stringify(result.renderScene) === JSON.stringify(compileSceneDocument(candidate).renderScene), "magnetic compile is deterministic");
  }
  for (const mutation of badSources) { const candidate = scene(); Object.assign(candidate.constructions[0]!.inputs, mutation); invalidScenes.push(candidate); }
  for (const candidate of invalidScenes) {
    const result = compileSceneDocument(candidate); check(!result.ok && result.renderScene === null, `invalid magnetic sources never emit a partial scene: ${JSON.stringify(result.report.issues)}`);
  }
}
console.log(`magnetic operator verification passed (${checks} checks${process.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
