import glyphData from "./caveat-glyphData.json";
import { scriptChemicalFormulas } from "./chemistryNotation";

interface TegakiGlyphData {
  w: number;
  t: number;
  s: TegakiStroke[];
}

interface TegakiStroke {
  p: [number, number, number][];
  d: number;
  a: number;
  r?: number;
}

const UNITS_PER_EM = 1000;
const ASCENDER = 960;

const glyphDataRecord = glyphData as unknown as Record<string, TegakiGlyphData>;

/** Greek/math symbols missing from Caveat glyph data — rendered as synthetic strokes. */
const SYNTHETIC_GREEK_CHARS = new Set([
  "θ", "Θ", "μ", "π",
  "φ", "Φ", "ω", "Ω", "α", "Α", "β", "Β", "γ", "Γ", "δ", "Δ",
  "λ", "Λ", "ρ", "Ρ", "σ", "Σ", "τ", "Τ", "ε", "η", "κ", "ν", "ξ", "ψ", "χ", "ζ", "υ", "ι", "ο",
]);

const GREEK_LATIN_FALLBACK: Record<string, string> = {
  φ: "o", Φ: "O", ω: "w", Ω: "W", α: "a", Α: "A", β: "b", Β: "B",
  γ: "y", Γ: "r", δ: "d", λ: "l", Λ: "L", ρ: "p", Ρ: "P", σ: "o", Σ: "E",
  τ: "t", Τ: "T", ε: "e", η: "n", κ: "k", ν: "v", ξ: "x", ψ: "y", χ: "x",
  ζ: "z", υ: "u", ι: "i", ο: "o",
};

/**
 * Math operators / relations that Caveat has no glyph for. Each is drawn as
 * synthetic pen strokes so the board can write real calculus and algebra
 * (previously every one of these rendered as a blank gap).
 */
const MATH_GLYPH_UNITS: Record<string, number> = {
  "→": 560, "←": 560, "↔": 620, "⇒": 600, "⇐": 600, "⇌": 600,
  "±": 520, "∓": 520, "×": 460, "÷": 460, "·": 240, "∙": 240,
  "≤": 520, "≥": 520, "≈": 520, "≠": 520, "≡": 520, "∝": 520,
  "∞": 620, "√": 520, "∫": 380, "∮": 400, "∑": 560, "∏": 560,
  "∂": 440, "∇": 460, "∴": 420, "∵": 420, "°": 300, "′": 200, "″": 320,
  "∈": 460, "∉": 460, "⊂": 460, "⊆": 460, "⊃": 460, "⊇": 460,
  "∪": 460, "∩": 460, "∅": 460, "∠": 480, "⊥": 460, "∥": 320,
  "∀": 460, "∃": 440, "⋅": 240, "↛": 560,
};

const SYNTHETIC_MATH_CHARS = new Set(Object.keys(MATH_GLYPH_UNITS));

/**
 * Unicode presentation forms the model sometimes emits (½, x², v₁, 2×10⁵)
 * have no Caveat glyph and no synthetic stroke, so they fall back to a plain
 * Konva text node in a different font — the "1/2 in a normal font" bug.
 * Normalizing them to ASCII with ^ / _ / a/b keeps everything hand-drawn.
 */
const VULGAR_FRACTIONS: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6",
  "⅐": "1/7", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅑": "1/9", "⅒": "1/10",
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
  "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁿ": "n", "ⁱ": "i",
};

const SUBSCRIPT_MAP: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5",
  "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
};

/**
 * Rewrites Unicode fractions, LaTeX-ish limits, and super/subscript runs into
 * stroke-renderable tokens (^(...) / _(...) / a/b) so they draw in the
 * handwriting font instead of falling back to a browser font.
 *
 * Models often emit `∫_{-2}^{2}`; braces must become paren script groups or
 * the board literally draws "{" and "}".
 */
