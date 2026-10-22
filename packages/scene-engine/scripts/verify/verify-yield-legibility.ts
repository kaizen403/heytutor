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

// 3. An angle name sits inside the wedge its arc marks.
{
  const doc = { entities: [{ id: "O", kind: "point" }, { id: "t", kind: "angle_mark", role: "angle with x", label: "θ" }],
    constructions: [{ id: "make_t", operator: "space_angle_mark", inputs: { vertex: "O" }, outputs: ["t"] }] } as unknown as SceneDocument;
  const vertex = prim("O", "O", "point", [[500, 400]]);
  const arc = prim("arc", "t", "polyline", Array.from({ length: 9 }, (_, i) => [500 + 40 * Math.cos(-i / 8 * Math.PI / 3), 400 + 40 * Math.sin(-i / 8 * Math.PI / 3)] as [number, number]));
  assert.equal(validateAngleLabelWedge(doc, [vertex, arc, prim("lab", "t", "label", [[560, 380]], { text: "θ" })]).length, 0, "a name inside the 0 to 60 degree wedge passes");
  assert.equal(validateAngleLabelWedge(doc, [vertex, arc, prim("lab", "t", "label", [[510, 460]], { text: "θ" })]).length, 1, "a name in the wrong wedge is refused");
}
console.log("yield legibility: tiny figures, 3D axis names, angle names in their wedge");
