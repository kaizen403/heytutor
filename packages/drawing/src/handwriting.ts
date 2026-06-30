import glyphData from "./caveat-glyphData.json";

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
const DESCENDER = -300;

const glyphDataRecord = glyphData as unknown as Record<string, TegakiGlyphData>;

/** Greek/math symbols missing from Caveat glyph data — rendered as synthetic strokes. */
const SYNTHETIC_GREEK_CHARS = new Set(["θ", "Θ", "μ", "π"]);

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
        const widths = points.map((p) => p[2] * scale);
        const avgWidth = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);
        const pathData = polylineToSVGPath(points, scale, scale, currentX, baselineY);
        const firstPoint = points[0];
        strokes.push({
          pathData,
          startX: currentX + firstPoint[0] * scale,
          startY: baselineY + firstPoint[1] * scale,
          width: Math.max(avgWidth, 1.5),
          delay: s.d,
          duration: s.a,
          priority: s.r ?? 0,
        });
      }
    }

    const barY = baselineY - 470 * scale;
    const barX1 = currentX + 55 * scale;
    const barX2 = currentX + glyphWidth - 55 * scale;
    strokes.push({
      pathData: `M ${barX1.toFixed(2)} ${barY.toFixed(2)} L ${barX2.toFixed(2)} ${barY.toFixed(2)}`,
      startX: barX1,
      startY: barY,
      width: Math.max(2.2 * scale, 1.5),
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
        const widths = points.map((p) => p[2] * scale);
        const avgWidth = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);
        const pathData = polylineToSVGPath(points, scale, scale, currentX, baselineY);
        const firstPoint = points[0];
        strokes.push({
          pathData,
          startX: currentX + firstPoint[0] * scale,
          startY: baselineY + firstPoint[1] * scale,
          width: Math.max(avgWidth, 1.5),
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
    const nGlyph = glyphDataRecord.n;
    const glyphWidth = (nGlyph?.w ?? 450) * scale;
    const strokes: StrokePath[] = [];

    if (nGlyph) {
      for (const s of nGlyph.s) {
        const points = s.p;
        const widths = points.map((p) => p[2] * scale);
        const avgWidth = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);
        const pathData = polylineToSVGPath(points, scale, scale, currentX, baselineY);
        const firstPoint = points[0];
        strokes.push({
          pathData,
          startX: currentX + firstPoint[0] * scale,
          startY: baselineY + firstPoint[1] * scale,
          width: Math.max(avgWidth, 1.5),
          delay: s.d,
          duration: s.a,
          priority: s.r ?? 0,
        });
      }
    }

    const barY = baselineY - 700 * scale;
    const barX1 = currentX + 30 * scale;
    const barX2 = currentX + glyphWidth - 20 * scale;
    strokes.push({
      pathData: `M ${barX1.toFixed(2)} ${barY.toFixed(2)} L ${barX2.toFixed(2)} ${barY.toFixed(2)}`,
      startX: barX1,
      startY: barY,
      width: Math.max(2.4 * scale, 1.5),
      delay: strokes.length > 0 ? 0.1 : 0,
      duration: 0.09,
      priority: 0,
    });

    return {
      path: { char, strokes, x: currentX, y: topY, width: glyphWidth, fontSize },
      advance: glyphWidth,
    };
  }

  return null;
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

function syntheticGlyphWidth(char: string, scale: number): number {
  if (char === "π" || char === "Θ" || char === "θ") {
    const glyphW = char === "π" ? glyphDataRecord.n?.w ?? 450 : glyphDataRecord.o?.w ?? 353;
    return glyphW * scale;
  }
  if (char === "μ") {
    return (glyphDataRecord.u?.w ?? 370) * scale;
  }
  return 0;
}

function polylineToSVGPath(
  points: [number, number, number][],
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
): string {
  return points
    .map(([px, py], i) => {
      const x = offsetX + px * scaleX;
      const y = offsetY + py * scaleY;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Fraction of normal font size used for superscript / subscript characters. */
const SCRIPT_FONT_RATIO = 0.62;
/** How far (in px) to raise the superscript baseline above the normal baseline. */
const SUPER_RAISE_RATIO = 0.38;
/** How far (in px) to drop the subscript baseline below the normal baseline. */
const SUB_DROP_RATIO = 0.14;

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
    const widths = points.map((p) => p[2] * fontScale);
    const avgWidth = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);

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
      width: Math.max(avgWidth, 1.5),
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
 * - `^(...)` or `_(...)` → everything inside the parens (parens stripped).
 * - `^x` or `_x`        → just the single character x.
 */
function readScriptGroup(text: string, start: number): { content: string; nextIndex: number } {
  if (start >= text.length) {
    return { content: "", nextIndex: start };
  }

  if (text[start] === "(") {
    let i = start + 1;
    let depth = 1;
    let content = "";

    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      if (text[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
      content += text[i];
      i++;
    }

    return { content, nextIndex: i < text.length ? i + 1 : i };
  }

  return { content: text[start], nextIndex: start + 1 };
}

export async function textToStrokePaths(
  text: string,
  x: number,
  y: number,
  fontSize: number,
): Promise<CharacterPath[]> {
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
      currentX += fontSize * 0.3;
      i++;
      continue;
    }

    // ^ → superscript: render next char or (...) group raised and smaller
    if (char === "^") {
      i++;
      const { content, nextIndex } = readScriptGroup(text, i);
      i = nextIndex;

      for (const superChar of content) {
        if (superChar === " ") {
          currentX += scriptFontSize * 0.3;
          continue;
        }

        const { path, advance } = renderChar(
          superChar,
          currentX,
          superBaselineY,
          superTopY,
          scriptScale,
          scriptFontSize,
        );
        results.push(path);
        currentX += advance;
      }
      continue;
    }

    // _ → subscript: render next char or (...) group lowered and smaller
    if (char === "_") {
      i++;
      const { content, nextIndex } = readScriptGroup(text, i);
      i = nextIndex;

      for (const subChar of content) {
        if (subChar === " ") {
          currentX += scriptFontSize * 0.3;
          continue;
        }

        const { path, advance } = renderChar(
          subChar,
          currentX,
          subBaselineY,
          subTopY,
          scriptScale,
          scriptFontSize,
        );
        results.push(path);
        currentX += advance;
      }
      continue;
    }

    // Normal character
    const { path, advance } = renderChar(char, currentX, baselineY, y, scale, fontSize);
    results.push(path);
    currentX += advance;
    i++;
  }

  return results;
}

/**
 * Synchronously measures the advance width of `text` at `fontSize`,
 * using the same glyph metrics as `textToStrokePaths`.
 *
 * This mirrors the layout loop in `textToStrokePaths` but skips stroke
 * generation, so it is cheap and synchronous.
 */
export function measureTextWidth(text: string, fontSize: number = 32): number {
  const scale = fontSize / UNITS_PER_EM;
  const scriptFontSize = fontSize * SCRIPT_FONT_RATIO;
  const scriptScale = scriptFontSize / UNITS_PER_EM;

  let currentX = 0;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === " ") {
      currentX += fontSize * 0.3;
      i++;
      continue;
    }

    if (char === "^" || char === "_") {
      i++;
      const { content, nextIndex } = readScriptGroup(text, i);
      i = nextIndex;
      const subScale = char === "^" ? scriptScale : scriptScale;
      for (const subChar of content) {
        if (subChar === " ") {
          currentX += scriptFontSize * 0.3;
          continue;
        }
        const glyph = glyphDataRecord[subChar];
        currentX += glyph ? glyph.w * subScale : scriptFontSize * 0.5;
      }
      continue;
    }

    const glyph = glyphDataRecord[char];
    if (!glyph && SYNTHETIC_GREEK_CHARS.has(char)) {
      currentX += syntheticGlyphWidth(char, scale);
      i++;
      continue;
    }
    currentX += glyph ? glyph.w * scale : fontSize * 0.5;
    i++;
  }

  return currentX;
}