export function normalizeStrokeText(text: string): string {
  // Do not use \b after the command name: LaTeX often continues with "_" / "^".
  let source = scriptChemicalFormulas(text)
    .replace(/\\int(?![A-Za-z])/g, "∫")
    .replace(/\\sum(?![A-Za-z])/g, "∑")
    .replace(/\\prod(?![A-Za-z])/g, "∏")
    .replace(/\\infty(?![A-Za-z])/g, "∞")
    .replace(/\\partial(?![A-Za-z])/g, "∂")
    .replace(/\\sqrt(?![A-Za-z])/g, "√")
    .replace(/\\pm(?![A-Za-z])/g, "±")
    .replace(/\\times(?![A-Za-z])/g, "×")
    .replace(/\\cdot(?![A-Za-z])/g, "·")
    .replace(/\\leq(?![A-Za-z])/g, "≤")
    .replace(/\\geq(?![A-Za-z])/g, "≥")
    .replace(/\\neq(?![A-Za-z])/g, "≠")
    .replace(/\\approx(?![A-Za-z])/g, "≈")
    .replace(/\\pi(?![A-Za-z])/g, "π")
    .replace(/\\theta(?![A-Za-z])/g, "θ")
    .replace(/(?<![A-Za-z\\])pi(?![A-Za-z])/gi, "π");

  // Models sometimes drop "_" / "^" and emit `∫{-2}{2}` or spaced `∫ { -2 } { 2 }`.
  source = source.replace(
    /([∫∮∑∏])\s*_\s*\{\s*([^}]*)\s*\}\s*\^\s*\{\s*([^}]*)\s*\}/g,
    "$1_($2)^($3)",
  );
  source = source.replace(
    /([∫∮∑∏])\s*\{\s*([^}]*)\s*\}\s*\^\s*\{\s*([^}]*)\s*\}/g,
    "$1_($2)^($3)",
  );
  source = source.replace(
    /([∫∮∑∏])\s*\{\s*([^}]*)\s*\}\s*\{\s*([^}]*)\s*\}/g,
    "$1_($2)^($3)",
  );

  // Convert LaTeX `_{...}` / `^{...}` (including nested braces) to `_(...)` / `^(...)`.
  source = rewriteLatexScriptBraces(source);

  // Allow spaces between script markers and groups: `∫_ (-2) ^ (2)`.
  source = source.replace(/([_^])\s+\(/g, "$1(");

  let out = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    const fraction = VULGAR_FRACTIONS[ch];
    if (fraction !== undefined) {
      out += fraction;
      i++;
      continue;
    }

    if (SUPERSCRIPT_MAP[ch] !== undefined) {
      let run = "";
      while (i < source.length && SUPERSCRIPT_MAP[source[i]] !== undefined) {
        run += SUPERSCRIPT_MAP[source[i]];
        i++;
      }
      out += run.length > 1 ? `^(${run})` : `^${run}`;
      continue;
    }

    if (SUBSCRIPT_MAP[ch] !== undefined) {
      let run = "";
      while (i < source.length && SUBSCRIPT_MAP[source[i]] !== undefined) {
        run += SUBSCRIPT_MAP[source[i]];
        i++;
      }
      out += run.length > 1 ? `_(${run})` : `_${run}`;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function rewriteLatexScriptBraces(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const marker = text[i];
    if ((marker === "^" || marker === "_") && text[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      let content = "";
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
        content += ch;
        j++;
      }
      // Nested LaTeX scripts inside the group still need rewriting.
      out += `${marker}(${rewriteLatexScriptBraces(content)})`;
      i = j;
      continue;
    }
    out += marker;
    i++;
  }
  return out;
}

/**
 * The hand's nib.
 *
 * Every stroke width used to be read straight off the glyph data, where the
 * third number of each point is the local thickness of the outline the stroke
 * was skeletonised from. That is not a pen: it made an `M` (72 units) a third
 * heavier than an `e` (54), always, so one word could carry three visibly
 * different ink weights and every instance of a letter carried the same one.
 * Worse, the synthetic Greek and maths glyphs never went through it at all —
 * `strokeWidthPx(fontNibUnits() * 1.08, fontSize)` is 1.5px at every font size the board uses — so
 * a formula mixed 2.2px letters with 1.5px operators.
 *
 * A hand holds one pen. The nib below is the weight of the whole board; the
 * font's own modelling survives only as a fraction of its deviation from it,
 * which keeps a downstroke heavier than a hairline without letting any letter
 * look like it was written with a different marker.
 */
const NIB_EM = 0.052;
/** How much of the font's own stroke modelling survives, 0 = a plotter pen. */
const NIB_MODELLING = 0.35;
/** Nothing is thinner than this, whatever the maths says. */
const NIB_MIN_PX = 1.4;

/** Mean stroke thickness across the whole font, in glyph units. */
let nibUnitsCache: number | null = null;
function fontNibUnits(): number {
  if (nibUnitsCache !== null) return nibUnitsCache;
  let total = 0;
  let count = 0;
  for (const glyph of Object.values(glyphDataRecord)) {
    for (const stroke of glyph.s) {
      for (const point of stroke.p) {
        total += point[2];
        count += 1;
      }
    }
  }
  nibUnitsCache = count > 0 ? total / count : 61;
  return nibUnitsCache;
}

/**
 * The width one stroke is laid down at: the board's nib, leaning `NIB_MODELLING`
 * of the way toward whatever the glyph data asked for.
 */
function strokeWidthPx(pressureUnits: number, fontSize: number): number {
  const nib = fontSize * NIB_EM;
  const modelled = pressureUnits / fontNibUnits();
  const weight = 1 - NIB_MODELLING + NIB_MODELLING * (Number.isFinite(modelled) ? modelled : 1);
  return Math.max(nib * weight, NIB_MIN_PX);
}

/**
 * The painted air a letter leaves before the next one, as a fraction of font
 * size — and how far the advance may move off the font's own to hold it.
 *
 * Caveat's advances are drawn for filled outlines. The board writes the
 * skeletons of those outlines with a ~0.05em nib, so the same advances leave a
 * lot more air than the font ever meant to, and Caveat's own side bearings vary
 * enormously (left 0.25em to -0.07em), so the air between letters inside one
 * word ranged from 0.06em to 0.15em. Uneven air inside a word is what stops it
 * reading as a word: the eye groups by spacing, so letters that are almost as
 * far apart as the space between words dissolve the word into letters.
 *
 * The old rule padded to a minimum and never tightened (`max(fontAdv, …)`),
 * which could only ever make that worse. This one targets one gap and holds the
 * advance inside a band around the font's own, so the rhythm stays Caveat's
 * while the air between letters is even.
 */
const LETTER_GAP_RATIO = 0.055;
const TRACK_MIN = 0.6;
const TRACK_MAX = 1.6;
/**
 * Painted air across a word space. The eye groups by spacing, so this only has
 * to be a clear multiple of the air inside a word; measuring it as painted air
 * rather than as a flat advance is what keeps that multiple constant, whatever
 * the bearings of the letters either side happen to be.
 */
const WORD_GAP_RATIO = 0.23;
/** However the arithmetic works out, a space is still a space. */
const WORD_GAP_MIN_RATIO = 0.02;

interface InkPoint {
  x: number;
  y: number;
  /** Half the painted width at this point. */
  r: number;
}

interface GlyphInk {
  advanceUnits: number;
  inkMin: number;
  inkMax: number;
  /**
   * The letter's painted ink, as points along its own strokes with the nib
   * radius at each. Spacing two letters is then the question a writer actually
   * answers — how close do these two shapes come, in any direction — instead of
   * how far apart their bounding boxes are.
   *
   * Boxes cannot answer it. A `y` sweeps its tail left under its own origin, so
   * its box starts 0.03em before its body does and the letter before it gets
   * pushed clear: that is the "energ y" and "man y" hole in the middle of a
   * word. A Caveat `l` is one slanted stroke whose box is half again wider than
   * its own advance, because the font means the next letter to nest under its
   * lean, which a box forbids.
   */
  points: InkPoint[];
}

/** Glyph units between samples along a stroke. */
const PROFILE_STEP_UNITS = 8;
/**
 * Ascenders and descenders may run closer than bodies do: a hand writes the
 * tail of a `g` under the letter that follows it. Ink this far outside the body
 * band asks for `TAIL_AIR_SHARE` of the gap the body asks for.
 */
const TAIL_AIR_SHARE = 0.45;
const BODY_TOP_UNITS = -540;
const BODY_BOTTOM_UNITS = 40;

/** How much air this bit of ink wants, as a share of the letter gap. */
function airShareAt(y: number): number {
  return y >= BODY_TOP_UNITS && y <= BODY_BOTTOM_UNITS ? 1 : TAIL_AIR_SHARE;
}

const glyphInkCache = new Map<string, GlyphInk>();

function glyphInk(char: string): GlyphInk {
  const cached = glyphInkCache.get(char);
  if (cached) return cached;

  const glyph = glyphDataRecord[char];
  if (glyph) {
    let inkMin = Number.POSITIVE_INFINITY;
    let inkMax = Number.NEGATIVE_INFINITY;
    const points: InkPoint[] = [];

    const mark = (x: number, y: number, radius: number): void => {
      if (x - radius < inkMin) inkMin = x - radius;
      if (x + radius > inkMax) inkMax = x + radius;
      points.push({ x, y, r: radius });
    };

    for (const stroke of glyph.s) {
      const points = stroke.p;
      for (let index = 0; index < points.length; index++) {
        const point = points[index]!;
        mark(point[0], point[1], (point[2] ?? 0) / 2);
        // Walk the segment as well: a long straight stem is two points, and a
        // silhouette sampled only at the ends would leave every band between
        // them empty.
        const next = points[index + 1];
        if (!next) continue;
        const span = Math.hypot(next[0] - point[0], next[1] - point[1]);
        const steps = Math.ceil(span / PROFILE_STEP_UNITS);
        for (let step = 1; step < steps; step++) {
          const t = step / steps;
          mark(
            point[0] + (next[0] - point[0]) * t,
            point[1] + (next[1] - point[1]) * t,
            ((point[2] ?? 0) + ((next[2] ?? 0) - (point[2] ?? 0)) * t) / 2,
          );
        }
      }
    }

    const ink: GlyphInk = {
      advanceUnits: glyph.w,
      inkMin: Number.isFinite(inkMin) ? inkMin : 0,
      inkMax: Number.isFinite(inkMax) ? inkMax : glyph.w,
      points,
    };
    glyphInkCache.set(char, ink);
    return ink;
  }

  const latinBase = GREEK_LATIN_FALLBACK[char];
  if (latinBase && glyphDataRecord[latinBase] && latinBase !== char) {
    const ink = glyphInk(latinBase);
    glyphInkCache.set(char, ink);
    return ink;
  }

  let advanceUnits = 350;
  if (char === "π") advanceUnits = 460;
  else if (char === "Θ" || char === "θ" || char === "φ" || char === "Φ") {
    advanceUnits = glyphDataRecord.o?.w ?? 353;
  } else if (char === "μ") {
    advanceUnits = glyphDataRecord.u?.w ?? 370;
  } else if (char === "Δ") {
    advanceUnits = 420;
  } else if (char === "Ω") {
    advanceUnits = 470;
  } else if (MATH_GLYPH_UNITS[char] !== undefined) {
    advanceUnits = MATH_GLYPH_UNITS[char]!;
  }

  // A synthesised glyph has no stroke table to sample, so it stands in as the
  // outline of its own box across the body: the spacing it gets is its box.
  const boxLeft = advanceUnits * 0.06;
  const boxRight = advanceUnits * 0.94;
  const boxPoints: InkPoint[] = [];
  for (let step = 0; step <= 8; step++) {
    const y = BODY_TOP_UNITS + ((BODY_BOTTOM_UNITS - BODY_TOP_UNITS) * step) / 8;
    boxPoints.push({ x: boxLeft, y, r: 0 }, { x: boxRight, y, r: 0 });
  }
  const ink: GlyphInk = {
    advanceUnits,
    inkMin: boxLeft,
    inkMax: boxRight,
    points: boxPoints,
  };
  glyphInkCache.set(char, ink);
  return ink;
}

const pairAdvanceCache = new Map<string, number>();

/**
 * How far the pen travels from one letter's origin to the next so that the
 * closest the two shapes ever come is `gapUnits` of painted air.
 *
 * For every pair of ink points that could touch, the horizontal offset has to
 * clear a circle of the combined radii plus the air: `dx² + dy² ≥ R²`. The
 * binding pair decides the advance, which is what lets a round letter nest
 * under the lean of an `l` while two straight stems stay apart.
 */
function pairAdvanceUnits(char: string, next: string, gapUnits: number): number {
  const key = `${char}\u0000${next}\u0000${gapUnits}`;
  const cached = pairAdvanceCache.get(key);
  if (cached !== undefined) return cached;

  const current = glyphInk(char);
  const following = glyphInk(next);
  let wanted = Number.NEGATIVE_INFINITY;
  for (const a of current.points) {
    for (const b of following.points) {
      const dy = b.y - a.y;
      // The air each pair wants is set by whichever of the two is body ink.
      const air = gapUnits * Math.max(airShareAt(a.y), airShareAt(b.y));
      const reach = a.r + b.r + air;
      if (Math.abs(dy) >= reach) continue;
      const clear = Math.sqrt(reach * reach - dy * dy);
      const needed = a.x - b.x + clear;
      if (needed > wanted) wanted = needed;
    }
  }

  const advance = Number.isFinite(wanted) ? wanted : current.inkMax + gapUnits;
  pairAdvanceCache.set(key, advance);
  return advance;
}

/**
 * The edges of a letter's body, for measuring a word space between two of them.
 *
 * Bodies rather than boxes, on both sides: a Caveat `l` carries its box a
 * quarter of an em to the right of where the letter reads as ending, and
 * measuring the space from there put a visibly wider gap after every word that
 * happened to end in one.
 */
function bodyLeftUnits(ink: GlyphInk): number {
  let leftmost = Number.POSITIVE_INFINITY;
  for (const point of ink.points) {
    if (airShareAt(point.y) < 1) continue;
    const left = point.x - point.r;
    if (left < leftmost) leftmost = left;
  }
  return Number.isFinite(leftmost) ? leftmost : ink.inkMin;
}

function bodyRightUnits(ink: GlyphInk): number {
  let rightmost = Number.NEGATIVE_INFINITY;
  for (const point of ink.points) {
    if (airShareAt(point.y) < 1) continue;
    const right = point.x + point.r;
    if (right > rightmost) rightmost = right;
  }
  return Number.isFinite(rightmost) ? rightmost : ink.inkMax;
}

function knownStrokeChar(char: string): boolean {
  return (
    Boolean(glyphDataRecord[char]) ||
    SYNTHETIC_GREEK_CHARS.has(char) ||
    SYNTHETIC_MATH_CHARS.has(char)
  );
}

/** How far the cursor moves after `char`, given the next body glyph (or none). */
function pairAdvancePx(
  char: string,
  next: string | null,
  scale: number,
  fontSize: number,
): number {
  if (!knownStrokeChar(char)) {
    return fontSize * 0.5;
  }

  const current = glyphInk(char);
  const fontAdv = current.advanceUnits * scale;
  const gapUnits = LETTER_GAP_RATIO * UNITS_PER_EM;

  // With no next letter — end of a word or of the line — the pen still leaves
  // one letter's worth of air, so the word space below can be measured from a
  // known point rather than from whatever bearing this glyph happens to have.
  const wanted =
    next && knownStrokeChar(next)
      ? pairAdvanceUnits(char, next, gapUnits) * scale
      : (current.inkMax + gapUnits) * scale;

  return Math.min(Math.max(wanted, fontAdv * TRACK_MIN), fontAdv * TRACK_MAX);
}

/**
 * How far the cursor moves across a space, so that the painted air between the
 * two words comes out at `WORD_GAP_RATIO` whatever letters meet across it.
 *
 * It has to be measured from the ink either side, not added as a flat advance:
 * the letter before the space has already left some air of its own, and the
 * letter after it starts at its own bearing, so a flat space put anything from
 * 9px to 16px between two words at the same size. The eye reads word breaks by
 * comparing that air with the air inside a word, so it has to be one number.
 */
function spaceAdvancePx(
  previous: string | null,
  next: string | null,
  scale: number,
  fontSize: number,
): number {
  const trailing =
    previous && knownStrokeChar(previous)
      ? pairAdvancePx(previous, null, scale, fontSize) - bodyRightUnits(glyphInk(previous)) * scale
      : 0;
  const leading = next && knownStrokeChar(next) ? bodyLeftUnits(glyphInk(next)) * scale : 0;
  const wanted = fontSize * WORD_GAP_RATIO - trailing - leading;
  return Math.max(wanted, fontSize * WORD_GAP_MIN_RATIO);
}

function nextPairChar(text: string, from: number): string | null {
  if (from >= text.length) return null;
  const ch = text[from];
  if (ch === " " || ch === "^" || ch === "_" || ch === "{" || ch === "}") {
    return null;
  }
  return ch;
}

/** The last letter written before `from`, skipping spaces and markers. */
function previousBodyChar(text: string, from: number): string | null {
  for (let index = from; index >= 0; index--) {
    const char = text[index];
    if (char === undefined) continue;
    if (char === " " || char === "^" || char === "_" || char === "{" || char === "}") continue;
    return char;
  }
  return null;
}

function nextNonSpace(text: string, from: number): string | null {
  for (let index = from; index < text.length; index++) {
    if (text[index] !== " ") return text[index] ?? null;
  }
  return null;
}

function cloneGlyphStrokes(
  baseChar: string,
  displayChar: string,
  currentX: number,
  baselineY: number,
  topY: number,
  scale: number,
  fontSize: number,
  extraStrokes: StrokePath[] = [],
): { path: CharacterPath; advance: number } | null {
  const baseGlyph = glyphDataRecord[baseChar];
  if (!baseGlyph) {
    return null;
  }

  const glyphWidth = baseGlyph.w * scale;
  const strokes: StrokePath[] = baseGlyph.s.map((s) => {
    const points = s.p;
    const pressures = points.map((p) => p[2]);
    const avgPressure = pressures.reduce((a, b) => a + b, 0) / Math.max(pressures.length, 1);
    const pathData = polylineToSVGPath(points, scale, scale, currentX, baselineY);
    const firstPoint = points[0];
    return {
      pathData,
      startX: currentX + firstPoint[0] * scale,
      startY: baselineY + firstPoint[1] * scale,
      width: strokeWidthPx(avgPressure, fontSize),
      delay: s.d,
      duration: s.a,
      priority: s.r ?? 0,
    };
  });

  strokes.push(...extraStrokes);

  return {
    path: { char: displayChar, strokes, x: currentX, y: topY, width: glyphWidth, fontSize },
    advance: glyphWidth,
  };
}

function syntheticGreekChar(
  char: string,
  currentX: number,
  baselineY: number,
  topY: number,
  scale: number,
  fontSize: number,
): { path: CharacterPath; advance: number } | null {
  if (char === "θ" || char === "Θ") {
    const baseGlyph = glyphDataRecord.o;
    const glyphWidth = (baseGlyph?.w ?? 353) * scale;
    const strokes: StrokePath[] = [];

    if (baseGlyph) {
      for (const s of baseGlyph.s) {
        const points = s.p;
        const pressures = points.map((p) => p[2]);
        const avgPressure = pressures.reduce((a, b) => a + b, 0) / Math.max(pressures.length, 1);
        const pathData = polylineToSVGPath(points, scale, scale, currentX, baselineY);
        const firstPoint = points[0];
        strokes.push({
          pathData,
          startX: currentX + firstPoint[0] * scale,
          startY: baselineY + firstPoint[1] * scale,
          width: strokeWidthPx(avgPressure, fontSize),
          delay: s.d,
          duration: s.a,
          priority: s.r ?? 0,
        });
      }
    }

    // The crossbar goes THROUGH the oval, which is what makes a theta a theta.
    // It used to be pinned at -470, well above the `o` glyph's own top of -341,
    // so every theta on the board rendered as an o wearing a macron — "ō" — and
    // a student reading "ō_i = 45 deg" has no idea they are looking at an angle.
    // Measure the base glyph instead of guessing: the bar sits at its vertical
    // midpoint and spans its real width, so it stays right if the font changes.
    let inkMinX = Number.POSITIVE_INFINITY;
    let inkMaxX = Number.NEGATIVE_INFINITY;
    let inkMinY = Number.POSITIVE_INFINITY;
    let inkMaxY = Number.NEGATIVE_INFINITY;
    if (baseGlyph) {
      for (const s of baseGlyph.s) {
        for (const point of s.p) {
          if (point[0] < inkMinX) inkMinX = point[0];
          if (point[0] > inkMaxX) inkMaxX = point[0];
          if (point[1] < inkMinY) inkMinY = point[1];
          if (point[1] > inkMaxY) inkMaxY = point[1];
        }
      }
    }
    const hasInk = Number.isFinite(inkMinX) && Number.isFinite(inkMinY);
    // A handwritten theta's bar overhangs the oval very slightly on each side.
    const overhang = 6;
    const barY = hasInk
      ? baselineY + ((inkMinY + inkMaxY) / 2) * scale
      : baselineY - 190 * scale;
    const barX1 = hasInk
      ? currentX + (inkMinX - overhang) * scale
      : currentX + 55 * scale;
    const barX2 = hasInk
      ? currentX + (inkMaxX + overhang) * scale
      : currentX + glyphWidth - 55 * scale;
    strokes.push({
      pathData: `M ${barX1.toFixed(2)} ${barY.toFixed(2)} L ${barX2.toFixed(2)} ${barY.toFixed(2)}`,
      startX: barX1,
      startY: barY,
      width: strokeWidthPx(fontNibUnits(), fontSize),
      delay: strokes.length > 0 ? 0.12 : 0,
      duration: 0.1,
      priority: 0,
    });

    return {
      path: { char, strokes, x: currentX, y: topY, width: glyphWidth, fontSize },
      advance: glyphWidth,
    };
  }

  if (char === "μ") {
    const uGlyph = glyphDataRecord.u;
    const glyphWidth = (uGlyph?.w ?? 370) * scale;
    const strokes: StrokePath[] = [];

    if (uGlyph) {
      for (const s of uGlyph.s) {
        const points = s.p;
        const pressures = points.map((p) => p[2]);
        const avgPressure = pressures.reduce((a, b) => a + b, 0) / Math.max(pressures.length, 1);
        const pathData = polylineToSVGPath(points, scale, scale, currentX, baselineY);
        const firstPoint = points[0];
        strokes.push({
          pathData,
          startX: currentX + firstPoint[0] * scale,
          startY: baselineY + firstPoint[1] * scale,
          width: strokeWidthPx(avgPressure, fontSize),
          delay: s.d,
          duration: s.a,
          priority: s.r ?? 0,
        });
      }
    }

    return {
      path: { char, strokes, x: currentX, y: topY, width: glyphWidth, fontSize },
      advance: glyphWidth,
    };
  }

  if (char === "π") {
    const u = 460;
    const glyphWidth = u * scale;
    const P = (px: number, py: number): string =>
      `${(currentX + px * scale).toFixed(2)} ${(baselineY + py * scale).toFixed(2)}`;
    const strokes: StrokePath[] = [];
    const push = (pathData: string, delay: number, duration: number): void => {
      const nums = pathData.match(/-?\d+(?:\.\d+)?/g);
      strokes.push({
        pathData,
        startX: nums ? Number(nums[0]) : currentX,
        startY: nums ? Number(nums[1]) : baselineY,
        width: strokeWidthPx(fontNibUnits() * 1.08, fontSize),
        delay,
        duration,
        priority: 0,
      });
    };
    // Handwritten pi: a top bar that overhangs two downward legs. Not latin n.
    push(`M ${P(20, -650)} L ${P(u - 20, -630)}`, 0, 0.12);
    push(`M ${P(150, -635)} L ${P(135, 30)}`, 0.06, 0.12);
    push(`M ${P(u - 155, -632)} L ${P(u - 140, 30)}`, 0.06, 0.12);
    return {
      path: { char, strokes, x: currentX, y: topY, width: glyphWidth, fontSize },
      advance: glyphWidth,
    };
  }

  if (char === "φ" || char === "Φ") {
    const glyphWidth = (glyphDataRecord.o?.w ?? 353) * scale;
    const stemX = currentX + glyphWidth * 0.5;
    const stemTop = baselineY - 760 * scale;
    const stemBottom = baselineY + 40 * scale;
    const extra: StrokePath[] = [{
      pathData: `M ${stemX.toFixed(2)} ${stemTop.toFixed(2)} L ${stemX.toFixed(2)} ${stemBottom.toFixed(2)}`,
      startX: stemX,
      startY: stemTop,
      width: strokeWidthPx(fontNibUnits(), fontSize),
      delay: 0.12,
      duration: 0.1,
      priority: 0,
    }];
    return cloneGlyphStrokes("o", char, currentX, baselineY, topY, scale, fontSize, extra);
  }

  if (char === "Δ") {
    const glyphWidth = 420 * scale;
    const apexX = currentX + glyphWidth * 0.5;
    const apexY = baselineY - 760 * scale;
    const leftX = currentX + 40 * scale;
    const rightX = currentX + glyphWidth - 40 * scale;
    const baseY = baselineY + 20 * scale;
    const strokes: StrokePath[] = [
      {
        pathData: `M ${apexX.toFixed(2)} ${apexY.toFixed(2)} L ${leftX.toFixed(2)} ${baseY.toFixed(2)} L ${rightX.toFixed(2)} ${baseY.toFixed(2)} Z`,
        startX: apexX,
        startY: apexY,
        width: strokeWidthPx(fontNibUnits() * 1.08, fontSize),
        delay: 0,
        duration: 0.14,
        priority: 0,
      },
    ];
    return {
      path: { char, strokes, x: currentX, y: topY, width: glyphWidth, fontSize },
      advance: glyphWidth,
    };
  }

  if (char === "Ω") {
    const glyphWidth = 470 * scale;
    const cx = currentX + glyphWidth / 2;
    const footY = baselineY;
    const archTop = baselineY - 720 * scale;
    const midY = baselineY - 250 * scale;
    const innerL = cx - 128 * scale;
    const innerR = cx + 128 * scale;
    const outerL = cx - 225 * scale;
    const outerR = cx + 225 * scale;
    const ctrlOutL = cx - 275 * scale;
    const ctrlOutR = cx + 275 * scale;
    // Two flared feet on the baseline plus an open-bottom bell: the ohm sign.
    const pathData =
      `M ${outerL.toFixed(2)} ${footY.toFixed(2)} ` +
      `L ${innerL.toFixed(2)} ${footY.toFixed(2)} ` +
      `C ${ctrlOutL.toFixed(2)} ${midY.toFixed(2)} ${ctrlOutL.toFixed(2)} ${archTop.toFixed(2)} ${cx.toFixed(2)} ${archTop.toFixed(2)} ` +
      `C ${ctrlOutR.toFixed(2)} ${archTop.toFixed(2)} ${ctrlOutR.toFixed(2)} ${midY.toFixed(2)} ${innerR.toFixed(2)} ${footY.toFixed(2)} ` +
      `L ${outerR.toFixed(2)} ${footY.toFixed(2)}`;
    return {
      path: {
        char,
        strokes: [
          {
            pathData,
            startX: outerL,
            startY: footY,
            width: strokeWidthPx(fontNibUnits() * 1.08, fontSize),
            delay: 0,
            duration: 0.18,
            priority: 0,
          },
        ],
        x: currentX,
        y: topY,
        width: glyphWidth,
        fontSize,
      },
      advance: glyphWidth,
    };
  }

  const latinBase = GREEK_LATIN_FALLBACK[char];
  if (latinBase) {
    return cloneGlyphStrokes(latinBase, char, currentX, baselineY, topY, scale, fontSize);
  }

  return null;
}

/**
 * Draws math operators and relation symbols as synthetic pen strokes.
 * All glyph-space coordinates are relative to the pen origin (currentX, baseline);
 * y is negative upward. Returns null for characters this function does not cover.
 */
function syntheticMathChar(
  char: string,
  currentX: number,
  baselineY: number,
  topY: number,
  scale: number,
  fontSize: number,
): { path: CharacterPath; advance: number } | null {
  const u = MATH_GLYPH_UNITS[char];
  if (u === undefined) {
    return null;
  }
  const advance = u * scale;

  // (px, py) in glyph units → absolute "x y" string. py negative = upward.
  const P = (px: number, py: number): string =>
    `${(currentX + px * scale).toFixed(2)} ${(baselineY + py * scale).toFixed(2)}`;

  // Circle outline centred at (cxu, cyu) with radius ru, via four cubic arcs.
  const cir = (cxu: number, cyu: number, ru: number): string => {
    const k = 0.5523 * ru;
    return (
      `M ${P(cxu + ru, cyu)} ` +
      `C ${P(cxu + ru, cyu - k)} ${P(cxu + k, cyu - ru)} ${P(cxu, cyu - ru)} ` +
      `C ${P(cxu - k, cyu - ru)} ${P(cxu - ru, cyu - k)} ${P(cxu - ru, cyu)} ` +
      `C ${P(cxu - ru, cyu + k)} ${P(cxu - k, cyu + ru)} ${P(cxu, cyu + ru)} ` +
      `C ${P(cxu + k, cyu + ru)} ${P(cxu + ru, cyu + k)} ${P(cxu + ru, cyu)}`
    );
  };

  const strokes: StrokePath[] = [];
  const push = (
    pathData: string,
    opts: { width?: number; delay?: number; duration?: number } = {},
  ): void => {
    // Approximate a start point from the first two numbers in the path.
    const nums = pathData.match(/-?\d+(?:\.\d+)?/g);
    const sx = nums ? Number(nums[0]) : currentX;
    const sy = nums ? Number(nums[1]) : baselineY;
    strokes.push({
      pathData,
      startX: sx,
      startY: sy,
      width: strokeWidthPx(fontNibUnits() * (opts.width ?? 1.08), fontSize),
      delay: opts.delay ?? (strokes.length > 0 ? 0.06 : 0),
      duration: opts.duration ?? 0.12,
      priority: 0,
    });
  };

  const cx = u / 2;

  switch (char) {
    case "→":
      push(`M ${P(50, -260)} L ${P(u - 70, -260)} M ${P(u - 210, -350)} L ${P(u - 70, -260)} L ${P(u - 210, -170)}`);
      break;
    case "↛":
      push(`M ${P(50, -260)} L ${P(u - 70, -260)} M ${P(u - 210, -350)} L ${P(u - 70, -260)} L ${P(u - 210, -170)}`);
      push(`M ${P(cx + 40, -80)} L ${P(cx - 40, -440)}`);
      break;
    case "←":
      push(`M ${P(u - 50, -260)} L ${P(70, -260)} M ${P(210, -350)} L ${P(70, -260)} L ${P(210, -170)}`);
      break;
    case "↔":
      push(`M ${P(90, -260)} L ${P(u - 90, -260)} M ${P(210, -350)} L ${P(70, -260)} L ${P(210, -170)} M ${P(u - 210, -350)} L ${P(u - 70, -260)} L ${P(u - 210, -170)}`);
      break;
    case "⇒":
      push(`M ${P(50, -220)} L ${P(u - 130, -220)} M ${P(50, -300)} L ${P(u - 130, -300)} M ${P(u - 220, -360)} L ${P(u - 70, -260)} L ${P(u - 220, -160)}`);
      break;
    case "⇐":
      push(`M ${P(u - 50, -220)} L ${P(130, -220)} M ${P(u - 50, -300)} L ${P(130, -300)} M ${P(220, -360)} L ${P(70, -260)} L ${P(220, -160)}`);
      break;
    case "⇌":
      // Two harpoons: upper points right, lower points left (equilibrium).
      push(`M ${P(60, -330)} L ${P(u - 70, -330)} L ${P(u - 170, -390)}`);
      push(`M ${P(u - 60, -190)} L ${P(70, -190)} L ${P(170, -130)}`);
      break;
    case "±":
      push(`M ${P(cx, -200)} L ${P(cx, -470)} M ${P(cx - 140, -335)} L ${P(cx + 140, -335)}`);
      push(`M ${P(cx - 150, -60)} L ${P(cx + 150, -60)}`);
      break;
    case "∓":
      push(`M ${P(cx - 150, -520)} L ${P(cx + 150, -520)}`);
      push(`M ${P(cx, -100)} L ${P(cx, -370)} M ${P(cx - 140, -235)} L ${P(cx + 140, -235)}`);
      break;
    case "×":
      push(`M ${P(cx - 150, -410)} L ${P(cx + 150, -110)}`);
      push(`M ${P(cx + 150, -410)} L ${P(cx - 150, -110)}`);
      break;
    case "÷":
      push(`M ${P(cx - 150, -260)} L ${P(cx + 150, -260)}`);
      push(cir(cx, -410, 26), { width: 1.3 });
      push(cir(cx, -110, 26), { width: 1.3 });
      break;
    case "·":
    case "∙":
    case "⋅":
      push(cir(cx, -260, 30), { width: 1.3 });
      break;
    case "≤":
      push(`M ${P(u - 120, -430)} L ${P(120, -280)} L ${P(u - 120, -130)}`);
      push(`M ${P(120, -50)} L ${P(u - 120, -50)}`);
      break;
    case "≥":
      push(`M ${P(120, -430)} L ${P(u - 120, -280)} L ${P(120, -130)}`);
      push(`M ${P(120, -50)} L ${P(u - 120, -50)}`);
      break;
    case "≈":
      push(`M ${P(90, -330)} C ${P(180, -400)} ${P(280, -260)} ${P(u - 90, -330)}`);
      push(`M ${P(90, -190)} C ${P(180, -260)} ${P(280, -120)} ${P(u - 90, -190)}`);
      break;
    case "≠":
      push(`M ${P(110, -330)} L ${P(u - 110, -330)} M ${P(110, -190)} L ${P(u - 110, -190)}`);
      push(`M ${P(u - 170, -90)} L ${P(170, -430)}`);
      break;
    case "≡":
      push(`M ${P(110, -370)} L ${P(u - 110, -370)} M ${P(110, -260)} L ${P(u - 110, -260)} M ${P(110, -150)} L ${P(u - 110, -150)}`);
      break;
    case "∝":
      // Open-right double curl, like a squished infinity that reads "proportional".
      push(`M ${P(u - 60, -160)} C ${P(cx + 40, -120)} ${P(90, -160)} ${P(90, -260)} C ${P(90, -360)} ${P(cx + 40, -400)} ${P(u - 60, -360)}`, { duration: 0.16 });
      break;
    case "∞":
      push(
        `M ${P(cx, -260)} C ${P(cx - 60, -140)} ${P(70, -140)} ${P(70, -260)} ` +
        `C ${P(70, -380)} ${P(cx - 60, -380)} ${P(cx, -260)} ` +
        `C ${P(cx + 60, -140)} ${P(u - 70, -140)} ${P(u - 70, -260)} ` +
        `C ${P(u - 70, -380)} ${P(cx + 60, -380)} ${P(cx, -260)}`,
        { duration: 0.2 },
      );
      break;
    case "√":
      push(`M ${P(30, -230)} L ${P(150, -110)} L ${P(300, -640)} L ${P(u - 30, -640)}`, { duration: 0.18 });
      break;
    case "∫":
      push(
        `M ${P(cx + 110, -830)} C ${P(cx + 50, -880)} ${P(cx, -840)} ${P(cx, -760)} ` +
        `L ${P(cx, 40)} ` +
        `C ${P(cx, 120)} ${P(cx - 60, 160)} ${P(cx - 110, 110)}`,
        { duration: 0.22 },
      );
      break;
    case "∮":
      push(
        `M ${P(cx + 110, -830)} C ${P(cx + 50, -880)} ${P(cx, -840)} ${P(cx, -760)} ` +
        `L ${P(cx, 40)} ` +
        `C ${P(cx, 120)} ${P(cx - 60, 160)} ${P(cx - 110, 110)}`,
        { duration: 0.22 },
      );
      push(cir(cx, -360, 95));
      break;
    case "∑":
      push(`M ${P(u - 70, -720)} L ${P(90, -720)} L ${P(cx - 20, -340)} L ${P(90, 40)} L ${P(u - 70, 40)}`, { duration: 0.2 });
      break;
    case "∏":
      push(`M ${P(60, -720)} L ${P(u - 60, -720)}`);
      push(`M ${P(160, -720)} L ${P(160, 40)}`);
      push(`M ${P(u - 160, -720)} L ${P(u - 160, 40)}`);
      break;
    case "∂":
      push(
        `M ${P(cx + 120, -520)} C ${P(cx - 40, -600)} ${P(cx - 170, -420)} ${P(cx - 130, -250)} ` +
        `C ${P(cx - 95, -70)} ${P(cx + 150, -80)} ${P(cx + 150, -270)} ` +
        `C ${P(cx + 150, -450)} ${P(cx - 60, -470)} ${P(cx - 120, -300)}`,
        { duration: 0.2 },
      );
      break;
    case "∇":
      push(`M ${P(50, -680)} L ${P(u - 50, -680)} L ${P(cx, 20)} Z`, { duration: 0.18 });
      break;
    case "∴":
      push(cir(140, -470, 30), { width: 1.3 });
      push(cir(u - 140, -470, 30), { width: 1.3 });
      push(cir(cx, -120, 30), { width: 1.3 });
      break;
    case "∵":
      push(cir(cx, -470, 30), { width: 1.3 });
      push(cir(140, -120, 30), { width: 1.3 });
      push(cir(u - 140, -120, 30), { width: 1.3 });
      break;
    case "°":
      push(cir(cx, -560, 90));
      break;
    case "′":
      push(`M ${P(cx + 30, -560)} L ${P(cx - 20, -720)}`);
      break;
    case "″":
      push(`M ${P(cx - 40, -560)} L ${P(cx - 90, -720)}`);
      push(`M ${P(cx + 90, -560)} L ${P(cx + 40, -720)}`);
      break;
    case "∈":
    case "∉":
      push(`M ${P(u - 70, -560)} C ${P(120, -620)} ${P(120, -100)} ${P(u - 70, -160)}`);
      push(`M ${P(120, -360)} L ${P(u - 160, -360)}`);
      if (char === "∉") {
        push(`M ${P(u - 60, -560)} L ${P(60, -80)}`);
      }
      break;
    case "⊂":
    case "⊆":
      push(`M ${P(u - 70, -560)} C ${P(120, -620)} ${P(120, -140)} ${P(u - 70, -200)}`);
      if (char === "⊆") {
        push(`M ${P(120, -40)} L ${P(u - 70, -40)}`);
      }
      break;
    case "⊃":
    case "⊇":
      push(`M ${P(70, -560)} C ${P(u - 120, -620)} ${P(u - 120, -140)} ${P(70, -200)}`);
      if (char === "⊇") {
        push(`M ${P(70, -40)} L ${P(u - 120, -40)}`);
      }
      break;
    case "∪":
      push(`M ${P(90, -620)} L ${P(90, -260)} C ${P(90, -60)} ${P(u - 90, -60)} ${P(u - 90, -260)} L ${P(u - 90, -620)}`);
      break;
    case "∩":
      push(`M ${P(90, 20)} L ${P(90, -360)} C ${P(90, -620)} ${P(u - 90, -620)} ${P(u - 90, -360)} L ${P(u - 90, 20)}`);
      break;
    case "∅":
      push(cir(cx, -320, 180));
      push(`M ${P(u - 60, -560)} L ${P(60, -80)}`);
      break;
    case "∠":
      push(`M ${P(u - 60, -40)} L ${P(80, -40)} L ${P(u - 120, -560)}`);
      break;
    case "⊥":
      push(`M ${P(cx, -640)} L ${P(cx, -40)}`);
      push(`M ${P(90, -40)} L ${P(u - 90, -40)}`);
      break;
    case "∥":
      push(`M ${P(120, -640)} L ${P(120, -20)}`);
      push(`M ${P(u - 120, -640)} L ${P(u - 120, -20)}`);
      break;
    case "∀":
      push(`M ${P(60, -680)} L ${P(cx, 20)} L ${P(u - 60, -680)}`);
      push(`M ${P(cx - 150, -280)} L ${P(cx + 150, -280)}`);
      break;
    case "∃":
      push(`M ${P(90, -680)} L ${P(u - 90, -680)} L ${P(u - 90, 20)} L ${P(90, 20)}`);
      push(`M ${P(90, -330)} L ${P(u - 90, -330)}`);
      break;
    default:
      return null;
  }

  return {
    path: { char, strokes, x: currentX, y: topY, width: advance, fontSize },
    advance,
  };
}

export interface StrokePath {
  pathData: string;
  startX: number;
  startY: number;
  width: number;
  delay: number;
  duration: number;
  priority: number;
}

export interface CharacterPath {
  char: string;
  strokes: StrokePath[];
  x: number;
  y: number;
  width: number;
  fontSize?: number;
}

function polylineToSVGPath(
  points: [number, number, number][],
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
): string {
  if (points.length === 0) return "";

  const mapped = points.map(([px, py]) => ({
    x: offsetX + px * scaleX,
    y: offsetY + py * scaleY,
  }));
  const first = mapped[0]!;
  if (mapped.length === 1) {
    return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  }
  if (mapped.length === 2) {
    const last = mapped[1]!;
    return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  }

  // Midpoint quadratics — a chain of L segments reads as a faceted plot,
  // not a pen stroke. The same smoother the idle doodle already uses.
  let data = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let index = 1; index < mapped.length - 1; index++) {
    const current = mapped[index]!;
    const next = mapped[index + 1]!;
    data += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${((current.x + next.x) / 2).toFixed(2)} ${((current.y + next.y) / 2).toFixed(2)}`;
  }
  const last = mapped[mapped.length - 1]!;
  return `${data} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
}

/**
 * The hand, as opposed to the font.
 *
 * Every glyph here comes out of one table, so an "e" written twice in a
 * sentence used to be the same shape to the pixel — the single loudest tell
 * that a board is being typeset rather than written. A person cannot repeat a
 * letter exactly: the pen sits at a slightly different angle, the letter comes
 * out a little bigger or smaller, and it lands a hair off the line.
 *
 * So every rendered glyph is put through a small affine wobble about its own
 * centre, and the line it sits on drifts gently the way a hand-ruled line does.
 * The variation is seeded from the text and its position, so a lesson replays
 * identically, a cached string is stable, and an exported MP4 matches the live
 * board frame for frame.
 */

/**
 * One hand, not a die per letter.
 *
 * The wobble used to be an independent draw per glyph: every letter rolled its
 * own angle, its own size and its own landing spot out of white noise. White
 * noise is the wrong model. A person's writing is strongly correlated — the
 * slant they are holding now is the slant of the letter before, the size drifts
 * over a word rather than between two letters — and independent draws are read
 * by the eye as exactly what they are, randomness, which is what makes writing
 * look untidy rather than human. Two neighbouring letters could differ by twice
 * the amplitude of everything below (3.2° of relative lean, 5.6% of size),
 * which is a ransom note, not a hand.
 *
 * So each quantity is now three layers:
 *
 *   line   what this row of writing settled at, one draw for the whole line
 *   drift  a smooth wander along the row, so neighbours share almost all of it
 *   glyph  a small residual, the only part that is per letter
 *
 * The residual is the only thing two adjacent letters can disagree about by
 * much, and it is a third of what the old amplitude was. The result is a hand
 * that is clearly not a font, and clearly one person.
 */

/** Lean: what this line settled at, how it wanders, and per letter. */
const SLANT_LINE_DEG = 0.34;
const SLANT_DRIFT_DEG = 0.5;
const SLANT_GLYPH_DEG = 0.3;
/** Size, as a fraction. */
const SIZE_LINE = 0.012;
const SIZE_DRIFT = 0.01;
const SIZE_GLYPH = 0.009;
/** Where the letter lands, as a fraction of the em. */
const OFFSET_X_GLYPH = 0.0035;
const OFFSET_Y_GLYPH = 0.007;
/** How much ink the nib lays down: pressure over the row, and per letter. */
const WEIGHT_LINE = 0.02;
const WEIGHT_DRIFT = 0.045;
const WEIGHT_GLYPH = 0.03;
/**
 * How far the line of writing wanders off the ruled baseline. A board is not
 * lined paper: a written row rises and falls a little across its length.
 */
const BASELINE_DRIFT_RATIO = 0.02;
/** Roughly four ems per swing, so the drift reads as a wander, not a wave. */
const BASELINE_DRIFT_WAVELENGTH_EM = 4.4;
/** Wavelengths of the slow wanders, in ems of writing. */
const SLANT_WAVELENGTH_EM = 7.5;
const SIZE_WAVELENGTH_EM = 5.5;
const WEIGHT_WAVELENGTH_EM = 3.5;

/** Stable 0..1 hash. */
function handNoise(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Stable -1..1 hash. */
function handSigned(seed: number): number {
  return handNoise(seed) * 2 - 1;
}

function lineSeedFor(text: string, x: number, y: number, fontSize: number): number {
  let seed = Math.round(x) * 31 + Math.round(y) * 17 + Math.round(fontSize) * 7;
  for (let index = 0; index < text.length; index++) {
    seed = (seed * 33 + text.charCodeAt(index)) % 1000003;
  }
  return seed;
}

/**
 * A smooth wander along the row, in -1..1.
 *
 * Two sines whose periods do not divide each other, so the wander never repeats
 * across a line, and both are slow against a letter: neighbours a third of an em
 * apart share nearly all of their value, which is the whole point.
 */
function handWander(emAlongLine: number, seed: number, wavelengthEm: number): number {
  const u = emAlongLine / Math.max(wavelengthEm, 0.5);
  const phase = handSigned(seed) * Math.PI;
  return 0.64 * Math.sin(u * 2 * Math.PI + phase) + 0.36 * Math.sin(u * 1.13 + phase * 1.7);
}

/** How far the baseline has wandered by the time the pen reaches `x`. */
function baselineDrift(
  x: number,
  originX: number,
  fontSize: number,
  lineSeed: number,
): number {
  const em = (x - originX) / Math.max(fontSize, 1);
  return fontSize * BASELINE_DRIFT_RATIO * handWander(em, lineSeed, BASELINE_DRIFT_WAVELENGTH_EM);
}

/** What the hand is doing at this point of this line. */
interface HandStyle {
  /** Lean off the font's own slant, in degrees. */
  slantDeg: number;
  /** Size against the font's own, 1 = as drawn. */
  size: number;
  /** Ink weight against the nib, 1 = the nib. */
  weight: number;
}

/**
 * The style at `emAlongLine` ems into a line written with `lineSeed`, for the
 * glyph seeded `glyphSeed`. Line and drift are shared with the neighbours;
 * only the third term is this letter's own.
 */
function handStyleAt(emAlongLine: number, lineSeed: number, glyphSeed: number): HandStyle {
  return {
    slantDeg:
      handSigned(lineSeed + 61) * SLANT_LINE_DEG +
      handWander(emAlongLine, lineSeed + 137, SLANT_WAVELENGTH_EM) * SLANT_DRIFT_DEG +
      handSigned(glyphSeed) * SLANT_GLYPH_DEG,
    size:
      1 +
      handSigned(lineSeed + 71) * SIZE_LINE +
      handWander(emAlongLine, lineSeed + 149, SIZE_WAVELENGTH_EM) * SIZE_DRIFT +
      handSigned(glyphSeed + 101) * SIZE_GLYPH,
    weight:
      1 +
      handSigned(lineSeed + 83) * WEIGHT_LINE +
      handWander(emAlongLine, lineSeed + 163, WEIGHT_WAVELENGTH_EM) * WEIGHT_DRIFT +
      handSigned(glyphSeed + 401) * WEIGHT_GLYPH,
  };
}

interface HandTransform {
  cos: number;
  sin: number;
  scale: number;
  centreX: number;
  centreY: number;
  dx: number;
  dy: number;
}

function transformPoint(x: number, y: number, hand: HandTransform): { x: number; y: number } {
  const px = (x - hand.centreX) * hand.scale;
  const py = (y - hand.centreY) * hand.scale;
  return {
    x: hand.centreX + px * hand.cos - py * hand.sin + hand.dx,
    y: hand.centreY + px * hand.sin + py * hand.cos + hand.dy,
  };
}

const PATH_TOKEN = /([A-Za-z])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;

/**
 * Push every coordinate in an absolute-coordinate path through the glyph's own
 * wobble. Every path this module emits uses M / L / Q / C with absolute pairs,
 * so walking the numbers two at a time is exact.
 */
function transformPathData(pathData: string, hand: HandTransform): string {
  const tokens = pathData.match(PATH_TOKEN);
  if (!tokens) return pathData;
  const out: string[] = [];
  let pendingX: number | null = null;
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      out.push(token);
      pendingX = null;
      continue;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      out.push(token);
      continue;
    }
    if (pendingX === null) {
      pendingX = value;
      continue;
    }
    const point = transformPoint(pendingX, value, hand);
    out.push(point.x.toFixed(2), point.y.toFixed(2));
    pendingX = null;
  }
  return out.join(" ");
}

