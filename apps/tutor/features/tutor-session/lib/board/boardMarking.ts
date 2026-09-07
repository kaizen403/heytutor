/**
 * Mark & Ask — the student's own marker.
 *
 * A student who does not follow a line does not want to describe it; they want
 * to point at it. This module turns a freehand stroke drawn over the board into
 * a *grounded* statement about what was marked.
 *
 * The grounding is deterministic on purpose. Everything the student can mark is
 * already registered with exact text and exact geometry — handwritten work rows
 * in `BoardLayoutState.rects` (each carrying its `workId` and the string that
 * was written) and verified figure parts in `VerifiedDiagram.anchors` (each
 * carrying its entity id, its drawn labels, and a glossary entry). So a circle
 * round `1/v = 1/15 - 1/20` resolves to that exact line, and a circle round
 * the whole working resolves to every line inside it. The doubt prompt quotes
 * those strings. No screenshot, no vision model, no guessing what the ring was
 * around — the same rule the diagram engine lives under: a wrong reading is
 * worse than no reading.
 *
 * A stroke that lands on nothing stays honest. It resolves to a *region*, which
 * can name where the mark is ("in the figure", "in the work column") and never
 * what it is on. The prompt says the student marked an empty part of the board
 * rather than inventing a line for them.
 */
import type { VerifiedDiagram, VerifiedLabelFact } from "@heytutor/drawing";
import { DIAGRAM_ZONE } from "../../constants";
import type { BoardTextRect } from "../../types";

export interface MarkPoint {
  x: number;
  y: number;
}

export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the student's hand did. Read from the stroke alone, then refined at
 * resolution time — a horizontal line under a row is an underline, the same
 * line through the middle of that row is a strike.
 */
export type MarkGesture = "circle" | "underline" | "strike" | "scribble" | "point";

export type MarkTargetKind =
  /** A handwritten row in the left work column. */
  | "work"
  /** Board text that is not a numbered work row — a heading or a figure label. */
  | "board_text"
  /** A verified figure part, by entity id. */
  | "diagram"
  /** The stroke hit nothing. Position only; never content. */
  | "region";

export interface MarkTarget {
  kind: MarkTargetKind;
  /** Exact board text, or the region name for `region`. Never paraphrased. */
  text: string;
  rect: MarkRect;
  /** Work-row handle (`w3`) when the target is a numbered row. */
  workId?: string;
  /** Verified entity id, so the teaching stream may `[FOCUS:id]` it again. */
  entityId?: string;
  /** Expanded meaning of a figure symbol, when the glossary carries one. */
  meaning?: string;
}

export interface BoardMark {
  id: string;
  gesture: MarkGesture;
  points: MarkPoint[];
  bounds: MarkRect;
  /**
   * The first enclosed object, in board order. Same as `targets[0]`. Kept so
   * a tap or a ring round one line still has a single obvious reading.
   */
  target: MarkTarget;
  /**
   * Every board object the stroke enclosed. A ring round one row has one
   * entry; a ring round the whole working has every line inside it.
   */
  targets: MarkTarget[];
}

/** A stroke shorter than this is a tap, not a gesture. */
const POINT_LENGTH_PX = 26;
/** More marks than this stop being a question and start being a drawing. */
export const MAX_MARKS = 6;
/** Points kept per stroke after resampling. Enough for shape, cheap to render. */
const MAX_STROKE_POINTS = 240;
/** Resample spacing — a chisel highlighter shows nothing finer. */
const RESAMPLE_SPACING_PX = 2.5;
/** How far outside a row a stroke may sit and still be about that row. */
const TARGET_PAD_PX = 14;
/**
 * Fraction of a row's box that must sit inside the stroke's bounds for that
 * row to count as enclosed. High enough that a ring round one line does not
 * pick up the neighbour it merely grazes; low enough that a slightly open
 * oval still keeps every line it clearly contains.
 */
const ENCLOSE_COVERAGE = 0.48;
/** Underline band below a row's baseline. */
const UNDERLINE_REACH_PX = 34;
/** Text longer than this is truncated in the prompt; board rows are short. */
const MAX_TARGET_TEXT = 240;

/** The left work column. Mirrors `withWorkRowIdentity`'s split. */
const WORK_AREA_MAX_X = 400;

