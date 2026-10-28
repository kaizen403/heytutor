/**
 * Part locator, source 1: the Commons SVG's own text. A drawing whose labels
 * are still `<text>` says exactly what is printed and where, so this reads
 * each text chunk with its transforms, font size and anchor, estimates its
 * box from Helvetica widths (rsvg on Commons draws Arial and sans-serif with
 * Liberation Sans, which shares them), and maps it from SVG user units to the
 * stroke plan's pixels: user units, through the root viewBox, onto the
 * Commons thumbnail, fitted into 760x600 as the plan was.
 *
 * Anything this cannot read with certainty is left out, never guessed:
 * rotated or mirrored text, text on a path, text in a nested `<svg>`, a root
 * whose size disagrees with the plan's. A label that is left out can still be
 * said; it just cannot be pointed at. The locator also checks every box
 * against the plan's ink before it keeps it (`partLocator.ts`).
 *
 * The parser is a small XML reader for what Commons SVGs contain (comments,
 * CDATA, a DOCTYPE with entities, namespaced names). A file it cannot read
 * gives no text, so the picture simply has no SVG parts.
 *
 * The file is untrusted, so every pass is a linear scan with a ceiling:
 * entity expansion may at most double the file, stylesheets are read up to
 * 64 KB, and a file with more than 3,000 texts or 60,000 characters of text
 * is declined. Hitting a ceiling declines the file (no parts), never the
 * picture.
 */
import type { PicturePlacement } from "@heytutor/drawing";
import type { TextLine, TextWord } from "./partLocatorMatch";

/** Bytes read from an SVG at most; Commons diagrams with live text measure 10 KB to 1.5 MB. */
export const SVG_MAX_BYTES = 2_000_000;
const MAX_NODES = 250_000;
const MAX_DEPTH = 256;
/** Stylesheet text read at most; Commons diagrams carry a few KB. More declines the file. */
const MAX_STYLE_CHARS = 64_000;
const MAX_STYLE_RULES = 2_000;
/** A style value longer than this is not one this reader needs (a font size, a family list): it is ignored. */
const MAX_STYLE_VALUE = 256;
/** `<text>` elements (and lines) read at most; more declines the file. Commons diagrams carry tens to a few hundred. */
export const SVG_MAX_TEXTS = 3_000;
/** Characters of text in the whole file at most; more declines it. */
export const SVG_MAX_TEXT_CHARS = 60_000;
/** A `<text>` saying more than this is a caption or a paragraph, not a label: it is printed but not boxed. */
const MAX_LABEL_CHARS = 200;
/** How long the reader may hold the event loop before it yields. */
const SLICE_MS = 12;
/** Text turned further than this is not a horizontal label: it is left out. */
const MAX_TILT = Math.tan((8 * Math.PI) / 180);
/** The plan and the SVG root must agree on aspect within this share, or the mapping is not trusted. */
const ASPECT_TOLERANCE = 0.015;

interface Element {
  name: string;
  attrs: Record<string, string>;
  children: Array<Element | string>;
}

const NON_RENDERED = new Set(["defs", "symbol", "clippath", "mask", "pattern", "marker", "lineargradient", "radialgradient", "filter", "metadata", "title", "desc", "foreignobject", "style", "script", "flowroot", "font", "font-face"]);

const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** How many characters the file's own entities may still add; below zero, the file is declined. */
interface Expansion { left: number }

/** Null once the file's entities have added more than their allowance (a billion laughs, or one huge value used often). */
function decodeEntities(value: string, entities: ReadonlyMap<string, string>, expansion: Expansion): string | null {
  if (!value.includes("&")) return value;
  const out = value.replace(/&(#x[0-9a-f]+|#[0-9]+|[A-Za-z_][\w.-]*);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    const predefined = PREDEFINED[ref];
    if (predefined !== undefined) return predefined;
    const own = entities.get(ref);
    if (own === undefined) return whole;
    // Counted before it is built, so an over-large expansion is never allocated.
    expansion.left -= own.length;
    return expansion.left < 0 ? "" : own;
  });
  return expansion.left < 0 ? null : out;
}

/** `svg:text` and `text` are one element; other namespaces (inkscape:, sodipodi:, rdf:) keep their prefix and are never rendered. */
function localName(raw: string): string {
  const lower = raw.toLowerCase();
  return lower.startsWith("svg:") ? lower.slice(4) : lower;
}

