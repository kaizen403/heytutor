import { strict as assert } from "node:assert";
import { evaluateThermodynamicsConstruction, thermodynamicsGeometryLabel, validateThermodynamicsConstruction, validateEvaluatedThermodynamicsLabels, type ThermodynamicsEvaluationContext, type ThermodynamicsGeometry } from "../../src/compile/thermodynamicsGeometry";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";
const geometries = new Map<string, ThermodynamicsGeometry>();
const quantities = new Map<string, number>([["pressure", 100], ["start", 1], ["end", 2], ["n", 1]]);
const context: ThermodynamicsEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const result = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
    if (!Number.isFinite(result)) throw new Error("non-numeric source"); return result;
  },
  point(value) {
    if (Array.isArray(value) && value.length === 2) return { x: Number(value[0]), y: Number(value[1]) };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: Number(value.x), y: Number(value.y) };
    throw new Error("not an inline display point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function close(actual: number, expected: number, message: string, tolerance = 1e-9): void { checks++; assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`); }
function evaluate(operator: string, inputs: Record<string, unknown>): ThermodynamicsGeometry[] { return evaluateThermodynamicsConstruction(operator, inputs, context); }
function reject(operator: string, inputs: Record<string, unknown>): void { checks++; assert.throws(() => evaluate(operator, inputs)); }
function polytropic(exponent: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> { return { pressureStart: 100, volumeStart: 1, volumeEnd: 2, exponent, pressureUnit: "Pa", volumeUnit: "m^3", pressureScale: 0.02, volumeScale: 3, samples: 9, ...overrides }; }
for (const [exponent, endPressure, work] of [[0, 100, 100], [1, 50, 69.31471805599453], [1.4, 37.89291416275995, 60.53542918620025], [-1, 200, 150]]) {
  const output = evaluate("polytropic_process", polytropic(exponent))[0]!;
  assert.equal(output.kind, "path"); if (output.kind !== "path") throw new Error("physical PV process must be a path");
  close(output.physicalProcess.pressureEndSI, endPressure!, "independent final pressure"); close(output.physicalProcess.workJ, work!, "independent work integral");
  assert.equal(output.points.length, 9); assert.deepEqual(output.points[0], { x: 3, y: 2 });
  close(output.points[8]!.x, 6, "end-volume display"); close(output.points[8]!.y, endPressure! * 0.02, "end-pressure display");
  output.points.forEach((point, index) => close((point.y / 0.02) * (1 + index / 8) ** exponent!, 100, "every sample obeys explicit PV-power law", 1e-8));
  const reverse = evaluate("polytropic_process", polytropic(exponent, { pressureStart: endPressure, volumeStart: 2, volumeEnd: 1 }))[0]!;
  if (reverse.kind !== "path") throw new Error("compression must remain a path"); close(reverse.physicalProcess.workJ, -work!, "compression reverses work sign");
  assert.ok(reverse.points[0]!.x > reverse.points.at(-1)!.x, "compression preserves start-to-end direction"); geometries.set(`n${exponent}`, output);
}
for (const exponent of [1 - 1e-10, 1 + 1e-10, 1 - 1e-12, 1 + 1e-12]) {
  const output = evaluate("polytropic_process", polytropic(exponent))[0]!; if (output.kind !== "path") throw new Error("near-isothermal process must remain a path");
  close(output.physicalProcess.workJ, 69.31471805599453, "stable continuous work near n=1", 1e-10);
}
const mixedUnits = evaluate("polytropic_process", polytropic(1, { pressureUnit: "kPa", volumeUnit: "L" }))[0]!;
if (mixedUnits.kind !== "path") throw new Error("mixed pressure/volume units need SI authority");
close(mixedUnits.physicalProcess.pressureStartSI, 100000, "kPa to Pa"); close(mixedUnits.physicalProcess.volumeStartSI, 0.001, "L to cubic meters"); close(mixedUnits.physicalProcess.workJ, 69.31471805599453, "kPa-liter work to J");
const isochoric = evaluate("isochoric_process", { volume: 2, pressureStart: 1, pressureEnd: 3, pressureUnit: "bar", volumeUnit: "L", volumeScale: 3, pressureScale: 2, samples: 5 })[0]!;
assert.equal(isochoric.kind, "path"); if (isochoric.kind !== "path") throw new Error("isochoric process must be a vertical path");
assert.equal(isochoric.physicalProcess.workJ, 0); assert.ok(isochoric.points.every((point) => point.x === 6), "isochoric volume stays fixed"); close(isochoric.physicalProcess.pressureEndSI, 300000, "bar to Pa");
assert.deepEqual(isochoric.sampledCurve.derivative(0.5), { x: 0, y: 4 }, "constant volume is exactly the zero derivative axis"); checks++;
const isobaric = geometries.get("n0")!; if (isobaric.kind !== "path") throw new Error("isobaric source must be a path");
assert.deepEqual(isobaric.sampledCurve.derivative(0.5), { x: 3, y: 0 }, "constant pressure is exactly the zero derivative axis"); checks++;
for (const [key, value] of [["pressureStart", 0], ["pressureStart", -1], ["volumeStart", 0], ["volumeEnd", 1], ["volumeEnd", Infinity], ["exponent", undefined], ["exponent", Infinity], ["pressureScale", 0], ["volumeScale", undefined], ["samples", 2], ["samples", 514], ["pressureUnit", "atm"], ["volumeUnit", "g"], ["origin", "projectedPoint"]] as const) reject("polytropic_process", polytropic(1, { [key]: value }));
reject("polytropic_process", polytropic(1, { gamma: 1.4 }));
for (const at of [0, 0.33, 0.5, 1]) {
  const state = evaluate("process_state", { process: "n1", at })[0]!;
  assert.equal(state.kind, "point"); if (state.kind !== "point") throw new Error("PV state must be a point");
  close(state.thermodynamicState.volumeSI, 1 + at, "exact state volume"); close(state.thermodynamicState.pressureSI, 100 / (1 + at), "exact state pressure");
  assert.deepEqual(state.calculusAnchor, { curveId: "n1", parameter: at }, "state retains exact analytic parameter identity");
  const process = geometries.get("n1")!; if (process.kind !== "path") throw new Error("PV source must retain its curve");
  assert.deepEqual(process.sampledCurve.evaluate(at), state.point, "state uses exact callback, never a display chord");
  close(process.sampledCurve.derivative(at).x, 3, "analytic PV horizontal derivative"); close(process.sampledCurve.derivative(at).y, -2 / (1 + at) ** 2, "analytic PV vertical derivative");
}
for (const at of [-1, 1.1, NaN, undefined]) reject("process_state", { process: "n1", at });
reject("polytropic_process", polytropic(1, { pressureStart: 1, volumeStart: 1e-200, volumeEnd: 2e-200, pressureScale: 1, volumeScale: 1e-200 }));
reject("polytropic_process", polytropic(1, { origin: [1e12, 0], volumeScale: 0.0001 }));
reject("polytropic_process", polytropic(1e-300));
reject("polytropic_process", polytropic(1, { pressureStart: 100, volumeStart: 1e-100, volumeEnd: 1.000000000001e-100, pressureScale: 1e9, volumeScale: 1e-220 }));
reject("polytropic_process", polytropic(1, { pressureStart: 1e-200, pressureScale: 1e-200 }));
reject("isochoric_process", { volume: 1e-200, pressureStart: 1, pressureEnd: 2, pressureUnit: "Pa", volumeUnit: "m^3", volumeScale: 1e-200, pressureScale: 1 });
assert.equal(thermodynamicsGeometryLabel(geometries.get("n1")), "P=P0(V0/V)^1", "default process label must preserve the supplied law instead of revealing computed work");
assert.equal(thermodynamicsGeometryLabel(geometries.get("n1"), "W"), "W=69.3 J", "explicit work requests retain independently computed work");
assert.equal(thermodynamicsGeometryLabel(isochoric), "V=constant", "isochoric label describes the given source process");
assert.equal(thermodynamicsGeometryLabel(isochoric, "W"), "W=0 J", "explicit zero work remains a computed result");
const longEquation = evaluate("polytropic_process", polytropic(1.23456789))[0]!; assert.equal(thermodynamicsGeometryLabel(longEquation), "PV", "long source equations use a compact process identifier");
function documentFor(): SceneDocument {
  const constructions: SceneConstruction[] = [
    { id: "construct_process", operator: "polytropic_process", inputs: polytropic(1, { pressureUnit: "kPa", volumeUnit: "L" }), outputs: ["process"] },
    { id: "construct_state", operator: "process_state", inputs: { process: "process", at: 0.5 }, outputs: ["state"] },
  ];
  return { schemaVersion: "scene-document/v2", source: { question: "Derive the explicit pressure-volume process and state." }, visualDecision: { mode: "scene", reason: "verified physical PV law" },
    quantities: [], entities: [{ id: "process", kind: "polyline", role: "computed PV process" }, { id: "state", kind: "point", role: "computed PV state" }], constructions,
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["process", "state"], revealGroups: [{ id: "setup", entityIds: ["process", "state"], dependsOn: [], narrationCue: "show PV process" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show verified pressure-volume behavior" }],
  };
}
function issuesFor(scene: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = []; const map = new Map(scene.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  scene.constructions.forEach((construction, index) => validateThermodynamicsConstruction(construction, index, scene, map, issues)); return issues;
}
function rejectDocument(scene: SceneDocument, code: string): void { checks++; const issues = issuesFor(scene); assert.ok(issues.some((issue) => issue.code === code && issue.severity === "fatal"), `expected ${code}: ${JSON.stringify(issues)}`); }
assert.deepEqual(issuesFor(documentFor()), []);
const wrongLabel = documentFor(); wrongLabel.entities[0]!.label = "W=999 J"; rejectDocument(wrongLabel, "invalid_polytropic_process_label");
for (const label of ["W", "W=69.3 J", "W=69.31471805599453 J", "W=0.06931471805599453 kJ", "P=P0(V0/V)^1", "PV"]) { const scene = documentFor(); scene.entities[0]!.label = label; assert.deepEqual(issuesFor(scene), [], `verified process or explicitly requested work label must validate: ${label}`); checks++; }
for (const label of ["W=69.3 kJ", "W=69.31471805599453 Pa", "W=-69.31471805599453 J", "P=P0(V0/V)^2"]) { const scene = documentFor(); scene.entities[0]!.label = label; rejectDocument(scene, "invalid_polytropic_process_label"); }
for (const [target, value, unit, valid] of [["process", 69.31471805599453, "J", true], ["process", 0.06931471805599453, "kJ", true], ["state", 100000 / 1.5, "Pa", true], ["state", 0.0015, "m^3", true], ["state", 15, "kPa", false], ["process", 69.31471805599453, "Pa", false]] as const) {
  const scene = documentFor(); scene.quantities = [{ id: "derived_value", value, unit }]; scene.annotations.push({ id: "computed_label", kind: "label", targetIds: [target], quantityId: "derived_value" });
  if (valid) assert.deepEqual(issuesFor(scene), []); else rejectDocument(scene, target === "state" ? "invalid_process_state_label" : "invalid_polytropic_process_label");
}
const mismatchedUnits = documentFor(); mismatchedUnits.quantities = [{ id: "pressure_pa", value: 100000, unit: "Pa" }]; mismatchedUnits.constructions[0]!.inputs.pressureStart = "pressure_pa"; rejectDocument(mismatchedUnits, "invalid_polytropic_process_units");
const runtimeLabelIssues: SceneIssue[] = []; validateEvaluatedThermodynamicsLabels(wrongLabel.constructions[0]!, 0, wrongLabel, [geometries.get("n1")], runtimeLabelIssues); assert.ok(runtimeLabelIssues.some((issue) => issue.severity === "fatal"));
// Simpson integration is an independent oracle for the closed-form work law.
for (const exponent of [-1, 0, 0.7, 1, 1 + 1e-8, 1.4, 3]) {
  const output = evaluate("polytropic_process", polytropic(exponent))[0]!; if (output.kind !== "path") throw new Error("PV process must retain physical authority");
  const steps = 1000; let integral = 0;
  for (let index = 0; index <= steps; index++) { const volume = 1 + index / steps; const weight = index === 0 || index === steps ? 1 : index % 2 === 0 ? 2 : 4; integral += weight * 100 * volume ** (-exponent); }
  close(output.physicalProcess.workJ, integral / (3 * steps), "independent numerical work integral", 1e-10);
}
for (const pressureScale of [0.001, 0.02, 2]) for (const volumeScale of [0.1, 3, 30]) for (const origin of [[0, 0], [19, -31]]) {
  const output = evaluate("polytropic_process", polytropic(1, { pressureScale, volumeScale, origin }))[0]!; if (output.kind !== "path") throw new Error("PV process must remain a path");
  close(output.physicalProcess.workJ, 69.31471805599453, "work independent of display scales and translation");
  output.points.forEach((point, index) => { close(point.x - origin[0]!, (1 + index / 8) * volumeScale, "translated volume display"); close((point.y - origin[1]!) / pressureScale * (1 + index / 8), 100, "translated PV-law identity", 1e-8); });
}
for (const inputs of [polytropic(1, { pressureStart: { value: "pressure", unit: "Pa" }, volumeStart: "start", volumeEnd: { value: "end" } }), polytropic({ value: "n" })]) evaluate("polytropic_process", inputs);
for (const inputs of [polytropic(1, { pressureStart: { value: 100, unit: "kPa" } }), polytropic(1, { volumeEnd: { value: 2, unit: "L" } }), polytropic(65), polytropic(-64, { volumeEnd: 1e6 }), polytropic(1, { origin: [1e12, 0], volumeScale: 1e-5 }), polytropic(0, { pressureStart: 1e12, volumeStart: 10000, volumeEnd: 20000, pressureScale: 1e-6, volumeScale: 0.001 })]) reject("polytropic_process", inputs);
for (const [index, code] of [[0, "invalid_polytropic_process_outputs"], [1, "invalid_process_state_outputs"]] as const) { const scene = documentFor(); scene.constructions[index]!.outputs.pop(); rejectDocument(scene, code); }
const wrongKind = documentFor(); wrongKind.entities[0]!.kind = "point"; rejectDocument(wrongKind, "invalid_polytropic_process_output_kind");
const forbiddenHeat = documentFor(); forbiddenHeat.annotations.push({ id: "heat", kind: "callout", targetIds: ["process"], text: "Q=0 J" }); rejectDocument(forbiddenHeat, "invalid_polytropic_process_label");
const cyclicQuantity = documentFor(); cyclicQuantity.quantities = [{ id: "cycleA", value: "cycleB" }, { id: "cycleB", value: "cycleA" }]; cyclicQuantity.constructions[0]!.inputs.pressureStart = "cycleA"; rejectDocument(cyclicQuantity, "invalid_polytropic_process_quantity");
if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler"); const { validateSceneDocument } = await import("../../src/document/validation");
  function compiled(scene: SceneDocument) {
    const validated = validateSceneDocument(scene); assert.ok(validated.document, `PV validation failed: ${JSON.stringify(validated.report.issues)}`);
    const result = compileSceneDocument(validated.document); assert.ok(result.ok && result.renderScene, `PV compile failed: ${JSON.stringify(result.report.issues)}`);
    assert.ok(result.renderScene.primitives.every((primitive) => primitive.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))), "all PV display coordinates must remain finite"); checks++; return result.renderScene.primitives;
  }
  for (const at of [0, 0.33, 0.5, 1]) {
    const scene = documentFor(); scene.constructions[1]!.inputs.at = at; scene.constructions.reverse();
    scene.assertions.push({ id: "exact_state_incidence", predicate: "incident", entities: ["state", "process"], tolerance: 1e-8, severity: "fatal" });
    const primitives = compiled(scene); assert.ok(primitives.some((primitive) => primitive.entityId === "state" && primitive.kind === "point"), "exact state must render a point");
    assert.ok(primitives.some((primitive) => primitive.entityId === "process" && primitive.text === "P=P0(V0/V)^1"), "initial process label describes its supplied law");
    assert.ok(!primitives.some((primitive) => primitive.text?.startsWith("W=")), "unrequested computed work must not be exposed by the initial process label");
  }
  const vertical = documentFor(); vertical.constructions[0]!.operator = "isochoric_process";
  vertical.constructions[0]!.inputs = { volume: 2, pressureStart: 1, pressureEnd: 3, pressureUnit: "bar", volumeUnit: "L", volumeScale: 3, pressureScale: 2, samples: 5 };
  vertical.assertions.push({ id: "isochoric_state_incidence", predicate: "incident", entities: ["state", "process"], tolerance: 1e-8, severity: "fatal" });
  assert.ok(compiled(vertical).some((primitive) => primitive.entityId === "process" && primitive.text === "V=constant"));
  const horizontal = documentFor(); horizontal.constructions[0]!.inputs = polytropic(0, { pressureUnit: "kPa", volumeUnit: "L" });
  assert.ok(compiled(horizontal).some((primitive) => primitive.entityId === "process" && primitive.text === "P=P0(V0/V)^0"), "valid constant-pressure source path remains horizontal");
  const requestedWork = documentFor(); requestedWork.entities[0]!.label = "W";
  assert.ok(compiled(requestedWork).some((primitive) => primitive.entityId === "process" && primitive.text === "W=69.3 J"), "explicit requested work is computed by the engine");
  const workAnnotation = documentFor(); workAnnotation.quantities.push({ id: "source_work", value: 69.31471805599453, unit: "J" }); workAnnotation.annotations.push({ id: "requested_work", kind: "label", targetIds: ["process"], text: "W", quantityId: "source_work" });
  assert.ok(compiled(workAnnotation).some((primitive) => primitive.text?.startsWith("W")), "explicit exact work annotation may expose the computed result");
  const underflow = documentFor(); underflow.constructions[0]!.inputs = polytropic(1, { pressureStart: 1, volumeStart: 1e-200, volumeEnd: 2e-200, pressureScale: 1, volumeScale: 1e-200 });
  const collapsed = documentFor(); collapsed.constructions[0]!.inputs = polytropic(1, { pressureStart: 100, volumeStart: 1e-100, volumeEnd: 1.000000000001e-100, pressureScale: 1e9, volumeScale: 1e-220 });
  for (const invalid of [underflow, collapsed]) { const result = compileSceneDocument(invalid); assert.equal(result.ok, false, "per-axis physical display collapse must reject live compile"); assert.equal(result.renderScene, null, "collapsed PV axes must not partially render"); checks++; }
  for (const invalid of [wrongLabel, mismatchedUnits, wrongKind, forbiddenHeat]) { const result = compileSceneDocument(invalid); assert.equal(result.ok, false, "invalid PV candidate must fail live compile"); assert.equal(result.renderScene, null, "invalid PV candidate cannot partially render"); checks++; }
  const separateLabel = documentFor(); separateLabel.entities.push({ id: "stale_label", kind: "label", role: "stale work claim", label: "W=999 J" }); separateLabel.constructions.push({ id: "construct_stale_label", operator: "label", inputs: { target: "process", text: "W=999 J" }, outputs: ["stale_label"] });
  const invalidLabel = compileSceneDocument(separateLabel); assert.equal(invalidLabel.ok, false); assert.equal(invalidLabel.renderScene, null); checks++;
}
console.log(`thermodynamics operators verified: ${checks} independent PV-law/work and rejection checks`);