export function markStrokeBounds(points: MarkPoint[]): MarkRect {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function markStrokeLength(points: MarkPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Even out pointer sampling. A trackpad emits hundreds of points in a flick and
 * a touch screen emits a dozen; both must classify and draw the same way.
 */
export function resampleStroke(points: MarkPoint[]): MarkPoint[] {
  if (points.length <= 2) {
    return [...points];
  }
  const out: MarkPoint[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (segment <= 0) continue;
    carried += segment;
    if (carried >= RESAMPLE_SPACING_PX) {
      out.push(current);
      carried = 0;
    }
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) {
    out.push(last);
  }
  if (out.length <= MAX_STROKE_POINTS) {
    return out;
  }
  // Keep the ends; thin the middle. A dropped interior point never changes
  // which row the stroke is on.
  const stride = out.length / MAX_STROKE_POINTS;
  const thinned: MarkPoint[] = [];
  for (let i = 0; i < MAX_STROKE_POINTS; i++) {
    thinned.push(out[Math.min(out.length - 1, Math.floor(i * stride))]);
  }
  thinned[thinned.length - 1] = out[out.length - 1];
  return thinned;
}

/** Sign changes in horizontal travel — what separates a scribble from a ring. */
function horizontalReversals(points: MarkPoint[]): number {
  let reversals = 0;
  let direction = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    if (Math.abs(dx) < 2) continue;
    const next = dx > 0 ? 1 : -1;
    if (direction !== 0 && next !== direction) {
      reversals += 1;
    }
    direction = next;
  }
  return reversals;
}

/**
 * Read the hand, not the intent. `strike` is never returned here: a horizontal
 * stroke only becomes a strike once we know it crosses a row's middle, which
 * `resolveMarkTarget` decides.
 */
export function classifyMarkGesture(points: MarkPoint[]): MarkGesture {
  if (points.length < 2) {
    return "point";
  }
  const length = markStrokeLength(points);
  if (length < POINT_LENGTH_PX) {
    return "point";
  }

  const bounds = markStrokeBounds(points);
  const endGap = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].y - points[0].y,
  );
  const closure = endGap / length;
  const reversals = horizontalReversals(points);

  // A back-and-forth over a short band is a cross-out, whatever its closure.
  if (reversals >= 4 && bounds.height < 46) {
    return "scribble";
  }
  // Ends met up and the path enclosed real area on both axes.
  if (closure < 0.34 && length >= 80 && Math.min(bounds.width, bounds.height) >= 20) {
    return "circle";
  }
  // Flat and wide: a rule drawn along a line of writing.
  if (bounds.height <= 26 && bounds.width >= 36) {
    return "underline";
  }
  if (reversals >= 3) {
    return "scribble";
  }
  return closure < 0.5 ? "circle" : "underline";
}

function rectOf(rect: MarkRect): MarkRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function rectCenter(rect: MarkRect): MarkPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function intersectionArea(a: MarkRect, b: MarkRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function pointInflatedRect(point: MarkPoint, rect: MarkRect, pad: number): boolean {
  return (
    point.x >= rect.x - pad &&
    point.x <= rect.x + rect.width + pad &&
    point.y >= rect.y - pad &&
    point.y <= rect.y + rect.height + pad
  );
}

/** Ray-cast. A closed oval is a polygon; a tap is not. */
function pointInPolygon(point: MarkPoint, polygon: readonly MarkPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;
    if (yi === yj) continue;
    const crosses = yi > point.y !== yj > point.y;
    if (!crosses) continue;
    const atX = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (point.x < atX) inside = !inside;
  }
  return inside;
}

function sortCandidates(candidates: MarkCandidate[]): MarkCandidate[] {
  return [...candidates].sort((a, b) => {
    const byY = a.rect.y - b.rect.y;
    if (Math.abs(byY) > 4) return byY;
    return a.rect.x - b.rect.x;
  });
}

