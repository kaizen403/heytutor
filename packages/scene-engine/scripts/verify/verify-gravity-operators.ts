import assert from "node:assert/strict";
import { evaluateGravityConstruction, gravityConstructionOutputLabels, validateGravityConstruction, type GravityEvaluationContext, type GravityGeometry } from "../../src/compile/gravityGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>();
const quantities = new Map<string, number>([["M", 8], ["x", 3], ["G", 10], ["m", 5]]);
const context: GravityEvaluationContext = {
  number(value) { if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value); return typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value); },
  point(value) { const geometry = typeof value === "string" ? geometries.get(value) : undefined; if (typeof geometry === "object" && geometry !== null && "point" in geometry) return geometry.point as { x: number; y: number }; throw new Error("missing point"); },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
const base = { sources: [{ position: [0, 0], mass: 8 }], at: [3, 4], G: 10, units: { mass: "kg", length: "m", G: "m^3/(kg*s^2)" }, displayLength: 2 };
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
function close(actual: number, expected: number, message: string): void { checks++; assert.ok(actual === expected || Math.abs(actual - expected) <= 1e-12 * Math.abs(expected), `${message}: ${actual} != ${expected}`); }
function field(overrides: Record<string, unknown> = {}): GravityGeometry { return evaluateGravityConstruction("gravitational_field", { ...base, ...overrides }, context)[0]!; }
function reject(overrides: Record<string, unknown>): void { checks++; assert.throws(() => field(overrides), undefined, `invalid physical field ${JSON.stringify(overrides)}`); }
const single = field(); geometries.set("g", single);
check("gravityField" in single && single.kind === "path" && single.directed, "nonzero gravity renders an honest directed vector");
close(single.gravityField.components.x, -1.92, "single mass signed radial x oracle"); close(single.gravityField.components.y, -2.56, "single mass signed radial y oracle");
close(single.gravityField.magnitude, 3.2, "single mass GM/r^2 oracle"); close(single.gravityField.potential, -16, "single mass -GM/r potential oracle");
close(single.points[1]!.x, 1.8, "normalized display endpoint x"); close(single.points[1]!.y, 2.4, "normalized display endpoint y");
check(gravityConstructionOutputLabels("gravitational_field", [single])[0] === "g", "default field label preserves initial setup");
check(gravityConstructionOutputLabels("gravitational_field", [single], ["g=3.2 m/s^2"])[0] === "g=3.2 m/s^2", "explicit accurate SI result label is retained");
for (const label of ["g=999 m/s^2", "g=3.2 N", "g=NaN m/s^2", "g=Infinity m/s^2"]) { checks++; assert.throws(() => gravityConstructionOutputLabels("gravitational_field", [single], [label])); }
for (const [mass, G, distance, magnitude, potential] of [[16, 10, 5, 6.4, -32], [8, 20, 5, 6.4, -32], [8, 10, 10, 0.8, -8]] as const) {
  const result = field({ sources: [{ position: [0, 0], mass }], G, at: [distance * 0.6, distance * 0.8] });
  check("gravityField" in result, "mass/radius scaling retains field metadata"); close(result.gravityField.magnitude, magnitude, "mass/G/radius scaling oracle"); close(result.gravityField.potential, potential, "potential scales linearly and inversely with radius");
}
const translated = field({ sources: [{ position: [11, -7], mass: 8 }], at: [14, -3], origin: [20, 30], displayLength: 20 });
check("gravityField" in translated, "translated source metadata"); close(translated.gravityField.components.x, -1.92, "translation preserves physical x field"); close(translated.gravityField.components.y, -2.56, "translation preserves physical y field");
close(translated.gravityField.potential, -16, "translation preserves potential independently of display origin/length");
const rotated = field({ at: [-4, 3] }); check("gravityField" in rotated, "rotated field metadata"); close(rotated.gravityField.components.x, 2.56, "right-angle rotation x oracle"); close(rotated.gravityField.components.y, -1.92, "right-angle rotation y oracle");
const twoSources = [{ position: [0, 0], mass: 8 }, { position: [3, 0], mass: 2 }];
const superposed = field({ sources: twoSources }); check("gravityField" in superposed, "superposition metadata"); close(superposed.gravityField.components.x, -1.92, "independent asymmetric superposition x"); close(superposed.gravityField.components.y, -3.81, "independent asymmetric superposition y"); close(superposed.gravityField.potential, -21, "independent summed potential");
const reordered = field({ sources: [...twoSources].reverse() }); check("gravityField" in reordered, "reordered sources metadata"); check(JSON.stringify(reordered.gravityField.components) === JSON.stringify(superposed.gravityField.components) && reordered.gravityField.potential === superposed.gravityField.potential, "permutation leaves deterministic physical sums unchanged");
const symmetric = field({ at: [0, 0], sources: [{ position: [-2, 0], mass: 3 }, { position: [2, 0], mass: 3 }] }); geometries.set("zero", symmetric);
check("gravityField" in symmetric && symmetric.kind === "point" && symmetric.gravityField.zero && symmetric.gravityField.direction === null && symmetric.gravityField.components.x === 0 && symmetric.gravityField.components.y === 0, "exact symmetric source cancellation certifies a zero marker");
close(symmetric.gravityField.potential, -30, "zero field does not imply zero potential");
const symmetric2d = field({ at: [0, 0], sources: [{ position: [-3, -4], mass: 5 }, { position: [3, 4], mass: 5 }, { position: [-4, 3], mass: 2 }, { position: [4, -3], mass: 2 }] });
check("gravityField" in symmetric2d && symmetric2d.gravityField.zero, "same-radius weighted exact dyadic numerator certifies two-dimensional cancellation");
const zeroMass = field({ sources: [{ position: [0, 0], mass: 0 }] }); check("gravityField" in zeroMass && zeroMass.kind === "point" && zeroMass.gravityField.potential === 0 && zeroMass.gravityField.zero, "zero source mass has zero field and potential");
const nonzeroNear = field({ at: [0, 0], sources: [{ position: [-2, 0], mass: 3 }, { position: [2, 0], mass: 3 + 1e-8 }] });
check("gravityField" in nonzeroNear && !nonzeroNear.gravityField.zero && nonzeroNear.gravityField.components.x > 0, "resolved near cancellation retains its nonzero direction");
reject({ at: [0, 0], sources: [{ position: [-2, 0], mass: 3 }, { position: [2, 0], mass: 3 + Number.EPSILON * 2 }] });
const converted = field({ sources: [{ position: [0, 0], mass: { value: 8000, unit: "g" } }], at: [{ value: 300, unit: "cm" }, { value: 400, unit: "cm" }], units: { mass: "g", length: "cm", G: base.units.G } });
check("gravityField" in converted, "declared unit conversion retains metadata"); close(converted.gravityField.magnitude, 3.2, "explicit grams/centimeters conversion produces SI field"); close(converted.gravityField.potential, -16, "explicit units produce SI potential");
const sourceRef = field({ sources: [{ position: [0, 0], mass: { value: "M", unit: "kg" } }], at: ["x", "4"], G: { value: "G", unit: "N*m^2/kg^2" } });
check("gravityField" in sourceRef && sourceRef.gravityField.magnitude === single.gravityField.magnitude, "quantity IDs, strings, and typed wrappers preserve authority");
const force = evaluateGravityConstruction("gravitational_force", { field: "g", testMass: "m", massUnit: "kg", displayLength: 4, origin: [7, 9] }, context)[0]!;
check("gravityForce" in force && force.kind === "path", "force consumes typed field and explicit test mass"); close(force.gravityForce.components.x, -9.6, "F=m g x oracle"); close(force.gravityForce.components.y, -12.8, "F=m g y oracle"); close(force.gravityForce.magnitude, 16, "force magnitude SI oracle");
check(gravityConstructionOutputLabels("gravitational_force", [force])[0] === "F" && gravityConstructionOutputLabels("gravitational_force", [force], ["F=16 N"])[0] === "F=16 N", "force symbols default and explicit verified result survive");
const forceGrams = evaluateGravityConstruction("gravitational_force", { field: "g", testMass: 5000, massUnit: "g" }, context)[0]!; check("gravityForce" in forceGrams, "force unit provenance"); close(forceGrams.gravityForce.magnitude, 16, "independent test-mass conversion");
for (const input of [{ field: "g", testMass: 0, massUnit: "kg" }, { field: "zero", testMass: 5, massUnit: "kg" }]) { const result = evaluateGravityConstruction("gravitational_force", input, context)[0]!; check("gravityForce" in result && result.kind === "point" && result.gravityForce.zero, "zero test mass or certified zero field yields zero force marker"); }
const badSources: Record<string, unknown>[] = [
  { sources: [{ position: [0, 0], mass: "1e-400" }] }, { G: "1e-400" },
  { G: 0 }, { G: -1 }, { G: Infinity }, { G: null }, { G: true }, { G: 1e37 }, { G: { value: 10, unknown: 1 } },
  { sources: [] }, { sources: Array.from({ length: 33 }, () => ({ position: [0, 0], mass: 1 })) }, { sources: [{ position: [0, 0], mass: -8 }] }, { sources: [{ position: [0, 0], mass: Infinity }] }, { sources: [{ position: [0, 0], mass: 8, arbitrary: 1 }] },
  { sources: [{ position: [3, 4], mass: 8 }] }, { sources: [{ position: [3, 4], mass: 0 }] }, { at: [0, 0] }, { at: [3, 4, 0] }, { at: { x: 3, y: 4, z: 0 } }, { at: [1e16, 0] },
  { units: undefined }, { units: { ...base.units, G: "1" } }, { units: { ...base.units, mass: "lb" } }, { sources: [{ position: [0, 0], mass: { value: 8, unit: "g" } }] }, { at: [{ value: 3, unit: "cm" }, 4] }, { G: { value: 10, unit: "N" } },
  { displayLength: 0 }, { displayLength: 1e-6 }, { displayLength: { value: 2, unit: "m" } }, { origin: [1e15, 1e15] }, { origin: [3, 4, 5] },
  { G: 1e-300, sources: [{ position: [0, 0], mass: 1e-300 }] }, { at: [Number.MIN_VALUE, 1e15] }, { unexpected: true },
  { sources: [{ position: [0, 0], mass: 1e-288 }], G: Number.MIN_VALUE, at: [Number.MIN_VALUE, Number.MIN_VALUE], units: { ...base.units, length: "km" } },
];
badSources.forEach(reject);
geometries.set("world", { kind: "point", point: { x: 3, y: 4 }, space: { world3D: { x: 3, y: 4, z: 9 } } }); reject({ at: "world" }); reject({ origin: "world" }); reject({ sources: [{ position: "world", mass: 8 }] });
geometries.set("plain", { kind: "point", point: { x: 3, y: 4 } }); const pointRef = field({ at: "plain" }); check("gravityField" in pointRef && pointRef.gravityField.magnitude === single.gravityField.magnitude, "plain 2D point refs are reusable physical inputs");
for (const mutation of [{ gravityField: { ...single.gravityField, G: 11 } }, { gravityField: { ...single.gravityField, components: { x: 999, y: -2.56 } } }, { directed: false }, { world3D: { x: 3, y: 4, z: 9 } }]) { geometries.set("tampered", { ...single, ...mutation }); checks++; assert.throws(() => evaluateGravityConstruction("gravitational_force", { field: "tampered", testMass: 5, massUnit: "kg" }, context)); }
geometries.set("force", force);
for (const mutation of [{ field: "missing" }, { field: "force" }, { testMass: -1 }, { testMass: { value: 5, unit: "g" } }, { massUnit: "lb" }, { displayLength: 0 }, { unexpected: 1 }]) { checks++; assert.throws(() => evaluateGravityConstruction("gravitational_force", { field: "g", testMass: 5, massUnit: "kg", ...mutation }, context)); }

