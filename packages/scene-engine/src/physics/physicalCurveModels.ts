import { parseMathExpression } from "../math/expression";

const NUMBER = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
const DECAY = new RegExp(`^(?:(${NUMBER})\\*)?exp\\(-(?:(ln\\(2\\)|log\\(2\\)|${NUMBER})\\*)?x(?:/(${NUMBER}))?\\)$`);
const CONSTANT_BASE_DECAY = new RegExp(`^(?:(${NUMBER})\\*)?(${NUMBER})\\^\\(-(?:(${NUMBER})\\*)?x(?:/(${NUMBER}))?\\)$`);
const BINDING = new RegExp(`^(${NUMBER})\\*\\(1-exp\\(-x(?:/(${NUMBER}))?\\)\\)-(${NUMBER})\\*x$`);
const UNIT_BINDING = new RegExp(`^1-exp\\(-x(?:/(${NUMBER}))?\\)-(${NUMBER})\\*x$`);
const PRODUCT_BINDING = new RegExp(`^(?:(${NUMBER})\\*)?\\(1-exp\\(-x(?:/(${NUMBER}))?\\)\\)\\*exp\\(-x(?:/(${NUMBER}))?\\)$`);
const MASS_FORMULA_BINDING = new RegExp(`^(${NUMBER})-(${NUMBER})\\*x\\^\\(-1/3\\)-(${NUMBER})\\*x\\^\\(2/3\\)$`);

function ungroup(text: string): string {
  while (text.startsWith("(")) {
    let depth = 0, end = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      if (text[i] === ")" && --depth === 0) { end = i; break; }
    }
    if (end !== text.length - 1) break;
    text = text.slice(1, -1);
  }
  return text;
}

/** Peel only actual top-level products with positive numeric literals. The
 * parser decides their scope: A*f(x)-B*x is never mistaken for A*(f(x)-B*x).
 * Positive display scaling preserves every derivative sign and peak position. */
function positiveOuterScale(raw: string): { body: string; scale: number } {
  let body = ungroup(raw), scale = 1;
  for (let step = 0; step < 32; step++) {
    const node = JSON.parse(parseMathExpression(body).syntaxKey);
    if (node.kind !== "binary" || node.operator !== "*" || node.left?.kind !== "number" ||
        typeof node.left.literal !== "string" || !new RegExp(`^${NUMBER}$`).test(node.left.literal) ||
        !(node.left.value > 0) || !Number.isFinite(node.left.value)) break;
    let depth = 0, product = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "(") depth++;
      if (body[i] === ")") depth--;
      if (body[i] === "*" && depth === 0) { product = i; break; }
    }
    if (product < 0) break;
    scale *= node.left.value;
    body = ungroup(body.slice(product + 1));
  }
  return { body, scale };
}

/** Closed expression classes prove behavior between samples as well as at them. */
export function analyzePhysicalCurve(expression: string, xMin: number, xMax: number, kind: "decay" | "binding") {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin < 0 || !(xMax > xMin)) return null;
  const raw = expression.toLowerCase().replace(/\s+/g, "");
  const parsed = parseMathExpression(raw);
  parsed.assertContinuousOn(xMin, xMax);
  const { body: text, scale: outerScale } = positiveOuterScale(raw);
  if (!(outerScale > 0) || !Number.isFinite(outerScale)) return null;
  if (kind === "decay") {
    const match = DECAY.exec(text);
    const power = CONSTANT_BASE_DECAY.exec(text);
    if (!match && !power) return null;
    const amplitude = outerScale * Number(match?.[1] ?? power?.[1] ?? 1);
    const base = Number(power?.[2]);
    // For finite b>1, A*b^(-k*x/d) = A*exp(-k*ln(b)*x/d).
    // Positive k/d proves monotone decay on the whole supported domain;
    // sampled points alone supply no such proof. Keep the original expression.
    if (power && (!(base > 1) || !Number.isFinite(base))) return null;
    const coefficient = match ? match[2]?.startsWith("l") ? Math.LN2 : Number(match[2] ?? 1) : Number(power?.[3] ?? 1) * Math.log(base);
    const divisor = Number(match?.[3] ?? power?.[4] ?? 1), rate = coefficient / divisor;
    if (![amplitude, rate].every(value => value > 0 && Number.isFinite(value)) || !(parsed.evaluate(xMax) > 0)) return null;
    return { amplitude, rate, normalizedPopulation: amplitude === 1, halfLifeParameter: Math.LN2 / rate, normalizedHalfLifeTime: Math.abs(rate - Math.LN2) < 32 * Number.EPSILON };
  }
  const match = BINDING.exec(text), unitMatch = UNIT_BINDING.exec(text), product = PRODUCT_BINDING.exec(text), mass = MASS_FORMULA_BINDING.exec(text);
  let peak: number;
  if (mass) {
    const volume = Number(mass[1]), surface = Number(mass[2]), charge = Number(mass[3]);
    if (!(xMin > 0) || ![volume, surface, charge].every(value => value > 0 && Number.isFinite(value))) return null;
    // f(x)=a-b*x^(-1/3)-c*x^(2/3). On x>0 its derivative is
    // x^(-4/3)*(b-2*c*x)/3: one zero, positive before and negative
    // after. The endpoint tests below therefore bound its entire domain.
    peak = surface / (2 * charge);
  } else if (product) {
    const height = Number(product[1] ?? 1), scale = Number(product[2] ?? 1), tailScale = Number(product[3] ?? 1);
    if (![height, scale, tailScale].every(value => value > 0 && Number.isFinite(value))) return null;
    // h(e^-x/b - e^-x(1/a+1/b)) has exactly one derivative zero:
    // e^-x/a = a/(a+b). Its derivative changes from positive to negative.
    peak = scale * Math.log1p(tailScale / scale);
  } else {
    if (!match && !unitMatch) return null;
    const height = Number(match?.[1] ?? 1), scale = Number(match?.[2] ?? unitMatch?.[1] ?? 1), slope = Number(match?.[3] ?? unitMatch?.[2]);
    if (![height, scale, slope].every(value => value > 0 && Number.isFinite(value)) || !(height / scale > slope)) return null;
    peak = scale * Math.log(height / (scale * slope));
  }
  const peakFraction = (peak - xMin) / (xMax - xMin);
  if (!Number.isFinite(peak) || !(peakFraction >= 0.05 && peakFraction <= 0.75)) return null;
  const maximum = parsed.evaluate(peak), end = parsed.evaluate(xMax);
  // Both closed classes have one maximum and their minimum is at a domain endpoint.
  if (parsed.evaluate(xMin) < 0 || !(maximum > 0) || end < 0.75 * maximum) return null;
  return { peak, maximum };
}
