import type { RenderPoint } from "../types";
import type { LabelBounds } from "./labelEngine";

/** An evaluated finite directed path's actual visible screen stroke. */
export interface DirectedLabelStroke {
  entityId: string;
  points: readonly RenderPoint[];
}

export interface StrokeAttachment {
  own: readonly DirectedLabelStroke[];
  competing: readonly DirectedLabelStroke[];
}

export interface StrokeLabelPlacement {
  bounds: LabelBounds;
  usesLeader: boolean;
  leaderFrom?: RenderPoint;
  leaderTo?: RenderPoint;
  leaderPath?: readonly RenderPoint[];
}

/** The compiler rounds visible points to hundredths of a pixel. */
const SCREEN_PRECISION_PX = 0.02;

/** Ownership is supplied by native output identity, never text or an ID pattern. */
export function createStrokeAttachment(
  entityId: string,
  strokes: readonly DirectedLabelStroke[],
): StrokeAttachment | undefined {
  const visible = strokes.filter((stroke) => stroke.points.length >= 2 && stroke.points.every(finitePoint) &&
    stroke.points.some((point, index) => index > 0 && distance(point, stroke.points[index - 1]!) > SCREEN_PRECISION_PX));
  const own = visible.filter((stroke) => stroke.entityId === entityId);
  return own.length ? { own, competing: visible.filter((stroke) => stroke.entityId !== entityId) } : undefined;
}

/**
 * Unled text needs its own stroke's region, rather than the edge of its box.
 * A shared endpoint or coincident path is one visible locus: it cannot prove
 * a different owner. An explicit leader instead witnesses the exact own ink.
 * Collision, view and tether constraints remain the label solver's authority.
 */
export function labelRespectsStrokeAttachment(
  attachment: StrokeAttachment,
  placement: StrokeLabelPlacement,
): boolean {
  if (placement.usesLeader) {
    const path = placement.leaderPath ?? (placement.leaderFrom && placement.leaderTo
      ? [placement.leaderFrom, placement.leaderTo] : []);
    return path.length >= 2 && path.every(finitePoint) && Boolean(placement.leaderFrom && placement.leaderTo) &&
      distance(path[0]!, placement.leaderFrom!) <= SCREEN_PRECISION_PX &&
      distance(path.at(-1)!, placement.leaderTo!) <= SCREEN_PRECISION_PX &&
      nearest(path[0]!, attachment.own).distance <= SCREEN_PRECISION_PX;
  }
  const center = { x: placement.bounds.x + placement.bounds.width / 2, y: placement.bounds.y + placement.bounds.height / 2 };
  const own = nearest(center, attachment.own);
  if (!Number.isFinite(own.distance)) return false;
  return attachment.competing.every((stroke) => {
    const other = nearest(center, [stroke]);
    // Includes shared endpoints and overlapping portions, in either direction.
    if (nearest(other.point, attachment.own).distance <= SCREEN_PRECISION_PX) return true;
    return own.distance + SCREEN_PRECISION_PX < other.distance;
  });
}

function nearest(point: RenderPoint, strokes: readonly DirectedLabelStroke[]): { point: RenderPoint; distance: number } {
  let result = { point, distance: Number.POSITIVE_INFINITY };
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.points.length; index++) {
      const a = stroke.points[index - 1]!, b = stroke.points[index]!;
      const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
      if (squared === 0) continue;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
      const projected = { x: a.x + t * dx, y: a.y + t * dy };
      const separation = distance(point, projected);
      if (separation < result.distance) result = { point: projected, distance: separation };
    }
  }
  return result;
}

function finitePoint(point: RenderPoint): boolean { return Number.isFinite(point.x) && Number.isFinite(point.y); }
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