/**
 * Give one rendered glyph its own hand: a slight roll, a slight size, a slight
 * landing offset, and a nib that laid down a little more or less ink.
 *
 * Layout is deliberately untouched — the advance width, the character box and
 * the measured width all stay exactly what the typography layer planned, so
 * this changes how the writing looks and never where anything sits.
 */
function applyHandVariation(
  path: CharacterPath,
  seed: number,
  fontSize: number,
  driftY: number,
  style: HandStyle,
): CharacterPath {
  if (path.strokes.length === 0) return path;

  const glyphSize = path.fontSize ?? fontSize;
  const angle = style.slantDeg * (Math.PI / 180);
  const hand: HandTransform = {
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    scale: style.size,
    centreX: path.x + path.width / 2,
    // Roughly the middle of the x-height: rolling about the letter's own body
    // keeps a tall glyph from swinging its ascender out of the word.
    centreY: path.y + ASCENDER * (glyphSize / UNITS_PER_EM) - glyphSize * 0.25,
    dx: handSigned(seed + 211) * glyphSize * OFFSET_X_GLYPH,
    dy: handSigned(seed + 307) * glyphSize * OFFSET_Y_GLYPH + driftY,
  };
  const widthScale = style.weight;

  return {
    ...path,
    strokes: path.strokes.map((stroke) => {
      const start = transformPoint(stroke.startX, stroke.startY, hand);
      return {
        ...stroke,
        pathData: transformPathData(stroke.pathData, hand),
        startX: start.x,
        startY: start.y,
        width: Math.max(stroke.width * widthScale, NIB_MIN_PX),
      };
    }),
  };
}

