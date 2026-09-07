/**
 * Trace frames into compiled scenes — one document per frame.
 *
 * Three decisions carry most of the value here.
 *
 * **One frame, one document.** Each frame is compiled separately into the
 * full diagram zone, so frames cannot overlap by construction. Every frame of
 * a walk carries the same invisible extent box (the union of every frame's
 * geometry), so the compiler fits every frame with the same transform and
 * nothing moves or rescales between frames.
 *
 * **Marks are ink.** A mark says what the algorithm is doing to an element.
 * Before, only `active` and `window` reached the board, and only as a
 * one-second dim of everything else; visited nodes, the frontier, a rejected
 * edge and the settled tail were all invisible. Now `active` is a filled
 * wash, `done` a tick (cells) or a double ring (nodes), `excluded` a strike,
 * `candidate` and `window` a dashed outline. The spotlight still follows the
 * active element, and only that one.
 *
 * **The board has room for a second structure.** A teacher draws the queue
 * beside the graph, the stack beside the string, the map beside the array,
 * the output list under the tree. `asides` draw those as small pre-sized
 * rows or columns beside the figure, and `stacked` puts whole figures one
 * above another.
 *
 * Every drawn value is proved by a fatal `label_attached` assertion, so a
 * value that fails to reach its own cell is a compile failure rather than a
 * silently wrong picture. `expectedLabels` then lets a caller check the
 * compiled text against the trace at every address.
 */
import { tierForForeignDocument, type RepresentationTier } from "../archetypes/tier";
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import {
  SCENE_DOCUMENT_VERSION,
  type CompileOptions,
  type RenderScene,
  type SceneAssertion,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
  type ValidationReport,
} from "../types";
import type {
  AlgorithmTrace,
  ArrayFrameState,
  GraphFrameState,
  GridFrameState,
  ListFrameState,
  MatrixFrameState,
  NumberLineFrameState,
  StackedFrameState,
  TraceAside,
  TraceCell,
  TraceFrame,
  TraceFrameState,
  TraceMark,
  TracePointer,
  TraceStructure,
  TreeFrameState,
} from "./trace/types";

export interface DsaFrameScene {
  frameId: string;
  caption: string;
  narrationIntent: string;
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  /** Entities worth dimming the rest of the figure for while this frame is up. */
  focusEntityIds: string[];
  /** Entity id -> the exact text the trace says belongs there. */
  expectedLabels: Record<string, string>;
}

export interface DsaTraceScenes {
  algorithmId: string;
  title: string;
  structure: TraceStructure;
  /** Derived from the document's own assertions, never asserted by hand. */
  tier: RepresentationTier;
  nonMetric: boolean;
  tierReason: string;
  frames: DsaFrameScene[];
}

export interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface FrameParts {
  entities: SceneEntity[];
  constructions: SceneConstruction[];
  assertions: SceneAssertion[];
  drawFirstIds: string[];
  drawSecondIds: string[];
  focusEntityIds: string[];
  expectedLabels: Record<string, string>;
  reason: string;
  extent: Extent;
  /**
   * The main figure's extent, before any aside or note was added to it.
   *
   * Asides hang off the figure, so anchoring them to the frame's own extent
   * makes them move whenever the figure does: an insertion walk's in-order
   * output row drifted further down the board on every frame as the tree
   * deepened. The union of this across a whole trace is a fixed anchor, so an
   * aside sits in one place for the whole walk.
   */
  figureExtent: Extent;
}

/** The font the board letters DSA figure text with; must match the compiler's pinned size. */
export const DSA_LABEL_FONT_PX = 19;

const ARRAY_CELL = 1.42;
const ARRAY_STEP = 1.58;
const GROUP_GAP = 0.5;
const INDEX_DROP = 0.72;
const POINTER_LEN = 0.95;
const POINTER_NAME_OFFSET = 0.42;

/**
 * The magnitude column above each cell. Heights are exactly proportional to
 * the value, from a zero baseline; a frame whose values cannot be drawn
 * proportionally declines the bars rather than drawing a misleading height.
 * The tallest bar is 3.0 units so a one-in-eight value still clears the
 * compiler's collapsed-region floor.
 */
const BAR_MAX_HEIGHT = 3.0;
const BAR_BASE_GAP = 0.18;
const BAR_WIDTH_RATIO = 0.62;
/** Widest value-to-value ratio a bar column can show without a stub. */
const BAR_MAX_SPREAD = 20;

/** Band under the row: pointer arrows or the crossing swap arrows. */
const SWAP_CROSS_TOP_Y = -(ARRAY_CELL / 2 + 0.42);
const SWAP_CROSS_BOTTOM_Y = -(ARRAY_CELL / 2 + 1.62);
const BRACKET_TOP_Y = -2.95;
const BRACKET_BOTTOM_Y = -3.5;
const BRACKET_LABEL_Y = -4.05;

const LIST_WIDTH = 1.5;
const LIST_HEIGHT = 1.25;
const LIST_STEP = 2.4;
const LIST_HOOK_DROP = 0.55;

const GRID_W = 1.95;
const GRID_H = 1.4;
const NODE_RADIUS = 0.66;
const ASIDE_GAP = 0.95;
/** Margin the extent box adds around geometry, so pinned labels never clip. */
const EXTENT_MARGIN_X = 0.55;
const EXTENT_MARGIN_Y = 0.5;

const LABEL_HALF_HEIGHT = 0.3;

/** Half the drawn width of a short run of text, in world units. */
function labelHalfWidth(text: string): number {
  return 0.12 + text.trim().length * 0.17;
}

/** Longest run of text a single diagram label may carry. */
const MAX_NOTE_CHARS = 16;

/** Split a note at its wide gaps, then at spaces, into compact chips. */
function noteChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const part of text.split(/\s{2,}/)) {
    const piece = part.trim();
    if (!piece) continue;
    if (piece.length <= MAX_NOTE_CHARS) {
      chunks.push(piece);
      continue;
    }
    let current = "";
    for (const word of piece.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= MAX_NOTE_CHARS) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      current = word.slice(0, MAX_NOTE_CHARS);
    }
    if (current) chunks.push(current);
  }
  return chunks.slice(0, 4);
}

