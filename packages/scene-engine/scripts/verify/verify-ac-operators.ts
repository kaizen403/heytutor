import { strict as assert } from "node:assert";
import { acGeometryLabel, evaluateAcConstruction, validateAcDerivedLabel, validateAcConstruction, validateEvaluatedAcLabels, type AcEvaluationContext, type AcGeometry } from "../../src/compile/acGeometry";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, AcGeometry>();
const quantities = new Map<string, number>([["resistance", 3], ["frequency", 10], ["scale", 2]]);
const context: AcEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const result = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
    if (!Number.isFinite(result)) throw new Error("non-numeric source");
    return result;
  },
  point(value) {
    if (Array.isArray(value) && value.length === 2) return { x: Number(value[0]), y: Number(value[1]) };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: Number(value.x), y: Number(value.y) };
    throw new Error("not an inline display point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function close(actual: number, expected: number, message: string, tolerance = 1e-9): void {
  checks++;
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function evaluate(operator: string, inputs: Record<string, unknown>): AcGeometry[] { return evaluateAcConstruction(operator, inputs, context); }
function reject(operator: string, inputs: Record<string, unknown>): void {
  checks++;
  assert.throws(() => evaluate(operator, inputs), undefined, `${operator} must reject ${JSON.stringify(inputs)}`);
}
function component(kind: "resistor" | "inductor" | "capacitor", value: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind, value, unit: kind === "resistor" ? "ohm" : kind === "inductor" ? "H" : "F", frequency: 10, frequencyUnit: "rad/s", displayScale: 2, origin: [7, -3], ...overrides };
}
for (const [kind, value, real, imaginary, phase] of [
  ["resistor", 3, 3, 0, 0], ["inductor", 0.4, 0, 4, Math.PI / 2], ["capacitor", 0.025, 0, -4, -Math.PI / 2],
] as const) {
  const output = evaluate("impedance", component(kind, value));
  assert.equal(output.length, 1);
  const geometry = output[0]!;
  assert.equal(geometry.kind, "path");
  assert.ok(geometry.acImpedance, "impedance must retain physical complex authority");
  close(geometry.acImpedance.components.real, real, "component resistance");
  close(geometry.acImpedance.components.imaginary, imaginary, "component reactance");
  close(geometry.acImpedance.phaseRad!, phase, "component phase direction");
  if (geometry.kind !== "path") throw new Error("nonzero impedance must render a vector");
  assert.equal(geometry.directed, true);
  assert.deepEqual(geometry.points[0], { x: 7, y: -3 });
  assert.deepEqual(geometry.points[1], { x: 7 + 2 * real, y: -3 + 2 * imaginary });
  geometries.set(kind, geometry);
}
const hertz = evaluate("impedance", component("inductor", 0.4, { frequency: 1, frequencyUnit: "Hz" }))[0]!;
close(hertz.acImpedance!.angularFrequency, 2 * Math.PI, "source Hz converts to angular frequency");
close(hertz.acImpedance!.components.imaginary, 0.8 * Math.PI, "Hz source determines inductive reactance");
const zero = evaluate("impedance", component("resistor", 0))[0]!;
assert.equal(zero.kind, "point", "zero impedance is a marker without a fake arrow");
assert.equal(zero.acImpedance?.phaseRad, null);
assert.equal(zero.acImpedance?.zero, true);
for (const form of ["id", "numeric_string", "wrapped"] as const) {
  const value = form === "id" ? "resistance" : form === "numeric_string" ? "3" : { value: "resistance" };
  close(evaluate("impedance", component("resistor", value))[0]!.acImpedance!.components.real, 3, "numeric source reference");
}
for (const [key, value] of [["value", -1], ["value", Infinity], ["frequency", 0], ["frequency", -1], ["frequency", Infinity], ["frequencyUnit", "s"], ["displayScale", 0], ["displayScale", -1], ["displayScale", undefined], ["unit", "H"], ["kind", "voltage_source"], ["origin", [1e13, 0]]] as const) reject("impedance", component("resistor", 3, { [key]: value }));
reject("impedance", component("capacitor", 0));
reject("impedance", component("inductor", 0.4, { angularFrequency: 10 }));
reject("impedance", component("inductor", 1e-200, { frequency: 1e-200, origin: [0, 0] }));
reject("impedance", component("capacitor", 1e-200, { frequency: 1e-200, origin: [0, 0] }));
reject("impedance", component("capacitor", 1e-300, { frequency: 1e-20, origin: [0, 0] }));

