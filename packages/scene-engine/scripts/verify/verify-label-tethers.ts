/** Labels must preserve their geometric attachment and stay clear of reserved ink. */
import assert from "node:assert/strict";
import { obstaclesFromPrimitives, placeLabels, workColumnObstacle } from "../../src/labels/labelEngine";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
import { measureTextInkBounds, measureTextWidth } from "@heytutor/drawing";

const blockedPoint = placeLabels(
  [{
    entityId: "A",
    anchor: { x: 600, y: 300 },
    text: "A",
    tetherPx: 56,
    viewBounds: { x: 400, y: 0, width: 760, height: 700 },
  }],
  [{ id: "dense-ink", kind: "geometry", bounds: { x: 550, y: 250, width: 100, height: 100 } }],
);
assert.equal(blockedPoint.ok, false, "a point letter must not escape its tether through a leader fallback");
assert.ok(blockedPoint.issues.length > 0, "a blocked point letter reports its unresolved placement");

const circleCenter = placeLabels(
  [{ entityId: "O", anchor: { x: 600, y: 300 }, text: "O", tetherPx: 56 }],
  obstaclesFromPrimitives([{ id: "circle", entityId: "circle", groupId: "setup", kind: "circle", points: [{ x: 600, y: 300 }], radius: 90 }]),
);
assert.equal(circleCenter.ok, true, "a clear circle interior must remain available for a tethered center label");
const compactCircleCenter = placeLabels(
  [{ entityId: "V", anchor: { x: 600, y: 300 }, text: "V", tetherPx: 56 }],
  obstaclesFromPrimitives([
    { id: "circle", entityId: "circle", groupId: "setup", kind: "circle", points: [{ x: 600, y: 300 }], radius: 47.08 },
    { id: "V", entityId: "V", groupId: "setup", kind: "point", points: [{ x: 600, y: 300 }] },
  ]),
  { measureTextPx: measureTextWidth },
);
assert.equal(compactCircleCenter.ok, true, "compact center labels use nearby clear space while preserving the ink gap");
const disjointAlignedInk = placeLabels(
  [{ entityId: "A", anchor: { x: 600, y: 300 }, text: "A", preferredSlot: "east", allowLeader: false }],
  [{ id: "distant-stroke", kind: "geometry", bounds: { x: 0, y: 0, width: 800, height: 600 }, segments: [[{ x: 100, y: 278 }, { x: 200, y: 278 }]] }],
);
assert.equal(disjointAlignedInk.placements[0]?.slot, "east", "a distant collinear stroke must not displace a label from its clear preferred slot");
const axesInterior = placeLabels(
  [{ entityId: "A", anchor: { x: 670, y: 70 }, text: "A", preferredSlot: "east", allowLeader: false }],
  obstaclesFromPrimitives([{ id: "axes", entityId: "axes", groupId: "setup", kind: "axes", points: [{ x: 400, y: 100 }, { x: 800, y: 100 }, { x: 600, y: 0 }, { x: 600, y: 600 }] }]),
);
assert.equal(axesInterior.placements[0]?.slot, "east", "axes reserve their two strokes without inventing a diagonal between them");
const convergingPoint = placeLabels(
  [{ entityId: "I", anchor: { x: 600, y: 300 }, text: "I", tetherPx: 56, useOwnerBounds: false }],
  obstaclesFromPrimitives([
    { id: "upper", entityId: "upper", groupId: "setup", kind: "polyline", points: [{ x: 519.65, y: 189.93 }, { x: 600, y: 300 }, { x: 650.73, y: 189.93 }] },
    { id: "lower", entityId: "lower", groupId: "setup", kind: "polyline", points: [{ x: 519.65, y: 410.07 }, { x: 600, y: 300 }, { x: 650.73, y: 410.07 }] },
    { id: "axis", entityId: "axis", groupId: "setup", kind: "line", points: [{ x: 400, y: 300 }, { x: 800, y: 300 }] },
    { id: "I", entityId: "I", groupId: "setup", kind: "point", points: [{ x: 600, y: 300 }] },
  ]),
  { measureTextPx: measureTextWidth },
);
assert.equal(convergingPoint.ok, true, "a ray intersection label uses the clear sector without exceeding its point tether");