function emptyExtent(): Extent {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function unionExtent(a: Extent, b: Extent): Extent {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function finiteExtent(extent: Extent): boolean {
  return [extent.minX, extent.maxX, extent.minY, extent.maxY].every(Number.isFinite);
}

/**
 * Collects one frame's entities and constructions while tracking the extent
 * of everything it places, so asides and the shared extent box can be laid
 * out relative to the figure without every builder repeating the arithmetic.
 */
class FrameBuilder {
  readonly entities: SceneEntity[] = [];
  readonly constructions: SceneConstruction[] = [];
  readonly assertions: SceneAssertion[] = [];
  readonly drawFirstIds: string[] = [];
  readonly drawSecondIds: string[] = [];
  readonly focusEntityIds: string[] = [];
  readonly expectedLabels: Record<string, string> = {};
  extent: Extent = emptyExtent();
  /**
   * Where asides and notes hang from. Left unset they hang off this frame's
   * own figure, which is what made them drift; `compileTraceScenes` sets it to
   * the union across every frame of the trace on its second pass.
   */
  anchor: Extent | null = null;
  /** The figure's extent as it stood when the first aside was placed. */
  private figure: Extent | null = null;
  private serial = 0;

  grow(x: number, y: number, halfW = 0, halfH = 0): void {
    this.extent = {
      minX: Math.min(this.extent.minX, x - halfW),
      maxX: Math.max(this.extent.maxX, x + halfW),
      minY: Math.min(this.extent.minY, y - halfH),
      maxY: Math.max(this.extent.maxY, y + halfH),
    };
  }

  point(id: string, x: number, y: number): string {
    this.constructions.push({
      id: `make_${id}`,
      operator: "point",
      inputs: { x, y, coordinateSpace: "world" },
      outputs: [id],
    });
    return id;
  }

  private phaseList(phase: "first" | "second"): string[] {
    return phase === "first" ? this.drawFirstIds : this.drawSecondIds;
  }

  /** A box, optionally labelled with the value it holds. */
  rect(
    id: string,
    role: string,
    cx: number,
    cy: number,
    width: number,
    height: number,
    options: { label?: string; provenance?: Record<string, unknown>; phase?: "first" | "second"; expected?: boolean } = {},
  ): void {
    const text = options.label?.trim();
    this.entities.push({
      id,
      kind: "rectangle",
      role,
      ...(text ? { label: text } : {}),
      ...(options.provenance ? { provenance: options.provenance } : {}),
    });
    const center = this.point(`${id}_c`, cx, cy);
    this.constructions.push({
      id: `make_${id}`,
      operator: "rectangle",
      inputs: { center, width, height },
      outputs: [id],
    });
    this.phaseList(options.phase ?? "first").push(id);
    this.grow(cx, cy, width / 2, height / 2);
    if (text && options.expected !== false) {
      this.expectedLabels[id] = text;
      this.assertions.push(labelAttached(`${id}_value`, id));
    }
  }

  circle(
    id: string,
    role: string,
    cx: number,
    cy: number,
    radius: number,
    options: { label?: string; provenance?: Record<string, unknown>; phase?: "first" | "second"; expected?: boolean } = {},
  ): void {
    const text = options.label?.trim();
    this.entities.push({
      id,
      kind: "circle",
      role,
      ...(text ? { label: text } : {}),
      ...(options.provenance ? { provenance: options.provenance } : {}),
    });
    const center = this.point(`${id}_c`, cx, cy);
    this.constructions.push({ id: `make_${id}`, operator: "circle", inputs: { center, radius }, outputs: [id] });
    this.phaseList(options.phase ?? "first").push(id);
    this.grow(cx, cy, radius, radius);
    if (text && options.expected !== false) {
      this.expectedLabels[id] = text;
      this.assertions.push(labelAttached(`${id}_value`, id));
    }
  }

  /** A straight arrow. */
  vector(
    id: string,
    role: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: { provenance?: Record<string, unknown>; phase?: "first" | "second"; focus?: boolean } = {},
  ): void {
    this.entities.push({ id, kind: "vector", role, ...(options.provenance ? { provenance: options.provenance } : {}) });
    const start = this.point(`${id}_s`, x1, y1);
    const end = this.point(`${id}_e`, x2, y2);
    this.constructions.push({ id: `make_${id}`, operator: "vector", inputs: { start, end }, outputs: [id] });
    this.phaseList(options.phase ?? "second").push(id);
    this.grow(x1, y1);
    this.grow(x2, y2);
    if (options.focus) this.focusEntityIds.push(id);
  }

  segment(
    id: string,
    role: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: { provenance?: Record<string, unknown>; phase?: "first" | "second"; focus?: boolean } = {},
  ): void {
    this.entities.push({ id, kind: "segment", role, ...(options.provenance ? { provenance: options.provenance } : {}) });
    const start = this.point(`${id}_s`, x1, y1);
    const end = this.point(`${id}_e`, x2, y2);
    this.constructions.push({ id: `make_${id}`, operator: "segment", inputs: { start, end }, outputs: [id] });
    this.phaseList(options.phase ?? "second").push(id);
    this.grow(x1, y1);
    this.grow(x2, y2);
    if (options.focus) this.focusEntityIds.push(id);
  }

  polyline(
    id: string,
    role: string,
    points: ReadonlyArray<[number, number]>,
    options: { closed?: boolean; provenance?: Record<string, unknown>; phase?: "first" | "second"; track?: boolean } = {},
  ): void {
    this.entities.push({ id, kind: options.closed ? "polygon" : "polyline", role, ...(options.provenance ? { provenance: options.provenance } : {}) });
    const ids = points.map(([x, y], index) => this.point(`${id}_p${index}`, x, y));
    this.constructions.push({
      id: `make_${id}`,
      operator: options.closed ? "polygon" : "polyline",
      inputs: { points: ids },
      outputs: [id],
    });
    this.phaseList(options.phase ?? "second").push(id);
    if (options.track !== false) for (const [x, y] of points) this.grow(x, y);
  }

  /** Free text pinned at a point: a pointer name, an index, a weight, a note. */
  label(
    id: string,
    role: string,
    x: number,
    y: number,
    text: string,
    options: { phase?: "first" | "second"; expected?: boolean } = {},
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.entities.push({ id, kind: "label", role, label: trimmed });
    const anchor = this.point(`${id}_p`, x, y);
    this.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target: anchor, text: trimmed }, outputs: [id] });
    this.phaseList(options.phase ?? "second").push(id);
    // Half a line of text either side of the anchor keeps the fit honest.
    this.grow(x, y, 0.2 + trimmed.length * 0.17, 0.32);
    if (options.expected) this.expectedLabels[id] = trimmed;
  }

  /**
   * The ink a mark leaves on a box. Active is a wash, done a tick in the
   * corner, excluded a strike, candidate and window a dashed outline.
   */
  markRect(owner: string, cx: number, cy: number, width: number, height: number, mark: TraceMark | undefined): void {
    if (!mark) return;
    const id = `${owner}_mk`;
    switch (mark) {
      case "active":
        this.rect(id, `mark active ${owner}`, cx, cy, width - 0.1, height - 0.1, {
          provenance: { fillRole: "region", dsaMark: "active" },
          phase: "second",
        });
        this.focusEntityIds.push(owner);
        return;
      case "done": {
        const right = cx + width / 2;
        const top = cy + height / 2;
        this.polyline(id, `mark done ${owner}`, [
          [right - 0.46, top - 0.26],
          [right - 0.33, top - 0.4],
          [right - 0.12, top - 0.1],
        ], { provenance: { dsaMark: "done" }, track: false });
        return;
      }
      case "excluded":
        this.segment(id, `mark excluded ${owner}`, cx - width / 2 + 0.1, cy - height / 2 + 0.1, cx + width / 2 - 0.1, cy + height / 2 - 0.1, {
          provenance: { dsaMark: "excluded" },
        });
        return;
      case "candidate":
      case "window":
        this.rect(id, `mark ${mark} ${owner}`, cx, cy, width - 0.18, height - 0.18, {
          provenance: { dashed: true, dsaMark: mark },
          phase: "second",
        });
        return;
      default:
        return;
    }
  }

  markCircle(owner: string, cx: number, cy: number, radius: number, mark: TraceMark | undefined): void {
    if (!mark) return;
    const id = `${owner}_mk`;
    switch (mark) {
      case "active":
        this.circle(id, `mark active ${owner}`, cx, cy, radius - 0.05, {
          provenance: { fillRole: "region", dsaMark: "active" },
          phase: "second",
        });
        this.focusEntityIds.push(owner);
        return;
      case "done":
        this.circle(id, `mark done ${owner}`, cx, cy, radius + 0.14, { provenance: { dsaMark: "done" }, phase: "second" });
        return;
      case "excluded": {
        const d = radius * 0.72;
        this.segment(id, `mark excluded ${owner}`, cx - d, cy - d, cx + d, cy + d, { provenance: { dsaMark: "excluded" } });
        return;
      }
      case "candidate":
      case "window":
        this.circle(id, `mark ${mark} ${owner}`, cx, cy, radius + 0.13, { provenance: { dashed: true, dsaMark: mark }, phase: "second" });
        return;
      default:
        return;
    }
  }

  /** Named arrows pointing at a cell or node. Names sharing a spot are joined. */
  pointers(
    pointers: ReadonlyArray<TracePointer> | undefined,
    xOf: (index: number) => number | null,
    tipY: number,
    direction: "down" | "up",
  ): void {
    const byIndex = new Map<number, string[]>();
    for (const pointer of pointers ?? []) {
      if (xOf(pointer.index) === null) continue;
      const names = byIndex.get(pointer.index) ?? [];
      names.push(pointer.name);
      byIndex.set(pointer.index, names);
    }
    const tailY = direction === "down" ? tipY + POINTER_LEN : tipY - POINTER_LEN;
    const nameY = direction === "down" ? tailY + POINTER_NAME_OFFSET : tailY - POINTER_NAME_OFFSET;
    for (const [order, [index, names]] of [...byIndex.entries()].sort((a, b) => a[0] - b[0]).entries()) {
      const text = names.join("=");
      const x = xOf(index)!;
      this.vector(`ptr${order}`, `pointer ${text}`, x, tailY, x, tipY);
      this.label(`ptr${order}_lbl`, `pointer name ${text}`, x, nameY, text);
    }
  }

  /** A labelled bracket under a run: corners top-left, bottom-left, bottom-right, top-right. */
  bracket(id: string, role: string, left: number, right: number, topY: number, bottomY: number, labelY: number, text: string): void {
    this.polyline(id, role, [[left, topY], [left, bottomY], [right, bottomY], [right, topY]]);
    if (text.trim()) this.label(`${id}_lbl`, `region name ${text.trim()}`, (left + right) / 2, labelY, text, { expected: true });
  }

  /**
   * A short line of state above the figure: the target, the running sum, the
   * best so far. Written as one sentence by the simulator and drawn as a row
   * of chips, because a single label is capped at the compact-label length
   * the whole engine enforces.
   */
  note(text: string | undefined): void {
    const trimmed = text?.trim();
    if (!trimmed || !finiteExtent(this.extent)) return;
    const chunks = noteChunks(trimmed);
    if (chunks.length === 0) return;
    // Anchored like the asides, so the line of arithmetic over the figure
    // stays put from frame to frame instead of rising as the figure grows.
    // The max keeps it clear of anything that pokes above the anchor in one
    // frame only, such as a tall column aside's title.
    const base = this.anchor && finiteExtent(this.anchor) ? this.anchor : this.extent;
    const y = Math.max(base.maxY, this.extent.maxY) + 0.75;
    // Measured: the old allowance of 0.24 + 0.34 per character was an under
    // estimate from about twelve characters up, so a note of two long chips
    // put "dp[1]+c[1]=100" through "dp[0]+c[0]=1" on the board. A world-unit
    // estimate can never be exact, because the text is lettered in pixels
    // after the figure is fitted, so it has to be an upper bound.
    const widths = chunks.map((chunk) => 0.24 + chunk.length * 0.37);
    const gap = 0.6;
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (chunks.length - 1);
    let x = (base.minX + base.maxX) / 2 - total / 2;
    chunks.forEach((chunk, index) => {
      const width = widths[index]!;
      this.label(`note${index}`, `figure note ${index}`, x + width / 2, y, chunk, { expected: true });
      x += width + gap;
    });
  }

  /**
   * Small structures beside the figure. A row goes under the figure, its
   * title in the first slot; a column goes to the right, bottom aligned, its
   * title above. Each is pre-sized so cell ids are stable across frames.
   */
  asides(asides: ReadonlyArray<TraceAside> | undefined): void {
    if (!finiteExtent(this.extent)) return;
    // Recorded whether or not this frame has asides, so a trace whose first
    // frame has none still contributes its figure to the shared anchor.
    this.figure = { ...this.extent };
    if (!asides?.length) return;
    const base = this.anchor && finiteExtent(this.anchor) ? { ...this.anchor } : { ...this.extent };
    let rowY = base.minY - ASIDE_GAP - ARRAY_CELL / 2;
    let columnX = base.maxX + ASIDE_GAP + ARRAY_CELL / 2;
    for (const item of asides) {
      const capacity = Math.max(item.capacity, item.cells.length, 1);
      const cellsNow = [...item.cells];
      while (cellsNow.length < capacity) cellsNow.push({ text: "" });
      if (item.orientation === "row") {
        const startX = base.minX + ARRAY_CELL / 2;
        // The title sits clear to the left of the first cell, sized by its own
        // text: a fixed one-cell gap put "in-degree" through the first box.
        this.label(
          `as_${item.id}_title`,
          `aside title ${item.title}`,
          startX - ARRAY_CELL / 2 - 0.45 - labelHalfWidth(item.title),
          rowY,
          item.title,
          { expected: true },
        );
        for (let index = 0; index < capacity; index += 1) {
          const cell = cellsNow[index]!;
          const cx = startX + index * ARRAY_STEP;
          const id = `as_${item.id}${index}`;
          // An unused slot is drawn as nothing, not as an empty box: the
          // capacity exists to keep positions fixed, not to fill the board
          // with boxes waiting to be used.
          if (!cell.text.trim()) {
            this.grow(cx, rowY, ARRAY_CELL / 2, ARRAY_CELL / 2);
            continue;
          }
          this.rect(id, `aside ${item.id} cell ${index}`, cx, rowY, ARRAY_CELL, ARRAY_CELL, { label: cell.text, phase: "second" });
          this.markRect(id, cx, rowY, ARRAY_CELL, ARRAY_CELL, cell.mark);
        }
        rowY -= ARRAY_STEP + 0.35;
      } else {
        const bottomY = base.minY + ARRAY_CELL / 2;
        for (let index = 0; index < capacity; index += 1) {
          const cell = cellsNow[index]!;
          const cy = bottomY + index * ARRAY_STEP;
          const id = `as_${item.id}${index}`;
          if (!cell.text.trim()) {
            this.grow(columnX, cy, ARRAY_CELL / 2, ARRAY_CELL / 2);
            continue;
          }
          this.rect(id, `aside ${item.id} cell ${index}`, columnX, cy, ARRAY_CELL, ARRAY_CELL, { label: cell.text, phase: "second" });
          this.markRect(id, columnX, cy, ARRAY_CELL, ARRAY_CELL, cell.mark);
        }
        this.label(`as_${item.id}_title`, `aside title ${item.title}`, columnX, bottomY + capacity * ARRAY_STEP - ARRAY_CELL / 2 + 0.55, item.title, { expected: true });
        columnX += ARRAY_STEP + 0.6;
      }
    }
  }

  /**
   * The invisible box every frame of a walk shares, so the compiler fits
   * each frame with the same transform. Dashed construction ink is dropped
   * on the board by the code-lesson presentation; it exists only for the fit.
   */
  extentBox(extent: Extent): void {
    if (!finiteExtent(extent)) return;
    this.polyline("extent", "frame extent", [
      [extent.minX, extent.maxY],
      [extent.maxX, extent.maxY],
      [extent.maxX, extent.minY],
      [extent.minX, extent.minY],
    ], { closed: true, provenance: { dashed: true, strokeRole: "construction", dsaExtent: true }, phase: "first", track: false });
  }

  parts(reason: string): FrameParts {
    return {
      entities: this.entities,
      constructions: this.constructions,
      assertions: this.assertions,
      drawFirstIds: this.drawFirstIds,
      drawSecondIds: this.drawSecondIds,
      focusEntityIds: this.focusEntityIds,
      expectedLabels: this.expectedLabels,
      reason,
      extent: this.extent,
      figureExtent: this.figure ?? this.extent,
    };
  }

  nextId(prefix: string): string {
    this.serial += 1;
    return `${prefix}${this.serial}`;
  }
}