for (const [id, sources, mode, real, imaginary] of [
  ["RL", ["resistor", "inductor"], "series", 3, 4],
  ["RC", ["resistor", "capacitor"], "series", 3, -4],
  ["RLC", ["resistor", "inductor", "capacitor"], "series", 3, 0],
  ["parallelRL", ["resistor", "inductor"], "parallel", 1.92, 1.44],
] as const) {
  const output = evaluate("impedance_combine", { sources, mode, displayScale: 1 })[0]!;
  assert.ok(output.acImpedance, "combined source preserves impedance authority");
  close(output.acImpedance.components.real, real, "combined resistance");
  close(output.acImpedance.components.imaginary, imaginary, "combined reactance");
  geometries.set(id, output);
}
geometries.set("resistor6", evaluate("impedance", component("resistor", 6))[0]!);
close(evaluate("impedance_combine", { sources: ["resistor", "resistor6"], mode: "parallel", displayScale: 1 })[0]!.acImpedance!.components.real, 2, "parallel resistors 3 and 6 ohms");
const resonance = evaluate("impedance_combine", { sources: ["inductor", "capacitor"], mode: "series", displayScale: 1 })[0]!;
assert.equal(resonance.kind, "point");
assert.equal(resonance.acImpedance?.zero, true);
geometries.set("resonance", resonance);
geometries.set("wire", zero);
reject("impedance_combine", { sources: ["inductor", "capacitor"], mode: "parallel", displayScale: 1 });
reject("impedance_combine", { sources: ["resistor", "wire"], mode: "parallel", displayScale: 1 });
geometries.set("wrongFrequency", evaluate("impedance", component("resistor", 1, { frequency: 11 }))[0]!);
for (const sources of [[], ["missing"], ["resistor", "resistor"], ["resistor", "wrongFrequency"], Array.from({ length: 33 }, (_, index) => `component${index}`)]) reject("impedance_combine", { sources, mode: "series", displayScale: 1 });

function response(impedance = "RL", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { voltage: { real: 10, imaginary: 0 }, voltageUnit: "V", convention: "rms", impedance, voltageScale: 1, currentScale: 2, ...overrides };
}
for (const [impedance, imaginary, reactivePower] of [["RL", -1.6, 16], ["RC", 1.6, -16]] as const) {
  const [voltage, current] = evaluate("phasor_response", response(impedance));
  assert.ok(voltage?.acPhasor && current?.acPhasor, "response outputs voltage and current physical phasors");
  close(current.acPhasor.components.real, 1.2, "current real component");
  close(current.acPhasor.components.imaginary, imaginary, "current reactive direction");
  close(current.acPhasor.response.realPower, 12, "RMS active power");
  close(current.acPhasor.response.reactivePower, reactivePower, "RMS reactive power sign");
  close(current.acPhasor.response.powerFactor!, 0.6, "load power factor");
  assert.equal(Math.sign(current.acPhasor.phaseRad!), impedance === "RL" ? -1 : 1, "inductive current lags and capacitive current leads");
}
const noVoltage = evaluate("phasor_response", response("RL", { voltage: { real: 0, imaginary: 0 } }));
assert.ok(noVoltage.every((geometry) => geometry.kind === "point" && geometry.acPhasor?.zero), "zero voltage/current render honest markers");
assert.equal(noVoltage[0]!.acPhasor!.response.powerFactor, null, "zero apparent power has no defined power factor");
for (const [voltage, real, imaginary] of [[{ real: 3, imaginary: 4 }, 1, 0], [{ real: -4, imaginary: 3 }, 0, 1]] as const) {
  const result = evaluate("phasor_response", response("RL", { voltage }))[1]!.acPhasor!;
  assert.equal(result.components.real, real, "exact complex numerator cancellation retains its certified zero");
  assert.equal(result.components.imaginary, imaginary, "exact complex numerator cancellation retains its certified zero");
}
reject("phasor_response", response("RL", { voltage: { real: 4 / 3, imaginary: -1 } }));
const reference = geometries.get("RL")!.acImpedance!;
function numericalSource(id: string, real: number, imaginary: number): void {
  const definition = { ...reference, origin: { x: 0, y: 0 }, displayScale: 1, components: { real, imaginary }, magnitude: Math.hypot(real, imaginary), phaseRad: real === 0 && imaginary === 0 ? null : Math.atan2(imaginary, real), zero: real === 0 && imaginary === 0 };
  geometries.set(id, { kind: "path", points: [{ x: 0, y: 0 }, { x: real, y: imaginary }], directed: true, acImpedance: definition });
}
numericalSource("tiny_reactive", 1, 1e-320);
reject("phasor_response", response("tiny_reactive", { voltage: { real: 1e-12, imaginary: 0 }, voltageScale: 1e12, currentScale: 1e12 }));
numericalSource("large_resistive", 1e12, 0);
reject("phasor_response", response("large_resistive", { voltage: { real: 1e12, imaginary: 1e-320 }, voltageScale: 1e-6, currentScale: 1 }));
numericalSource("tiny_resistive", 1e-320, 0);
reject("impedance_combine", { sources: ["tiny_resistive"], mode: "parallel", displayScale: 1 });
const cancellationValues = [1e12, 1e-100, 1e-200, -1e12, -1e-100];
cancellationValues.forEach((value, index) => numericalSource(`cancellation_${index}`, 1, value));
reject("impedance_combine", { sources: cancellationValues.map((_, index) => `cancellation_${index}`), mode: "series", displayScale: 1 });
const exactValues = [1e12, 1e-100, -1e12, -1e-100];
exactValues.forEach((value, index) => numericalSource(`exact_${index}`, 1, value));
assert.equal(evaluate("impedance_combine", { sources: exactValues.map((_, index) => `exact_${index}`), mode: "series", displayScale: 1 })[0]!.acImpedance!.components.imaginary, 0, "exact component cancellation is certified independently of summation order");
reject("phasor_response", response("resonance"));
reject("phasor_response", response("resonance", { voltage: { real: 0, imaginary: 0 } }));
for (const [key, value] of [["convention", "peak"], ["voltageUnit", "A"], ["voltage", { real: 10 }], ["impedance", "missing"], ["currentScale", 0], ["currentScale", undefined]] as const) reject("phasor_response", response("RL", { [key]: value }));

