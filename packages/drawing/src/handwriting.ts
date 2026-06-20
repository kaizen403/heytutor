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

export async function textToStrokePaths(
  text: string,
  x: number,
  y: number,
  fontSize: number,
): Promise<CharacterPath[]> {
  const scale = fontSize / UNITS_PER_EM;
  const baselineY = y + ASCENDER * scale;

  const results: CharacterPath[] = [];
  let currentX = x;

  for (const char of text) {
    if (char === " ") {
      currentX += fontSize * 0.3;
      continue;
    }

    const glyph = glyphDataRecord[char];

    if (!glyph) {
      results.push({
        char,
        strokes: [],
        x: currentX,
        y,
        width: fontSize * 0.5,
      });
      currentX += fontSize * 0.5;
      continue;
    }

    const advanceWidth = glyph.w * scale;

    const strokes: StrokePath[] = glyph.s.map((s) => {
      const points = s.p;
      const widths = points.map((p) => p[2] * scale);
      const avgWidth = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);

      const pathData = polylineToSVGPath(
        points,
        scale,
        scale,
        currentX,
        baselineY,
      );

      const firstPoint = points[0];
      const startX = currentX + firstPoint[0] * scale;
      const startY = baselineY + firstPoint[1] * scale;

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

    results.push({
      char,
      strokes,
      x: currentX,
      y,
      width: advanceWidth,
    });

    currentX += advanceWidth;
  }

  return results;
}