const protectedPinned = placeLabels(
  [{ entityId: "atom", anchor: { x: 100, y: 100 }, text: "N", pinToAnchor: true }],
  [workColumnObstacle()],
);
assert.equal(protectedPinned.ok, false, "a pinned symbol must not occupy the protected work column");
assert.equal(protectedPinned.placements.length, 0, "rejected pinned ink is not returned as a legal placement");
const clippedScriptCandidate = placeLabels(
  [{
    entityId: "script", anchor: { x: 600, y: 304 }, text: "A_p", preferredSlot: "south", allowLeader: false,
    viewBounds: { x: 400, y: 0, width: 760, height: 350 },
    placementBounds: { x: 400, y: 318, width: 760, height: 32 },
  }],
  [],
  { measureTextPx: measureTextWidth, measureTextInkBounds },
);
assert.equal(clippedScriptCandidate.ok, false, "an ordinary subscript label must keep its actual descender inside the view");

const corridor = [
  { id: "top", kind: "geometry" as const, bounds: { x: 400, y: 0, width: 400, height: 76 } },
  { id: "bottom", kind: "geometry" as const, bounds: { x: 400, y: 124, width: 400, height: 76 } },
  { id: "dense-ink", kind: "geometry" as const, bounds: { x: 400, y: 76, width: 200, height: 48 } },
];
const crossingLeaders = placeLabels(
  [450, 500].map((x, index) => ({
    entityId: index === 0 ? "A" : "B",
    anchor: { x, y: 100 },
    text: index === 0 ? "A" : "B",
    useOwnerBounds: false,
    viewBounds: { x: 400, y: 0, width: 400, height: 200 },
  })),
  corridor,
);
assert.equal(crossingLeaders.ok, true, "a narrow label corridor can use a routed leader while keeping labels readable");
assert.ok(crossingLeaders.placements.some((placement) => placement.leaderPath), "the corridor uses a bend instead of a line through a label");
assertClearLeaders(crossingLeaders.placements);
assertSeparateLeaders(crossingLeaders.placements);
const leaderThroughPinned = placeLabels(
  [
    { entityId: "A", anchor: { x: 450, y: 100 }, text: "A", useOwnerBounds: false, viewBounds: { x: 400, y: 0, width: 400, height: 200 } },
    { entityId: "N", anchor: { x: 650, y: 100 }, text: "N", pinToAnchor: true },
  ],
  corridor,
);
assert.equal(leaderThroughPinned.ok, true, "a leader can route around a pinned atom symbol");
assertClearLeaders(leaderThroughPinned.placements);
const intersectingCallouts = placeLabels(
  [
    { entityId: "A", text: "A", anchor: { x: 450, y: 60 }, useOwnerBounds: false, viewBounds: { x: 400, y: 0, width: 450, height: 300 }, placementBounds: { x: 650, y: 190, width: 150, height: 90 } },
    { entityId: "B", text: "B", anchor: { x: 450, y: 240 }, useOwnerBounds: false, viewBounds: { x: 400, y: 0, width: 450, height: 300 }, placementBounds: { x: 650, y: 20, width: 150, height: 90 } },
  ],
  [],
);
assert.equal(intersectingCallouts.ok, true, "two crossing callouts can take separate bounded routes");
assertClearLeaders(intersectingCallouts.placements);
assertSeparateLeaders(intersectingCallouts.placements);
const sharedAnchorCallouts = placeLabels(
  [
    { entityId: "A", text: "A", anchor: { x: 450, y: 150 }, useOwnerBounds: false, viewBounds: { x: 400, y: 0, width: 450, height: 300 }, placementBounds: { x: 650, y: 190, width: 150, height: 90 } },
    { entityId: "B", text: "B", anchor: { x: 450, y: 150 }, useOwnerBounds: false, viewBounds: { x: 400, y: 0, width: 450, height: 300 }, placementBounds: { x: 650, y: 20, width: 150, height: 90 } },
  ],
  [],
);
assert.equal(sharedAnchorCallouts.ok, true, "separate callouts may meet at their exact shared geometry anchor");
assert.ok(sharedAnchorCallouts.placements.every((placement) => placement.usesLeader), "the shared-anchor regression exercises two real callouts");
assertSeparateLeaders(sharedAnchorCallouts.placements);
const geometrySafeLeader = placeLabels(
  [{
    entityId: "A", anchor: { x: 500, y: 100 }, text: "A",
    viewBounds: { x: 400, y: 0, width: 400, height: 200 },
    placementBounds: { x: 600, y: 50, width: 200, height: 100 },
    leaderGeometrySafe: true,
  }],
  obstaclesFromPrimitives([{ id: "wall", entityId: "wall", groupId: "setup", kind: "line", points: [{ x: 550, y: 50 }, { x: 550, y: 150 }] }]),
);
assert.equal(geometrySafeLeader.ok, true, "a leader reaches the required outside region through a safe elbow");
const safePath = geometrySafeLeader.placements[0]?.leaderPath;
assert.ok(safePath && safePath.length > 2, "geometry clearance uses a routed path");
assert.deepEqual(safePath[0], { x: 500, y: 100 }, "the route begins on the original measured anchor");
for (let index = 1; index < safePath.length; index += 1) {
  const a = safePath[index - 1]!;
  const b = safePath[index]!;
  if ((a.x <= 550 && b.x >= 550) || (b.x <= 550 && a.x >= 550)) {
    const y = a.x === b.x ? (a.y + b.y) / 2 : a.y + ((550 - a.x) / (b.x - a.x)) * (b.y - a.y);
    assert.ok(y < 50 || y > 150, "the leader never crosses the intervening figure stroke");
  }
}

