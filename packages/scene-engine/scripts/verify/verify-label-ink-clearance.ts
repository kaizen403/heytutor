import assert from "node:assert/strict";
import { measureTextInkBounds, measureTextWidth, textToStrokePaths } from "@heytutor/drawing";
import { boundsOverlap, obstaclesFromPrimitives, placeLabels } from "../../src/labels/labelEngine";

const metrics = { measureTextPx: measureTextWidth, measureTextInkBounds, minGapPx: 0 };
const owner = { entityId: "script", text: "A_p", anchor: { x: 600, y: 300 }, preferredSlot: "east" as const, allowLeader: false, useOwnerBounds: false };
const clear = placeLabels([owner], [], metrics);
assert.ok(clear.ok && clear.placements[0]);
const original = clear.placements[0].bounds;
const glyphs = await textToStrokePaths(owner.text, original.x + 4, original.y + 4, 24);
const stem = glyphs.find((glyph) => glyph.char === "p")!.strokes[0]!;
const endpoint = stem.pathData.match(/L\s+([-\d.]+)\s+([-\d.]+)\s*$/)!;
const tip = { x: Number(endpoint[1]), y: Number(endpoint[2]) };
assert.ok(tip.y > original.y + original.height, "The rendered subscript stem must really escape the em box");
const narrow = { ...owner, placementBounds: { ...original, height: original.height + 8 } };
const strike = {
  id: "stroke", kind: "geometry" as const,
  bounds: { x: tip.x - 1, y: tip.y - 0.1, width: 2, height: 0.2 },
  segments: [[{ x: tip.x - 1, y: tip.y }, { x: tip.x + 1, y: tip.y }]] as Array<[{ x: number; y: number }, { x: number; y: number }]>,
};
assert.equal(placeLabels([narrow], [strike], metrics).ok, false, "A geometry stroke through the actual descender cannot be accepted outside its em box");

const dashInk = measureTextInkBounds("-", 626, 300, 24)!;
assert.equal(boundsOverlap(original, dashInk), false, "The handwritten dash is clear of the layout box");
assert.ok(boundsOverlap(measureTextInkBounds(owner.text, original.x + 4, original.y + 4, 24)!, dashInk), "The dash really occupies the subscript ink");
assert.equal(placeLabels([narrow], [{ id: "dash-label", kind: "label", bounds: dashInk }], metrics).ok, false, "An existing handwritten label must clear actual script overhang");

const width = measureTextWidth("B", 24) + 8;
const routed = placeLabels([
  { entityId: "script", text: owner.text, anchor: { x: original.x + original.width / 2, y: original.y + original.height / 2 }, pinToAnchor: true },
  { entityId: "B", text: "B", anchor: { x: 550, y: tip.y }, useOwnerBounds: false,
    placementBounds: { x: 710 - width / 2, y: tip.y - 16, width, height: 32 },
    viewBounds: { x: 500, y: 260, width: 280, height: 105 } },
], [], metrics);
assert.ok(routed.ok, "A callout may bend around a subscript instead of rejecting clear space");
const callout = routed.placements.find((placement) => placement.entityId === "B")!;
assert.ok(callout.leaderPath, "The line must bend around the actual descender rather than crossing it below the em box");
const path = callout.leaderPath;
for (let index = 1; index < path.length; index++) {
  const start = path[index - 1]!;
  const end = path[index]!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const along = Math.max(0, Math.min(1, ((tip.x - start.x) * dx + (tip.y - start.y) * dy) / (dx * dx + dy * dy)));
  assert.ok(Math.hypot(tip.x - start.x - along * dx, tip.y - start.y - along * dy) > stem.width / 2,
    "A routed callout must clear the independently rendered subscript stroke");
}
const script = routed.placements.find((placement) => placement.entityId === "script")!;
assert.deepEqual(script.bounds, original, "Real ink reservation must preserve the label's layout and renderer top-left");
const transported = obstaclesFromPrimitives([{
  id: "script-ink", entityId: "script", groupId: "setup", kind: "label", text: owner.text,
  points: [{ x: original.x + original.width / 2, y: original.y + original.height / 2 }],
  provenance: { labelBounds: original, labelCollisionBounds: script.collisionBounds },
}]);
assert.ok(boundsOverlap(transported[0]!.bounds, strike.bounds), "Compiled label obstacles must retain real overhang through presentation");

console.log("verify-label-ink-clearance: real scripts clear geometry, text and callouts without moving their layout");
