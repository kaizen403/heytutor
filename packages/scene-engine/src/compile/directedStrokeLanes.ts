import type { RenderPoint, RenderPrimitive, SceneDocument } from "../types";

/**
 * Directed ink never shares a line with other ink.
 *
 * A vector drawn along an axis, a bank, a track or a reference line reads as
 * that line with a stray head: the shaft runs past its head, two heads stack,
 * or the arrow vanishes into the stroke under it. Any directed stroke that
 * lies along another stroke on the same line for `DIRECTED_OVERLAP_PX` or
 * more is drawn in a parallel lane beside it, at full length. Direction and
 * length stay exact; only the lane moves, perpendicular to the stroke.
 *
 * Which stroke moves:
 * - a vector or sign badge on an undirected stroke moves;
 * - of two directed strokes, the one with fewer ends anchored to other ink
 *   moves (a reference ray beside the closing side of a vector triangle, not
 *   the closing side); a ray moves before a vector, then the later stroke.
 * Rays move only beside a vector: a light ray along an optical axis is on it.
 */
export const DIRECTED_OVERLAP_PX = 12;
export const DIRECTED_LANE_PX = 12;
/** Lanes tried on each side, nearest first, before the stroke is left alone. */
const LANE_STEPS_PX = [12, 16, 20, 24, 30, 36];
const ANGLE_SIN = Math.sin(2.5 * Math.PI / 180);
const OFF_LINE_PX = 3;
const ANCHOR_PX = 1.5;

type Point = { x: number; y: number };
interface Segment { owner: number; entityId: string; a: Point; b: Point }
interface Unit {
  index: number;
  entityId: string;
  kind: "vector" | "ray" | "badge";
  primitives: RenderPrimitive[];
  shaft: () => [Point, Point];
  moved: boolean;
}
type Viewport = { x: number; y: number; width: number; height: number };

const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
function unit(a: Point, b: Point): Point { const l = length(a, b) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; }
const cross = (u: Point, v: Point) => u.x * v.y - u.y * v.x;
const offLine = (p: Point, a: Point, u: Point) => Math.abs(cross(u, { x: p.x - a.x, y: p.y - a.y }));
const along = (p: Point, a: Point, u: Point) => u.x * (p.x - a.x) + u.y * (p.y - a.y);
const round = (value: number) => Math.round(value * 100) / 100;

/** Length along `shaft` that `other` covers on the same line, or 0. */
export function collinearOverlapPx(shaft: [Point, Point], other: [Point, Point]): number {
  const [a, b] = shaft;
  const u = unit(a, b);
  if (length(other[0], other[1]) < 0.5 || Math.abs(cross(u, unit(other[0], other[1]))) > ANGLE_SIN) return 0;
  if (offLine(other[0], a, u) > OFF_LINE_PX || offLine(other[1], a, u) > OFF_LINE_PX) return 0;
  const t0 = Math.min(along(other[0], a, u), along(other[1], a, u));
  const t1 = Math.max(along(other[0], a, u), along(other[1], a, u));
  return Math.max(0, Math.min(length(a, b), t1) - Math.max(0, t0));
}

function segmentsOf(primitive: RenderPrimitive, owner: number): Segment[] {
  if (primitive.kind === "label" || primitive.provenance?.labelLeader === true) return [];
  const points = primitive.points;
  const make = (a: Point, b: Point): Segment => ({ owner, entityId: primitive.entityId, a, b });
  switch (primitive.kind) {
    case "vector": case "ray":
      return points.length === 2 ? [make(points[0]!, points[1]!)] : points.slice(1).map((point, index) => make(points[index]!, point));
    case "line": case "polyline": case "dimension": {
      const out: Segment[] = [];
      for (let index = 1; index < points.length; index += 1) {
        const segment = make(points[index - 1]!, points[index]!);
        const last = out.at(-1);
        // Sampled straight runs are many short chords; judge them as one stroke.
        if (last && length(last.b, segment.a) < 0.5 && Math.abs(cross(unit(last.a, last.b), unit(segment.a, segment.b))) < ANGLE_SIN) last.b = segment.b;
        else out.push(segment);
      }
      // A sampled curve is not a line: a velocity drawn tangent to its path
      // leaves the curve. A sampled straight path is one.
      return points.length > 2 && primitive.kind === "polyline" && !straightPolyline(points) ? [] : out;
    }
    case "polygon": case "rectangle":
      return points.map((point, index) => make(point, points[(index + 1) % points.length]!));
    case "axes":
      return points.length === 4 ? [make(points[0]!, points[1]!), make(points[2]!, points[3]!)] : [];
    default: return [];
  }
}

