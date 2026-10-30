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
  /** Where the stem states it (index of the match), when read from a stem. */
  at?: number;
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

function stated(raw: string, unit: string, at?: number): StatedLength | null {
  const value = parseStemNumber(raw);
  const key = lengthUnitKey(unit);
  if (value === null || key === null) return null;
  return at === undefined ? { cm: value * CM_PER_UNIT[key], unit: key } : { cm: value * CM_PER_UNIT[key], unit: key, at };
}

/** The clause before `index`, back to the last sentence or clause break. */
function clauseBefore(stem: string, index: number): string {
  const before = stem.slice(0, index);
  // A decimal point or a thousands comma ("-6.25 D", "1,500") is no break.
  const breaks = [...before.matchAll(/[.;,?](?!\d)/g)];
  const cut = breaks.length > 0 ? breaks[breaks.length - 1]!.index! : -1;
  return before.slice(cut + 1);
}

/**
 * Bodies that receive the image: a length to one of them is the image
 * distance, never the object's ("a wall is 30 cm from a concave mirror",
 * "a photographic film is 5 cm from the lens").
 */
const RECEIVER = String.raw`screens?|walls?|films?|papers?|sheets?|cards?|boards?|detectors?|plates?|sensors?|retinas?|ground[\s-]glass`;

/**
 * The last role noun a clause names: whose distance a length there is. A
 * screen, wall, film, card or other receiver is where the image forms, so a
 * length in such a clause is never the object's.
 */
function lastRoleNoun(clause: string): "image" | "object" | null {
  const nouns = [...clause.matchAll(new RegExp(String.raw`\b(images?|objects?|${RECEIVER})\b`, "gi"))];
  const last = nouns[nouns.length - 1]?.[1]?.toLowerCase();
  if (last === undefined) return null;
  return /^objects?$/.test(last) ? "object" : "image";
}

/**
 * The thing a "from" or "in front of" phrase measures from must be the
 * optical element itself: the lens, the mirror, its pole or optical centre,
 * or "it". A length measured from a screen, an object, a wall or any other
 * body is not the object distance.
 */
const ELEMENT_ANCHOR = new RegExp(String.raw`^\s*(?:it\b|(?:(?:the|a|an|this|that|its|their)\s+)?(?:(?!(?:object|image|candle|eye|observer|source|lamp|bulb|pin|slit|${RECEIVER}|focus|foci|focal|principal|centre|center|curvature|point)\b)[\w'+-]+\s+){0,3}?(?:lens|mirror|pole|optic(?:al)?\s+cent(?:re|er)|vertex|magnifier|magnifying\s+glass)\b(?!['’]s?\s+(?:principal\s+|first\s+|second\s+)?(?:focus|foci|focal|centre|center|axis)))`, "i");

function anchoredAtElement(rest: string): boolean {
  return ELEMENT_ANCHOR.test(rest);
}

/** Bodies a lens or mirror may be measured from that are not the object it images. */
const NOT_THE_OBJECT = new RegExp(String.raw`\b(?:${RECEIVER}|image|eye|observer|camera|photographic|slab|block|cube|floor|ground|ceiling|table|lens|lenses|mirror|mirrors|focus|pole|centre|center|axis|source of light|light source)\b`, "i");

/**
 * The element is the clause's subject ("holds a converging lens ... at 12 cm
 * from a stamp", "the mirror is 30 cm from the candle") and the length runs
 * to the thing it images: that is the object distance too. The clause must
 * name no image, object or screen of its own, and the far end must not be a
 * screen, a wall, the eye or any other body.
 */