const TAG = /<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const CLOSE = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
const ENTITY_HEAD = /<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(["'])/y;

/**
 * The literal entities a DOCTYPE's internal subset declares, read by a
 * forward scan (each value ends at its own closing quote). Null when a value
 * never closes.
 */
function readEntities(subset: string, into: Map<string, string>): boolean {
  for (let at = subset.indexOf("<!ENTITY"); at >= 0; at = subset.indexOf("<!ENTITY", at)) {
    ENTITY_HEAD.lastIndex = at;
    const head = ENTITY_HEAD.exec(subset);
    if (!head) { at += 8; continue; }
    const close = subset.indexOf(head[2]!, ENTITY_HEAD.lastIndex);
    if (close < 0) return false;
    let after = close + 1;
    while (after < subset.length && /\s/.test(subset[after]!)) after++;
    if (subset[after] === ">") into.set(head[1]!, subset.slice(ENTITY_HEAD.lastIndex, close));
    at = close + 1;
  }
  return true;
}

/**
 * Read an SVG document into a tree, yielding the event loop every
 * `SLICE_MS`. Null when the markup is not well formed enough to trust, or
 * too large. Only what later stages read is kept: elements, attributes, text.
 */
export async function parseSvg(source: string, signal?: AbortSignal): Promise<Element | null> {
  if (source.length > SVG_MAX_BYTES) return null;
  const entities = new Map<string, string>();
  // Entities may grow the file to at most twice its size, and never past 2 MB.
  const expansion: Expansion = { left: Math.min(source.length, SVG_MAX_BYTES - source.length) };
  const root: Element = { name: "#document", attrs: {}, children: [] };
  const stack: Element[] = [root];
  let nodes = 0;
  let i = 0;
  let sliceStart = performance.now();
  while (i < source.length) {
    if (performance.now() - sliceStart > SLICE_MS) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (signal?.aborted) return null;
      sliceStart = performance.now();
    }
    const lt = source.indexOf("<", i);
    const parent = stack[stack.length - 1]!;
    if (lt < 0 || lt > i) {
      const text = decodeEntities(source.slice(i, lt < 0 ? source.length : lt), entities, expansion);
      if (text === null) return null;
      parent.children.push(text);
      if (lt < 0) break;
      i = lt;
    }
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end < 0) return null;
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      if (end < 0) return null;
      parent.children.push(source.slice(i + 9, end));
      i = end + 3;
    } else if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2);
      if (end < 0) return null;
      i = end + 2;
    } else if (source.startsWith("<!DOCTYPE", i) || source.startsWith("<!doctype", i)) {
      // The internal subset may declare entities (Illustrator's `&ns_svg;`); keep the literal ones.
      const open = source.indexOf("[", i);
      const close = source.indexOf(">", i);
      let end = close;
      if (open >= 0 && open < close) {
        const subsetEnd = source.indexOf("]", open);
        if (subsetEnd < 0) return null;
        if (!readEntities(source.slice(open + 1, subsetEnd), entities)) return null;
        end = source.indexOf(">", subsetEnd);
      }
      if (end < 0) return null;
      i = end + 1;
    } else if (source.startsWith("</", i)) {
      CLOSE.lastIndex = i;
      const m = CLOSE.exec(source);
      if (!m) return null;
      // A close tag must close the open element; anything else is malformed.
      if (stack.length < 2 || stack[stack.length - 1]!.name !== localName(m[1]!)) return null;
      stack.pop();
      i = CLOSE.lastIndex;
    } else {
      TAG.lastIndex = i;
      const m = TAG.exec(source);
      if (!m) return null;
      const attrs: Record<string, string> = {};
      for (const a of m[2]!.matchAll(ATTR)) {
        const value = decodeEntities(a[2] ?? a[3] ?? "", entities, expansion);
        if (value === null) return null;
        attrs[a[1]!.toLowerCase()] = value;
      }
      const element: Element = { name: localName(m[1]!), attrs, children: [] };
      if (++nodes > MAX_NODES) return null;
      parent.children.push(element);
      if (!m[3]) {
        if (stack.length > MAX_DEPTH) return null;
        stack.push(element);
      }
      i = TAG.lastIndex;
    }
  }
  if (stack.length !== 1) return null;
  return root.children.find((c): c is Element => typeof c !== "string" && c.name === "svg") ?? null;
}

// ---------------------------------------------------------------------------
// Styles

