/**
 * The source reader for one thin lens or one spherical mirror.
 *
 * Every length keeps the unit it was written in. The slots stay in
 * centimetres (the catalog unit) so geometry is unchanged, and the stated
 * unit rides along as the `unit` slot, so a figure for "0.60 m in front of a
 * convex mirror" says "u=0.6 m", never "u=0.6 cm" or "u=60 cm".
 *
 * The lens kind comes from the stem's words and the sign of its power or
 * focal length; a −2.0 D lens is diverging even when the stem never says so.
 * Words and signs that disagree set the `conflict` slot and the generator
 * declines. A stem that names more than one optical element is never drawn
 * as one lens or one mirror (`namesSeveralOpticalElements`).
 */
import { STEM_NUMBER, parseStemNumber, setSlot, type PlanQuantity, type SlotBag } from "./slots";

export type OpticsLengthUnit = "cm" | "mm" | "m";

/** Centimetres per unit, exact. */
export const CM_PER_UNIT: Readonly<Record<OpticsLengthUnit, number>> = { cm: 1, mm: 0.1, m: 100 };

export interface StatedLength {
  /** Signed value in centimetres. */
  cm: number;
  unit: OpticsLengthUnit;
}

const LENGTH_UNIT = String.raw`cm|mm|metres?|meters?|m`;

export function lengthUnitKey(raw: unknown): OpticsLengthUnit | null {
  if (typeof raw !== "string") return null;
  const unit = raw.trim().toLowerCase();
  if (unit === "cm" || unit === "centimetre" || unit === "centimetres" || unit === "centimeter" || unit === "centimeters") return "cm";
  if (unit === "mm" || unit === "millimetre" || unit === "millimetres" || unit === "millimeter" || unit === "millimeters") return "mm";
  if (unit === "m" || unit === "metre" || unit === "metres" || unit === "meter" || unit === "meters") return "m";
  return null;
}

function stated(raw: string, unit: string): StatedLength | null {
  const value = parseStemNumber(raw);
  const key = lengthUnitKey(unit);
  if (value === null || key === null) return null;
  return { cm: value * CM_PER_UNIT[key], unit: key };
}

/** The clause before `index`, back to the last sentence or clause break. */
function clauseBefore(stem: string, index: number): string {
  const before = stem.slice(0, index);
  const cut = Math.max(before.lastIndexOf("."), before.lastIndexOf(";"), before.lastIndexOf(","), before.lastIndexOf("?"));
  return before.slice(cut + 1);
}

/** The last of "image" and "object" a clause names: whose distance a length there is. */
function lastRoleNoun(clause: string): "image" | "object" | null {
  const nouns = [...clause.matchAll(/\b(image|object)s?\b/gi)];
  const last = nouns[nouns.length - 1]?.[1]?.toLowerCase();
  return last === "image" || last === "object" ? last : null;
}

/**
 * Every "<number> <unit> <phrase>" in the stem ("30 cm in front of"), with
 * a sign written as "+" allowed. A length in a clause whose last role noun
 * is the image ("its image is 60 cm in front of") is the image distance,
 * never the object's ("forms an image of an object placed 15 cm away" is).
 */
function lengthsBefore(stem: string, phrase: RegExp): StatedLength[] {
  const pattern = new RegExp(`${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b\\s*(?:${phrase.source})`, "gi");
  return [...stem.matchAll(pattern)].flatMap((match) =>
    lastRoleNoun(clauseBefore(stem, match.index ?? 0)) === "image" ? [] : [stated(match[1]!, match[2]!)].filter((item): item is StatedLength => item !== null));
}

function lengthAfter(stem: string, phrase: RegExp): StatedLength | null {
  const pattern = new RegExp(`(?:${phrase.source})[^0-9\\-]{0,24}${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b`, "i");
  const match = pattern.exec(stem);
  return match ? stated(match[1]!, match[2]!) : null;
}

function symbolLength(stem: string, symbol: RegExp): StatedLength | null {
  const pattern = new RegExp(`(?:^|[^a-z])(?:${symbol.source})\\s*[=:]\\s*\\+?${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b`, "i");
  const match = pattern.exec(stem);
  return match ? stated(match[1]!, match[2]!) : null;
}

