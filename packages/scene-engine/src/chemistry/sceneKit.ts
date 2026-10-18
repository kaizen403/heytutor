/**
 * The drawing vocabulary the chemistry families share, over the same
 * scene-document/v2 builder every physics archetype uses.
 *
 * Atoms are labels pinned on their own position (a symbol beside a bond
 * junction reads as a substituent), bonds are segments trimmed back from a
 * labelled atom, wedges are thin triangles, dashes are dashed segments,
 * lone pairs are dot pairs, electrons are short up/down arrows, and energy
 * levels are horizontal segments. Everything here compiles through the
 * ordinary validator and compiler, so a chemistry figure is proved the way a
 * ray diagram is: geometry first, then labels that must fit, or no figure.
 */
import { SceneBuilder, compact, round, type Vec2 } from "../archetypes/document";
import type { SceneDocument } from "../types";
import { normalizeChemistryText } from "./formula";

export interface ChemPlanQuantity {
  id: string;
  symbol: string;
  value: number;
  unit?: string;
  sourceText?: string;
}

export type ChemFamilyBuilder = (
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
) => SceneDocument | null;

/** Lower-cased, notation-normalised stem for cue matching. */
export function chemStem(question: string): string {
  return normalizeChemistryText(question).toLowerCase();
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function planQuantity(quantities: readonly ChemPlanQuantity[], aliases: readonly string[]): number | null {
  const keys = aliases.map(normalizeKey);
  const match = quantities.find((quantity) =>
    keys.includes(normalizeKey(quantity.id)) || keys.includes(normalizeKey(quantity.symbol)));
  return match ? match.value : null;
}

/** First number after a phrase in the stem: `numberAfter(stem, /half.?life (?:is|of|=)?/)`. */
export function numberAfter(stem: string, phrase: RegExp): number | null {
  const pattern = new RegExp(`${phrase.source}\\s*(?:=|is|of|:)?\\s*(-?\\d+(?:\\.\\d+)?)(?:\\s*[x×]\\s*10\\^?\\(?(-?\\d+)\\)?)?`, "i");
  const match = pattern.exec(stem);
  if (!match) return null;
  const mantissa = Number(match[1]);
  const exponent = match[2] !== undefined ? Number(match[2]) : 0;
  return mantissa * Math.pow(10, exponent);
}

export type BondStyle = "plain" | "wedge" | "dash";

export interface AtomOptions {
  /** Draw a disc of this world radius under the symbol; 0 (default) is a bare symbol. */
  radius?: number;
  role?: string;
  /** Text drawn instead of the symbol (a charge, an isotope, "C" hidden on skeletal carbons). */
  text?: string | null;
}

export interface BondOptions {
  order?: 1 | 2 | 3;
  style?: BondStyle;
  /** World distance kept clear around each end for the atom symbol. */
  trimStart?: number;
  trimEnd?: number;
  /** Perpendicular offset between the strokes of a multiple bond. */
  spacing?: number;
  label?: string;
  role?: string;
}

const DEFAULT_TRIM = 0.24;
const DEFAULT_SPACING = 0.1;
const WEDGE_HALF_WIDTH = 0.09;
const LONE_PAIR_SPREAD = 0.11;
const ELECTRON_HALF = 0.16;

function unit(from: Vec2, to: Vec2): Vec2 {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 1e-9) throw new Error("zero-length bond");
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

export class ChemScene {
  readonly scene: SceneBuilder;
  private readonly positions = new Map<string, Vec2>();
  private readonly trims = new Map<string, number>();
  private counter = 0;

  constructor(readonly question: string, reason: string, readonly family: string) {
    this.scene = new SceneBuilder(question, reason, family);
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  positionOf(id: string): Vec2 {
    const at = this.positions.get(id);
    if (!at) throw new Error(`unknown atom ${id}`);
    return at;
  }

  /**
   * An atom: a symbol pinned on its position, optionally on a disc. A null
   * `text` places an unlabelled vertex (a skeletal carbon) that bonds meet at.
   */
  atom(id: string, symbol: string, at: Vec2, options: AtomOptions = {}): string {
    const text = options.text === undefined ? symbol : options.text;
    const role = options.role ?? `${symbol} atom`;
    this.positions.set(id, at);
    if (options.radius && options.radius > 0) {
      const center = this.scene.helper(`${id}_c`, at, `${role} centre helper`);
      this.scene.circle(id, center, options.radius, role, text ?? undefined);
      this.pin(id);
      this.trims.set(id, options.radius);
      return id;
    }
    if (text === null) {
      this.scene.helper(id, at, `${role} helper`);
      this.trims.set(id, 0);
      return id;
    }
    const anchor = this.scene.helper(`${id}_p`, at, `${role} anchor helper`);
    this.scene.entities.push({ id, kind: "label", role, label: compact(text), provenance: { pinLabel: true } });
    this.scene.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target: anchor, text: compact(text) }, outputs: [id] });
    this.trims.set(id, DEFAULT_TRIM * Math.max(1, Math.min(2, text.length / 2)));
    return id;
  }

  private pin(id: string): void {
    const entity = this.scene.entities.find((candidate) => candidate.id === id);
    if (entity) entity.provenance = { ...(entity.provenance ?? {}), pinLabel: true };
  }

  /** A bond between two atoms (ids) or two positions. */
  bond(id: string, from: string | Vec2, to: string | Vec2, options: BondOptions = {}): string[] {
    const a = typeof from === "string" ? this.positionOf(from) : from;
    const b = typeof to === "string" ? this.positionOf(to) : to;
    const trimA = options.trimStart ?? (typeof from === "string" ? this.trims.get(from) ?? 0 : 0);
    const trimB = options.trimEnd ?? (typeof to === "string" ? this.trims.get(to) ?? 0 : 0);
    const dir = unit(a, b);
    const start = { x: a.x + dir.x * trimA, y: a.y + dir.y * trimA };
    const end = { x: b.x - dir.x * trimB, y: b.y - dir.y * trimB };
    const normal = { x: -dir.y, y: dir.x };
    const order = options.order ?? 1;
    const spacing = options.spacing ?? DEFAULT_SPACING;
    const role = options.role ?? "bond";
    const style = options.style ?? "plain";
    if (style === "wedge") {
      const p0 = this.scene.helper(`${id}_w0`, start, "wedge helper");
      const p1 = this.scene.helper(`${id}_w1`, { x: end.x + normal.x * WEDGE_HALF_WIDTH, y: end.y + normal.y * WEDGE_HALF_WIDTH }, "wedge helper");
      const p2 = this.scene.helper(`${id}_w2`, { x: end.x - normal.x * WEDGE_HALF_WIDTH, y: end.y - normal.y * WEDGE_HALF_WIDTH }, "wedge helper");
      this.scene.polygon(id, [p0, p1, p2], `${role} (wedge, towards viewer)`, options.label);
      return [id];
    }
    const offsets = order === 1 ? [0] : order === 2 ? [-spacing / 2, spacing / 2] : [-spacing, 0, spacing];
    const ids: string[] = [];
    offsets.forEach((offset, index) => {
      const segmentId = offsets.length === 1 ? id : `${id}_${index + 1}`;
      const s = this.scene.helper(`${segmentId}_s`, { x: start.x + normal.x * offset, y: start.y + normal.y * offset }, "bond end helper");
      const e = this.scene.helper(`${segmentId}_e`, { x: end.x + normal.x * offset, y: end.y + normal.y * offset }, "bond end helper");
      this.scene.segment(segmentId, s, e, index === 0 ? (style === "dash" ? `${role} (dash, away from viewer)` : role) : `${role} stroke`, index === 0 ? options.label : undefined);
      if (style === "dash") {
        const entity = this.scene.entities.find((candidate) => candidate.id === segmentId);
        if (entity) entity.provenance = { ...(entity.provenance ?? {}), dashed: true };
      }
      ids.push(segmentId);
    });
    return ids;
  }

  /** A lone pair: two dots beside an atom, centred `distance` away along `angleDeg`. */
  lonePair(id: string, atom: string | Vec2, angleDeg: number, distance = 0.38): string[] {
    const at = typeof atom === "string" ? this.positionOf(atom) : atom;
    const rad = (angleDeg * Math.PI) / 180;
    const center = { x: at.x + Math.cos(rad) * distance, y: at.y + Math.sin(rad) * distance };
    const normal = { x: -Math.sin(rad), y: Math.cos(rad) };
    const ids = [0, 1].map((index) => {
      const sign = index === 0 ? -1 : 1;
      const dotId = `${id}_${index + 1}`;
      this.scene.point(dotId, { x: center.x + normal.x * LONE_PAIR_SPREAD * sign, y: center.y + normal.y * LONE_PAIR_SPREAD * sign }, "lone pair electron");
      const entity = this.scene.entities.find((candidate) => candidate.id === dotId);
      if (entity) entity.provenance = { pointStyle: "filled" };
      return dotId;
    });
    return ids;
  }

  /** A single electron: a short arrow, spin up or down, centred on `at`. */
  electron(id: string, at: Vec2, spin: "up" | "down", role = "electron"): string {
    const tail = { x: at.x, y: at.y + (spin === "up" ? -ELECTRON_HALF : ELECTRON_HALF) };
    const tailId = this.scene.helper(`${id}_t`, tail, "electron tail helper");
    return this.scene.vector(id, tailId, { direction: { x: 0, y: spin === "up" ? 1 : -1 }, length: 2 * ELECTRON_HALF }, role);
  }

  /** An energy level: a horizontal segment of `width` centred at `at`. */
  level(id: string, at: Vec2, width: number, role: string, label?: string): string {
    const a = this.scene.helper(`${id}_a`, { x: at.x - width / 2, y: at.y }, "level end helper");
    const b = this.scene.helper(`${id}_b`, { x: at.x + width / 2, y: at.y }, "level end helper");
    return this.scene.segment(id, a, b, role, label);
  }

  /** A dashed construction link (MO correlation line, barycentre, guide). */
  link(id: string, from: Vec2, to: Vec2, role = "construction link", dashed = true): string {
    const a = this.scene.helper(`${id}_a`, from, "link helper");
    const b = this.scene.helper(`${id}_b`, to, "link helper");
    const segment = this.scene.segment(id, a, b, role);
    if (dashed) {
      const entity = this.scene.entities.find((candidate) => candidate.id === id);
      if (entity) entity.provenance = { dashed: true, strokeRole: "construction" };
    }
    return segment;
  }

  /**
   * A bond angle at `vertex` between the directions to `a` and `b`, drawn as
   * an arc with its value beside it. This is an `arc`, not `angle_mark`: the
   * validator promotes an angle_mark vertex to a drawn point, which on an
   * atom symbol reads as a stray electron.
   */
  angle(id: string, vertex: string | Vec2, a: string | Vec2, b: string | Vec2, label?: string, radius = 0.36): string {
    const v = typeof vertex === "string" ? this.positionOf(vertex) : vertex;
    const pa = typeof a === "string" ? this.positionOf(a) : a;
    const pb = typeof b === "string" ? this.positionOf(b) : b;
    const degA = (Math.atan2(pa.y - v.y, pa.x - v.x) * 180) / Math.PI;
    const degB = (Math.atan2(pb.y - v.y, pb.x - v.x) * 180) / Math.PI;
    let sweep = degB - degA;
    while (sweep <= -180) sweep += 360;
    while (sweep > 180) sweep -= 360;
    const start = sweep >= 0 ? degA : degB;
    const end = start + Math.abs(sweep);
    const center = this.scene.helper(`${id}_c`, v, "angle centre helper");
    return this.scene.arc(id, center, radius, start, end, "bond angle", label);
  }

  /** Free text pinned at a position. */
  text(id: string, at: Vec2, text: string, role = "caption"): string {
    const anchor = this.scene.helper(`${id}_p`, at, `${role} anchor helper`);
    this.scene.entities.push({ id, kind: "label", role, label: compact(text), provenance: { pinLabel: true } });
    this.scene.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target: anchor, text: compact(text) }, outputs: [id] });
    return id;
  }

  /** A labelled arrow from one position to another. */
  arrow(id: string, from: Vec2, to: Vec2, role: string, label?: string): string {
    const tail = this.scene.helper(`${id}_t`, from, "arrow tail helper");
    const head = this.scene.helper(`${id}_h`, to, "arrow head helper");
    return this.scene.vector(id, tail, { end: head }, role, label);
  }

  /** Auto-named helper point. */
  helper(at: Vec2, role = "helper"): string {
    return this.scene.helper(this.nextId("h"), at, role);
  }

  build(extra?: { caption?: string }): SceneDocument {
    const document = this.scene.build();
    if (extra?.caption) {
      document.annotations.push({ id: "figure_caption", kind: "callout", targetIds: [], text: extra.caption });
    }
    document.source = { ...document.source, chemistryFamily: this.family };
    return document;
  }
}

export { round };
export type { Vec2 };
