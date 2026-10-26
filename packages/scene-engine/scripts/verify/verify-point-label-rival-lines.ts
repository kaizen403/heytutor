import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { measureTextInkBounds, measureTextWidth } from "@heytutor/drawing";
import { compileSceneDocument } from "../../src/compile/compiler";
import { obstaclesFromPrimitives, placeLabels, POINT_LABEL_TETHER_PX } from "../../src/labels/labelEngine";
import type { RenderPoint, RenderPrimitive, SceneDocument } from "../../src/types";

// A point letter must never sit across another straight line from its own
// point, nearer that line than the point: the reader names the line. The
// recorded ellipse wrote V1 and V2 past the directrices (judged WRONG); here
// they keep their points by drawn leaders, and every label that already sat
// well stays exactly where origin/main put it.

type Fixture = {
  ellipse: SceneDocument;
  ellipseNoDirectrix: SceneDocument;
  tangents: SceneDocument;
  baseLabelCentres: Record<"ellipse" | "ellipseNoDirectrix" | "tangents", Record<string, [number, number]>>;
};
type Box = { x: number; y: number; width: number; height: number };
type Segment = [RenderPoint, RenderPoint];

const fixture = JSON.parse(readFileSync(new URL("./fixtures/point-label-rival-lines.json", import.meta.url), "utf8")) as Fixture;

const HOST_PX = 6;
const STRAIGHT = new Set(["line", "ray", "vector"]);

function compiled(document: SceneDocument, name: string): RenderPrimitive[] {
  const result = compileSceneDocument(structuredClone(document));
  assert.ok(result.ok && result.renderScene, `${name} compiles: ${JSON.stringify(result.report.issues.filter((issue) => issue.severity === "fatal"))}`);
  return result.renderScene.primitives;
}

function pointToSegment(point: RenderPoint, [a, b]: Segment): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function crosses(p: RenderPoint, q: RenderPoint, [a, b]: Segment): boolean {
  const cross = (o: RenderPoint, s: RenderPoint, t: RenderPoint) => (s.x - o.x) * (t.y - o.y) - (s.y - o.y) * (t.x - o.x);
  return cross(p, q, a) * cross(p, q, b) <= 0 && cross(a, b, p) * cross(a, b, q) <= 0;
}

function boxToPoint(box: Box, point: RenderPoint): number {
  return Math.hypot(Math.max(box.x - point.x, 0, point.x - (box.x + box.width)), Math.max(box.y - point.y, 0, point.y - (box.y + box.height)));
}

function boxToSegment(box: Box, segment: Segment): number {
  const corners = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height }];
  const edges: Segment[] = [[corners[0]!, corners[1]!], [corners[1]!, corners[3]!], [corners[3]!, corners[2]!], [corners[2]!, corners[0]!]];
  if (edges.some(([a, b]) => crosses(a, b, segment))) return 0;
  return Math.min(boxToPoint(box, segment[0]), boxToPoint(box, segment[1]), ...corners.map((corner) => pointToSegment(corner, segment)));
}

/** Straight strokes of other entities that do not pass through the point. */
function rivalLines(primitives: RenderPrimitive[], entityId: string, point: RenderPoint): Segment[] {
  return primitives.flatMap((primitive): Segment[] => {
    if (primitive.entityId === entityId || primitive.provenance?.labelLeader) return [];
    const p = primitive.points;
    const segments: Segment[] = primitive.kind === "axes" && p.length === 4 ? [[p[0]!, p[1]!], [p[2]!, p[3]!]]
      : STRAIGHT.has(primitive.kind) && p.length === 2 ? [[p[0]!, p[1]!]] : [];
    return segments.filter((segment) => pointToSegment(point, segment) > HOST_PX);
  });
}

/** Point labels that sit across a rival line, nearer it than their point. */
function violations(primitives: RenderPrimitive[]): string[] {
  const found: string[] = [];
  for (const label of primitives.filter((primitive) => primitive.kind === "label")) {
    const point = primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === label.entityId)?.points[0];
    const box = label.provenance?.labelBounds as Box | undefined;
    if (!point || !box) continue;
    const leader = primitives.find((primitive) => primitive.id === `${label.id}_leader`);
    const rivals = rivalLines(primitives, label.entityId, point);
    if (label.provenance?.usesLeader === true && leader) {
      if (Math.hypot(leader.points[0]!.x - point.x, leader.points[0]!.y - point.y) > 1) found.push(`${label.text}: leader does not start on its point`);
      for (let index = 1; index < leader.points.length; index += 1) {
        if (rivals.some((rival) => crosses(leader.points[index - 1]!, leader.points[index]!, rival))) found.push(`${label.text}: leader crosses a rival line`);
      }
      continue;
    }
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const own = boxToPoint(box, point);
    if (rivals.some((rival) => boxToSegment(box, rival) < own - 1 && crosses(point, centre, rival))) found.push(`${label.text}: across a rival line from its point`);
  }
  return found;
}

