import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "../../src/index";

function fixture(): SceneDocument {
  const points = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 3 }, { id: "c", x: 4, y: 3 }, { id: "d", x: 4, y: 0 }];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "synthetic component values" }, source: {},
    quantities: [{ id: "internal", symbol: "r", value: 0.25, unit: "Ω" }, { id: "external", symbol: "R", value: 1.75, unit: "Ω" }],
    entities: [...points.map(({ id }) => ({ id, kind: "point", role: "construction helper" })),
      { id: "cell", kind: "component", role: "battery", label: "E" }, { id: "inside", kind: "component", role: "resistor", label: "r" },
      { id: "load", kind: "component", role: "resistor", label: "R" }, { id: "return", kind: "wire", role: "wire" }],
    constructions: [...points.map(({ id, x, y }) => ({ id: `p_${id}`, operator: "point", inputs: { x, y }, outputs: [id] })),
      { id: "source", operator: "symbol", inputs: { symbol: "battery", start: "a", end: "b" }, outputs: ["cell"] },
      { id: "resistance_r", operator: "symbol", inputs: { symbol: "resistor", start: "b", end: "c" }, outputs: ["inside"] },
      { id: "resistance_R", operator: "symbol", inputs: { symbol: "resistor", start: "c", end: "d" }, outputs: ["load"] },
      { id: "wire", operator: "connect", inputs: { from: "d", to: "a" }, outputs: ["return"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["cell", "inside", "load", "return"],
    revealGroups: [{ id: "circuit", entityIds: ["cell", "inside", "load", "return"], dependsOn: [], narrationCue: "circuit" }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "circuit", dependsOn: [], narrationIntent: "reveal" }],
  };
}
function labels(document: SceneDocument): Map<string, string> {
  const copy = structuredClone(document);
  const c = compileSceneDocument(document);
  assert.ok(c.ok && c.renderScene, JSON.stringify(c.report.issues));
  assert.deepEqual(document, copy, "binding labels must not mutate input");
  return new Map(c.renderScene.primitives.filter(p => p.kind === "label").map(p => [p.entityId, p.text ?? ""]));
}
const basic = labels(fixture());
assert.equal(basic.get("inside"), "r 0.25 Ω");
assert.equal(basic.get("load"), "R 1.75 Ω", "case-distinct physical symbols must never share a value");
let checks = 2;
for (const reverse of [false, true]) {
  const d = fixture();
  d.quantities.push({ id: "other_load", symbol: "R", value: 9, unit: "Ω" });
  d.annotations.push({ id: "load_value", kind: "label", quantityId: "external", targetIds: ["load"] });
  if (reverse) d.quantities.reverse();
  assert.equal(labels(d).get("load"), "R 1.75 Ω", "explicit exact-id binding wins conflicting symbolic aliases"); checks++;
}
const ambiguous = fixture();
ambiguous.quantities.push({ id: "other_load", symbol: "R", value: 9, unit: "Ω" });
assert.equal(labels(ambiguous).get("load"), "R", "conflicting implicit aliases must not choose a value"); checks++;
const exactId = fixture();
exactId.quantities.push({ id: "R", symbol: "load", value: 2, unit: "Ω" });
assert.equal(labels(exactId).get("load"), "R 1.75 Ω", "an opaque id cannot override the declared physical symbol"); checks++;
const opaqueId = fixture(); opaqueId.quantities[0]!.id = "R";
assert.equal(labels(opaqueId).get("load"), "R 1.75 Ω", "opaque id R on symbol r must not assign r to R"); checks++;
opaqueId.annotations.push({ id: "explicit_load", kind: "label", quantityId: "external", targetIds: ["load"] });
assert.equal(labels(opaqueId).get("load"), "R 1.75 Ω", "explicit binding disambiguates opaque ids"); checks++;
for (const badBinding of ["missing", "internal"]) {
  const d = fixture();
  d.annotations.push({ id: "load_value", kind: "label", quantityId: badBinding, targetIds: ["load"] });
  assert.equal(labels(d).get("load"), "R 1.75 Ω", "a different quantity annotation must not replace a uniquely named component value"); checks++;
}
const multiple = fixture();
multiple.annotations.push(...["external", "internal"].map((quantityId, i) => ({ id: `value_${i}`, kind: "label", quantityId, targetIds: ["load"] })));
assert.equal(labels(multiple).get("load"), "R 1.75 Ω", "multiple annotations do not replace a unique implicit component value"); checks++;
const subscript = fixture();
subscript.entities.find(e => e.id === "load")!.label = "R₂";
subscript.quantities[1]!.symbol = "R2";
assert.equal(labels(subscript).get("load"), "R₂ 1.75 Ω"); checks++;
const noCaseAlias = fixture(); noCaseAlias.quantities = noCaseAlias.quantities.slice(0, 1);
assert.equal(labels(noCaseAlias).get("load"), "R", "a missing R must not be supplied from r"); checks++;
const opaqueAlias = fixture(); opaqueAlias.entities.find(e => e.id === "load")!.label = "X";
opaqueAlias.quantities[1] = { id: "x", symbol: "R_load", value: 1.75, unit: "Ω" };
assert.equal(labels(opaqueAlias).get("load"), "X 1.75 Ω", "legacy opaque aliases survive when no physical symbol conflicts"); checks++;
const noSymbol = fixture(); delete noSymbol.quantities[1]!.symbol;
noSymbol.annotations.push({ id: "bound_value", kind: "label", quantityId: "external", targetIds: ["load"] });
assert.equal(labels(noSymbol).get("load"), "R 1.75 Ω", "an explicit quantity id needs no inferred symbol"); checks++;
const caseCollision = fixture(); caseCollision.quantities = [{ id: "r", symbol: "r", value: 0.25, unit: "Ω" }];
assert.equal(labels(caseCollision).get("load"), "R", "an opaque alias cannot change physical symbol case"); checks++;
const conflictingUnits = fixture();
conflictingUnits.quantities.push({ id: "other_R", symbol: "R", value: 1.75, unit: "mΩ" });
assert.equal(labels(conflictingUnits).get("load"), "R", "SI unit prefix differences cannot collapse aliases"); checks++;
const sameAliases = fixture();
sameAliases.quantities.push({ id: "other_R", symbol: "R", value: 1.75, unit: "Ω" });
assert.equal(labels(sameAliases).get("load"), "R 1.75 Ω", "equivalent aliases do not erase a known value"); checks++;
const opaqueCasePair = fixture(); opaqueCasePair.quantities = [{ id: "r", value: 0.25, unit: "Ω" }, { id: "R", value: 1.75, unit: "Ω" }];
assert.equal(labels(opaqueCasePair).get("inside"), "r 0.25 Ω", "exact case-distinct ids remain usable without symbolic metadata"); checks++;
assert.equal(labels(opaqueCasePair).get("load"), "R 1.75 Ω"); checks++;
const staleLabel = fixture(); staleLabel.quantities = [{ id: "external", value: 1.75, unit: "Ω", label: "9 Ω" }];
staleLabel.annotations.push({ id: "bound_value", kind: "label", quantityId: "external", targetIds: ["load"] });
assert.equal(labels(staleLabel).get("load"), "R 1.75 Ω", "an explicit binding formats the stored scalar, not a stale display label"); checks++;
for (const value of ["unknown", "1e-400", "1e400", Number.POSITIVE_INFINITY]) {
  const d = structuredClone(staleLabel); d.quantities[0]!.value = value;
  const result = compileSceneDocument(d);
  if (result.ok) assert.equal(result.renderScene?.primitives.find(p => p.entityId === "load" && p.kind === "label")?.text, "R", "an unrenderable explicit scalar must not become numeric ink");
  else assert.equal(result.renderScene, null, "existing source refusal remains atomic");
  checks++;
}
function angleFixture(): SceneDocument {
  const points = [{ id: "O", x: 0, y: 0 }, { id: "A", x: 3, y: 0 }, { id: "B", x: 3 * Math.cos(Math.PI / 6), y: 1.5 }];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "synthetic explicit angle binding" }, source: {},
    quantities: [{ id: "theta", symbol: "alpha", value: 30, unit: "deg" }, { id: "other", symbol: "theta", value: 60, unit: "deg" }],
    entities: [...points.map(({ id }) => ({ id, kind: "point", role: "angle arm point" })),
      { id: "arc", kind: "angle_mark", role: "given angle" }],
    constructions: [...points.map(({ id, x, y }) => ({ id: `make_${id}`, operator: "point", inputs: { x, y }, outputs: [id] })),
      { id: "make_arc", operator: "angle_mark", inputs: { vertex: "O", a: "A", b: "B" }, outputs: ["arc"] }],
    relations: [], assertions: [],
    annotations: [{ id: "angle_value", kind: "label", quantityId: "theta", targetIds: ["arc"] }],
    requiredEntityIds: ["arc"],
    revealGroups: [{ id: "angle", entityIds: ["O", "A", "B", "arc"], dependsOn: [], narrationCue: "given angle" }],
    teachingTimeline: [],
  };
}
for (const reverse of [false, true]) {
  const explicitAngle = angleFixture();
  if (reverse) explicitAngle.quantities.reverse();
  assert.equal(labels(explicitAngle).get("arc"), "30 deg", "an explicit angle quantityId must beat another quantity's matching symbol, regardless of inventory order"); checks++;
}
const staleAngleLabel = angleFixture();
staleAngleLabel.quantities[0]!.label = "90 deg";
assert.equal(labels(staleAngleLabel).get("arc"), "30 deg", "an explicit angle binding uses its stored scalar instead of stale display text"); checks++;
const missingAngleId = angleFixture();
missingAngleId.quantities[0]!.id = "renamed";
assert.equal(labels(missingAngleId).get("arc"), undefined, "a missing explicit angle id cannot fall through to a matching symbol"); checks++;
const caseDistinctAngleId = angleFixture();
caseDistinctAngleId.quantities[0]!.id = "Theta";
assert.equal(labels(caseDistinctAngleId).get("arc"), undefined, "explicit quantity ids remain case-sensitive opaque references"); checks++;
const implicitAngle = angleFixture();
implicitAngle.annotations = [];
implicitAngle.quantities = [{ id: "angle_value", symbol: "arc", value: 30, unit: "deg" }];
assert.equal(labels(implicitAngle).get("arc"), "30 deg", "unbound angle labels retain implicit physical-symbol lookup"); checks++;

console.log(`verify-component-value-bindings: ${checks} checks passed`);