function elementToObject(clause: string, rest: string): boolean {
  const element = [...clause.matchAll(/\b(?:lens|mirror|magnifier|magnifying glass)\b/gi)].pop();
  if (!element || lastRoleNoun(clause.slice((element.index ?? 0) + element[0].length)) !== null) return false;
  const far = /^\s*((?:(?:the|a|an|this|that|its)\s+)?(?:[\w'-]+\s+){0,2}?[\w'-]+)/i.exec(rest);
  return far !== null && !NOT_THE_OBJECT.test(far[1]!) && !/\b(?:it|them|one|other|another|second)\b/i.test(far[1]!);
}

/**
 * Every "<number> <unit> <phrase> <element>" in the stem ("30 cm in front of
 * the lens"), with a sign written as "+" allowed. A length in a clause whose
 * last role noun is the image or a screen ("its image is 60 cm in front of")
 * is the image distance, never the object's ("forms an image of an object
 * placed 15 cm away" is). A length measured from anything but the element
 * reads nothing.
 */
function lengthsBefore(stem: string, phrase: RegExp): StatedLength[] {
  const pattern = new RegExp(`${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b\\s*(?:${phrase.source})`, "gi");
  return [...stem.matchAll(pattern)].flatMap((match) => {
    const at = match.index ?? 0;
    if (lastRoleNoun(clauseBefore(stem, at)) === "image") return [];
    // "8.0 cm to its left": "its" is the element's own side.
    const ownSide = /\bto its left$/i.test(match[0]) && !/^\s*of\b/i.test(stem.slice(at + match[0].length));
    const rest = stem.slice(at + match[0].length);
    if (!ownSide && !anchoredAtElement(rest) && !elementToObject(clauseBefore(stem, at), rest)) return [];
    return [stated(match[1]!, match[2]!, at)].filter((item): item is StatedLength => item !== null);
  });
}

/**
 * The words between a named role and its number ("focal length of the lens
 * is 10 cm") belong to that role only when they stay in one clause and name
 * no other quantity: a sentence end, a semicolon or comma, a condition ("if",
 * "when", "and"), another symbol's assignment ("v = 60 cm") or another role
 * noun means the number is someone else's. The role's own symbol ("focal
 * length f = 10 cm") may be assigned.
 */
function gapCrossesRole(gap: string, ownSymbol: string | null): boolean {
  let rest = ` ${gap} `;
  if (ownSymbol) rest = rest.replace(new RegExp(String.raw`[\s(]\(?\s*(?:${ownSymbol})\s*\)?\s*(?=[=:\s])`), " ");
  rest = rest.replace(/^\s*[=:]/, " ");
  return /[.;,?!=:]/.test(rest)
    || /\b(?:if|when|whenever|where|while|whereas|and|but|then|so|given|images?|objects?|screens?|walls?|distances?|height|tall|power|radius|curvature|magnification|focal)\b/i.test(rest)
    // A lone symbol other than the article "a" ("... v 60 cm") is another quantity.
    || /(?:^|\s)(?![aA](?:\s|$))[a-zA-Z](?=\s|$)/.test(rest);
}

/**
 * The first "<phrase> ... <number> <unit>" outside an image or screen
 * clause, with the words between staying in the phrase's own role
 * (`gapCrossesRole`). `anchored` also asks the length to be measured from the
 * element ("placed at 20 cm from the lens", or a bare "object at 20 cm." in a
 * stem with no screen or wall to measure from); a role named by the phrase
 * itself ("object distance of 20 cm", "focal length 10 cm") needs no anchor.
 */
function lengthAfter(stem: string, phrase: RegExp, options: { roleGuard?: boolean; anchored?: boolean; symbol?: string } = {}): StatedLength | null {
  const pattern = new RegExp(`(?:${phrase.source})([^0-9\\-]{0,24})${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b`, "gi");
  for (const match of stem.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (gapCrossesRole(match[1]!, options.symbol ?? null)) continue;
    const numberAt = at + match[0].search(/[0-9+.]/);
    if (options.roleGuard && lastRoleNoun(clauseBefore(stem, numberAt)) === "image") continue;
    if (options.anchored) {
      // "object at 20 cm from the mirror", or "object at 20 cm." with no
      // other body to measure from; never "at 20 cm from the screen".
      const rest = stem.slice(at + match[0].length);
      const away = /^\s*(?:away\s+)?(?:from|in front of|before|to (?:the|its) left of)\b/i.exec(rest);
      const anchored = away ? anchoredAtElement(rest.slice(away[0].length)) : /^\s*(?:[.,;:)]|$)/.test(rest) && !RECEIVER_IN_STEM.test(stem);
      if (!anchored) continue;
    }
    const length = stated(match[2]!, match[3]!, numberAt);
    if (length) return length;
  }
  return null;
}