assert.equal(acGeometryLabel(geometries.get("RL")), "|Z|=5 Ω");
validateAcDerivedLabel("Z", geometries.get("RL"));
validateAcDerivedLabel("|Z|=5 Ω", geometries.get("RL"));
assert.throws(() => validateAcDerivedLabel("Z=99 Ω", geometries.get("RL")), "stale independent numerical labels must fail");
function documentFor(): SceneDocument {
  const constructions: SceneConstruction[] = [
    { id: "construct_r", operator: "impedance", inputs: component("resistor", 3), outputs: ["R"] },
    { id: "construct_l", operator: "impedance", inputs: component("inductor", 0.4), outputs: ["L"] },
    { id: "construct_total", operator: "impedance_combine", inputs: { sources: ["R", "L"], mode: "series", displayScale: 1 }, outputs: ["Z"] },
    { id: "construct_response", operator: "phasor_response", inputs: response("Z"), outputs: ["V", "I"] },
  ];
  const ids = constructions.flatMap((construction) => construction.outputs);
  return { schemaVersion: "scene-document/v2", source: { question: "Derive the explicit AC impedances and RMS phasor response." }, visualDecision: { mode: "scene", reason: "source-grounded complex plane" },
    quantities: [], entities: ids.map((id) => ({ id, kind: "vector", role: "computed complex quantity" })), constructions,
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show complex values" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show verified AC response" }],
  };
}
function issuesFor(scene: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const map = new Map(scene.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  scene.constructions.forEach((construction, index) => validateAcConstruction(construction, index, scene, map, issues));
  return issues;
}
function rejectDocument(scene: SceneDocument, code: string): void {
  const issues = issuesFor(scene);
  checks++;
  assert.ok(issues.some((issue) => issue.code === code && issue.severity === "fatal"), `document must reject with ${code}: ${JSON.stringify(issues)}`);
}
assert.deepEqual(issuesFor(documentFor()), []);
const wrongLabel = documentFor();
wrongLabel.entities.find((entity) => entity.id === "Z")!.label = "Z=99 Ω";
rejectDocument(wrongLabel, "invalid_impedance_combine_label");
const underflowSource = documentFor();
underflowSource.constructions[0]!.inputs.frequency = 1e-200;
Object.assign(underflowSource.constructions[1]!.inputs, { frequency: 1e-200, value: 1e-200, origin: [0, 0] });
rejectDocument(underflowSource, "invalid_impedance_reactance");
const roundedNumerator = documentFor(); roundedNumerator.constructions[3]!.inputs.voltage = { real: 4 / 3, imaginary: -1 };
rejectDocument(roundedNumerator, "invalid_phasor_response_impedance");
for (const unit of ["ohm", "H"]) {
  const scene = documentFor();
  scene.quantities = [{ id: "source_r", value: 3, unit }];
  scene.constructions[0]!.inputs.value = "source_r";
  if (unit === "ohm") assert.deepEqual(issuesFor(scene), []);
  else rejectDocument(scene, "invalid_impedance_units");
}
for (const unit of ["", null, 42]) {
  const scene = documentFor(); scene.quantities = [{ id: "source_r", value: 3, unit }]; scene.constructions[0]!.inputs.value = "source_r";
  rejectDocument(scene, "invalid_impedance_units");
}
const hourInductance = documentFor(); hourInductance.quantities = [{ id: "hours", value: 0.4, unit: "h" }]; hourInductance.constructions[1]!.inputs.value = "hours";
rejectDocument(hourInductance, "invalid_impedance_units");
reject("impedance", component("inductor", 0.4, { unit: "h" }));
close(evaluate("impedance", component("inductor", 0.4, { unit: "Henry" }))[0]!.acImpedance!.components.imaginary, 4, "case-folded henry name aliases retain canonical SI inductance");
for (const [value, unit, valid] of [[5, "ohm", true], [99, "ohm", false], [5, "V", false]] as const) {
  const scene = documentFor();
  scene.quantities = [{ id: "computed_magnitude", value, unit }];
  scene.annotations.push({ id: "magnitude", kind: "label", targetIds: ["Z"], quantityId: "computed_magnitude" });
  if (valid) assert.deepEqual(issuesFor(scene), []);
  else rejectDocument(scene, "invalid_impedance_combine_label");
}
const separateLabel = documentFor();
separateLabel.entities.push({ id: "stale_label", kind: "label", role: "stale claim", label: "Z=99 Ω" });
separateLabel.constructions.push({ id: "construct_stale_label", operator: "label", inputs: { target: "Z", text: "Z=99 Ω" }, outputs: ["stale_label"] });
rejectDocument(separateLabel, "invalid_impedance_combine_label");
const runtimeLabelIssues: SceneIssue[] = [];
validateEvaluatedAcLabels(wrongLabel.constructions[2]!, 2, wrongLabel, [geometries.get("RL")], runtimeLabelIssues);
assert.ok(runtimeLabelIssues.some((issue) => issue.severity === "fatal"), "compiled label guard must reject stale labels independently");

for (const angle of [0, 37, -128]) {
  const theta = angle * Math.PI / 180;
  const real = 10 * Math.cos(theta); const imaginary = 10 * Math.sin(theta);
  for (const scale of [0.1, 1, 100]) {
    for (const origin of [[0, 0], [19, -31]]) {
      const [voltage, current] = evaluate("phasor_response", response("RL", { voltage: { real, imaginary }, voltageScale: scale, currentScale: 2 * scale, origin }));
      const physical = current!.acPhasor!;
      close(physical.components.real, 1.2 * Math.cos(theta) + 1.6 * Math.sin(theta), "rotated current real");
      close(physical.components.imaginary, 1.2 * Math.sin(theta) - 1.6 * Math.cos(theta), "rotated current imaginary");
      close(physical.magnitude, 2, "current magnitude independent of phase and display scale");
      // Independently verify Kirchhoff's source relation V=ZI.
      close(3 * physical.components.real - 4 * physical.components.imaginary, real, "complex voltage law real");
      close(4 * physical.components.real + 3 * physical.components.imaginary, imaginary, "complex voltage law imaginary");
      close(real * physical.components.real + imaginary * physical.components.imaginary, 12, "independent V-conjugate-I active power");
      close(imaginary * physical.components.real - real * physical.components.imaginary, 16, "independent V-conjugate-I reactive power");
      close(physical.response.realPower, 12, "rotation-invariant active power");
      close(physical.response.reactivePower, 16, "rotation-invariant reactive power");
      assert.ok(acGeometryLabel(voltage)!.length <= 16 && acGeometryLabel(current)!.length <= 16, "derived phasor labels remain compact");
    }
  }
}
geometries.set("hz_resistor", evaluate("impedance", component("resistor", 3, { frequency: 1, frequencyUnit: "Hz" }))[0]!);
geometries.set("rad_resistor", evaluate("impedance", component("resistor", 6, { frequency: 2 * Math.PI, frequencyUnit: "rad/s" }))[0]!);
close(evaluate("impedance_combine", { sources: ["hz_resistor", "rad_resistor"], mode: "parallel", displayScale: 1 })[0]!.acImpedance!.components.real, 2, "equivalent Hz/rad frequency source identities");
for (const inputs of [component("resistor", { value: 3, unit: "H" }), component("inductor", 0.4, { frequency: { value: 10, unit: "Hz" } }), component("capacitor", 1e-300), component("inductor", 1e12, { frequency: 1e12 }), component("resistor", 3, { displayScale: 1e12 }), component("resistor", 3, { origin: [1e12, 0], displayScale: 1e-5 })]) reject("impedance", inputs);
for (const [index, code] of [[0, "invalid_impedance_outputs"], [3, "invalid_phasor_response_outputs"]] as const) {
  const scene = documentFor(); scene.constructions[index]!.outputs.pop(); rejectDocument(scene, code);
}
const wrongEntity = documentFor(); wrongEntity.entities[0]!.kind = "point"; rejectDocument(wrongEntity, "invalid_impedance_output_kind");
const conflictingCallout = documentFor(); conflictingCallout.annotations.push({ id: "callout", kind: "callout", targetIds: ["I"], text: "I=999 A" }); rejectDocument(conflictingCallout, "invalid_phasor_response_label");
const inventedZeroCurrent = documentFor();
inventedZeroCurrent.constructions[3]!.inputs.voltage = { real: 0, imaginary: 0 };
inventedZeroCurrent.quantities = [{ id: "invented_current", value: 1e-15, unit: "A" }];
inventedZeroCurrent.annotations.push({ id: "invented_zero_label", kind: "label", targetIds: ["I"], quantityId: "invented_current" });
rejectDocument(inventedZeroCurrent, "invalid_phasor_response_label");
const cycle = documentFor(); cycle.quantities = [{ id: "cycleA", value: "cycleB" }, { id: "cycleB", value: "cycleA" }]; cycle.constructions[0]!.inputs.value = "cycleA"; rejectDocument(cycle, "invalid_impedance_quantity");

if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler");
  const { validateSceneDocument } = await import("../../src/document/validation");
  function compiled(scene: SceneDocument) {
    const validated = validateSceneDocument(scene);
    assert.ok(validated.document, `AC document validation failed: ${JSON.stringify(validated.report.issues)}`);
    const result = compileSceneDocument(validated.document);
    assert.ok(result.ok && result.renderScene, `AC compile failed: ${JSON.stringify(result.report.issues)}`);
    assert.ok(result.renderScene.primitives.every((primitive) => primitive.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))), "all AC display points must be finite");
    checks++;
    return result.renderScene.primitives;
  }
  const scene = documentFor(); scene.constructions.reverse();
  const primitives = compiled(scene);
  for (const [id, label] of [["Z", "|Z|=5 Ω"], ["V", "|V|=10 V"], ["I", "|I|=2 A"]]) {
    assert.ok(primitives.some((primitive) => primitive.entityId === id && primitive.kind === "vector"), "derived AC entity must render a vector");
    assert.ok(primitives.some((primitive) => primitive.entityId === id && primitive.text === label), `derived ${id} label is engine-owned`);
  }
  const zeroScene = documentFor(); zeroScene.constructions[3]!.inputs.voltage = { real: 0, imaginary: 0 };
  const zeroPrimitives = compiled(zeroScene);
  assert.ok(zeroPrimitives.some((primitive) => ["V", "I"].includes(primitive.entityId) && primitive.kind === "point"), "coincident zero phasors share an honest marker");
  for (const [id, label] of [["V", "|V|=0 V"], ["I", "|I|=0 A"]]) {
    assert.ok(!zeroPrimitives.some((primitive) => primitive.entityId === id && primitive.kind === "vector"), "a zero phasor has no fake direction");
    assert.ok(zeroPrimitives.some((primitive) => primitive.entityId === id && primitive.text === label), "each coincident zero phasor retains its derived identity");
  }
  for (const invalid of [wrongLabel, conflictingCallout, separateLabel, wrongEntity, underflowSource, roundedNumerator, hourInductance]) {
    const result = compileSceneDocument(invalid);
    assert.equal(result.ok, false, "invalid AC candidate must fail live compilation");
    assert.equal(result.renderScene, null, "invalid AC candidate cannot partially render");
    checks++;
  }
  const singular = documentFor(); singular.constructions[0]!.inputs.value = 0; singular.constructions[1]!.inputs.value = 0;
  const result = compileSceneDocument(singular);
  assert.equal(result.ok, false, "zero source impedance cannot produce an arbitrary response"); assert.equal(result.renderScene, null);
  checks++;
}

console.log(`AC operators verified: ${checks} independent complex-math and rejection checks`);
