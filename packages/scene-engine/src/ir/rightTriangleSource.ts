/** Source-bound sides of a static right triangle; no diagram or topic dispatch. */
import { parseStemNumber, STEM_NUMBER, type PlanQuantity } from "../archetypes/slots";
import { normalized, tokens } from "../archetypes/generators/constantAcceleration";

export type RightTriangleRole = "length" | "distance" | "height";
export type RightTriangleState = Record<RightTriangleRole, number> & { theta: number; cosTheta: number };
export interface SideEvidence { role: RightTriangleRole; value: number; start: number; end: number; quote: string }
export type LadderSourceResolution =
  | { ok: true; state: RightTriangleState; evidence: SideEvidence[]; side: 1 | -1; orientationStated: boolean }
  | { ok: false; reason: string };
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Two independent sides fix the triangle; every extra side remains an obligation. */
export function resolveRightTriangle(sides: Partial<Record<RightTriangleRole, number>>): RightTriangleState | null {
  if (Object.values(sides).some(value => !Number.isFinite(value) || value <= 0)) return null;
  let { length, distance, height } = sides;
  if (distance !== undefined && height !== undefined) length ??= Math.hypot(distance, height);
  if (length !== undefined && distance !== undefined && length > distance) height ??= Math.sqrt((length - distance) * (length + distance));
  if (length !== undefined && height !== undefined && length > height) distance ??= Math.sqrt((length - height) * (length + height));
  if (length === undefined || distance === undefined || height === undefined || ![length, distance, height].every(Number.isFinite) || !(distance > 0 && height > 0)) return null;
  if (!near(length, Math.hypot(distance, height))) return null;
  return { length, distance, height, theta: Math.atan2(height, distance) * 180 / Math.PI, cosTheta: distance / length };
}

const ALIASES: Record<RightTriangleRole | "theta", readonly string[]> = {
  length: ["l", "length", "ladderlength"], distance: ["d", "x", "distance", "footdistance", "base"],
  height: ["h", "y", "height", "topheight"], theta: ["theta", "angle", "θ"],
};
export function rightTriangleQuantityRole(quantity: PlanQuantity): RightTriangleRole | "theta" | null {
  const clean = (s: string) => s.toLowerCase().replace(/[\s_{}\\]/g, "");
  return (Object.keys(ALIASES) as (RightTriangleRole | "theta")[]).find(role => ALIASES[role].includes(clean(quantity.id)) || ALIASES[role].includes(clean(quantity.symbol))) ?? null;
}
export function rightTriangleClaimSIValue(quantity: PlanQuantity, role: RightTriangleRole | "theta"): number | null {
  if (!Number.isFinite(quantity.value)) return null;
  const unit = normalized(quantity.unit ?? "");
  if (role === "theta") return /^(?:degree|degrees|deg|°)$/.test(unit) ? quantity.value : /^(?:rad|radian|radians)$/.test(unit) ? quantity.value * 180 / Math.PI : null;
  const factor = /^(?:m|metres?|meters?)$/.test(unit) ? 1 : /^(?:cm|centimetres?|centimeters?)$/.test(unit) ? 0.01 : /^(?:km|kilometres?|kilometers?)$/.test(unit) ? 1000 : null;
  return factor === null ? null : quantity.value * factor;
}

/**
 * Read dimensions by their source roles, not first-number order or planner slots.
 * The bounded premise is one stationary ladder against a perpendicular wall/floor.
 * Ambiguous, moving, compound, nonperpendicular or extra-dimensional premises decline.
 * Quotes/spans refer to the original source, for parent authority/IR integration.
 */
