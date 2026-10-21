/** 20 Oct switch-on blockers and loss recovery for DIAGRAM_YIELD_POLICY=verified_parts. Offline. */
import { strict as assert } from "node:assert";
import { validateDimensionAnchors, validateFieldLineShape, validatePointLabelPlacement } from "../../src/compile/figureFeatureTruth";
import { ensureStudentFacingPointMarks } from "../../src/document/namedPoints";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { RenderPrimitive, SceneDocument } from "../../src/types";

const prim = (id: string, entityId: string, kind: RenderPrimitive["kind"], points: Array<[number, number]>, extra: Partial<RenderPrimitive> = {}): RenderPrimitive =>
  ({ id, entityId, groupId: "g", kind, points: points.map(([x, y]) => ({ x, y })), ...extra } as RenderPrimitive);

// 1. A dimension must end at something drawn; a line running along it is not an end.
{
  const axis = prim("axis", "axis", "line", [[400, 360], [1100, 360]]);
  const lens = prim("lens", "lens", "line", [[563, 300], [563, 420]]);
  const objectArrow = prim("obj", "object", "vector", [[490, 360], [490, 300]]);
  const dim = prim("d", "u", "dimension", [[490, 360], [563, 360]]);
  assert.equal(validateDimensionAnchors([axis, lens, objectArrow, dim]).length, 0, "object foot and lens centre anchor the dimension");
  assert.equal(validateDimensionAnchors([axis, lens, dim]).length, 1, "with the object elsewhere, the axis alone does not anchor the end");
  const witness = [prim("w1", "u", "line", [[490, 330], [490, 380]]), prim("w2", "u", "line", [[563, 330], [563, 380]])];
  const offsetDim = prim("d2", "u", "dimension", [[490, 375], [563, 375]]);
  assert.equal(validateDimensionAnchors([axis, lens, prim("o2", "object", "vector", [[490, 330], [490, 280]]), offsetDim, ...witness]).length, 0, "an offset dimension is anchored where its witness lines reach");
}

// 2. Field lines are smooth curves, never a few straight sides.
{
  const doc = { entities: [{ id: "fl", kind: "polyline", role: "magnetic field line" }] } as unknown as SceneDocument;
  const hexagon = prim("p", "fl", "polyline", [[0, 0], [40, -20], [80, 0], [80, 40], [40, 60], [0, 40], [0, 0]]);
  assert.equal(validateFieldLineShape(doc, [hexagon]).length, 1, "a hexagonal field line is refused");
  const smooth = prim("s", "fl", "polyline", Array.from({ length: 40 }, (_, i) => [100 * Math.cos(i / 39 * Math.PI), 60 * Math.sin(i / 39 * Math.PI)] as [number, number]));
  assert.equal(validateFieldLineShape(doc, [smooth]).length, 0, "a sampled smooth field line passes");
}

// 3. A point name must sit nearer its point than any stroke not passing through it.
{
  const doc = { entities: [{ id: "O", kind: "point", label: "O" }, { id: "loop", kind: "circle" }], annotations: [] } as unknown as SceneDocument;
  const centre = prim("O", "O", "point", [[600, 400]]);
  const loop = prim("loop", "loop", "circle", [[600, 400]], { radius: 50 });
  assert.equal(validatePointLabelPlacement(doc, [centre, loop, prim("lab", "O", "label", [[600, 345]], { text: "O" })]).length, 1, "O beside the loop, far from the centre, is refused");
  assert.equal(validatePointLabelPlacement(doc, [centre, loop, prim("lab", "O", "label", [[612, 388]], { text: "O" })]).length, 0, "O beside the centre passes");
  assert.equal(validatePointLabelPlacement(doc, [centre, loop, prim("lab", "O", "label", [[600, 345]], { text: "u=3 cm" })]).length, 0, "value labels are not judged as names");
}

// 4. An omitted inferred name is not inferred again under the policy.
{
  const raw = { source: { question: "Draw a concave mirror with its centre of curvature.", diagramYieldPolicy: "verified_parts", yieldUnlabelledPoints: ["centreC"] },
    entities: [{ id: "centreC", kind: "point", role: "centre of curvature" }], constructions: [], requiredEntityIds: ["centreC"], revealGroups: [] };
  const off = ensureStudentFacingPointMarks({ ...raw, source: { question: raw.source.question } }) as { entities: Array<{ label?: string }> };
  const on = ensureStudentFacingPointMarks(raw) as { entities: Array<{ label?: string }> };
  assert.ok(off.entities[0]!.label, "without the record the name is inferred as before");
  assert.equal(on.entities[0]!.label, undefined, "an omitted inferred name stays omitted");
}

// 5. Two directed vectors 120° apart satisfy a 120° claim under the policy.
{
  const doc: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question: "Show the cube roots of unity as vectors.", diagramYieldPolicy: "verified_parts" }, visualDecision: { mode: "scene", reason: "roots" }, quantities: [],
    entities: [{ id: "O", kind: "point", role: "origin", label: "O" }, { id: "v0", kind: "vector", role: "root 1" }, { id: "v1", kind: "vector", role: "root ω" }],
    constructions: [
      { id: "make_O", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
      { id: "make_v0", operator: "vector", inputs: { start: "O", direction: [1, 0], length: 2 }, outputs: ["v0"] },
      { id: "make_v1", operator: "vector", inputs: { start: "O", direction: [-0.5, Math.sqrt(3) / 2], length: 2 }, outputs: ["v1"] },
    ],
    relations: [], annotations: [], requiredEntityIds: ["O", "v0", "v1"],
    assertions: [{ id: "apart", predicate: "angle_between", entities: ["v0", "v1"], expected: { value: 120, unit: "degree" }, severity: "fatal" }],
    revealGroups: [{ id: "all", entityIds: ["O", "v0", "v1"], dependsOn: [], narrationCue: "Roots." }], teachingTimeline: [],
  };
  assert(!compileSceneDocument(doc).report.issues.some((i) => i.code === "assertion_failed"), "the directed 120° angle satisfies the claim");
  const wrong = structuredClone(doc); wrong.assertions[0]!.expected = { value: 60, unit: "degree" };
  assert(compileSceneDocument(wrong).report.issues.some((i) => i.code === "assertion_failed"), "a 60° claim on directed vectors 120° apart still fails");
}
console.log("yield switch blockers: dimension anchors, smooth field lines, point names, omitted names, directed angles");