function scene(): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit gravitational masses" }, source: {}, quantities: [],
    entities: [{ id: "g", kind: "vector", role: "gravitational field" }, { id: "F", kind: "vector", role: "test mass force" }],
    constructions: [{ id: "make_g", operator: "gravitational_field", inputs: { ...base }, outputs: ["g"] }, { id: "make_F", operator: "gravitational_force", inputs: { field: "g", testMass: 5, massUnit: "kg", displayLength: 4 }, outputs: ["F"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["g", "F"], revealGroups: [{ id: "gravity", entityIds: ["g", "F"], dependsOn: [], narrationCue: "source gravitational field and test force" }], teachingTimeline: [] };
}
function issues(document: SceneDocument): SceneIssue[] { const result: SceneIssue[] = []; const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const))); document.constructions.forEach((construction, index) => { if (construction.operator === "gravitational_field" || construction.operator === "gravitational_force") validateGravityConstruction(construction, index, document, producers, result); }); return result; }
check(issues(scene()).length === 0, "complete explicit field and force validate");
const quantityScene = scene(); quantityScene.quantities = [{ id: "M", value: 8, unit: "kg" }, { id: "x", value: 3, unit: "m" }, { id: "G", value: 10, unit: base.units.G }, { id: "m", value: 5, unit: "kg" }]; Object.assign(quantityScene.constructions[0]!.inputs, { sources: [{ position: [0, 0], mass: "M" }], at: ["x", 4], G: "G" }); quantityScene.constructions[1]!.inputs.testMass = "m";
check(issues(quantityScene).length === 0, "source quantity units validate end to end");
const invalidScenes: SceneDocument[] = [];
const underflowMass = structuredClone(quantityScene); underflowMass.quantities[0]!.value = "1e-400"; check(issues(underflowMass).some((issue) => issue.severity === "fatal"), "quantity-bound nonzero decimal mass cannot become certified zero"); invalidScenes.push(underflowMass);
for (const [id, unit] of [["M", "g"], ["x", "cm"], ["G", "1"], ["m", "g"], ["M", ""], ["x", 42]] as const) { const candidate = structuredClone(quantityScene); candidate.quantities.find((quantity) => quantity.id === id)!.unit = unit; check(issues(candidate).some((issue) => issue.severity === "fatal"), "known source scale/unit contradictions fail closed"); invalidScenes.push(candidate); }
const stale = scene(); stale.entities[0]!.label = "g=999 m/s^2"; invalidScenes.push(stale);
const annotation = scene(); annotation.quantities.push({ id: "answer", value: 999, unit: "N" }); annotation.annotations.push({ id: "wrong_force", kind: "badge", targetIds: ["F"], quantityId: "answer" }); invalidScenes.push(annotation);
const explicitLabels = scene(); explicitLabels.entities[0]!.label = "g=3.2 m/s^2"; explicitLabels.entities[1]!.label = "F=16 N"; check(issues(explicitLabels).length === 0, "correct explicitly requested output claims validate");
const sourcePoint = scene(); sourcePoint.entities.unshift({ id: "source", kind: "point", role: "source mass", label: "M" }); sourcePoint.constructions.unshift({ id: "make_source", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["source"] }); sourcePoint.constructions[1]!.inputs.sources = [{ position: "source", mass: 8 }]; sourcePoint.requiredEntityIds.push("source"); sourcePoint.revealGroups[0]!.entityIds.push("source"); check(issues(sourcePoint).length === 0, "explicit source point is physically unit compatible");
const wrongSourceClaim = structuredClone(sourcePoint); wrongSourceClaim.quantities.push({ id: "wrong_mass", value: 999, unit: "kg" }); wrongSourceClaim.annotations.push({ id: "source_mass", kind: "badge", targetIds: ["source"], quantityId: "wrong_mass" });
check(issues(wrongSourceClaim).some((issue) => issue.severity === "fatal"), "source-mass annotations cannot pair stale mass values with correct field geometry"); invalidScenes.push(wrongSourceClaim);
const wrongSourceLabel = structuredClone(sourcePoint); wrongSourceLabel.entities[0]!.label = "M=999 kg"; check(issues(wrongSourceLabel).some((issue) => issue.severity === "fatal"), "numerical source-point mass label must match the source mass"); invalidScenes.push(wrongSourceLabel);
const correctSourceClaim = structuredClone(sourcePoint); correctSourceClaim.entities[0]!.label = "M=8 kg"; correctSourceClaim.quantities.push({ id: "given_mass", value: 8, unit: "kg" }); correctSourceClaim.annotations.push({ id: "source_mass", kind: "badge", targetIds: ["source"], quantityId: "given_mass" }); check(issues(correctSourceClaim).length === 0, "accurate explicit mass label and annotation remain valid");
const zeroClaim = scene(); zeroClaim.constructions[1]!.inputs.testMass = 0; zeroClaim.quantities.push({ id: "tiny_force", value: 1e-320, unit: "N" }); zeroClaim.annotations.push({ id: "false_zero", kind: "badge", targetIds: ["F"], quantityId: "tiny_force" }); check(issues(zeroClaim).some((issue) => issue.severity === "fatal"), "tiny nonzero annotations cannot round into a certified zero force"); invalidScenes.push(zeroClaim);
const cyclicQuantity = structuredClone(quantityScene); cyclicQuantity.quantities.push({ id: "cycle", value: "M", unit: "kg" }); cyclicQuantity.quantities[0]!.value = "cycle"; check(issues(cyclicQuantity).some((issue) => issue.severity === "fatal"), "quantity reference cycles fail closed"); invalidScenes.push(cyclicQuantity);
const malformedQuantity = structuredClone(quantityScene); malformedQuantity.quantities[0]!.value = { value: 8, extra: "untrusted" }; check(issues(malformedQuantity).some((issue) => issue.severity === "fatal"), "quantity-bound wrappers must retain strict source schema"); invalidScenes.push(malformedQuantity);
const derivedPoint = scene(); derivedPoint.entities.unshift({ id: "observation", kind: "point", role: "derived 2D observation" }); derivedPoint.constructions.unshift({ id: "make_observation", operator: "triangle_center", inputs: { a: [0, 0], b: [9, 0], c: [0, 12], kind: "centroid" }, outputs: ["observation"] }); derivedPoint.constructions[1]!.inputs.at = "observation"; derivedPoint.requiredEntityIds.push("observation"); derivedPoint.revealGroups[0]!.entityIds.push("observation"); check(issues(derivedPoint).length === 0, "derived planar points defer coordinates without fake substitutions");
const wrongDerivedUnit = structuredClone(derivedPoint); wrongDerivedUnit.constructions[0]!.inputs.b = [{ value: 9, unit: "kg" }, 0]; check(issues(wrongDerivedUnit).some((issue) => issue.severity === "fatal"), "derived triangle coordinate source units cannot become physical lengths"); invalidScenes.push(wrongDerivedUnit);
if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument } = await import("../../src/index");
  for (const candidate of [scene(), quantityScene, explicitLabels, sourcePoint, correctSourceClaim, derivedPoint]) { const before = JSON.stringify(candidate); const result = compileSceneDocument(candidate); check(result.ok && result.renderScene, `live gravity compile: ${JSON.stringify(result.report.issues)}`); for (const id of ["g", "F"]) check(result.renderScene.primitives.some((primitive) => primitive.entityId === id && primitive.kind === "label" && primitive.text === (candidate.entities.find((entity) => entity.id === id)?.label ?? id)), "compiler preserves setup symbols or explicitly verified result text"); check(JSON.stringify(candidate) === before, "live compilation leaves its source document untouched"); check(JSON.stringify(result.renderScene) === JSON.stringify(compileSceneDocument(candidate).renderScene), "live gravity compilation is deterministic"); }
  for (const mutation of badSources) { const candidate = scene(); Object.assign(candidate.constructions[0]!.inputs, mutation); invalidScenes.push(candidate); }
  for (const candidate of invalidScenes) { const result = compileSceneDocument(candidate); check(!result.ok && result.renderScene === null, `invalid gravity authority cannot emit partial ink: ${JSON.stringify(result.report.issues)}`); }
}
console.log(`gravity operator verification passed (${checks} checks${process.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