/** Fraction of normal font size used for superscript / subscript characters. */
const SCRIPT_FONT_RATIO = 0.62;
/** How far (in px) to raise the superscript baseline above the normal baseline. */
const SUPER_RAISE_RATIO = 0.38;
/** How far (in px) to drop the subscript baseline below the normal baseline. */
const SUB_DROP_RATIO = 0.14;
/**
 * Kerning around script groups (fraction of font size). Without these,
 * a subscript starts flush against the base glyph and the next full-size
 * character starts flush against the script — "r_1 =" reads as one blob.
 */
const SCRIPT_KERN_BEFORE_RATIO = 0.09;
const SCRIPT_KERN_AFTER_RATIO = 0.14;

/**
 * Renders a single character as stroke paths at the given position and scale.
 * Returns the CharacterPath and advances currentX by the glyph width.
 */
function renderChar(
  char: string,
  currentX: number,
  baselineY: number,
  topY: number,
  fontScale: number,
  fontSize: number,
): { path: CharacterPath; advance: number } {
  if (SYNTHETIC_GREEK_CHARS.has(char)) {
    const synthetic = syntheticGreekChar(char, currentX, baselineY, topY, fontScale, fontSize);
    if (synthetic) {
      return synthetic;
    }
  }

  if (SYNTHETIC_MATH_CHARS.has(char)) {
    const synthetic = syntheticMathChar(char, currentX, baselineY, topY, fontScale, fontSize);
    if (synthetic) {
      return synthetic;
    }
  }

  const glyph = glyphDataRecord[char];

  if (!glyph) {
    const fallbackWidth = fontSize * 0.5;
    return {
      path: { char, strokes: [], x: currentX, y: topY, width: fallbackWidth, fontSize },
      advance: fallbackWidth,
    };
  }

  const advanceWidth = glyph.w * fontScale;

  const strokes: StrokePath[] = glyph.s.map((s) => {
    const points = s.p;
    const pressures = points.map((p) => p[2]);
    const avgPressure = pressures.reduce((a, b) => a + b, 0) / Math.max(pressures.length, 1);

    const pathData = polylineToSVGPath(
      points,
      fontScale,
      fontScale,
      currentX,
      baselineY,
    );

    const firstPoint = points[0];
    const startX = currentX + firstPoint[0] * fontScale;
    const startY = baselineY + firstPoint[1] * fontScale;

    return {
      pathData,
      startX,
      startY,
      width: strokeWidthPx(avgPressure, fontSize),
      delay: s.d,
      duration: s.a,
      priority: s.r ?? 0,
    };
  });

  return {
    path: { char, strokes, x: currentX, y: topY, width: advanceWidth, fontSize },
    advance: advanceWidth,
  };
}