const RECEIVER_IN_STEM = new RegExp(String.raw`\b(?:${RECEIVER})\b`, "i");

function symbolLength(stem: string, symbol: RegExp): StatedLength | null {
  const pattern = new RegExp(`(?:^|[^a-z])(?:${symbol.source})\\s*[=:]\\s*\\+?${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b`, "i");
  const match = pattern.exec(stem);
  return match ? stated(match[1]!, match[2]!, match.index) : null;
}

/**
 * A named length with no unit at all ("focal length 10"). The question never
 * said centimetres, so the value is never stem sourced: it may not be shown,
 * and it keeps strict from drawing (`unitless` slots, see extractOpticsSlots).
 */
function unitlessAfter(stem: string, phrase: RegExp, symbol: string | null): number | null {
  const pattern = new RegExp(`(?:${phrase.source})([^0-9\\-]{0,24})${STEM_NUMBER}(?!\\s*(?:${LENGTH_UNIT}|D|dioptres?|diopters?|centimet(?:re|er)s?|millimet(?:re|er)s?)\\b)(?!\\s*[%°×x*^/])`, "gi");
  for (const match of stem.matchAll(pattern)) {
    if (gapCrossesRole(match[1]!, symbol)) continue;
    const value = parseStemNumber(match[2]!);
    if (value !== null) return value;
  }
  return null;
}

/** Phrases that name the object distance by its role: no anchor needed. */
const OBJECT_DISTANCE_NAMED = /object distance(?: of| is| =)?/;
/** Phrases that place the object: the length must be measured from the element. */
const OBJECT_PLACEMENT = /(?:the |an |a )?object(?: is)?(?:\s+(?:placed|kept|located|positioned))?\s+at(?: a distance of)?/;
const AWAY_FROM = /(?:(?:away\s+)?from|in front of|before|to (?:the|its) left(?: of)?)/;
/** "held 6.0 cm above a stamp": a lens over a page. A height above the axis is never a distance. */
const HELD_OVER = /(?:held|kept|placed|positioned|mounted)\s+/;
const FOCAL_LENGTH = /focal length(?: of| is| =)?/;
const RADIUS_OF_CURVATURE = /radius of curvature(?: of| is| =)?/;

/** A lens or magnifier held over a page: the element is the clause's subject, so the height is its distance from the object. */
function heldOver(stem: string): StatedLength | null {
  const pattern = new RegExp(`(?:${HELD_OVER.source})${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b\\s*(?:above|over|below)\\s+(?!(?:the\\s+)?(?:principal\\s+)?axis\\b)`, "gi");
  for (const match of stem.matchAll(pattern)) {
    const clause = clauseBefore(stem, match.index ?? 0);
    if (!/\b(?:lens|magnifier|magnifying glass|mirror)\b/i.test(clause) || lastRoleNoun(clause) !== null) continue;
    const length = stated(match[1]!, match[2]!, match.index ?? 0);
    if (length) return length;
  }
  return null;
}

/**
 * "an object placed 15 cm away." The object is the one placed, the clause
 * ends there and the stem has no screen or wall it could be measured from.
 */
