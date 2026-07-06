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
    const widths = points.map((p) => p[2] * scale);
    const avgWidth = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);
    const pathData = polylineToSVGPath(points, scale, scale, currentX, baselineY);
    const firstPoint = points[0];
    return {
      pathData,
      startX: currentX + firstPoint[0] * scale,
      startY: baselineY + firstPoint[1] * scale,
      width: Math.max(avgWidth, 1.5),
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

  if (char === "φ" || char === "Φ") {
    const glyphWidth = (glyphDataRecord.o?.w ?? 353) * scale;
    const stemX = currentX + glyphWidth * 0.5;
    const stemTop = baselineY - 760 * scale;
    const stemBottom = baselineY + 40 * scale;
    const extra: StrokePath[] = [{
      pathData: `M ${stemX.toFixed(2)} ${stemTop.toFixed(2)} L ${stemX.toFixed(2)} ${stemBottom.toFixed(2)}`,
      startX: stemX,
      startY: stemTop,
      width: Math.max(2.2 * scale, 1.5),
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
        width: Math.max(2.4 * scale, 1.5),
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
            width: Math.max(2.4 * scale, 1.6),
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
      width: Math.max((opts.width ?? 2.4) * scale, 1.5),
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
      push(cir(cx, -410, 26), { width: 3 });
      push(cir(cx, -110, 26), { width: 3 });
      break;
    case "·":
    case "∙":
    case "⋅":
      push(cir(cx, -260, 30), { width: 3 });
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
      push(cir(140, -470, 30), { width: 3 });
      push(cir(u - 140, -470, 30), { width: 3 });
      push(cir(cx, -120, 30), { width: 3 });
      break;
    case "∵":
      push(cir(cx, -470, 30), { width: 3 });
      push(cir(140, -120, 30), { width: 3 });
      push(cir(u - 140, -120, 30), { width: 3 });
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

function syntheticGlyphWidth(char: string, scale: number): number {
  if (char === "π" || char === "Θ" || char === "θ") {
    const glyphW = char === "π" ? glyphDataRecord.n?.w ?? 450 : glyphDataRecord.o?.w ?? 353;
    return glyphW * scale;
  }
  if (char === "μ") {
    return (glyphDataRecord.u?.w ?? 370) * scale;
  }
  if (char === "φ" || char === "Φ") {
    return (glyphDataRecord.o?.w ?? 353) * scale;
  }
  if (char === "Δ") {
    return 420 * scale;
  }
  if (char === "Ω") {
    return 470 * scale;
  }
  const mathUnits = MATH_GLYPH_UNITS[char];
  if (mathUnits !== undefined) {
    return mathUnits * scale;
  }
  const latinBase = GREEK_LATIN_FALLBACK[char];
  if (latinBase) {
    return (glyphDataRecord[latinBase]?.w ?? 350) * scale;
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
function readScriptGroup(
  text: string,
  start: number,
  kind: "^" | "_" = "^",
): { content: string; nextIndex: number } {
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

  // Consume a same-class run so "E_final" subscripts the whole word and
  // "x^10" superscripts both digits — a single-char read leaves the rest of
  // the word at normal size mid-word ("E_initial" → tiny i, normal "nitial"),
  // which looks broken on the board. Same-class keeps "v_0t" as v₀t.
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
      const { content, nextIndex } = readScriptGroup(text, i, "^");
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
      const { content, nextIndex } = readScriptGroup(text, i, "_");
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
      const { content, nextIndex } = readScriptGroup(text, i, char);
      i = nextIndex;
      const subScale = scriptScale;
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
    if (!glyph && (SYNTHETIC_GREEK_CHARS.has(char) || SYNTHETIC_MATH_CHARS.has(char))) {
      currentX += syntheticGlyphWidth(char, scale);
      i++;
      continue;
    }
    currentX += glyph ? glyph.w * scale : fontSize * 0.5;
    i++;
  }

  return currentX;
}