function dedupeCandidates(candidates: MarkCandidate[]): MarkCandidate[] {
  const seen = new Set<string>();
  const unique: MarkCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.workId
      ? `work:${candidate.workId}`
      : candidate.entityId
        ? `entity:${candidate.entityId}`
        : `${candidate.kind}:${candidate.text}:${Math.round(candidate.rect.y / 4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

/**
 * Every board object that actually sits inside this stroke. Coverage of the
 * row's box is the main test (a big oval around the working keeps every
 * line). A small ring inside one long row is rescued by the stroke's centre
 * sitting in that row, which is how a circle round one term still names it.
 */
function enclosedCandidates(
  bounds: MarkRect,
  points: readonly MarkPoint[],
  candidates: readonly MarkCandidate[],
): MarkCandidate[] {
  const strokeCenter = rectCenter(bounds);
  const enclosed: MarkCandidate[] = [];
  for (const candidate of candidates) {
    const area = Math.max(candidate.rect.width * candidate.rect.height, 1);
    const coverage = intersectionArea(bounds, candidate.rect) / area;
    const rowCenterInStroke = pointInPolygon(rectCenter(candidate.rect), points);
    const strokeCenterInRow = pointInflatedRect(strokeCenter, candidate.rect, TARGET_PAD_PX);
    if (
      coverage >= ENCLOSE_COVERAGE ||
      (rowCenterInStroke && coverage > 0) ||
      (strokeCenterInRow && coverage > 0.02)
    ) {
      enclosed.push(candidate);
    }
  }
  return sortCandidates(dedupeCandidates(enclosed));
}

interface MarkCandidate {
  kind: Exclude<MarkTargetKind, "region">;
  text: string;
  rect: MarkRect;
  workId?: string;
  entityId?: string;
  meaning?: string;
}

function glossaryMeaning(
  labels: string[],
  glossary: Record<string, VerifiedLabelFact> | undefined,
): string | undefined {
  if (!glossary) return undefined;
  for (const label of labels) {
    const fact = glossary[label] ?? glossary[label.trim()];
    if (!fact) continue;
    const title = fact.title?.trim();
    const value = fact.value?.trim();
    if (title && value) return `${title}, ${value}`;
    if (title) return title;
    if (value) return value;
  }
  return undefined;
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TARGET_TEXT);
}

/**
 * Everything on the board a mark could be about. Verified figure parts come
 * first: they carry an entity id the teaching stream can trace again, which a
 * bare text rect cannot.
 */
export function collectMarkCandidates(
  rects: readonly BoardTextRect[],
  diagram: VerifiedDiagram | null,
): MarkCandidate[] {
  const candidates: MarkCandidate[] = [];

  if (diagram) {
    for (const anchor of diagram.anchors) {
      const labels = anchor.labels.filter((label) => label.trim().length > 0);
      const text = normalizeText(labels.join(", ") || anchor.id);
      if (!text) continue;
      candidates.push({
        kind: "diagram",
        text,
        rect: rectOf(anchor),
        entityId: anchor.id,
        meaning: glossaryMeaning(labels, diagram.labelGlossary),
      });
    }
  }

  for (const rect of rects) {
    const text = normalizeText(rect.text ?? "");
    if (!text) continue;
    candidates.push({
      kind: rect.workId ? "work" : "board_text",
      text,
      rect: rectOf(rect),
      workId: rect.workId,
    });
  }

  return candidates;
}

function regionName(bounds: MarkRect): string {
  const center = rectCenter(bounds);
  const inDiagramZone =
    center.x >= DIAGRAM_ZONE.x &&
    center.x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width &&
    center.y >= DIAGRAM_ZONE.y &&
    center.y <= DIAGRAM_ZONE.y + DIAGRAM_ZONE.height;
  if (inDiagramZone) return "the figure area";
  if (center.x < WORK_AREA_MAX_X) return "the work column";
  return "the board";
}

function regionTarget(bounds: MarkRect): MarkTarget {
  return { kind: "region", text: regionName(bounds), rect: bounds };
}

/**
 * Which board object the stroke is about, and the gesture that best describes
 * what it did to it. Returns the region fallback rather than a weak guess —
 * a doubt that quotes the wrong line teaches the wrong thing.
 *
 * A ring is about everything it encloses. A wide oval around the working
 * keeps every line inside it; a ring round one row still keeps only that row.
 */
export function resolveMarkTarget(
  points: MarkPoint[],
  gesture: MarkGesture,
  candidates: readonly MarkCandidate[],
): { target: MarkTarget; targets: MarkTarget[]; gesture: MarkGesture } {
  const bounds = markStrokeBounds(points);
  if (candidates.length === 0) {
    const region = regionTarget(bounds);
    return { target: region, targets: [region], gesture };
  }

  const center = rectCenter(bounds);

  if (gesture === "circle" || gesture === "point" || gesture === "scribble") {
    const enclosed = enclosedCandidates(bounds, points, candidates);
    if (enclosed.length > 0) {
      const targets = enclosed.map(toTarget);
      return { target: targets[0]!, targets, gesture };
    }
    // Nothing was substantially inside. Fall back to the single best hit so a
    // tap on a symbol still names it, then to an honest region.
    let best: { candidate: MarkCandidate; score: number } | null = null;
    for (const candidate of candidates) {
      const area = Math.max(candidate.rect.width * candidate.rect.height, 1);
      const covered = intersectionArea(bounds, candidate.rect) / area;
      const centreHit = pointInflatedRect(center, candidate.rect, TARGET_PAD_PX) ? 0.5 : 0;
      const proximity = Math.hypot(
        center.x - rectCenter(candidate.rect).x,
        center.y - rectCenter(candidate.rect).y,
      );
      const score = covered + centreHit - proximity / 4000;
      if (score > 0.22 && (!best || score > best.score)) {
        best = { candidate, score };
      }
    }
    if (best) {
      const target = toTarget(best.candidate);
      return { target, targets: [target], gesture };
    }
    const region = regionTarget(bounds);
    return { target: region, targets: [region], gesture };
  }

  // A rule is about the row it runs along. It must overlap that row
  // horizontally and sit either through it or just under its baseline.
  let best: { candidate: MarkCandidate; distance: number; through: boolean } | null = null;
  const strokeMidY = bounds.y + bounds.height / 2;
  for (const candidate of candidates) {
    const overlap =
      Math.min(bounds.x + bounds.width, candidate.rect.x + candidate.rect.width) -
      Math.max(bounds.x, candidate.rect.x);
    if (overlap < Math.min(bounds.width, candidate.rect.width) * 0.34) {
      continue;
    }
    const top = candidate.rect.y;
    const bottom = candidate.rect.y + candidate.rect.height;
    const through = strokeMidY > top + candidate.rect.height * 0.2 && strokeMidY < bottom - candidate.rect.height * 0.2;
    const under = strokeMidY >= bottom - 6 && strokeMidY <= bottom + UNDERLINE_REACH_PX;
    const over = strokeMidY <= top + 6 && strokeMidY >= top - TARGET_PAD_PX;
    if (!through && !under && !over) {
      continue;
    }
    const distance = Math.abs(strokeMidY - rectCenter(candidate.rect).y);
    if (!best || distance < best.distance) {
      best = { candidate, distance, through };
    }
  }
  if (best) {
    const target = toTarget(best.candidate);
    return {
      target,
      targets: [target],
      gesture: best.through ? "strike" : "underline",
    };
  }
  const region = regionTarget(bounds);
  return { target: region, targets: [region], gesture };
}

function toTarget(candidate: MarkCandidate): MarkTarget {
  return {
    kind: candidate.kind,
    text: candidate.text,
    rect: candidate.rect,
    workId: candidate.workId,
    entityId: candidate.entityId,
    meaning: candidate.meaning,
  };
}

/** Build one mark from raw pointer samples. Null when the stroke was a slip. */
export function createBoardMark(
  id: string,
  rawPoints: readonly MarkPoint[],
  candidates: readonly MarkCandidate[],
): BoardMark | null {
  const points = resampleStroke([...rawPoints]);
  // A tap counts — pointing at a symbol is a legitimate way to ask about it, and
  // the marker is only live because the student deliberately picked it up. Only
  // a stroke with no samples at all is a slip.
  if (points.length === 0) {
    return null;
  }
  const gesture = classifyMarkGesture(points);
  const resolved = resolveMarkTarget(points, gesture, candidates);
  return {
    id,
    gesture: resolved.gesture,
    points,
    bounds: markStrokeBounds(points),
    target: resolved.target,
    targets: resolved.targets,
  };
}

const GESTURE_VERB: Record<MarkGesture, string> = {
  circle: "circled",
  underline: "underlined",
  strike: "struck through",
  scribble: "scribbled over",
  point: "pointed at",
};

/** Every object this mark resolved to. Always at least `mark.target`. */
export function markTargets(mark: BoardMark): MarkTarget[] {
  return mark.targets.length > 0 ? mark.targets : [mark.target];
}

function formatTargetForPrompt(verb: string, target: MarkTarget): string {
  if (target.kind === "region") {
    return `- ${verb} an empty part of ${target.text} — nothing written is under that mark`;
  }
  if (target.kind === "diagram") {
    const meaning = target.meaning ? ` (${target.meaning})` : "";
    return `- ${verb} the figure part labelled "${target.text}"${meaning} [entity ${target.entityId}]`;
  }
  if (target.kind === "work") {
    return `- ${verb} the board line "${target.text}"`;
  }
  return `- ${verb} the board text "${target.text}"`;
}

/** Chip label. Short enough for a pill, exact enough to trust. */
export function describeMark(mark: BoardMark): string {
  const verb = GESTURE_VERB[mark.gesture];
  const targets = markTargets(mark);
  if (targets.length === 1) {
    const target = targets[0]!;
    if (target.kind === "region") {
      return `${verb} ${target.text}`;
    }
    return `${verb} "${target.text}"`;
  }
  return `${verb} ${targets.length} board lines`;
}

/** Prompt lines for one stroke. A multi-line ring lists every enclosed line. */
export function formatMarkForPrompt(mark: BoardMark): string {
  const verb = GESTURE_VERB[mark.gesture];
  const targets = markTargets(mark);
  if (targets.length === 1) {
    return formatTargetForPrompt(verb, targets[0]!);
  }
  return targets.map((target) => formatTargetForPrompt(verb, target)).join("\n");
}

/** Entity ids the re-teach may legitimately `[FOCUS:id]` again. */
export function markedEntityIds(marks: readonly BoardMark[]): string[] {
  const ids: string[] = [];
  for (const mark of marks) {
    for (const target of markTargets(mark)) {
      const id = target.entityId;
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** True when at least one mark landed on real board content. */
export function hasGroundedMark(marks: readonly BoardMark[]): boolean {
  return marks.some((mark) => markTargets(mark).some((target) => target.kind !== "region"));
}

/** The interrupted question is context, not the new question — keep it short. */
const MAX_LESSON_CONTEXT_CHARS = 400;

/**
 * The prompt the marked doubt runs as.
 *
 * A marked doubt is a re-teach request, not a new question: the student already
 * heard this part and it did not land. The prompt says what was marked, in the
 * board's own words, and asks for that part again from where the mark is —
 * slower, differently, with something concrete. An empty typed doubt is the
 * common case ("just explain this again"), so it must produce a complete
 * instruction on its own.
 */
export function buildMarkedDoubtPrompt(
  marks: readonly BoardMark[],
  doubt: string,
  lessonQuestion?: string | null,
): string {
  const typed = doubt.trim();
  const context = (lessonQuestion ?? "").trim().slice(0, MAX_LESSON_CONTEXT_CHARS);
  const lines: string[] = [];

  lines.push(
    context
      ? `i have a doubt about the question "${context}".`
      : "i have a doubt about what is on the board.",
  );

  if (marks.length > 0) {
    lines.push("i marked this on the board:");
    for (const mark of marks) {
      lines.push(formatMarkForPrompt(mark));
    }
  }

  if (typed) {
    lines.push(`my doubt: ${typed}`);
  } else {
    lines.push("i did not type a doubt — i did not follow the part i marked.");
  }

  lines.push(
    "teach that marked part again from there, in a different and simpler way, with a small concrete example. do not re-teach the whole lesson and do not just repeat the same words.",
  );

  if (!hasGroundedMark(marks) && marks.length > 0 && !typed) {
    lines.push(
      "the mark landed on an empty area, so ask what it is about before assuming which step is meant.",
    );
  }

  return lines.join("\n");
}

/** Placeholder and button copy for the composer while marks are held. */
export const MARK_MODE_PLACEHOLDER = "What about this? (or just press Ask)";
export const MARK_MODE_HINT = "Circle, underline or scribble on anything you did not follow.";
export const MARK_MODE_EMPTY_HINT = "Mark the board, or type your doubt.";
export const MARK_SUBMIT_LABEL = "Explain this";

/** Chip verb, for the UI, without the quoted text. */
export function markGestureVerb(gesture: MarkGesture): string {
  return GESTURE_VERB[gesture];
}
