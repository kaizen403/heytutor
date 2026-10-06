import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "../../src/index";
import { evaluateDipoleFieldConstruction } from "../../src/compile/dipoleFieldGeometry";
import { evaluateAnalyticLineConstruction } from "../../src/compile/analyticLineGeometry";
import { evaluateRigidMassConstruction, rigidMassEntityKind } from "../../src/compile/rigidMassGeometry";
import { buildVerifiedDiagramPresentation } from "../../../../apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation";

const point = { x: 0, y: 0 };
const context = {
  number(value: unknown): number { const result = Number(value); if (!Number.isFinite(result)) throw new Error("nonfinite"); return result; },
  point(value: unknown): { x: number; y: number } { if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: Number(value.x), y: Number(value.y) }; throw new Error("not point"); },
  geometry(): unknown { return undefined; },
};
type Fixture = { operator: string; inputs: Record<string, unknown>; lane: "dipole" | "line" | "mass"; claim?: string; value?: number; output?: number };
const pair = [{ position: { x: 1, y: 0 }, charge: 1 }, { position: { x: -1, y: 0 }, charge: -1 }];
// Independent numeric oracles: Coulomb, distance, section, translation, slope,
// p cross E, -p dot E, weighted mass, F/M, sum(m r²), rod M L²/12, axes I+M d².
const fixtures: Fixture[] = [
  { lane: "dipole", operator: "point_charge_field", inputs: { charge: { position: point, charge: 3 }, at: { x: 3, y: 4 }, k: 1, displayLength: 1.25 }, claim: "E", value: 3 / 25 },
  { lane: "dipole", operator: "coulomb_pair", inputs: { charges: [{ position: point, charge: 2 }, { position: { x: 2, y: 0 }, charge: 4 }], k: 1, displayLength: 1 }, claim: "F", value: 2 },
  { lane: "dipole", operator: "field_lines", inputs: { charges: [{ id: "source", position: point, charge: 1 }], starts: [{ x: 0.15, y: 0 }], stepLength: 0.1, stepCount: 6, exclusionRadius: 0.1, k: 1 } },
  { lane: "dipole", operator: "dipole_field", inputs: { charges: pair, at: { x: 3, y: 0 }, mode: "finite", k: 1, displayLength: 1 }, claim: "E", value: 1 / 4 - 1 / 16 },
  { lane: "dipole", operator: "dipole_torque", inputs: { p: { x: 2, y: 0 }, E: { x: 0, y: 3 }, at: point, displayLength: 1 }, claim: "tau", value: 6 },
  { lane: "dipole", operator: "dipole_energy", inputs: { p: { x: 2, y: 0 }, E: { x: 3, y: 0 }, at: point, displayLength: 1, zeroConvention: "perpendicular" }, claim: "U", value: -6 },
  { lane: "dipole", operator: "equipotential", inputs: { source: "point_charge", charge: { position: point, charge: 2 }, V: 4, k: 1 }, claim: "V", value: 4 },
  { lane: "line", operator: "coordinate_distance", inputs: { a: point, b: { x: 3, y: 4 } }, claim: "d", value: 5 },
  { lane: "line", operator: "section_point", inputs: { a: point, b: { x: 4, y: 2 }, mode: "midpoint" }, claim: "x", value: 2 },
  { lane: "line", operator: "axis_translation", inputs: { h: 1, k: 2, target: "point", direction: "toNew", point: { x: 4, y: 5 } }, claim: "x", value: 3 },
  { lane: "line", operator: "line_relation", inputs: { mode: "slope", line: { a: 1, b: 1, c: -2 } }, claim: "m", value: -1 },
  { lane: "line", operator: "line_intercepts", inputs: { a: 2, b: 2, c: -6 }, claim: "m", value: -1 },
  { lane: "line", operator: "line_equation", inputs: { form: "general", a: 1, b: 1, c: -2 }, claim: "m", value: -1 },
  { lane: "line", operator: "line_intersection_angle", inputs: { first: { a: 1, b: 0, c: -1 }, second: { a: 0, b: 1, c: -1 } }, claim: "angle", value: Math.PI / 2 },
  { lane: "line", operator: "line_concurrence", inputs: { first: { a: 1, b: 0, c: -1 }, second: { a: 0, b: 1, c: -1 }, third: { a: 1, b: 1, c: -2 } }, claim: "x", value: 1 },
  { lane: "line", operator: "point_line_distance", inputs: { point: { x: 3, y: 4 }, a: 1, b: 0, c: 0 }, claim: "d", value: 3 },
  { lane: "mass", operator: "centre_of_mass", inputs: { axis: { origin: point }, parts: [{ kind: "point", mass: 2, at: point }, { kind: "point", mass: 2, at: { x: 4, y: 0 } }], displayLength: 1 }, claim: "x", value: 2, output: 2 },
  { lane: "mass", operator: "com_motion", inputs: { mass: 2, com: point, externalForces: [{ id: "push", fx: 6, fy: 0 }], internalPairs: [], displayLength: 1 }, claim: "ax", value: 3 },
  { lane: "mass", operator: "point_mass_inertia", inputs: { masses: [{ mass: 2, at: { x: 2, y: 0 } }], axis: { through: point, orientation: "perpendicular_to_plane" }, displayLength: 1 }, claim: "I", value: 8 },
  { lane: "mass", operator: "simple_body_inertia", inputs: { kind: "uniform_rod", mass: 3, length: 2, center: point, angle: 0, axis: { orientation: "perpendicular_to_length", place: "centre" }, displayLength: 1 }, claim: "I", value: 1 },
  { lane: "mass", operator: "axes_theorem", inputs: { theorem: "parallel", parallel: true, mass: 2, iCom: 3, axisDirection: { x: 0, y: 0, z: 1 }, shiftedDirection: { x: 0, y: 0, z: 1 }, offset: { x: 2, y: 0, z: 0 }, displayLength: 1 }, claim: "I", value: 11 },
];
function documentFor(fixture: Fixture): SceneDocument {
  const { operator, lane } = fixture;
  const inputs = structuredClone(fixture.inputs);
  const outputs = lane === "dipole" ? evaluateDipoleFieldConstruction(operator, inputs, context) : lane === "line" ? evaluateAnalyticLineConstruction(operator, inputs, context) : evaluateRigidMassConstruction(operator, inputs, context);
  const entities = outputs.map((geometry, index) => ({ id: `result${index}`, role: "computed output", kind: lane === "mass" ? rigidMassEntityKind(geometry as ReturnType<typeof evaluateRigidMassConstruction>[number]) : geometry.kind === "point" ? "point" : geometry.kind === "circle" ? "circle" : geometry.kind === "multi_path" ? "polyline" : ["line_relation", "line_intercepts", "line_equation"].includes(operator) ? "line" : lane === "dipole" || "directed" in geometry && geometry.directed ? "vector" : "infinite" in geometry && geometry.infinite ? "line" : "segment" }));
  if (operator === "section_point") Object.assign(entities[0]!, { label: "P" });
  const ids = entities.map((entity) => entity.id);
  const document: SceneDocument = { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "publication regression" }, quantities: [], entities, constructions: [{ id: "make", operator, inputs, outputs: [...ids] }], relations: [], assertions: ids.map((id) => ({ id: `exists_${id}`, predicate: "exists", entities: [id], expected: true, severity: "fatal" })), annotations: [], requiredEntityIds: [...ids], revealGroups: [{ id: "setup", entityIds: [...ids], dependsOn: [], narrationCue: "computed result" }], teachingTimeline: [] };
  if (operator === "point_line_distance") {
    document.entities.push({ id: "sourceLine", kind: "line", role: "measured source line" });
    document.constructions.unshift({ id: "make_sourceLine", operator: "line_equation", inputs: { form: "general", a: 1, b: 0, c: 0 }, outputs: ["sourceLine"] });
    document.requiredEntityIds.push("sourceLine"); document.revealGroups[0]!.entityIds.push("sourceLine");
  }
  return document;
}
let checks = 0;
function verify(document: SceneDocument, valid: boolean, message: string): void {
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, valid, `${message}: ${JSON.stringify(compiled.report.issues)}`); checks++;
  if (!valid) { assert.equal(compiled.renderScene, null, `${message}: atomic rejection`); assert(compiled.report.issues.some((issue) => issue.code === "invalid_publication_derived_label" || issue.code === "invalid_derived_value_label"), `${message}: must reject the claim itself`); checks += 2; return; }
  assert(compiled.renderScene);
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  for (const annotation of document.annotations) {
    if (annotation.kind === "label" && annotation.text && !annotation.quantityId) {
      assert(compiled.renderScene.primitives.some((primitive) => primitive.text === annotation.text), `${message}: validated annotation remains visible`); checks++;
    }
  }
  assert(presentation.diagram.commands.length > 0, `${message}: actual presentation has ink`); checks++;
}
for (const fixture of fixtures) {
  const base = documentFor(fixture); const id = base.entities[fixture.output ?? 0]!.id;
  verify(base, true, `${fixture.operator} baseline`);
  for (const channel of ["entity", "label", "callout", "badge", "constructed", "quantity"] as const) {
    for (const valid of [true, false]) {
      if (valid && fixture.claim === undefined && channel === "quantity") continue;
      const document = structuredClone(base);
      const value = valid ? fixture.value : 99;
      const text = valid && fixture.claim === "angle" ? "angle≈1.571" : fixture.claim ? `${fixture.claim}:${value}` : valid ? "schematic field" : "density=99";
      if (channel === "entity") document.entities.find((entity) => entity.id === id)!.label = text;
      else if (channel === "constructed") {
        document.entities.push({ id: "claim", kind: "label", role: "computed claim", label: valid ? "computed" : text });
        document.constructions.push({ id: "make_claim", operator: "label", inputs: { target: id, text: valid ? "computed" : text }, outputs: ["claim"] });
        document.requiredEntityIds.push("claim"); document.revealGroups[0]!.entityIds.push("claim");
      } else if (channel === "quantity") {
        document.quantities.push({ id: "computed_quantity", symbol: fixture.claim ?? "density", value });
        document.annotations.push({ id: "claim", kind: "label", targetIds: [id], quantityId: "computed_quantity" });
      } else document.annotations.push({ id: "claim", kind: channel, targetIds: [id], text });
      verify(document, valid, `${fixture.operator} ${channel} ${valid}`);
    }
  }
}
// The review's exact forged point-charge annotation, plus unsupported mixed text,
// forged quantity units, underflow and multi-target claims.
for (const text of ["E=99", "E=0.12; E=99", "E=NaN", "E=Infinity", "E=1e-999", "E=0.12 N/C"]) {
  const document = documentFor(fixtures[0]!); document.annotations.push({ id: "wrong_E", kind: "label", targetIds: ["result0"], text }); verify(document, false, text);
}
// Source-point identities and source coordinate labels remain outside the output claim scope.
const withSource = documentFor(fixtures[0]!);
withSource.entities.unshift({ id: "source", kind: "point", role: "source charge position", label: "A1" });
withSource.constructions.unshift({ id: "make_source", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["source"] });
const fieldConstruction = withSource.constructions.find((construction) => construction.operator === "point_charge_field")!;
fieldConstruction.inputs.charge = { position: "source", charge: 3 };
withSource.requiredEntityIds.push("source"); withSource.revealGroups[0]!.entityIds.push("source");
verify(withSource, true, "benign source-point identifier");
withSource.entities[0]!.label = "A=(0,0)";
verify(withSource, true, "benign source-point coordinates");
for (const unit of [undefined, "N/C"]) {
  const document = documentFor(fixtures[0]!);
  document.quantities.push({ id: "q", symbol: "E", value: "nested", unit }, { id: "nested", value: 99 });
  document.annotations.push({ id: "quantity", kind: "badge", targetIds: ["result0"], quantityId: "q" });
  verify(document, false, "nested forged quantity or uncertified unit");
}
const hiddenClaim = documentFor(fixtures[0]!);
hiddenClaim.entities.push({ id: "claimed", kind: "label", role: "constructed claim", label: "E=99" });
hiddenClaim.constructions.push({ id: "make_claimed", operator: "label", inputs: { target: "result0", text: "computed" }, outputs: ["claimed"] });
hiddenClaim.requiredEntityIds.push("claimed"); hiddenClaim.revealGroups[0]!.entityIds.push("claimed");
const hidden = compileSceneDocument(hiddenClaim);
assert.equal(hidden.ok, false); assert.equal(hidden.renderScene, null); checks += 2;
const supportedButBlocked = documentFor(fixtures[0]!);
supportedButBlocked.entities.push({ id: "numeric", kind: "label", role: "numeric descendant", label: "E:0.12" });
supportedButBlocked.constructions.push({ id: "make_numeric", operator: "label", inputs: { target: "result0", text: "E:0.12" }, outputs: ["numeric"] });
supportedButBlocked.requiredEntityIds.push("numeric"); supportedButBlocked.revealGroups[0]!.entityIds.push("numeric");
const descendant = compileSceneDocument(supportedButBlocked);
assert.equal(descendant.ok, false);
assert.equal(descendant.renderScene, null);
assert(descendant.report.issues.some((issue) => issue.code === "invalid_display_derived_claim")); checks += 3;
// A world-coordinate result has no independent display scale. Its label
// descendants must still preserve typed coordinate authority.
const translated = fixtures.find((fixture) => fixture.operator === "axis_translation")!;
for (const hops of [1, 2]) {
  for (const channel of ["label", "callout", "badge", "quantity"] as const) {
    for (const valid of [true, false]) {
      // Badges on label-only entities are unsupported by annotation layout;
      // forged badge claims must still be rejected by numeric authority first.
      if (valid && channel === "badge") continue;
      const document = documentFor(translated);
      let target = "result0";
      for (let hop = 0; hop < hops; hop++) {
        const next = `descendant${hop}`;
        document.entities.push({ id: next, kind: "label", role: "computed caption", label: "computed" });
        document.constructions.push({ id: `make_${next}`, operator: "label", inputs: { target, text: "computed" }, outputs: [next] });
        document.requiredEntityIds.push(next); document.revealGroups[0]!.entityIds.push(next);
        target = next;
      }
      const value = valid ? 3 : 99; // Independently: (4,5)-(1,2)=(3,3).
      if (channel === "quantity") {
        document.quantities.push({ id: "descendant_x", symbol: "x", value });
        document.annotations.push({ id: "descendant_claim", kind: "label", targetIds: [target], quantityId: "descendant_x" });
      } else document.annotations.push({ id: "descendant_claim", kind: channel, targetIds: [target], text: `x=${value}` });
      verify(document, valid, `translation ${hops}-hop ${channel} ${valid ? "correct" : "forged"}`);
    }
  }
}
console.log(`publication derived labels: ${checks} checks passed across ${fixtures.length} operators (compiler and actual presentation)`);