/**
 * Reads the characters that form a superscript or subscript group.
 * - `^(...)` / `_(...)` or `^{...}` / `_{...}` → grouped content (delimiters stripped).
 * - `^x` or `_x` → a same-class run (digits/letters) or a single character.
 */
function readScriptGroup(
  text: string,
  start: number,
  kind: "^" | "_" = "^",
): { content: string; nextIndex: number } {
  if (start >= text.length) {
    return { content: "", nextIndex: start };
  }

  const opener = text[start];
  if (opener === "(" || opener === "{") {
    const closer = opener === "(" ? ")" : "}";
    let i = start + 1;
    let depth = 1;
    let content = "";

    while (i < text.length && depth > 0) {
      if (text[i] === opener) depth++;
      if (text[i] === closer) {
        depth--;
        if (depth === 0) break;
      }
      content += text[i];
      i++;
    }

    return { content, nextIndex: i < text.length ? i + 1 : i };
  }

  // Consume a same-class run so "E_final" subscripts the whole word and
  // "x^10" superscripts both digits — a single-char read leaves the rest of
  // the word at normal size mid-word ("E_initial" → tiny i, normal "nitial"),
  // which looks broken on the board. Same-class keeps "v_0t" as v₀t.
  // Also allow a leading sign so "_-2" becomes the lower limit -2.
  if (text[start] === "+" || text[start] === "-") {
    const sign = text[start];
    let i = start + 1;
    let digits = "";
    while (i < text.length && /[0-9]/.test(text[i])) {
      digits += text[i];
      i++;
    }
    if (digits.length > 0) {
      return { content: `${sign}${digits}`, nextIndex: i };
    }
  }

  const first = text[start];
  const runPattern =
    kind === "^" || /[0-9]/.test(first) ? /[0-9]/ : /[A-Za-z]/.test(first) ? /[A-Za-z]/ : null;

  if (runPattern === null) {
    return { content: first, nextIndex: start + 1 };
  }

  let i = start;
  let content = "";
  while (i < text.length && runPattern.test(text[i])) {
    content += text[i];
    i++;
  }

  if (content.length === 0) {
    return { content: first, nextIndex: start + 1 };
  }

  return { content, nextIndex: i };
}

