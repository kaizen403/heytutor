/**
 * Equations the stem actually states, read out of exam text.
 *
 * The conic builders used to draw a canonical `x^2/4 - y^2 = 1` whichever
 * hyperbola the question named, so the picture was the right *kind* of curve
 * and the wrong curve. This module recovers the real coefficients instead.
 *
 * Everything here fails closed. An OCR page that has lost a term ("x? +? - 16x
 * - 4y = 0"), a symbolic equation ("x^2/a^2 - y^2/b^2 = 1"), or anything that
 * is not exactly a conic yields nothing, and the caller degrades to a
 * shape-only schematic or to text-only. A curve drawn from a misread equation
 * is worse than no curve.
 */
import { parseMathExpression2D } from "../math/expression";

export type StatedCurveKind =
  | "line"
  | "circle"
  | "ellipse"
  | "hyperbola"
  | "parabola";

export interface StatedCurve {
  readonly kind: StatedCurveKind;
  /** F(x, y), whose zero set is the curve. Always parseable. */
  readonly expression: string;
  /** Conic coefficients of Ax^2 + Bxy + Cy^2 + Dx + Ey + F. */
  readonly coefficients: readonly [number, number, number, number, number, number];
  /** Centre for a circle/ellipse/hyperbola, vertex for a parabola, else null. */
  readonly anchor: { x: number; y: number } | null;
  /** Half-extents used to frame the curve; for a line, null. */
  readonly extent: { x: number; y: number } | null;
  readonly radius: number | null;
}

const MAX_CLAUSE = 60;
const FIT_TOLERANCE = 1e-6;

/** Characters an exam equation may be built from once the OCR repairs are done. */
const EXPRESSION_SOURCE = /[0-9xyXY+\-*/^().\s?²³−–—]/;

/**
 * Split the stem on `=` and take the maximal expression run around each one.
 * A run that touches a letter other than x/y is symbolic and is discarded.
 */
export function findStatedCurves(text: string): StatedCurve[] {
  const source = text.replace(/[−–—]/g, "-");
  const curves: StatedCurve[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "=") continue;
    // "==", "<=", ">=" are comparisons, not an equation to draw.
    if (/[<>=!]/.test(source[index - 1] ?? "") || source[index + 1] === "=") continue;
    const left = expressionRun(source, index - 1, -1);
    const right = expressionRun(source, index + 1, 1);
    if (left === null || right === null) continue;
    if (!/[xy]/i.test(left) && !/[xy]/i.test(right)) continue;
    const expression = `(${left})-(${right})`;
    const curve = classifyStatedCurve(expression);
    if (!curve || seen.has(curve.expression)) continue;
    seen.add(curve.expression);
    curves.push(curve);
  }
  return curves;
}

/**
 * Walk out from `=` while the characters can belong to an expression, then
 * normalise. Returns null when the run is truncated or touches a symbol.
 */
function expressionRun(source: string, from: number, step: -1 | 1): string | null {
  let index = from;
  while (index >= 0 && index < source.length && EXPRESSION_SOURCE.test(source[index]!)) {
    index += step;
  }
  const boundary = source[index];
  // A letter *touching* the run is a symbolic coefficient ("y^2/b^2") and the
  // algebra cannot be trusted. A letter separated by a space is just the next
  // word of the sentence ("the circle x^2 + y^2 = 64. There is ...").
  const inside = step === -1 ? source[index + 1] : source[index - 1];
  if (
    boundary !== undefined
    && /[a-zA-Z]/.test(boundary)
    && inside !== undefined
    && !/\s/.test(inside)
  ) {
    return null;
  }
  const raw = step === -1 ? source.slice(index + 1, from + 1) : source.slice(from, index);
  if (raw.trim().length === 0 || raw.length > MAX_CLAUSE) return null;
  return normalizeExamExpression(raw);
}