function objectPlacedAway(stem: string): StatedLength | null {
  if (RECEIVER_IN_STEM.test(stem)) return null;
  const pattern = new RegExp(`\\bobject\\s+(?:is\\s+)?(?:placed|kept|located|positioned)\\s+${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b\\s*away\\s*(?=[.,;:)]|$)`, "gi");
  for (const match of stem.matchAll(pattern)) {
    if (lastRoleNoun(clauseBefore(stem, (match.index ?? 0) + match[0].indexOf(match[1]!))) === "image") continue;
    const length = stated(match[1]!, match[2]!, match.index ?? 0);
    if (length) return length;
  }
  return null;
}

export function objectDistanceFromStem(stem: string): StatedLength | null {
  return objectDistanceReading(stem)?.length ?? null;
}

/** The stem's object distance and how it was read: by a phrase around a number, or by the symbol u. */
function objectDistanceReading(stem: string): { length: StatedLength; bySymbol: boolean } | null {
  const phrase = lengthsBefore(stem, AWAY_FROM)[0]
    ?? heldOver(stem)
    ?? lengthAfter(stem, OBJECT_DISTANCE_NAMED, { roleGuard: true, symbol: "u" })
    ?? lengthAfter(stem, OBJECT_PLACEMENT, { roleGuard: true, anchored: true })
    ?? objectPlacedAway(stem);
  if (phrase) return { length: phrase, bySymbol: false };
  const symbol = symbolLength(stem, /u/);
  return symbol ? { length: symbol, bySymbol: true } : null;
}

/** Things a lens or mirror images: a u clause must name one ("a candle stands 36 cm from the lens"). */
const OBJECT_NOUN = /\b(?:objects?|candles?|pins?|flames?|arrows?|letters?|stamps?|toys?|persons?|people|man|men|woman|women|boy|girl|child|lamps?|needles?|bulbs?|sources?|coins?|insects?|ants?|bugs?|flies|fly|pencils?|pens?|rods?|sticks?|matchsticks?|trees?|buildings?|towers?|cars?|vans?|trucks?|lorry|lorries|buses|bus|bikes?|bicycles?|cyclists?|motorcycles?|ships?|boats?|vehicles?|customers?|shoppers?|students?|signs?|posters?|charts?|pictures?|photos?|photographs?|flowers?|plants?|animals?|cats?|dogs?|faces?|nose|print|page|text|book|newspaper|word|words|specimen|slide|ball|bottle|statue|bird|star|sun|moon|he|she|his|her)\b/i;

/**
 * Whether the stem's object distance is bound to the object by its own
 * words: read from the symbol u, or from a clause that names the thing
 * imaged (an object, candle, pin, stamp, lamp ...). A length in a clause
 * that names no such thing ("a wall is 30 cm from a concave mirror") is
 * someone's distance, not certainly the object's. Null when the stem states
 * no object distance.
 */
export function objectDistanceNamesObject(question: string): boolean | null {
  const stem = question.replace(/[\u2013\u2014\u2212]/g, "-").replace(/\s+/g, " ");
  const reading = objectDistanceReading(stem);
  if (!reading) return null;
  if (reading.bySymbol) return true;
  const at = reading.length.at ?? 0;
  const after = stem.slice(at);
  const end = after.search(/[.;?!](?!\d)/);
  const before = stem.slice(0, at);
  const sentenceStart = Math.max(...[...before.matchAll(/[.;?!](?!\d)/g)].map((match) => match.index! + 1), 0);
  const clause = before.slice(sentenceStart) + (end < 0 ? after : after.slice(0, end));
  return OBJECT_NOUN.test(clause) && lastRoleNoun(clauseBefore(stem, at)) !== "image";
}

export function focalLengthFromStem(stem: string): StatedLength | null {
  return lengthAfter(stem, FOCAL_LENGTH, { symbol: "f" }) ?? symbolLength(stem, /f/);
}

export function radiusOfCurvatureFromStem(stem: string): StatedLength | null {
  return lengthAfter(stem, RADIUS_OF_CURVATURE, { symbol: "R" }) ?? symbolLength(stem, /R/);
}