const STACKED_LIMIT_OWNERS = new Set(["∫", "∮", "∑", "∏"]);

function renderScriptRun(
  content: string,
  startX: number,
  baselineY: number,
  topY: number,
  scriptScale: number,
  scriptFontSize: number,
): { paths: CharacterPath[]; width: number } {
  const paths: CharacterPath[] = [];
  let cursorX = startX;
  for (let index = 0; index < content.length; index++) {
    const scriptChar = content[index]!;
    if (scriptChar === " ") {
      cursorX += spaceAdvancePx(
        previousBodyChar(content, index - 1),
        nextNonSpace(content, index + 1),
        scriptScale,
        scriptFontSize,
      );
      continue;
    }
    const { path } = renderChar(
      scriptChar,
      cursorX,
      baselineY,
      topY,
      scriptScale,
      scriptFontSize,
    );
    paths.push(path);
    cursorX += pairAdvancePx(
      scriptChar,
      nextNonSpace(content, index + 1),
      scriptScale,
      scriptFontSize,
    );
  }
  return { paths, width: Math.max(cursorX - startX, 0) };
}

const strokePathCache = new Map<string, Promise<CharacterPath[]>>();
const STROKE_PATH_CACHE_LIMIT = 64;

function strokePathCacheKey(
  rawText: string,
  x: number,
  y: number,
  fontSize: number,
): string {
  return `${rawText}\0${Math.round(x)}\0${Math.round(y)}\0${Math.round(fontSize)}`;
}