type Style = Record<string, string>;

/** Simple stylesheet rules: `.class`, `#id`, element names, and `element.class`; anything else is ignored. */
interface Rule { tag: string | null; cls: string | null; id: string | null; decls: Style; specificity: number }

function parseDeclarations(text: string): Style {
  const out: Style = {};
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const key = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).replace(/!important/i, "").trim();
    if (key && value && value.length <= MAX_STYLE_VALUE) out[key] = value;
  }
  return out;
}

/** CSS with its comments taken out, by a forward scan; an unclosed comment runs to the end, as in CSS. */
function stripComments(css: string): string {
  let out = "";
  for (let at = 0; at < css.length;) {
    const open = css.indexOf("/*", at);
    if (open < 0) return out + css.slice(at);
    out += css.slice(at, open);
    const close = css.indexOf("*/", open + 2);
    if (close < 0) return out;
    at = close + 2;
  }
  return out;
}

/**
 * Each `selector { declarations }` with no braces inside, read by a forward
 * scan from one `}` to the next: the declarations follow the segment's last
 * `{`, the selector is the text before it back to the previous `{` or `@`.
 * Linear in the sheet, whatever it holds.
 */
function parseStylesheet(css: string): Rule[] {
  const rules: Rule[] = [];
  const clean = stripComments(css);
  for (let from = 0, close = clean.indexOf("}"); close >= 0; from = close + 1, close = clean.indexOf("}", from)) {
    const segment = clean.slice(from, close);
    const open = segment.lastIndexOf("{");
    if (open < 0) continue;
    const before = segment.slice(0, open);
    const selectors = before.slice(Math.max(before.lastIndexOf("{"), before.lastIndexOf("@")) + 1);
    if (!selectors) continue;
    const decls = parseDeclarations(segment.slice(open + 1));
    for (const raw of selectors.split(",")) {
      const selector = raw.trim();
      const simple = selector.match(/^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/);
      if (!simple || !(simple[1] || simple[2] || simple[3])) continue;
      const tag = simple[1]?.toLowerCase() ?? null;
      const cls = simple[2] ?? null;
      const id = simple[3] ?? null;
      rules.push({ tag, cls, id, decls, specificity: (id ? 100 : 0) + (cls ? 10 : 0) + (tag ? 1 : 0) });
    }
  }
  return rules.map((rule, order) => ({ rule, order })).sort((a, b) => a.rule.specificity - b.rule.specificity || a.order - b.order).map((x) => x.rule);
}

const STYLE_KEYS = ["font-size", "font-family", "font-weight", "font-stretch", "font", "text-anchor", "display", "visibility", "opacity", "fill-opacity", "letter-spacing", "dominant-baseline", "alignment-baseline", "writing-mode"] as const;

/**
 * Own declared style of an element: presentation attributes, then the
 * stylesheet, then `style=""` (SVG's precedence). A `transform` here comes
 * only from CSS (the attribute is read on its own), and marks the element as
 * one this reader cannot place.
 */
function ownStyle(element: Element, rules: readonly Rule[]): Style {
  const style: Style = {};
  for (const key of STYLE_KEYS) if (element.attrs[key] !== undefined && element.attrs[key]!.length <= MAX_STYLE_VALUE) style[key] = element.attrs[key]!;
  const classes = (element.attrs.class ?? "").split(/\s+/).filter(Boolean);
  for (const rule of rules) {
    if (rule.tag && rule.tag !== element.name) continue;
    if (rule.cls && !classes.includes(rule.cls)) continue;
    if (rule.id && rule.id !== element.attrs.id) continue;
    Object.assign(style, rule.decls);
  }
  if (element.attrs.style) Object.assign(style, parseDeclarations(element.attrs.style));
  return style;
}

const FONT_KEYWORDS: Record<string, number> = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32 };

/** A length in px for font sizes; `em` and `%` are relative to the parent's size. Null when unreadable. */
function fontSizePx(raw: string | undefined, parent: number): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (FONT_KEYWORDS[value]) return FONT_KEYWORDS[value]!;
  if (value === "smaller") return parent / 1.2;
  if (value === "larger") return parent * 1.2;
  const m = value.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "px";
  const factor = unit === "px" ? 1 : unit === "pt" ? 4 / 3 : unit === "pc" ? 16 : unit === "mm" ? 96 / 25.4 : unit === "cm" ? 96 / 2.54 : unit === "in" ? 96 : unit === "em" ? parent : unit === "ex" ? parent / 2 : parent / 100;
  const px = n * factor;
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** Inherited text properties at an element. */
interface TextState {
  fontSize: number;
  family: string;
  bold: boolean;
  narrow: boolean;
  anchor: "start" | "middle" | "end";
  letterSpacing: number;
  baseline: string;
  hidden: boolean;
  vertical: boolean;
}