function exists(id: string, entityIds: string[]): SceneAssertion {
  return { id, predicate: "exists", entities: entityIds, expected: true, severity: "fatal" };
}

/**
 * The proof that matters: a compiled label primitive must exist for this
 * entity. Without it a value can be dropped or land on a neighbour and every
 * other assertion still passes.
 */
function labelAttached(id: string, entityId: string): SceneAssertion {
  return { id, predicate: "label_attached", entities: [entityId], expected: true, severity: "fatal" };
}

function orderedAlong(id: string, entityIds: string[], axis: "x" | "y", direction: "increasing" | "decreasing"): SceneAssertion {
  return { id, predicate: "ordered_along", entities: entityIds, expected: { axis, direction }, severity: "fatal" };
}

/**
 * Bar heights for one frame, or null when no honest column can be drawn.
 * A non-positive value has no proportional height, and a spread wider than
 * `BAR_MAX_SPREAD` would render the smallest bar as an invisible stub.
 */
/**
 * Bar heights for one row, or null when bars would misrepresent the values.
 *
 * Zero is a height, not a missing value: an elevation map with an empty
 * column is exactly the figure Trapping Rain Water is about, and refusing it
 * cost that family its bars and the water overlays drawn against them. A zero
 * bar is simply not drawn, so the column reads as empty, which is what it is.
 *
 * The spread guard is about legibility, so it measures the smallest bar the
 * student can actually see. Including zeros in it would divide by zero and
 * decline every histogram that has a gap.
 */
function barHeights(values: readonly number[], cellCount: number): number[] | null {
  if (values.length !== cellCount || cellCount === 0) return null;
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) return null;
  const largest = Math.max(...values);
  if (largest <= 0) return null;
  const positives = values.filter((value) => value > 0);
  const smallest = Math.min(...positives);
  if (largest / smallest > BAR_MAX_SPREAD) return null;
  return values.map((value) => (value / largest) * BAR_MAX_HEIGHT);
}

/** Natural width of one array frame, in world units. */
export function arrayFrameSpan(state: ArrayFrameState): number {
  const blocks = state.groups?.length ? state.groups.map((group) => group.cells) : [state.cells];
  const count = blocks.reduce((total, block) => total + block.length, 0);
  if (count === 0) return 0;
  const lastColumn = count - 1 + (blocks.length - 1) * (GROUP_GAP / ARRAY_STEP);
  return lastColumn * ARRAY_STEP + ARRAY_CELL;
}

/** Contiguous runs of indices whose cell carries the given mark. */
function runsOf(cellsNow: readonly TraceCell[], mark: TraceMark): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  cellsNow.forEach((cell, index) => {
    if (cell.mark === mark) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      runs.push([start, index - 1]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, cellsNow.length - 1]);
  return runs;
}

