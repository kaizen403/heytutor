import { evaluateAffineConstruction, validateAffineConstruction, type AffineEvaluationContext } from "../../src/compile/affineGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const geometries = new Map<string, unknown>([["P", { kind: "point", point: { x: 2, y: -3 } }]]);
const context: AffineEvaluationContext = {
  number(value) { const result = Number(value === "shear" ? 2 : value); if (!Number.isFinite(result)) throw new Error("nonfinite"); return result; },
  point(value) { const geometry = typeof value === "string" ? geometries.get(value) : undefined; if (typeof geometry === "object" && geometry !== null && "point" in geometry) return geometry.point as { x: number; y: number }; throw new Error("missing point"); },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
const [image] = evaluateAffineConstruction("affine_point", { point: "P", matrix: [[1, { value: "shear" }], [0, 1]], translation: [4, "5"] }, context);
if (image?.kind !== "point" || image.point.x !== 0 || image.point.y !== 2) throw new Error("affine image must obey the independent matrix equation");
let checks = 1;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string): void { check(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`); }
geometries.set("triangle", { kind: "path", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }], closed: true });
const [region] = evaluateAffineConstruction("affine_path", { path: "triangle", matrix: [[2, 1], [0, -3]], translation: [-1, 5] }, context);
check(region?.kind === "path" && region.closed, "affine region must preserve closed topology");
for (const [index, p] of region.points.entries()) {
  const expected = [{ x: -1, y: 5 }, { x: 7, y: 5 }, { x: 2, y: -4 }][index]!;
  close(p.x, expected.x, "shear/stretch/reflection x oracle"); close(p.y, expected.y, "shear/stretch/reflection y oracle");
}
const cross = (region.points[1]!.x - region.points[0]!.x) * (region.points[2]!.y - region.points[0]!.y) - (region.points[1]!.y - region.points[0]!.y) * (region.points[2]!.x - region.points[0]!.x);
close(cross, -72, "determinant -6 must reverse orientation and scale area by6");
function scene(): SceneDocument {
  const constructions = [
    { id: "make-a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["A"] },
    { id: "make-b", operator: "point", inputs: { x: "side", y: 0 }, outputs: ["B"] },
    { id: "make-c", operator: "point", inputs: { x: 0, y: 3 }, outputs: ["C"] },
    { id: "make-region", operator: "polygon", inputs: { points: ["A", "B", "C"] }, outputs: ["region"] },
    { id: "map-b", operator: "affine_point", inputs: { point: "B", matrix: [[2, { value: "k" }], [0, -3]], translation: [{ value: "tx" }, "5"] }, outputs: ["B2"] },
    { id: "map-region", operator: "affine_path", inputs: { path: "region", matrix: [[2, "k"], [0, -3]], translation: ["tx", 5] }, outputs: ["region2"] },
    { id: "restore-region", operator: "affine_path", inputs: { path: "region2", matrix: [[2, "k"], [0, -3]], translation: ["tx", 5], inverse: true }, outputs: ["restored"] },
  ];
  const ids = constructions.flatMap((c) => c.outputs);
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit affine map and inverse" }, source: {},
    quantities: [{ id: "side", value: 4, unit: "cm" }, { id: "k", value: 1, unit: "dimensionless" }, { id: "tx", value: -1, unit: "cm" }],
    entities: ids.map((id) => ({ id, kind: ["region", "region2", "restored"].includes(id) ? "polygon" : "point", role: "affine geometry" })), constructions,
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids.filter((id) => id !== "restored"), dependsOn: [], narrationCue: "show matrix action" }, { id: "inverse-reveal", entityIds: ["restored"], dependsOn: ["setup"], narrationCue: "recover the original region with the inverse" }], teachingTimeline: [],
  };
}
function structural(candidate: SceneDocument): SceneIssue[] {
  const byOutput = new Map(candidate.constructions.flatMap((c) => c.outputs.map((id) => [id, c] as const))); const issues: SceneIssue[] = [];
  for (const [index, construction] of candidate.constructions.entries()) if (construction.operator.startsWith("affine_")) validateAffineConstruction(construction, index, candidate, byOutput, issues);
  return issues;
}
check(structural(scene()).length === 0, "known affine graph with common length scale and dimensionless matrix must validate");
const prefixAffine = scene(); prefixAffine.quantities.find((quantity) => quantity.id === "side")!.unit = "Mm"; prefixAffine.quantities.find((quantity) => quantity.id === "tx")!.unit = "mm";
check(structural(prefixAffine).some((issue) => issue.severity === "fatal"), "megameter source and millimeter translation cannot certify a raw affine sum");
const fullNameAffine = scene(); fullNameAffine.quantities.find((quantity) => quantity.id === "tx")!.unit = "Centimeters";
check(structural(fullNameAffine).length === 0, "case-folded full-name affine aliases retain one common scale");
for (const [matrix, expected] of [
  [[[1, 0], [0, 1]], [2, -3]], [[[1, 2], [0, 1]], [-4, -3]], [[[3, 0], [0, 0.5]], [6, -1.5]],
  [[[0, 1], [1, 0]], [-3, 2]], [[[0, -1], [1, 0]], [3, 2]], [[[1, 0], [0, 0]], [2, 0]], [[[0, 0], [0, 0]], [0, 0]],
] as const) {
  const [result] = evaluateAffineConstruction("affine_point", { point: "P", matrix }, context);
  check(result?.kind === "point", "matrix point image kind"); close(result.point.x, expected[0], "independent point x oracle"); close(result.point.y, expected[1], "independent point y oracle");
}
const [firstImage] = evaluateAffineConstruction("affine_point", { point: "P", matrix: [[2, 1], [0, 3]], translation: [4, -2] }, context);
geometries.set("first-image", firstImage);
const [composed] = evaluateAffineConstruction("affine_point", { point: "first-image", matrix: [[1, -2], [3, 1]], translation: [-5, 7] }, context);
check(composed?.kind === "point", "affine outputs must compose"); close(composed.point.x, 22, "BA composed x oracle"); close(composed.point.y, 11, "BA composed y oracle");
const [explicitProduct] = evaluateAffineConstruction("affine_point", { point: "P", matrix: [[2, -5], [6, 6]], translation: [3, 17] }, context);
check(JSON.stringify(explicitProduct) === JSON.stringify(composed), "composition must agree with independently multiplied matrix and translated origin");
const [inversePoint] = evaluateAffineConstruction("affine_point", { point: "first-image", matrix: [[2, 1], [0, 3]], translation: [4, -2], inverse: true }, context);
check(inversePoint?.kind === "point", "inverse point kind"); close(inversePoint.point.x, 2, "inverse x round trip"); close(inversePoint.point.y, -3, "inverse y round trip");
geometries.set("image-region", region);
const [inverseRegion] = evaluateAffineConstruction("affine_path", { path: "image-region", matrix: [[2, 1], [0, -3]], translation: [-1, 5], inverse: true }, context);
check(inverseRegion?.kind === "path" && inverseRegion.closed, "inverse must preserve region topology");
for (const [index, expected] of [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }].entries()) { close(inverseRegion.points[index]!.x, expected.x, "inverse vertex x"); close(inverseRegion.points[index]!.y, expected.y, "inverse vertex y"); }
geometries.set("arrow", { kind: "path", points: [{ x: 0, y: 0 }, { x: 2, y: 3 }], directed: true, infinite: true });
const [rankOneLine] = evaluateAffineConstruction("affine_path", { path: "arrow", matrix: [[1, 1], [0, 0]] }, context);
check(rankOneLine?.kind === "path" && rankOneLine.directed && rankOneLine.infinite, "singular forward map may preserve noncollapsed directed line topology");
close(rankOneLine.points[1]!.x, 5, "rank1 surviving line endpoint");
function rejects(operator: string, inputs: Record<string, unknown>, message: string): void { let threw = false; try { evaluateAffineConstruction(operator, inputs, context); } catch { threw = true; } check(threw, message); }
for (const mutation of [
  { matrix: [[1, 2], [2, 4]], inverse: true }, { matrix: [[1, 1], [1, 1 + 1e-12]], inverse: true }, { matrix: [[1e-7, 0], [0, 1]], inverse: true },
  { matrix: [[1e6 + 1, 0], [0, 1]] }, { matrix: [[Infinity, 0], [0, 1]] }, { matrix: [[NaN, 0], [0, 1]] },
  { matrix: [[null, 0], [0, 1]] }, { matrix: [[false, 0], [0, 1]] }, { matrix: [[" ", 0], [0, 1]] }, { matrix: [[1, 0, 0], [0, 1]] },
  { inverse: "true" }, { translation: [1e12 + 1, 0] }, { translation: [0] }, { translation: { x: 0, y: 0, z: 0 } }, { extra: 1 }, { point: "missing" },
] as const) rejects("affine_point", { point: "P", matrix: [[1, 0], [0, 1]], ...mutation }, "malformed affine point input must reject");
for (const metadata of [{ space: { x: 2, y: -3, z: 1 } }, { electricField: {} }, { conic: {} }, { spaceFrameId: "frame" }]) {
  geometries.set("protected-point", { kind: "point", point: { x: 2, y: -3 }, ...metadata });
  rejects("affine_point", { point: "protected-point", matrix: [[1, 0], [0, 1]] }, "protected point metadata must not be discarded");
}
for (const metadata of [{ spaceLine: {} }, { sampledCurve: {} }, { electricField: {} }, { markedAngleRadians: Math.PI / 3 }, { conic: {} }]) {
  geometries.set("protected-path", { kind: "path", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], ...metadata });
  rejects("affine_path", { path: "protected-path", matrix: [[1, 0], [0, 1]] }, "protected path metadata must not be discarded");
}
rejects("affine_path", { path: "triangle", matrix: [[1, 0], [0, 0]] }, "closed-region rank collapse must reject");
rejects("affine_path", { path: "triangle", matrix: [[1, 1], [1, 1 + 1e-12]] }, "near-singular region transform must reject");
rejects("affine_path", { path: "arrow", matrix: [[0, 0], [0, 0]] }, "path edge collapse must reject");
geometries.set("tiny-line", { kind: "path", points: [{ x: 0, y: 0 }, { x: 1e-4, y: 0 }] });
rejects("affine_path", { path: "tiny-line", matrix: [[1, 0], [0, 1]], translation: [5e11, 0] }, "large placement cannot silently change an edge at floating precision");
geometries.set("oversampled", { kind: "path", points: Array.from({ length: 4097 }, (_, x) => ({ x, y: x })) });
rejects("affine_path", { path: "oversampled", matrix: [[1, 0], [0, 1]] }, "path count cap must reject");
for (const mutate of [
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "k")!.unit = "cm"; },
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "tx")!.unit = "m"; },
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "side")!.unit = "s"; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "map-region")!.inputs.matrix = [[1, 0], [0, 0]]; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "restore-region")!.inputs.path = "restored"; },
  (s: SceneDocument) => { s.entities.find((e) => e.id === "B2")!.kind = "polygon"; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "map-b")!.outputs = ["B2", "A"]; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-b")!.operator = "space_point"; },
] as const) { const candidate = scene(); mutate(candidate); check(structural(candidate).some((i) => i.severity === "fatal"), "invalid affine graph must fail structural checks"); }
if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, validateSceneDocument, isSupportedSceneOperator } = await import("../../src/index");
  const rejectedPrefix = compileSceneDocument(prefixAffine); check(!rejectedPrefix.ok && rejectedPrefix.renderScene === null, "mixed-prefix affine sources reject atomically");
  check(isSupportedSceneOperator("affine_point") && isSupportedSceneOperator("affine_path"), "affine operators must reach executable capabilities");
  const candidate = scene();
  candidate.assertions = [{ id: "mapped-vertex-incidence", predicate: "incident", entities: ["B2", "region2"], expected: true, severity: "fatal" }];
  const compiled = compileSceneDocument(candidate);
  check(compiled.ok && compiled.renderScene, `valid affine scene failed: ${JSON.stringify(compiled.report.issues)}`);
  check(compiled.renderScene.primitives.some((p) => p.entityId === "region2" && p.kind === "polygon"), "affine closed region must render as a complete polygon");
  check(compiled.renderScene.primitives.every((p) => p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))), "affine render points must be finite");
  check(JSON.stringify(compiled.renderScene) === JSON.stringify(compileSceneDocument(candidate).renderScene), "affine scene compile must be deterministic");
  const reordered = structuredClone(candidate); reordered.constructions.reverse();
  check(compileSceneDocument(reordered).ok, "affine dependency chains must compile independently of construction array order");
  const falseAssertion = structuredClone(candidate); falseAssertion.assertions[0]!.expected = false;
  const falseResult = compileSceneDocument(falseAssertion);
  check(!falseResult.ok && falseResult.renderScene === null, "negated mapped-vertex truth must fail atomically");
  for (const mutate of [
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "map-region")!.inputs.matrix = [[1, 0], [0, 0]]; },
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "restore-region")!.inputs.matrix = [[1, 2], [2, 4]]; },
    (s: SceneDocument) => { s.quantities.find((q) => q.id === "k")!.unit = "m"; },
    (s: SceneDocument) => { s.quantities.find((q) => q.id === "tx")!.unit = "mm"; },
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "map-b")!.inputs.matrix = [[1e6 + 1, 0], [0, 1]]; },
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "map-region")!.operator = "affine_magic_region"; },
  ] as const) {
    const bad = structuredClone(candidate); mutate(bad);
    check(!validateSceneDocument(bad).document, "invalid affine scene must fail structural validation");
    const result = compileSceneDocument(bad); check(!result.ok && result.renderScene === null, "invalid affine scene cannot render partial geometry");
  }
  const crossChapter = scene();
  crossChapter.revealGroups.push({ id: "triangle-source", entityIds: [], dependsOn: ["setup"], narrationCue: "transform a verified triangle and its centroid" });
  for (const [id, kind] of [["TA", "point"], ["TB", "point"], ["TC", "point"], ["T", "polygon"], ["T-image", "polygon"], ["centroid", "point"], ["centroid-image", "point"]] as const) {
    crossChapter.entities.push({ id, kind, role: "cross-chapter affine source" }); crossChapter.requiredEntityIds.push(id); crossChapter.revealGroups[2]!.entityIds.push(id);
  }
  crossChapter.constructions.push(
    { id: "source-triangle", operator: "triangle_from_sides", inputs: { sideAB: "side", sideBC: 5, sideCA: 3 }, outputs: ["TA", "TB", "TC", "T"] },
    { id: "affine-triangle", operator: "affine_path", inputs: { path: "T", matrix: [[1, 2], [0, 1]] }, outputs: ["T-image"] },
    { id: "source-centroid", operator: "triangle_center", inputs: { a: "TA", b: "TB", c: "TC", kind: "centroid" }, outputs: ["centroid"] },
    { id: "affine-centroid", operator: "affine_point", inputs: { point: "centroid", matrix: [[2, 0], [0, 2]] }, outputs: ["centroid-image"] },
  );
  const crossIssues = structural(crossChapter);
  check(crossIssues.length === 0, `unknown cross-chapter coordinates must defer without fake values: ${JSON.stringify(crossIssues)}`);
  const crossResult = compileSceneDocument(crossChapter);
  check(crossResult.ok && crossResult.renderScene, `triangle-derived affine sources must compile: ${JSON.stringify(crossResult.report.issues)}`);
  const deferredOverflow = structuredClone(crossChapter);
  deferredOverflow.constructions.find((c) => c.id === "affine-centroid")!.inputs.translation = [1e12, 0];
  check(structural(deferredOverflow).length === 0, "unknown source coordinate overflow must defer to real compile evaluation");
  const overflowResult = compileSceneDocument(deferredOverflow);
  check(!overflowResult.ok && overflowResult.renderScene === null, "deferred source overflow must fail atomically when real coordinates resolve");
  check(!isSupportedSceneOperator("affine_magic_region"), "undeclared affine capability must reject");
}
console.log(`affine operator verification passed (${checks} checks)`);
