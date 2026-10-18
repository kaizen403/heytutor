/**
 * projectile_trajectory reads a speed written with no unit as m/s and a launch
 * height written with no unit as m. A planner that copies the bare number from
 * a km/h or cm stem ("speed": 72 for "72 km/h", "initialHeight": 80 for a table
 * "80 cm high") would draw a wrong figure. The scene engine cannot see the plan
 * or the question, so production holds those numbers here, the way it holds
 * optics magnitude literals: against the plan, through the shared plan
 * agreement (validateSceneQuantityAgreement, which converts km/h, cm/s, km/s,
 * cm and km to SI with its usual 1e-9 relative tolerance, and never agrees
 * across a unit it cannot read).
 *
 * - Read: a bare number (a number, a numeric string, a `{ value }` wrapper with
 *   no unit, or a document quantity with no unit) is probed in the working
 *   unit, m/s or m. An inline `{ value, unit }` wrapper is probed in the unit it
 *   states, so `{ value: 72, unit: "m/s" }` is held like a bare 72. Named document
 *   quantities also pass this check: agreement alone cannot bind their launch role.
 * - Speed, in order:
 *   1. Launch speeds: plan givens or derived with a speed unit (SPEED_UNIT)
 *      whose symbol or id, read by `speedRoleKey`, is a launch speed role
 *      (PROJECTILE_SPEED_ROLE; "vi" and "speed" only as givens), or a given written
 *      exactly `v`. The number must agree with every one of them, so two
 *      launch speeds that disagree (a given "vi" that is a final velocity, a
 *      wind speed under the id "speed") refuse rather than pick one. When
 *      a given uses ambiguous "vi" or "speed", all given speeds participate,
 *      including unlisted symbols, so those names cannot hide a disagreement.
 *   2. Else every plan given or derived with a speed unit: the number must
 *      agree with one of them (two bodies each keep their own launch speed).
 *   3. Else a bare number is refused when the question states a speed in a
 *      unit other than m/s (NON_SI_STEM_SPEED); otherwise it keeps the
 *      operator contract's meaning, m/s.
 * - Launch height: when some plan length is not in metres, the number must
 *   agree with one plan length. Zero is the same in every unit and is not held.
 *
 * Every refusal is the scene engine's fatal code for the same failure,
 * invalid_projectile_trajectory_units.
 */
import { validateSceneQuantityAgreement, type TurnPlanV3 } from "@heytutor/scene-engine";

export const PROJECTILE_UNITS_CODE = "invalid_projectile_trajectory_units";

/** Launch speed role keys (NFKC, lower case, letters and digits only). "vi" and "speed" count only as givens. */
export const PROJECTILE_SPEED_ROLE = /^(?:u|u0|ui|v0|vo|vi|speed|launchspeed|initialspeed|projectionspeed|launchvelocity|initialvelocity|projectionvelocity|vlaunch)$/;
/** Plans also write "vi" loosely for a final velocity, and a derived "speed" is a speed found later, like a derived v. */
const GIVEN_ONLY_ROLE = /^(?:vi|speed)$/;
// Preserve Unicode letters: NFKC maps the y subscript to γ, which must not disappear from a component such as v₀ᵧ.
const speedRoleKey = (name: string) => name.normalize("NFKC").toLowerCase().replace(/\\(?:mathrm|text)/g, "").replace(/[^\p{L}\p{N}]/gu, "");

const TIME = "(?:s|secs?|seconds?|h|hrs?|hours?|mins?|minutes?|ghant[ae]|घंटा|घण्टा|घंटे|सेकंड|सेकेंड)";
/** Per time: over a time ("km/h", "km per hr", "km prati ghanta"), a time to the power -1 ("m s⁻¹"), or a named rate. */
const PER_TIME_UNIT = new RegExp(`(?:\\/|\\bper\\b|\\ban\\b|\\bprati\\b|प्रति)\\s*${TIME}$|${TIME}\\s*(?:\\^?\\s*[-−–]\\s*1|⁻¹)$|^(?:mph|kph|kmph|kmh|kmhr|kmphr|fps|kn|kts?|knots?)$`, "iu");
/** Per second squared (g = 980 cm/s^2) and per second per second are accelerations, not speeds. */
const ACCELERATION_UNIT = /(?:s|secs?|seconds?)\s*(?:\^?\s*2|²)|s\s*(?:\^?\s*[-−–]\s*2|⁻²)|squared|per\s+sec(?:ond)?s?\s+per|\/\s*s(?:ecs?)?\s*\/\s*s/i;
/** rad/s and rev/min are angular speeds. */
const ANGULAR_UNIT = /\b(?:rad|radians?|revs?|revolutions?|deg|degrees?|rpm)\b|°/i;

