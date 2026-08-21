/**
 * Screen-space label placement with overlap rejection.
 *
 * Labels are constrained geometry: reserve bounds, score candidate slots,
 * reject unresolved collisions rather than drawing over ink.
 */

import type { RenderPoint, RenderPrimitive } from "../types";

export interface LabelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelOwner {
  /** Stable primitive/annotation id. Defaults to the semantic entity id. */
  labelId?: string;
  entityId: string;
  /** Preferred anchor in screen space (center of owner). */
  anchor: RenderPoint;
  text: string;
  /** Preferred semantic direction from annotation placementIntent. */
  preferredSlot?: Exclude<LabelSlot, "leader">;
  /** Optional view clip region; labels must stay inside. */
  viewBounds?: LabelBounds;
  /** Use the supplied anchor directly instead of the owner's ink bounds. */
  useOwnerBounds?: boolean;
}

export interface LabelObstacle {
  id: string;
  entityId?: string;
  bounds: LabelBounds;
  kind: "geometry" | "label" | "symbol" | "protected";
  /** Precise ink segments. When present, collision uses these instead of the
   * coarse axis-aligned bounds (important for long diagonal rays). */
  segments?: Array<[RenderPoint, RenderPoint]>;
}

export type LabelSlot =
  | "east"
  | "west"
  | "north"
  | "south"
  | "northeast"
  | "northwest"
  | "southeast"
  | "southwest"
  | "leader";

export interface LabelPlacementCandidate {
  slot: LabelSlot;
  bounds: LabelBounds;
  /** Lower is better. */
  score: number;
  overlaps: string[];
  usesLeader: boolean;
  leaderFrom?: RenderPoint;
  leaderTo?: RenderPoint;
}

export interface LabelEngineOptions {
  fontWidthPx?: number;
  fontHeightPx?: number;
  paddingPx?: number;
  minGapPx?: number;
  maxLabelChars?: number;
}

export interface LabelEngineResult {
  ok: boolean;
  placements: Array<{
    labelId: string;
    entityId: string;
    text: string;
    bounds: LabelBounds;
    slot: LabelSlot;
    usesLeader: boolean;
    leaderFrom?: RenderPoint;
    leaderTo?: RenderPoint;
  }>;
  issues: Array<{
    code: "label_overlap_unresolved" | "label_outside_view" | "label_too_long" | "label_duplicate";
    entityId: string;
    message: string;
    overlappingIds?: string[];
  }>;
}

const DEFAULTS = {
  // Matches the 24 px handwritten LABEL renderer used by the board adapter.
  fontWidthPx: 13,
  fontHeightPx: 24,
  paddingPx: 4,
  minGapPx: 6,
  maxLabelChars: 16,
};

const SLOT_OFFSETS: Array<{ slot: Exclude<LabelSlot, "leader">; dx: number; dy: number; preference: number }> = [
  { slot: "east", dx: 1, dy: 0, preference: 0 },
  { slot: "north", dx: 0, dy: -1, preference: 1 },
  { slot: "west", dx: -1, dy: 0, preference: 2 },
  { slot: "south", dx: 0, dy: 1, preference: 3 },
  { slot: "northeast", dx: 1, dy: -1, preference: 4 },
  { slot: "northwest", dx: -1, dy: -1, preference: 5 },
  { slot: "southeast", dx: 1, dy: 1, preference: 6 },
  { slot: "southwest", dx: -1, dy: 1, preference: 7 },
];

const INTERMEDIATE_LEADER_DIRECTIONS = [
  { dx: Math.cos(Math.PI / 8), dy: -Math.sin(Math.PI / 8) },
  { dx: Math.sin(Math.PI / 8), dy: -Math.cos(Math.PI / 8) },
  { dx: -Math.sin(Math.PI / 8), dy: -Math.cos(Math.PI / 8) },
  { dx: -Math.cos(Math.PI / 8), dy: -Math.sin(Math.PI / 8) },
  { dx: -Math.cos(Math.PI / 8), dy: Math.sin(Math.PI / 8) },
  { dx: -Math.sin(Math.PI / 8), dy: Math.cos(Math.PI / 8) },
  { dx: Math.sin(Math.PI / 8), dy: Math.cos(Math.PI / 8) },
  { dx: Math.cos(Math.PI / 8), dy: Math.sin(Math.PI / 8) },
];

interface PreparedLabelOwner {
  owner: LabelOwner;
  originalIndex: number;
  candidates: LabelPlacementCandidate[];
  validCandidates: LabelPlacementCandidate[];
  area: number;
}

