import assert from "node:assert/strict";
import { createLeaderGeometryQuery } from "../../src/labels/leaderGeometryQuery";
import { placeLabels, type LabelObstacle } from "../../src/labels/labelEngine";
import type { RenderPoint } from "../../src/types";

const obstacle = (segments: Array<[RenderPoint, RenderPoint]>): LabelObstacle => ({
  id: "ink", kind: "geometry", bounds: { x: -1000, y: -1000, width: 2000, height: 2000 }, segments,
});
const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
for (const [name, segments, expected] of [
  ["crossing", [[{ x: 5, y: -1 }, { x: 5, y: 1 }]], true],
  ["shared anchor contact", [[{ x: 0, y: -1 }, { x: 0, y: 1 }]], false],
  ["contact inside anchor tolerance", [[{ x: 0.049, y: -1 }, { x: 0.049, y: 1 }]], false],
  ["contact outside anchor tolerance", [[{ x: 0.051, y: -1 }, { x: 0.051, y: 1 }]], true],
  ["collinear overlap", [[{ x: 3, y: 0 }, { x: 7, y: 0 }]], true],
  ["collinear endpoint only", [[{ x: 10, y: 0 }, { x: 12, y: 0 }]], false],
  ["near-collinear overlap", [[{ x: 3, y: 1e-8 }, { x: 7, y: 1e-8 }]], true],
  ["parallel outside collinear tolerance", [[{ x: 3, y: 1e-6 }, { x: 7, y: 1e-6 }]], false],
  ["tiny collinear span", [[{ x: 3, y: 0 }, { x: 3 + 1e-9, y: 0 }]], false],
  ["remote", [[{ x: 20, y: -1 }, { x: 20, y: 1 }]], false],
] satisfies Array<[string, Array<[RenderPoint, RenderPoint]>, boolean]>) {
  const query = createLeaderGeometryQuery([obstacle(segments)]);
  assert.equal(query(line), expected, name);
  const reverseExpected = name === "shared anchor contact" || name === "contact inside anchor tolerance" ? true : expected;
  assert.equal(query([...line].reverse()), reverseExpected, `${name} reverse leader`);
}
assert.equal(createLeaderGeometryQuery([obstacle([[{ x: 1e-8, y: 0 }, { x: 2e-8, y: 0 }]])])([{ x: 0, y: 0 }, { x: 1e-8, y: 0 }]), false, "tiny leader is not a collinear crossing");

const strokes = Array.from({ length: 96 }, (_, index): [RenderPoint, RenderPoint] => [
  { x: 50 + index, y: 30 }, { x: 100 + index, y: 60 },
]);
const distant: LabelObstacle[] = [{ id: "distant", kind: "geometry", bounds: { x: 50, y: 30, width: 200, height: 30 }, segments: strokes }];
const owner = { entityId: "field", text: "field", anchor: { x: 700, y: 350 }, requireLeader: true, leaderGeometrySafe: true,
  viewBounds: { x: 410, y: 55, width: 740, height: 555 } };
const originalAbs = Math.abs;
let absoluteCalls = 0;
let result;
try {
  Math.abs = value => { absoluteCalls++; return originalAbs(value); };
  result = placeLabels([owner], distant);
} finally { Math.abs = originalAbs; }
assert.equal(result.ok, true);
assert.deepEqual(result, placeLabels([owner], distant), "deterministic geometry, placement and work");
assert(absoluteCalls < 20_000, `fixed stroke arithmetic must be prepared once, got ${absoluteCalls} abs calls`);
assert.equal(result.solvedBy, "straight");
console.log(`leader geometry: tiny/collinear/contact gates pass; ${absoluteCalls} abs calls`);
