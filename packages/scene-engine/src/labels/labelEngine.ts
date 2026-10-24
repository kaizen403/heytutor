/**
 * Screen-space label placement with overlap rejection.
 *
 * Labels are constrained geometry: reserve bounds, score candidate slots,
 * reject unresolved collisions rather than drawing over ink.
 */

import type { RenderPoint, RenderPrimitive } from "../types";
import { createLeaderGeometryQuery } from "./leaderGeometryQuery";

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
  /**
   * Regions the whole label box must lie in, such as the medium on one side
   * of a refraction interface. A slot outside any of them is never legal, so
   * the label is never carried across; the caller decides whether to drop a
   * label that has no slot left.
   */
  sideRegions?: LabelSideRegion[];
}

/** A screen region bounded by an interface, keeping a label in one medium. */
export type LabelSideRegion =
  | { kind: "half_plane"; point: RenderPoint; normal: RenderPoint }
  | { kind: "circle"; center: RenderPoint; radius: number; inside: boolean }
  | { kind: "polygon"; points: RenderPoint[]; inside: boolean };

/** Overlap id a candidate carries when its box leaves one of `sideRegions`. */
export const LABEL_WRONG_SIDE = "wrong_side";

/**
 * Overlap id a candidate carries when, without a leader, its box sits nearer
 * another entity's stroke than any stroke of its own owner. Such a label
 * names the wrong mark: the vector "A" written beside its vertical component.
 */
export const LABEL_NEARER_FOREIGN = "nearer_foreign_ink";

export interface LabelObstacle {
  id: string;
  entityId?: string;
  bounds: LabelBounds;
  kind: "geometry" | "label" | "symbol" | "protected";
  /** Precise ink segments. When present, collision uses these instead of the
   * coarse axis-aligned bounds (important for long diagonal rays). */
  segments?: Array<[RenderPoint, RenderPoint]>;
  /** Kind of the primitive this obstacle was built from, when known. */
  primitiveKind?: RenderPrimitive["kind"];
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
  /** Override `LABEL_SEARCH_WORK_BUDGET` for one call. */
  searchWorkBudget?: number;
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
  /** Work units the arrangement search spent; see `LABEL_SEARCH_WORK_BUDGET`. */
  searchWork: number;
  /** Which arrangement search placed the unpinned labels; null when none ran or none succeeded. */
  solvedBy: "straight" | "routed" | null;
}

/**
 * Work units one `placeLabels` call may spend arranging its labels.
 *
 * A unit is one pairwise test of a candidate box against a placed label; a
 * leader routed through the placed labels costs its elbows times the tests
 * each elbow makes. The search counts units rather than time, so the same
 * document gets the same answer on any machine. A search that runs out fails
 * as `label_overlap_unresolved`, as a search that proves no arrangement exists
 * does.
 *
 * Equipotential and LCR candidates with seven to sixteen crowded labels spent
 * 2.5 to 5.3 minutes of CPU here before failing, on the student's main thread.
 * The heaviest search that succeeded across 2,522 recorded planner documents
 * spent 2.03 million units, a quarter of this budget.
 */
export const LABEL_SEARCH_WORK_BUDGET = 8_000_000;

interface LabelSearchWork {
  spent: number;
  budget: number;
}


const DEFAULTS = {
  // Matches the 24 px handwritten LABEL renderer used by the board adapter.
  fontWidthPx: 13,
  fontHeightPx: 24,
  paddingPx: 4,
  minGapPx: 6,
  maxLabelChars: 16,
};

export type TextInkBoundsMeasure = NonNullable<LabelEngineOptions["measureTextInkBounds"]>;

export interface TextInkBoundsCacheStats {
  calls: number;
  hits: number;
  evictions: number;
  size: number;
  capacity: number;
}

export interface TextInkBoundsCache {
  /** Same signature and same answers as the measure it wraps. */
  measure: TextInkBoundsMeasure;
  stats(): TextInkBoundsCacheStats;
  /** Drop every entry and zero the counters. */
  clear(): void;
}

/**
 * At least the newest half (16k boxes) is always held. One compile measures
 * a median 3.4k distinct boxes and 9k at the 95th percentile of the scene
 * corpus, so recompiling the same document, which the live turn does after
 * the planner's own compile, is answered from memory. About 4 MB when full.
 */
export const TEXT_INK_CACHE_CAPACITY = 1 << 15;

/**
 * Exact-argument memo for a pure ink measure.
 *
 * Label search asks for the ink of every candidate box, and the live turn
 * compiles the same document more than once, so the same (text, x, y, size)
 * comes back. The key is the exact arguments: no rounding, no translation of
 * a cached run, and `-0` kept apart from `0`, so a hit returns precisely what
 * the measure would, and every answer is a fresh object, so a caller that
 * edits its bounds cannot change what the next caller reads.
 *
 * Two generations of `capacity / 2` entries each hold at most `capacity`
 * boxes: when the newer one fills it becomes the older one and the oldest is
 * dropped whole, and a hit in the older one is copied forward. Nothing is
 * ever deleted from a Map one key at a time: a per-key LRU did that on every
 * hit and every miss, and cost more than its hits saved. Boxes live in typed arrays (doubles are
 * stored exactly), about 130 bytes an entry.
 */
export function createTextInkBoundsCache(
  measure: TextInkBoundsMeasure,
  capacity = TEXT_INK_CACHE_CAPACITY,
): TextInkBoundsCache {
  const generationSize = Math.max(1, Math.floor(capacity / 2));
  let newer: InkGeneration | null = null;
  let older: InkGeneration | null = null;
  let calls = 0;
  let hits = 0;
  let evictions = 0;
  // Keys copied forward from the older generation sit in both until the
  // older one is dropped; they are one entry, not two.
  let promoted = 0;
  const store = (key: string, bounds: LabelBounds | null): void => {
    if (capacity < 2) return;
    newer ??= createInkGeneration(generationSize);
    if (newer.slots.size >= generationSize) {
      const recycled: InkGeneration = older ?? createInkGeneration(generationSize);
      evictions += (older?.slots.size ?? 0) - promoted;
      promoted = 0;
      recycled.slots.clear();
      older = newer;
      newer = recycled;
    }
    writeInkSlot(newer, key, bounds);
  };
  return {
    measure(text, x, y, fontHeightPx) {
      calls += 1;
      const key = `${exactNumberKey(x)}\u0000${exactNumberKey(y)}\u0000${exactNumberKey(fontHeightPx)}\u0000${text}`;
      const recent = newer?.slots.get(key);
      if (recent !== undefined) {
        hits += 1;
        return readInkSlot(newer!, recent);
      }
      const aged = older?.slots.get(key);
      if (aged !== undefined) {
        hits += 1;
        const bounds = readInkSlot(older!, aged);
        store(key, bounds);
        // Unless filling the newer generation just dropped the older one.
        if (older?.slots.has(key)) promoted += 1;
        return bounds ? { ...bounds } : null;
      }
      const bounds = measure(text, x, y, fontHeightPx);
      const copy = bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
      store(key, copy);
      return copy ? { ...copy } : null;
    },
    stats: () => ({
      calls,
      hits,
      evictions,
      size: (newer?.slots.size ?? 0) + (older?.slots.size ?? 0) - promoted,
      capacity,
    }),
    clear() {
      newer?.slots.clear();
      older?.slots.clear();
      promoted = 0;
      calls = 0;
      hits = 0;
      evictions = 0;
    },
  };
}