const braceScene: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "a measured span" },
  source: { question: "Draw a measured span AB." },
  quantities: [],
  entities: [
    { id: "A", kind: "point", role: "construction helper" },
    { id: "B", kind: "point", role: "construction helper" },
    { id: "AB", kind: "segment", role: "measured span" },
  ],
  constructions: [
    { id: "a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["A"] },
    { id: "b", operator: "point", inputs: { x: 4, y: 0, coordinateSpace: "world" }, outputs: ["B"] },
    { id: "span", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["AB"] },
  ],
  relations: [],
  assertions: [],
  annotations: [
    { id: "brace", kind: "brace", targetIds: ["AB"], text: "d" },
    { id: "measure", kind: "label", targetIds: ["AB"], text: "4 cm", placementIntent: "below" },
  ],
  requiredEntityIds: ["AB"],
  revealGroups: [{ id: "setup", entityIds: ["AB"], dependsOn: [], narrationCue: "show the measured span" }],
  teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show the measured span" }],
};
const compiledBrace = compileSceneDocument(braceScene);
assert.ok(compiledBrace.ok && compiledBrace.renderScene, "a brace and its measurement must compile");
const brace = compiledBrace.renderScene.primitives.find((primitive) => primitive.kind === "polyline" && primitive.provenance?.annotation === "brace");
const measurement = compiledBrace.renderScene.primitives.find((primitive) => primitive.id === "measure");
const braceLabel = compiledBrace.renderScene.primitives.find((primitive) => primitive.id === "brace_1" && primitive.kind === "label");
const measuredBox = measurement?.provenance?.labelBounds as { x: number; y: number; width: number; height: number } | undefined;
assert.ok(brace && measuredBox, "the brace and measurement have screen geometry");
const cusp = brace.points[2]!;
assert.ok(braceLabel?.points[0], "the brace annotation retains its text");
assert.ok(Math.hypot(braceLabel.points[0].x - cusp.x, braceLabel.points[0].y - cusp.y) >= 24, "brace text must clear the brace cusp instead of being centered on its ink");
assert.ok(
  cusp.x < measuredBox.x || cusp.x > measuredBox.x + measuredBox.width ||
  cusp.y < measuredBox.y || cusp.y > measuredBox.y + measuredBox.height,
  "a measurement label must not sit on the brace cusp",
);

