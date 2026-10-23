/** 22 Oct: three legibility checks for DIAGRAM_YIELD_POLICY=verified_parts. Offline. */
import { strict as assert } from "node:assert";
import { validateAngleLabelWedge, validateAxisNamePlacement, validateFigureLegibility } from "../../src/compile/figureFeatureTruth";
import type { RenderPrimitive, SceneDocument } from "../../src/types";

const prim = (id: string, entityId: string, kind: RenderPrimitive["kind"], points: Array<[number, number]>, extra: Partial<RenderPrimitive> = {}): RenderPrimitive =>
  ({ id, entityId, groupId: "g", kind, points: points.map(([x, y]) => ({ x, y })), ...extra } as RenderPrimitive);

// 1. A figure 33 px across is refused; a normal one passes; labels do not count toward size.
assert.equal(validateFigureLegibility([prim("a", "w", "line", [[654, 448], [687, 448]]), prim("b", "w2", "line", [[654, 470], [687, 470]]), prim("l", "w", "label", [[400, 100]], { text: "R" })]).length, 1, "a microscopic figure is refused");
assert.equal(validateFigureLegibility([prim("a", "w", "line", [[500, 300], [900, 300]])]).length, 0, "a readable figure passes");

// 2. Space-frame axis names sit nearest their own axis line.
const frame = [
  prim("primitive_frame_0", "frame", "polyline", [[637, 385], [719, 394]]),
  prim("primitive_frame_1", "frame", "polyline", [[637, 385], [659, 350]]),
  prim("primitive_frame_2", "frame", "polyline", [[637, 385], [637, 308]]),
];
assert.equal(validateAxisNamePlacement([...frame, prim("primitive_frame_label_y", "frame", "label", [[640, 312]], { text: "y" })]).length, 1, "y beside the z axis is refused");
assert.equal(validateAxisNamePlacement([...frame, prim("primitive_frame_label_y", "frame", "label", [[672, 345]], { text: "y" })]).length, 0, "y at its own tip passes");
// Negative half-axes are strokes after 0–2. A name nearer another axis's negative half must still fail.
const negativeX = prim("primitive_frame_3", "frame", "polyline", [[637, 385], [555, 376]]);
const yOnNegativeX = prim("primitive_frame_label_y", "frame", "label", [[558, 378]], { text: "y" });
assert.equal(validateAxisNamePlacement([...frame, negativeX, yOnNegativeX]).length, 1, "y beside another axis's negative half is refused");
assert.equal(validateAxisNamePlacement([...frame, negativeX, prim("primitive_frame_label_y", "frame", "label", [[672, 345]], { text: "y" })]).length, 0, "y at its own tip still passes when a negative half is drawn");
const negativeY = prim("primitive_frame_4", "frame", "polyline", [[637, 385], [615, 420]]);
// A name on its own negative half reads as the axis pointing the wrong way.
assert.equal(validateAxisNamePlacement([...frame, negativeY, prim("primitive_frame_label_y", "frame", "label", [[612, 424]], { text: "y" })]).length, 1, "y at the end of its own negative half is refused");
assert.equal(validateAxisNamePlacement([...frame, negativeY, prim("primitive_frame_label_y", "frame", "label", [[660, 430]], { text: "y" })]).length, 1, "y below the origin, nearer the positive x axis than its own positive half, is refused");
assert.equal(validateAxisNamePlacement([...frame, negativeY, prim("primitive_frame_label_y", "frame", "label", [[672, 345]], { text: "y" })]).length, 0, "y at its own tip passes when its negative half is drawn");