export function estimateTextBounds(
  text: string,
  anchor: RenderPoint,
  slot: Exclude<LabelSlot, "leader">,
  options: LabelEngineOptions = {},
): LabelBounds {
  const fontWidthPx = options.fontWidthPx ?? DEFAULTS.fontWidthPx;
  const fontHeightPx = options.fontHeightPx ?? DEFAULTS.fontHeightPx;
  const paddingPx = options.paddingPx ?? DEFAULTS.paddingPx;
  const width = Math.max(8, text.length * fontWidthPx) + paddingPx * 2;
  const height = fontHeightPx + paddingPx * 2;
  const offset = SLOT_OFFSETS.find((entry) => entry.slot === slot) ?? SLOT_OFFSETS[0]!;
  const gap = (options.minGapPx ?? DEFAULTS.minGapPx) + 8;
  const x = anchor.x + offset.dx * (gap + width / 2) - width / 2;
  const y = anchor.y + offset.dy * (gap + height / 2) - height / 2;
  return { x, y, width, height };
}

export function boundsOverlap(a: LabelBounds, b: LabelBounds, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

export function boundsInside(inner: LabelBounds, outer: LabelBounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Place labels greedily in preference order. Unresolved overlaps are fatal
 * issues — callers must reject the scene rather than paint over ink.
 */
export function placeLabels(
  owners: LabelOwner[],
  obstacles: LabelObstacle[],
  options: LabelEngineOptions = {},
): LabelEngineResult {
  const minGapPx = options.minGapPx ?? DEFAULTS.minGapPx;
  const maxLabelChars = options.maxLabelChars ?? DEFAULTS.maxLabelChars;
  const issues: LabelEngineResult["issues"] = [];
  const seenOwnerText = new Set<string>();

  for (const owner of owners) {
    if (owner.text.length > maxLabelChars) {
      issues.push({
        code: "label_too_long",
        entityId: owner.entityId,
        message: `Label for ${owner.entityId} exceeds ${maxLabelChars} characters`,
      });
    }
    const ownerTextKey = `${owner.entityId}\u0000${owner.text}`;
    if (seenOwnerText.has(ownerTextKey)) {
      issues.push({
        code: "label_duplicate",
        entityId: owner.entityId,
        message: `Duplicate label "${owner.text}" for ${owner.entityId}`,
      });
    }
    seenOwnerText.add(ownerTextKey);
  }

  const prepared = owners.map((owner, originalIndex): PreparedLabelOwner => {
    const ownerBounds = owner.useOwnerBounds === false
      ? null
      : unionBounds(
          obstacles.filter((obstacle) => obstacle.entityId === owner.entityId).map((obstacle) => obstacle.bounds),
        );
    const candidates: LabelPlacementCandidate[] = SLOT_OFFSETS.map((slot) => {
      const anchor = ownerBounds ? anchorOnBounds(ownerBounds, slot.slot) : owner.anchor;
      const bounds = estimateTextBounds(owner.text, anchor, slot.slot, options);
      const overlaps = obstacles
        .filter((obstacle) => labelOverlapsObstacle(bounds, obstacle, minGapPx))
        .map((obstacle) => obstacle.id);
      const outside = owner.viewBounds ? !boundsInside(bounds, owner.viewBounds) : false;
      if (outside) overlaps.push("view_clip");
      return {
        slot: slot.slot,
        bounds,
        score: slot.preference + (owner.preferredSlot === slot.slot ? -20 : 0) + overlaps.length * 10 + (outside ? 50 : 0),
        overlaps,
        usesLeader: false,
      };
    });

    const leaderDirections = [
      ...SLOT_OFFSETS.map((direction) => ({
        dx: direction.dx === 0 ? 0 : direction.dx / Math.hypot(direction.dx, direction.dy),
        dy: direction.dy === 0 ? 0 : direction.dy / Math.hypot(direction.dx, direction.dy),
        preference: direction.preference,
        slot: direction.slot,
      })),
      ...INTERMEDIATE_LEADER_DIRECTIONS.map((direction, index) => ({
        ...direction,
        preference: SLOT_OFFSETS.length + index,
        slot: undefined,
      })),
    ];
    const leaderCandidates = leaderDistances(owner.viewBounds).flatMap((distance) =>
      leaderDirections.map((direction) => {
          const center = {
            x: owner.anchor.x + direction.dx * distance,
            y: owner.anchor.y + direction.dy * distance,
          };
          const bounds = centeredTextBounds(owner.text, center, options);
          const overlaps = obstacles
            .filter((obstacle) => labelOverlapsObstacle(bounds, obstacle, minGapPx))
            .map((obstacle) => obstacle.id);
          const outside = owner.viewBounds ? !boundsInside(bounds, owner.viewBounds) : false;
          if (outside) overlaps.push("view_clip");
          return {
            slot: "leader" as const,
            bounds,
            score: 100 + distance + direction.preference +
              (owner.preferredSlot && direction.slot === owner.preferredSlot ? -24 : 0) +
              overlaps.length * 10 + (outside ? 50 : 0),
            overlaps,
            usesLeader: true,
            leaderFrom: owner.anchor,
            leaderTo: center,
          };
        }),
    );
    const allCandidates = deduplicateCandidates([...candidates, ...leaderCandidates])
      .sort((a, b) => a.score - b.score);
    const validCandidates = allCandidates
      .filter((candidate) => candidate.overlaps.length === 0)
      .slice(0, 160);
    const estimated = centeredTextBounds(owner.text, owner.anchor, options);
    return {
      owner,
      originalIndex,
      candidates: allCandidates,
      validCandidates,
      area: estimated.width * estimated.height,
    };
  });

  for (const item of prepared.filter((candidate) => candidate.validCandidates.length === 0)) {
    const best = item.candidates[0];
    if (best?.overlaps.includes("view_clip")) {
      issues.push({
        code: "label_outside_view",
        entityId: item.owner.entityId,
        message: `No in-view label slot for ${item.owner.entityId}`,
      });
      continue;
    }
    issues.push({
      code: "label_overlap_unresolved",
      entityId: item.owner.entityId,
      message: `Unresolved label overlap for ${item.owner.entityId}`,
      overlappingIds: best?.overlaps.filter((id) => id !== "view_clip"),
    });
  }

  const candidatesToSolve = prepared.filter((item) => item.validCandidates.length > 0);
  const selected = solveLabelPlacements(candidatesToSolve, minGapPx);
  if (!selected && candidatesToSolve.length > 0) {
    const mostConstrained = [...candidatesToSolve].sort(comparePreparedOwners)[0]!;
    issues.push({
      code: "label_overlap_unresolved",
      entityId: mostConstrained.owner.entityId,
      message: `No globally collision-free label arrangement for ${mostConstrained.owner.entityId}`,
    });
  }

  const placements: LabelEngineResult["placements"] = selected
    ? prepared.flatMap((item) => {
        const chosen = selected.get(item.originalIndex);
        if (!chosen) return [];
        return [{
          labelId: item.owner.labelId ?? `label:${item.owner.entityId}`,
          entityId: item.owner.entityId,
          text: item.owner.text,
          bounds: chosen.bounds,
          slot: chosen.slot,
          usesLeader: chosen.usesLeader,
          leaderFrom: chosen.leaderFrom,
          leaderTo: chosen.leaderTo,
        }];
      })
    : [];

  return {
    ok: issues.length === 0,
    placements,
    issues,
  };
}

function leaderDistances(viewBounds: LabelBounds | undefined): number[] {
  const maxDistance = viewBounds
    ? Math.ceil(Math.hypot(viewBounds.width, viewBounds.height))
    : 360;
  const distances = [40, 68, 96, 124, 160, 196];
  for (let distance = 228; distance <= maxDistance; distance += 32) distances.push(distance);
  return distances;
}

function deduplicateCandidates(candidates: LabelPlacementCandidate[]): LabelPlacementCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${Math.round(candidate.bounds.x * 10)}:${Math.round(candidate.bounds.y * 10)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function comparePreparedOwners(a: PreparedLabelOwner, b: PreparedLabelOwner): number {
  return a.validCandidates.length - b.validCandidates.length ||
    b.area - a.area ||
    a.originalIndex - b.originalIndex;
}

function solveLabelPlacements(
  owners: PreparedLabelOwner[],
  minGapPx: number,
): Map<number, LabelPlacementCandidate> | null {
  const selected = new Map<number, LabelPlacementCandidate>();
  const remaining = new Set(owners.map((owner) => owner.originalIndex));
  const byIndex = new Map(owners.map((owner) => [owner.originalIndex, owner]));
  let visited = 0;
  const maxVisited = Math.max(20_000, owners.length * 20_000);

  const compatibleCandidates = (owner: PreparedLabelOwner) => owner.validCandidates.filter((candidate) =>
    [...selected.values()].every((placed) => !boundsOverlap(candidate.bounds, placed.bounds, minGapPx)),
  );

  const search = (): boolean => {
    if (remaining.size === 0) return true;
    if (visited >= maxVisited) return false;

    const next = [...remaining]
      .map((index) => {
        const owner = byIndex.get(index)!;
        return { owner, compatible: compatibleCandidates(owner) };
      })
      .sort((a, b) => a.compatible.length - b.compatible.length || comparePreparedOwners(a.owner, b.owner))[0]!;
    if (next.compatible.length === 0) return false;

    remaining.delete(next.owner.originalIndex);
    for (const candidate of next.compatible) {
      visited += 1;
      selected.set(next.owner.originalIndex, candidate);
      if (search()) return true;
      selected.delete(next.owner.originalIndex);
      if (visited >= maxVisited) break;
    }
    remaining.add(next.owner.originalIndex);
    return false;
  };

  return search() ? selected : null;
}

function centeredTextBounds(text: string, center: RenderPoint, options: LabelEngineOptions): LabelBounds {
  const fontWidthPx = options.fontWidthPx ?? DEFAULTS.fontWidthPx;
  const fontHeightPx = options.fontHeightPx ?? DEFAULTS.fontHeightPx;
  const paddingPx = options.paddingPx ?? DEFAULTS.paddingPx;
  const width = Math.max(8, text.length * fontWidthPx) + paddingPx * 2;
  const height = fontHeightPx + paddingPx * 2;
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** Build coarse axis-aligned obstacles from compiled primitives. */
export function obstaclesFromPrimitives(primitives: RenderPrimitive[]): LabelObstacle[] {
  return primitives.flatMap((primitive) => {
    if (primitive.points.length === 0) return [];
    const obstaclePoints = primitive.kind === "arc" && primitive.radius && primitive.startAngle !== undefined && primitive.endAngle !== undefined
      ? sampleArc(primitive.points[0]!, primitive.radius, primitive.startAngle, primitive.endAngle)
      : primitive.points;
    const xs = obstaclePoints.map((point) => point.x);
    const ys = obstaclePoints.map((point) => point.y);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (primitive.kind === "circle" && primitive.radius) {
      minX = Math.min(minX, primitive.points[0]!.x - primitive.radius);
      maxX = Math.max(maxX, primitive.points[0]!.x + primitive.radius);
      minY = Math.min(minY, primitive.points[0]!.y - primitive.radius);
      maxY = Math.max(maxY, primitive.points[0]!.y + primitive.radius);
    }
    const pad = primitive.kind === "label" ? 2 : 4;
    const segments = primitive.kind === "label" || primitive.kind === "point"
      ? undefined
      : pathSegments(obstaclePoints, primitive.kind === "polygon" || primitive.kind === "rectangle" || primitive.kind === "circle");
    return [{
      id: primitive.id,
      entityId: primitive.entityId,
      kind: primitive.kind === "label" ? "label" as const : "geometry" as const,
      segments,
      bounds: {
        x: minX - pad,
        y: minY - pad,
        width: Math.max(4, maxX - minX) + pad * 2,
        height: Math.max(4, maxY - minY) + pad * 2,
      },
    }];
  });
}

function labelOverlapsObstacle(label: LabelBounds, obstacle: LabelObstacle, gap: number): boolean {
  if (!boundsOverlap(label, obstacle.bounds, gap)) return false;
  if (!obstacle.segments || obstacle.segments.length === 0) return true;
  const expanded = {
    x: label.x - gap,
    y: label.y - gap,
    width: label.width + gap * 2,
    height: label.height + gap * 2,
  };
  return obstacle.segments.some(([start, end]) => segmentIntersectsBounds(start, end, expanded));
}

function pathSegments(points: RenderPoint[], closed: boolean): Array<[RenderPoint, RenderPoint]> {
  const segments: Array<[RenderPoint, RenderPoint]> = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1]!, points[index]!]);
  }
  if (closed && points.length > 2) segments.push([points.at(-1)!, points[0]!]);
  return segments;
}