function centres(primitives: RenderPrimitive[]): Map<string, RenderPoint> {
  return new Map(primitives.filter((primitive) => primitive.kind === "label").map((primitive) => [primitive.id, primitive.points[0]!]));
}

function assertUnmoved(name: keyof Fixture["baseLabelCentres"], primitives: RenderPrimitive[], except: string[] = []): number {
  const now = centres(primitives);
  let checked = 0;
  for (const [id, [x, y]] of Object.entries(fixture.baseLabelCentres[name])) {
    if (except.includes(id)) continue;
    const centre = now.get(id);
    assert.ok(centre, `${name}: ${id} is still drawn`);
    assert.ok(Math.abs(centre.x - x) < 0.01 && Math.abs(centre.y - y) < 0.01, `${name}: ${id} stays at (${x}, ${y}), got (${centre.x}, ${centre.y})`);
    checked += 1;
  }
  return checked;
}

// 1. The recorded ellipse: V1 and V2 no longer name the directrices. The
// label_attached assertions accept a leader that starts on the point.
const ellipseDocument: SceneDocument = structuredClone(fixture.ellipse);
ellipseDocument.assertions.push(
  { id: "assert_label_V1", predicate: "label_attached", entities: ["V1"], expected: true, severity: "fatal" } as SceneDocument["assertions"][number],
  { id: "assert_label_V2", predicate: "label_attached", entities: ["V2"], expected: true, severity: "fatal" } as SceneDocument["assertions"][number],
);
const ellipse = compiled(ellipseDocument, "ellipse");
assert.deepEqual(violations(ellipse), [], "ellipse: no point label sits across a rival line");
for (const id of ["V1", "V2"]) {
  const label = ellipse.find((primitive) => primitive.id === `primitive_${id}_label`);
  assert.equal(label?.provenance?.usesLeader, true, `${id} keeps its point by a drawn leader`);
}

// 2. Controls: every other label stays exactly where origin/main put it.
const controls = assertUnmoved("ellipse", ellipse, ["primitive_V1_label", "primitive_V2_label"]) +
  assertUnmoved("ellipseNoDirectrix", compiled(fixture.ellipseNoDirectrix, "ellipse without directrices")) +
  assertUnmoved("tangents", compiled(fixture.tangents, "external tangents"));
assert.ok(controls >= 20, `controls cover every recorded label (${controls})`);

// 3. Mutation: put V1 back where origin/main drew it. The check must see it.
const mutated = structuredClone(ellipse).filter((primitive) => primitive.id !== "primitive_V1_label_leader");
const v1 = mutated.find((primitive) => primitive.id === "primitive_V1_label")!;
const [oldX, oldY] = fixture.baseLabelCentres.ellipse.primitive_V1_label!;
const box = v1.provenance!.labelBounds as Box;
assert.ok(Math.hypot(v1.points[0]!.x - oldX, v1.points[0]!.y - oldY) > 20, "mutation moves V1");
v1.points = [{ x: oldX, y: oldY }];
v1.provenance = { ...v1.provenance, usesLeader: false, labelBounds: { ...box, x: oldX - box.width / 2, y: oldY - box.height / 2 } };
assert.deepEqual(violations(mutated), ["V1: across a rival line from its point"], "mutation: V1 across the directrix is caught");

