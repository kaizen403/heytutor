/**
 * A gap between two parallel levels that an arrow spans belongs to that
 * arrow: the K arrow from the work function line up to the photon energy line
 * names the band between them. A level's own label written inside such a band
 * reads as the name of the gap, so the work function "φ" set above its line
 * says the kinetic energy is φ. Labels of the spanning arrows stay free; a
 * level's label goes beside its line or on its open side.
 */
import type { RenderPoint } from "../types";
import type { LabelBounds, LabelObstacle, LabelOwner } from "./labelEngine";

/** Overlap id a candidate carries when a level's label sits in a gap an arrow names. */
export const LABEL_IN_NAMED_GAP = "in_named_gap";

const LEVEL_MIN_PX = 40;
const PARALLEL_SIN = Math.sin((2 * Math.PI) / 180);
const ON_LEVEL_PX = 4;
const HOST_PX = 6;
const MIN_GAP_PX = 10;

type Stroke = { entityId: string | undefined; a: RenderPoint; b: RenderPoint };

export interface NamedGap {
  /** Unit direction shared by both levels. */
  tangent: RenderPoint;
  /** Unit normal; the band is normal offsets strictly between `low` and `high`. */
  normal: RenderPoint;
  low: number;
  high: number;
  /** Tangential extent both levels cover. */
  from: number;
  to: number;
  arrowEntityId: string | undefined;
}

const dot = (p: RenderPoint, q: RenderPoint) => p.x * q.x + p.y * q.y;
const length = (s: { a: RenderPoint; b: RenderPoint }) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
const unit = (s: { a: RenderPoint; b: RenderPoint }): RenderPoint => {
  const l = length(s);
  return { x: (s.b.x - s.a.x) / l, y: (s.b.y - s.a.y) / l };
};
const parallel = (u: RenderPoint, v: RenderPoint) => Math.abs(u.x * v.y - u.y * v.x) <= PARALLEL_SIN;

function distanceToSegment(point: RenderPoint, a: RenderPoint, b: RenderPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Levels are drawn lines only. Box edges, frames, polylines and dimension
 * strokes are excluded, since a parallel pair of those bounds a body or a
 * measurement, not a gap between levels.
 */
function levelStrokes(obstacles: LabelObstacle[]): Stroke[] {
  return obstacles
    .filter((obstacle) => obstacle.kind === "geometry" && obstacle.primitiveKind === "line")
    .flatMap((obstacle) => (obstacle.segments ?? []).map(([a, b]) => ({ entityId: obstacle.entityId, a, b })))
    .filter((stroke) => length(stroke) >= LEVEL_MIN_PX);
}

/**
 * Every band between two parallel levels that an arrow square to them joins
 * end to end. An oblique arrow between parallel edges (a ray in a fibre, a
 * vector across a parallelepiped face) names its direction, not the band.
 */
export function namedGaps(obstacles: LabelObstacle[]): NamedGap[] {
  const levels = levelStrokes(obstacles);
  const arrows = obstacles
    .filter((obstacle) => obstacle.kind === "geometry" && obstacle.primitiveKind === "vector")
    .flatMap((obstacle) => (obstacle.segments ?? []).map(([a, b]) => ({ entityId: obstacle.entityId, a, b })))
    .filter((arrow) => length(arrow) >= MIN_GAP_PX);
  const gaps: NamedGap[] = [];
  for (let i = 0; i < levels.length; i++) {
    for (let j = i + 1; j < levels.length; j++) {
      const first = levels[i]!, second = levels[j]!;
      const tangent = unit(first);
      if (!parallel(tangent, unit(second))) continue;
      const normal = { x: -tangent.y, y: tangent.x };
      const offsetFirst = dot(first.a, normal), offsetSecond = dot(second.a, normal);
      if (Math.abs(offsetFirst - offsetSecond) < MIN_GAP_PX) continue;
      const span = (s: Stroke) => [Math.min(dot(s.a, tangent), dot(s.b, tangent)), Math.max(dot(s.a, tangent), dot(s.b, tangent))] as const;
      const [firstFrom, firstTo] = span(first), [secondFrom, secondTo] = span(second);
      const from = Math.max(firstFrom, secondFrom), to = Math.min(firstTo, secondTo);
      if (to - from < LEVEL_MIN_PX) continue;
      const onLine = (point: RenderPoint, offset: number) => Math.abs(dot(point, normal) - offset) <= ON_LEVEL_PX;
      for (const arrow of arrows) {
        if (!parallel(unit(arrow), normal)) continue;
        const joins = (onLine(arrow.a, offsetFirst) && onLine(arrow.b, offsetSecond)) || (onLine(arrow.a, offsetSecond) && onLine(arrow.b, offsetFirst));
        if (!joins) continue;
        gaps.push({
          tangent, normal,
          low: Math.min(offsetFirst, offsetSecond), high: Math.max(offsetFirst, offsetSecond),
          from, to, arrowEntityId: arrow.entityId,
        });
      }
    }
  }
  return gaps;
}

/**
 * The gaps that constrain one owner: those parallel to a level the owner is
 * (its own straight ink) or sits on (a point on that level), named by an
 * arrow that is not the owner.
 */
export function ownerNamedGaps(owner: LabelOwner, obstacles: LabelObstacle[], gaps: NamedGap[]): NamedGap[] {
  if (gaps.length === 0) return gaps;
  const own = obstacles.filter((obstacle) => obstacle.kind === "geometry" && obstacle.entityId === owner.entityId);
  if (own.some((obstacle) => obstacle.primitiveKind === "vector")) return [];
  const ownLevels = levelStrokes(own);
  const hostLevels = own.length > 0 && own.every((obstacle) => obstacle.primitiveKind === "point")
    ? levelStrokes(obstacles).filter((stroke) => distanceToSegment(owner.anchor, stroke.a, stroke.b) <= HOST_PX)
    : [];
  const hosts = [...ownLevels, ...hostLevels];
  if (hosts.length === 0) return [];
  return gaps.filter((gap) => {
    if (gap.arrowEntityId === owner.entityId) return false;
    const hostOnBand = hosts.filter((host) => parallel(unit(host), gap.tangent));
    if (hostOnBand.length === 0) return false;
    // A band that strictly contains a host does not border that host. The
    // outer arrow on a stack of levels must not send a middle level's label
    // across the top line.
    return !hostOnBand.some((host) => {
      const offset = dot(host.a, gap.normal);
      return offset > gap.low + ON_LEVEL_PX && offset < gap.high - ON_LEVEL_PX;
    });
  });
}

export function insideNamedGap(box: LabelBounds, gaps: NamedGap[]): boolean {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const corners = [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height },
  ];
  return gaps.some((gap) => {
    const offset = dot(centre, gap.normal);
    if (offset <= gap.low || offset >= gap.high) return false;
    const along = corners.map((corner) => dot(corner, gap.tangent));
    return Math.max(...along) > gap.from && Math.min(...along) < gap.to;
  });
}