interface InkGeneration {
  /** Key to slot; a slot is never reused until the whole generation is. */
  slots: Map<string, number>;
  boxes: Float64Array;
  measured: Uint8Array;
}

function createInkGeneration(size: number): InkGeneration {
  return { slots: new Map(), boxes: new Float64Array(size * 4), measured: new Uint8Array(size) };
}

function writeInkSlot(generation: InkGeneration, key: string, bounds: LabelBounds | null): void {
  const slot = generation.slots.size;
  generation.slots.set(key, slot);
  generation.measured[slot] = bounds ? 1 : 0;
  if (!bounds) return;
  const base = slot * 4;
  generation.boxes[base] = bounds.x;
  generation.boxes[base + 1] = bounds.y;
  generation.boxes[base + 2] = bounds.width;
  generation.boxes[base + 3] = bounds.height;
}

function readInkSlot(generation: InkGeneration, slot: number): LabelBounds | null {
  if (generation.measured[slot] === 0) return null;
  const base = slot * 4;
  const { boxes } = generation;
  return { x: boxes[base]!, y: boxes[base + 1]!, width: boxes[base + 2]!, height: boxes[base + 3]! };
}

/** `String` is exact for every double except that it prints `-0` as `0`. */
function exactNumberKey(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

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
/** Query the same constraints for one label without selecting a final slot. */
export function canPlaceSingleLabel(owner: LabelOwner, obstacles: LabelObstacle[], options: LabelEngineOptions = {}): boolean {
  const result = placeLabelsInternal([owner], obstacles, options, true).ok;
  return result;
}

export function placeLabels(
  owners: LabelOwner[],
  obstacles: LabelObstacle[],
  options: LabelEngineOptions = {},
): LabelEngineResult {
  return placeLabelsInternal(owners, obstacles, options);
}

function placeLabelsInternal(
  owners: LabelOwner[],
  obstacles: LabelObstacle[],
  options: LabelEngineOptions = {},
  feasibilityOnly = false,
): LabelEngineResult {
  // Every candidate for one label uses the same text and font height.
  // Width is independent of its position; measure it once per call, while
  // ink bounds still use the exact candidate coordinates below.
  if (options.measureTextPx) {
    const measure = options.measureTextPx;
    const widths = new Map<string, number>();
    options = { ...options, measureTextPx: (text, fontHeight) => {
      const key = `${fontHeight}\0${text}`;
      const cached = widths.get(key);
      if (cached !== undefined) return cached;
      const width = measure(text, fontHeight);
      widths.set(key, width);
      return width;
    } };
  }
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
  const fixedLabelObstacles = solverObstacles.filter(obstacle => obstacle.kind === "label");
  const fixedLabelBounds = fixedLabelObstacles.map(obstacle => obstacle.bounds);
  const leaderGeometry = obstacles.filter(obstacle => obstacle.kind !== "label");
  const geometryQuery = owners.some(owner => owner.leaderGeometrySafe) ? createLeaderGeometryQuery(leaderGeometry) : undefined;

  const prepared = owners.map((owner, originalIndex): PreparedLabelOwner => {
    const prepareOwner = (exhaustive = false): PreparedLabelOwner => {
      let deferredInk = false;
      const candidateInkBounds = (text: string, bounds: LabelBounds, settings: LabelEngineOptions, tethered = true): LabelBounds => {
        // The final collision box contains the complete layout box. Ink can
        // add collisions or leave the view, but cannot cure either failure.
        // Escape leaders sit beyond the tether by design, so for them the
        // tether is no reason to skip measuring the ink.
        if (!exhaustive && (outsideOwnerView(bounds, owner) ||
            (tethered && beyondTether(bounds, owner.anchor, owner.tetherPx)) ||
            solverObstacles.some(obstacle => labelOverlapsObstacle(bounds, obstacle, minGapPx)))) {
          deferredInk = true;
          return bounds;
        }
        return textCollisionBounds(text, bounds, settings);
      };
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
          ...(offSide(collisionBounds, owner) ? [LABEL_WRONG_SIDE] : []),
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
      const ownership = owner.useOwnerBounds === false ? null : strokeOwnership(owner, obstacles);
      const pointForeign = ownership ? null : pointForeignStrokes(owner, obstacles);
      const nearerForeignInk = (box: LabelBounds) => pointForeign !== null && pointLabelNearerForeign(box, owner.anchor, pointForeign);
      // Point labels can use a closer compass slot when the usual margin wastes
      // clear interior space. Every candidate still clears ink by minGapPx.
      const anchorGaps = owner.tetherPx === undefined ? [minGapPx + 8] : [minGapPx + 8, minGapPx + 4, minGapPx];
      const candidates: LabelPlacementCandidate[] = owner.requireLeader ? [] : anchorGaps.flatMap((anchorGap, gapIndex) => SLOT_OFFSETS.flatMap((slot) => {
        const boxAnchor = ownerBounds ? anchorOnBounds(ownerBounds, slot.slot) : owner.anchor;
        // A box anchor in empty air beside a diagonal stroke keeps its slot
        // and gains slots taken along the stroke itself, for when the box slot
        // sits nearer another mark than its owner.
        const placements = [
          { anchor: boxAnchor, bounds: textBoundsAtSlot(owner.text, boxAnchor, slot.slot, options, anchorGap) },
          ...(ownership && ownerBounds && !onInk(boxAnchor, ownership.ink)
            ? strokeSlotPlacements(owner, ownership, slot, options, anchorGap)
            : []),
        ];
        return placements.map(({ anchor, bounds }) => {
          const collisionBounds = candidateInkBounds(owner.text, bounds, options);
          const overlaps = solverObstacles
            .filter((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx))
            .map((obstacle) => obstacle.id);
          const margin = ownership ? ownershipMargin(collisionBounds, ownership) : Infinity;
          if (overlaps.length === 0 && margin < -OWNERSHIP_TOLERANCE_PX) overlaps.push(LABEL_NEARER_FOREIGN);
          if (overlaps.length === 0 && nearerForeignInk(collisionBounds)) overlaps.push(LABEL_NEARER_FOREIGN);
          const outside = outsideOwnerView(collisionBounds, owner);
          if (outside) overlaps.push("view_clip");
          if (offSide(collisionBounds, owner)) overlaps.push(LABEL_WRONG_SIDE);
          if (beyondTether(bounds, owner.anchor, owner.tetherPx)) overlaps.push("tether");
          const incident = incidentAligned(slot.slot, owner.incidentTangents);
          const drift = Math.hypot(anchor.x - owner.anchor.x, anchor.y - owner.anchor.y);
          return {
            slot: slot.slot,
            bounds,
            collisionBounds,
            score: slot.preference + gapIndex * 8 + (owner.preferredSlot === slot.slot ? -20 : 0) + overlaps.length * 10 + (outside ? 50 : 0) + (incident ? 40 : 0) + drift * 0.08 +
              (margin < OWNERSHIP_CLEAR_MARGIN_PX ? AMBIGUOUS_OWNER_PENALTY : 0),
            overlaps,
            usesLeader: false,
          };
        });
      }));

      // Only feasibility consumes this branch: the caller receives no chosen
      // placement. Honor first-position deduplication before accepting a slot.
      const feasible = (candidate: LabelPlacementCandidate): PreparedLabelOwner => ({
        owner, originalIndex, candidates: [candidate], validCandidates: [candidate],
        area: candidate.bounds.width * candidate.bounds.height,
      });
      if (feasibilityOnly) {
        const legal = deduplicateCandidates(candidates).find(candidate => candidate.overlaps.length === 0);
        if (legal) return feasible(legal);
      }

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
      const leaderCandidates: LabelPlacementCandidate[] = [];
      const seenCandidateSlots = new Set<string>();
      const legalLeaderDomain: LabelPlacementCandidate[] = [];
      const rememberCandidate = (candidate: LabelPlacementCandidate) => {
        const key = `${Math.round(candidate.bounds.x * 10)}:${Math.round(candidate.bounds.y * 10)}`;
        if (seenCandidateSlots.has(key)) return;
        seenCandidateSlots.add(key);
        if (candidate.overlaps.length === 0) legalLeaderDomain.push(candidate);
      };
      candidates.forEach(rememberCandidate);
      const distances = owner.allowLeader === false && owner.tetherPx === undefined
        ? [] : leaderDistances(owner.viewBounds, owner.tetherPx);
      for (const distance of distances) {
        // Only the first 160 legal slots enter the arrangement search. Once
        // their worst score beats even the cheapest future radius, generating
        // more candidates cannot change that domain. Tethered owners also have
        // a later nearby-slot pass, so keep their original exhaustive sequence.
        if (owner.tetherPx === undefined) {
          if (legalLeaderDomain.length >= 160) {
            legalLeaderDomain.sort((a, b) => a.score - b.score);
            if (legalLeaderDomain[159]!.score < 100 + distance - 24) break;
          }
        }
        const atDistance = [...leaderDirections, ...boxClearanceDirections(owner.text, distance, options, minGapPx)].map((direction) => {
            const center = {
              x: owner.anchor.x + direction.dx * distance,
              y: owner.anchor.y + direction.dy * distance,
            };
            const bounds = centeredTextBounds(owner.text, center, options);
            const collisionBounds = candidateInkBounds(owner.text, bounds, options);
            const overlaps = solverObstacles
              .filter((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx))
              .map((obstacle) => obstacle.id);
            const outside = outsideOwnerView(collisionBounds, owner);
            if (outside) overlaps.push("view_clip");
            if (offSide(collisionBounds, owner)) overlaps.push(LABEL_WRONG_SIDE);
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
            // Without a drawn leader nothing ties the text to its owner but
            // proximity, so it must sit nearest its owner like a slot label.
            if (overlaps.length === 0 && !candidate.usesLeader && ownership && ownershipMargin(collisionBounds, ownership) < -OWNERSHIP_TOLERANCE_PX) overlaps.push(LABEL_NEARER_FOREIGN);
            if (overlaps.length === 0 && !candidate.usesLeader && nearerForeignInk(collisionBounds)) overlaps.push(LABEL_NEARER_FOREIGN);
            // Routing cannot repair a glyph box that is already illegal. Keep
            // those candidates for diagnostics without exploring their elbows.
            if (overlaps.length > 0) return candidate;
            const fixedLabels = fixedLabelObstacles;
            const routed = routeLeader(candidate, fixedLabelBounds, owner.viewBounds, minGapPx,
              owner.leaderGeometrySafe ? leaderGeometry : [], [], owner.leaderGeometrySafe ? geometryQuery : undefined);
            if (routed) return routed;
            for (const obstacle of fixedLabels) {
              if (leaderCrosses(candidate, obstacle.bounds, minGapPx) && !overlaps.includes(obstacle.id)) overlaps.push(obstacle.id);
            }
            if (owner.leaderGeometrySafe) overlaps.push("leader_geometry");
            return candidate;
          });
        leaderCandidates.push(...atDistance);
        atDistance.forEach(rememberCandidate);
        if (feasibilityOnly && legalLeaderDomain.length) return feasible(legalLeaderDomain[0]!);
      }
      const nearbyCandidates: LabelPlacementCandidate[] = owner.tetherPx !== undefined
        ? nearbyTetheredCenters(owner, solverObstacles, options, minGapPx).map((center) => {
            const bounds = centeredTextBounds(owner.text, center, options);
            const collisionBounds = candidateInkBounds(owner.text, bounds, options);
            const overlaps = solverObstacles.filter((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx)).map((obstacle) => obstacle.id);
            if (outsideOwnerView(collisionBounds, owner)) overlaps.push("view_clip");
            if (offSide(collisionBounds, owner)) overlaps.push(LABEL_WRONG_SIDE);
            if (beyondTether(bounds, owner.anchor, owner.tetherPx)) overlaps.push("tether");
            if (overlaps.length === 0 && nearerForeignInk(collisionBounds)) overlaps.push(LABEL_NEARER_FOREIGN);
            return { slot: "leader", bounds, collisionBounds, score: 150 + Math.hypot(center.x - owner.anchor.x, center.y - owner.anchor.y), overlaps, usesLeader: false };
          })
        : [];
      const tetheredCandidates = [...candidates, ...leaderCandidates, ...nearbyCandidates];
      // A point letter whose every tethered spot was lost only to the
      // nearer-foreign rule keeps its name with a drawn leader from a clear
      // spot beyond the tether. Owners that fail for any other reason fail
      // exactly as before.
      const escapeCandidates = pointForeign && owner.tetherPx !== undefined && !owner.requireLeader &&
          !tetheredCandidates.some((candidate) => candidate.overlaps.length === 0) &&
          tetheredCandidates.some((candidate) => candidate.overlaps.length === 1 && candidate.overlaps[0] === LABEL_NEARER_FOREIGN)
        ? leaderDistances(owner.viewBounds)
            .filter((distance) => distance > owner.tetherPx! && distance <= POINT_ESCAPE_MAX_PX)
            .flatMap((distance) => [...leaderDirections, ...boxClearanceDirections(owner.text, distance, options, minGapPx)].flatMap((direction): LabelPlacementCandidate[] => {
              const center = { x: owner.anchor.x + direction.dx * distance, y: owner.anchor.y + direction.dy * distance };
              const bounds = centeredTextBounds(owner.text, center, options);
              const collisionBounds = candidateInkBounds(owner.text, bounds, options, false);
              const leaderTo = leaderEndpoint(owner.anchor, center, collisionBounds);
              if (!leaderTo) return [];
              const overlaps = solverObstacles
                .filter((obstacle) => labelOverlapsObstacle(collisionBounds, obstacle, minGapPx))
                .map((obstacle) => obstacle.id);
              if (outsideOwnerView(collisionBounds, owner)) overlaps.push("view_clip");
              if (offSide(collisionBounds, owner)) overlaps.push(LABEL_WRONG_SIDE);
              const candidate: LabelPlacementCandidate = {
                slot: "leader", bounds, collisionBounds, overlaps,
                score: POINT_ESCAPE_SCORE + distance + direction.preference + overlaps.length * 10,
                usesLeader: true, leaderFrom: owner.anchor, leaderTo,
              };
              if (overlaps.length > 0) return [candidate];
              const routed = routeLeader(candidate, fixedLabelBounds, owner.viewBounds, minGapPx, leaderGeometry, [], geometryQuery ?? createLeaderGeometryQuery(leaderGeometry));
              if (routed) return [routed];
              overlaps.push("leader_geometry");
              return [candidate];
            }))
        : [];
      const allCandidates = deduplicateCandidates([...tetheredCandidates, ...escapeCandidates])
        .sort((a, b) => a.score - b.score);
      // In a dense ray web every spot may sit across some ray and no leader
      // can get clear. The figure is not lost to this rule: the spots it
      // removed come back last, tried only when nothing it allows fits.
      const rivalSpots = pointForeign
        ? allCandidates
            .filter((candidate) => candidate.overlaps.length === 1 && candidate.overlaps[0] === LABEL_NEARER_FOREIGN)
            .slice(0, POINT_RIVAL_SPOTS)
            .map((candidate) => ({ ...candidate, overlaps: [], score: candidate.score + POINT_RIVAL_SCORE }))
        : [];
      const validCandidates = [
        ...allCandidates.filter((candidate) => candidate.overlaps.length === 0).slice(0, 160 - rivalSpots.length),
        ...rivalSpots,
      ];
      // Failure diagnostics depend on the best invalid slot and all of its
      // overlaps. Preserve their exact original values when no slot survives.
      if (!feasibilityOnly && deferredInk && validCandidates.length === 0) return prepareOwner(true);
      const estimated = centeredTextBounds(owner.text, owner.anchor, options);
      return {
        owner,
        originalIndex,
        candidates: allCandidates,
        validCandidates,
        area: estimated.width * estimated.height,
      };
    };
    return prepareOwner();
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
  // Both solves draw on one work budget: once it is spent neither goes on.
  const work: LabelSearchWork = { spent: 0, budget: options.searchWorkBudget ?? LABEL_SEARCH_WORK_BUDGET };
  const searches = issues.length === 0 && candidatesToSolve.length > 0;
  const straight = searches ? solveLabelPlacements(candidatesToSolve, minGapPx, "straight", solverObstacles, work, geometryQuery) : null;
  const routed = searches && !straight ? solveLabelPlacements(candidatesToSolve, minGapPx, "routed", solverObstacles, work, geometryQuery) : null;
  const selected = searches ? straight ?? routed : new Map<number, LabelPlacementCandidate>();
  const solvedBy: LabelEngineResult["solvedBy"] = straight ? "straight" : routed ? "routed" : null;
  if (!selected && candidatesToSolve.length > 0) {
    const mostConstrained = [...candidatesToSolve].sort(comparePreparedOwners)[0]!;
    issues.push({
      code: "label_overlap_unresolved",
      entityId: mostConstrained.owner.entityId,
      message: work.spent >= work.budget
        ? `No collision-free label arrangement for ${mostConstrained.owner.entityId} within the label search budget`
        : `No globally collision-free label arrangement for ${mostConstrained.owner.entityId}`,
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
    searchWork: work.spent,
    solvedBy,
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
        offSide(collisionBounds, owner) ||
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
  work: LabelSearchWork,
  geometryQuery?: (path: RenderPoint[]) => boolean,
): Map<number, LabelPlacementCandidate> | null {
  const selected = new Map<number, LabelPlacementCandidate>();
  const remaining = new Set(owners.map((owner) => owner.originalIndex));
  const byIndex = new Map(owners.map((owner) => [owner.originalIndex, owner]));
  let visited = 0;
  const maxVisited = Math.max(20_000, owners.length * 20_000);
  const fixedLabels = obstacles.filter((obstacle) => obstacle.kind === "label").map((obstacle) => obstacle.bounds);
  const exhausted = () => work.spent >= work.budget;
  // The routed search routes every leader once more as each owner is placed,
  // so the pass that places the last owner already holds the arrangement.
  // Keep it: routing it again would charge the same work twice, and a budget
  // that covered the first pass could run out on the second.
  let lastRouted: Map<number, LabelPlacementCandidate> | null = null;

  const routedSelection = (): Map<number, LabelPlacementCandidate> | null => {
    const routed = new Map<number, LabelPlacementCandidate>();
    for (const [index, candidate] of selected) {
      if (exhausted()) return null;
      const boxes = [...fixedLabels, ...[...selected].filter(([other]) => other !== index).map(([, placement]) => candidateCollisionBounds(placement))];
      const owner = byIndex.get(index)?.owner;
      const geometry = owner?.leaderGeometrySafe ? obstacles.filter((obstacle) => obstacle.kind !== "label") : [];
      const otherLeaders = [...routed.values()].flatMap(leaderPoints);
      work.spent += routeLeaderWork(candidate, boxes, geometry, otherLeaders);
      const route = routeLeader(candidate, boxes, owner?.viewBounds, minGapPx, geometry, otherLeaders, owner?.leaderGeometrySafe ? geometryQuery : undefined);
      if (!route) return null;
      routed.set(index, route);
    }
    return routed;
  };

  const pool = owners.flatMap((owner) => owner.validCandidates);
  // Bit offsets retain candidate order. Counts retain the original search
  // work and minimum-domain ordering; word intersections avoid repeated scans.
  interface Domain { bits: Uint32Array; count: number }
  interface CompatibilityMask { known: Uint32Array; accepted: Uint32Array }
  const bases = new Map<number, number>();
  let nextId = 0;
  const domains = new Map<number, Domain>(owners.map(owner => {
    const count = owner.validCandidates.length;
    bases.set(owner.originalIndex, nextId);
    nextId += count;
    const bits = new Uint32Array(Math.ceil(count / 32));
    bits.fill(0xffffffff);
    if (count % 32) bits[bits.length - 1] = 0xffffffff >>> (32 - count % 32);
    return [owner.originalIndex, { bits, count }];
  }));
  // Cache only pairs actually requested by a domain, scoped to this search.
  // No speculative pair tests or cross-call state changes the work budget.
  const masks = new Map<number, Map<number, CompatibilityMask>>();
  const narrow = (index: number, domain: Domain, placed: number): Domain => {
    let ownerMasks = masks.get(index);
    if (!ownerMasks) { ownerMasks = new Map(); masks.set(index, ownerMasks); }
    let mask = ownerMasks.get(placed);
    if (!mask) { mask = { known: new Uint32Array(domain.bits.length), accepted: new Uint32Array(domain.bits.length) }; ownerMasks.set(placed, mask); }
    const base = bases.get(index)!;
    const other = pool[placed]!;
    const bits = new Uint32Array(domain.bits.length);
    let count = 0;
    for (let wordIndex = 0; wordIndex < bits.length; wordIndex++) {
      const current = domain.bits[wordIndex]!;
      let missing = current & ~mask.known[wordIndex]!;
      while (missing !== 0) {
        const bit = missing & -missing;
        const offset = wordIndex * 32 + 31 - Math.clz32(bit);
        const candidate = pool[base + offset]!;
        const accepted = routing === "routed"
          ? !boundsOverlap(candidateCollisionBounds(candidate), candidateCollisionBounds(other), minGapPx)
          : compatible(candidate, other, minGapPx);
        if (accepted) mask.accepted[wordIndex] = mask.accepted[wordIndex]! | bit;
        missing ^= bit;
      }
      mask.known[wordIndex] = mask.known[wordIndex]! | current;
      let value = current & mask.accepted[wordIndex]!;
      bits[wordIndex] = value;
      // Population count of this 32-candidate intersection.
      value -= (value >>> 1) & 0x55555555;
      value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
      count += (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }
    return { bits, count };
  };

  // `domains` holds, for each unplaced owner, its candidates that stand with
  // every placed label, in candidate order. Placing a label narrows each
  // domain by that one label instead of retesting every candidate against
  // every placed label, which reaches the same domains in the same order.
  const search = (domains: Map<number, Domain>): boolean => {
    if (remaining.size === 0) return true;
    if (visited >= maxVisited || exhausted()) return false;

    let next: { owner: PreparedLabelOwner; compatible: Domain } | undefined;
    for (const index of remaining) {
      const owner = byIndex.get(index)!;
      const compatible = domains.get(index)!;
      if (!next || compatible.count < next.compatible.count ||
          (compatible.count === next.compatible.count && comparePreparedOwners(owner, next.owner) < 0)) next = { owner, compatible };
    }
    if (!next) return true;
    if (next.compatible.count === 0) return false;

    remaining.delete(next.owner.originalIndex);
    for (let offset = 0; offset < next.owner.validCandidates.length; offset++) {
      if (!(next.compatible.bits[offset >>> 5]! & (1 << (offset & 31)))) continue;
      const placed = bases.get(next.owner.originalIndex)! + offset;
      visited += 1;
      selected.set(next.owner.originalIndex, pool[placed]!);
      const routed = routing === "routed" ? routedSelection() : null;
      if (routed) lastRouted = routed;
      if (routing === "straight" || routed) {
        const narrowed = new Map<number, Domain>();
        let impossible = false;
        for (const index of remaining) {
          const domain = domains.get(index)!;
          if (impossible) {
            // Keep the identical deterministic work accounting. Once one
            // domain is empty no later compatibility result can save this
            // branch, so its remaining pair tests need not execute.
            work.spent += domain.count;
            continue;
          }
          // No budget decision occurs inside this domain. Charge the same
          // number of tests together, before the next search boundary.
          work.spent += domain.count;
          const compatible = narrow(index, domain, placed);
          narrowed.set(index, compatible);
          if (compatible.count === 0) impossible = true;
        }
        if (!impossible && search(narrowed)) return true;
      }
      selected.delete(next.owner.originalIndex);
      if (visited >= maxVisited || exhausted()) break;
    }
    remaining.add(next.owner.originalIndex);
    return false;
  };

  if (exhausted()) return null;
  return search(domains) ? (routing === "routed" ? lastRouted : selected) : null;
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
  if (!first.leaderFrom || !first.leaderTo || !second.leaderFrom || !second.leaderTo) return false;
  return leaderPathsConflict(first.leaderPath ?? [first.leaderFrom, first.leaderTo], second.leaderPath ?? [second.leaderFrom, second.leaderTo]);
}

/** Leaders may branch at one shared owner anchor, but never cross or share ink. */
function leaderPathsConflict(first: RenderPoint[], second: RenderPoint[]): boolean {
  const sharedAnchor = Math.hypot(first[0]!.x - second[0]!.x, first[0]!.y - second[0]!.y) <= 1e-6;
  for (let index = 1; index < first.length; index++) for (let otherIndex = 1; otherIndex < second.length; otherIndex++) {
    const end = first[index]!;
    const start = first[index - 1]!;
    const otherEnd = second[otherIndex]!;
    const otherStart = second[otherIndex - 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const ex = otherEnd.x - otherStart.x;
    const ey = otherEnd.y - otherStart.y;
    const ax = otherStart.x - start.x;
    const ay = otherStart.y - start.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-9) {
      if (Math.abs(ax * dy - ay * dx) > 1e-6) continue;
      const span = dx * dx + dy * dy;
      if (span < 1e-9) continue;
      const a = (ax * dx + ay * dy) / span;
      const b = ((otherEnd.x - start.x) * dx + (otherEnd.y - start.y) * dy) / span;
      if (Math.min(1, Math.max(a, b)) - Math.max(0, Math.min(a, b)) > 1e-6) return true;
      continue;
    }
    const along = (ax * ey - ay * ex) / denominator;
    const across = (ax * dy - ay * dx) / denominator;
    if (along < -1e-6 || along > 1 + 1e-6 || across < -1e-6 || across > 1 + 1e-6) continue;
    const hit = { x: start.x + dx * along, y: start.y + dy * along };
    if (!sharedAnchor || Math.hypot(hit.x - first[0]!.x, hit.y - first[0]!.y) > 1e-6) return true;
  }
  return false;
}

/**
 * A leader must keep the same clear air from a neighbour's text that two labels
 * keep from each other — the reserved box is the em box, so a descender reaches
 * a little past it and a line grazing the edge still crosses ink.
 */
function leaderCrosses(candidate: LabelPlacementCandidate, bounds: LabelBounds, gap: number): boolean {
  if (!candidate.leaderFrom || !candidate.leaderTo) return false;
  const path = candidate.leaderPath;
  const expanded = {
    x: bounds.x - gap,
    y: bounds.y - gap,
    width: bounds.width + gap * 2,
    height: bounds.height + gap * 2,
  };
  if (!path) return segmentIntersectsBounds(candidate.leaderFrom, candidate.leaderTo, expanded);
  for (let index = 1; index < path.length; index++) {
    if (segmentIntersectsBounds(path[index - 1]!, path[index]!, expanded)) return true;
  }
  return false;
}

/**
 * Work units for one `routeLeader` call: every elbow it tries, times the
 * boxes, strokes and leaders it tests that elbow against. A label without a
 * leader returns at once and costs one unit.
 */
function routeLeaderWork(
  candidate: LabelPlacementCandidate,
  obstacles: LabelBounds[],
  geometry: LabelObstacle[],
  otherLeaders: RenderPoint[][],
): number {
  if (!candidate.leaderFrom || !candidate.leaderTo) return 1;
  let strokes = 0;
  let stroked = 0;
  for (const obstacle of geometry) {
    if (!obstacle.segments?.length) continue;
    strokes += obstacle.segments.length;
    stroked += 1;
  }
  const routes = 3 + 4 * (obstacles.length + stroked + otherLeaders.length);
  return routes * (2 + obstacles.length + strokes + otherLeaders.length);
}

/** A small deterministic set of elbows around reserved text; no arbitrary pixels. */
function routeLeader(
  candidate: LabelPlacementCandidate,
  obstacles: LabelBounds[],
  viewBounds: LabelBounds | undefined,
  gap: number,
  geometry: LabelObstacle[] = [],
  otherLeaders: RenderPoint[][] = [],
  geometryQuery?: (path: RenderPoint[]) => boolean,
): LabelPlacementCandidate | null {
  const from = candidate.leaderFrom;
  const to = candidate.leaderTo;
  if (!from || !to) return candidate;
  // The straight segment is the shortest possible route. If it is legal,
  // no elbow enumeration can improve the length/order tie-break below.
  const straight = { ...candidate, leaderPath: undefined };
  const directPath = [from, to];
  if ((!viewBounds || directPath.every(point =>
      point.x >= viewBounds.x && point.x <= viewBounds.x + viewBounds.width &&
      point.y >= viewBounds.y && point.y <= viewBounds.y + viewBounds.height)) &&
      !leaderCrosses(straight, candidateCollisionBounds(candidate), 0) &&
      obstacles.every(box => !leaderCrosses(straight, box, gap)) &&
      !(geometryQuery ? geometryQuery(directPath) : leaderCrossesGeometry(directPath, geometry)) &&
      otherLeaders.every(other => !leaderPathsConflict(directPath, other))) return straight;
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
    .filter((path) => !(geometryQuery ? geometryQuery(path) : leaderCrossesGeometry(path, geometry)))
    .filter((path) => otherLeaders.every((other) => !leaderPathsConflict(path, other)))
    .sort((a, b) => routeLength(a) - routeLength(b) || a.length - b.length);
  const path = legal[0];
  return path ? { ...candidate, leaderPath: path.length > 2 ? path : undefined } : null;
}

function leaderCrossesGeometry(path: RenderPoint[], obstacles: LabelObstacle[]): boolean {
  const anchor = path[0]!;
  for (let index = 1; index < path.length; index++) {
    const start = path[index - 1]!;
    const end = path[index]!;
    for (const obstacle of obstacles) {
      for (const [a, b] of obstacle.segments ?? []) {
        if (leaderCrossesStroke(start, end, a, b, anchor)) return true;
      }
    }
  }
  return false;
}

function leaderCrossesStroke(start: RenderPoint, end: RenderPoint, a: RenderPoint, b: RenderPoint, anchor: RenderPoint): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  // A conservative broad phase includes the parametric endpoint tolerances
  // below and the near-collinear allowance. It never replaces their proof.
  const margin = 1 + 1e-6 * (Math.abs(dx) + Math.abs(dy) + Math.abs(ex) + Math.abs(ey));
  if (Math.max(start.x, end.x) + margin < Math.min(a.x, b.x) ||
      Math.max(a.x, b.x) + margin < Math.min(start.x, end.x) ||
      Math.max(start.y, end.y) + margin < Math.min(a.y, b.y) ||
      Math.max(a.y, b.y) + margin < Math.min(start.y, end.y)) return false;
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
  // Compiled points round to hundredths of a pixel; admit shared contact only.
  return Math.hypot(hit.x - anchor.x, hit.y - anchor.y) > 0.05;
}

function outsideOwnerView(bounds: LabelBounds, owner: LabelOwner): boolean {
  return Boolean(
    (owner.viewBounds && !boundsInside(bounds, owner.viewBounds)) ||
    (owner.placementBounds && !boundsInside(bounds, owner.placementBounds)),
  );
}

function offSide(bounds: LabelBounds, owner: LabelOwner): boolean {
  return Boolean(owner.sideRegions?.some((region) => !boundsInSideRegion(bounds, region)));
}

/** True when the whole box lies in the region (touching its edge is legal). */
export function boundsInSideRegion(bounds: LabelBounds, region: LabelSideRegion): boolean {
  const corners: RenderPoint[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
  if (region.kind === "half_plane") {
    return corners.every((corner) =>
      (corner.x - region.point.x) * region.normal.x + (corner.y - region.point.y) * region.normal.y >= 0);
  }
  if (region.kind === "circle") {
    if (region.inside) {
      return corners.every((corner) => Math.hypot(corner.x - region.center.x, corner.y - region.center.y) <= region.radius);
    }
    const nearestX = Math.max(bounds.x, Math.min(region.center.x, bounds.x + bounds.width));
    const nearestY = Math.max(bounds.y, Math.min(region.center.y, bounds.y + bounds.height));
    return Math.hypot(nearestX - region.center.x, nearestY - region.center.y) >= region.radius;
  }
  const crossesEdge = pathSegments(region.points, true).some(([start, end]) => segmentIntersectsBounds(start, end, bounds));
  if (crossesEdge) return false;
  const cornersInside = corners.map((corner) => pointInPolygon(corner, region.points));
  return region.inside ? cornersInside.every(Boolean) : !cornersInside.some(Boolean);
}

function pointInPolygon(point: RenderPoint, polygon: RenderPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
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
      primitiveKind: primitive.kind,
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
  // Most sampled-curve segments are nowhere near this label. Reject their
  // bounds before constructing edge endpoints or testing orientations.
  if (Math.max(start.x, end.x) < left || Math.min(start.x, end.x) > right ||
      Math.max(start.y, end.y) < top || Math.min(start.y, end.y) > bottom) return false;
  if ((start.x >= left && start.x <= right && start.y >= top && start.y <= bottom) ||
      (end.x >= left && end.x <= right && end.y >= top && end.y <= bottom)) return true;
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
  const abC = segmentCross(a, b, c);
  const abD = segmentCross(a, b, d);
  const cdA = segmentCross(c, d, a);
  const cdB = segmentCross(c, d, b);
  return abC * abD <= 0 && cdA * cdB <= 0;
}

function segmentCross(p: RenderPoint, q: RenderPoint, r: RenderPoint): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
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

/**
 * Px a foreign stroke must be nearer than the owner's own ink before a label
 * reads as naming it. Ties stay legal: at a shared tip, or along a component
 * drawn on an axis, the two strokes are the same distance away.
 */
const OWNERSHIP_TOLERANCE_PX = 1;

/** A box anchor further than this from the owner's ink sits in empty air. */
const SLOT_ANCHOR_DRIFT_PX = 8;

interface StrokeOwnership {
  ink: Array<[RenderPoint, RenderPoint]>;
  /** The owner's longest single stroke, where its stroke slots are taken. */
  stroke: Array<[RenderPoint, RenderPoint]>;
  foreign: Array<Array<[RenderPoint, RenderPoint]>>;
}

/** Primitive kinds drawn as one straight open stroke whose label names the stroke. */
const OPEN_STROKE_KINDS = new Set<RenderPrimitive["kind"]>(["line", "ray", "vector"]);

/**
 * A polyline of at most this many straight pieces (a right-angle mark, a bent
 * path) is judged like a stroke. Sampled curves, waves and component symbols
 * have many pieces and keep their own label anchors.
 */
const STROKE_POLYLINE_MAX_PIECES = 2;

/**
 * The owner's own stroke ink and every other entity's stroke ink, for owners
 * drawn only as straight open strokes (segments, rays, vectors, right-angle
 * marks and other short open polylines), whose label is placed around the
 * stroke and must read as naming it.
 *
 * Closed shapes, axes, circles and sampled curves name a region, a frame or
 * a graph, and keep their own anchors; owners whose label is held to a side
 * region, a placement box or the anchor itself already follow a stronger
 * rule. None of these are judged here and their slots are unchanged.
 */
function strokeOwnership(owner: LabelOwner, obstacles: LabelObstacle[]): StrokeOwnership | null {
  if (owner.sideRegions?.length || owner.placementBounds || owner.pinToAnchor) return null;
  const own = obstacles.filter((obstacle) => obstacle.kind === "geometry" && obstacle.entityId === owner.entityId);
  if (own.length === 0 || !own.every((obstacle) => isOpenStroke(obstacle))) return null;
  const strokes = own.map((obstacle) => obstacle.segments!);
  const strokeLength = (segments: Array<[RenderPoint, RenderPoint]>) =>
    segments.reduce((sum, [start, end]) => sum + Math.hypot(end.x - start.x, end.y - start.y), 0);
  const stroke = strokes.reduce((longest, segments) => strokeLength(segments) > strokeLength(longest) ? segments : longest);
  const ink = strokes.flat();
  const foreign = obstacles
    .filter((obstacle) => obstacle.kind === "geometry" && obstacle.entityId !== undefined && obstacle.entityId !== owner.entityId && obstacle.segments?.length)
    .map((obstacle) => obstacle.segments!);
  return { ink, stroke, foreign };
}

/**
 * A point's label is read as naming the nearest mark. A box across another
 * straight line from its point, and nearer that line than the point, names
 * the line instead: V1 written past a directrix. Strokes through the point
 * (the curve it lies on, the axis it sits on, a ray drawn through a focus)
 * are its hosts, not rivals. Each axis of an axes pair is judged on its own,
 * so a point on the x axis is still judged against the y axis.
 *
 * Curves and closed outlines are not rivals: the outline of a bob, a lens or
 * an ellipse around an interior point always lies between that point and a
 * label outside it, and there the outline is read as the body, not named.
 */
const POINT_HOST_PX = 6;
/** A vertex mark (right-angle square, angle arc) lies within this of its point. */
const POINT_MARK_RADIUS_PX = 48;
/** Escape leaders run no further than this from the point. */
const POINT_ESCAPE_MAX_PX = 160;
/** An escape leader ranks behind every tethered slot. */
const POINT_ESCAPE_SCORE = 300;
/** Spots across a rival line rank behind every escape leader. */
const POINT_RIVAL_SCORE = 1000;
const POINT_RIVAL_SPOTS = 40;

function pointForeignStrokes(owner: LabelOwner, obstacles: LabelObstacle[]): Array<Array<[RenderPoint, RenderPoint]>> | null {
  if (owner.sideRegions?.length || owner.placementBounds || owner.pinToAnchor) return null;
  const own = obstacles.filter((obstacle) => obstacle.kind === "geometry" && obstacle.entityId === owner.entityId);
  if (own.length === 0 || !own.every((obstacle) => obstacle.primitiveKind === "point")) return null;
  const strokes = obstacles
    .filter((obstacle) => obstacle.kind === "geometry" && obstacle.entityId !== undefined && obstacle.entityId !== owner.entityId && obstacle.segments?.length &&
      (obstacle.primitiveKind === "axes" || isOpenStroke(obstacle)))
    .flatMap((obstacle) => obstacle.primitiveKind === "axes"
      ? obstacle.segments!.map((segment) => ({ segments: [segment], kind: obstacle.primitiveKind }))
      : [{ segments: obstacle.segments!, kind: obstacle.primitiveKind }]);
  const near = (point: RenderPoint, segments: Array<[RenderPoint, RenderPoint]>) =>
    segments.some(([start, end]) => pointToSegmentDistance(point, start, end) <= POINT_HOST_PX);
  const hosts = strokes.filter((stroke) => near(owner.anchor, stroke.segments)).map((stroke) => stroke.segments);
  // A right-angle square at the point is a two piece corner path whose ends
  // sit on two different hosts at one distance from the point. It marks the
  // point's angle and names nothing. A drawn line, ray or vector is never a
  // mark, however short: a triangle side close to its vertex is a rival.
  const vertexMark = (stroke: { segments: Array<[RenderPoint, RenderPoint]>; kind: RenderPrimitive["kind"] | undefined }) => {
    const segments = stroke.segments;
    if (stroke.kind !== "polyline" || segments.length !== 2) return false;
    const start = segments[0]![0];
    const end = segments.at(-1)![1];
    const reach = (point: RenderPoint) => Math.hypot(point.x - owner.anchor.x, point.y - owner.anchor.y);
    if (Math.abs(reach(start) - reach(end)) > Math.max(1.5, 0.15 * Math.max(reach(start), reach(end)))) return false;
    const startHost = hosts.findIndex((host) => near(start, host));
    const endHost = hosts.findIndex((host, index) => index !== startHost && near(end, host));
    return segments.every(([a, b]) => reach(a) <= POINT_MARK_RADIUS_PX && reach(b) <= POINT_MARK_RADIUS_PX) &&
      startHost >= 0 && endHost >= 0;
  };
  const foreign = strokes.filter((stroke) => !near(owner.anchor, stroke.segments) && !vertexMark(stroke)).map((stroke) => stroke.segments);
  return foreign.length ? foreign : null;
}

function pointLabelNearerForeign(box: LabelBounds, anchor: RenderPoint, foreign: Array<Array<[RenderPoint, RenderPoint]>>): boolean {
  const own = Math.hypot(
    Math.max(box.x - anchor.x, 0, anchor.x - (box.x + box.width)),
    Math.max(box.y - anchor.y, 0, anchor.y - (box.y + box.height)),
  );
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return foreign.some((segments) => segmentsToBoundsDistance(segments, box) < own - OWNERSHIP_TOLERANCE_PX &&
    segments.some(([start, end]) => segmentsIntersect(anchor, center, start, end)));
}

function isOpenStroke(obstacle: LabelObstacle): boolean {
  const segments = obstacle.segments;
  if (!segments?.length || !obstacle.primitiveKind) return false;
  if (!OPEN_STROKE_KINDS.has(obstacle.primitiveKind) && !(obstacle.primitiveKind === "polyline" && segments.length <= STROKE_POLYLINE_MAX_PIECES)) return false;
  const start = segments[0]![0];
  const end = segments.at(-1)![1];
  return segments.length === 1 || Math.hypot(end.x - start.x, end.y - start.y) > 1;
}

/**
 * A label this much nearer its owner than any other stroke names it without
 * doubt. Under it (a slot at a tip the owner shares with another vector, or
 * beside a component drawn on an axis) the slot is legal but ranks behind
 * every clear one.
 */
const OWNERSHIP_CLEAR_MARGIN_PX = 8;
const AMBIGUOUS_OWNER_PENALTY = 12;

/** Nearest foreign stroke distance minus nearest owner stroke distance. */
function ownershipMargin(box: LabelBounds, ownership: StrokeOwnership): number {
  const own = segmentsToBoundsDistance(ownership.ink, box);
  let foreign = Infinity;
  for (const segments of ownership.foreign) {
    if (screenedByOwner(box, segments, ownership.stroke)) continue;
    foreign = Math.min(foreign, segmentsToBoundsDistance(segments, box));
    if (foreign - own < -OWNERSHIP_TOLERANCE_PX) break;
  }
  return foreign - own;
}

/**
 * A foreign stroke wholly across the owner's straight stroke from a label
 * beside it cannot be read as the label's owner: the owner lies between them.
 * A photon arrow ending on an energy level, with the level's name under the
 * level, is such a stroke. Beyond the owner's ends (a tip shared with another
 * vector) nothing is screened.
 */
function screenedByOwner(box: LabelBounds, segments: Array<[RenderPoint, RenderPoint]>, stroke: Array<[RenderPoint, RenderPoint]>): boolean {
  if (stroke.length !== 1) return false;
  const [start, end] = stroke[0]!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return false;
  const along = (point: RenderPoint) => ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length);
  const across = (point: RenderPoint) => (dx * (point.y - start.y) - dy * (point.x - start.x)) / length;
  const corners = [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height },
  ];
  if (!corners.every((corner) => along(corner) > 0 && along(corner) < 1)) return false;
  const side = Math.sign(across(corners[0]!));
  if (side === 0 || !corners.every((corner) => Math.sign(across(corner)) === side)) return false;
  return segments.every(([a, b]) => across(a) * side <= OWNERSHIP_TOLERANCE_PX && across(b) * side <= OWNERSHIP_TOLERANCE_PX);
}

function onInk(point: RenderPoint, ink: Array<[RenderPoint, RenderPoint]>): boolean {
  return segmentsToBoundsDistance(ink, { x: point.x, y: point.y, width: 0, height: 0 }) <= SLOT_ANCHOR_DRIFT_PX;
}

/** Fractions along the owner's main stroke where a stroke slot may sit. */
const STROKE_SLOT_STATIONS = [0.5, 0.3, 0.7];

/** Furthest a stroke slot slides out before it is given up. */
const STROKE_SLOT_MAX_SLIDE_PX = 96;

/**
 * Compass slots taken along a stroke whose box anchor is in empty air.
 *
 * The axis-aligned box of a diagonal stroke has its edge midpoints and two of
 * its corners off the ink: the east edge of a vector drawn up and to the right
 * is exactly where its vertical component is drawn, so the old east slot wrote
 * the vector's name beside the component. Here each slot starts on the stroke
 * itself (its label anchor, then stations along the longest stroke) and
 * slides out in the slot's direction until the box clears the stroke by the
 * same margin a box anchor gives an axis-aligned stroke. A slot that runs
 * along the stroke and never clears it is dropped.
 */
function strokeSlotPlacements(
  owner: LabelOwner,
  ownership: StrokeOwnership,
  slot: { slot: Exclude<LabelSlot, "leader">; dx: number; dy: number },
  options: LabelEngineOptions,
  anchorGap: number,
): Array<{ anchor: RenderPoint; bounds: LabelBounds }> {
  // A box anchor sits the obstacle pad (4 px) outside the ink.
  const clearance = anchorGap + 4;
  const stations = [
    ...(onInk(owner.anchor, ownership.ink) ? [owner.anchor] : []),
    ...STROKE_SLOT_STATIONS.map((fraction) => pointAlongStroke(ownership.stroke, fraction)),
  ].filter((point, index, all) => all.findIndex((other) => Math.hypot(other.x - point.x, other.y - point.y) < 4) === index);
  return stations.flatMap((anchor) => {
    for (let slide = 0; slide <= STROKE_SLOT_MAX_SLIDE_PX; slide += 2) {
      const bounds = textBoundsAtSlot(owner.text, anchor, slot.slot, options, slide);
      if (segmentsToBoundsDistance(ownership.ink, bounds) >= clearance) return [{ anchor, bounds }];
    }
    return [];
  });
}

function pointAlongStroke(stroke: Array<[RenderPoint, RenderPoint]>, fraction: number): RenderPoint {
  const lengths = stroke.map(([start, end]) => Math.hypot(end.x - start.x, end.y - start.y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * fraction;
  for (let index = 0; index < stroke.length; index += 1) {
    const [start, end] = stroke[index]!;
    const length = lengths[index]!;
    if (remaining <= length || index === stroke.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    }
    remaining -= length;
  }
  return stroke[0]![0];
}

function segmentsToBoundsDistance(segments: Array<[RenderPoint, RenderPoint]>, box: LabelBounds): number {
  let best = Infinity;
  for (const [start, end] of segments) {
    best = Math.min(best, segmentToBoundsDistance(start, end, box));
    if (best === 0) return 0;
  }
  return best;
}

function segmentToBoundsDistance(start: RenderPoint, end: RenderPoint, box: LabelBounds): number {
  if (segmentIntersectsBounds(start, end, box)) return 0;
  const pointToBox = (point: RenderPoint) => Math.hypot(
    Math.max(box.x - point.x, 0, point.x - (box.x + box.width)),
    Math.max(box.y - point.y, 0, point.y - (box.y + box.height)),
  );
  const corners = [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height },
  ];
  return Math.min(pointToBox(start), pointToBox(end), ...corners.map((corner) => pointToSegmentDistance(corner, start, end)));
}

function pointToSegmentDistance(point: RenderPoint, start: RenderPoint, end: RenderPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}
