/**
 * A projectile_trajectory speed written with no unit is read by the operator
 * as m/s. A planner that copies the bare number from a km/h stem ("speed": 72
 * for "72 km/h") would draw 72 m/s, a wrong figure. The scene engine cannot
 * see the plan or the question, so production holds that bare number here,
 * the way it holds optics magnitude literals: against the plan quantity of its
 * own role, through the shared plan agreement (validateSceneQuantityAgreement,
 * which converts km/h, cm/s and km/s to m/s with its usual 1e-9 relative
 * tolerance).
 *
 * - Bare: no unit is stated anywhere along the input (a number, a numeric
 *   string, a `{ value }` wrapper with no unit, or a document quantity with no
 *   unit). A stated unit is the scene engine's job and is not read here.
 * - Speed quantity: a plan given or derived whose symbol or id, read by
 *   `motionSymbolKey`, is a launch speed (PROJECTILE_SPEED_ROLE), or a given
 *   written exactly `v`, whose unit is a rate (SPEED_RATE_UNIT). A derived `v`
 *   is a later speed, and a `u` in cm or V is an optics distance or a voltage,
 *   so neither stands in.
 * - Rule: with a speed quantity, the bare number as m/s must equal one of
 *   them in SI, else refuse. With none, refuse when the question states a
 *   speed in a unit other than m/s (NON_SI_STEM_SPEED); otherwise the number
 *   keeps the operator contract's meaning, m/s.
 *
 * Every refusal is the scene engine's fatal code for the same failure,
 * invalid_projectile_trajectory_units.
 */
import { motionSymbolKey, validateSceneQuantityAgreement, type TurnPlanV3 } from "@heytutor/scene-engine";

export const PROJECTILE_UNITS_CODE = "invalid_projectile_trajectory_units";

/** Launch speed role keys (motionSymbolKey: NFKC, lower case, letters and digits only). */
export const PROJECTILE_SPEED_ROLE = /^(?:u|u0|ui|v0|vo|vi|speed|launchspeed|initialspeed|projectionspeed|launchvelocity|initialvelocity|projectionvelocity|vlaunch)$/;

/** A unit that measures per time: a slash, "per", "an hour", a -1 power, or a named rate. Lengths, volts and degrees are not. */
const SPEED_RATE_UNIT = /\/|\bper\b|\ban\s+hour\b|(?:\^?[-−–]1|⁻¹)\s*$|^(?:mph|kph|kmph|kmh|knots?)$/i;

// Per second, never per second squared (g = 980 cm/s^2 is not a speed).
const PER_SECOND = "(?:\\s*\\/\\s*s(?:ec(?:ond)?)?(?![A-Za-z0-9^²³]|\\s*\\/)|[\\s·⋅*]*s(?:\\^?[-−–]1|⁻¹)(?!\\d)|\\s+per\\s+second\\b(?!\\s+(?:squared|per)))";
const PER_HOUR = "(?:\\s*\\/\\s*h(?:r|our)?\\b|[\\s·⋅*]*h(?:\\^?[-−–]1|⁻¹)(?!\\d)|\\s+per\\s+hour\\b|\\s+an\\s+hour\\b)";
/**
 * A number followed by a speed unit other than m/s: km/h (kmph, kmh, kph,
 * kilometres per hour), mph (mi/h, miles per hour), ft/s, cm/s, mm/s, km/s
 * and knots. m/s itself, and accelerations such as cm/s^2, never match.
 */
const NON_SI_STEM_SPEED = new RegExp(`(?<![\\d.,])\\d(?:[\\d.,]*\\d)?\\s*(?:(?:km|kilomet(?:re|er)s?)${PER_HOUR}|kmph\\b|kmh\\b|kph\\b|mph\\b|(?:mi|miles?)${PER_HOUR}|(?:ft|feet|foot)${PER_SECOND}|(?:cm|mm|km|(?:centi|milli|kilo)met(?:re|er)s?)${PER_SECOND}|knots?\\b)`, "i");