/** Warm Tegaki stroke generation so the first spoken character is not delayed by setup. */
export function prefetchStrokePaths(
  rawText: string,
  x: number,
  y: number,
  fontSize: number,
): void {
  void textToStrokePaths(rawText, x, y, fontSize);
}

export async function textToStrokePaths(
  rawText: string,
  x: number,
  y: number,
  fontSize: number,
): Promise<CharacterPath[]> {
  const cacheKey = strokePathCacheKey(rawText, x, y, fontSize);
  const cached = strokePathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const buildPromise = buildStrokePaths(rawText, x, y, fontSize);
  strokePathCache.set(cacheKey, buildPromise);
  if (strokePathCache.size > STROKE_PATH_CACHE_LIMIT) {
    const oldest = strokePathCache.keys().next().value;
    if (oldest !== undefined) {
      strokePathCache.delete(oldest);
    }
  }
  try {
    return await buildPromise;
  } catch (error) {
    strokePathCache.delete(cacheKey);
    throw error;
  }
}

async function buildStrokePaths(
  rawText: string,
  x: number,
  y: number,
  fontSize: number,
): Promise<CharacterPath[]> {
  const text = normalizeStrokeText(rawText);
  const scale = fontSize / UNITS_PER_EM;
  const baselineY = y + ASCENDER * scale;

  const scriptFontSize = fontSize * SCRIPT_FONT_RATIO;
  const scriptScale = scriptFontSize / UNITS_PER_EM;
  const superBaselineY = baselineY - fontSize * SUPER_RAISE_RATIO;
  const superTopY = y - fontSize * SUPER_RAISE_RATIO;
  const subBaselineY = baselineY + fontSize * SUB_DROP_RATIO;
  const subTopY = y + fontSize * SUB_DROP_RATIO;

  const results: CharacterPath[] = [];
  let currentX = x;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === " ") {
      currentX += spaceAdvancePx(
        previousBodyChar(text, i - 1),
        nextNonSpace(text, i + 1),
        scale,
        fontSize,
      );
      i++;
      continue;
    }

    // ^ → superscript: render next char or (...) group raised and smaller
    if (char === "^") {
      i++;
      const { content, nextIndex } = readScriptGroup(text, i, "^");
      i = nextIndex;

      currentX += fontSize * SCRIPT_KERN_BEFORE_RATIO;
      const rendered = renderScriptRun(
        content,
        currentX,
        superBaselineY,
        superTopY,
        scriptScale,
        scriptFontSize,
      );
      results.push(...rendered.paths);
      currentX += rendered.width + fontSize * SCRIPT_KERN_AFTER_RATIO;
      continue;
    }

    // _ → subscript: render next char or (...) group lowered and smaller
    if (char === "_") {
      i++;
      const { content, nextIndex } = readScriptGroup(text, i, "_");
      i = nextIndex;

      currentX += fontSize * SCRIPT_KERN_BEFORE_RATIO;
      const rendered = renderScriptRun(
        content,
        currentX,
        subBaselineY,
        subTopY,
        scriptScale,
        scriptFontSize,
      );
      results.push(...rendered.paths);
      currentX += rendered.width + fontSize * SCRIPT_KERN_AFTER_RATIO;
      continue;
    }

    // LaTeX brace delimiters must never become board ink. Script groups are
    // already rewritten above; any leftover "{" / "}" is model slop.
    if (char === "{" || char === "}") {
      i++;
      continue;
    }

    // Normal character
    const { path } = renderChar(char, currentX, baselineY, y, scale, fontSize);
    results.push(path);
    currentX += pairAdvancePx(char, nextPairChar(text, i + 1), scale, fontSize);
    i++;

    // Integral / sum / product limits stack beside the owner glyph instead of
    // marching left-to-right as separate script runs.
    if (STACKED_LIMIT_OWNERS.has(char)) {
      let lower: string | null = null;
      let upper: string | null = null;
      let cursor = i;
      while (cursor < text.length && (text[cursor] === "_" || text[cursor] === "^")) {
        const marker = text[cursor] as "^" | "_";
        cursor++;
        const group = readScriptGroup(text, cursor, marker);
        cursor = group.nextIndex;
        if (marker === "_") lower = group.content;
        else upper = group.content;
      }
      if (lower !== null || upper !== null) {
        i = cursor;
        const limitX = currentX + fontSize * SCRIPT_KERN_BEFORE_RATIO;
        let limitWidth = 0;
        if (upper !== null) {
          const rendered = renderScriptRun(
            upper,
            limitX,
            superBaselineY,
            superTopY,
            scriptScale,
            scriptFontSize,
          );
          results.push(...rendered.paths);
          limitWidth = Math.max(limitWidth, rendered.width);
        }
        if (lower !== null) {
          const rendered = renderScriptRun(
            lower,
            limitX,
            subBaselineY,
            subTopY,
            scriptScale,
            scriptFontSize,
          );
          results.push(...rendered.paths);
          limitWidth = Math.max(limitWidth, rendered.width);
        }
        currentX = limitX + limitWidth + fontSize * SCRIPT_KERN_AFTER_RATIO;
      }
    }
  }

  // The font laid the row out; the hand writes it. Nothing above this line
  // knows about the wobble, so layout, measurement and label boxes all stay
  // exactly where the typography layer put them.
  const lineSeed = lineSeedFor(text, x, y, fontSize);
  return results.map((path, index) => {
    const glyphSeed = lineSeed + index * 977 + (path.char.codePointAt(0) ?? 0) * 13;
    const emAlongLine = (path.x - x) / Math.max(fontSize, 1);
    return applyHandVariation(
      path,
      glyphSeed,
      fontSize,
      baselineDrift(path.x, x, fontSize, lineSeed),
      handStyleAt(emAlongLine, lineSeed, glyphSeed),
    );
  });
}