// 4. Escape leaders measure the full ink. A label whose ink overhangs its
// layout box (a subscript, a handwritten tail) is held to the ink, not the em
// box: here the ink of V1 and V2 grows a 30 px lead-in stroke to the left of
// the box whenever they sit beyond the tether (escape leaders are straight, so
// an ink box grown on every side leaves no escape to test), and the escape
// spot chosen must still clear every stroke. Unmeasured ink fails this.
const pointAt = (primitives: RenderPrimitive[], id: string) => primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === id)!.points[0]!;
const anchors = ["V1", "V2"].map((id) => pointAt(ellipse, id));
const overhang = 30;
const overhangingInk = (text: string, x: number, y: number, fontPx: number) => {
  const ink = measureTextInkBounds(text, x, y, fontPx);
  if (!ink || !/^V/.test(text)) return ink;
  const centre = { x: ink.x + ink.width / 2, y: ink.y + ink.height / 2 };
  if (anchors.some((anchor) => Math.hypot(centre.x - anchor.x, centre.y - anchor.y) <= POINT_LABEL_TETHER_PX + 4)) return ink;
  return { x: ink.x - overhang, y: ink.y, width: ink.width + overhang, height: ink.height };
};
const strokesOf = (primitive: RenderPrimitive): Segment[] => {
  const p = primitive.points;
  if (primitive.kind === "axes" && p.length === 4) return [[p[0]!, p[1]!], [p[2]!, p[3]!]];
  return p.slice(1).map((point, index): Segment => [p[index]!, point]);
};
const overhung = compileSceneDocument(structuredClone(fixture.ellipse), { measureLabelInkBounds: overhangingInk });
assert.ok(overhung.ok && overhung.renderScene, "ellipse with overhanging escape ink still compiles");
let escapes = 0;
for (const id of ["V1", "V2"]) {
  const label = overhung.renderScene.primitives.find((primitive) => primitive.id === `primitive_${id}_label`)!;
  if (label.provenance?.usesLeader !== true) continue;
  escapes += 1;
  const box = label.provenance!.labelBounds as Box;
  const ink = overhangingInk(label.text!, box.x + 2, box.y + 2, Number(label.provenance?.fontPx ?? 24))!;
  const hit = overhung.renderScene.primitives
    .filter((primitive) => primitive.entityId !== id && primitive.kind !== "label" && primitive.kind !== "point" && !primitive.provenance?.labelLeader)
    .filter((primitive) => strokesOf(primitive).some((segment) => boxToSegment(ink, segment) === 0))
    .map((primitive) => primitive.id);
  assert.deepEqual(hit, [], `${id}: escape label ink clears every stroke`);
}
assert.ok(escapes >= 1, "the overhang case exercises an escape leader");

// 5. A short triangle side next to a vertex is a rival line, not an angle
// mark. P at a right-angle vertex with legs of 25 px; the hypotenuse AB runs
// 17.7 px from P. With the other sides of P blocked, the letter must not sit
// beyond AB without a leader. A real right-angle square in the same place is
// still read as P's own mark.
const triangleCase = (mark: boolean) => {
  const P = { x: 600, y: 400 }; const A = { x: 625, y: 400 }; const B = { x: 600, y: 375 };
  const primitives = [
    { id: "pt_P", kind: "point", entityId: "P", points: [P] },
    { id: "PA", kind: "line", entityId: "PA", points: [P, A] },
    { id: "PB", kind: "line", entityId: "PB", points: [P, B] },
    mark
      ? { id: "RA", kind: "polyline", entityId: "RA", points: [{ x: 608, y: 400 }, { x: 608, y: 392 }, { x: 600, y: 392 }] }
      : { id: "AB", kind: "line", entityId: "AB", points: [A, B] },
  ] as RenderPrimitive[];
  const block = (id: string, x: number, y: number, width: number, height: number) => ({ id, kind: "protected" as const, bounds: { x, y, width, height } });
  const result = placeLabels(
    [{ entityId: "P", anchor: P, text: "P", tetherPx: POINT_LABEL_TETHER_PX, allowLeader: false, viewBounds: { x: 0, y: 0, width: 1200, height: 700 } }],
    [...obstaclesFromPrimitives(primitives), block("left", P.x - 60, P.y - 60, 60, 120), block("below", P.x, P.y, 60, 60)],
    { fontHeightPx: 24, paddingPx: 2, minGapPx: 3, measureTextPx: measureTextWidth, measureTextInkBounds },
  );
  assert.deepEqual(result.issues, [], `triangle case (${mark ? "mark" : "side"}) places P`);
  return { P, A, B, placement: result.placements[0]! };
};
{
  const { P, A, B, placement } = triangleCase(false);
  const box = placement.bounds;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const acrossSide = boxToSegment(box, [A, B]) < boxToPoint(box, P) - 1 && crosses(P, centre, [A, B]);
  assert.ok(placement.usesLeader === true || !acrossSide, `P does not sit beyond the hypotenuse without a leader: ${JSON.stringify(placement)}`);
  if (placement.usesLeader) assert.ok(placement.leaderFrom && Math.hypot(placement.leaderFrom.x - P.x, placement.leaderFrom.y - P.y) <= 1, "P's leader starts on P");
}
assert.equal(triangleCase(true).placement.usesLeader ?? false, false, "a right-angle square at P is P's own mark, not a rival line");

// 6. Recorded documents where the first version of this rule moved a
// neighbour onto another point (the review of #296 replayed 9,977 recorded
// documents): B beside A's pin, "(8/3,0)" across L1, q+ beside the negative
// charge, V under the focus, A beside a node. Each figure now either reads
// right label by label (every point label nearer its own dot than any other
// dot, or tied to its point by a leader, and never across a rival line) or
// keeps origin/main's layout exactly. Rule off reproduces origin/main.
type Recorded = { documents: Record<string, { recorded: string; document: SceneDocument }>; mainLabels: Record<string, Array<[string, string, number, number]>> };
const recorded = JSON.parse(readFileSync(new URL("./fixtures/point-label-recorded-rivals.json", import.meta.url), "utf8")) as Recorded;
const labelSummary = (primitives: RenderPrimitive[]) => primitives.filter((primitive) => primitive.kind === "label")
  .map((primitive): [string, string, number, number] => [primitive.id, primitive.text ?? "", primitive.points[0]!.x, primitive.points[0]!.y]);