function buildArrayFrame(state: ArrayFrameState, anchor?: Extent): FrameParts | null {
  const b = new FrameBuilder();
  b.anchor = anchor ?? null;
  const blocks = state.groups?.length ? state.groups.map((group) => group.cells) : [state.cells];
  if (blocks.every((block) => block.length === 0)) return null;
  const total = blocks.reduce((sum, block) => sum + block.length, 0);

  const heights = !state.groups?.length && state.bars ? barHeights(state.bars, state.cells.length) : null;
  const showIndices = state.showIndices ?? (!state.groups?.length && !heights);
  const centerIds: string[] = [];
  const xOfIndex: number[] = [];

  // Groups are separated by a visible gap; within a block cells touch.
  let column = 0;
  let index = 0;
  for (const [blockNumber, block] of blocks.entries()) {
    for (const cell of block) {
      const x = column * ARRAY_STEP;
      const cellId = `cell${index}`;
      b.rect(cellId, `array cell ${index}`, x, 0, ARRAY_CELL, ARRAY_CELL, { label: cell.text });
      centerIds.push(`${cellId}_c`);
      xOfIndex.push(x);
      // Windows are drawn as a bracket under the run (below), never as an
      // outline per cell, so a live range reads as one region.
      if (cell.mark !== "window") b.markRect(cellId, x, 0, ARRAY_CELL, ARRAY_CELL, cell.mark);

      const barHeight = heights?.[index];
      if (barHeight !== undefined && barHeight > 0) {
        b.rect(`bar${index}`, `magnitude bar ${index}`, x, ARRAY_CELL / 2 + BAR_BASE_GAP + barHeight / 2, ARRAY_CELL * BAR_WIDTH_RATIO, barHeight, {
          provenance: { fillRole: "region", dsaBar: true },
        });
      }
      if (showIndices) {
        b.label(`idx${index}`, `cell index ${index}`, x, -(ARRAY_CELL / 2 + INDEX_DROP), String(index));
      }
      column += 1;
      index += 1;
    }
    if (blockNumber < blocks.length - 1) column += GROUP_GAP / ARRAY_STEP;
  }

  // Group labels above each block.
  if (state.groups?.length) {
    let start = 0;
    for (const group of state.groups) {
      const text = group.label?.trim();
      if (text && group.cells.length > 0) {
        const left = xOfIndex[start]!;
        const right = xOfIndex[start + group.cells.length - 1]!;
        b.label(`grp_${group.id}`, `group label ${text}`, (left + right) / 2, ARRAY_CELL / 2 + 0.55, text, { expected: true });
      }
      start += group.cells.length;
    }
  }

  // Overlays in bar units: water, areas.
  if (heights && state.overlays?.length && state.bars) {
    const largest = Math.max(...state.bars);
    const scale = BAR_MAX_HEIGHT / largest;
    for (const [order, overlay] of state.overlays.entries()) {
      const from = Math.max(0, Math.min(overlay.from, overlay.to));
      const to = Math.min(total - 1, Math.max(overlay.from, overlay.to));
      if (from > to || overlay.top <= overlay.bottom) continue;
      const left = xOfIndex[from]! - ARRAY_CELL / 2;
      const right = xOfIndex[to]! + ARRAY_CELL / 2;
      const bottom = ARRAY_CELL / 2 + BAR_BASE_GAP + overlay.bottom * scale;
      const top = ARRAY_CELL / 2 + BAR_BASE_GAP + overlay.top * scale;
      const id = `ovl${order}`;
      b.rect(id, `overlay ${overlay.label ?? order}`, (left + right) / 2, (bottom + top) / 2, right - left, top - bottom, {
        provenance: { fillRole: "region", dashed: true, dsaOverlay: true },
        phase: "second",
      });
      if (overlay.label) b.label(`${id}_lbl`, `overlay label ${overlay.label}`, (left + right) / 2, top + 0.45, overlay.label, { expected: true });
    }
  }

  // Pointers share the band under the row with the swap glyph; a swap frame
  // draws the crossing arrows instead of the markers on the same two cells.
  const swap = state.swap && !state.groups?.length && state.swap.from !== state.swap.to
    && state.swap.from >= 0 && state.swap.to >= 0 && state.swap.from < total && state.swap.to < total
    ? state.swap
    : null;
  const above = !heights;
  if (!swap) {
    const tipY = above ? ARRAY_CELL / 2 + 0.3 : -(ARRAY_CELL / 2 + 0.3);
    b.pointers(state.pointers, (i) => (i >= 0 && i < total ? xOfIndex[i]! : null), tipY, above ? "down" : "up");
  } else {
    const from = Math.min(swap.from, swap.to);
    const to = Math.max(swap.from, swap.to);
    b.vector("swap_right", `swap ${from} into ${to}`, xOfIndex[from]!, SWAP_CROSS_TOP_Y, xOfIndex[to]!, SWAP_CROSS_BOTTOM_Y, { focus: true });
    b.vector("swap_left", `swap ${to} into ${from}`, xOfIndex[to]!, SWAP_CROSS_TOP_Y, xOfIndex[from]!, SWAP_CROSS_BOTTOM_Y, { focus: true });
  }

  // Brackets: explicit ones, plus the live window when the frame has none.
  const brackets = state.brackets?.length
    ? state.brackets
    : !state.groups?.length
      ? runsOf(state.cells, "window").map(([from, to]) => ({ from, to, label: "" }))
      : [];
  for (const [order, bracket] of brackets.entries()) {
    const from = Math.min(bracket.from, bracket.to);
    const to = Math.max(bracket.from, bracket.to);
    if (from < 0 || to >= total) continue;
    const left = xOfIndex[from]! - ARRAY_CELL / 2;
    const right = xOfIndex[to]! + ARRAY_CELL / 2;
    b.bracket(`brk${order}`, `region ${bracket.label || "window"}`, left, right, BRACKET_TOP_Y, BRACKET_BOTTOM_Y, BRACKET_LABEL_Y, bracket.label);
  }

  b.assertions.push(exists("cells_exist", b.drawFirstIds.filter((id) => id.startsWith("cell"))));
  if (centerIds.length >= 2) b.assertions.push(orderedAlong("cells_ordered", centerIds, "x", "increasing"));
  b.asides(state.asides);
  b.note(state.note);
  return b.parts(state.groups?.length ? `${blocks.length} blocks totalling ${total} cells` : `array of ${total} cells`);
}

function buildListFrame(state: ListFrameState, anchor?: Extent): FrameParts | null {
  if (state.nodes.length < 2) return null;
  const b = new FrameBuilder();
  b.anchor = anchor ?? null;
  const positionOf = new Map<string, number>();
  const centerIds: string[] = [];

  state.nodes.forEach((node, index) => {
    const boxId = `node_${node.id}`;
    positionOf.set(node.id, index);
    const x = index * LIST_STEP;
    b.rect(boxId, `list node ${node.id}`, x, 0, LIST_WIDTH, LIST_HEIGHT, { label: node.label });
    centerIds.push(`${boxId}_c`);
    b.markRect(boxId, x, 0, LIST_WIDTH, LIST_HEIGHT, node.mark);
  });

  const hasOutgoing = new Set<string>();
  let backLinks = 0;
  for (const [order, link] of state.links.entries()) {
    const from = positionOf.get(link.from);
    const to = positionOf.get(link.to);
    if (from === undefined || to === undefined) continue;
    hasOutgoing.add(link.from);
    const arrowId = `link${order}`;
    const role = `next link ${link.from} to ${link.to}`;
    const provenance = link.mark === "excluded" || link.mark === "candidate" ? { dashed: true, dsaMark: link.mark } : undefined;
    const focus = link.mark === "active";
    if (to === from + 1) {
      b.vector(arrowId, role, from * LIST_STEP + LIST_WIDTH / 2, 0, to * LIST_STEP - LIST_WIDTH / 2, 0, { provenance, focus });
      continue;
    }
    if (to > from) {
      // A forward skip arcs over the row.
      const y = LIST_HEIGHT / 2 + LIST_HOOK_DROP;
      b.polyline(`${arrowId}_hook`, `${role} route`, [[from * LIST_STEP, LIST_HEIGHT / 2], [from * LIST_STEP, y], [to * LIST_STEP, y]], { provenance });
      b.vector(arrowId, role, to * LIST_STEP, y, to * LIST_STEP, LIST_HEIGHT / 2 + 0.05, { provenance, focus });
      continue;
    }
    // A backward link hooks under the row, one band per backward link so
    // reversed arrows never lie on each other.
    backLinks += 1;
    const y = -(LIST_HEIGHT / 2 + LIST_HOOK_DROP + (backLinks - 1) * 0.28);
    b.polyline(`${arrowId}_hook`, `${role} route`, [[from * LIST_STEP, -LIST_HEIGHT / 2], [from * LIST_STEP, y], [to * LIST_STEP, y]], { provenance });
    b.vector(arrowId, role, to * LIST_STEP, y, to * LIST_STEP, -LIST_HEIGHT / 2 - 0.05, { provenance, focus });
  }

  // A node with no outgoing link at either end of the row points at null.
  state.nodes.forEach((node, index) => {
    if (hasOutgoing.has(node.id)) return;
    if (index === state.nodes.length - 1) {
      b.label(`null_${node.id}`, "null terminator", index * LIST_STEP + LIST_WIDTH / 2 + 0.62, 0, "∅");
    } else if (index === 0) {
      b.label(`null_${node.id}`, "null terminator", -LIST_WIDTH / 2 - 0.62, 0, "∅");
    }
  });

  b.pointers(
    state.pointers,
    (i) => (i >= 0 && i < state.nodes.length ? i * LIST_STEP : null),
    LIST_HEIGHT / 2 + 0.3,
    "down",
  );

  b.assertions.push(exists("nodes_exist", b.drawFirstIds.filter((id) => id.startsWith("node_"))));
  b.assertions.push(orderedAlong("nodes_ordered", centerIds, "x", "increasing"));
  b.asides(state.asides);
  b.note(state.note);
  return b.parts(`linked list of ${state.nodes.length} nodes`);
}

