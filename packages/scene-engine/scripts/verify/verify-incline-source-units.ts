/** Redundant working units may come from explicitly declared SI source quantities. */
import assert from "node:assert/strict";
import type { SceneDocument } from "../../src/types";

const engine = process.argv.includes("--compiled-boundary") ? await import("../../dist/index.js") : await import("../../src/index");
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert.ok(value, message); }
function document(): SceneDocument {
  const ids = ["incline", "body", "weight", "normal", "friction", "acceleration"];
  return {
    schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "explicit source units" },
    quantities: [{ id: "m", value: 2, unit: "kg" }, { id: "g", value: 10, unit: "m/s^2" }],
    entities: ids.map((id, index) => ({ id, kind: index === 0 ? "segment" : index === 1 ? "point" : "vector", role: id })),
    constructions: [{ id: "forces", operator: "incline_friction", inputs: { mass: "m", gravity: "g", angleDeg: 30, mu: 0.2, motion: "down", displayScale: 2, forceScale: 0.1, accelScale: 0.2 }, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "reveal-forces", entityIds: ids, dependsOn: [], narrationCue: "forces" }], teachingTimeline: [],
  };
}
function accepted(doc: SceneDocument) {
  const validation = engine.validateSceneDocument(doc);
  check(validation.document !== null, `document valid: ${JSON.stringify(validation.report.issues)}`);
  const compiled = engine.compileSceneDocument(validation.document!);
  check(compiled.ok && compiled.renderScene, `compiles: ${JSON.stringify(compiled.report.issues)}`);
  return compiled.renderScene;
}
const oracle = document();
oracle.constructions[0]!.inputs.units = { mass: "kg", gravity: "m/s^2" };
const expected = accepted(oracle);
check(JSON.stringify(accepted(document())) === JSON.stringify(expected), "explicit SI quantity references equal the fully declared working-unit scene");
function declined(doc: SceneDocument, label: string) {
  const validation = engine.validateSceneDocument(doc);
  check(validation.document === null, `${label}: validator refuses`);
  const compiled = engine.compileSceneDocument(doc);
  check(!compiled.ok && compiled.renderScene === null, `${label}: no partial scene`);
}
for (const unit of ["m/s^2", "m/s²"]) {
  const doc = document(); doc.quantities[1]!.unit = unit;
  check(JSON.stringify(accepted(doc)) === JSON.stringify(expected), `${unit}: declared SI gravity keeps exactly the oracle geometry`);
}
const inline = document();
inline.constructions[0]!.inputs.mass = { value: 2, unit: "kg" };
inline.constructions[0]!.inputs.gravity = { value: 10, unit: "m/s^2" };
inline.quantities = [];
check(JSON.stringify(accepted(inline)) === JSON.stringify(expected), "inline SI declarations keep the oracle geometry");
const nested = document();
nested.constructions[0]!.inputs.mass = { value: "m", unit: "kg" };
nested.constructions[0]!.inputs.gravity = { value: "g", unit: "m/s²" };
check(JSON.stringify(accepted(nested)) === JSON.stringify(expected), "agreeing wrapper/reference declarations keep the oracle geometry");
for (const key of ["mass", "gravity"]) {
  const bare = document(); bare.constructions[0]!.inputs[key] = key === "mass" ? 2 : 10;
  declined(bare, `${key} with no declaration cannot acquire a unit`);
}
for (const [index, unit] of [[0, "g"], [0, "N"], [0, "kg/s"], [0, "unknown"], [0, ""], [1, "cm/s^2"], [1, "s^-1"], [1, "m/s"], [1, "unknown"]] as const) {
  const doc = document(); doc.quantities[index]!.unit = unit;
  declined(doc, `${unit || "empty"} cannot be inferred as the SI working unit`);
}
for (const block of [null, [], "SI", {}, { mass: "kg" }, { gravity: "m/s^2" }, { mass: "g", gravity: "m/s^2" }, { mass: "kg", gravity: "cm/s^2" }]) {
  const doc = document(); doc.constructions[0]!.inputs.units = block;
  declined(doc, "an explicit malformed, partial or conflicting block is preserved");
}
const conflicting = document();
conflicting.constructions[0]!.inputs.mass = { value: "m", unit: "g" };
declined(conflicting, "a conflicting wrapper cannot override a declared quantity");
const cyclic = document(); cyclic.quantities[0]!.value = "m";
declined(cyclic, "cyclic source references cannot supply a working unit");
const converted = structuredClone(oracle);
converted.quantities[0]!.value = 2000; converted.quantities[0]!.unit = "g";
converted.quantities[1]!.value = 1000; converted.quantities[1]!.unit = "cm/s²";
check(JSON.stringify(accepted(converted)) === JSON.stringify(expected), "an explicit working-unit block retains existing source conversions");
for (const key of ["displayScale", "forceScale", "accelScale", "mass", "gravity"]) {
  const doc = document(); delete doc.constructions[0]!.inputs[key];
  declined(doc, `missing ${key} is never supplied`);
}
const radians = document(); radians.constructions[0]!.inputs.angleDeg = { value: Math.PI / 6, unit: "rad" };
declined(radians, "radians cannot silently become degrees when the unit block is omitted");
const percent = document(); percent.constructions[0]!.inputs.mu = { value: 20, unit: "%" };
declined(percent, "percent friction cannot silently become a unitless coefficient");
for (const unit of ["deg", "°", "degree", "degrees"]) {
  const doc = document(); doc.constructions[0]!.inputs.angleDeg = { value: 30, unit };
  check(JSON.stringify(accepted(doc)) === JSON.stringify(expected), `${unit}: explicit degrees keep the oracle geometry`);
}
for (const unit of ["1", "dimensionless", "unitless"]) {
  const doc = document(); doc.constructions[0]!.inputs.mu = { value: 0.2, unit };
  check(JSON.stringify(accepted(doc)) === JSON.stringify(expected), `${unit}: a dimensionless coefficient keeps the oracle geometry`);
}
for (const workingBlock of [false, true]) {
  for (const [key, value, unit] of [["angleDeg", Math.PI / 6, "rad"], ["angleDeg", 30, "unknown"], ["mu", 20, "%"], ["mu", 0.2, "N"]] as const) {
    const doc = document(); if (workingBlock) doc.constructions[0]!.inputs.units = { mass: "kg", gravity: "m/s^2" };
    doc.constructions[0]!.inputs[key] = { value, unit };
    declined(doc, `${key} declares ${unit}; explicit working block=${workingBlock}`);
  }
}
const namedMu = document(); namedMu.quantities.push({ id: "coefficient", value: 0.2, unit: "N" });
namedMu.constructions[0]!.inputs.mu = { value: "coefficient", unit: "1" };
declined(namedMu, "a dimensionless wrapper cannot hide an incompatible source declaration");
console.log(`incline source units: ${checks} checks passed`);
