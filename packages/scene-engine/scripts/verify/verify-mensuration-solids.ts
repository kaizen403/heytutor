/** General solid operators, independent of any question template or topic router. */
import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "../../src/index";

function candidate(operator: string, inputs: Record<string, unknown>, section = false): unknown {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "mensuration operator probe" },
    source: { question: "Show the given solid and its section." }, quantities: [],
    entities: [
      { id: "center", kind: "point", role: "construction helper point" },
      { id: "solid", kind: "polyline", label: "solid" },
      ...(section ? [{ id: "section", kind: "polyline", label: "section" }] : []),
    ],
    constructions: [
      { id: "origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
      { id: "make_solid", operator, inputs: { center: "center", ...inputs }, outputs: ["solid"] },
      ...(section ? [{ id: "slice", operator: "solid_cross_section", inputs: { solid: "solid", at: 0.5 }, outputs: ["section"] }] : []),
    ], relations: [], annotations: [], assertions: [], requiredEntityIds: section ? ["solid", "section"] : ["solid"],
    revealGroups: [{ id: "setup", entityIds: ["solid"], dependsOn: [], narrationCue: "introduce the solid" }],
    teachingTimeline: [],
  };
}

function compile(raw: unknown) {
  const validated = validateSceneDocument(raw);
  assert(validated.document, JSON.stringify(validated.report.issues));
  const result = compileSceneDocument(validated.document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.deepEqual(compileSceneDocument(validated.document).renderScene, result.renderScene);
  assert(result.renderScene.primitives.every((p) => p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))));
  return { ...result, document: validated.document as SceneDocument };
}

// One extrusion/taper program must handle an arbitrary regular polygon, not
// just a named cube or a square pyramid fixture.
for (const sides of [3, 4, 5, 6, 8, 12]) {
  for (const topScale of [0, 0.4, 1]) {
    const result = compile(candidate("solid_projection", { kind: "polyhedron", base: { kind: "regular_polygon", sides, side: 4 }, height: 7, topScale }, true));
    const contours = result.renderScene!.primitives.filter((p) => p.entityId === "solid" && p.kind === "polyline");
    assert.equal(contours.length, sides + (topScale === 0 ? 1 : 2), "one base, one edge per vertex, and a top unless it is an apex");
    const section = result.renderScene!.primitives.find((p) => p.entityId === "section" && p.kind === "polyline");
    assert(section && section.points.length === sides + 1);
    assert.deepEqual(section.points[0], section.points.at(-1), "sections must be closed");
  }
}
compile(candidate("solid_projection", { kind: "polyhedron", base: { kind: "rectangle", length: 8, width: 5 }, height: 3 }, true));
compile(candidate("solid_projection", { kind: "polyhedron", base: { kind: "polygon", vertices: [[0, 0], [6, 0], [0, 8]] }, height: 10 }, true));
const hollow = compile(candidate("solid_projection", { kind: "cylinder", radius: 5, innerRadius: 3, height: 8 }, true));
assert.equal(hollow.renderScene!.primitives.filter((p) => p.entityId === "solid" && p.kind === "polyline").length, 8);
assert.equal(hollow.renderScene!.primitives.filter((p) => p.entityId === "section" && p.kind === "polyline").length, 2, "a hollow section must retain its hole");

for (const base of [
  { kind: "rectangle", length: 0, width: 5 },
  { kind: "regular_polygon", sides: 2, side: 4 },
  { kind: "polygon", vertices: [[0, 0], [1, 1], [2, 2]] },
  { kind: "polygon", vertices: [[0, 0], [2, 2], [0, 2], [2, 0]] },
]) {
  assert(!validateSceneDocument(candidate("solid_projection", { kind: "polyhedron", base, height: 3 })).document, "degenerate or self-crossing bases must fail closed");
}
for (const innerRadius of [-1, 0, 5, 7]) {
  assert(!validateSceneDocument(candidate("solid_projection", { kind: "cylinder", radius: 5, innerRadius, height: 8 })).document);
}
assert(!validateSceneDocument(candidate("solid_projection", { kind: "cone", radius: 5, innerRadius: 2, height: 8 })).document, "unsupported cavities must not masquerade as solid cones");
console.log("general mensuration solid verification passed");