function buildGridFrame(state: GridFrameState, anchor?: Extent): FrameParts | null {
  const rows = state.rowLabels.length;
  const columns = state.colLabels.length;
  if (rows < 1 || columns < 1) return null;
  if (state.cells.length !== rows) return null;
  if (state.cells.some((row) => row.length !== columns)) return null;

  const b = new FrameBuilder();
  b.anchor = anchor ?? null;
  const centerOf = (column: number, row: number) => ({ x: (column + 0.5) * GRID_W, y: -(row + 0.5) * GRID_H });
  const put = (id: string, column: number, row: number, role: string, cell: TraceCell, phase: "first" | "second") => {
    const { x, y } = centerOf(column, row);
    b.rect(id, role, x, y, GRID_W * 0.9, GRID_H * 0.86, { label: cell.text, phase });
    b.markRect(id, x, y, GRID_W * 0.9, GRID_H * 0.86, cell.mark);
    return `${id}_c`;
  };

  // Header row and column occupy index 0; data starts at 1. Headers live in
  // their own fields and never inside `cells`, so there is no header row to
  // detect, strip, or get wrong.
  const corner = put("corner", 0, 0, "header corner", { text: "" }, "first");
  const firstRowCenters: string[] = [corner];
  const firstColumnCenters: string[] = [corner];
  state.colLabels.forEach((label, column) => {
    firstRowCenters.push(put(`colh${column}`, column + 1, 0, `column header ${column}`, { text: label }, "first"));
  });
  state.rowLabels.forEach((label, row) => {
    firstColumnCenters.push(put(`rowh${row}`, 0, row + 1, `row header ${row}`, { text: label }, "first"));
  });
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      put(`cell_${row}_${column}`, column + 1, row + 1, `grid cell ${row},${column}`, state.cells[row]![column]!, "second");
    }
  }

  // Arrows from the cells a value was computed from into the cell written.
  if (state.write && state.reads?.length) {
    const [wr, wc] = state.write;
    const target = centerOf(wc + 1, wr + 1);
    for (const [order, [rr, rc]] of state.reads.entries()) {
      if (rr < 0 || rc < 0 || rr >= rows || rc >= columns || (rr === wr && rc === wc)) continue;
      const source = centerOf(rc + 1, rr + 1);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.hypot(dx, dy) || 1;
      const trimS = 0.55;
      const trimT = 0.62;
      b.vector(`read${order}`, `read from ${rr},${rc}`, source.x + (dx / length) * trimS, source.y + (dy / length) * trimS, target.x - (dx / length) * trimT, target.y - (dy / length) * trimT, {
        provenance: { dsaRead: true },
      });
    }
  }

  b.assertions.push(exists("grid_exists", b.drawFirstIds.filter((id) => !id.endsWith("_mk"))));
  b.assertions.push(orderedAlong("headers_across", firstRowCenters, "x", "increasing"));
  b.assertions.push(orderedAlong("headers_down", firstColumnCenters, "y", "decreasing"));
  b.asides(state.asides);
  b.note(state.note);
  return b.parts(`${rows} by ${columns} table`);
}

function buildMatrixFrame(state: MatrixFrameState, anchor?: Extent): FrameParts | null {
  const rows = state.cells.length;
  const columns = state.cells[0]?.length ?? 0;
  if (rows < 1 || columns < 1) return null;
  if (state.cells.some((row) => row.length !== columns)) return null;
  if (rows > 8 || columns > 8) return null;

  const b = new FrameBuilder();
  b.anchor = anchor ?? null;
  const size = ARRAY_CELL;
  const step = ARRAY_STEP;
  const centerOf = (row: number, column: number) => ({ x: column * step, y: -row * step });
  const rowCenters: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const { x, y } = centerOf(row, column);
      const id = `m_${row}_${column}`;
      const cell = state.cells[row]![column]!;
      b.rect(id, `matrix cell ${row},${column}`, x, y, size, size, { label: cell.text });
      b.markRect(id, x, y, size, size, cell.mark);
      if (column === 0) rowCenters.push(`${id}_c`);
    }
  }
  if (state.showIndices) {
    for (let column = 0; column < columns; column += 1) {
      b.label(`ci${column}`, `column index ${column}`, column * step, size / 2 + 0.5, String(column));
    }
    for (let row = 0; row < rows; row += 1) {
      b.label(`ri${row}`, `row index ${row}`, -(size / 2 + 0.55), -row * step, String(row));
    }
  }
  if (state.path && state.path.length >= 2) {
    for (let k = 0; k + 1 < state.path.length; k += 1) {
      const [r1, c1] = state.path[k]!;
      const [r2, c2] = state.path[k + 1]!;
      if (r1 < 0 || c1 < 0 || r2 < 0 || c2 < 0 || r1 >= rows || r2 >= rows || c1 >= columns || c2 >= columns) continue;
      const a = centerOf(r1, c1);
      const c = centerOf(r2, c2);
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const trim = 0.36;
      b.vector(`path${k}`, `path step ${k}`, a.x + (dx / length) * trim, a.y + (dy / length) * trim, c.x - (dx / length) * trim, c.y - (dy / length) * trim, {
        provenance: { dsaPath: true },
      });
    }
  }
  b.assertions.push(exists("matrix_exists", b.drawFirstIds.filter((id) => id.startsWith("m_"))));
  if (rowCenters.length >= 2) b.assertions.push(orderedAlong("rows_down", rowCenters, "y", "decreasing"));
  b.asides(state.asides);
  b.note(state.note);
  return b.parts(`${rows} by ${columns} matrix`);
}

interface TreeLayout {
  position: Map<string, { x: number; y: number }>;
}

function layoutTree(nodes: ReadonlyArray<{ id: string }>, edges: ReadonlyArray<{ from: string; to: string }>): TreeLayout | null {
  const childrenOf = new Map<string, string[]>();
  const parents = new Set<string>();
  const known = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) return null;
    if (!childrenOf.has(edge.from)) childrenOf.set(edge.from, []);
    childrenOf.get(edge.from)!.push(edge.to);
    parents.add(edge.to);
  }
  const roots = nodes.filter((node) => !parents.has(node.id));
  if (roots.length !== 1) return null;
  const position = new Map<string, { x: number; y: number }>();
  let leafX = 0;
  const place = (id: string, depth: number): number => {
    const children = childrenOf.get(id) ?? [];
    let x: number;
    if (children.length === 0) {
      x = leafX;
      leafX += 1.75;
    } else {
      const childXs = children.map((child) => place(child, depth + 1));
      x = childXs.reduce((sum, value) => sum + value, 0) / childXs.length;
    }
    position.set(id, { x, y: -depth * 1.9 });
    return x;
  };
  place(roots[0]!.id, 0);
  if (position.size !== nodes.length) return null;
  return { position };
}

function buildTreeFrame(state: TreeFrameState, anchor?: Extent): FrameParts | null {
  if (state.nodes.length < 1) return null;
  const layoutNodes = state.layoutNodes ?? state.nodes;
  const layoutEdges = state.layoutEdges ?? state.edges;
  const layout = layoutTree(layoutNodes, layoutEdges);
  if (!layout) return null;
  const drawn = new Set(state.nodes.map((node) => node.id));
  const b = new FrameBuilder();
  b.anchor = anchor ?? null;

  for (const node of state.nodes) {
    const at = layout.position.get(node.id);
    if (!at) return null;
    const circleId = `node_${node.id}`;
    b.circle(circleId, `tree node ${node.id}`, at.x, at.y, NODE_RADIUS, { label: node.label });
    b.markCircle(circleId, at.x, at.y, NODE_RADIUS, node.mark);
  }
  for (const [order, edge] of state.edges.entries()) {
    if (!drawn.has(edge.from) || !drawn.has(edge.to)) continue;
    const from = layout.position.get(edge.from)!;
    const to = layout.position.get(edge.to)!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const trim = NODE_RADIUS + 0.05;
    const provenance = edge.mark === "excluded" || edge.mark === "candidate" ? { dashed: true, dsaMark: edge.mark } : undefined;
    b.segment(`edge${order}`, `edge ${edge.from} to ${edge.to}`, from.x + (dx / length) * trim, from.y + (dy / length) * trim, to.x - (dx / length) * trim, to.y - (dy / length) * trim, {
      provenance,
      focus: edge.mark === "active",
    });
    b.assertions.push(orderedAlong(`parent_above_${order}`, [`node_${edge.from}_c`, `node_${edge.to}_c`], "y", "decreasing"));
  }
  // An annotation is the state a recursive call carries, so it has to sit
  // beside its own node and clear of every other. Always placing it to the
  // right put a node's returned gain through its right sibling's value, which
  // is worse than useless: the two numbers belong to different nodes and the
  // student reads them as one. Candidates in order of preference, first one
  // that touches nothing wins.
  const annotationOccupied: Occupied[] = [...drawn]
    .map((id) => layout.position.get(id))
    .filter((at): at is { x: number; y: number } => at !== undefined)
    .map((at) => ({ x: at.x, y: at.y, halfW: NODE_RADIUS + 0.1, halfH: NODE_RADIUS + 0.1 }));
  for (const [order, annotation] of (state.annotations ?? []).entries()) {
    const at = layout.position.get(annotation.nodeId);
    if (!at || !drawn.has(annotation.nodeId)) continue;
    const reach = NODE_RADIUS + 0.62;
    const spot = clearestLabelSpot(
      [
        { x: at.x + reach, y: at.y + 0.42 },
        { x: at.x - reach, y: at.y + 0.42 },
        { x: at.x + reach, y: at.y - 0.42 },
        { x: at.x - reach, y: at.y - 0.42 },
        { x: at.x, y: at.y + NODE_RADIUS + 0.7 },
        { x: at.x, y: at.y - NODE_RADIUS - 0.7 },
      ],
      annotation.text,
      annotationOccupied,
    );
    b.label(`ann${order}`, `annotation ${annotation.nodeId}`, spot.x, spot.y, annotation.text, { expected: true });
    annotationOccupied.push({
      x: spot.x,
      y: spot.y,
      halfW: labelHalfWidth(annotation.text),
      halfH: LABEL_HALF_HEIGHT,
    });
  }
  b.assertions.push(exists("tree_exists", b.drawFirstIds.filter((id) => id.startsWith("node_"))));
  b.asides(state.asides);
  b.note(state.note);
  return b.parts(`tree of ${state.nodes.length} nodes`);
}

