import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { obstaclesFromPrimitives, placeLabels, type LabelBounds } from "../../src/labels/labelEngine";
import type { RenderPoint, RenderPrimitive, SceneDocument } from "../../src/types";

// A label names the mark it sits nearest. Recorded lessons (Accelute full
// lesson videos, Oct 2026) wrote a vector's name beside its vertical component
// and a parallelogram's diagonal "R" on its top edge: compass slots were
// anchored on the owner's axis-aligned box, whose east edge is exactly where
// the component of a diagonal vector is drawn. Every label whose owner has
// stroke ink, placed without a leader, must sit no nearer any other entity's
// stroke than its owner's own ink. Measured on the compiled scene.

type Segment = [RenderPoint, RenderPoint];
interface Recorded { capture: string; document: SceneDocument }

const TOLERANCE_PX = 1;
let checks = 0;

function pointToBox(point: RenderPoint, box: LabelBounds): number {
  return Math.hypot(
    Math.max(box.x - point.x, 0, point.x - (box.x + box.width)),
    Math.max(box.y - point.y, 0, point.y - (box.y + box.height)),
  );
}

/** Sampled stroke to box distance: independent of the engine's own geometry helpers. */
function strokeToBox(segments: Segment[], box: LabelBounds): number {
  let best = Infinity;
  for (const [a, b] of segments) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      best = Math.min(best, pointToBox({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, box));
    }
  }
  return best;
}

function strokesByEntity(primitives: RenderPrimitive[]): Map<string, Segment[]> {
  const strokes = new Map<string, Segment[]>();
  const leaders = new Set(primitives.filter((primitive) => primitive.provenance?.labelLeader).map((primitive) => primitive.id));
  for (const obstacle of obstaclesFromPrimitives(primitives.filter((primitive) => primitive.kind !== "label"))) {
    if (obstacle.kind !== "geometry" || !obstacle.entityId || !obstacle.segments?.length || leaders.has(obstacle.id)) continue;
    strokes.set(obstacle.entityId, [...(strokes.get(obstacle.entityId) ?? []), ...obstacle.segments]);
  }
  return strokes;
}

interface Misplaced { text: string; owner: string; own: number; nearest: string; distance: number }

/** Labels of stroke owners (not points, arcs or dimension text) that sit nearer another entity's stroke. */
function misplacedLabels(document: SceneDocument): Misplaced[] {
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, `recorded document must still compile: ${result.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(",")}`);
  const primitives = result.renderScene.primitives;
  const strokes = strokesByEntity(primitives);
  const ownerKinds = new Map<string, Set<string>>();
  for (const primitive of primitives) {
    if (primitive.kind === "label" || primitive.provenance?.labelLeader) continue;
    ownerKinds.set(primitive.entityId, (ownerKinds.get(primitive.entityId) ?? new Set()).add(primitive.kind));
  }
  const misplaced: Misplaced[] = [];
  for (const label of primitives) {
    const box = label.provenance?.labelBounds as LabelBounds | undefined;
    if (label.kind !== "label" || !box || label.provenance?.usesLeader === true || label.provenance?.summary) continue;
    const kinds = ownerKinds.get(label.entityId);
    if (!kinds || [...kinds].some((kind) => kind === "point" || kind === "arc" || kind === "dimension")) continue;
    const ownInk = strokes.get(label.entityId);
    if (!ownInk) continue;
    const own = strokeToBox(ownInk, box);
    let nearest = { id: "", distance: Infinity };
    for (const [id, segments] of strokes) {
      if (id === label.entityId) continue;
      const distance = strokeToBox(segments, box);
      if (distance < nearest.distance) nearest = { id, distance };
    }
    checks += 1;
    if (nearest.distance + TOLERANCE_PX < own) misplaced.push({ text: label.text ?? "", owner: label.entityId, own: Math.round(own), nearest: nearest.id, distance: Math.round(nearest.distance) });
  }
  return misplaced;
}

interface MisplacedPoint { text: string; owner: string; own: number; nearest: string; distance: number }