/** A named length with no unit at all ("focal length 10") means centimetres. */
function unitlessAfter(stem: string, phrase: RegExp): StatedLength | null {
  const pattern = new RegExp(`(?:${phrase.source})[^0-9\\-]{0,24}${STEM_NUMBER}(?!\\s*(?:${LENGTH_UNIT}|D)\\b)(?!\\s*[a-zA-Z])`, "i");
  const match = pattern.exec(stem);
  const value = match ? parseStemNumber(match[1]!) : null;
  return value === null ? null : { cm: value, unit: "cm" };
}

const OBJECT_PLACEMENT = /object distance(?: of| is| =)?|(?:the )?object(?: is)?(?:\s+(?:placed|kept|located|positioned))?\s+at|placed at(?: a distance of)?|distance of/;
const AWAY_FROM = /(?:from|in front of|away(?:\s+from)?|before|to (?:the|its) left(?: of)?)/;
/** "held 6.0 cm above a stamp": a lens over a page. A height above the axis is never a distance. */
const HELD_OVER = /(?:held|kept|placed|positioned|mounted)\s+/;
const FOCAL_LENGTH = /focal length(?: of| is| =)?/;
const RADIUS_OF_CURVATURE = /radius of curvature(?: of| is| =)?/;

function heldOver(stem: string): StatedLength | null {
  const pattern = new RegExp(`(?:${HELD_OVER.source})${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b\\s*(?:above|over|below)\\s+(?!(?:the\\s+)?(?:principal\\s+)?axis\\b)`, "i");
  const match = pattern.exec(stem);
  return match ? stated(match[1]!, match[2]!) : null;
}

export function objectDistanceFromStem(stem: string): StatedLength | null {
  return lengthsBefore(stem, AWAY_FROM)[0]
    ?? heldOver(stem)
    ?? lengthAfter(stem, OBJECT_PLACEMENT)
    ?? symbolLength(stem, /u/)
    ?? unitlessAfter(stem, OBJECT_PLACEMENT);
}

export function focalLengthFromStem(stem: string): StatedLength | null {
  return lengthAfter(stem, FOCAL_LENGTH) ?? symbolLength(stem, /f/) ?? unitlessAfter(stem, FOCAL_LENGTH);
}

export function radiusOfCurvatureFromStem(stem: string): StatedLength | null {
  return lengthAfter(stem, RADIUS_OF_CURVATURE) ?? symbolLength(stem, /R/) ?? unitlessAfter(stem, RADIUS_OF_CURVATURE);
}

/** Every power in dioptres the stem states ("+5.0 D", "-2.0 dioptre"), signed. */
export function powersFromStem(stem: string): number[] {
  const pattern = new RegExp(`(\\+)?${STEM_NUMBER}\\s*(?:D(?![A-Za-z])|[dD]iopt(?:re|er)s?\\b)`, "g");
  return [...stem.matchAll(pattern)].flatMap((match) => {
    const value = parseStemNumber(match[2]!);
    return value === null || value === 0 ? [] : [value];
  });
}

const ELEMENT_NOUN = String.raw`(?:lens(?:es)?|mirrors?)`;

/**
 * True when the stem names more than one optical element: two or a pair of
 * lenses or mirrors, a second or another element, plural elements, a lens
 * and a mirror, two separately introduced elements ("a diverging lens ...
 * a converging lens"), lenses named A and B, or the words of a compound
 * system (combination, in contact, apart, an intermediate image).
 */