function inherit(parent: TextState, style: Style): TextState {
  const next = { ...parent };
  // The `font` shorthand: "[style] [weight] size[/line-height] family".
  if (style.font) {
    const m = style.font.match(/(?:^|\s)((?:\d+\.?\d*|\.\d+)(?:px|pt|pc|mm|cm|in|em|ex|%)?)(?:\/\S+)?\s+(.+)$/i);
    if (m) {
      next.fontSize = fontSizePx(m[1], parent.fontSize) ?? next.fontSize;
      next.family = m[2]!.toLowerCase();
    }
    if (/\b(bold|bolder|[6-9]00)\b/i.test(style.font)) next.bold = true;
  }
  const size = fontSizePx(style["font-size"], parent.fontSize);
  if (size) next.fontSize = size;
  if (style["font-family"]) next.family = style["font-family"].toLowerCase();
  if (style["font-weight"]) next.bold = /^(bold|bolder|[6-9]00)$/i.test(style["font-weight"].trim());
  if (style["font-stretch"]) next.narrow = /condensed|narrow/i.test(style["font-stretch"]);
  if (/narrow|condensed/.test(next.family)) next.narrow = true;
  const anchor = style["text-anchor"]?.trim().toLowerCase();
  if (anchor === "start" || anchor === "middle" || anchor === "end") next.anchor = anchor;
  if (style["letter-spacing"]) next.letterSpacing = style["letter-spacing"].trim() === "normal" ? 0 : fontSizePx(style["letter-spacing"], next.fontSize) ?? (Number.parseFloat(style["letter-spacing"]) || 0);
  const baseline = style["dominant-baseline"] ?? style["alignment-baseline"];
  if (baseline) next.baseline = baseline.trim().toLowerCase();
  if (style.display?.trim() === "none" || style.visibility?.trim() === "hidden" || style.visibility?.trim() === "collapse") next.hidden = true;
  if (style.opacity !== undefined && Number(style.opacity) <= 0.05) next.hidden = true;
  if (style["fill-opacity"] !== undefined && Number(style["fill-opacity"]) <= 0.05) next.hidden = true;
  if (style["writing-mode"] && /^(tb|vertical)/i.test(style["writing-mode"].trim())) next.vertical = true;
  return next;
}

// ---------------------------------------------------------------------------
// Geometry

/** `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

/** Parse a `transform` list; null when it holds something unreadable. */
export function parseTransform(raw: string | undefined): Matrix | null {
  if (!raw || !raw.trim()) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /\s*,?\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gy;
  let consumed = 0;
  for (let hit = re.exec(raw); hit; hit = re.exec(raw)) {
    consumed = re.lastIndex;
    const v = hit[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (!v.every(Number.isFinite)) return null;
    let t: Matrix;
    switch (hit[1]) {
      case "matrix": if (v.length !== 6) return null; t = v as Matrix; break;
      case "translate": t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]; break;
      case "scale": t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const r: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        t = v.length >= 3 ? multiply(multiply([1, 0, 0, 1, v[1]!, v[2]!], r), [1, 0, 0, 1, -v[1]!, -v[2]!]) : r;
        break;
      }
      case "skewX": t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      default: t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = multiply(m, t);
  }
  return raw.slice(consumed).trim() ? null : m;
}

function numbers(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw.trim().split(/[\s,]+/).filter(Boolean).map((v) => Number.parseFloat(v)).filter(Number.isFinite);
}

/** Root size in px from a width/height attribute; null for percentages or nothing. */
function rootLength(raw: string | undefined): number | null {
  if (!raw || raw.trim().endsWith("%")) return null;
  return fontSizePx(raw, 16);
}

/**
 * The map from root user units onto plan px: the root viewBox fitted into
 * the root viewport per `preserveAspectRatio`, and the viewport scaled onto
 * the plan. Commons sizes a thumbnail from the root's width and height (or
 * the viewBox when they are missing or relative), and the plan is that
 * thumbnail fitted; a plan whose aspect differs from that size means the
 * mapping is not the one the raster used, so nothing is located.
 */