// 3. An angle name sits inside the wedge its arc marks.
{
  const doc = { entities: [{ id: "O", kind: "point" }, { id: "t", kind: "angle_mark", role: "angle with x", label: "θ" }],
    constructions: [{ id: "make_t", operator: "space_angle_mark", inputs: { vertex: "O" }, outputs: ["t"] }] } as unknown as SceneDocument;
  const vertex = prim("O", "O", "point", [[500, 400]]);
  const arc = prim("arc", "t", "polyline", Array.from({ length: 9 }, (_, i) => [500 + 40 * Math.cos(-i / 8 * Math.PI / 3), 400 + 40 * Math.sin(-i / 8 * Math.PI / 3)] as [number, number]));
  assert.equal(validateAngleLabelWedge(doc, [vertex, arc, prim("lab", "t", "label", [[560, 380]], { text: "θ" })]).length, 0, "a name inside the 0 to 60 degree wedge passes");
  assert.equal(validateAngleLabelWedge(doc, [vertex, arc, prim("lab", "t", "label", [[510, 460]], { text: "θ" })]).length, 1, "a name in the wrong wedge is refused");
}
// Greptile #261: 2D angle marks render an arc; an annotation label is omitted, not fatal for the figure.
{
  const doc = { entities: [{ id: "V", kind: "point" }, { id: "a2", kind: "angle_mark", role: "angle at V" }],
    constructions: [{ id: "make_a2", operator: "angle_mark", inputs: { vertex: "V" }, outputs: ["a2"] }],
    annotations: [{ id: "name_a2", kind: "label", targetIds: ["a2"], text: "α" }] } as unknown as SceneDocument;
  const arc2d = prim("arc2d", "a2", "arc", [[500, 400]], { radius: 40, startAngle: -Math.PI / 3, endAngle: 0 });
  const inside = prim("lab", "name_a2", "label", [[560, 382]], { text: "α", provenance: { annotationId: "name_a2" } });
  const outside = prim("lab", "name_a2", "label", [[470, 450]], { text: "α", provenance: { annotationId: "name_a2" } });
  assert.equal(validateAngleLabelWedge(doc, [arc2d, inside]).length, 0, "a 2D arc's name inside its wedge passes");
  const refused = validateAngleLabelWedge(doc, [arc2d, outside]);
  assert.equal(refused.length, 1, "a 2D arc's name outside its wedge is refused");
  assert.equal(refused[0]!.path, "annotations[0].text", "an annotation name points at its own text so it can be omitted");
  const second = prim("lab2", "name_a2b", "label", [[470, 450]], { text: "beta", provenance: { annotationId: "name_a2b" } });
  const both = { ...doc, annotations: [...doc.annotations, { id: "name_a2b", kind: "label", targetIds: ["a2"], text: "beta" }] } as unknown as SceneDocument;
  const extra = validateAngleLabelWedge(both, [arc2d, inside, second]);
  assert.equal(extra.length, 1, "a second name on the same angle is checked, not skipped");
  assert.equal(extra[0]!.path, "annotations[1].text", "the failed second name points at its own text");
}
{
  const doc = { entities: [{ id: "O", kind: "point" }, { id: "t", kind: "angle_mark", role: "angle with x", label: "θ" }],
    constructions: [{ id: "make_t", operator: "space_angle_mark", inputs: { vertex: "O" }, outputs: ["t"] }] } as unknown as SceneDocument;
  const arc = prim("arc", "t", "polyline", Array.from({ length: 9 }, (_, i) => [500 + 40 * Math.cos(-i / 8 * Math.PI / 3), 400 + 40 * Math.sin(-i / 8 * Math.PI / 3)] as [number, number]));
  const shared = prim("O2", "O2", "point", [[500, 400]]);
  const misplaced = prim("lab", "t", "label", [[510, 460]], { text: "θ" });
  const unresolved = validateAngleLabelWedge(doc, [shared, arc, misplaced]);
  assert.equal(unresolved.length, 1, "a drawn arc and name whose vertex cannot be found are refused, not skipped");
  assert.equal(unresolved[0]!.path, "entities[1].label", "the unprovable name points at its own text");
  assert.equal(validateAngleLabelWedge(doc, [shared, arc, prim("lab", "t", "label", [[560, 380]], { text: "θ" })]).length, 1, "even a name that looks inside is refused when the vertex cannot be found");
  assert.equal(validateAngleLabelWedge(doc, [shared, arc, misplaced], new Map([["O", "O1"], ["O1", "O2"]])).length, 1, "a two hop alias chain is followed to the drawn vertex");
  assert.equal(validateAngleLabelWedge(doc, [shared, arc, prim("lab", "t", "label", [[560, 380]], { text: "θ" })], new Map([["O", "O1"], ["O1", "O2"]])).length, 0, "a name inside the wedge passes through a two hop alias");
  assert.equal(validateAngleLabelWedge(doc, [shared, arc, misplaced], new Map([["O", "O1"], ["O1", "O"]])).length, 1, "an alias cycle ends and the name is refused");
  assert.equal(validateAngleLabelWedge(doc, [shared, arc, misplaced], new Map([["O", "O2"]])).length, 1, "an aliased shared vertex still refuses a name outside the wedge");
}
console.log("yield legibility: tiny figures, 3D axis names, angle names in their wedge");