export function namesSeveralOpticalElements(question: string): boolean {
  const stem = question.replace(/[–—−]/g, "-").replace(/\s+/g, " ");
  if (new RegExp(String.raw`\b(?:two|three|four|2|3|pair of|both|second|another|other|each)\s+(?:[\w-]+\s+){0,2}?${ELEMENT_NOUN}\b`, "i").test(stem)) return true;
  // A plural element in a stem with measured values is several elements; in
  // a topic ask ("spherical mirrors and the mirror formula") it is the class.
  if (/\b(?:lenses|mirrors)\b/i.test(stem) && /\d+(?:\.\d+)?\s*(?:cm|mm|m|D)\b/.test(stem)) return true;
  if (/\blens\b/i.test(stem) && /\bmirrors?\b/i.test(stem)) return true;
  // "Final image" alone is not one: a magnifier's final image is at the near point.
  if (/\b(?:combination|in contact|coaxial|intermediate image|apart)\b/i.test(stem)) return true;
  if (/\b(?:the )?(?:first|second) (?:lens|mirror|element|one)\b|\bthe second\b/i.test(stem)) return true;
  if ((stem.match(new RegExp(String.raw`\b(?:lens|mirror)\s+[A-Z]\b|\b[A-Z]\s+(?:lens|mirror)\b`, "g")) ?? []).length >= 2) return true;
  // Two kinds of the element ("a diverging lens ... a converging lens").
  const kinds = new Set([...stem.matchAll(/\b(concave|convex|converging|diverging)(?:[\s-]+[\w-]+){0,2}?[\s-]+(lens|mirror)\b/gi)]
    .map((match) => `${LENS_WORD[match[1]!.toLowerCase() as keyof typeof LENS_WORD]} ${match[2]!.toLowerCase()}`));
  if (kinds.size >= 2) return true;
  // Two introductions, an appositive ("the lens is a converging lens") counting once.
  const introductions = [...stem.matchAll(new RegExp(String.raw`\b(?:a|an|one)\s+(?:[\w+-]+\s+){0,3}?(?:lens|mirror)\b`, "gi"))]
    .filter((match) => !/\b(?:is|was|as|like)\s+$/i.test(stem.slice(0, match.index ?? 0)));
  return introductions.length >= 2;
}

export type OpticalElement = "lens" | "mirror";

const LENS_WORD = { concave: "concave", diverging: "concave", biconcave: "concave", convex: "convex", converging: "convex", biconvex: "convex" } as const;

/** The kind the stem's words name for its element, or "both" when they disagree. */
function kindFromWords(stem: string, element: OpticalElement): "concave" | "convex" | "both" | null {
  const noun = element === "lens" ? "lens" : "mirror";
  const adjacent = [...stem.matchAll(new RegExp(String.raw`\b(concave|convex|converging|diverging|biconcave|biconvex)(?:[\s-]+[\w-]+){0,2}?[\s-]+${noun}\b`, "gi"))]
    .map((match) => LENS_WORD[match[1]!.toLowerCase() as keyof typeof LENS_WORD]);
  const loose = [...stem.matchAll(/\b(concave|convex|converging|diverging|biconcave|biconvex)\b/gi)]
    .map((match) => LENS_WORD[match[1]!.toLowerCase() as keyof typeof LENS_WORD]);
  const words = adjacent.length > 0 ? adjacent : loose;
  if (words.length === 0) return null;
  return words.every((word) => word === words[0]) ? words[0]! : "both";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\\(?:mathrm|text|operatorname)/g, "").replace(/[_{}\\^\s-]/g, "").replace(/[^a-z0-9]/g, "");
}

export const OBJECT_DISTANCE_ALIASES = ["u", "objectdistance", "do", "so", "dobject"] as const;
export const IMAGE_DISTANCE_ALIASES = ["v", "imagedistance", "di", "si", "dimage"] as const;
export const FOCAL_LENGTH_ALIASES = ["f", "focallength"] as const;
export const POWER_ALIASES = ["p", "power", "lenspower"] as const;
export const RADIUS_ALIASES = ["r", "radiusofcurvature", "radius"] as const;

function planRows(quantities: readonly PlanQuantity[], aliases: readonly string[]): PlanQuantity[] {
  return quantities.filter((quantity) => aliases.includes(normalizeKey(quantity.id)) || aliases.includes(normalizeKey(quantity.symbol)));
}

/** The first plan row for a role as a signed length in centimetres; a row without a length unit reads nothing. */
export function planLength(quantities: readonly PlanQuantity[], aliases: readonly string[]): StatedLength | null {
  const row = planRows(quantities, aliases)[0];
  const unit = row ? lengthUnitKey(row.unit) : null;
  return row && unit ? { cm: row.value * CM_PER_UNIT[unit], unit } : null;
}

/** A plan power in dioptres (unit D or dioptre), signed. */
export function planPower(quantities: readonly PlanQuantity[]): number | null {
  const row = planRows(quantities, POWER_ALIASES).find((quantity) => /^(?:d|dioptres?|diopters?|m\^?-1|1\/m)$/i.test((quantity.unit ?? "").trim()));
  return row && row.value !== 0 ? row.value : null;
}

const same = (first: number, second: number): boolean => Math.abs(first - second) <= 1e-6 * Math.max(1, Math.abs(first), Math.abs(second));

