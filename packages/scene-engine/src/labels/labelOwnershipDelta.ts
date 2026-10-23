import type { RenderPoint, RenderPrimitive } from "../types";
import { LABEL_OWNERSHIP_CLEAR_MARGIN_PX, obstaclesFromPrimitives, strokeSegmentsToBoundsDistance, type LabelBounds } from "./labelEngine";

type Segment = [RenderPoint, RenderPoint];

/** Same rendered position, to the compiler's hundredth-pixel rounding and a margin. */
const SAME_POSITION_PX = 0.5;
/** A leader starting this close to its owner's own ink is attached to it. */
const LEADER_ON_INK_PX = 1.5;
/**
 * A label's centre must also be this much nearer its own ink than any other
 * stroke except a coordinate frame: a box can clear a stroke's end while its
 * text reads beside another. Frames still count in the box margin.
 */
const CENTRE_OWNERSHIP_RATIO = 1.25;

export interface LabelOwnershipDelta {
  /** True when no label sits less clearly on its owner than MAIN put it. */
  ok: boolean;
  /** Label ids whose text or position differs from MAIN. */
  changed: string[];
  /** Changed labels that fail the ownership comparison. */
  failures: string[];
}

/**
 * Compare a figure's labels with MAIN's placement of the same figure. A label
 * may differ from MAIN only to repair it: MAIN placed it unled and unclearly
 * (its box nearer another entity's stroke than its own ink, or its centre not
 * CENTRE_OWNERSHIP_RATIO nearer its own ink), and the new placement is clear.
 * Clear means an unled box at least the stroke guard's clear margin nearer its
 * own ink with its centre CENTRE_OWNERSHIP_RATIO nearer too, or a leader that
 * starts on its own ink, clear of every other stroke by that margin. A label
 * MAIN placed clearly or led, a label MAIN did not draw, and one it drew that
 * is now missing all fail, and the figure keeps MAIN's placement.
 */
export function compareLabelOwnership(attached: RenderPrimitive[], native: RenderPrimitive[]): LabelOwnershipDelta {
  const attachedInk = ownershipInk(attached);
  const nativeInk = ownershipInk(native);
  const nativeLabels = new Map(native.filter((primitive) => primitive.kind === "label").map((primitive) => [primitive.id, primitive]));
  const attachedLabels = attached.filter((primitive) => primitive.kind === "label");
  const changed: string[] = [];
  const failures: string[] = [];
  for (const label of attachedLabels) {
    const before = nativeLabels.get(label.id);
    nativeLabels.delete(label.id);
    if (before && samePlacement(label, before)) continue;
    changed.push(label.id);
    if (!before || before.text !== label.text || before.entityId !== label.entityId || before.provenance?.usesLeader === true) { failures.push(label.id); continue; }
    const previous = ownership(before, nativeInk);
    if (!previous || clear(previous, 0)) { failures.push(label.id); continue; }
    const after = ownership(label, attachedInk);
    if (!after) { failures.push(label.id); continue; }
    if (label.provenance?.usesLeader === true) {
      const start = attached.find((primitive) => primitive.id === `${label.id}_leader`)?.points[0];
      const at = start ? { x: start.x, y: start.y, width: 0, height: 0 } : undefined;
      const onOwnInk = at && strokeSegmentsToBoundsDistance([...(attachedInk.get(label.entityId) ?? []), ...(attachedInk.get(`frame:${label.entityId}`) ?? [])], at) <= LEADER_ON_INK_PX;
      const clearOfOthers = at && [...attachedInk].every(([entityId, segments]) => entityId === label.entityId || entityId === `frame:${label.entityId}` || entityId.startsWith("point:") ||
        strokeSegmentsToBoundsDistance(segments, at) >= LABEL_OWNERSHIP_CLEAR_MARGIN_PX);
      if (!onOwnInk || !clearOfOthers) failures.push(label.id);
      continue;
    }
    if (!clear(after, LABEL_OWNERSHIP_CLEAR_MARGIN_PX)) failures.push(label.id);
  }
  for (const id of nativeLabels.keys()) { changed.push(id); failures.push(id); }
  return { ok: failures.length === 0, changed, failures };
}

function clear(measure: { margin: number; centreOwn: number; centreForeign: number }, margin: number): boolean {
  return measure.margin >= margin && measure.centreOwn * CENTRE_OWNERSHIP_RATIO <= measure.centreForeign;
}

function samePlacement(a: RenderPrimitive, b: RenderPrimitive): boolean {
  const p = a.points[0], q = b.points[0];
  return a.text === b.text && a.entityId === b.entityId && Boolean(p && q) &&
    Math.abs(p!.x - q!.x) < SAME_POSITION_PX && Math.abs(p!.y - q!.y) < SAME_POSITION_PX &&
    (a.provenance?.usesLeader === true) === (b.provenance?.usesLeader === true);
}

/** Visible ink per entity: strokes, plus point marks for their own entity. */
function ownershipInk(primitives: RenderPrimitive[]): Map<string, Segment[]> {
  const leaders = new Set(primitives.filter((primitive) => primitive.kind === "label").map((primitive) => `${primitive.id}_leader`));
  const ink = new Map<string, Segment[]>();
  const add = (entityId: string, segments: Segment[]) => ink.set(entityId, [...(ink.get(entityId) ?? []), ...segments]);
  const marks = primitives.filter((primitive) => primitive.kind !== "label" && !leaders.has(primitive.id));
  for (const obstacle of obstaclesFromPrimitives(marks)) {
    if (obstacle.kind === "geometry" && obstacle.entityId && obstacle.segments?.length) add(obstacle.primitiveKind === "axes" ? `frame:${obstacle.entityId}` : obstacle.entityId, obstacle.segments);
  }
  for (const point of marks.filter((primitive) => primitive.kind === "point" && primitive.points[0])) {
    add(`point:${point.entityId}`, [[point.points[0]!, point.points[0]!]]);
  }
  return ink;
}

/**
 * Nearest other entity's stroke minus nearest own ink, for the final box, and
 * the same two distances measured from the text centre.
 */
function ownership(label: RenderPrimitive, ink: Map<string, Segment[]>): { margin: number; centreOwn: number; centreForeign: number } | null {
  const box = (label.provenance?.labelCollisionBounds ?? label.provenance?.labelBounds) as LabelBounds | undefined;
  if (!box) return null;
  const ownSegments = [...(ink.get(label.entityId) ?? []), ...(ink.get(`point:${label.entityId}`) ?? []), ...(ink.get(`frame:${label.entityId}`) ?? [])];
  if (ownSegments.length === 0) return null;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2, width: 0, height: 0 };
  const own = strokeSegmentsToBoundsDistance(ownSegments, box);
  const centreOwn = strokeSegmentsToBoundsDistance(ownSegments, centre);
  let foreign = Infinity;
  let centreForeign = Infinity;
  for (const [entityId, segments] of ink) {
    if (entityId === label.entityId || entityId === `frame:${label.entityId}` || entityId.startsWith("point:")) continue;
    foreign = Math.min(foreign, strokeSegmentsToBoundsDistance(segments, box));
    if (!entityId.startsWith("frame:")) centreForeign = Math.min(centreForeign, strokeSegmentsToBoundsDistance(segments, centre));
  }
  return { margin: foreign - own, centreOwn, centreForeign };
}