/** The roles the stem names with a bare number and no unit ("focal length 10"). */
function unitlessRoles(stem: string): Set<"u" | "f"> {
  const roles = new Set<"u" | "f">();
  if (unitlessAfter(stem, OBJECT_DISTANCE_NAMED, "u") !== null || unitlessAfter(stem, OBJECT_PLACEMENT, null) !== null) roles.add("u");
  if (unitlessAfter(stem, FOCAL_LENGTH, "f") !== null || unitlessAfter(stem, RADIUS_OF_CURVATURE, "R") !== null) roles.add("f");
  return roles;
}

/**
 * Why the stem is not one plain lens or mirror in air with one object
 * position, or null. A slab or block in the path, an element in water, oil
 * or another medium, an object moved to a second position, the displacement
 * method, and an object to screen separation are all other optical cases:
 * one lens or one mirror figure would be a different question's figure.
 */
export function opticsConfigurationIssue(question: string): string | null {
  const stem = question.replace(/[\u2013\u2014\u2212]/g, "-").replace(/\s+/g, " ");
  if (/\b(?:slabs?|blocks?|cubes?|prisms?|plates?\s+of\s+glass|glass\s+(?:plates?|spheres?))\b/i.test(stem)) return "a slab or block in the path";
  // Nothing but a second body sits between the element and its image.
  if (/\b(?:inserted|introduced|interposed)\b|\bbetween\s+(?:the\s+)?(?:lens|mirror)\s+and\s+(?:the\s+)?(?:image|screen)\b|\bbetween\s+(?:the\s+)?(?:image|screen)\s+and\s+(?:the\s+)?(?:lens|mirror)\b/i.test(stem)) return "a second body between the element and the image";
  if (/\b(?:immersed|immersion|submerged|dipped)\b/i.test(stem)) return "an element immersed in a medium";
  if (/\bsilver(?:ed|ing)\b|\bhemispher\w*/i.test(stem)) return "a silvered or curved second surface";
  if (/\b(?:filled\s+with|containing|contains|full\s+of)\s+(?:\w+\s+)?(?:water|oil|liquid|glycerine|glycerin|alcohol)\b|\b(?:beaker|tank|vessel|pond|pool)\b/i.test(stem)) return "a medium other than air";
  if (/\b(?:in|into|under|inside)\s+(?:a\s+|the\s+)?(?:water|oil|liquid|glycerine|glycerin|alcohol|benzene|kerosene|medium)\b|\bglass\s+medium\b|\b(?:water|oil|liquid)\s+(?:of|with)\s+refractive\s+index\b|\brefractive\s+index\s+of\s+(?:the\s+)?(?:surround\w*|medium|liquid|water|oil)\b|\bsurrounding\s+medium\b/i.test(stem)) return "a medium other than air";
  if (/\b(?:is|was|then|now|gets?|being)\s+(?:\w+\s+)?(?:moved|shifted|displaced|brought|pushed|pulled)\b|\bmoved\s+(?:to|towards?|away|closer|by|through)\b|\b(?:second|new|two|both|other)\s+positions?\b|\b(?:second|another|two|both)\s+(?:objects?|pins?|candles?|images?)\b/i.test(stem)) return "an object or element in more than one position";
  // A second situation: "if the object is then placed", "now the object is placed", "replaced by another".
  if (/\b(?:then|now|later|next|again|subsequently)\b[^.?!;]{0,40}?\b(?:placed|kept|put|positioned|located|replaced|changed|reversed|turned)\b|\bis\s+then\b|\breplaced\s+(?:by|with)\b|\banother\b|\binstead\b/i.test(stem)) return "an object or element in more than one position";
  if (/\bdisplacement\s+method\b|\bconjugate\b/i.test(stem)) return "the displacement method";
  // A distance from the focus or the centre of curvature (Newton's form) is not u.
  if (/\d\s*(?:cm|mm|m)\b/.test(stem) && (
    /\b(?:from|beyond|behind|inside|outside|past|before|within)\s+(?:the\s+|its\s+|a\s+)?(?:[\w'’]+\s+)?(?:principal\s+|first\s+|second\s+)?(?:focus|foci|focal\s+point|cent(?:re|er)\s+of\s+curvature)\b/i.test(stem)
    || /\b(?:from|beyond|behind|inside|outside|past|before|within)\s+(?:the\s+)?(?:2F|F|C|F1|F2|2F1|2F2)(?![\w'’])/.test(stem))) return "a distance measured from the focus or the centre of curvature";
  const separation = new RegExp(`${STEM_NUMBER}\\s*(?:${LENGTH_UNIT})\\b\\s*(?:away\\s+)?(?:from|apart\\s+from)\\s+(?:the\\s+|a\\s+|an\\s+|its\\s+)?(?:[\\w-]+\\s+){0,2}?(?:screen|wall|object|candle|flame|source|lamp|bulb)\\b`, "i");
  if (/\b(?:screen|wall)\b/i.test(stem) && (separation.test(stem) || /\bbetween\s+(?:the\s+)?(?:[\w-]+\s+)?(?:object|candle|flame|source|lamp|bulb)\s+and\s+(?:the\s+)?(?:screen|wall)\b|\bbetween\s+(?:the\s+)?(?:screen|wall)\s+and\s+(?:the\s+)?(?:object|candle|flame|source|lamp|bulb)\b/i.test(stem))) {
    return "an object to screen separation";
  }
  return null;
}

/** Every power in dioptres the stem states ("+5.0 D", "-2.0 dioptre"), signed. */
export function powersFromStem(stem: string): number[] {
  const pattern = new RegExp(`(\\+)?${STEM_NUMBER}\\s*(?:D(?![A-Za-z])|[dD]iopt(?:re|er)s?\\b)`, "g");
  return [...stem.matchAll(pattern)].flatMap((match) => {
    const value = parseStemNumber(match[2]!);
    return value === null || value === 0 ? [] : [value];
  });
}

/**
 * Every image distance the stem states: "v = 60 cm", "image distance of
 * 60 cm", a length in a clause whose role noun is the image or a receiver
 * ("its image is 60 cm in front of the mirror", "a wall is 30 cm from a
 * concave mirror"), or the element held a length from a receiver ("held 30 cm
 * from a sheet of white paper"). A height, a focal length or radius in that
 * clause, and a length measured from anything but the element, are not.
 */
export interface StatedImageDistance extends StatedLength {
  /** The side the stem names: in front of or behind a mirror, the object's side or the other side of a lens. */
  side?: "front" | "behind" | "same" | "other";
}

function imageSide(rest: string): StatedImageDistance["side"] {
  const clause = rest.split(/[.;,?!](?!\d)/)[0] ?? "";
  if (/^\s*(?:away\s+)?in front of\b/i.test(clause)) return "front";
  if (/^\s*(?:away\s+)?behind\b/i.test(clause)) return "behind";
  if (/\bsame side\b/i.test(clause)) return "same";
  if (/\b(?:other|opposite|far)\s+side\b/i.test(clause)) return "other";
  return undefined;
}

export function imageDistancesFromStem(question: string): StatedImageDistance[] {
  const stem = question.replace(/[\u2013\u2014\u2212]/g, "-").replace(/\s+/g, " ");
  const found: StatedImageDistance[] = [];
  for (const match of stem.matchAll(new RegExp(`(?:^|[^A-Za-z_])v\\s*[=:]\\s*\\+?${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b`, "g"))) {
    const length = stated(match[1]!, match[2]!, match.index ?? 0);
    if (length) found.push(length);
  }
  const named = lengthAfter(stem, /image distance(?: of| is| =)?/, { symbol: "v" });
  if (named) found.push(named);
  const receiver = new RegExp(String.raw`^\s*(?:away\s+)?(?:from|in front of|behind|before)\s+(?:(?:the|a|an|its)\s+)?(?:[\w'-]+\s+){0,2}?(?:${RECEIVER})\b`, "i");
  for (const match of stem.matchAll(new RegExp(`${STEM_NUMBER}\\s*(${LENGTH_UNIT})\\b`, "gi"))) {
    const at = match.index ?? 0;
    const clause = clauseBefore(stem, at);
    const rest = stem.slice(at + match[0].length);
    if (/^\s*(?:tall|high|long|wide|thick|deep|in\s+(?:height|size|length|width|diameter)|across|apart|squared|\^|²)/i.test(rest)) continue;
    const role = lastRoleNoun(clause);
    let image = false;
    if (role === "image") {
      const nouns = [...clause.matchAll(new RegExp(String.raw`\b(?:images?|${RECEIVER})\b`, "gi"))];
      const last = nouns[nouns.length - 1]!;
      // The words after the noun, past any earlier length ("formed by a lens of focal length 10 cm is").
      const tail = clause.slice((last.index ?? 0) + last[0].length).replace(new RegExp(String.raw`^.*\d\s*(?:${LENGTH_UNIT}|D)\b`, "i"), "");
      if (/\b(?:focal|radius|curvature|power|tall|high|height|size|wide|width|long|thick|thickness|magnif\w*|times)\b/i.test(tail)) continue;
      const away = /^\s*(?:away\s+)?(?:from|in front of|behind|before|to (?:the|its) (?:left|right) of)\s+/i.exec(rest);
      image = !away || anchoredAtElement(rest.slice(away[0].length));
    } else if (role === null && /\b(?:lens|mirror|magnifier|magnifying glass)\b/i.test(clause) && receiver.test(rest)) {
      image = true;
    }
    if (!image) continue;
    const length = stated(match[1]!, match[2]!, at);
    const side = imageSide(rest);
    if (length && !found.some((item) => item.at === at)) found.push(side ? { ...length, side } : length);
  }
  return found;
}

export interface StatedImageNature {
  real?: boolean;
  inverted?: boolean;
  magnified?: boolean;
}

/**
 * The image's nature as the stem states it (real or virtual, inverted or
 * erect, magnified or diminished). A sentence that asks or negates
 * ("whether", "or", "not", a question mark) states nothing, and a pair whose
 * both words are stated says nothing.
 */
export function imageNatureFromStem(question: string): StatedImageNature {
  const stem = question.replace(/[\u2013\u2014\u2212]/g, "-").replace(/\s+/g, " ").replace(/\breal[\s-]+is[\s-]+positive\b/gi, " ");
  const sentences = (stem.match(/[^.;!?]+(?:[.;!?](?!\d)|$)/g) ?? []).filter((sentence) => !/\b(?:not|never|no|neither|nor|whether|or)\b|n't\b|\?/i.test(sentence));
  // The word describes the image only when the nearest role noun is the image
  // ("a real image", "the image is erect"), never the object ("stands upright").
  const says = (word: RegExp) => sentences.some((sentence) => [...sentence.matchAll(new RegExp(word.source, "gi"))].some((match) => {
    const at = match.index ?? 0;
    const nouns = [...sentence.matchAll(/\b(images?|objects?)\b/gi)];
    const nearest = nouns.sort((a, b) => Math.abs((a.index ?? 0) - at) - Math.abs((b.index ?? 0) - at))[0];
    return nearest !== undefined && /^image/i.test(nearest[1]!);
  }));
  const pair = (yes: RegExp, no: RegExp): boolean | undefined => {
    const a = says(yes);
    const b = says(no);
    return a === b ? undefined : a;
  };
  const nature: StatedImageNature = {};
  const real = pair(/\breal\b/i, /\bvirtual\b/i);
  const inverted = pair(/\binverted\b/i, /\b(?:erect|upright)\b/i);
  const magnified = pair(/\b(?:magnified|enlarged)\b/i, /\bdiminished\b/i);
  if (real !== undefined) nature.real = real;
  if (inverted !== undefined) nature.inverted = inverted;
  if (magnified !== undefined) nature.magnified = magnified;
  return nature;
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
    .map((match) => {
      const element = match[2]!.toLowerCase() as OpticalElement;
      return `${kindOfWord(match[1]!, element) ?? match[1]!.toLowerCase()} ${element}`;
    }));
  if (kinds.size >= 2) return true;
  // Two introductions, an appositive ("the lens is a converging lens") counting once.
  const introductions = [...stem.matchAll(new RegExp(String.raw`\b(?:a|an|one)\s+(?:[\w+-]+\s+){0,3}?(?:lens|mirror)\b`, "gi"))]
    .filter((match) => !/\b(?:is|was|as|like)\s+$/i.test(stem.slice(0, match.index ?? 0)));
  return introductions.length >= 2;
}

export type OpticalElement = "lens" | "mirror";

type KindWord = "concave" | "convex" | "converging" | "diverging" | "biconcave" | "biconvex";

/**
 * The shape a kind word names for each element. A converging lens is convex
 * but a converging mirror is concave; a diverging lens is concave but a
 * diverging mirror is convex. A mirror is never biconvex or biconcave.
 */
const KIND_WORD: Readonly<Record<OpticalElement, Readonly<Partial<Record<KindWord, "concave" | "convex">>>>> = {
  lens: { concave: "concave", diverging: "concave", biconcave: "concave", convex: "convex", converging: "convex", biconvex: "convex" },
  mirror: { concave: "concave", converging: "concave", convex: "convex", diverging: "convex" },
};

export function kindOfWord(word: string, element: OpticalElement): "concave" | "convex" | null {
  return KIND_WORD[element][word.toLowerCase() as KindWord] ?? null;
}

/** The kind the stem's words name for its element, or "both" when they disagree. */
function kindFromWords(stem: string, element: OpticalElement): "concave" | "convex" | "both" | null {
  const noun = element === "lens" ? "lens" : "mirror";
  const adjacent = [...stem.matchAll(new RegExp(String.raw`\b(concave|convex|converging|diverging|biconcave|biconvex)(?:[\s-]+[\w-]+){0,2}?[\s-]+${noun}\b`, "gi"))]
    .map((match) => kindOfWord(match[1]!, element) ?? "both" as const);
  const loose = [...stem.matchAll(/\b(concave|convex|converging|diverging|biconcave|biconvex)\b/gi)]
    .map((match) => kindOfWord(match[1]!, element) ?? "both" as const);
  const words = adjacent.length > 0 ? adjacent : loose;
  if (words.length === 0) return null;
  return words.every((word) => word === words[0]) ? words[0]! : "both";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\\(?:mathrm|text|operatorname)/g, "").replace(/[_{}\\^\s-]/g, "").replace(/[^a-z0-9]/g, "");
}

export const OBJECT_DISTANCE_ALIASES = ["u", "objectdistance", "do", "so", "dobject", "dobj", "distanceobject", "objdistance"] as const;
export const IMAGE_DISTANCE_ALIASES = ["v", "imagedistance", "di", "si", "dimage", "dimg", "distanceimage", "imgdistance"] as const;
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
  // A bare number with no unit ("focal length 10") is not a stated length,
  // and a plan unit for it would be invented: the figure declines, so it is
  // never drawn or measured in centimetres the question never said.
  const unitless = unitlessRoles(stem);
  const powers = element === "lens" ? powersFromStem(stem) : [];
  const powerF = powers.length > 0 ? 100 / powers[0]! : null;
  const planU = planLength(plan, OBJECT_DISTANCE_ALIASES);
  const planF = planLength(plan, FOCAL_LENGTH_ALIASES);
  const planP = element === "lens" ? planPower(plan) : null;
  const planV = planLength(plan, IMAGE_DISTANCE_ALIASES);

  let conflict: string | null = null;
  if ((unitless.has("u") && stemU === null) || (unitless.has("f") && stemF === null && stemR === null && powerF === null)) conflict = "unitless";
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