const sameLabels = (a: Array<[string, string, number, number]>, b: Array<[string, string, number, number]>) =>
  a.length === b.length && a.every(([id, text, x, y], index) => b[index]![0] === id && b[index]![1] === text &&
    Math.abs(b[index]![2] - x) < 0.01 && Math.abs(b[index]![3] - y) < 0.01);
/** Point labels nearer another point's dot than their own (within 1 px), with no leader from their own point. */
function misreadDots(primitives: RenderPrimitive[]): string[] {
  const dots = primitives.filter((primitive) => primitive.kind === "point");
  return primitives.filter((primitive) => primitive.kind === "label").flatMap((label) => {
    const own = dots.filter((dot) => dot.entityId === label.entityId);
    const box = label.provenance?.labelBounds as Box | undefined;
    if (own.length === 0 || !box) return [];
    const leader = primitives.find((primitive) => primitive.id === `${label.id}_leader`);
    if (label.provenance?.usesLeader === true && leader && own.some((dot) => Math.hypot(leader.points[0]!.x - dot.points[0]!.x, leader.points[0]!.y - dot.points[0]!.y) <= 1)) return [];
    const ownReach = Math.min(...own.map((dot) => boxToPoint(box, dot.points[0]!)));
    const rival = dots.filter((dot) => dot.entityId !== label.entityId && Math.hypot(dot.points[0]!.x - own[0]!.points[0]!.x, dot.points[0]!.y - own[0]!.points[0]!.y) > HOST_PX)
      .find((dot) => boxToPoint(box, dot.points[0]!) < ownReach + 1);
    return rival ? [`${label.text}: nearer ${rival.entityId}'s dot than its own`] : [];
  });
}
const recordedNames = Object.keys(recorded.documents);
assert.ok(recordedNames.length >= 8, "every recorded case is present");
let repairedFigures = 0;
const verdicts: Record<string, "moved" | "main"> = {};
for (const name of recordedNames) {
  const document = recorded.documents[name]!.document;
  const head = compiled(document, name);
  const off = compileSceneDocument(structuredClone(document), { pointLabelRivals: false });
  assert.ok(off.ok && off.renderScene, `${name}: compiles with the rule off`);
  assert.ok(sameLabels(recorded.mainLabels[name]!, labelSummary(off.renderScene.primitives)), `${name}: the rule off is origin/main's layout`);
  if (sameLabels(recorded.mainLabels[name]!, labelSummary(head))) { verdicts[name] = "main"; continue; }
  verdicts[name] = "moved";
  assert.deepEqual(misreadDots(head), [], `${name}: every point label is nearer its own dot`);
  assert.deepEqual(violations(head), [], `${name}: no point label sits across a rival line`);
  repairedFigures += 1;
}
// The five recorded regressions are repaired, not merely held at main.
for (const name of ["glassBlockPins", "lineIntercepts", "dipoleCharges", "parabolaFocus", "standingWaves"]) {
  assert.equal(verdicts[name], "moved", `${name}: the misread main label is repaired`);
  assert.ok(misreadDots(compileSceneDocument(structuredClone(recorded.documents[name]!.document), { pointLabelRivals: false }).renderScene!.primitives).length +
    violations(compileSceneDocument(structuredClone(recorded.documents[name]!.document), { pointLabelRivals: false }).renderScene!.primitives).length > 0,
  `${name}: origin/main misreads a label here (the control is live)`);
}
// The whole figure guard: here the joint solve repairs "position" but moves
// "final" beside the position dot, which origin/main kept clear. The figure
// keeps origin/main's layout.
assert.equal(verdicts.trajectoryPoints, "main", "trajectoryPoints: a layout that misreads a label main read right falls back to main");
// A figure the rule lays out and a later check then refuses (an escape leader
// counted as the lens's own ink collapsed it to a line) compiles with the
// rule off instead: the rule never costs a figure.
assert.equal(verdicts.lensLeaderFallback, "main", "lensLeaderFallback: compiles, with origin/main's layout");

console.log(`verify-point-label-rival-lines: V1 and V2 leave the directrices by leaders; ${controls} control labels unmoved; mutation caught; escape ink measured; a short triangle side is a rival; ${repairedFigures} recorded figures repaired, the rest keep main's layout`);