export function rootToPlan(svg: { attrs: Record<string, string> }, plan: { width: number; height: number }): Matrix | null {
  const vb = numbers(svg.attrs.viewbox);
  const viewBox = vb.length === 4 && vb[2]! > 0 && vb[3]! > 0 ? { x: vb[0]!, y: vb[1]!, w: vb[2]!, h: vb[3]! } : null;
  let vw = rootLength(svg.attrs.width);
  let vh = rootLength(svg.attrs.height);
  if (viewBox) {
    if (vw === null && vh === null) { vw = viewBox.w; vh = viewBox.h; }
    else if (vw === null) vw = (vh! * viewBox.w) / viewBox.h;
    else if (vh === null) vh = (vw * viewBox.h) / viewBox.w;
  }
  if (!vw || !vh) return null;
  if (Math.abs(vw / vh / (plan.width / plan.height) - 1) > ASPECT_TOLERANCE) return null;
  const toPlan: Matrix = [plan.width / vw, 0, 0, plan.height / vh, 0, 0];
  if (!viewBox) return toPlan;
  const par = (svg.attrs.preserveaspectratio ?? "xMidYMid meet").trim().split(/\s+/);
  let sx = vw / viewBox.w;
  let sy = vh / viewBox.h;
  let tx = 0;
  let ty = 0;
  if (par[0] !== "none") {
    const s = par[1] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
    const align = par[0] ?? "xMidYMid";
    const fx = /xMid/i.test(align) ? 0.5 : /xMax/i.test(align) ? 1 : 0;
    const fy = /YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0;
    tx = (vw - viewBox.w * s) * fx;
    ty = (vh - viewBox.h * s) * fy;
  }
  return multiply(toPlan, [sx, 0, 0, sy, tx - viewBox.x * sx, ty - viewBox.y * sy]);
}

// Helvetica advance widths, 1/1000 em, for ASCII 32..126 (Adobe AFM; Liberation Sans and Arial match them).
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/**
 * How wide a family sets against Helvetica. Commons renders Arial and
 * Helvetica with Liberation Sans (Helvetica's widths); `sans`, `sans-serif`,
 * DejaVu, Vera, Verdana and any family it does not have with DejaVu Sans,
 * about a tenth wider; Times-like faces with Liberation Serif, a tenth narrower.
 */