function segmentIntersectsBounds(start: RenderPoint, end: RenderPoint, bounds: LabelBounds): boolean {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const inside = (point: RenderPoint) =>
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  if (inside(start) || inside(end)) return true;
  return segmentsIntersect(start, end, { x: left, y: top }, { x: right, y: top }) ||
    segmentsIntersect(start, end, { x: right, y: top }, { x: right, y: bottom }) ||
    segmentsIntersect(start, end, { x: right, y: bottom }, { x: left, y: bottom }) ||
    segmentsIntersect(start, end, { x: left, y: bottom }, { x: left, y: top });
}

function segmentsIntersect(a: RenderPoint, b: RenderPoint, c: RenderPoint, d: RenderPoint): boolean {
  const cross = (p: RenderPoint, q: RenderPoint, r: RenderPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD <= 0 && cdA * cdB <= 0;
}

function sampleArc(center: RenderPoint, radius: number, startAngle: number, endAngle: number): RenderPoint[] {
  const sweep = endAngle - startAngle;
  return Array.from({ length: 33 }, (_, index) => {
    const angle = startAngle + sweep * index / 32;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

function unionBounds(bounds: LabelBounds[]): LabelBounds | null {
  if (bounds.length === 0) return null;
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function anchorOnBounds(bounds: LabelBounds, slot: Exclude<LabelSlot, "leader">): RenderPoint {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  switch (slot) {
    case "east": return { x: right, y: centerY };
    case "west": return { x: left, y: centerY };
    case "north": return { x: centerX, y: top };
    case "south": return { x: centerX, y: bottom };
    case "northeast": return { x: right, y: top };
    case "northwest": return { x: left, y: top };
    case "southeast": return { x: right, y: bottom };
    case "southwest": return { x: left, y: bottom };
  }
}