export function resolveLadderSource(question: string, quantities: readonly PlanQuantity[] = []): LadderSourceResolution {
  const decline = (reason: string): LadderSourceResolution => ({ ok: false, reason });
  const text = normalized(question);
  if ((text.match(/\bladders?\b/g) ?? []).length !== 1 || !/\bwall\b/.test(text)) return decline("one ladder and its wall are required");
  if (/\b(?:two|three|second|another|multiple|moving|moves?|slid\w*|slips?|slipping|velocity|speed|accelerat\w*|rate|rotat\w*|falls?|falling|then|afterwards|inclined|sloping|nonperpendicular|load|person|man|woman|climber|weight|normal|friction|equilibrium|rough|smooth|mass|force|torque|uniform)\b|\bper\s+(?:second|minute)\b/.test(text)) return decline("dynamic, compound or nonperpendicular premises are unsupported");
  const lengths = tokens(text).filter(token => token.dimension === "length");
  const originalTokens = originalLengthTokens(question);
  const evidence: SideEvidence[] = [];
  const sides: Partial<Record<RightTriangleRole, number>> = {};
  for (const token of lengths) {
    const clauseStart = Math.max(text.lastIndexOf(".", token.start - 1), text.lastIndexOf(";", token.start - 1)) + 1;
    const before = text.slice(clauseStart, token.start);
    const after = text.slice(token.end, Math.min(text.length, token.end + 65));
    const roles: RightTriangleRole[] = [];
    if (/\b(?:length|long)\b/.test(before) && /\bladder\b/.test(before) || /^\s*(?:long\s+)?ladder\b/.test(after)) roles.push("length");
    if (/\b(?:foot|base|bottom)\b/.test(before) && /^\s*(?:(?:to\s+the\s+(?:left|right)\s+of|from|away\s+from)\s+the\s+wall|from\s+(?:a|the)\s+wall)/.test(after)) roles.push("distance");
    if (/\b(?:top|height|reaches?|reaching)\b/.test(before) && /^\s*(?:above\s+(?:the\s+)?(?:horizontal\s+)?(?:floor|ground)|(?:high\s+)?(?:up|on)\s+(?:the\s+)?wall)/.test(after)) roles.push("height");
    if (roles.length !== 1) return decline("a source length has no unique triangle-side role");
    const role = roles[0]!;
    if (sides[role] !== undefined) return decline("more than one value for a triangle side");
    sides[role] = token.value;
    // Normalization changes Unicode and whitespace lengths; find the original
    // number/unit token by ordinal rather than reporting normalized offsets.
    const original = originalTokens[evidence.length];
    if (!original) return decline("source span could not be retained");
    evidence.push({ role, value: token.value, ...original });
  }
  const state = resolveRightTriangle(sides);
  if (!state) return decline("two compatible positive source sides are required");
  // A stated angle must also agree; it cannot replace the required side evidence.
  for (const match of text.matchAll(new RegExp(`${STEM_NUMBER}\\s*(?:°|degrees?|deg)(?![a-z])`, "g"))) {
    const angle = parseStemNumber(match[1]!);
    const angleClause = text.slice(Math.max(text.lastIndexOf(".", match.index! - 1) + 1, 0), text.indexOf(".", match.index!) < 0 ? text.length : text.indexOf(".", match.index!));
    if (!/\b(?:floor|ground|horizontal)\b/.test(angleClause) || /\bto (?:the )?wall\b/.test(angleClause)) return decline("only a stated floor angle is supported");
    if (angle === null || !near(angle, state.theta)) return decline("stated angle disagrees with the source sides");
  }
  for (const quantity of quantities) {
    const role = rightTriangleQuantityRole(quantity);
    if (!role) continue;
    const value = rightTriangleClaimSIValue(quantity, role);
    if (value === null || !near(value, state[role])) return decline(`plan ${role} is unsupported or disagrees with source geometry`);
  }
  const footLeft = /\b(?:foot|base|bottom)\b[^.;]*\b(?:to|on) the left (?:of|side of) (?:the )?wall\b/.test(text);
  const footRight = /\b(?:foot|base|bottom)\b[^.;]*\b(?:to|on) the right (?:of|side of) (?:the )?wall\b/.test(text);
  const wallRight = /\bwall (?:is|lies) to the right of (?:the )?(?:foot|base|bottom)\b/.test(text);
  const wallLeft = /\bwall (?:is|lies) to the left of (?:the )?(?:foot|base|bottom)\b/.test(text);
  const left = footLeft || wallRight;
  const right = footRight || wallLeft;
  if (/\b(?:left|right)\b/.test(text) && !left && !right) return decline("source orientation could not be bound");
  if (left && right) return decline("ambiguous source orientation");
  return { ok: true, state, evidence, side: left ? -1 : 1, orientationStated: left || right };
}

function originalLengthTokens(question: string): { start: number; end: number; quote: string }[] {
  return [...question.matchAll(new RegExp(`${STEM_NUMBER}\\s*(?:km|cm|m|kilomet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?)(?![a-zA-Z0-9^/])`, "gi"))].map(match => ({ start: match.index!, end: match.index! + match[0].length, quote: match[0] }));
}