/** Dots that abbreviate ("km./hr.", "k.m./h", "m.p.h."), never a decimal point. */
const undot = (unit: string) => unit.replace(/(?<!\d)\.|\.(?!\d)/g, "").trim().replace(/\s+/g, " ");

/** A unit that measures a linear speed: per time, and neither an acceleration nor an angular speed. */
export function isSpeedUnit(unit: unknown): unit is string {
  if (typeof unit !== "string" || !unit.trim()) return false;
  const spelled = undot(unit);
  return PER_TIME_UNIT.test(spelled) && !ACCELERATION_UNIT.test(spelled) && !ANGULAR_UNIT.test(spelled);
}

/** Shared length vocabulary for plan quantities and speeds stated per minute. */
const LENGTH_UNIT_SOURCE = "(?:[kcmµμnd]?m|(?:kilo|centi|milli)?met(?:re|er)s?|ft|feet|foot|in|inch(?:es)?|yds?|yards?|mi|miles?|सेमी|सेंटीमीटर|मिमी|मीटर|मी|किमी)";
const LENGTH_UNIT = new RegExp(`^${LENGTH_UNIT_SOURCE}$`, "iu");

// Per second, never per second squared (g = 980 cm/s^2 is not a speed).
const PER_SECOND = "(?:\\s*\\/\\s*s(?:ec(?:ond)?)?(?![A-Za-z0-9^²³]|\\s*\\/)|[\\s·⋅*]*s(?:\\^?[-−–]1|⁻¹)(?!\\d)|\\s+per\\s+second\\b(?!\\s+(?:squared|per)))";
const PER_HOUR = "(?:\\.?\\s*\\/\\s*h(?:r|our)?\\b\\.?|[\\s·⋅*]*h(?:r|our)?(?:\\^?[-−–]1|⁻¹)(?!\\d)|\\.?\\s+(?:per|prati)\\s+(?:hour|hr|ghant[ae])\\b|\\s+an\\s+hour\\b|\\s*\\/\\s*ghant[ae]\\b)";
const PER_MINUTE = "(?:\\s*\\/\\s*min(?:ute)?s?(?![A-Za-z0-9]|\\s*(?:[²³^/]|squared\\b|per\\b))|[\\s·⋅*]*min(?:ute)?s?(?:\\^?[-−–]1|⁻¹)(?!\\d)|\\s+(?:per|a)\\s+min(?:ute)?s?\\b(?!\\s*(?:[²³^]|squared\\b|per\\b)))";
/**
 * A number followed by a speed unit other than m/s: km/h (kmph, kmh, kmhr, kph,
 * km hr^-1, km./hr., k.m./h, kilometres per hour, km/ghanta, km prati ghanta,
 * किमी प्रति घंटा), mph (mi/h, m.p.h., miles per hour, nautical miles per hour),
 * ft/s, fps, cm/s, mm/s, km/s, lengths per minute and knots. m/s itself, and accelerations such as
 * cm/s^2, never match.
 */
const NON_SI_STEM_SPEED = new RegExp(`(?<![\\d.,])\\d(?:[\\d.,]*\\d)?\\s*(?:(?:km|k\\.m|kilomet(?:re|er)s?)${PER_HOUR}|kmph\\b|kmh\\b|kmhr\\b|kmphr\\b|kph\\b|mph\\b|m\\.p\\.h\\b|(?:mi|(?:nautical\\s+)?miles?)${PER_HOUR}|(?:ft|feet|foot)${PER_SECOND}|fps\\b|(?:cm|mm|km|(?:centi|milli|kilo)met(?:re|er)s?)${PER_SECOND}|${LENGTH_UNIT_SOURCE}${PER_MINUTE}|knots?\\b|किमी\\s*(?:\\/|प्रति)\\s*(?:घंटा|घण्टा))`, "iu");
/** Knots written "kn"; case sensitive so a force in kN never reads as a speed. */
const STEM_KNOTS = /(?<![\d.,])\d(?:[\d.,]*\d)?\s*kn\b/;


