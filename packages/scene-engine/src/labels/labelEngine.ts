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
  /** Glyph-only region, such as the outside half-plane of a dimension bar. */
  placementBounds?: LabelBounds;
  /** Use the supplied anchor directly instead of the owner's ink bounds. */
  useOwnerBounds?: boolean;
  /** Unit screen-space tangents of strokes that meet this anchor. */
  incidentTangents?: RenderPoint[];
  /** Max center-to-anchor distance for a tethered owner (point letters). */
  tetherPx?: number;
  /** Distant leader slots. Default true; point letters set false. */
  allowLeader?: boolean;
  /** A moved callout must retain an explicit connector to its exact anchor. */
  requireLeader?: boolean;
  /** Keep the entire leader off other geometry; contact at its anchor is legal. */
  leaderGeometrySafe?: boolean;
  /**
   * Sit on the anchor instead of offsetting to a compass slot. Used for
   * values that belong inside a cell, node, or edge — not beside it.
   */
  pinToAnchor?: boolean;
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
  /** Extra rendered ink outside the layout box; never changes the text origin. */
  collisionBounds?: LabelBounds;
  /** Lower is better. */
  score: number;
  overlaps: string[];
  usesLeader: boolean;
  leaderFrom?: RenderPoint;
  leaderTo?: RenderPoint;
  /** Exact endpoints with optional orthogonal bends to clear neighboring text. */
  leaderPath?: RenderPoint[];
}

export interface LabelEngineOptions {
  fontWidthPx?: number;
  fontHeightPx?: number;
  paddingPx?: number;
  minGapPx?: number;
  maxLabelChars?: number;
  /**
   * The renderer's own advance width for this run, at the height it will be
   * drawn. Without it the engine falls back to `length * fontWidthPx`, which
   * is an average character box: it reserves 15-35% more room than the glyphs
   * occupy, and — because the run is drawn from the box's left edge, not its
   * centre — leaves the ink sitting off-centre inside what was reserved.
   */
  measureTextPx?: (text: string, fontHeightPx: number) => number;
  /** Actual renderer ink at the top-left run position, including scripts. */
  measureTextInkBounds?: (text: string, x: number, y: number, fontHeightPx: number) => LabelBounds | null;
}