/** OCR-tolerant repair into the bounded 2-D expression language. */
export function normalizeExamExpression(raw: string): string | null {
  let source = raw
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\s+/g, "")
    .toLowerCase();
  if (!source) return null;
  // Exam OCR loses the caret: "x2" and the stray glyph in "x?" are squares.
  source = source.replace(/([xy])\?/g, "$1^2");
  source = source.replace(/([xy])(\d)(?![\d.])/g, "$1^$2");
  source = source.replace(/(\))(\d)(?![\d.])/g, "$1^$2");
  // Implicit multiplication, adjacent tokens only.
  source = source.replace(/(\d)([xy(])/g, "$1*$2");
  source = source.replace(/([xy)])(\()/g, "$1*$2");
  source = source.replace(/([xy])([xy])/g, "$1*$2");
  source = source.replace(/(\))([xy])/g, "$1*$2");
  // A sentence period that trailed the number is not a decimal point.
  source = source.replace(/\.$/, "");
  if (!/^[0-9xy+\-*/^().]+$/.test(source)) return null;
  // A dangling operator means a term was lost in scanning.
  if (/^[*/^]/.test(source) || /[-+*/^]$/.test(source)) return null;
  if (source.includes("()")) return null;
  return source;
}

/**
 * Fit Ax^2 + Bxy + Cy^2 + Dx + Ey + F to the expression and confirm the fit is
 * exact. Anything that is not precisely a conic is rejected rather than
 * approximated.
 */
export function classifyStatedCurve(expression: string): StatedCurve | null {
  let evaluate: (x: number, y: number) => number;
  try {
    const parsed = parseMathExpression2D(expression);
    evaluate = (x, y) => parsed.evaluate(x, y);
    parsed.assertContinuousOn(-8, 8, -8, 8);
  } catch {
    return null;
  }
  let f: number;
  let a: number;
  let c: number;
  let d: number;
  let e: number;
  let b: number;
  try {
    f = evaluate(0, 0);
    const px = evaluate(1, 0);
    const nx = evaluate(-1, 0);
    const py = evaluate(0, 1);
    const ny = evaluate(0, -1);
    a = (px + nx) / 2 - f;
    d = (px - nx) / 2;
    c = (py + ny) / 2 - f;
    e = (py - ny) / 2;
    b = evaluate(1, 1) - a - c - d - e - f;
  } catch {
    return null;
  }
  const coefficients: [number, number, number, number, number, number] = [a, b, c, d, e, f];
  const scale = Math.max(1, ...coefficients.map(Math.abs));
  // The quadratic must reproduce the expression everywhere, not just at the
  // fitting points — this is what rejects cubics, trig and log stems.
  for (const [x, y] of SAMPLE_POINTS) {
    let actual: number;
    try { actual = evaluate(x, y); } catch { return null; }
    const model = a * x * x + b * x * y + c * y * y + d * x + e * y + f;
    if (Math.abs(actual - model) > FIT_TOLERANCE * scale * (1 + Math.abs(x) + Math.abs(y)) ** 2) {
      return null;
    }
  }
  return describeConic(expression, coefficients);
}

const SAMPLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.37, 1.61], [-1.24, 0.58], [2.13, -1.87], [-0.71, -2.35], [1.92, 2.44],
  [-2.68, 1.09], [0.83, -0.46], [3.17, 0.92], [-1.55, 2.78], [2.61, -2.03],
];

