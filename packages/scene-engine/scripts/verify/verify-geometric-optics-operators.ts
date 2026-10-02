import { evaluateGeometricOpticsConstruction, geometricOpticsOutputLabels, validateEvaluatedGeometricOpticsLabels, validateGeometricOpticsConstruction, type GeometricOpticsEvaluationContext } from "../../src/compile/geometricOpticsGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>();
const context: GeometricOpticsEvaluationContext = {
  number(value) { const result = Number(value); if (!Number.isFinite(result)) throw new Error("nonfinite"); return result; },
  point() { throw new Error("point resolution must preserve geometry metadata"); }, geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
const outputs = evaluateGeometricOpticsConstruction("gaussian_image", { kind: "lens", center: [0, 0], axis: [1, 0], objectDistance: -30, focalLength: 10, objectHeight: 5, displayScale: 2, lengthUnit: "cm" }, context);
if (outputs.length !== 4 || outputs[2]!.point.x !== 30 || outputs[3]!.point.y !== -5 || outputs[3]!.opticalImage?.magnification !== -0.5) throw new Error("convex-lens Cartesian image must match the worked source-distance oracle");
const focus = evaluateGeometricOpticsConstruction("optical_focus", { kind: "lens", center: [4, 5], axis: [-3, 4], focalLength: -10, displayScale: 2 }, context);
if (focus.length !== 2 || focus[0]!.point.x !== -8 || focus[0]!.point.y !== 21 || focus[1]!.point.x !== 16 || focus[1]!.point.y !== -11 || focus[0]!.opticalFocus?.axisDistance !== 10) throw new Error("signed lens focus oracle must preserve directed axis orientation");
const construction = { id: "image", operator: "gaussian_image", inputs: { kind: "lens", center: [0, 0], axis: [1, 0], objectDistance: -30, focalLength: 10, objectHeight: 5, displayScale: 2, lengthUnit: "cm" }, outputs: ["ob", "ot", "ib", "it"] };
const candidate: SceneDocument = { schemaVersion: "scene-document/v2", source: {}, quantities: [], entities: construction.outputs.map((id) => ({ id, kind: "point", role: "Cartesian optical anchor", ...(id === "ib" ? { label: "v=100 cm" } : {}) })), constructions: [construction], relations: [], annotations: [], assertions: [], requiredEntityIds: construction.outputs, revealGroups: [], teachingTimeline: [] };
const issues: SceneIssue[] = [];
validateEvaluatedGeometricOpticsLabels(construction, 0, candidate, outputs, issues);
if (!issues.some((issue) => issue.severity === "fatal")) throw new Error("independent output label must not contradict Gaussian law");
let checks = 3;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string): void { check(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`); }
const base = construction.inputs;
close(evaluateGeometricOpticsConstruction("gaussian_image", { ...base, lengthUnit: "Centimeters", objectDistance: { value: -30, unit: "Centimeters" } }, context)[2]!.opticalImage!.imageDistance, 15, "case-folded full-name optical aliases retain canonical common units");
for (const [kind, u, f, expectedV, expectedM, objectReal, imageReal] of [
  ["lens", -30, 10, 15, -0.5, true, true], ["lens", -5, 10, -10, 2, true, false], ["lens", -30, -10, -7.5, 0.25, true, false],
  ["lens", 30, 10, 7.5, 0.25, false, true], ["lens", 5, -10, 10, 2, false, true], ["lens", 30, -10, -15, -0.5, false, false],
  ["mirror", -30, -10, -15, -0.5, true, true], ["mirror", -30, 10, 7.5, 0.25, true, false], ["mirror", -5, -10, 10, 2, true, false],
  ["mirror", 30, -10, -7.5, 0.25, false, true], ["mirror", 30, 10, 15, -0.5, false, false],
] as const) {
  const result = evaluateGeometricOpticsConstruction("gaussian_image", { ...base, kind, objectDistance: u, focalLength: f, objectHeight: -7, center: [12, -3], axis: [-3, 4], displayScale: 1.5 }, context);
  const image = result[3]!.opticalImage!;
  close(image.imageDistance, expectedV, `${kind} independent signed distance oracle`); close(image.magnification, expectedM, "magnification sign oracle");
  close(1 / image.imageDistance + (kind === "lens" ? -1 : 1) / u, 1 / f, "Cartesian reciprocal law"); close(image.imageHeight / -7, image.magnification, "signed height magnification law");
  check(image.objectIsReal === objectReal && image.imageIsReal === imageReal, "real and virtual classification");
  for (const [i, distance, height] of [[0, u, 0], [1, u, -7], [2, expectedV, 0], [3, expectedV, expectedM * -7]]) {
    close((result[i!]!.point.x - 12) / 1.5, -0.6 * distance! - 0.8 * height!, "rotated Cartesian x oracle"); close((result[i!]!.point.y + 3) / 1.5, 0.8 * distance! - 0.6 * height!, "translated Cartesian y oracle");
  }
  close(Math.hypot(result[3]!.point.x - result[2]!.point.x, result[3]!.point.y - result[2]!.point.y) / Math.hypot(result[1]!.point.x - result[0]!.point.x, result[1]!.point.y - result[0]!.point.y), Math.abs(expectedM), "display height ratio");
}
for (const kind of ["lens", "mirror"] as const) for (const f of [-10, 10]) {
  const result = evaluateGeometricOpticsConstruction("optical_focus", { kind, center: [4, 5], axis: [-3, 4], focalLength: f, displayScale: 2, lengthUnit: "cm" }, context);
  check(result.length === (kind === "lens" ? 2 : 1), "lens and mirror focus arity");
  result.forEach((anchor, index) => { const distance = kind === "lens" && index === 0 ? -f : f; close(anchor.point.x, 4 - 1.2 * distance, "signed focus x"); close(anchor.point.y, 5 + 1.6 * distance, "signed focus y"); close(anchor.opticalFocus!.axisDistance, distance, "focus physical coordinate"); });
  check(geometricOpticsOutputLabels("optical_focus", result).every((label) => label.includes("cm")), "focus labels retain physical units");
}
const scaled = evaluateGeometricOpticsConstruction("gaussian_image", { ...base, displayScale: 10 }, context);
close(scaled[3]!.opticalImage!.imageDistance, 15, "display scale cannot alter physical image distance"); close(scaled[3]!.point.y / outputs[3]!.point.y, 5, "display scale ratio");
const zeroHeight = evaluateGeometricOpticsConstruction("gaussian_image", { ...base, objectHeight: 0 }, context); check(zeroHeight[1]!.point.y === 0 && zeroHeight[3]!.point.y === 0, "explicit axial point object needs no invented height");
function rejects(operator: string, inputs: Record<string, unknown>, message: string): void { let threw = false; try { evaluateGeometricOpticsConstruction(operator, inputs, context); } catch { threw = true; } check(threw, message); }
for (const mutation of [
  { objectDistance: -10 }, { objectDistance: -10 + 1e-10 }, { focalLength: 0 }, { objectDistance: 0 }, { kind: "convex" }, { focalLength: Infinity }, { objectHeight: NaN },
  { displayScale: 0 }, { displayScale: -1 }, { displayScale: 1e-12 }, { objectHeight: 1e-12 }, { objectDistance: 1e9 + 1 }, { focalLength: null }, { objectDistance: false },
  { objectHeight: " " }, { objectDistance: { value: -30, extra: true } }, { axis: [0, 0] }, { axis: [1, 0, 0] }, { center: [0, 0, 0] }, { center: { x: 0, y: 0, z: 0 } },
  { center: [1e12, 1e12], objectHeight: 0.00001 }, { focalLength: 1e9, objectDistance: -1e-8, displayScale: 1e9 }, { displayScale: 1e9, objectDistance: -1e9, focalLength: 10 },
  { lengthUnit: "s" }, { objectDistance: { value: -30, unit: "mm" } }, { displayScale: { value: 2, unit: "m" } }, { axis: [{ value: 1, unit: "cm" }, 0] }, { extra: true },
  { lengthUnit: "Mm" }, { lengthUnit: "mm", objectDistance: { value: -30, unit: "Mm" } },
] as const) rejects("gaussian_image", { ...base, ...mutation }, "invalid, singular, invisible or uncertifiable Gaussian construction must reject");
rejects("gaussian_image", { ...base, kind: "mirror", objectDistance: 10 }, "mirror object at focus yields image at infinity");
rejects("optical_focus", { kind: "lens", center: [0, 0], axis: [1, 0], focalLength: 10, displayScale: 2, objectDistance: -30 }, "focus must reject unknown fields");
geometries.set("O", { kind: "point", point: { x: 5, y: 5 } }); geometries.set("axis", { kind: "path", points: [{ x: 10, y: 5 }, { x: -10, y: 5 }], infinite: true });
const lineAxis = evaluateGeometricOpticsConstruction("gaussian_image", { ...base, center: "O", axis: "axis" }, context); close(lineAxis[2]!.point.x, -25, "line preserves signed direction");
rejects("gaussian_image", { ...base, axis: "axis" }, "principal axis must pass through center");
for (const metadata of [{ space: {} }, { electricField: {} }, { conic: {} }, { calculusAnchor: {} }, { kinematicState: {} }]) { geometries.set("protected", { kind: "point", point: { x: 0, y: 0 }, ...metadata }); rejects("gaussian_image", { ...base, center: "protected" }, "protected point identities cannot be flattened"); }
geometries.set("protected-axis", { kind: "path", points: [{ x: -10, y: 0 }, { x: 10, y: 0 }], infinite: true, spaceLine: {} }); rejects("gaussian_image", { ...base, axis: "protected-axis" }, "protected axis identity cannot be flattened");
geometries.set("long-axis", { kind: "path", points: [{ x: -1e9, y: 5 }, { x: 1e9, y: 5 }], infinite: true }); rejects("gaussian_image", { ...base, axis: "long-axis" }, "long axes cannot relax principal-axis incidence");
check(geometricOpticsOutputLabels("gaussian_image", evaluateGeometricOpticsConstruction("gaussian_image", { ...base, objectHeight: -123456789 }, context)).every((label) => label.length <= 16), "bounded physical values must fit the engine label limit");
function scene(kind: "lens" | "mirror" = "lens"): SceneDocument {
  const constructions = [
    { id: "make-O", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] }, { id: "make-A", operator: "point", inputs: { x: -60, y: 0 }, outputs: ["A"] }, { id: "make-B", operator: "point", inputs: { x: 60, y: 0 }, outputs: ["B"] },
    { id: "make-axis", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["axis"] },
    { id: "image", operator: "gaussian_image", inputs: { ...base, kind, center: "O", axis: "axis", objectDistance: { value: "u" }, focalLength: "f", objectHeight: "h", displayScale: "scale" }, outputs: ["ob", "ot", "ib", "it"] },
    { id: "foci", operator: "optical_focus", inputs: { kind, center: "O", axis: "axis", focalLength: "f", displayScale: "scale", lengthUnit: "cm" }, outputs: kind === "lens" ? ["F1", "F2"] : ["F"] },
    { id: "make-object", operator: "segment", inputs: { start: "ob", end: "ot" }, outputs: ["object"] }, { id: "make-image-height", operator: "segment", inputs: { start: "ib", end: "it" }, outputs: ["image-height"] },
  ];
  const ids = constructions.flatMap((c) => c.outputs);
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit signed Cartesian image and focus landmarks" }, source: {},
    quantities: [{ id: "u", value: "-30", unit: "cm" }, { id: "f", value: kind === "lens" ? 10 : -10, unit: "cm" }, { id: "h", value: 5, unit: "cm" }, { id: "scale", value: 2, unit: "dimensionless" }],
    entities: ids.map((id) => ({ id, kind: id === "axis" ? "line" : ["object", "image-height"].includes(id) ? "segment" : "point", role: "Cartesian optical geometry" })), constructions, relations: [], annotations: [],
    assertions: [{ id: "object-axis", predicate: "incident", entities: ["ob", "axis"], expected: true, severity: "fatal" }, { id: "image-axis", predicate: "incident", entities: ["ib", "axis"], expected: true, severity: "fatal" }, { id: "height-parallel", predicate: "parallel", entities: ["object", "image-height"], expected: true, severity: "fatal" }, { id: "height-ratio", predicate: "distance_ratio", entities: ["ib", "it", "ob", "ot"], expected: 0.5, severity: "fatal" }],
    requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "reveal the verified image anchors" }], teachingTimeline: [] };
}
function structural(s: SceneDocument): SceneIssue[] { const map = new Map(s.constructions.flatMap((c) => c.outputs.map((id) => [id, c] as const))); const issues: SceneIssue[] = []; s.constructions.forEach((c, i) => { if (["gaussian_image", "optical_focus"].includes(c.operator)) validateGeometricOpticsConstruction(c, i, s, map, issues); }); return issues; }
for (const kind of ["lens", "mirror"] as const) check(structural(scene(kind)).length === 0, `${kind} source quantities and units must validate`);
const mutations = [
  (s: SceneDocument) => { for (const q of s.quantities.filter((q) => ["u", "f", "h"].includes(q.id))) q.unit = "mm"; s.quantities.find((q) => q.id === "u")!.unit = "Mm"; for (const c of s.constructions.filter((c) => ["image", "foci"].includes(c.id))) c.inputs.lengthUnit = "mm"; },
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "u")!.unit = "mm"; }, (s: SceneDocument) => { s.quantities.find((q) => q.id === "scale")!.unit = "cm"; },
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "u")!.value = "u"; }, (s: SceneDocument) => { s.constructions.find((c) => c.id === "image")!.outputs.pop(); },
  (s: SceneDocument) => { s.entities.find((e) => e.id === "ib")!.kind = "vector"; }, (s: SceneDocument) => { s.constructions.find((c) => c.id === "image")!.inputs.center = "absent"; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "image")!.inputs.axis = "O"; }, (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-O")!.operator = "space_point"; },
  (s: SceneDocument) => { s.entities.find((e) => e.id === "ib")!.label = "v=100 cm"; }, (s: SceneDocument) => { s.entities.find((e) => e.id === "it")!.label = "m=10"; },
  (s: SceneDocument) => { s.annotations.push({ id: "bad", kind: "label", targetIds: ["ib"], text: "v", quantityId: "f" }); },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-O")!.inputs.x = { value: 0, unit: "m" }; },
] as const;
for (const mutate of mutations) { const s = scene(); mutate(s); check(structural(s).some((issue) => issue.severity === "fatal"), "invalid optics provenance, units or labels must reject"); }
const derived = scene(); derived.constructions.find((c) => c.id === "make-O")!.operator = "translate"; derived.constructions.find((c) => c.id === "make-O")!.inputs = { point: "A", vector: [60, 0] };
check(structural(derived).length === 0, "unknown derived center must defer without fake zero");
const resultQuantities = scene(); resultQuantities.quantities.push({ id: "v", value: 15, unit: "cm" }, { id: "m", value: -0.5, unit: "dimensionless" }); resultQuantities.annotations.push({ id: "v-label", kind: "label", targetIds: ["ib"], text: "v", quantityId: "v" }, { id: "m-label", kind: "label", targetIds: ["it"], text: "m", quantityId: "m" }); check(structural(resultQuantities).length === 0, "correct derived result quantity annotations must validate");
const explicitResult = structuredClone(resultQuantities); explicitResult.annotations.find((a) => a.id === "m-label")!.text = "m=-0.5"; check(structural(explicitResult).length === 0, "explicit generated magnification labels retain dimensionless quantity identity");
if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, isSupportedSceneOperator } = await import("../../src/index");
  for (const operator of ["gaussian_image", "optical_focus"]) check(isSupportedSceneOperator(operator), "optical operator must reach executable capability");
  for (const kind of ["lens", "mirror"] as const) { const s = scene(kind); const result = compileSceneDocument(s); check(result.ok && result.renderScene, `${kind} anchors failed compile: ${JSON.stringify(result.report.issues)}`); check(result.renderScene.primitives.every((p) => p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))), "optics render coordinates must be finite"); const reversed = structuredClone(s); reversed.constructions.reverse(); check(compileSceneDocument(reversed).ok, "optical dependencies must compile in reverse order"); const falseProof = structuredClone(s); falseProof.assertions[0]!.expected = false; const rejection = compileSceneDocument(falseProof); check(!rejection.ok && rejection.renderScene === null, "false optical incidence must reject atomically"); }
  const correct = compileSceneDocument(resultQuantities); check(correct.ok, `correct source-bound annotations must compile: ${JSON.stringify(correct.report.issues)}`);
  for (const [kind, u, f, ratio] of [["lens", -5, 10, 2], ["lens", -30, -10, 0.25], ["mirror", -30, 10, 0.25], ["mirror", 30, -10, 0.25]] as const) {
    const s = scene(kind); s.quantities.find((q) => q.id === "u")!.value = u; s.quantities.find((q) => q.id === "f")!.value = f; s.assertions.find((a) => a.id === "height-ratio")!.expected = ratio;
    const result = compileSceneDocument(s); check(result.ok, `real/virtual Cartesian configuration must compile: ${JSON.stringify(result.report.issues)}`);
  }
  const derivedCompiled = compileSceneDocument(derived); check(derivedCompiled.ok, `derived optical center must compose with existing operators: ${JSON.stringify(derivedCompiled.report.issues)}`);
  for (const mutate of [...mutations, (s: SceneDocument) => { s.quantities.find((q) => q.id === "u")!.value = -10; }, (s: SceneDocument) => { s.constructions.find((c) => c.id === "image")!.operator = "optical_magic_image"; }]) { const s = scene(); mutate(s); const result = compileSceneDocument(s); check(!result.ok && result.renderScene === null, "invalid optics must not render partial geometry"); }
}
console.log(`geometric optics operator verification passed (${checks} checks)`);