export interface LabelEngineResult {
  ok: boolean;
  placements: Array<{
    labelId: string;
    entityId: string;
    text: string;
    bounds: LabelBounds;
    collisionBounds?: LabelBounds;
    slot: LabelSlot;
    usesLeader: boolean;
    leaderFrom?: RenderPoint;
    leaderTo?: RenderPoint;
    leaderPath?: RenderPoint[];
  }>;
  issues: Array<{
    code: "label_overlap_unresolved" | "label_outside_view" | "label_too_long" | "label_duplicate" | "label_unattached";
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

export const POINT_LABEL_TETHER_PX = 56;
const INCIDENT_ALIGN = Math.cos((25 * Math.PI) / 180);

/**
 * Clear air between a leader's tip and the label it points at.
 *
 * A leader used to run to the label's centre, so every leader-placed label was
 * drawn with a line through its glyphs — the single largest source of ink and
 * handwriting sitting on top of each other on the board.
 */
const LEADER_STANDOFF_PX = 5;

/** Under this the label already sits on its anchor and a line adds nothing. */
const MIN_LEADER_PX = 12;

/** Left work column is not a legal diagram-label home. */
export function workColumnObstacle(): LabelObstacle {
  return {
    id: "work_column",
    kind: "protected",
    bounds: { x: 0, y: 0, width: 400, height: 700 },
  };
}

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

const FINE_LEADER_DIRECTIONS = Array.from({ length: 16 }, (_, index) => {
  const angle = ((index * 2 + 1) * Math.PI) / 16;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
});

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
  return textBoundsAtSlot(text, anchor, slot, options, (options.minGapPx ?? DEFAULTS.minGapPx) + 8);
}

function textBoundsAtSlot(
  text: string,
  anchor: RenderPoint,
  slot: Exclude<LabelSlot, "leader">,
  options: LabelEngineOptions,
  gap: number,
): LabelBounds {
  const paddingPx = options.paddingPx ?? DEFAULTS.paddingPx;
  const width = textInkWidth(text, options) + paddingPx * 2;
  const height = textInkHeight(options) + paddingPx * 2;
  const offset = SLOT_OFFSETS.find((entry) => entry.slot === slot) ?? SLOT_OFFSETS[0]!;
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

  // A pinned label is ink the other labels must clear. A bond-angle label was
  // free to land on a pinned atom symbol because the symbol never entered the
  // obstacle list; a skeletal structure has no circle around its heteroatoms.
  const pinnedBounds = owners.map((owner) => owner.pinToAnchor
    ? centeredTextBounds(owner.text, owner.anchor, options)
    : null);
  const pinnedInkBounds = owners.map((owner, index) => {
    const bounds = pinnedBounds[index];
    if (!bounds || !options.measureTextInkBounds) return bounds;
    const padding = options.paddingPx ?? DEFAULTS.paddingPx;
    return options.measureTextInkBounds(owner.text, bounds.x + padding, bounds.y + padding,
      options.fontHeightPx ?? DEFAULTS.fontHeightPx) ?? bounds;
  });
  const pinnedObstacles: LabelObstacle[] = owners.flatMap((owner, index) => {
    const bounds = pinnedBounds[index];
    return bounds ? [{
      id: owner.labelId ?? `pinned_${owner.entityId}`,
      entityId: owner.entityId,
      bounds: extendForInk(bounds, pinnedInkBounds[index]),
      kind: "label" as const,
    }] : [];
  });
  const solverObstacles = pinnedObstacles.length > 0 ? [...obstacles, ...pinnedObstacles] : obstacles;

  const prepared = owners.map((owner, originalIndex): PreparedLabelOwner => {
    if (owner.pinToAnchor) {
      const bounds = centeredTextBounds(owner.text, owner.anchor, options);
      const ink = pinnedInkBounds[originalIndex];
      const collisionBounds = extendForInk(bounds, ink);
      const outside = outsideOwnerView(collisionBounds, owner);
      const protectedHits = obstacles
        .filter((obstacle) => obstacle.kind === "protected" && labelOverlapsObstacle(collisionBounds, obstacle, minGapPx))
        .map((obstacle) => obstacle.id);
      const pinnedHits = owners.flatMap((other, index) => {
        const otherInk = pinnedInkBounds[index];
        return index !== originalIndex && ink && otherInk && boundsOverlap(ink, otherInk)
          ? [other.labelId ?? `pinned_${other.entityId}`]
          : [];
      });
      const overlaps = [
        ...(outside ? ["view_clip"] : []),
        ...protectedHits,
        ...pinnedHits,
      ];
      const candidate: LabelPlacementCandidate = {
        slot: "east",
        bounds,
        collisionBounds,
        score: 0,
        overlaps,
        usesLeader: false,
      };
      return {
        owner,
        originalIndex,
        candidates: [candidate],
        validCandidates: overlaps.length === 0 ? [candidate] : [],
        area: bounds.width * bounds.height,
      };
    }
    const ownerBounds = owner.useOwnerBounds === false
      ? null
      : unionBounds(
          obstacles.filter((obstacle) => obstacle.entityId === owner.entityId).map((obstacle) => obstacle.bounds),
        );
    // Point labels can use a closer compass slot when the usual margin wastes
    // clear interior space. Every candidate still clears ink by minGapPx.
    const anchorGaps = owner.tetherPx === undefined ? [minGapPx + 8] : [minGapPx + 8, minGapPx + 4, minGapPx];
    const candidates: LabelPlacementCandidate[] = owner.requireLeader ? [] : anchorGaps.flatMap((anchorGap, gapIndex) => SLOT_OFFSETS.map((slot) => {
      const anchor = ownerBounds ? anchorOnBounds(ownerBounds, slot.slot) : owner.anchor;
      const bounds = textBoundsAtSlot(owner.text, anchor, slot.slot, options, anchorGap);
      const collisionBounds = textCollisionBounds(owner.text, bounds, options);
      const overlaps = solverObstacles
        .filter((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx))
        .map((obstacle) => obstacle.id);
      const outside = outsideOwnerView(collisionBounds, owner);
      if (outside) overlaps.push("view_clip");
      if (beyondTether(bounds, owner.anchor, owner.tetherPx)) overlaps.push("tether");
      const incident = incidentAligned(slot.slot, owner.incidentTangents);
      const drift = Math.hypot(anchor.x - owner.anchor.x, anchor.y - owner.anchor.y);
      return {
        slot: slot.slot,
        bounds,
        collisionBounds,
        score: slot.preference + gapIndex * 8 + (owner.preferredSlot === slot.slot ? -20 : 0) + overlaps.length * 10 + (outside ? 50 : 0) + (incident ? 40 : 0) + drift * 0.08,
        overlaps,
        usesLeader: false,
      };
    }));

    const leaderDirections = [
      ...SLOT_OFFSETS.map((direction) => ({
        dx: direction.dx === 0 ? 0 : direction.dx / Math.hypot(direction.dx, direction.dy),
        dy: direction.dy === 0 ? 0 : direction.dy / Math.hypot(direction.dx, direction.dy),
        preference: direction.preference,
        slot: direction.slot,
      })),
      ...[...INTERMEDIATE_LEADER_DIRECTIONS, ...FINE_LEADER_DIRECTIONS].map((direction, index) => ({
        ...direction,
        preference: SLOT_OFFSETS.length + index,
        slot: undefined,
      })),
    ];
    const leaderCandidates = owner.allowLeader === false && owner.tetherPx === undefined
      ? []
      : leaderDistances(owner.viewBounds, owner.tetherPx).flatMap((distance) =>
      [...leaderDirections, ...boxClearanceDirections(owner.text, distance, options, minGapPx)].map((direction) => {
          const center = {
            x: owner.anchor.x + direction.dx * distance,
            y: owner.anchor.y + direction.dy * distance,
          };
          const bounds = centeredTextBounds(owner.text, center, options);
          const collisionBounds = textCollisionBounds(owner.text, bounds, options);
          const overlaps = solverObstacles
            .filter((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx))
            .map((obstacle) => obstacle.id);
          const outside = outsideOwnerView(collisionBounds, owner);
          if (outside) overlaps.push("view_clip");
          if (beyondTether(bounds, owner.anchor, owner.tetherPx)) overlaps.push("tether");
          // The line stops outside the text. Running it to `center` — which is
          // what the board drew for years — strikes the label through.
          const leaderTo = leaderEndpoint(owner.anchor, center, collisionBounds);
          const candidate: LabelPlacementCandidate = {
            slot: "leader" as const,
            bounds,
            collisionBounds,
            score: 100 + distance + direction.preference +
              (owner.preferredSlot && direction.slot === owner.preferredSlot ? -24 : 0) +
              overlaps.length * 10 + (outside ? 50 : 0),
            overlaps,
            usesLeader: owner.allowLeader !== false && Boolean(leaderTo),
            ...(owner.allowLeader !== false && leaderTo ? { leaderFrom: owner.anchor, leaderTo } : {}),
          };
          if (owner.requireLeader && !candidate.usesLeader) overlaps.push("leader_required");
          // Routing cannot repair a glyph box that is already illegal. Keep
          // those candidates for diagnostics without exploring their elbows.
          if (overlaps.length > 0) return candidate;
          const fixedLabels = solverObstacles.filter((obstacle) => obstacle.kind === "label");
          const routed = routeLeader(candidate, fixedLabels.map((obstacle) => obstacle.bounds), owner.viewBounds, minGapPx,
            owner.leaderGeometrySafe ? obstacles.filter((obstacle) => obstacle.kind !== "label") : []);
          if (routed) return routed;
          for (const obstacle of fixedLabels) {
            if (leaderCrosses(candidate, obstacle.bounds, minGapPx) && !overlaps.includes(obstacle.id)) overlaps.push(obstacle.id);
          }
          if (owner.leaderGeometrySafe) overlaps.push("leader_geometry");
          return candidate;
        }),
    );
    const nearbyCandidates: LabelPlacementCandidate[] = owner.tetherPx !== undefined
      ? nearbyTetheredCenters(owner, solverObstacles, options, minGapPx).map((center) => {
          const bounds = centeredTextBounds(owner.text, center, options);
          const collisionBounds = textCollisionBounds(owner.text, bounds, options);
          const overlaps = solverObstacles.filter((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx)).map((obstacle) => obstacle.id);
          if (outsideOwnerView(collisionBounds, owner)) overlaps.push("view_clip");
          if (beyondTether(bounds, owner.anchor, owner.tetherPx)) overlaps.push("tether");
          return { slot: "leader", bounds, collisionBounds, score: 150 + Math.hypot(center.x - owner.anchor.x, center.y - owner.anchor.y), overlaps, usesLeader: false };
        })
      : [];
    const allCandidates = deduplicateCandidates([...candidates, ...leaderCandidates, ...nearbyCandidates])
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

  // Pinned labels stay on their anchors. They do not enter the compass-slot
  // solver — that solver's leader fallback is what drew dashed scribbles
  // across DSA cells when grid ink blocked every offset.
  const pinned = prepared.filter((item) => item.owner.pinToAnchor);
  const unpinned = prepared.filter((item) => !item.owner.pinToAnchor);

  for (const item of pinned) {
    const overlaps = item.candidates[0]?.overlaps ?? [];
    if (overlaps.includes("view_clip")) {
      issues.push({
        code: "label_outside_view",
        entityId: item.owner.entityId,
        message: `No in-view label slot for ${item.owner.entityId}`,
      });
    } else if (overlaps.length > 0) {
      issues.push({
        code: "label_overlap_unresolved",
        entityId: item.owner.entityId,
        message: `Pinned label for ${item.owner.entityId} overlaps reserved ink`,
        overlappingIds: overlaps,
      });
    }
  }

  for (const item of unpinned.filter((candidate) => candidate.validCandidates.length === 0)) {
    const best = item.candidates[0];
    if (best?.overlaps.includes("view_clip")) {
      issues.push({
        code: "label_outside_view",
        entityId: item.owner.entityId,
        message: `No in-view label slot for ${item.owner.entityId}`,
      });
      continue;
    }
    const tethered = best?.overlaps.includes("tether");
    const inkOverlaps = best?.overlaps.filter((id) => id !== "view_clip" && id !== "tether") ?? [];
    if (tethered && inkOverlaps.length === 0) {
      issues.push({
        code: "label_unattached",
        entityId: item.owner.entityId,
        message: `No nearby collision-free label slot for ${item.owner.entityId}`,
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

  const candidatesToSolve = unpinned.filter((item) => item.validCandidates.length > 0);
  // A leader crossing another label breaks the label's attachment just as
  // surely as overlapping glyphs. Keep that constraint in every solve.
  // Once an owner has no legal glyph slot the whole scene must be rejected.
  // Searching all remaining combinations cannot repair that fixed failure.
  const selected = issues.length === 0 && candidatesToSolve.length > 0
    ? solveLabelPlacements(candidatesToSolve, minGapPx, "straight", solverObstacles)
      ?? solveLabelPlacements(candidatesToSolve, minGapPx, "routed", solverObstacles)
    : new Map<number, LabelPlacementCandidate>();
  if (!selected && candidatesToSolve.length > 0) {
    const mostConstrained = [...candidatesToSolve].sort(comparePreparedOwners)[0]!;
    issues.push({
      code: "label_overlap_unresolved",
      entityId: mostConstrained.owner.entityId,
      message: `No globally collision-free label arrangement for ${mostConstrained.owner.entityId}`,
    });
  }

  const placements: LabelEngineResult["placements"] = [
    ...pinned.flatMap((item) => {
      const chosen = item.validCandidates[0];
      if (!chosen) return [];
      return [{
        labelId: item.owner.labelId ?? `label:${item.owner.entityId}`,
        entityId: item.owner.entityId,
        text: item.owner.text,
        bounds: chosen.bounds,
        ...(chosen.collisionBounds !== chosen.bounds ? { collisionBounds: chosen.collisionBounds } : {}),
        slot: chosen.slot,
        usesLeader: false,
      }];
    }),
    ...(selected
      ? unpinned.flatMap((item) => {
          const chosen = selected.get(item.originalIndex);
          if (!chosen) return [];
          return [{
            labelId: item.owner.labelId ?? `label:${item.owner.entityId}`,
            entityId: item.owner.entityId,
            text: item.owner.text,
            bounds: chosen.bounds,
            ...(chosen.collisionBounds !== chosen.bounds ? { collisionBounds: chosen.collisionBounds } : {}),
            slot: chosen.slot,
            usesLeader: chosen.usesLeader,
            leaderFrom: chosen.leaderFrom,
            leaderTo: chosen.leaderTo,
            leaderPath: chosen.leaderPath,
          }];
        })
      : []),
  ];

  return {
    ok: issues.length === 0,
    placements,
    issues,
  };
}

export interface LabelRowOrigin {
  /** The block's left edge for `left`, its right edge for `right`. */
  x: number;
  /** Top of the first row. */
  y: number;
  align: "left" | "right";
}

/**
 * Lay labels out as rows, one under the next, aligned on one edge, and pin
 * them there. Tries each origin in turn and returns the pinned owners for the
 * first block whose every row is inside the view and clear of ink; null when
 * none is.
 *
 * Pinned labels are not checked against ink by `placeLabels`, so the check
 * happens here, before anything is pinned.
 */
export function stackLabelRows(
  owners: LabelOwner[],
  origins: LabelRowOrigin[],
  viewBounds: LabelBounds | undefined,
  obstacles: LabelObstacle[],
  options: LabelEngineOptions = {},
): LabelOwner[] | null {
  const minGapPx = options.minGapPx ?? DEFAULTS.minGapPx;
  for (const origin of origins) {
    const rows: LabelOwner[] = [];
    let top = origin.y;
    for (const owner of owners) {
      const size = centeredTextBounds(owner.text, { x: 0, y: 0 }, options);
      const center = {
        x: origin.align === "left" ? origin.x + size.width / 2 : origin.x - size.width / 2,
        y: top + size.height / 2,
      };
      const bounds = centeredTextBounds(owner.text, center, options);
      const collisionBounds = textCollisionBounds(owner.text, bounds, options);
      if (
        (viewBounds && !boundsInside(collisionBounds, viewBounds)) ||
        obstacles.some((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx))
      ) {
        break;
      }
      rows.push({
        ...owner,
        anchor: center,
        pinToAnchor: true,
        allowLeader: false,
        useOwnerBounds: false,
        tetherPx: undefined,
        incidentTangents: undefined,
      });
      top = collisionBounds.y + collisionBounds.height + minGapPx + 2;
    }
    if (rows.length === owners.length) return rows;
  }
  return null;
}

function leaderDistances(viewBounds: LabelBounds | undefined, tetherPx?: number): number[] {
  if (tetherPx !== undefined) {
    const distances: number[] = [];
    for (let distance = 24; distance <= tetherPx; distance += 8) distances.push(distance);
    if (distances.at(-1) !== tetherPx) distances.push(tetherPx);
    return distances;
  }
  const maxDistance = viewBounds
    ? Math.ceil(Math.hypot(viewBounds.width, viewBounds.height))
    : 360;
  const distances = [40, 68, 96, 124, 160, 196];
  for (let distance = 228; distance <= maxDistance; distance += 32) distances.push(distance);
  return distances;
}

function boxClearanceDirections(text: string, distance: number, options: LabelEngineOptions, gap: number): Array<{ dx: number; dy: number; preference: number; slot: undefined }> {
  const size = centeredTextBounds(text, { x: 0, y: 0 }, options);
  const directions: Array<{ dx: number; dy: number; preference: number; slot: undefined }> = [];
  // These positions keep a glyph box just clear of an incident horizontal or
  // vertical stroke. Fixed compass angles can miss that narrow usable sector.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const y = size.height / 2 + gap + 1;
    if (y < distance) directions.push({ dx: sx * Math.sqrt(1 - (y / distance) ** 2), dy: sy * y / distance, preference: 32, slot: undefined });
    const x = size.width / 2 + gap + 1;
    if (x < distance) directions.push({ dx: sx * x / distance, dy: sy * Math.sqrt(1 - (x / distance) ** 2), preference: 33, slot: undefined });
  }
  return directions;
}

function nearbyTetheredCenters(owner: LabelOwner, obstacles: LabelObstacle[], options: LabelEngineOptions, gap: number): RenderPoint[] {
  const size = centeredTextBounds(owner.text, owner.anchor, options);
  const dx = size.width / 2 + gap + 1;
  const dy = size.height / 2 + gap + 1;
  const xs = new Set([owner.anchor.x - dx, owner.anchor.x + dx]);
  const ys = new Set([owner.anchor.y - dy, owner.anchor.y + dy]);
  for (const obstacle of obstacles) {
    for (const x of [obstacle.bounds.x - dx, obstacle.bounds.x + obstacle.bounds.width + dx]) {
      if (Math.abs(x - owner.anchor.x) <= owner.tetherPx!) xs.add(x);
    }
    for (const y of [obstacle.bounds.y - dy, obstacle.bounds.y + obstacle.bounds.height + dy]) {
      if (Math.abs(y - owner.anchor.y) <= owner.tetherPx!) ys.add(y);
    }
  }
  return [...xs].flatMap((x) => [...ys].map((y) => ({ x, y })))
    .filter((center) => Math.hypot(center.x - owner.anchor.x, center.y - owner.anchor.y) <= owner.tetherPx! + 1e-6);
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
  routing: "straight" | "routed",
  obstacles: LabelObstacle[],
): Map<number, LabelPlacementCandidate> | null {
  const selected = new Map<number, LabelPlacementCandidate>();
  const remaining = new Set(owners.map((owner) => owner.originalIndex));
  const byIndex = new Map(owners.map((owner) => [owner.originalIndex, owner]));
  let visited = 0;
  const maxVisited = Math.max(20_000, owners.length * 20_000);
  const fixedLabels = obstacles.filter((obstacle) => obstacle.kind === "label").map((obstacle) => obstacle.bounds);

  const routedSelection = (): Map<number, LabelPlacementCandidate> | null => {
    const routed = new Map<number, LabelPlacementCandidate>();
    for (const [index, candidate] of selected) {
      const boxes = [...fixedLabels, ...[...selected].filter(([other]) => other !== index).map(([, placement]) => candidateCollisionBounds(placement))];
      const owner = byIndex.get(index)?.owner;
      const route = routeLeader(candidate, boxes, owner?.viewBounds, minGapPx,
        owner?.leaderGeometrySafe ? obstacles.filter((obstacle) => obstacle.kind !== "label") : [],
        [...routed.values()].flatMap(leaderPoints));
      if (!route) return null;
      routed.set(index, route);
    }
    return routed;
  };

  const compatibleCandidates = (owner: PreparedLabelOwner) => owner.validCandidates.filter((candidate) =>
    [...selected.values()].every((placed) => routing === "routed"
      ? !boundsOverlap(candidateCollisionBounds(candidate), candidateCollisionBounds(placed), minGapPx)
      : compatible(candidate, placed, minGapPx)),
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
      if ((routing === "straight" || routedSelection()) && search()) return true;
      selected.delete(next.owner.originalIndex);
      if (visited >= maxVisited) break;
    }
    remaining.add(next.owner.originalIndex);
    return false;
  };

  return search() ? (routing === "routed" ? routedSelection() : selected) : null;
}

/**
 * Two placements can stand together.
 *
 * Boxes must not overlap, and neither leader may cross the other's text: a
 * leader is drawn after every label is solved, so nothing else in the pass
 * would ever notice it landing on a neighbour's glyphs.
 */
function compatible(
  candidate: LabelPlacementCandidate,
  placed: LabelPlacementCandidate,
  minGapPx: number,
): boolean {
  if (boundsOverlap(candidateCollisionBounds(candidate), candidateCollisionBounds(placed), minGapPx)) return false;
  return !leaderCrosses(candidate, candidateCollisionBounds(placed), minGapPx) &&
    !leaderCrosses(placed, candidateCollisionBounds(candidate), minGapPx) &&
    !leadersConflict(candidate, placed);
}

function leaderPoints(candidate: LabelPlacementCandidate): RenderPoint[][] {
  return candidate.leaderFrom && candidate.leaderTo
    ? [candidate.leaderPath ?? [candidate.leaderFrom, candidate.leaderTo]]
    : [];
}

function leadersConflict(first: LabelPlacementCandidate, second: LabelPlacementCandidate): boolean {
  return leaderPoints(first).some((a) => leaderPoints(second).some((b) => leaderPathsConflict(a, b)));
}

/** Leaders may branch at one shared owner anchor, but never cross or share ink. */
function leaderPathsConflict(first: RenderPoint[], second: RenderPoint[]): boolean {
  const sharedAnchor = Math.hypot(first[0]!.x - second[0]!.x, first[0]!.y - second[0]!.y) <= 1e-6;
  return first.slice(1).some((end, index) => second.slice(1).some((otherEnd, otherIndex) => {
    const start = first[index]!;
    const otherStart = second[otherIndex]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const ex = otherEnd.x - otherStart.x;
    const ey = otherEnd.y - otherStart.y;
    const ax = otherStart.x - start.x;
    const ay = otherStart.y - start.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-9) {
      if (Math.abs(ax * dy - ay * dx) > 1e-6) return false;
      const span = dx * dx + dy * dy;
      if (span < 1e-9) return false;
      const a = (ax * dx + ay * dy) / span;
      const b = ((otherEnd.x - start.x) * dx + (otherEnd.y - start.y) * dy) / span;
      return Math.min(1, Math.max(a, b)) - Math.max(0, Math.min(a, b)) > 1e-6;
    }
    const along = (ax * ey - ay * ex) / denominator;
    const across = (ax * dy - ay * dx) / denominator;
    if (along < -1e-6 || along > 1 + 1e-6 || across < -1e-6 || across > 1 + 1e-6) return false;
    const hit = { x: start.x + dx * along, y: start.y + dy * along };
    return !sharedAnchor || Math.hypot(hit.x - first[0]!.x, hit.y - first[0]!.y) > 1e-6;
  }));
}

/**
 * A leader must keep the same clear air from a neighbour's text that two labels
 * keep from each other — the reserved box is the em box, so a descender reaches
 * a little past it and a line grazing the edge still crosses ink.
 */
function leaderCrosses(candidate: LabelPlacementCandidate, bounds: LabelBounds, gap: number): boolean {
  if (!candidate.leaderFrom || !candidate.leaderTo) return false;
  const path = candidate.leaderPath ?? [candidate.leaderFrom, candidate.leaderTo];
  const expanded = {
    x: bounds.x - gap,
    y: bounds.y - gap,
    width: bounds.width + gap * 2,
    height: bounds.height + gap * 2,
  };
  return path.slice(1).some((point, index) => segmentIntersectsBounds(path[index]!, point, expanded));
}

/** A small deterministic set of elbows around reserved text; no arbitrary pixels. */
function routeLeader(
  candidate: LabelPlacementCandidate,
  obstacles: LabelBounds[],
  viewBounds: LabelBounds | undefined,
  gap: number,
  geometry: LabelObstacle[] = [],
  otherLeaders: RenderPoint[][] = [],
): LabelPlacementCandidate | null {
  const from = candidate.leaderFrom;
  const to = candidate.leaderTo;
  if (!from || !to) return candidate;
  const routes: RenderPoint[][] = [
    [from, to],
    [from, { x: from.x, y: to.y }, to],
    [from, { x: to.x, y: from.y }, to],
  ];
  const leaderBounds = otherLeaders.map((path): LabelBounds => {
    const xs = path.map((point) => point.x);
    const ys = path.map((point) => point.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  });
  for (const box of [...obstacles, ...geometry.filter((obstacle) => obstacle.segments?.length).map((obstacle) => obstacle.bounds), ...leaderBounds]) {
    for (const y of [box.y - gap - 1, box.y + box.height + gap + 1]) {
      routes.push([from, { x: from.x, y }, { x: to.x, y }, to]);
    }
    for (const x of [box.x - gap - 1, box.x + box.width + gap + 1]) {
      routes.push([from, { x, y: from.y }, { x, y: to.y }, to]);
    }
  }
  const routeLength = (path: RenderPoint[]) => path.slice(1).reduce((total, point, index) =>
    total + Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y), 0);
  const legal = routes
    .map((path) => path.filter((point, index) => index === 0 || Math.hypot(point.x - path[index - 1]!.x, point.y - path[index - 1]!.y) > 1e-6))
    .filter((path) => !viewBounds || path.every((point) =>
      point.x >= viewBounds.x && point.x <= viewBounds.x + viewBounds.width &&
      point.y >= viewBounds.y && point.y <= viewBounds.y + viewBounds.height,
    ))
    .filter((path) => !leaderCrosses({ ...candidate, leaderPath: path }, candidateCollisionBounds(candidate), 0))
    .filter((path) => obstacles.every((box) => !leaderCrosses({ ...candidate, leaderPath: path }, box, gap)))
    .filter((path) => !leaderCrossesGeometry(path, geometry))
    .filter((path) => otherLeaders.every((other) => !leaderPathsConflict(path, other)))
    .sort((a, b) => routeLength(a) - routeLength(b) || a.length - b.length);
  const path = legal[0];
  return path ? { ...candidate, leaderPath: path.length > 2 ? path : undefined } : null;
}

function leaderCrossesGeometry(path: RenderPoint[], obstacles: LabelObstacle[]): boolean {
  const anchor = path[0]!;
  return path.slice(1).some((end, index) => {
    const start = path[index]!;
    return obstacles.some((obstacle) => (obstacle.segments ?? []).some(([a, b]) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denominator = dx * ey - dy * ex;
      const ax = a.x - start.x;
      const ay = a.y - start.y;
      if (Math.abs(denominator) < 1e-9) {
        if (Math.abs(ax * dy - ay * dx) > 1e-6) return false;
        const span = dx * dx + dy * dy;
        if (span < 1e-9) return false;
        const first = (ax * dx + ay * dy) / span;
        const second = ((b.x - start.x) * dx + (b.y - start.y) * dy) / span;
        return Math.min(1, Math.max(first, second)) - Math.max(0, Math.min(first, second)) > 1e-6;
      }
      const along = (ax * ey - ay * ex) / denominator;
      const across = (ax * dy - ay * dx) / denominator;
      if (along < -1e-6 || along > 1 + 1e-6 || across < -1e-6 || across > 1 + 1e-6) return false;
      const hit = { x: start.x + dx * along, y: start.y + dy * along };
      // Compiled primitive coordinates are rounded to hundredths of a pixel;
      // their common analytic anchor can therefore miss a stroke by a few
      // hundredths. This tolerance admits that shared contact only.
      return Math.hypot(hit.x - anchor.x, hit.y - anchor.y) > 0.05;
    }));
  });
}

function outsideOwnerView(bounds: LabelBounds, owner: LabelOwner): boolean {
  return Boolean(
    (owner.viewBounds && !boundsInside(bounds, owner.viewBounds)) ||
    (owner.placementBounds && !boundsInside(bounds, owner.placementBounds)),
  );
}

function incidentAligned(
  slot: Exclude<LabelSlot, "leader">,
  tangents: RenderPoint[] | undefined,
): boolean {
  if (!tangents || tangents.length === 0) return false;
  const offset = SLOT_OFFSETS.find((entry) => entry.slot === slot);
  if (!offset) return false;
  const length = Math.hypot(offset.dx, offset.dy) || 1;
  const ux = offset.dx / length;
  const uy = offset.dy / length;
  return tangents.some((tangent) => Math.abs(tangent.x * ux + tangent.y * uy) >= INCIDENT_ALIGN);
}

/**
 * Where a leader from `from` towards the label should stop: at the first point
 * it meets the label's box, backed off by `LEADER_STANDOFF_PX`.
 *
 * Returns null when there is no line worth drawing — the anchor already sits
 * inside (or all but inside) the label, so the label reads as attached without
 * one, and a stub of a line would only look like a stray mark.
 */
function leaderEndpoint(from: RenderPoint, center: RenderPoint, bounds: LabelBounds): RenderPoint | null {
  const box = {
    x: bounds.x - LEADER_STANDOFF_PX,
    y: bounds.y - LEADER_STANDOFF_PX,
    width: bounds.width + LEADER_STANDOFF_PX * 2,
    height: bounds.height + LEADER_STANDOFF_PX * 2,
  };
  const dx = center.x - from.x;
  const dy = center.y - from.y;
  let enter = 0;
  let exit = 1;
  for (const axis of [
    { origin: from.x, delta: dx, min: box.x, max: box.x + box.width },
    { origin: from.y, delta: dy, min: box.y, max: box.y + box.height },
  ]) {
    if (Math.abs(axis.delta) < 1e-9) {
      if (axis.origin < axis.min || axis.origin > axis.max) return null;
      continue;
    }
    const first = (axis.min - axis.origin) / axis.delta;
    const second = (axis.max - axis.origin) / axis.delta;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  if (enter > exit) return null;
  const tip = { x: from.x + dx * enter, y: from.y + dy * enter };
  return Math.hypot(tip.x - from.x, tip.y - from.y) >= MIN_LEADER_PX ? tip : null;
}

function beyondTether(bounds: LabelBounds, anchor: RenderPoint, tetherPx: number | undefined): boolean {
  if (tetherPx === undefined) return false;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return Math.hypot(center.x - anchor.x, center.y - anchor.y) > tetherPx + 1e-6;
}

function centeredTextBounds(text: string, center: RenderPoint, options: LabelEngineOptions): LabelBounds {
  const paddingPx = options.paddingPx ?? DEFAULTS.paddingPx;
  const width = textInkWidth(text, options) + paddingPx * 2;
  const height = textInkHeight(options) + paddingPx * 2;
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** Layout remains an em box; only collision reservation follows overhanging ink. */
function extendForInk(bounds: LabelBounds, ink: LabelBounds | null | undefined): LabelBounds {
  return !ink || boundsInside(ink, bounds) ? bounds : unionBounds([bounds, ink]) ?? bounds;
}

function textCollisionBounds(text: string, bounds: LabelBounds, options: LabelEngineOptions): LabelBounds {
  if (!options.measureTextInkBounds) return bounds;
  const padding = options.paddingPx ?? DEFAULTS.paddingPx;
  return extendForInk(bounds, options.measureTextInkBounds(text, bounds.x + padding, bounds.y + padding,
    options.fontHeightPx ?? DEFAULTS.fontHeightPx));
}

function candidateCollisionBounds(candidate: LabelPlacementCandidate): LabelBounds {
  return candidate.collisionBounds ?? candidate.bounds;
}

/** Width of the glyph run itself, before padding. */
function textInkWidth(text: string, options: LabelEngineOptions): number {
  const fontHeightPx = options.fontHeightPx ?? DEFAULTS.fontHeightPx;
  const measured = options.measureTextPx
    ? options.measureTextPx(text, fontHeightPx)
    : text.length * (options.fontWidthPx ?? DEFAULTS.fontWidthPx);
  return Math.max(8, measured);
}

/**
 * Height of the glyph run, before padding.
 *
 * The em box, not the ascender-to-descender span: a descender reaches a few
 * pixels into the padding rather than into a neighbour, and reserving the full
 * span instead measurably bought nothing across the corpus while costing every
 * label vertical room in a tight figure.
 */
function textInkHeight(options: LabelEngineOptions): number {
  return options.fontHeightPx ?? DEFAULTS.fontHeightPx;
}

/** Build coarse axis-aligned obstacles from compiled primitives. */
export function obstaclesFromPrimitives(primitives: RenderPrimitive[]): LabelObstacle[] {
  return primitives.flatMap((primitive): LabelObstacle[] => {
    const labelBounds = primitive.kind === "label"
      ? primitive.provenance?.labelCollisionBounds ?? primitive.provenance?.labelBounds : undefined;
    if (isLabelBounds(labelBounds)) return [{
      id: primitive.id, entityId: primitive.entityId, kind: "label" as const, bounds: labelBounds,
    }];
    if (primitive.points.length === 0) return [];
    const obstaclePoints = primitive.kind === "circle" && primitive.radius
      ? sampleArc(primitive.points[0]!, primitive.radius, 0, Math.PI * 2)
      : primitive.kind === "arc" && primitive.radius && primitive.startAngle !== undefined && primitive.endAngle !== undefined
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
    const segments: LabelObstacle["segments"] = primitive.kind === "label" || primitive.kind === "point"
      ? undefined
      : primitive.kind === "axes" && obstaclePoints.length >= 4
        ? [[obstaclePoints[0]!, obstaclePoints[1]!], [obstaclePoints[2]!, obstaclePoints[3]!]]
        : pathSegments(obstaclePoints, primitive.kind === "polygon" || primitive.kind === "rectangle" || primitive.kind === "circle");
    return [{
      id: primitive.id,
      entityId: primitive.entityId,
      kind: primitive.kind === "label" ? "label" as const : "geometry" as const,
      segments,
      bounds: {
        x: minX - pad,
        y: minY - pad,
        width: (primitive.kind === "point" ? 0 : Math.max(4, maxX - minX)) + pad * 2,
        height: (primitive.kind === "point" ? 0 : Math.max(4, maxY - minY)) + pad * 2,
      },
    }];
  });
}

function isLabelBounds(value: unknown): value is LabelBounds {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LabelBounds>;
  return [record.x, record.y, record.width, record.height].every((number) => typeof number === "number" && Number.isFinite(number));
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
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)
  ) return false;
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