function familyFactor(family: string): number {
  for (const raw of family.split(",")) {
    const name = raw.trim().replace(/^['"]|['"]$/g, "");
    if (/^(arial|helvetica|liberation sans|freesans|nimbus sans|arimo)\b/.test(name)) return 1;
    if (/^(times|liberation serif|nimbus roman|tinos|georgia|cambria|garamond)\b/.test(name)) return 0.9;
    if (/^(dejavu serif|bitstream vera serif)\b/.test(name)) return 1.12;
    if (/^(serif)$/.test(name)) return 1.12;
  }
  return 1.1;
}

function charWidthEm(ch: string, state: TextState): number {
  if (/mono|courier|consol/.test(state.family)) return 0.6;
  const code = ch.codePointAt(0)!;
  let em = code >= 32 && code <= 126 ? HELVETICA[code - 32]! / 1000 : code === 0xa0 ? 0.278 : 0.6;
  em *= familyFactor(state.family);
  if (state.bold) em *= 1.07;
  if (state.narrow) em *= 0.82;
  return em;
}

function textWidth(text: string, state: TextState): number {
  let total = 0;
  for (const ch of text) total += charWidthEm(ch, state) * state.fontSize + state.letterSpacing;
  return total;
}

/** Ascent and descent of the box around a run, as shares of the font size from the baseline. */
const ASCENT = 0.76;
const DESCENT = 0.22;

function baselineShift(state: TextState): number {
  switch (state.baseline) {
    case "middle": case "central": return 0.35 * state.fontSize;
    case "hanging": case "text-before-edge": case "before-edge": return 0.8 * state.fontSize;
    case "text-after-edge": case "after-edge": case "ideographic": return -0.2 * state.fontSize;
    default: return 0;
  }
}

/** One run of characters in a chunk, in the text element's own coordinates. */
interface Run { text: string; state: TextState; x: number; y: number; width: number; perGlyphRight: number | null }

/** One anchored chunk (a line as drawn): runs laid out from one absolute position. */
interface Chunk { runs: Run[]; anchor: TextState["anchor"]; ctm: Matrix }

function isConditionalFalse(element: Element): boolean {
  if (element.attrs.requiredextensions !== undefined && element.attrs.requiredextensions.trim() !== "") return true;
  const lang = element.attrs.systemlanguage;
  if (lang === undefined) return false;
  return !lang.split(",").map((s) => s.trim().toLowerCase()).some((code) => code === "en" || code.startsWith("en-"));
}

/**
 * Lay out one `<text>` element into chunks. Null when it holds something
 * this cannot place (text on a path, vertical writing).
 */
function layoutText(text: Element, base: TextState, ctm: Matrix, rules: readonly Rule[]): Chunk[] | null {
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;
  let cx = 0;
  let cy = 0;
  let unreadable = false;
  const visit = (element: Element, state: TextState, isRoot: boolean) => {
    if (unreadable) return;
    if (element.name === "textpath" || element.name === "tref") { unreadable = true; return; }
    if (!isRoot && element.name !== "tspan" && element.name !== "a") return;
    if (state.vertical) { unreadable = true; return; }
    const xs = numbers(element.attrs.x);
    const ys = numbers(element.attrs.y);
    const dxs = numbers(element.attrs.dx);
    const dys = numbers(element.attrs.dy);
    if (xs.length || ys.length) {
      if (xs.length) cx = xs[0]!;
      if (ys.length) cy = ys[0]!;
      current = null;
    }
    cx += dxs[0] ?? 0;
    cy += dys[0] ?? 0;
    for (const child of element.children) {
      if (typeof child === "string") {
        const content = child.replace(/[\r\n]+/g, "").replace(/\t/g, " ");
        if (!content) continue;
        if (!current) {
          current = { runs: [], anchor: state.anchor, ctm };
          chunks.push(current);
        }
        // Per glyph x lists (Illustrator) place each character; the last one bounds the run.
        const glyphs = [...content];
        const perGlyphRight = xs.length > 1 && xs.length >= glyphs.length && element.children.length === 1
          ? xs[glyphs.length - 1]! + charWidthEm(glyphs[glyphs.length - 1]!, state) * state.fontSize
          : null;
        const width = perGlyphRight !== null ? perGlyphRight - cx : textWidth(content, state);
        current.runs.push({ text: content, state, x: cx, y: cy + baselineShift(state), width, perGlyphRight });
        cx += width;
      } else {
        if (isConditionalFalse(child)) continue;
        const style = ownStyle(child, rules);
        if (cssTransformed(style)) { unreadable = true; return; }
        const childState = inherit(state, style);
        if (childState.hidden) continue;
        visit(child, childState, false);
      }
    }
  };
  visit(text, base, true);
  return unreadable ? null : chunks;
}

/** A CSS `transform` (in `style=""` or a stylesheet rule) this reader does not map. */
function cssTransformed(style: Style): boolean {
  const value = style.transform?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "none";
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function rectThrough(m: Matrix, left: number, top: number, right: number, bottom: number): PicturePlacement {
  const corners = [apply(m, left, top), apply(m, right, top), apply(m, left, bottom), apply(m, right, bottom)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * A chunk as one printed line of words in plan px. Whitespace collapses as
 * SVG's default `xml:space` does; each word's box comes from the advance of
 * the characters before it, so a label that is part of a longer line can be
 * boxed alone.
 */
function chunkToLine(chunk: Chunk, toPlan: Matrix, group: number): TextLine | null {
  const m = multiply(toPlan, chunk.ctm);
  // Rotated, skewed or mirrored text is left out: its box would not be the text's.
  if (m[0] <= 0 || m[3] <= 0 || Math.abs(m[1]) > MAX_TILT * m[0] || Math.abs(m[2]) > MAX_TILT * m[3]) return null;
  const glyphs: Array<{ ch: string; left: number; right: number; run: Run }> = [];
  for (const run of chunk.runs) {
    let x = run.x;
    const chars = [...run.text];
    const scale = run.perGlyphRight !== null && chars.length > 0 ? run.width / Math.max(1e-6, textWidth(run.text, run.state)) : 1;
    for (const ch of chars) {
      const w = (charWidthEm(ch, run.state) * run.state.fontSize + run.state.letterSpacing) * scale;
      glyphs.push({ ch, left: x, right: x + w, run });
      x += w;
    }
  }
  // Collapse spaces: leading and trailing dropped, runs of spaces count once.
  while (glyphs.length && /\s/.test(glyphs[0]!.ch)) glyphs.shift();
  while (glyphs.length && /\s/.test(glyphs[glyphs.length - 1]!.ch)) glyphs.pop();
  if (!glyphs.length) return null;
  const start = glyphs[0]!.left;
  const end = glyphs[glyphs.length - 1]!.right;
  const shift = chunk.anchor === "middle" ? -(end - start) / 2 : chunk.anchor === "end" ? -(end - start) : 0;
  const words: TextWord[] = [];
  let word: typeof glyphs = [];
  const flush = () => {
    if (!word.length) return;
    const left = word[0]!.left + shift - start + chunk.runs[0]!.x;
    const right = word[word.length - 1]!.right + shift - start + chunk.runs[0]!.x;
    const top = Math.min(...word.map((g) => g.run.y - ASCENT * g.run.state.fontSize));
    const bottom = Math.max(...word.map((g) => g.run.y + DESCENT * g.run.state.fontSize));
    words.push({ text: word.map((g) => g.ch).join(""), box: rectThrough(m, left, top, right, bottom) });
    word = [];
  };
  for (const g of glyphs) {
    if (/\s/.test(g.ch)) flush();
    else word.push(g);
  }
  flush();
  if (!words.length) return null;
  return { words, group, source: "svg" };
}

/** What the SVG says is printed, in plan px. */
export interface SvgTextResult {
  lines: TextLine[];
  /** `<text>` elements read. */
  texts: number;
  /** `<text>` elements left out (rotated, on a path, unreadable). */
  skipped: number;
  /**
   * What the left out text says. It is printed but cannot be boxed, so a
   * name it contains is printed somewhere the locator cannot see, and is
   * not pointable.
   */
  unplaced: string[];
}

/**
 * Every rendered text line in an SVG, boxed in plan px, or null when the file
 * cannot be read or its size does not match the plan. An SVG with no live
 * text (labels converted to outlines) gives an empty list.
 */
export async function readSvgText(source: string, plan: { width: number; height: number }, signal?: AbortSignal): Promise<SvgTextResult | null> {
  const svg = await parseSvg(source, signal);
  if (!svg) return null;
  const toPlan = rootToPlan(svg, plan);
  if (!toPlan) return null;
  // A root transform this cannot read moves every label somewhere unknown.
  const rootTransform = parseTransform(svg.attrs.transform);
  if (!rootTransform) return null;
  const sheets: string[] = [];
  let styleChars = 0;
  const collectStyles = (element: Element) => {
    for (const child of element.children) {
      if (typeof child === "string") continue;
      if (child.name === "style") {
        const css = child.children.filter((c): c is string => typeof c === "string").join("");
        styleChars += css.length;
        sheets.push(css);
      } else collectStyles(child);
    }
  };
  collectStyles(svg);
  if (styleChars > MAX_STYLE_CHARS) return null;
  const rules = sheets.flatMap(parseStylesheet);
  if (rules.length > MAX_STYLE_RULES) return null;
  // Each sheet comes back sorted; a stable sort keeps document order between sheets.
  const sorted = [...rules].sort((a, b) => a.specificity - b.specificity);
  const result: SvgTextResult = { lines: [], texts: 0, skipped: 0, unplaced: [] };
  let textChars = 0;
  /** Past a ceiling the whole file is declined, so a hostile one costs a bounded amount of work. */
  const tally = (chars: number) => {
    textChars += chars;
    if (textChars > SVG_MAX_TEXT_CHARS || result.texts + result.unplaced.length > SVG_MAX_TEXTS || result.lines.length > SVG_MAX_TEXTS) throw new Declined();
  };
  // One group used a thousand times is read once.
  const printedBy = new WeakMap<Element, string[]>();
  const leaveOut = (element: Element) => {
    const texts = printedBy.get(element) ?? textsOf(element);
    printedBy.set(element, texts);
    result.skipped += texts.length;
    result.unplaced.push(...texts);
    tally(texts.reduce((n, t) => n + t.length, 0));
  };
  let ids: Map<string, Element> | null = null;
  const byId = (id: string) => {
    if (!ids) {
      ids = new Map();
      const index = (element: Element) => {
        for (const c of element.children) if (typeof c !== "string") { if (c.attrs.id) ids!.set(c.attrs.id, c); index(c); }
      };
      index(svg);
    }
    return ids.get(id);
  };
  const base: TextState = { fontSize: 16, family: "sans-serif", bold: false, narrow: false, anchor: "start", letterSpacing: 0, baseline: "auto", hidden: false, vertical: false };
  let group = 0;
  let sliceStart = performance.now();
  const walk = async (element: Element, state: TextState, ctm: Matrix): Promise<void> => {
    const isSwitch = element.name === "switch";
    let switched = false;
    for (const child of element.children) {
      if (typeof child === "string") continue;
      if (performance.now() - sliceStart > SLICE_MS) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (signal?.aborted) throw new Declined();
        sliceStart = performance.now();
      }
      if (NON_RENDERED.has(child.name) || child.name.includes(":")) continue;
      if (isConditionalFalse(child)) continue;
      // A switch renders its first child that passes (rsvg, English).
      if (isSwitch) { if (switched) continue; switched = true; }
      const style = ownStyle(child, sorted);
      const childState = inherit(state, style);
      if (childState.hidden) continue;
      // A CSS transform moves the text somewhere this does not map: printed, not boxed.
      if (cssTransformed(style)) { leaveOut(child); continue; }
      const own = parseTransform(child.attrs.transform);
      // Text in a nested viewport, or reached through `<use>`, is left out rather than mapped twice.
      if (child.name === "svg") { leaveOut(child); continue; }
      if (child.name === "use") {
        const href = (child.attrs.href ?? child.attrs["xlink:href"] ?? "").trim();
        const target = href.startsWith("#") ? byId(href.slice(1)) : undefined;
        if (target) leaveOut(target);
        continue;
      }
      if (child.name === "text") {
        result.texts++;
        const length = textContent(child).length;
        // Too long to be a label: printed, so it still counts as a copy of any name it holds.
        if (length > MAX_LABEL_CHARS) { leaveOut(child); continue; }
        tally(length);
        const chunks = own ? layoutText(child, childState, multiply(ctm, own), sorted) : null;
        if (!chunks) { leaveOut(child); continue; }
        group++;
        let kept = 0;
        for (const chunk of chunks) {
          const line = chunkToLine(chunk, toPlan, group);
          if (line) { result.lines.push(line); kept++; tally(0); continue; }
          const words = chunk.runs.map((run) => run.text).join("").replace(/\s+/g, " ").trim();
          if (words) result.unplaced.push(words);
        }
        if (chunks.length && !kept) result.skipped++;
        continue;
      }
      if (!own) { leaveOut(child); continue; }
      await walk(child, childState, multiply(ctm, own));
    }
  };
  const rootStyle = ownStyle(svg, sorted);
  if (cssTransformed(rootStyle)) return null;
  try {
    await walk(svg, inherit(base, rootStyle), rootTransform);
    // Text in a pattern, marker or symbol is printed wherever that is used: a copy of any name it holds, though it is never boxed.
    for (const element of definitions(svg)) leaveOut(element);
  } catch (error) {
    if (error instanceof Declined) return null;
    throw error;
  }
  return result;
}

/** A ceiling was hit, or the caller's budget ran out: the file gives no text. */
class Declined extends Error {}

const REPEATED = new Set(["pattern", "marker", "symbol"]);

/** Every pattern, marker and symbol, wherever it sits (usually in `<defs>`), outermost only. */
function definitions(root: Element): Element[] {
  const out: Element[] = [];
  const visit = (element: Element) => {
    for (const c of element.children) {
      if (typeof c === "string") continue;
      if (REPEATED.has(c.name)) out.push(c);
      else visit(c);
    }
  };
  visit(root);
  return out;
}

function textContent(element: Element): string {
  return element.children.map((c) => (typeof c === "string" ? c : textContent(c))).join("");
}

/** What an element prints: one string per `<text>`, the element itself included. */
function textsOf(element: Element): string[] {
  if (element.name === "text") {
    const words = textContent(element).replace(/\s+/g, " ").trim();
    return words ? [words] : [];
  }
  return textsIn(element);
}

/** The words of every `<text>` under an element, one string per text. */
function textsIn(element: Element): string[] {
  const out: string[] = [];
  for (const c of element.children) {
    if (typeof c === "string") continue;
    if (c.name === "text") out.push(...textsOf(c));
    else out.push(...textsIn(c));
  }
  return out;
}