function directedUnits(document: SceneDocument, primitives: RenderPrimitive[]): Unit[] {
  const kindOf = new Map(document.entities.map((entity) => [entity.id, entity.kind]));
  const units: Unit[] = [];
  const badges = new Map<string, RenderPrimitive[]>();
  primitives.forEach((primitive, index) => {
    const kind = kindOf.get(primitive.entityId);
    if (kind === "sign_badge" && primitive.kind === "polyline" && primitive.provenance?.annotationId === undefined) {
      const parts = badges.get(primitive.entityId) ?? [];
      if (parts.length === 0) {
        units.push({
          index, entityId: primitive.entityId, kind: "badge", primitives: parts, moved: false,
          shaft: () => [parts[0]!.points[0]!, parts[0]!.points.at(-1)!],
        });
      }
      parts.push(primitive);
      badges.set(primitive.entityId, parts);
      return;
    }
    if (primitive.id !== `primitive_${primitive.entityId}` || primitive.points.length !== 2) return;
    if (primitive.kind === "vector" && kind !== "ray") {
      units.push({ index, entityId: primitive.entityId, kind: "vector", primitives: [primitive], moved: false, shaft: () => [primitive.points[0]!, primitive.points[1]!] });
    } else if (primitive.kind === "ray") {
      units.push({ index, entityId: primitive.entityId, kind: "ray", primitives: [primitive], moved: false, shaft: () => [primitive.points[0]!, primitive.points[1]!] });
    }
  });
  // A curved (clockwise) badge circles its target; only a straight shaft can lie on it.
  return units.filter((candidate) => candidate.kind !== "badge" || (candidate.primitives.length === 3 && candidate.primitives[0]!.points.length === 2));
}

/**
 * Move every directed stroke that lies along other ink into a parallel lane.
 * Mutates `primitives` in place, records `directedLane` provenance, and
 * returns how many strokes moved.
 */
export function separateDirectedStrokes(
  document: SceneDocument,
  primitives: RenderPrimitive[],
  viewportFor: (entityId: string) => Viewport,
): number {
  const units = directedUnits(document, primitives);
  if (units.length === 0) return 0;
  const unitByPrimitive = new Map<RenderPrimitive, Unit>();
  for (const candidate of units) for (const primitive of candidate.primitives) unitByPrimitive.set(primitive, candidate);
  const segments = (): Segment[] => primitives.flatMap((primitive, index) => {
    const owned = unitByPrimitive.get(primitive);
    // A badge's two head strokes are not lines a vector could run along.
    if (owned?.kind === "badge" && primitive !== owned.primitives[0]) return [];
    return segmentsOf(primitive, index);
  });
  const pointInk = primitives.filter((primitive) => primitive.kind === "point" && primitive.points[0]).map((primitive) => primitive.points[0]!);

  const conflicts = (subject: Unit, shaft: [Point, Point], all: Segment[]): Segment[] => all.filter((segment) =>
    segment.entityId !== subject.entityId && collinearOverlapPx(shaft, [segment.a, segment.b]) >= DIRECTED_OVERLAP_PX);
  const anchoredEnds = (subject: Unit, partner: string, all: Segment[]): number => subject.shaft().filter((end) =>
    pointInk.some((point) => length(point, end) <= ANCHOR_PX) ||
    all.some((segment) => segment.entityId !== subject.entityId && segment.entityId !== partner &&
      (length(segment.a, end) <= ANCHOR_PX || length(segment.b, end) <= ANCHOR_PX))).length;

  for (const subject of units) {
    if (subject.moved) continue;
    let all = segments();
    for (const conflict of conflicts(subject, subject.shaft(), all)) {
      if (subject.moved) break;
      const other = units.find((candidate) => candidate.entityId === conflict.entityId && candidate.primitives.some((primitive) => primitives.indexOf(primitive) === conflict.owner));
      let mover: Unit | null = null;
      if (!other) {
        // An undirected stroke stays; a ray stays on its line unless a vector
        // shares it. A vector whose head is where other directed ink meets
        // (an image arrow's tip on its rays) is where it is.
        mover = subject.kind === "ray" || headMetByDirectedInk(subject, conflict.entityId, all, units, primitives) ? null : subject;
      } else if (sameArrow(subject.shaft(), other.shaft())) {
        // One arrow drawn twice (a light path and the direction it carries)
        // has one head at one end: nothing is hidden or stacked.
        continue;
      } else if (other.moved) {
        mover = subject;
      } else {
        if (subject.kind === "ray" && other.kind === "ray") continue;
        const subjectAnchors = anchoredEnds(subject, other.entityId, all);
        const otherAnchors = anchoredEnds(other, subject.entityId, all);
        mover = subjectAnchors !== otherAnchors
          ? (subjectAnchors < otherAnchors ? subject : other)
          : subject.kind === "ray" ? subject : other.kind === "ray" ? other
          : subject.index > other.index ? subject : other;
      }
      if (!mover || mover.moved) continue;
      moveIntoLane(mover, all, conflicts, viewportFor(mover.entityId), pointInk, primitives);
      all = segments();
    }
  }
  return units.filter((candidate) => candidate.moved).length;
}

