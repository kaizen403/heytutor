import assert from "node:assert/strict";
import { COMPLEX_OPERATORS, evaluateComplexConstruction, validateComplexConstruction, validateEvaluatedComplexLabels, complexGeometryLabel, type ComplexEvaluationContext, type ComplexGeometry } from "../../src/compile/complexGeometry";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>();
const quantities = new Map<string, number>([["real_given", 3], ["imag_given", 4]]);
const context: ComplexEvaluationContext = {
  number(value) { if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value); const number = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value); if (!Number.isFinite(number)) throw new Error("nonfinite numeric source"); return number; },
  point(value) { if (typeof value === "string") { const geometry = geometries.get(value); if (typeof geometry === "object" && geometry !== null && "point" in geometry) return geometry.point as { x: number; y: number }; } if (Array.isArray(value) && value.length === 2) return { x: Number(value[0]), y: Number(value[1]) }; if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: Number(value.x), y: Number(value.y) }; throw new Error("not a finite display origin"); },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function close(actual: number, expected: number, message: string, tolerance = 1e-10): void { checks++; assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`); }
function evaluate(operator: string, inputs: Record<string, unknown>): ComplexGeometry[] { return evaluateComplexConstruction(operator, inputs, context); }
function reject(operator: string, inputs: Record<string, unknown>): void { checks++; assert.throws(() => evaluate(operator, inputs)); }
const sourceInputs = { real: 3, imaginary: 4, displayScale: 2, origin: [7, -11] };
const source = evaluate("complex_point", sourceInputs)[0]!; geometries.set("source", source);
assert.equal(source.kind, "point"); assert.deepEqual(source.point, { x: 13, y: -3 }); close(source.complexNumber.magnitude, 5, "3-4-5 complex modulus"); close(source.complexNumber.argument!, Math.atan2(4, 3), "argument computed from source components");
const transformInputs = { source: "source", multiplier: { real: -2, imaginary: 0.5 }, addend: { real: 1, imaginary: -3 }, displayScale: 0.5, origin: [-1, 9] };
const transformed = evaluate("complex_transform", transformInputs)[0]!; geometries.set("transformed", transformed);
close(transformed.complexNumber.real, -7, "independent exact complex product/addition real"); close(transformed.complexNumber.imaginary, -9.5, "independent exact complex product/addition imaginary"); assert.deepEqual(transformed.point, { x: -4.5, y: 4.25 });
for (const scale of [0.01, 1, 20]) for (const origin of [[0, 0], [19, -31]]) {
  const point = evaluate("complex_point", { ...sourceInputs, displayScale: scale, origin })[0]!; close(point.point.x - origin[0]!, 3 * scale, "translated/scaled real coordinate"); close(point.point.y - origin[1]!, 4 * scale, "translated/scaled imaginary coordinate"); close(point.complexNumber.magnitude, 5, "display scaling cannot change complex magnitude");
}
function power(real: number, imaginary: number, degree: number): { real: number; imaginary: number } { let value = { real: 1, imaginary: 0 }; for (let index = 0; index < degree; index++) value = { real: value.real * real - value.imaginary * imaginary, imaginary: value.real * imaginary + value.imaginary * real }; return value; }
for (const [real, imaginary] of [[1, 0], [-1, 0], [0, 1], [3, 4], [-7, -9.5]]) for (const degree of [2, 3, 5, 12]) {
  geometries.set("root_source", evaluate("complex_point", { real, imaginary, displayScale: 1 })[0]!);
  const roots = evaluate("complex_roots", { source: "root_source", degree, displayScale: 3, origin: [7, -11] }); assert.equal(roots.length, degree); checks++;
  roots.forEach((root, rootIndex) => { const value = power(root.complexNumber.real, root.complexNumber.imaginary, degree); close(value.real, real!, "independent repeated product reconstructs source"); close(value.imaginary, imaginary!, "independent repeated product reconstructs source"); assert.equal(root.complexNumber.rootIndex, rootIndex); close(root.complexNumber.magnitude ** degree, Math.hypot(real!, imaginary!), "modulus root law"); });
  for (let index = 1; index < degree; index++) { const first = roots[index - 1]!.complexNumber; const next = roots[index]!.complexNumber; const dot = (first.real * next.real + first.imaginary * next.imaginary) / (first.magnitude * next.magnitude); close(dot, Math.cos(2 * Math.PI / degree), "ordered adjacent root angular separation"); }
}
const zero = evaluate("complex_point", { real: 0, imaginary: 0, displayScale: 1 })[0]!; geometries.set("zero", zero); assert.equal(zero.complexNumber.argument, null); checks++;
const cancelled = evaluate("complex_transform", { source: "source", multiplier: { real: 1, imaginary: 0 }, addend: { real: -3, imaginary: -4 }, displayScale: 1 })[0]!; assert.equal(cancelled.complexNumber.real, 0); assert.equal(cancelled.complexNumber.imaginary, 0); assert.equal(cancelled.complexNumber.argument, null); checks++;
for (const [key, value] of [["real", undefined], ["imaginary", NaN], ["real", true], ["real", null], ["real", " "], ["displayScale", 0], ["displayScale", undefined], ["displayScale", Infinity], ["origin", [1e12, 0]], ["unit", "N"]] as const) reject("complex_point", { ...sourceInputs, [key]: value });
reject("complex_point", { real: { value: 3, unit: "m" }, imaginary: 4, displayScale: 1 });
for (const degree of [1, 13, 2.5, undefined, null, true, " "]) reject("complex_roots", { source: "source", degree, displayScale: 1 });
reject("complex_roots", { source: "zero", degree: 3, displayScale: 1 }); reject("complex_roots", { source: "missing", degree: 3, displayScale: 1 }); reject("complex_roots", { source: "source", degree: 3, displayScale: 1e-14 });
reject("complex_transform", { ...transformInputs, multiplier: { real: -2, imaginary: 0.5, angle: 3 } }); reject("complex_transform", { ...transformInputs, addend: undefined }); reject("complex_transform", { ...transformInputs, multiplier: { real: 1e12, imaginary: 1e12 } });
geometries.set("physical", { kind: "point", point: { x: 3, y: 4 }, space: { x: 1, y: 2, z: 3 }, spaceFrameId: "F" }); reject("complex_point", { real: 1, imaginary: 2, origin: "physical", displayScale: 1 });
evaluate("complex_point", { real: "real_given", imaginary: { value: "imag_given" }, displayScale: 1 }); checks++;
function documentFor(): SceneDocument {
  const constructions: SceneConstruction[] = [{ id: "make_source", operator: "complex_point", inputs: structuredClone(sourceInputs), outputs: ["source"] }, { id: "make_transform", operator: "complex_transform", inputs: structuredClone(transformInputs), outputs: ["transformed"] }, { id: "make_roots", operator: "complex_roots", inputs: { source: "transformed", degree: 3, displayScale: 2 }, outputs: ["root0", "root1", "root2"] }];
  const ids = constructions.flatMap((construction) => construction.outputs);
  return { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "explicit computed complex geometry" }, quantities: [], entities: ids.map((id) => ({ id, kind: "point", role: "computed complex point" })), constructions, relations: [], assertions: [], annotations: [], requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show complex geometry" }], teachingTimeline: [] };
}
function issuesFor(scene: SceneDocument): SceneIssue[] { const issues: SceneIssue[] = []; const byOutput = new Map(scene.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const))); scene.constructions.forEach((construction, index) => validateComplexConstruction(construction, index, scene, byOutput, issues)); return issues; }
assert.deepEqual(issuesFor(documentFor()), []); checks++;
const wrongArity = documentFor(); wrongArity.constructions[2]!.outputs.pop(); assert(issuesFor(wrongArity).some((issue) => issue.severity === "fatal")); checks++;
const wrongUnits = documentFor(); wrongUnits.quantities.push({ id: "length", value: 3, unit: "m" }); wrongUnits.constructions[0]!.inputs.real = "length"; assert(issuesFor(wrongUnits).some((issue) => issue.severity === "fatal")); checks++;
const wrongLabel = documentFor(); wrongLabel.entities[0]!.label = "Re(z)=999"; assert(issuesFor(wrongLabel).some((issue) => issue.severity === "fatal")); checks++;
const labelIssues: SceneIssue[] = []; validateEvaluatedComplexLabels(wrongLabel.constructions[0]!, 0, wrongLabel, [source], labelIssues); assert(labelIssues.some((issue) => issue.severity === "fatal")); checks++;
assert.equal(typeof complexGeometryLabel(source), "string"); checks++;
function labelIssuesFor(text: string, geometry: ComplexGeometry = source): SceneIssue[] {
  const document = documentFor(); document.entities[0]!.label = text; const issues: SceneIssue[] = [];
  validateEvaluatedComplexLabels(document.constructions[0]!, 0, document, [geometry], issues); return issues;
}
for (const text of ["z", "P1", "P(t)", "mz+b", "w0", "z=3+4i", "z=(3,4)", "3+4i", "Re(z)=3", "Im(z)=4", "|z|=5", "arg(z)=0.9272952180016122 rad", "arg(z)=53.13010235415598 deg", "arg(z)≈53 deg"]) { assert.deepEqual(labelIssuesFor(text), [], text); checks++; }
for (const text of ["Re(z)=999", "Re(z)=13", "Im(z)=-4", "|z|=10", "z=4+3i", "z=3+4i V", "arg(z)=53 rad", "arg(z)≈51 deg", "arg(z)=NaN", "Re(z)=3 N", "slope 999"]) { assert(labelIssuesFor(text).some((issue) => issue.severity === "fatal"), text); checks++; }
assert(labelIssuesFor("arg(z)=0", zero).some((issue) => issue.severity === "fatal")); checks++;
const tiny = evaluate("complex_point", { real: 1e-320, imaginary: 0, displayScale: 1 })[0]!;
assert.deepEqual(labelIssuesFor("Re(z)=1e-320", tiny), []); assert(labelIssuesFor("Re(z)=2e-320", tiny).some((issue) => issue.severity === "fatal")); checks += 2;
for (const name of ["space", "kinematicState", "thermodynamicState", "hydrostaticState", "buoyancyDefinition", "magneticForce", "futurePhysicsMetadata"]) { geometries.set("protected", { kind: "point", point: { x: 0, y: 0 }, [name]: {} }); reject("complex_point", { real: 1, imaginary: 2, origin: "protected", displayScale: 1 }); }
for (const field of ["real", "imaginary", "displayScale"] as const) reject("complex_point", { real: 3, imaginary: 4, displayScale: 1, [field]: { value: 1, unit: "Pa" } });
reject("complex_point", { real: 3, imaginary: 4, displayScale: 1, origin: [{ value: 1, unit: "N" }, 0] });
reject("complex_point", { real: 3, imaginary: 4, displayScale: 1, origin: [true, 0] });
assert.equal(complexGeometryLabel(transformed), "mz+b"); assert.equal(complexGeometryLabel(source, "P1"), "P1"); checks += 2;
geometries.set("irrational_source", evaluate("complex_point", { real: 2, imaginary: 0, displayScale: 1 })[0]!);
const irrationalRoot = evaluate("complex_roots", { source: "irrational_source", degree: 3, displayScale: 1 })[0]!; geometries.set("irrational_root", irrationalRoot);
reject("complex_transform", { source: "irrational_root", multiplier: { real: 1, imaginary: 0 }, addend: { real: -irrationalRoot.complexNumber.real, imaginary: 0 }, displayScale: 1 });
const zeroMultiplied = evaluate("complex_transform", { source: "irrational_root", multiplier: { real: 0, imaginary: 0 }, addend: { real: 3, imaginary: 4 }, displayScale: 1 })[0]!;
assert.equal(zeroMultiplied.complexNumber.accuracy, "binary_exact"); assert.equal(zeroMultiplied.complexNumber.magnitude, 5); checks += 2;
geometries.set("unity", evaluate("complex_point", { real: 1, imaginary: 0, displayScale: 1 })[0]!);
const exactRoot = evaluate("complex_roots", { source: "unity", degree: 4, displayScale: 1 })[1]!; geometries.set("exact_root", exactRoot);
assert.equal(exactRoot.complexNumber.accuracy, "binary_exact"); assert.deepEqual([exactRoot.complexNumber.real, exactRoot.complexNumber.imaginary], [0, 1]); checks += 2;
const exactCancelled = evaluate("complex_transform", { source: "exact_root", multiplier: { real: 1, imaginary: 0 }, addend: { real: 0, imaginary: -1 }, displayScale: 1 })[0]!;
assert.equal(exactCancelled.complexNumber.argument, null); checks++;
const decimalSource = evaluate("complex_point", { real: 0.1, imaginary: 0.2, displayScale: 1 })[0]!; geometries.set("decimal_source", decimalSource);
const decimal = evaluate("complex_transform", { source: "decimal_source", multiplier: { real: 0.3, imaginary: 0.4 }, addend: { real: 0, imaginary: 0 }, displayScale: 1 })[0]!;
close(decimal.complexNumber.real, -0.05, "decimal complex product real"); close(decimal.complexNumber.imaginary, 0.1, "decimal complex product imaginary");
const quarterRotated = evaluate("complex_transform", { source: "source", multiplier: { real: 0, imaginary: 1 }, addend: { real: 0, imaginary: 0 }, displayScale: 1 })[0]!;
close(quarterRotated.complexNumber.real, -4, "quarter rotation real"); close(quarterRotated.complexNumber.imaginary, 3, "quarter rotation imaginary"); close(quarterRotated.complexNumber.magnitude, 5, "unit multiplier preserves modulus");
geometries.set("ordinary_origin", { kind: "point", point: { x: 10, y: -10 } });
assert.deepEqual(evaluate("complex_point", { real: 1, imaginary: 2, displayScale: 2, origin: "ordinary_origin" })[0]!.point, { x: 12, y: -6 }); checks++;
assert.deepEqual(evaluate("complex_point", { real: 1, imaginary: 2, displayScale: 1, origin: "source" })[0]!.point, { x: 14, y: -1 }); checks++;
const negativeAxis = evaluate("complex_point", { real: -1, imaginary: -0, displayScale: 1 })[0]!; assert.equal(negativeAxis.complexNumber.argument, Math.PI); checks++;
reject("complex_point", { real: 1e12, imaginary: Number.MIN_VALUE, displayScale: 1 });
reject("complex_point", { real: 1e12, imaginary: -Number.MIN_VALUE, displayScale: 1 });
reject("complex_point", { real: Number.MIN_VALUE, imaginary: Number.MIN_VALUE, displayScale: 1 });
assert.deepEqual(labelIssuesFor("arg(z)=0", evaluate("complex_point", { real: 3, imaginary: 0, displayScale: 1 })[0]!), []); checks++;
const subnormal = evaluate("complex_point", { real: Number.MIN_VALUE, imaginary: 0, displayScale: 1 })[0]!; geometries.set("subnormal", subnormal);
reject("complex_transform", { source: "subnormal", multiplier: { real: 0.25, imaginary: 0 }, addend: { real: 0, imaginary: 0 }, displayScale: 1 });
reject("complex_point", { real: Number.MIN_VALUE, imaginary: 0, displayScale: 0.25 });
reject("complex_point", { real: 1, imaginary: 0, displayScale: 1e-9, origin: [1e12, 0] });
reject("complex_point", { real: 1e12, imaginary: 1e12, displayScale: 1e-3 });
reject("complex_point", { real: "1e-999", imaginary: 0, displayScale: 1 });
assert(labelIssuesFor("Re(z)=1e-999", zero).some((issue) => issue.severity === "fatal")); checks++;
for (const mutate of [
  (value: ComplexGeometry) => { value.complexNumber.real = 999; },
  (value: ComplexGeometry) => { value.point.x = 999; },
  (value: ComplexGeometry) => { value.complexNumber.exactComponents.real.denominator = "0"; },
  (value: ComplexGeometry) => { value.complexNumber.exactComponents.real.numerator = "03"; },
]) { const tampered = structuredClone(source); mutate(tampered); geometries.set("tampered", tampered); reject("complex_roots", { source: "tampered", degree: 2, displayScale: 1 }); }
const malformedDocuments: SceneDocument[] = [];
function malformed(change: (document: SceneDocument) => void): SceneDocument { const document = documentFor(); change(document); malformedDocuments.push(document); assert(issuesFor(document).some((issue) => issue.severity === "fatal")); checks++; return document; }
malformed((document) => { document.constructions[2]!.outputs[1] = "root0"; });
malformed((document) => { document.entities[0]!.kind = "vector"; });
malformed((document) => { document.constructions[1]!.inputs.source = "root0"; });
malformed((document) => { document.constructions[1]!.inputs.source = "missing"; });
malformed((document) => { document.quantities.push({ id: "a", value: "b", unit: "1" }, { id: "b", value: "a", unit: "1" }); document.constructions[0]!.inputs.real = "a"; });
malformed((document) => { document.quantities.push({ id: "duplicate", value: 3 }, { id: "duplicate", value: 3 }); document.constructions[0]!.inputs.real = "duplicate"; });
malformed((document) => { document.constructions[0]!.inputs.real = { value: { value: 3, unit: "Pa" }, unit: "1" }; });
malformed((document) => { document.constructions[0]!.inputs.real = "1e-999"; });
malformed((document) => { document.quantities.push({ id: "erased_source", value: "1e-999", unit: "1" }); document.constructions[0]!.inputs.imaginary = "erased_source"; });
malformed((document) => { document.constructions[0]!.inputs.origin = [{ value: 7, unit: "m" }, -11]; });
malformed((document) => { document.quantities.push({ id: "physical_scale", value: 1, unit: "N" }); document.constructions[0]!.inputs.displayScale = "physical_scale"; });
malformed((document) => { document.constructions[2]!.inputs.degree = { value: 3, unit: "Hz" }; });
malformed((document) => { document.constructions[1]!.inputs.multiplier = { real: 1, imaginary: 0, phase: 0 }; });
malformed((document) => { document.constructions.push({ id: "duplicate_source", operator: "complex_point", inputs: { real: 3, imaginary: 4, displayScale: 1 }, outputs: ["source"] }); });
for (const kind of ["label", "callout", "badge"]) malformed((document) => { document.annotations.push({ id: "false_numeric", kind, targetIds: ["source"], text: "|z|=999" }); });
malformed((document) => { document.quantities.push({ id: "false_modulus", symbol: "|z|", value: 999, unit: "1" }); document.annotations.push({ id: "false_quantity", kind: "label", targetIds: ["source"], quantityId: "false_modulus" }); });
malformed((document) => { document.quantities.push({ id: "ambiguous_scalar", symbol: "z", value: 3, unit: "1" }); document.annotations.push({ id: "ambiguous_quantity", kind: "label", targetIds: ["source"], quantityId: "ambiguous_scalar" }); });
for (const unit of [5, true, null, { value: "rad" }]) malformed((document) => { document.quantities.push({ id: "malformed_angle_unit", symbol: "arg(z)", value: Math.atan2(4, 3), unit }); document.annotations.push({ id: "malformed_angle", kind: "callout", targetIds: ["source"], quantityId: "malformed_angle_unit" }); });
malformed((document) => { document.constructions[0]!.inputs = { real: 1e12, imaginary: Number.MIN_VALUE, displayScale: 1 }; document.entities[0]!.label = "arg(z)=0"; });
malformed((document) => { document.constructions[0]!.inputs = { real: 1e12, imaginary: Number.MIN_VALUE, displayScale: 1 }; document.quantities.push({ id: "erased_argument", symbol: "arg(z)", value: 0, unit: "rad" }); document.annotations.push({ id: "erased_argument_label", kind: "label", targetIds: ["source"], quantityId: "erased_argument" }); });
malformed((document) => { document.entities.push({ id: "false_label", kind: "label", role: "false claim" }); document.constructions.push({ id: "make_false_label", operator: "label", inputs: { target: "source", text: "Re(z)=999" }, outputs: ["false_label"] }); });
const correctAnnotations = documentFor(); correctAnnotations.quantities.push({ id: "modulus", symbol: "|z|", value: 5, unit: "dimensionless" }, { id: "argument", symbol: "arg(z)", value: 53.13010235415598, unit: "deg" });
correctAnnotations.annotations.push({ id: "modulus_label", kind: "label", targetIds: ["source"], quantityId: "modulus" }, { id: "argument_label", kind: "callout", targetIds: ["source"], quantityId: "argument" }, { id: "cartesian_badge", kind: "badge", targetIds: ["source"], text: "z=3+4i" });
assert.deepEqual(issuesFor(correctAnnotations), []); checks++;
const correctQuantities = documentFor(); correctQuantities.quantities.push({ id: "real_source", value: 3, unit: "1" }, { id: "imag_source", value: { value: 4, unit: "dimensionless" }, unit: "1" });
correctQuantities.constructions[0]!.inputs.real = "real_source"; correctQuantities.constructions[0]!.inputs.imaginary = "imag_source"; correctQuantities.constructions[0]!.inputs.origin = { x: { value: 7, unit: "1" }, y: "-11" };
assert.deepEqual(issuesFor(correctQuantities), []); checks++;
if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler");
  const valid = documentFor(); valid.constructions.reverse(); const compiled = compileSceneDocument(valid); assert.equal(compiled.ok, true, JSON.stringify(compiled.report.issues)); assert(compiled.renderScene); assert(compiled.renderScene.primitives.some((primitive) => primitive.entityId === "root2")); checks++;
  for (const accepted of [correctAnnotations, correctQuantities]) { const result = compileSceneDocument(accepted); assert.equal(result.ok, true, JSON.stringify(result.report.issues)); assert(result.renderScene); checks++; }
  for (const invalid of [wrongArity, wrongUnits, wrongLabel, ...malformedDocuments]) { const result = compileSceneDocument(invalid); assert.equal(result.ok, false); assert.equal(result.renderScene, null, "invalid complex programs reject atomically"); checks++; }
  const normalizedDimension = documentFor();
  normalizedDimension.entities.push({ id: "ordinary_origin", kind: "point", role: "ordinary display origin" }, { id: "false_dimension", kind: "dimension", role: "normalized complex modulus", label: "|z|=10" });
  normalizedDimension.constructions.push({ id: "make_ordinary_origin", operator: "point", inputs: { x: 7, y: -11 }, outputs: ["ordinary_origin"] }, { id: "make_false_dimension", operator: "dimension", inputs: { start: "ordinary_origin", end: "source" }, outputs: ["false_dimension"] });
  normalizedDimension.requiredEntityIds.push("ordinary_origin", "false_dimension"); normalizedDimension.revealGroups[0]!.entityIds.push("ordinary_origin", "false_dimension");
  const dimensionResult = compileSceneDocument(normalizedDimension); assert.equal(dimensionResult.ok, false); assert.equal(dimensionResult.renderScene, null, "displayScale=2 cannot turn source modulus5 into a certified dimension10"); checks++;
  const physicalOrigin = documentFor();
  physicalOrigin.entities.push({ id: "profile", kind: "curve", role: "explicit hydrostatic source" }, { id: "state", kind: "point", role: "physical hydrostatic state" });
  physicalOrigin.constructions.unshift({ id: "make_profile", operator: "hydrostatic_profile", inputs: { surfacePressure: 10, density: 1, gravity: 1, depthMin: 0, depthMax: 2, pressureUnit: "Pa", densityUnit: "kg/m^3", gravityUnit: "m/s^2", depthUnit: "m", origin: [10, 10], depthScale: 1, pressureScale: 0.5, samples: 5 }, outputs: ["profile"] }, { id: "make_state", operator: "hydrostatic_state", inputs: { profile: "profile", depth: 1 }, outputs: ["state"] });
  physicalOrigin.constructions.find((construction) => construction.id === "make_source")!.inputs.origin = "state";
  physicalOrigin.requiredEntityIds.push("profile", "state"); physicalOrigin.revealGroups[0]!.entityIds.push("profile", "state");
  const physicalResult = compileSceneDocument(physicalOrigin); assert.equal(physicalResult.ok, false); assert.equal(physicalResult.renderScene, null); assert(physicalResult.report.issues.some((issue) => issue.message.includes("ordinary planar display point")), JSON.stringify(physicalResult.report.issues)); checks++;
}
assert.deepEqual([...COMPLEX_OPERATORS], ["complex_point", "complex_transform", "complex_roots"]);
console.log(`complex operators verified: ${checks} independent algebra/root and rejection checks`);