type PlanQuantity = TurnPlanV3["givens"][number];
type UnitsIssue = { code: string; message: string; path: string; severity: "fatal" };
type ReadNumber = { value: number; unit?: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The number an input names and its stated unit, including named document quantities.
 * Unit conflicts remain the engine's responsibility; this check binds the value to its plan role.
 */
function readNumber(value: unknown, quantities: ReadonlyMap<string, Record<string, unknown>>, unit?: string, depth = 0): ReadNumber | null {
  if (depth > 32) return null;
  if (typeof value === "number") return Number.isFinite(value) ? { value, unit } : null;
  if (isPlainRecord(value)) {
    if (value.unit !== undefined && typeof value.unit !== "string") return null;
    return readNumber(value.value, quantities, unit ?? (typeof value.unit === "string" && value.unit.trim() ? value.unit : undefined), depth + 1);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const quantity = quantities.get(value);
  if (quantity) return readNumber(quantity, quantities, unit, depth + 1);
  const number = Number(value.trim());
  return Number.isFinite(number) ? { value: number, unit } : null;
}

/**
 * The shared plan agreement converts km/h, cm/s and km/s, but not the other ways a stem spells them: it reads
 * "ms^-1" as per millisecond and does not know "kmph" or "metres per second". Spell the speed forms it can
 * convert out, and drop abbreviating dots ("km./hr."); any other unit (mph, ft/s, knots) stays unreadable, so it
 * still fails closed.
 */
function speedUnitSpelling(unit: string): string {
  const undotted = undot(unit);
  const compact = undotted.replace(/\s+/g, "");
  if (/^ms(?:\^?[-−–]1|⁻¹)$/.test(compact)) return "m/s";
  if (/^kmh(?:r|our)?(?:\^?[-−–]1|⁻¹)$/i.test(compact)) return "km/h";
  const words = undotted.toLowerCase();
  if (/^(?:kmph|kmh|kmhr|kmphr|kph|km ?\/ ?ghant[ae]|km (?:per|an|prati) (?:h(?:r|our)?|ghant[ae])|kilomet(?:re|er)s? (?:per|an) hour|किमी ?(?:\/|प्रति) ?(?:घंटा|घण्टा))$/u.test(words)) return "km/h";
  if (/^(?:met(?:re|er)s? per second|m per s(?:ec(?:ond)?)?)$/.test(words)) return "m/s";
  if (/^(?:centimet(?:re|er)s? per second|cm per s(?:ec(?:ond)?)?)$/.test(words)) return "cm/s";
  if (/^(?:kilomet(?:re|er)s? per second|km per s(?:ec(?:ond)?)?)$/.test(words)) return "km/s";
  return undotted;
}

/** The metric lengths the shared plan agreement converts, in the spelling it reads; any other length is left as written. */
function lengthUnitSpelling(unit: string): string {
  const word = undot(unit).toLowerCase();
  if (/^(?:m|met(?:re|er)s?|मीटर|मी)$/u.test(word)) return "m";
  if (/^(?:cm|centimet(?:re|er)s?|सेमी|सेंटीमीटर)$/u.test(word)) return "cm";
  if (/^(?:mm|millimet(?:re|er)s?|मिमी)$/u.test(word)) return "mm";
  if (/^(?:km|kilomet(?:re|er)s?|किमी)$/u.test(word)) return "km";
  return undot(unit);
}

const isFiniteQuantity = (quantity: PlanQuantity) => typeof quantity.value === "number" && Number.isFinite(quantity.value);
const writtenNames = (quantity: PlanQuantity) =>
  [quantity.symbol, quantity.id].filter((text): text is string => typeof text === "string" && text.trim() !== "");

function isLaunchSpeed(quantity: PlanQuantity, given: boolean): boolean {
  const keys = writtenNames(quantity).map(speedRoleKey);
  if (keys.some((key) => PROJECTILE_SPEED_ROLE.test(key) && (given || !GIVEN_ONLY_ROLE.test(key)))) return true;
  // Plain v is the launch speed only when the stem states it; a derived v is a later speed.
  return given && writtenNames(quantity).some((text) => /^v$/i.test(text.normalize("NFKC").trim()));
}

const describe = (quantity: PlanQuantity) => `${quantity.symbol ?? quantity.id} = ${Math.abs(quantity.value)} ${quantity.unit}`;
const stated = (read: ReadNumber, working: string) => read.unit === undefined ? `the bare number ${read.value}, which projectile_trajectory reads as ${read.value} ${working}` : `${read.value} ${read.unit}`;

/** Fatal issues for projectile_trajectory speeds and launch heights whose number the plan or question contradicts. */
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
  // Speed and height are magnitudes: a plan that signs its launch velocity or its drop still names the same one.
  const magnitude = (quantity: PlanQuantity, spelling: (unit: string) => string): PlanQuantity =>
    ({ ...quantity, value: Math.abs(quantity.value), unit: spelling(quantity.unit!) });
  const speedsOf = (list: PlanQuantity[], given: boolean) => list.filter((quantity) => isFiniteQuantity(quantity) && isSpeedUnit(quantity.unit))
    .map((quantity) => ({ quantity: magnitude(quantity, speedUnitSpelling), launch: isLaunchSpeed(quantity, given), given,
      ambiguous: given && writtenNames(quantity).some((name) => GIVEN_ONLY_ROLE.test(speedRoleKey(name))) }));
  const speeds = [...speedsOf(plan.givens, true), ...speedsOf(plan.derived, false)];
  const ambiguousLaunch = speeds.some((speed) => speed.launch && speed.ambiguous);
  const launchSpeeds = speeds.filter((speed) => speed.launch || (ambiguousLaunch && speed.given)).map((speed) => speed.quantity);
  const rateSpeeds = speeds.map((speed) => speed.quantity);
  const lengths = [...plan.givens, ...plan.derived]
    .filter((quantity) => isFiniteQuantity(quantity) && typeof quantity.unit === "string" && LENGTH_UNIT.test(undot(quantity.unit)))
    .map((quantity) => magnitude(quantity, lengthUnitSpelling));
  const lengthsHeld = lengths.some((quantity) => quantity.unit !== "m");
  // Qualitative claims never support a literal. A probe id no plan writes, so agreement matches by value and unit.
  const agrees = (id: string, read: ReadNumber, working: string, against: PlanQuantity[]) =>
    validateSceneQuantityAgreement([{ id, value: read.value, unit: read.unit ?? working }],
      { ...plan, givens: against, derived: [], qualitativeClaims: [] }).length === 0;
  const stemSpeed = (NON_SI_STEM_SPEED.exec(question) ?? STEM_KNOTS.exec(question))?.[0];
  const issues: UnitsIssue[] = [];
  constructions.forEach((construction, index) => {
    if (!isPlainRecord(construction) || construction.operator !== "projectile_trajectory" || !isPlainRecord(construction.inputs)) return;
    const name = String(construction.id ?? "projectile_trajectory");
    const refuse = (input: string, message: string) =>
      issues.push({ code: PROJECTILE_UNITS_CODE, path: `constructions[${index}].inputs.${input}`, severity: "fatal", message });

    const speed = readNumber(construction.inputs.speed, quantities);
    if (speed) {
      const read = speed.unit === undefined ? speed : { ...speed, unit: speedUnitSpelling(speed.unit) };
      const probe = `projectile_trajectory:${name}:speed`;
      const fix = "write the speed as that plan quantity or as { value, unit } in the unit the question states";
      if (launchSpeeds.length > 0) {
        // Bound to the launch role: the number must be every launch speed the plan names, never one of several.
        if (!launchSpeeds.every((quantity) => agrees(probe, read, "m/s", [quantity]))) {
          const several = launchSpeeds.length > 1 && !launchSpeeds.every((quantity) => agrees(probe, { value: quantity.value, unit: quantity.unit }, "m/s", [launchSpeeds[0]!]));
          refuse("speed", several
            ? `${name} speed is ${stated(speed, "m/s")}, but the plan names launch speeds that disagree (${launchSpeeds.map(describe).join(" and ")}), so none can be picked as the launch speed; ${fix}`
            : `${name} speed is ${stated(speed, "m/s")}, but the plan's launch speed is ${launchSpeeds.map(describe).join(" and ")}; ${fix}`);
        }
      } else if (rateSpeeds.length > 0) {
        // No launch role: the number must be one of the plan's speeds, in the unit the planner wrote for it.
        if (!agrees(probe, read, "m/s", rateSpeeds)) {
          refuse("speed", `${name} speed is ${stated(speed, "m/s")}, which is none of the plan's speeds (${rateSpeeds.map(describe).join(", ")}); ${fix}`);
        }
      } else if (speed.unit === undefined && stemSpeed) {
        refuse("speed", `${name} speed is ${stated(speed, "m/s")}, but the question states a speed as "${stemSpeed.trim()}" and the plan names no speed to hold it to; write the speed as { value, unit }`);
      }
    }

    const height = construction.inputs.initialHeight === undefined ? null : readNumber(construction.inputs.initialHeight, quantities);
    if (height && height.value !== 0 && lengthsHeld) {
      const read = height.unit === undefined ? height : { ...height, unit: lengthUnitSpelling(height.unit) };
      if (!agrees(`projectile_trajectory:${name}:initialHeight`, read, "m", lengths)) {
        refuse("initialHeight", `${name} initialHeight is ${stated(height, "m")}, but the plan states lengths in other units (${lengths.map(describe).join(", ")}) and none of them is that height; write the height as that plan quantity or as { value, unit }`);
      }
    }
  });
  return issues;
}