/**
 * Synchronously measures the advance width of `text` at `fontSize`,
 * using the same glyph metrics as `textToStrokePaths`.
 *
 * This mirrors the layout loop in `textToStrokePaths` but skips stroke
 * generation, so it is cheap and synchronous.
 */
function measureScriptRunWidth(
  content: string,
  scriptFontSize: number,
  scriptScale: number,
): number {
  let width = 0;
  for (let index = 0; index < content.length; index++) {
    const subChar = content[index]!;
    if (subChar === " ") {
      width += spaceAdvancePx(
        previousBodyChar(content, index - 1),
        nextNonSpace(content, index + 1),
        scriptScale,
        scriptFontSize,
      );
      continue;
    }
    width += pairAdvancePx(subChar, nextNonSpace(content, index + 1), scriptScale, scriptFontSize);
  }
  return width;
}

export function measureTextWidth(rawText: string, fontSize: number = 32): number {
  const text = normalizeStrokeText(rawText);
  const scale = fontSize / UNITS_PER_EM;
  const scriptFontSize = fontSize * SCRIPT_FONT_RATIO;
  const scriptScale = scriptFontSize / UNITS_PER_EM;

  let currentX = 0;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === " ") {
      currentX += spaceAdvancePx(
        previousBodyChar(text, i - 1),
        nextNonSpace(text, i + 1),
        scale,
        fontSize,
      );
      i++;
      continue;
    }

    if (char === "^" || char === "_") {
      i++;
      const { content, nextIndex } = readScriptGroup(text, i, char);
      i = nextIndex;
      currentX += fontSize * SCRIPT_KERN_BEFORE_RATIO;
      currentX += measureScriptRunWidth(content, scriptFontSize, scriptScale);
      currentX += fontSize * SCRIPT_KERN_AFTER_RATIO;
      continue;
    }

    if (char === "{" || char === "}") {
      i++;
      continue;
    }

    currentX += pairAdvancePx(char, nextPairChar(text, i + 1), scale, fontSize);
    i++;

    if (STACKED_LIMIT_OWNERS.has(char)) {
      let lower: string | null = null;
      let upper: string | null = null;
      let cursor = i;
      while (cursor < text.length && (text[cursor] === "_" || text[cursor] === "^")) {
        const marker = text[cursor] as "^" | "_";
        cursor++;
        const group = readScriptGroup(text, cursor, marker);
        cursor = group.nextIndex;
        if (marker === "_") lower = group.content;
        else upper = group.content;
      }
      if (lower !== null || upper !== null) {
        i = cursor;
        const limitWidth = Math.max(
          lower ? measureScriptRunWidth(lower, scriptFontSize, scriptScale) : 0,
          upper ? measureScriptRunWidth(upper, scriptFontSize, scriptScale) : 0,
        );
        currentX += fontSize * SCRIPT_KERN_BEFORE_RATIO + limitWidth + fontSize * SCRIPT_KERN_AFTER_RATIO;
      }
    }
  }

  return currentX;
}
