import assert from "node:assert/strict";
import { evaluateChapterInstrumentConstruction } from "../../src/compile/chapterInstrumentGeometry";
import { validationNumber, type SourceContext } from "../../src/compile/sourceScalars";
import type { SceneDocument } from "../../src/types";

const compiled = process.argv.includes("--compiled-boundary");
const engine = compiled ? await import("../../dist/index.js") : await import("../../src/index");
type Operator = SceneDocument["constructions"][number]["operator"];
type Outputs = Array<[string, SceneDocument["entities"][number]["kind"]]>;
type Case = {
  name: string; operator: Operator; outputs: Outputs;
  inputs: Record<string, unknown>; sourceInputs: Record<string, unknown>;
  quantities: SceneDocument["quantities"];
};
let passed = 0;
const failures: Array<{ name: string; error: string }> = [];
function test(name: string, run: () => void): void {
  try { run(); passed++; }
  catch (error) { failures.push({ name, error: error instanceof Error ? error.message : String(error) }); }
}
function document(item: Case, sourced = false): SceneDocument {
  const ids = item.outputs.map(([id]) => id);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-declared instrument units" },
    source: {}, quantities: sourced ? structuredClone(item.quantities) : [],
    entities: item.outputs.map(([id, kind]) => ({ id, kind, role: id })),
    constructions: [{ id: "make", operator: item.operator, inputs: structuredClone(sourced ? item.sourceInputs : item.inputs), outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "instrument", entityIds: ids, dependsOn: [], narrationCue: "instrument" }], teachingTimeline: [],
  };
}
function context(doc: SceneDocument): SourceContext {
  return { number: (value) => validationNumber(value, doc), point: () => { throw new Error("unresolved point"); }, geometry: () => undefined };
}
function evaluate(doc: SceneDocument) {
  const construction = doc.constructions[0]!;
  return evaluateChapterInstrumentConstruction(construction.operator, construction.inputs, context(doc), doc);
}
function accepted(doc: SceneDocument) {
  const result = engine.compileSceneDocument(doc);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  return result.renderScene;
}
function declined(doc: SceneDocument): void {
  const result = engine.compileSceneDocument(doc);
  assert.equal(result.ok, false, "invalid source declaration must be declined");
  assert.equal(result.renderScene, null, "invalid declaration must not emit a partial scene");
}
const cases: Case[] = [
  {
    name: "metre bridge", operator: "metre_bridge", outputs: [["wire", "segment"], ["jockey", "point"], ["known", "segment"], ["unknown", "segment"]],
    inputs: { knownResistance: 6000, unknownResistance: 9000, wireLength: 100, balanceFromLeft: 40, origin: [0, 0], displayLength: 3, units: { resistance: "ohm", length: "cm" } },
    sourceInputs: { knownResistance: "R", unknownResistance: "X", wireLength: "L", balanceFromLeft: "l", origin: [0, 0], displayLength: 3, units: { resistance: "ohm", length: "cm" } },
    quantities: [{ id: "R", value: 6, unit: "kΩ" }, { id: "X", value: 9, unit: "kohm" }, { id: "L", value: 1, unit: "m" }, { id: "l", value: 400, unit: "mm" }],
  },
  {
    name: "potentiometer", operator: "potentiometer", outputs: [["wire", "segment"], ["balance", "point"]],
    inputs: { driverEmf: 2, cellEmf: 1, wireLength: 100, balanceLength: 50, origin: [0, 0], displayLength: 3, units: { emf: "V", length: "cm" } },
    sourceInputs: { driverEmf: "E", cellEmf: "e", wireLength: "L", balanceLength: "l", origin: [0, 0], displayLength: 3, units: { emf: "V", length: "cm" } },
    quantities: [{ id: "E", value: 2000, unit: "mV" }, { id: "e", value: 1, unit: "volt" }, { id: "L", value: 1, unit: "m" }, { id: "l", value: 500, unit: "mm" }],
  },
  {
    name: "incline", operator: "incline_friction", outputs: [["incline", "segment"], ["body", "point"], ["weight", "vector"], ["normal", "vector"], ["friction", "vector"], ["acceleration", "vector"]],
    inputs: { mass: 2, gravity: 9.8, angleDeg: 30, mu: 1, motion: "rest", origin: [0, 0], displayScale: 2, forceScale: 0.1, accelScale: 0.2, units: { mass: "kg", gravity: "m/s^2" } },
    sourceInputs: { mass: "m", gravity: "g", angleDeg: 30, mu: 1, motion: "rest", origin: [0, 0], displayScale: 2, forceScale: 0.1, accelScale: 0.2, units: { mass: "kg", gravity: "m/s^2" } },
    quantities: [{ id: "m", value: 2000, unit: "g" }, { id: "g", value: 980, unit: "cm/s²" }],
  },
  {
    name: "cyclotron", operator: "cyclotron", outputs: [["orbit", "circle"], ["dee1", "curve"], ["dee2", "curve"], ["velocity", "vector"], ["field", "curve"]],
    inputs: { charge: 0.002, mass: 0.004, field: 0.5, speed: 50, origin: [0, 0], displayScale: 1, units: { charge: "C", mass: "kg", field: "T", speed: "m/s" } },
    sourceInputs: { charge: "q", mass: "m", field: "B", speed: "v", origin: [0, 0], displayScale: 1, units: { charge: "C", mass: "kg", field: "T", speed: "m/s" } },
    quantities: [{ id: "q", value: 2, unit: "mC" }, { id: "m", value: 4, unit: "g" }, { id: "B", value: 500, unit: "mT" }, { id: "v", value: 180, unit: "km/h" }],
  },
];
for (const item of cases) {
  test(`${item.name}: direct quantity-reference conversion`, () => assert.deepEqual(evaluate(document(item, true)), evaluate(document(item))));
  test(`${item.name}: compiled quantity-reference conversion`, () => assert.deepEqual(accepted(document(item, true)), accepted(document(item))));
  const inline = document(item, true);
  for (const [key, value] of Object.entries(inline.constructions[0]!.inputs)) {
    const given = inline.quantities.find((quantity) => quantity.id === value);
    if (given) inline.constructions[0]!.inputs[key] = { value: given.value, unit: given.unit };
  }
  inline.quantities = [];
  test(`${item.name}: direct inline declarations`, () => assert.deepEqual(evaluate(inline), evaluate(document(item))));
  test(`${item.name}: compiled inline declarations`, () => assert.deepEqual(accepted(inline), accepted(document(item))));
  test(`${item.name}: unchanged bare values and matching declarations`, () => {
    const matching = document(item);
    const units = matching.constructions[0]!.inputs.units as Record<string, string>;
    const unitKeys: Record<string, string> = { knownResistance: "resistance", unknownResistance: "resistance", wireLength: "length", balanceFromLeft: "length", balanceLength: "length", driverEmf: "emf", cellEmf: "emf", mass: "mass", gravity: "gravity", charge: "charge", field: "field", speed: "speed" };
    for (const [key, unitKey] of Object.entries(unitKeys)) {
      if (key in matching.constructions[0]!.inputs) matching.constructions[0]!.inputs[key] = { value: matching.constructions[0]!.inputs[key], unit: units[unitKey] };
    }
    assert.deepEqual(evaluate(matching), evaluate(document(item)));
    assert.deepEqual(accepted(matching), accepted(document(item)));
  });
}
// Independent numeric oracles: a 6 kΩ/9 kΩ bridge balances at 40 cm;
// 1 V across a 2 V, 100 cm potentiometer balances at 50 cm; r = 200 m.
test("direct independent bridge and potentiometer values", () => {
  const bridge = evaluate(document(cases[0]!, true));
  assert.equal(bridge[3]!.instrument.certified, 9000);
  assert.equal(bridge[1]!.instrument.components.x, 40);
  assert.equal(evaluate(document(cases[1]!, true))[1]!.instrument.components.x, 50);
});
test("compiled independent radius label and stale raw label rejection", () => {
  const doc = document(cases[3]!, true);
  doc.entities[0]!.label = "orbit=200";
  assert.ok(accepted(doc).primitives.some((primitive) => primitive.kind === "label" && primitive.text === "orbit=200"));
  doc.entities[0]!.label = "orbit=0.72";
  declined(doc);
});
for (const [itemIndex, input, wrongUnit] of [
  [0, "knownResistance", "V"], [0, "wireLength", "kg"], [1, "cellEmf", "m"],
  [2, "mass", "T"], [2, "gravity", "kg"], [3, "charge", "cm"],
  [3, "field", "cm"], [3, "speed", "V"],
] as const) {
  for (const unit of [wrongUnit, "unrecognized-unit"]) {
    const doc = document(cases[itemIndex]!, true);
    const reference = doc.constructions[0]!.inputs[input];
    doc.quantities.find((given) => given.id === reference)!.unit = unit;
    test(`${input}: direct rejects ${unit}`, () => assert.throws(() => evaluate(doc), /source unit/));
    test(`${input}: compiler atomically rejects ${unit}`, () => declined(doc));
  }
}
test("direct and compiler reject conflicting wrapper/reference scales", () => {
  const doc = document(cases[3]!, true);
  doc.constructions[0]!.inputs.field = { value: "B", unit: "T" };
  assert.throws(() => evaluate(doc), /source units disagree/);
  declined(doc);
});
test("direct and compiler reject conflicting nested inline scales", () => {
  const doc = document(cases[3]!);
  doc.constructions[0]!.inputs.field = { value: { value: 500, unit: "mT" }, unit: "T" };
  assert.throws(() => evaluate(doc), /source units disagree/);
  declined(doc);
});
test("same-scale source aliases convert once", () => {
  const doc = document(cases[3]!);
  doc.constructions[0]!.inputs.charge = { value: { value: 2000, unit: "uC" }, unit: "μC" };
  assert.deepEqual(evaluate(doc), evaluate(document(cases[3]!)));
  assert.deepEqual(accepted(doc), accepted(document(cases[3]!)));
});
test("missing source reference remains rejected", () => {
  const doc = document(cases[3]!, true);
  doc.quantities = doc.quantities.filter((given) => given.id !== "v");
  assert.throws(() => evaluate(doc));
  declined(doc);
});
console.log(JSON.stringify({ gate: "instrument-source-units", compilerBoundary: compiled ? "built-package" : "source", passed, failed: failures.length, failures }));
if (failures.length) process.exitCode = 1;