function segmentsCross(a1: { x: number; y: number }, a2: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }): boolean {
  const orient = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = orient(b1, b2, a1);
  const d2 = orient(b1, b2, a2);
  const d3 = orient(a1, a2, b1);
  const d4 = orient(a1, a2, b2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Node positions for a small graph. The plain ring puts the two diagonals of
 * a four-node graph through the same centre, so their weights land on each
 * other; a handful of candidate layouts (ring rotations, one node in the
 * middle) are scored by edge crossings and the least crossed wins.
 */
function layoutGraph(
  ids: readonly string[],
  edges: ReadonlyArray<{ from: string; to: string }>,
  fixed?: Record<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const count = ids.length;
  if (fixed && ids.every((id) => fixed[id])) {
    return new Map(ids.map((id) => [id, { x: fixed[id]!.x, y: fixed[id]!.y }]));
  }
  const radius = Math.max(2.3, count * 0.72);
  const ring = (order: readonly string[], offset: number) =>
    new Map(order.map((id, index) => {
      const angle = Math.PI / 2 + offset - (2 * Math.PI * index) / order.length;
      return [id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }];
    }));
  const candidates: Array<Map<string, { x: number; y: number }>> = [ring(ids, 0), ring(ids, Math.PI / count)];
  if (count >= 4 && count <= 7) {
    for (const centre of ids) {
      const rest = ids.filter((id) => id !== centre);
      const outer = ring(rest, 0);
      outer.set(centre, { x: 0, y: 0 });
      candidates.push(outer);
    }
  }
  const crossings = (layout: Map<string, { x: number; y: number }>): number => {
    let total = 0;
    for (let i = 0; i < edges.length; i += 1) {
      for (let j = i + 1; j < edges.length; j += 1) {
        const a = edges[i]!;
        const c = edges[j]!;
        if (a.from === c.from || a.from === c.to || a.to === c.from || a.to === c.to) continue;
        if (segmentsCross(layout.get(a.from)!, layout.get(a.to)!, layout.get(c.from)!, layout.get(c.to)!)) total += 1;
      }
    }
    return total;
  };
  let best = candidates[0]!;
  let bestScore = crossings(best);
  for (const candidate of candidates.slice(1)) {
    const score = crossings(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

interface Occupied {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

function overlapsAny(x: number, y: number, halfW: number, occupied: readonly Occupied[]): boolean {
  return occupied.some((box) =>
    Math.abs(x - box.x) < halfW + box.halfW && Math.abs(y - box.y) < LABEL_HALF_HEIGHT + box.halfH);
}

/**
 * The first candidate spot that touches nothing, or the one with the most
 * clearance when every spot is contested.
 */
function clearestLabelSpot(
  candidates: ReadonlyArray<{ x: number; y: number }>,
  text: string,
  occupied: readonly Occupied[],
): { x: number; y: number } {
  const halfW = labelHalfWidth(text);
  for (const candidate of candidates) {
    if (!overlapsAny(candidate.x, candidate.y, halfW, occupied)) return candidate;
  }
  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = Math.min(...occupied.map((box) => Math.hypot(candidate.x - box.x, candidate.y - box.y)));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function buildGraphFrame(state: GraphFrameState, anchor?: Extent): FrameParts | null {
  const count = state.nodes.length;
  if (count < 2) return null;
  const b = new FrameBuilder();
  b.anchor = anchor ?? null;
  const ids = state.nodes.map((node) => node.id);
  const position = layoutGraph(ids, state.edges, state.positions);
  // Everything a weight must stay clear of: the node discs first, then each
  // weight already placed.
  const occupied: Occupied[] = ids.map((id) => {
    const at = position.get(id)!;
    return { x: at.x, y: at.y, halfW: NODE_RADIUS + 0.12, halfH: NODE_RADIUS + 0.12 };
  });

  for (const node of state.nodes) {
    const at = position.get(node.id)!;
    const circleId = `node_${node.id}`;
    b.circle(circleId, `graph node ${node.id}`, at.x, at.y, NODE_RADIUS, { label: node.label });
    b.markCircle(circleId, at.x, at.y, NODE_RADIUS, node.mark);
  }

  for (const [order, edge] of state.edges.entries()) {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (!from || !to) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const trim = NODE_RADIUS + 0.05;
    const edgeId = `edge${order}`;
    const role = `edge ${edge.from} to ${edge.to}`;
    const provenance = edge.mark === "excluded" || edge.mark === "candidate"
      ? { dashed: true, dsaMark: edge.mark }
      : edge.mark === "done"
        ? { strokeWidth: 3.2, dsaMark: "done" }
        : undefined;
    const x1 = from.x + (dx / length) * trim;
    const y1 = from.y + (dy / length) * trim;
    const x2 = to.x - (dx / length) * trim;
    const y2 = to.y - (dy / length) * trim;
    const focus = edge.mark === "active";
    if (state.directed) b.vector(edgeId, role, x1, y1, x2, y2, { provenance, focus });
    else b.segment(edgeId, role, x1, y1, x2, y2, { provenance, focus });

    if (edge.label) {
      // Midpoint anchoring puts both diameters' weights at the ring's centre,
      // one struck through the other. Try a few points along the edge on both
      // sides and take the first that is clear of the nodes and of the weights
      // already placed.
      const nx = -dy / length;
      const ny = dx / length;
      const at = clearestLabelSpot(
        [0.36, 0.64, 0.5, 0.24, 0.76].flatMap((t) => [1, -1].map((side) => ({
          x: from.x + dx * t + nx * 0.52 * side,
          y: from.y + dy * t + ny * 0.52 * side,
        }))),
        edge.label,
        occupied,
      );
      occupied.push({ x: at.x, y: at.y, halfW: labelHalfWidth(edge.label), halfH: LABEL_HALF_HEIGHT });
      b.label(`w${order}`, `edge weight ${edge.from} to ${edge.to}`, at.x, at.y, edge.label, { expected: true });
    }
  }

  b.assertions.push(exists("graph_exists", b.drawFirstIds.filter((id) => id.startsWith("node_"))));
  b.asides(state.asides);
  b.note(state.note);
  return b.parts(`graph of ${count} nodes and ${state.edges.length} edges`);
}

function buildNumberLineFrame(state: NumberLineFrameState, anchor?: Extent): FrameParts | null {
  if (!(state.max > state.min)) return null;
  if (state.bars.length > 10) return null;
  const b = new FrameBuilder();
  b.anchor = anchor ?? null;
  const width = 12;
  const scale = width / (state.max - state.min);
  const xOf = (value: number) => (value - state.min) * scale;
  b.segment("axis", "number line", -0.3, 0, width + 0.3, 0, { phase: "first" });
  for (const [order, tick] of state.ticks.entries()) {
    if (tick < state.min || tick > state.max) continue;
    b.segment(`tick${order}`, `tick ${tick}`, xOf(tick), -0.18, xOf(tick), 0.18, { phase: "first" });
    b.label(`tick${order}_lbl`, `tick label ${tick}`, xOf(tick), -0.62, String(tick));
  }
  const barHeight = 0.8;
  for (const bar of state.bars) {
    if (!(bar.to > bar.from)) continue;
    const left = xOf(Math.max(bar.from, state.min));
    const right = xOf(Math.min(bar.to, state.max));
    const cy = 0.75 + bar.lane * 1.15;
    const id = `bar_${bar.id}`;
    b.rect(id, `interval ${bar.id}`, (left + right) / 2, cy, right - left, barHeight, { label: bar.label ?? "", phase: "first" });
    b.markRect(id, (left + right) / 2, cy, right - left, barHeight, bar.mark);
  }
  b.assertions.push(exists("line_exists", ["axis"]));
  b.asides(state.asides);
  b.note(state.note);
  return b.parts(`${state.bars.length} intervals on a number line`);
}

/** Shift every point construction and prefix every id in a part. */
function relocate(parts: FrameParts, prefix: string, dx: number, dy: number): FrameParts {
  const ids = new Set<string>();
  for (const entity of parts.entities) ids.add(entity.id);
  for (const construction of parts.constructions) for (const output of construction.outputs) ids.add(output);
  const rename = (value: string) => (ids.has(value) ? `${prefix}${value}` : value);
  const renameInputs = (inputs: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === "string") out[key] = rename(value);
      else if (Array.isArray(value)) out[key] = value.map((item) => (typeof item === "string" ? rename(item) : item));
      else out[key] = value;
    }
    return out;
  };
  return {
    entities: parts.entities.map((entity) => ({ ...entity, id: `${prefix}${entity.id}` })),
    constructions: parts.constructions.map((construction) => {
      const inputs = renameInputs(construction.inputs);
      if (construction.operator === "point" && typeof inputs.x === "number" && typeof inputs.y === "number") {
        inputs.x = inputs.x + dx;
        inputs.y = inputs.y + dy;
      }
      return { ...construction, id: `${prefix}${construction.id}`, inputs, outputs: construction.outputs.map((output) => `${prefix}${output}`) };
    }),
    assertions: parts.assertions.map((assertion) => ({ ...assertion, id: `${prefix}${assertion.id}`, entities: assertion.entities.map(rename) })),
    drawFirstIds: parts.drawFirstIds.map((id) => `${prefix}${id}`),
    drawSecondIds: parts.drawSecondIds.map((id) => `${prefix}${id}`),
    focusEntityIds: parts.focusEntityIds.map((id) => `${prefix}${id}`),
    expectedLabels: Object.fromEntries(Object.entries(parts.expectedLabels).map(([id, text]) => [`${prefix}${id}`, text])),
    reason: parts.reason,
    extent: { minX: parts.extent.minX + dx, maxX: parts.extent.maxX + dx, minY: parts.extent.minY + dy, maxY: parts.extent.maxY + dy },
    figureExtent: {
      minX: parts.figureExtent.minX + dx,
      maxX: parts.figureExtent.maxX + dx,
      minY: parts.figureExtent.minY + dy,
      maxY: parts.figureExtent.maxY + dy,
    },
  };
}

/**
 * Each stacked panel's extent across the whole trace: `full` places it and
 * sizes its slot, `figure` is what its own asides and note hang from.
 */
interface PanelSlots {
  full: Extent[];
  figure: Extent[];
}

/**
 * Figures stacked top to bottom.
 *
 * Each panel is top aligned in a slot whose height is fixed for the whole
 * trace. Laying them out by this frame's measured heights instead made the
 * lower panels move whenever an upper one grew: a `window` run on the input
 * row of a dynamic programming frame adds a bracket under it, and that alone
 * dropped the table beneath by 93 measured pixels between two frames of the
 * same walk. `panelHeights` comes from `compileTraceScenes`, which measures
 * every frame before any of them is laid out.
 */
function buildStackedFrame(
  state: StackedFrameState,
  slots?: PanelSlots,
): FrameParts | null {
  if (state.parts.length === 0) return null;
  const merged: FrameParts = {
    entities: [],
    constructions: [],
    assertions: [],
    drawFirstIds: [],
    drawSecondIds: [],
    focusEntityIds: [],
    expectedLabels: {},
    reason: `${state.parts.length} stacked figures`,
    extent: emptyExtent(),
    figureExtent: emptyExtent(),
  };
  let top = 0;
  const gap = 1.3;
  for (const [index, part] of state.parts.entries()) {
    const panelAnchor = slots?.figure[index];
    const built = buildFrameParts(
      part.state,
      panelAnchor && finiteExtent(panelAnchor) ? { anchor: panelAnchor } : {},
    );
    if (!built || !finiteExtent(built.extent)) return null;
    // Placed by the panel's extent across the whole trace, not by its extent
    // in this frame. Aligning to the frame's own top made a panel slide
    // whenever anything above its first row changed, so the same cell was in a
    // different place from one frame to the next.
    const reference = slots?.full[index];
    const ref = reference && finiteExtent(reference) ? reference : built.extent;
    const dy = top - ref.maxY;
    const dx = -ref.minX;
    const moved = relocate(built, `p${index}_`, dx, dy);
    if (part.label?.trim()) {
      const labelBuilder = new FrameBuilder();
      // Placed against the slot, not against this frame's own panel extent.
      // `dy` puts `ref.maxY` exactly at `top` and `dx` puts `ref.minX` at 0,
      // so these two numbers are the same in every frame, which is the whole
      // point: a panel title that moves reads as the board redrawing itself.
      labelBuilder.label(
        `p${index}_title`,
        `panel title ${part.label.trim()}`,
        ref.minX + dx + 0.2,
        ref.maxY + dy + 0.55,
        part.label,
        { expected: true },
      );
      const labelParts = labelBuilder.parts("panel title");
      moved.entities.push(...labelParts.entities);
      moved.constructions.push(...labelParts.constructions);
      moved.drawSecondIds.push(...labelParts.drawSecondIds);
      Object.assign(moved.expectedLabels, labelParts.expectedLabels);
      moved.extent = unionExtent(moved.extent, labelParts.extent);
    }
    merged.entities.push(...moved.entities);
    merged.constructions.push(...moved.constructions);
    merged.assertions.push(...moved.assertions);
    merged.drawFirstIds.push(...moved.drawFirstIds);
    merged.drawSecondIds.push(...moved.drawSecondIds);
    merged.focusEntityIds.push(...moved.focusEntityIds);
    Object.assign(merged.expectedLabels, moved.expectedLabels);
    merged.extent = unionExtent(merged.extent, moved.extent);
    merged.figureExtent = unionExtent(merged.figureExtent, moved.figureExtent);
    top = top - (ref.maxY - ref.minY) - gap;
  }
  if (state.note?.trim()) {
    const noteBuilder = new FrameBuilder();
    noteBuilder.extent = merged.extent;
    noteBuilder.note(state.note);
    const noteParts = noteBuilder.parts("note");
    merged.entities.push(...noteParts.entities);
    merged.constructions.push(...noteParts.constructions);
    merged.drawSecondIds.push(...noteParts.drawSecondIds);
    Object.assign(merged.expectedLabels, noteParts.expectedLabels);
    merged.extent = unionExtent(merged.extent, noteParts.extent);
  }
  return merged;
}

/**
 * Build one frame.
 *
 * `layout` carries what only a whole trace knows: where asides and notes hang
 * from, and how tall each stacked panel's slot is. Without it every frame is
 * laid out on its own and anything hanging off the figure moves whenever the
 * figure does.
 */
function buildFrameParts(
  state: TraceFrameState,
  layout: { anchor?: Extent; slots?: PanelSlots } = {},
): FrameParts | null {
  if (state.kind === "stacked") return buildStackedFrame(state, layout.slots);
  const parts = ((): FrameParts | null => {
    switch (state.kind) {
      case "array": return buildArrayFrame(state, layout.anchor);
      case "list": return buildListFrame(state, layout.anchor);
      case "grid": return buildGridFrame(state, layout.anchor);
      case "matrix": return buildMatrixFrame(state, layout.anchor);
      case "tree": return buildTreeFrame(state, layout.anchor);
      case "graph": return buildGraphFrame(state, layout.anchor);
      case "numberline": return buildNumberLineFrame(state, layout.anchor);
      default: return null;
    }
  })();
  return parts;
}

function withExtentBox(parts: FrameParts, extent: Extent): FrameParts {
  const b = new FrameBuilder();
  b.extentBox({
    minX: extent.minX - EXTENT_MARGIN_X,
    maxX: extent.maxX + EXTENT_MARGIN_X,
    minY: extent.minY - EXTENT_MARGIN_Y,
    maxY: extent.maxY + EXTENT_MARGIN_Y,
  });
  const box = b.parts("extent");
  return {
    ...parts,
    entities: [...box.entities, ...parts.entities],
    constructions: [...box.constructions, ...parts.constructions],
    drawFirstIds: [...box.drawFirstIds, ...parts.drawFirstIds],
  };
}

function frameDocument(frame: TraceFrame, parts: FrameParts, question?: string): SceneDocument {
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: parts.reason },
    source: {
      ...(question ? { question } : {}),
      synthesizedDsa: true,
      dsaTraceFrame: frame.id,
      // The frame carries its own extent box covering every label anchor, so
      // the compiler does not need to reserve 18% of the zone for labels it
      // cannot see. The stacked hint builder has no such box and still does.
      dsaFitBox: true,
      structure: frame.state.kind,
    },
    quantities: [],
    entities: parts.entities,
    constructions: parts.constructions,
    relations: [],
    assertions: parts.assertions,
    annotations: frame.caption
      ? [{ id: "caption", kind: "caption", targetIds: [], text: frame.caption }]
      : [],
    requiredEntityIds: [...parts.drawFirstIds, ...parts.drawSecondIds],
    // Two groups within a frame: the skeleton, then values and markers. The
    // frame-to-frame progression is handled by swapping documents, not by
    // stacking reveal groups.
    revealGroups: [
      { id: "structure", entityIds: parts.drawFirstIds, dependsOn: [], narrationCue: parts.reason },
      { id: "markers", entityIds: parts.drawSecondIds, dependsOn: ["structure"], narrationCue: frame.caption },
    ].filter((group) => group.entityIds.length > 0),
    teachingTimeline: [],
  };
}

/**
 * Compile every frame of a trace. Fails closed: if any frame declines or
 * compiles with a fatal, the whole trace is refused rather than teaching a
 * partial walk-through with a hole in the middle.
 */
export function compileTraceScenes(
  trace: AlgorithmTrace,
  options: { question?: string; compile?: CompileOptions } = {},
): DsaTraceScenes | null {
  // First pass: lay every frame out on its own, purely to measure. Nothing
  // from this pass is drawn.
  //
  // Two things can only be known once every frame has been measured: where the
  // figure sits across the whole walk, so an aside and a note can hang from a
  // fixed place instead of following the figure as it grows, and how tall each
  // stacked panel's slot has to be, so a bracket appearing under one panel
  // cannot push the panel below it down the board. Both were real: an
  // insertion walk's output row drifted down on every frame, and a dynamic
  // programming table dropped 93 measured pixels between two frames of the
  // same walk.
  const measured: FrameParts[] = [];
  let figure = emptyExtent();
  const slots: PanelSlots = { full: [], figure: [] };
  for (const frame of trace.frames) {
    const parts = buildFrameParts(frame.state);
    if (!parts || !finiteExtent(parts.extent)) return null;
    measured.push(parts);
    figure = unionExtent(figure, parts.figureExtent);
    if (frame.state.kind === "stacked") {
      for (const [index, part] of frame.state.parts.entries()) {
        const panel = buildFrameParts(part.state);
        if (!panel || !finiteExtent(panel.extent)) return null;
        slots.full[index] = unionExtent(slots.full[index] ?? emptyExtent(), panel.extent);
        slots.figure[index] = unionExtent(slots.figure[index] ?? emptyExtent(), panel.figureExtent);
      }
    }
  }

  // Second pass: the real layout, every frame anchored to what the first pass
  // measured, then the union of those for the shared extent box.
  const built: FrameParts[] = [];
  let shared = emptyExtent();
  for (const [index, frame] of trace.frames.entries()) {
    const parts = buildFrameParts(frame.state, {
      ...(finiteExtent(figure) ? { anchor: figure } : {}),
      ...(slots.full.length > 0 ? { slots } : {}),
    }) ?? measured[index]!;
    if (!finiteExtent(parts.extent)) return null;
    built.push(parts);
    shared = unionExtent(shared, parts.extent);
  }

  const frames: DsaFrameScene[] = [];
  let decision = {
    tier: "qualitative_verified" as RepresentationTier,
    nonMetric: true,
    reason: "no frames compiled",
  };

  for (const [index, frame] of trace.frames.entries()) {
    const parts = withExtentBox(built[index]!, shared);
    const raw = frameDocument(frame, parts, options.question);
    const pruned = pruneDeadSceneEntities(raw as unknown as Record<string, unknown>);
    const validated = validateSceneDocument(pruned);
    if (!validated.document) return null;

    const compiled = compileSceneDocument(validated.document, options.compile ?? {});
    if (
      !compiled.ok ||
      !compiled.renderScene ||
      compiled.renderScene.primitives.length === 0 ||
      compiled.report.issues.some((issue) => issue.severity === "fatal")
    ) {
      return null;
    }

    decision = tierForForeignDocument(validated.document);
    const scene: DsaFrameScene = {
      frameId: frame.id,
      caption: frame.caption,
      narrationIntent: frame.narrationIntent,
      document: validated.document,
      renderScene: compiled.renderScene,
      validationReport: compiled.report,
      focusEntityIds: parts.focusEntityIds,
      expectedLabels: parts.expectedLabels,
    };
    if (hasSpillingValue(scene)) return null;
    frames.push(scene);
  }

  if (frames.length < 2) return null;
  return {
    algorithmId: trace.algorithmId,
    title: trace.title,
    structure: trace.frames[0]!.state.kind,
    tier: decision.tier,
    nonMetric: decision.nonMetric,
    tierReason: decision.reason,
    frames,
  };
}

/**
 * Why a frame refused to compile, for gates and probes. Returns the fatal
 * issues of the first failing stage, or an empty list when the frame is fine.
 */
export function explainFrameCompile(
  trace: AlgorithmTrace,
  frameIndex: number,
  options: { question?: string; compile?: CompileOptions } = {},
): Array<{ stage: string; code: string; message: string }> {
  const frame = trace.frames[frameIndex];
  if (!frame) return [{ stage: "frame", code: "missing", message: `no frame ${frameIndex}` }];
  let shared = emptyExtent();
  for (const other of trace.frames) {
    const parts = buildFrameParts(other.state);
    if (parts && finiteExtent(parts.extent)) shared = unionExtent(shared, parts.extent);
  }
  const natural = buildFrameParts(frame.state);
  if (!natural) return [{ stage: "build", code: "declined", message: "builder returned null" }];
  const parts = withExtentBox(natural, shared);
  const raw = frameDocument(frame, parts, options.question);
  const pruned = pruneDeadSceneEntities(raw as unknown as Record<string, unknown>);
  const validated = validateSceneDocument(pruned);
  if (!validated.document) {
    return validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => ({ stage: "validate", code: issue.code, message: issue.message }));
  }
  const compiled = compileSceneDocument(validated.document, options.compile ?? {});
  const fatal = compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => ({ stage: "compile", code: issue.code, message: issue.message }));
  if (fatal.length > 0 || !compiled.ok || !compiled.renderScene) return fatal.length > 0 ? fatal : [{ stage: "compile", code: "not_ok", message: "compiler returned no scene" }];
  const scene: DsaFrameScene = {
    frameId: frame.id,
    caption: frame.caption,
    narrationIntent: frame.narrationIntent,
    document: validated.document,
    renderScene: compiled.renderScene,
    validationReport: compiled.report,
    focusEntityIds: parts.focusEntityIds,
    expectedLabels: parts.expectedLabels,
  };
  if (hasSpillingValue(scene)) return [{ stage: "spill", code: "value_spills", message: "a value is wider than its box" }];
  return [];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function primitiveBox(primitive: { points?: Array<{ x: number; y: number }> }): Box | null {
  const points = primitive.points ?? [];
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * A value wider than the box that owns it. The cell size falls out of the
 * fitted transform, so this cannot be known until after compiling — and a
 * number lying across its own cell wall is the "labels touching the diagram"
 * complaint. Boxes are checked against their reserved label bounds; circles
 * against the chord at the label's height. Fail closed and let the caller
 * draw nothing.
 */
export function hasSpillingValue(frame: DsaFrameScene): boolean {
  const primitives = frame.renderScene.primitives;
  for (const entityId of Object.keys(frame.expectedLabels)) {
    const owner = primitives.find((primitive) => primitive.entityId === entityId && primitive.kind !== "label");
    if (!owner) continue;
    const label = primitives.find((primitive) => primitive.entityId === entityId && primitive.kind === "label");
    if (!label) continue;
    const reserved = (label as { provenance?: { labelBounds?: unknown } }).provenance?.labelBounds;
    const textBox =
      reserved && typeof reserved === "object" && typeof (reserved as Box).width === "number"
        ? (reserved as Box)
        : primitiveBox(label as { points?: Array<{ x: number; y: number }> });
    if (!textBox) continue;
    if (owner.kind === "circle") {
      const radius = (owner as { radius?: number }).radius ?? 0;
      const half = textBox.height / 2;
      const chord = radius > half ? 2 * Math.sqrt(radius * radius - half * half) : 0;
      if (textBox.width > chord - 3) return true;
      continue;
    }
    if (owner.kind !== "rectangle" && owner.kind !== "polygon") continue;
    const ownerBox = primitiveBox(owner as { points?: Array<{ x: number; y: number }> });
    if (!ownerBox) continue;
    if (
      textBox.x < ownerBox.x - 1 ||
      textBox.y < ownerBox.y - 1 ||
      textBox.x + textBox.width > ownerBox.x + ownerBox.width + 1 ||
      textBox.y + textBox.height > ownerBox.y + ownerBox.height + 1
    ) {
      return true;
    }
  }
  return false;
}

export interface RenderMismatch {
  frameId: string;
  entityId: string;
  expected: string;
  actual: string | null;
}

/**
 * The crux check: every value the trace placed at an address must be the text
 * actually drawn against that entity. This is what makes "3 in the wrong
 * column" a failure rather than a screenshot.
 */
export function traceRenderMismatches(scenes: DsaTraceScenes): RenderMismatch[] {
  const mismatches: RenderMismatch[] = [];
  for (const frame of scenes.frames) {
    for (const [entityId, expected] of Object.entries(frame.expectedLabels)) {
      const labels = frame.renderScene.primitives.filter(
        (primitive) => primitive.kind === "label" && primitive.entityId === entityId,
      );
      const actual = labels.map((primitive) => (primitive as { text?: string }).text ?? "").find((text) => text.length > 0) ?? null;
      if (actual !== expected) {
        mismatches.push({ frameId: frame.frameId, entityId, expected, actual });
      }
    }
  }
  return mismatches;
}