/**
 * Fill u, f, v, kind, unit and conflict for one lens or one mirror. Plan
 * lengths are converted from their own unit; stem lengths keep theirs.
 */
export function extractOpticsSlots(stem: string, plan: readonly PlanQuantity[], bag: SlotBag, element: OpticalElement): void {
  // A topic ask that names both kinds ("concave and convex mirrors") keeps
  // the one stock element it always drew; with measured values the two
  // words name two elements or contradict each other.
  const measured = /\d+(?:\.\d+)?\s*(?:cm|mm|m|D)\b/.test(stem);
  const named = kindFromWords(stem, element);
  const words = named === "both" && !measured
    ? (element === "mirror" ? (/\bconvex\b/i.test(stem) ? "convex" : "concave") : (/\b(?:concave|diverging)\b/i.test(stem) ? "concave" : "convex"))
    : named;
  const stemU = objectDistanceFromStem(stem);
  const stemF = focalLengthFromStem(stem);
  const stemR = element === "mirror" ? radiusOfCurvatureFromStem(stem) : null;
  const powers = element === "lens" ? powersFromStem(stem) : [];
  const powerF = powers.length > 0 ? 100 / powers[0]! : null;
  const planU = planLength(plan, OBJECT_DISTANCE_ALIASES);
  const planF = planLength(plan, FOCAL_LENGTH_ALIASES);
  const planP = element === "lens" ? planPower(plan) : null;
  const planV = planLength(plan, IMAGE_DISTANCE_ALIASES);

  let conflict: string | null = null;
  if (powers.some((power) => !same(power, powers[0]!))) conflict = "power";
  if (powerF !== null && stemF !== null && !same(Math.abs(powerF), Math.abs(stemF.cm))) conflict = "focal";
  if (words === "both") conflict ??= "kind";

  // Lens kind. A lens focal length or power is negative for a diverging
  // lens in every sign convention, so a written sign is evidence.
  if (element === "lens") {
    const stemSign = powerF !== null ? Math.sign(powerF) : stemF !== null && stemF.cm < 0 ? -1 : 0;
    const stemSignKind = stemSign < 0 ? "concave" : stemSign > 0 ? "convex" : null;
    const wordKind = words === "both" ? null : words;
    if (wordKind && stemSignKind && wordKind !== stemSignKind) conflict ??= "kind";
    const planSign = planP !== null ? Math.sign(planP) : planF !== null ? Math.sign(planF.cm) : 0;
    const stemKind = wordKind ?? stemSignKind;
    if (stemKind) setSlot(bag, "kind", stemKind, "stem");
    else if (planSign < 0) setSlot(bag, "kind", "concave", "plan");
    else setSlot(bag, "kind", "convex", "default");
  } else {
    if (words === "concave" || words === "convex") setSlot(bag, "kind", words, "stem");
    else setSlot(bag, "kind", "concave", "default");
  }

  const magnitude = (length: StatedLength | null): number | null => length === null ? null : Math.abs(length.cm);
  setSlot(bag, "u", magnitude(planU), "plan");
  setSlot(bag, "u", magnitude(stemU), "stem");
  setSlot(bag, "f", magnitude(planF) ?? (planP === null ? null : Math.abs(100 / planP)), "plan");
  setSlot(bag, "f", magnitude(stemF) ?? (powerF === null ? null : Math.abs(powerF)) ?? (stemR === null ? null : Math.abs(stemR.cm) / 2), "stem");
  setSlot(bag, "v", magnitude(planV), "plan");

  // The figure speaks the question's unit: the object distance's, else the
  // focal length's or radius's, else the plan's.
  // A stem that mixes units ("0.2 m from a mirror of focal length 10 cm")
  // is drawn in centimetres, every value converted exactly.
  const stemUnits = new Set([stemU?.unit, stemF?.unit ?? stemR?.unit].filter((unit): unit is OpticsLengthUnit => unit !== undefined));
  const unit = stemUnits.size > 1 ? "cm" : stemU?.unit ?? stemF?.unit ?? stemR?.unit ?? planU?.unit ?? planF?.unit ?? "cm";
  setSlot(bag, "unit", unit, stemU || stemF || stemR ? "stem" : planU || planF ? "plan" : "default");
  if (conflict) setSlot(bag, "conflict", conflict, "stem");
}