function segmentPointDistance(p: RenderPoint, a: RenderPoint, b: RenderPoint): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function insidePolygon(p: RenderPoint, points: RenderPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Point names (A, B0, P) nearer another mark than their own point. The marks
 * a name competes with: other dots; strokes that miss the point; and the far
 * ends of strokes through the point (the head of a vector drawn from it, a
 * polygon's other corners). An axis through the point is its frame, a body
 * drawn around the point shares its name, and a vector moved to a lane beside
 * the line it stands for still starts at the point.
 */
function misplacedPointNames(document: SceneDocument): MisplacedPoint[] {
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, "recorded document must still compile");
  const primitives = result.renderScene.primitives;
  const ink = primitives.filter((primitive) => primitive.kind !== "label" && !primitive.provenance?.labelLeader);
  const out: MisplacedPoint[] = [];
  for (const label of primitives) {
    const box = label.provenance?.labelBounds as LabelBounds | undefined;
    if (label.kind !== "label" || !box || label.provenance?.usesLeader || !/^[A-Za-zΑ-ω][A-Za-z0-9₀-₉_]{0,2}$/.test((label.text ?? "").trim())) continue;
    const own = ink.filter((primitive) => primitive.entityId === label.entityId);
    if (own.length !== 1 || own[0]!.kind !== "point") continue;
    const point = own[0]!.points[0]!;
    const ownDistance = pointToBox(point, box);
    let nearest = { id: "", distance: Infinity };
    const consider = (id: string, distance: number) => { if (distance < nearest.distance) nearest = { id, distance }; };
    for (const other of ink) {
      if (other.entityId === label.entityId) continue;
      if (other.kind === "point") {
        if (Math.hypot(other.points[0]!.x - point.x, other.points[0]!.y - point.y) > 3) consider(other.entityId, pointToBox(other.points[0]!, box));
        continue;
      }
      if (!["line", "ray", "vector", "polyline", "polygon", "rectangle", "dimension", "axes"].includes(other.kind)) continue;
      const pts = other.points;
      const closed = (other.kind === "polygon" || other.kind === "rectangle") && pts.length > 2;
      if (closed && insidePolygon(point, pts)) continue;
      const segments: Segment[] = other.kind === "axes" ? [[pts[0]!, pts[1]!], [pts[2]!, pts[3]!]] : pts.slice(1).map((b, i) => [pts[i]!, b] as Segment);
      if (closed) segments.push([pts.at(-1)!, pts[0]!]);
      const lane = other.provenance?.directedLane as { offsetPx: number; normal: RenderPoint } | undefined;
      const at = lane ? { x: point.x + lane.normal.x * lane.offsetPx, y: point.y + lane.normal.y * lane.offsetPx } : point;
      if (!segments.some(([a, b]) => segmentPointDistance(at, a, b) <= 3)) { consider(other.entityId, strokeToBox(segments, box)); continue; }
      if (other.kind === "axes") continue;
      for (const end of closed ? pts : [pts[0]!, pts.at(-1)!]) if (Math.hypot(end.x - at.x, end.y - at.y) > 3) consider(other.entityId, pointToBox(end, box));
    }
    checks += 1;
    if (nearest.distance + TOLERANCE_PX < ownDistance) out.push({ text: label.text ?? "", owner: label.entityId, own: Math.round(ownDistance), nearest: nearest.id, distance: Math.round(nearest.distance) });
  }
  return out;
}

// 1. Recorded planner documents from the lessons where the judges saw it.
const recorded: Recorded[] = JSON.parse(readFileSync(new URL("./fixtures/label-owner-recorded.json", import.meta.url), "utf8"));
assert.ok(recorded.length >= 8, "fixture holds the recorded documents");
const failures = recorded.flatMap(({ capture, document }) => misplacedLabels(document).map((item) => `${capture}: "${item.text}" (${item.owner}) is ${item.own}px from its owner but ${item.distance}px from ${item.nearest}`));
assert.deepEqual(failures, [], `labels nearer another mark than their owner:\n${failures.join("\n")}`);
// Point names: the youtube-full v3 recordings put "A" beside the head of a
// vector drawn from A (p4c-t1) and beside vB's head (p4e1-t2).
const pointFailures = recorded.flatMap(({ capture, document }) => misplacedPointNames(document).map((item) => `${capture}: point name "${item.text}" (${item.owner}) is ${item.own}px from its point but ${item.distance}px from ${item.nearest}`));
assert.ok(recorded.some(({ capture }) => /v3 p4c-t1/.test(capture)) && recorded.some(({ capture }) => /v3 p4e1-t2/.test(capture)), "fixture holds the v3 p4c-t1 and p4e1-t2 documents");
assert.deepEqual(pointFailures, [], `point names nearer another mark than their point:\n${pointFailures.join("\n")}`);

// 2. The resolved-vector case in isolation: a diagonal vector and its vertical
//    component. Its east box slot is the component's own line.
const diagonal: Segment = [{ x: 600, y: 600 }, { x: 800, y: 340 }];
const vertical: Segment = [{ x: 800, y: 600 }, { x: 800, y: 340 }];
const horizontal: Segment = [{ x: 600, y: 600 }, { x: 800, y: 600 }];
const obstacles = obstaclesFromPrimitives([
  { id: "A", entityId: "A", groupId: "g", kind: "vector", points: diagonal },
  { id: "Ay", entityId: "Ay", groupId: "g", kind: "vector", points: vertical },
  { id: "Ax", entityId: "Ax", groupId: "g", kind: "vector", points: horizontal },
]);
const placed = placeLabels([
  { entityId: "A", labelId: "A_label", text: "A = 10 units", anchor: { x: 700, y: 470 }, viewBounds: { x: 400, y: 0, width: 760, height: 700 } },
], obstacles);
assert.ok(placed.ok, JSON.stringify(placed.issues));
const box = placed.placements[0]!.bounds;
const ownA = strokeToBox([diagonal], box);
assert.ok(placed.placements[0]!.usesLeader || ownA + TOLERANCE_PX <= Math.min(strokeToBox([vertical], box), strokeToBox([horizontal], box)),
  `"A = 10 units" must sit nearest the diagonal, got ${JSON.stringify(box)}`);
assert.ok(ownA <= 40, `"A = 10 units" must stay beside its stroke, got ${ownA.toFixed(1)}px`);
checks += 3;

console.log(`verify-label-owner-placement: ${recorded.length} recorded documents, ${checks} checks passed`);