function moveIntoLane(
  mover: Unit,
  all: Segment[],
  conflicts: (subject: Unit, shaft: [Point, Point], all: Segment[]) => Segment[],
  viewport: Viewport,
  pointInk: Point[],
  primitives: RenderPrimitive[],
): void {
  const [a, b] = mover.shaft();
  const u = unit(a, b);
  const normal = { x: -u.y, y: u.x };
  const others = all.filter((segment) => segment.entityId !== mover.entityId);
  const center = others.length
    ? others.reduce((sum, segment) => ({ x: sum.x + (segment.a.x + segment.b.x) / 2, y: sum.y + (segment.a.y + segment.b.y) / 2 }), { x: 0, y: 0 })
    : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (others.length) { center.x /= others.length; center.y /= others.length; }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const outward = (mid.x - center.x) * normal.x + (mid.y - center.y) * normal.y;
  // Away from the rest of the figure; on one line, above, then to the right.
  const preferred = Math.abs(outward) > 1 ? Math.sign(outward)
    : Math.abs(normal.y) > 1e-9 ? (normal.y < 0 ? 1 : -1) : (normal.x > 0 ? 1 : -1);
  const offsets = LANE_STEPS_PX.flatMap((step) => [preferred * step, -preferred * step]);
  const inside = (p: Point) => p.x >= viewport.x - 0.5 && p.x <= viewport.x + viewport.width + 0.5 && p.y >= viewport.y - 0.5 && p.y <= viewport.y + viewport.height + 0.5;
  let best: { offset: number; cost: number } | null = null;
  for (const [order, offset] of offsets.entries()) {
    const shifted: [Point, Point] = [
      { x: a.x + normal.x * offset, y: a.y + normal.y * offset },
      { x: b.x + normal.x * offset, y: b.y + normal.y * offset },
    ];
    if (!shifted.every(inside)) continue;
    if (conflicts(mover, shifted, all).length > 0) continue;
    // An arrow leaving the body it acts on crosses that body's outline freely.
    const crossings = others.filter((segment) => properlyCross(shifted, [segment.a, segment.b]) &&
      !closedAround(primitives[segment.owner], shifted[0])).length;
    const dotsOnShaft = pointInk.filter((point) => offLine(point, shifted[0], u) <= OFF_LINE_PX && along(point, shifted[0], u) > 0 && along(point, shifted[0], u) < length(a, b)).length;
    // Nearest lane first; the far side only to avoid crossings or dots.
    const cost = Math.abs(offset) / DIRECTED_LANE_PX + (order % 2) * 0.5 + (crossings + dotsOnShaft) * 4;
    if (!best || cost < best.cost) best = { offset, cost };
  }
  if (!best) return;
  const dx = normal.x * best.offset;
  const dy = normal.y * best.offset;
  for (const primitive of mover.primitives) {
    primitive.points = primitive.points.map((point): RenderPoint => ({ ...point, x: round(point.x + dx), y: round(point.y + dy) }));
    primitive.provenance = { ...primitive.provenance, directedLane: { offsetPx: best.offset, normal: { x: round(normal.x), y: round(normal.y) } } };
  }
  mover.moved = true;
}