console.log("verify-label-tethers: point attachment, protected space, clear leaders, and annotation clearance");

function assertClearLeaders(placements: ReturnType<typeof placeLabels>["placements"]): void {
  for (const leader of placements) {
    if (!leader.leaderFrom || !leader.leaderTo) continue;
    const path = leader.leaderPath ?? [leader.leaderFrom, leader.leaderTo];
    assert.deepEqual(path[0], leader.leaderFrom, "routing preserves the exact geometry anchor");
    assert.deepEqual(path.at(-1), leader.leaderTo, "routing preserves the exact label endpoint");
    for (const label of placements) {
      const box = label.bounds;
      const gap = label.labelId === leader.labelId ? 0 : 6;
      for (let index = 1; index < path.length; index += 1) {
        const a = path[index - 1]!;
        const b = path[index]!;
        let enter = 0;
        let leave = 1;
        for (const [start, delta, min, max] of [
          [a.x, b.x - a.x, box.x - gap, box.x + box.width + gap],
          [a.y, b.y - a.y, box.y - gap, box.y + box.height + gap],
        ]) {
          if (Math.abs(delta!) < 1e-9) {
            if (start! < min! || start! > max!) { enter = 2; break; }
          } else {
            const near = (min! - start!) / delta!;
            const far = (max! - start!) / delta!;
            enter = Math.max(enter, Math.min(near, far));
            leave = Math.min(leave, Math.max(near, far));
          }
        }
        assert.ok(enter > leave, `leader ${leader.labelId} clears label ${label.labelId}`);
      }
    }
  }
}

function assertSeparateLeaders(placements: ReturnType<typeof placeLabels>["placements"]): void {
  const paths = placements.flatMap((placement) => placement.leaderFrom && placement.leaderTo
    ? [placement.leaderPath ?? [placement.leaderFrom, placement.leaderTo]]
    : []);
  for (let first = 0; first < paths.length; first += 1) for (let second = first + 1; second < paths.length; second += 1) {
    const a = paths[first]!;
    const b = paths[second]!;
    for (let i = 1; i < a.length; i += 1) for (let j = 1; j < b.length; j += 1) {
      const start = a[i - 1]!;
      const end = a[i]!;
      const otherStart = b[j - 1]!;
      const otherEnd = b[j]!;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const ex = otherEnd.x - otherStart.x;
      const ey = otherEnd.y - otherStart.y;
      const denominator = dx * ey - dy * ex;
      const ax = otherStart.x - start.x;
      const ay = otherStart.y - start.y;
      if (Math.abs(denominator) < 1e-9) {
        if (Math.abs(ax * dy - ay * dx) > 1e-6) continue;
        const span = dx * dx + dy * dy;
        if (span < 1e-9) continue;
        const from = (ax * dx + ay * dy) / span;
        const to = ((otherEnd.x - start.x) * dx + (otherEnd.y - start.y) * dy) / span;
        assert.ok(Math.min(1, Math.max(from, to)) - Math.max(0, Math.min(from, to)) <= 1e-6, "two leaders never share an interior stroke");
        continue;
      }
      const t = (ax * ey - ay * ex) / denominator;
      const u = (ax * dy - ay * dx) / denominator;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const hit = { x: start.x + dx * t, y: start.y + dy * t };
      const atSharedAnchor = Math.hypot(hit.x - a[0]!.x, hit.y - a[0]!.y) < 1e-6 &&
        Math.hypot(hit.x - b[0]!.x, hit.y - b[0]!.y) < 1e-6;
      assert.ok(atSharedAnchor, "leader paths stay separate except at an exact shared owner anchor");
    }
  }
}
