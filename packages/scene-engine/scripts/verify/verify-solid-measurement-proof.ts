import { compileSceneDocument, type SceneDocument } from "../../src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
type Kind = "radius" | "diameter" | "height" | "inner_radius";
interface Options {
  kind?: Kind;
  role?: string;
  solidKind?: "cylinder" | "cone" | "frustum" | "sphere";
  a?: { at: number | string; radialFraction: number | string; angleDeg?: number | string; solid?: string };
  b?: { at: number | string; radialFraction: number | string; angleDeg?: number | string; solid?: string };
  owner?: string;
  innerRadius?: number;
}
function fixture(options: Options = {}): SceneDocument {
  const { kind = "diameter", solidKind = "cylinder" } = options;
  const a = { solid: "solid", at: solidKind === "sphere" ? 0.5 : 0, radialFraction: kind === "radius" || kind === "inner_radius" ? 0 : 1, angleDeg: 180, ...options.a };
  const b = { solid: "solid", at: solidKind === "sphere" ? 0.5 : kind === "height" ? 1 : 0, radialFraction: kind === "inner_radius" ? 3 / 7 : 1, angleDeg: kind === "height" ? 180 : 0, ...options.b };
  const ids = ["origin", "solid", "other", "a", "b", "measure"];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "measurement proof" },
    source: { question: "A cylinder has diameter 14 cm and height 8 cm." },
    quantities: [{ id: "zero", value: 0 }, { id: "one", value: 1 }, { id: "opposite", value: 180 }],
    entities: ids.map((id) => ({ id, kind: id === "measure" ? "dimension" : id === "solid" || id === "other" ? "polyline" : "point", role: id === "measure" ? options.role ?? `solid ${kind}` : "construction helper point" })),
    constructions: [
      { id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["origin"] },
      { id: "make_solid", operator: "solid_projection", inputs: { kind: solidKind, center: "origin", radius: 7, ...(solidKind !== "sphere" ? { height: 8 } : {}), ...(solidKind === "frustum" ? { topRadius: 3 } : {}), ...(options.innerRadius ? { innerRadius: options.innerRadius } : {}) }, outputs: ["solid"] },
      { id: "make_other", operator: "solid_projection", inputs: { kind: "cylinder", center: "origin", radius: 4, height: 9 }, outputs: ["other"] },
      { id: "make_a", operator: "solid_anchor", inputs: a, outputs: ["a"] },
      { id: "make_b", operator: "solid_anchor", inputs: b, outputs: ["b"] },
      { id: "make_measure", operator: "dimension", inputs: { start: "a", end: "b", ...(options.role ? {} : { measurementKind: kind }), ...(options.owner ? { solid: options.owner } : {}) }, outputs: ["measure"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["solid", "measure"],
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Show the measured solid" }], teachingTimeline: [],
  };
}
function expect(document: SceneDocument, valid: boolean, name: string) {
  const result = compileSceneDocument(document);
  assert(result.ok === valid, `${name}: expected ${valid ? "valid" : "rejected"}, got ${JSON.stringify(result.report.issues)}`);
  if (!valid) assert(result.report.issues.some((issue) => issue.code === "invalid_solid_measurement"), `${name}: rejection must come from the solid measurement proof`);
}
expect(fixture(), true, "opposite rims diameter");
expect(fixture({ kind: "radius" }), true, "centre to rim radius");
expect(fixture({ kind: "radius", a: { at: 0, radialFraction: 1, angleDeg: 0 }, b: { at: 0, radialFraction: 0 } }), true, "reversed radius endpoints");
expect(fixture({ a: { at: 0, radialFraction: 1, angleDeg: 0 }, b: { at: 0, radialFraction: 1, angleDeg: 180 } }), true, "reversed diameter endpoints");
expect(fixture({ kind: "height" }), true, "matching cylinder rims height");
expect(fixture({ kind: "height", a: { at: 1, radialFraction: 1 }, b: { at: 0, radialFraction: 1, angleDeg: 180 } }), true, "reversed height endpoints");
expect(fixture({ kind: "height", solidKind: "cone", a: { at: 0, radialFraction: 0 }, b: { at: 1, radialFraction: 0 } }), true, "cone axis height");
expect(fixture({ kind: "radius", solidKind: "frustum", a: { at: 0.5, radialFraction: 0 }, b: { at: 0.5, radialFraction: 1 } }), true, "radius of a derived frustum section");
expect(fixture({ kind: "radius", solidKind: "sphere" }), true, "sphere equatorial radius");
expect(fixture({ solidKind: "sphere" }), true, "sphere equatorial diameter");
expect(fixture({ kind: "inner_radius", innerRadius: 3 }), true, "native bore radius");
expect(fixture({ a: { at: "zero", radialFraction: "one", angleDeg: "opposite" }, b: { at: "zero", radialFraction: "one", angleDeg: "zero" } }), true, "quantity resolved anchor parameters");
expect(fixture({ a: { at: 0, radialFraction: 0 } }), false, "radius mislabeled diameter");
expect(fixture({ kind: "radius", a: { at: 0, radialFraction: 1 } }), false, "diameter mislabeled radius");
expect(fixture({ b: { solid: "other", at: 0, radialFraction: 1 } }), false, "cross solid measurement");
expect(fixture({ owner: "other" }), false, "wrong declared solid owner");
expect(fixture({ b: { at: 1, radialFraction: 1 } }), false, "mismatched diameter sections");
expect(fixture({ solidKind: "sphere", a: { at: 0.25, radialFraction: 1 }, b: { at: 0.25, radialFraction: 1 } }), false, "polar section mislabeled sphere diameter");
expect(fixture({ kind: "radius", solidKind: "sphere", a: { at: 0.25, radialFraction: 0 }, b: { at: 0.25, radialFraction: 1 } }), false, "polar section mislabeled sphere radius");
expect(fixture({ kind: "height", solidKind: "cone" }), false, "cone slant length mislabeled height");
expect(fixture({ kind: "inner_radius", innerRadius: 3, b: { at: 0, radialFraction: 1 } }), false, "outer radius mislabeled bore radius");
expect(fixture({ role: "cylinder diameter", a: { at: 0, radialFraction: 0 } }), false, "legacy diameter role still requires opposite rims");
expect(fixture({ role: "solid measurement" }), false, "unbound solid measurement fails closed");
const contradictoryRole = fixture({ kind: "radius" });
contradictoryRole.entities.find((entity) => entity.id === "measure")!.role = "cylinder diameter";
expect(contradictoryRole, false, "typed radius cannot contradict a claimed diameter");
const generic = fixture();
generic.constructions = generic.constructions.filter((construction) => ["make_origin", "make_a", "make_b", "make_measure"].includes(construction.id)).map((construction) => construction.operator === "solid_anchor"
  ? { ...construction, operator: "point", inputs: { x: construction.outputs[0] === "a" ? 0 : 4, y: 0 } }
  : construction.operator === "dimension" ? { ...construction, inputs: { start: "a", end: "b" } } : construction);
generic.entities = generic.entities.filter((entity) => !["solid", "other"].includes(entity.id));
generic.requiredEntityIds = ["measure"];
generic.revealGroups[0]!.entityIds = generic.entities.map((entity) => entity.id);
expect(generic, true, "ordinary point to point spans stay valid");
console.log("verify-solid-measurement-proof: 25 correct and malformed solid measurement programs verified");