type PlanQuantity = TurnPlanV3["givens"][number];
type UnitsIssue = { code: string; message: string; path: string; severity: "fatal" };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The bare number an input names, or null when a unit is stated on the way or no finite number is found. */
function bareNumber(value: unknown, quantities: ReadonlyMap<string, Record<string, unknown>>, depth = 0): number | null {
  if (depth > 32) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isPlainRecord(value)) {
    if (value.unit !== undefined) return null;
    return bareNumber(value.value, quantities, depth + 1);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const quantity = quantities.get(value);
  if (quantity) return quantity.unit !== undefined ? null : bareNumber(quantity.value, quantities, depth + 1);
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

/**
 * The shared plan agreement converts km/h, cm/s and km/s, but not the other ways a stem spells them: it reads
 * "ms^-1" as per millisecond and does not know "kmph" or "metres per second". Spell the speed forms it can
 * convert out; any other unit (mph, ft/s, knots) is left as written, so it still fails closed.
 */
function speedUnitSpelling(unit: string): string {
  const compact = unit.trim().replace(/\s+/g, "");
  if (/^ms(?:\^?[-−–]1|⁻¹)$/.test(compact)) return "m/s";
  if (/^kmh(?:\^?[-−–]1|⁻¹)$/i.test(compact)) return "km/h";
  const words = unit.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(?:kmph|kmh|kph|km (?:per|an) h(?:r|our)?|kilomet(?:re|er)s? (?:per|an) hour)$/.test(words)) return "km/h";
  if (/^(?:met(?:re|er)s? per second|m per s(?:ec(?:ond)?)?)$/.test(words)) return "m/s";
  if (/^(?:centimet(?:re|er)s? per second|cm per s(?:ec(?:ond)?)?)$/.test(words)) return "cm/s";
  if (/^(?:kilomet(?:re|er)s? per second|km per s(?:ec(?:ond)?)?)$/.test(words)) return "km/s";
  return unit;
}

function isSpeedQuantity(quantity: PlanQuantity, given: boolean): boolean {
  if (typeof quantity.unit !== "string" || !SPEED_RATE_UNIT.test(quantity.unit.trim())) return false;
  if (typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return false;
  const written = [quantity.symbol, quantity.id].filter((text): text is string => typeof text === "string" && text.trim() !== "");
  if (written.some((text) => PROJECTILE_SPEED_ROLE.test(motionSymbolKey(text)))) return true;
  // Plain v is the launch speed only when the stem states it; a derived v is a later speed.
  return given && written.some((text) => /^v$/i.test(text.normalize("NFKC").trim()));
}

const describe = (quantity: PlanQuantity) => `${quantity.symbol ?? quantity.id} = ${Math.abs(quantity.value)} ${quantity.unit}`;

/** Fatal issues for projectile_trajectory speeds written as bare numbers that the plan or question contradicts. */
export function projectileSpeedLiteralIssues(
  document: { quantities?: unknown; constructions?: unknown },
  plan: TurnPlanV3,
  question: string,
): UnitsIssue[] {
  const constructions = Array.isArray(document.constructions) ? document.constructions : [];
  if (!constructions.some((construction) => isPlainRecord(construction) && construction.operator === "projectile_trajectory")) return [];
  const quantities = new Map((Array.isArray(document.quantities) ? document.quantities : [])
    .filter(isPlainRecord).filter((quantity) => typeof quantity.id === "string")
    .map((quantity) => [quantity.id as string, quantity]));
  // Speed is a magnitude: a plan that signs its launch velocity still names the same speed.
  const magnitude = (quantity: PlanQuantity): PlanQuantity =>
    ({ ...quantity, value: Math.abs(quantity.value), unit: speedUnitSpelling(quantity.unit!) });
  const givens = plan.givens.filter((quantity) => isSpeedQuantity(quantity, true)).map(magnitude);
  const derived = plan.derived.filter((quantity) => isSpeedQuantity(quantity, false)).map(magnitude);
  const speeds = [...givens, ...derived];
  // Qualitative claims never support a literal.
  const speedPlan: TurnPlanV3 = { ...plan, givens, derived, qualitativeClaims: [] };
  const stemSpeed = NON_SI_STEM_SPEED.exec(question)?.[0];
  const issues: UnitsIssue[] = [];
  constructions.forEach((construction, index) => {
    if (!isPlainRecord(construction) || construction.operator !== "projectile_trajectory" || !isPlainRecord(construction.inputs)) return;
    const literal = bareNumber(construction.inputs.speed, quantities);
    if (literal === null) return;
    const path = `constructions[${index}].inputs.speed`;
    const name = String(construction.id ?? "projectile_trajectory");
    if (speeds.length > 0) {
      // A probe id no plan writes, so agreement matches by value and unit against the speeds only.
      const disagreement = validateSceneQuantityAgreement([{ id: `projectile_trajectory:${name}:bare_speed`, value: literal, unit: "m/s" }], speedPlan);
      if (disagreement.length === 0) return;
      issues.push({
        code: PROJECTILE_UNITS_CODE, path, severity: "fatal",
        message: `${name} speed is the bare number ${literal}, which projectile_trajectory reads as ${literal} m/s, but the plan's launch speed is ${speeds.map(describe).join(" or ")}; write the speed as that plan quantity or as { value, unit }`,
      });
      return;
    }
    if (!stemSpeed) return;
    issues.push({
      code: PROJECTILE_UNITS_CODE, path, severity: "fatal",
      message: `${name} speed is the bare number ${literal}, which projectile_trajectory reads as ${literal} m/s, but the question states a speed as "${stemSpeed.trim()}" and the plan names no launch speed to hold it to; write the speed as { value, unit }`,
    });
  });
  return issues;
}