function describeConic(
  expression: string,
  coefficients: [number, number, number, number, number, number],
): StatedCurve | null {
  const [a, b, c, d, e, f] = coefficients;
  const quadraticScale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  const linearScale = Math.max(Math.abs(d), Math.abs(e));
  if (quadraticScale <= 1e-9) {
    if (linearScale <= 1e-9) return null;
    return { kind: "line", expression, coefficients, anchor: null, extent: null, radius: null };
  }
  const discriminant = b * b - 4 * a * c;
  const det = quadraticScale;

  // Circle: equal square terms, no cross term.
  if (Math.abs(b) < 1e-9 * det && Math.abs(a - c) < 1e-9 * det && Math.abs(a) > 1e-9) {
    const cx = -d / (2 * a);
    const cy = -e / (2 * a);
    const squared = cx * cx + cy * cy - f / a;
    if (!(squared > 1e-9)) return null;
    const radius = Math.sqrt(squared);
    return {
      kind: "circle",
      expression,
      coefficients,
      anchor: { x: cx, y: cy },
      extent: { x: radius * 1.3, y: radius * 1.3 },
      radius,
    };
  }

  if (Math.abs(discriminant) <= 1e-9 * det * det) {
    // Parabola. Only the axis-aligned forms are framed; a rotated parabola has
    // no reliable vertex box here, so it is refused.
    if (Math.abs(b) > 1e-9 * det) return null;
    if (Math.abs(a) > 1e-9 * det && Math.abs(e) > 1e-9) {
      const vx = -d / (2 * a);
      const vy = -(a * vx * vx + d * vx + f) / e;
      const p = Math.abs(e / a);
      return {
        kind: "parabola",
        expression,
        coefficients,
        anchor: { x: vx, y: vy },
        extent: { x: Math.max(2 * p, 2), y: Math.max(2.2 * p, 2.2) },
        radius: null,
      };
    }
    if (Math.abs(c) > 1e-9 * det && Math.abs(d) > 1e-9) {
      const vy = -e / (2 * c);
      const vx = -(c * vy * vy + e * vy + f) / d;
      const p = Math.abs(d / c);
      return {
        kind: "parabola",
        expression,
        coefficients,
        anchor: { x: vx, y: vy },
        extent: { x: Math.max(2.2 * p, 2.2), y: Math.max(2 * p, 2) },
        radius: null,
      };
    }
    return null;
  }

  // Central conic: solve the gradient for the centre, then read the axes from
  // the eigenvalues of [[a, b/2], [b/2, c]].
  const denominator = 4 * a * c - b * b;
  if (Math.abs(denominator) < 1e-9 * det * det) return null;
  const cx = (b * e - 2 * c * d) / denominator;
  const cy = (b * d - 2 * a * e) / denominator;
  const constant = a * cx * cx + b * cx * cy + c * cy * cy + d * cx + e * cy + f;
  if (Math.abs(constant) < 1e-9 * det) return null;
  const mean = (a + c) / 2;
  const spread = Math.sqrt(((a - c) / 2) ** 2 + (b / 2) ** 2);
  const lambda1 = mean + spread;
  const lambda2 = mean - spread;
  if (Math.abs(lambda1) < 1e-9 || Math.abs(lambda2) < 1e-9) return null;
  const axis1Squared = -constant / lambda1;
  const axis2Squared = -constant / lambda2;

  if (discriminant < 0) {
    if (!(axis1Squared > 0) || !(axis2Squared > 0)) return null; // imaginary
    const half1 = Math.sqrt(axis1Squared);
    const half2 = Math.sqrt(axis2Squared);
    const reach = Math.max(half1, half2) * 1.3;
    return {
      kind: "ellipse",
      expression,
      coefficients,
      anchor: { x: cx, y: cy },
      extent: { x: reach, y: reach },
      radius: null,
    };
  }

  // Hyperbola: one axis real, the other imaginary. Frame both branches.
  const real = axis1Squared > 0 ? Math.sqrt(axis1Squared) : Math.sqrt(axis2Squared);
  const imaginary = axis1Squared > 0 ? Math.sqrt(-axis2Squared) : Math.sqrt(-axis1Squared);
  if (!Number.isFinite(real) || !Number.isFinite(imaginary)) return null;
  const reach = Math.max(2.5 * real, 2.2 * imaginary);
  return {
    kind: "hyperbola",
    expression,
    coefficients,
    anchor: { x: cx, y: cy },
    extent: { x: reach, y: reach },
    radius: null,
  };
}