/**
 * Another directed stroke passes through the head: a ray through an image
 * tip. A vector starting or ending at this head (head to tail, two heads at
 * one point) does not pin it.
 */
function headMetByDirectedInk(subject: Unit, conflictEntityId: string, all: Segment[], units: Unit[], primitives: RenderPrimitive[]): boolean {
  const [a, head] = subject.shaft();
  const u = unit(a, head);
  const directedOwners = new Set(units.flatMap((candidate) => candidate.kind === "badge" ? [] : candidate.primitives.map((primitive) => primitives.indexOf(primitive))));
  return all.some((segment) => {
    if (segment.entityId === subject.entityId || segment.entityId === conflictEntityId) return false;
    const directed = directedOwners.has(segment.owner) || primitives[segment.owner]?.kind === "ray" || primitives[segment.owner]?.kind === "vector";
    if (!directed || Math.abs(cross(u, unit(segment.a, segment.b))) <= ANGLE_SIN) return false;
    if (distanceToSegment(head, segment.a, segment.b) > ANCHOR_PX) return false;
    return length(head, segment.a) > ANCHOR_PX && length(head, segment.b) > ANCHOR_PX;
  });
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function straightPolyline(points: Point[]): boolean {
  const a = points[0]!; const b = points.at(-1)!;
  if (length(a, b) < 1) return false;
  const u = unit(a, b);
  return points.every((point) => offLine(point, a, u) <= ANCHOR_PX);
}

function closedAround(primitive: RenderPrimitive | undefined, point: Point): boolean {
  if (!primitive || (primitive.kind !== "polygon" && primitive.kind !== "rectangle") || primitive.points.length < 3) return false;
  let inside = false;
  const points = primitive.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!; const b = points[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function sameArrow([a, b]: [Point, Point], [c, d]: [Point, Point]): boolean {
  return length(a, c) <= ANCHOR_PX && length(b, d) <= ANCHOR_PX;
}

function properlyCross([a, b]: [Point, Point], [c, d]: [Point, Point]): boolean {
  const orient = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = orient(a, b, c); const d2 = orient(a, b, d); const d3 = orient(c, d, a); const d4 = orient(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * An unnamed helper point drawn on a vector's shaft reads as a stray mark on
 * the arrow: the ends of an umbrella segment lying along the relative
 * velocity. A dot at a tail (the body acted on) or at a head (a contact)
 * stays, as does a point with a name, a label or a callout.
 */
export function unnamedPointsOnVectors(document: SceneDocument, primitives: RenderPrimitive[]): Set<string> {
  const named = (id: string) => Boolean(document.entities.find((entity) => entity.id === id)?.label?.trim()) ||
    document.annotations.some((annotation) => (annotation.kind === "label" || annotation.kind === "callout") &&
      annotation.targetIds.includes(id) && Boolean(annotation.text?.trim()));
  const kindOf = new Map(document.entities.map((entity) => [entity.id, entity.kind]));
  const vectors = primitives.filter((primitive) => primitive.kind === "vector" && primitive.points.length === 2 && kindOf.get(primitive.entityId) === "vector");
  const hidden = new Set<string>();
  for (const primitive of primitives) {
    if (primitive.kind !== "point" || !primitive.points[0] || kindOf.get(primitive.entityId) !== "point" || named(primitive.entityId)) continue;
    const point = primitive.points[0];
    if (vectors.some((vector) => {
      const [a, b] = vector.points as [Point, Point];
      const u = unit(a, b);
      const t = along(point, a, u);
      // On the shaft between its ends; a contact dot at a tail or a head stays.
      return offLine(point, a, u) <= OFF_LINE_PX && t > OFF_LINE_PX + 1 && t < length(a, b) - OFF_LINE_PX - 1;
    })) hidden.add(primitive.entityId);
  }
  return hidden;
}
