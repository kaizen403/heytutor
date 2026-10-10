import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateTurnPlanSceneProofs } from "../../src/contracts/contractsV3";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

// Three error classes from held-out maths: conic inputs the compact contract
// hid, plane equations read as page normals, and 3D directions flattened into
// page glyphs. Each fix keeps its negative cases failing.

function scene(question: string, entities: SceneDocument["entities"], constructions: SceneDocument["constructions"]): SceneDocument {
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "class regression" },
    source: { question }, quantities: [], entities, constructions,
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "scene", entityIds: ids, dependsOn: [], narrationCue: "figure" }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: "figure" }],
  };
}
const fatal = (document: SceneDocument): string[] => {
  const validated = validateSceneDocument(document);
  const codes = validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
  if (!validated.document) return codes.length ? codes : ["no_document"];
  const compiled = compileSceneDocument(validated.document);
  return [...codes, ...compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code)];
};
const origin = { id: "make_o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] };

// Conics: a both-or-neither default drawn range, and consumers that name the broken conic.
function conicScene(conicInputs: Record<string, unknown>, extra: SceneDocument["constructions"] = [], extraEntities: SceneDocument["entities"] = []): SceneDocument {
  return scene("Sketch the conic and mark its features.", [{ id: "o", kind: "point" }, { id: "c", kind: "polyline" }, ...extraEntities],
    [origin, { id: "make_c", operator: "conic", inputs: conicInputs, outputs: ["c"] }, ...extra]);
}
const renderOf = (document: SceneDocument): string => {
  const validated = validateSceneDocument(document);
  assert(validated.document, JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  assert(compiled.ok, JSON.stringify(compiled.report.issues));
  return JSON.stringify(compiled.renderScene!.primitives.map((primitive) => ({ ...primitive, id: undefined })));
};
assert.equal(renderOf(conicScene({ kind: "parabola", vertex: "o", p: 3 })), renderOf(conicScene({ kind: "parabola", vertex: "o", p: 3, tMin: -1.5, tMax: 1.5 })), "omitted parabola range is the default window");
assert.equal(renderOf(conicScene({ kind: "hyperbola", center: "o", a: 4, b: 3 })), renderOf(conicScene({ kind: "hyperbola", center: "o", a: 4, b: 3, tMin: -1.5, tMax: 1.5 })), "omitted hyperbola range is the default window");
assert.deepEqual(fatal(conicScene({ kind: "hyperbola", center: "o", a: 4, b: 3 }, [{ id: "make_as", operator: "conic_asymptotes", inputs: { conic: "c", span: 8 }, outputs: ["as"] }], [{ id: "as", kind: "polyline" }])), [], "hyperbola with asymptotes and default range compiles");
for (const [inputs, reason] of [
  [{ kind: "parabola", vertex: "o", p: 3, tMin: -1 }, "one bound alone"],
  [{ kind: "parabola", p: 3 }, "parabola without vertex"],
  [{ kind: "ellipse", vertex: "o", a: 5, b: 3 }, "ellipse vertex is not its center"],
  [{ kind: "ellipse", center: "o", a: 5, b: 3, tMin: -1, tMax: 1 }, "ellipse takes no range"],
] as Array<[Record<string, unknown>, string]>) assert(fatal(conicScene(inputs)).length > 0, `conic must reject: ${reason}`);
assert(fatal(conicScene({ kind: "hyperbola", center: "o", a: 4, b: 3 }, [{ id: "make_as", operator: "conic_asymptotes", inputs: { conic: "c", span: 8, tMin: -1, tMax: 1 }, outputs: ["as"] }], [{ id: "as", kind: "polyline" }])).length > 0, "asymptotes keep refusing a range");
assert(fatal(conicScene({ kind: "parabola", vertex: "o", p: 3 }, [{ id: "make_q", operator: "conic_anchor", inputs: { conic: "c", feature: "curve_point", at: 2 }, outputs: ["q"] }], [{ id: "q", kind: "point" }])).length > 0, "an anchor outside the default window still fails");
{
  const broken = conicScene({ kind: "parabola", p: 3 },
    [{ id: "make_f", operator: "conic_anchor", inputs: { conic: "c", feature: "focus" }, outputs: ["f"] },
      { id: "make_d", operator: "conic_directrix", inputs: { conic: "c", span: 6 }, outputs: ["d"] }],
    [{ id: "f", kind: "point" }, { id: "d", kind: "line" }]);
  const issues = validateSceneDocument(broken).report.issues.filter((issue) => issue.severity === "fatal");
  assert(issues.some((issue) => issue.code === "invalid_conic_vertex" && issue.path === "constructions[1].inputs.vertex"), "the conic reports its own missing vertex");
  const consumers = issues.filter((issue) => /^invalid_conic_(anchor|directrix)_/.test(issue.code));
  assert(consumers.length > 0 && consumers.every((issue) => issue.path?.endsWith(".inputs.conic")), `consumers point at the broken conic: ${JSON.stringify(consumers)}`);
}

// Page normals: a signed z inside an equation, or z in a 3D frame, is not a page direction.
const plan = (sourceText: string) => ({
  schemaVersion: "turn-plan/v3", question: sourceText, unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
  visualRequirement: "required", givens: [{ id: "g1", symbol: "P", value: 1, provenance: "given", sourceText }],
}) as unknown as Parameters<typeof validateTurnPlanSceneProofs>[1];
const pageIssues = (document: SceneDocument, sourceText: string) =>
  validateTurnPlanSceneProofs(document, plan(sourceText)).filter((issue) => issue.code.startsWith("physical_page_normal"));
const framed = scene("Find the angle between the planes x + y + z = 1 and 2x - y + z = 4.",
  [{ id: "o", kind: "point" }, { id: "frame", kind: "polyline" }, { id: "p1", kind: "polygon" }, { id: "p2", kind: "polygon" }],
  [origin, { id: "make_frame", operator: "space_frame", inputs: { origin: "o" }, outputs: ["frame"] },
    { id: "make_p1", operator: "plane", inputs: { frame: "frame", a: 1, b: 1, c: 1, d: 1 }, outputs: ["p1"] },
    { id: "make_p2", operator: "plane", inputs: { frame: "frame", a: 2, b: -1, c: 1, d: 4 }, outputs: ["p2"] }]);
const flat = scene("Line through the origin.", [{ id: "o", kind: "point" }, { id: "q", kind: "point" }, { id: "s", kind: "segment" }],
  [origin, { id: "make_q", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "world" }, outputs: ["q"] },
    { id: "make_s", operator: "segment", inputs: { start: "o", end: "q" }, outputs: ["s"] }]);
for (const text of ["x + y + z = 1", "2x - y + z = 4", "Coefficient of z in 2x - 2y + z - 3 = 0"]) {
  assert.deepEqual(pageIssues(framed, text), [], `plane equation in a 3D frame is not a page normal: ${text}`);
  assert.deepEqual(pageIssues(flat, text), [], `plane equation arithmetic is not a page normal: ${text}`);
}
assert.deepEqual(pageIssues(framed, "current flows in the +z direction"), [], "z is a drawn axis in a 3D frame");
for (const [document, text] of [
  [flat, "the field points along -z"],
  [flat, "B = -k"],
  [flat, "uniform magnetic field B is directed into the page"],
  [framed, "B = 0.2 T out of the page"],
] as Array<[SceneDocument, string]>) assert(pageIssues(document, text).length > 0, `page normal still required: ${text}`);

// A 3D direction on a planar vector is refused in a framed scene, never turned into a dot.
{
  const withVector = structuredClone(framed);
  withVector.entities.push({ id: "n", kind: "vector" });
  withVector.constructions.push({ id: "make_n", operator: "vector", inputs: { start: "o", direction: [0, 0, 1] }, outputs: ["n"] });
  withVector.requiredEntityIds.push("n"); withVector.revealGroups[0]!.entityIds.push("n");
  const validated = validateSceneDocument(withVector);
  assert(validated.report.issues.some((issue) => issue.code === "vector_world_direction_needs_space_vector"), "framed [0,0,1] vector is refused");
  assert(!validated.document?.constructions.some((construction) => construction.operator === "label" && construction.inputs.text === "•"), "no page dot in a 3D frame");
  const planar = structuredClone(flat);
  planar.entities.push({ id: "n", kind: "vector" });
  planar.constructions.push({ id: "make_n", operator: "vector", inputs: { start: "o", direction: [0, 0, 1] }, outputs: ["n"] });
  planar.requiredEntityIds.push("n"); planar.revealGroups[0]!.entityIds.push("n");
  const planarValidated = validateSceneDocument(planar);
  assert(!planarValidated.report.issues.some((issue) => issue.code === "vector_world_direction_needs_space_vector"), "2D page-normal conversion is unchanged");
}

// Parametric curves: validation reads the parameter like the compiler.
const parametric = (xExpression: string) => scene("Trace the curve.", [{ id: "o", kind: "point" }, { id: "k", kind: "polyline" }],
  [origin, { id: "make_k", operator: "parametric_curve", inputs: { xExpression, yExpression: "sin(t)", tMin: 0, tMax: 3, samples: 65 }, outputs: ["k"] }]);
assert.deepEqual(fatal(parametric("2t")), [], "2t is the product 2*t");
assert.deepEqual(fatal(parametric("cos(2t)")), [], "cos(2t) reads as cos(2*t)");
assert(fatal(parametric("2x")).length > 0, "a stray x in a t expression is refused");

console.log("maths next classes: conic default window and attribution, page-normal scoping, framed vector refusal and parametric reading verified");
