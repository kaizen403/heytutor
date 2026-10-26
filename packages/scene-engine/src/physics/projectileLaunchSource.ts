import { STEM_NUMBER, firstAngle, parseStemNumber, prepareStem } from "../archetypes/slots";

function launchClause(question: string): string {
  const launchStart = /\b(?:launched|projected|thrown|kicked|fired|hurled|tossed|lobbed)\b/i.exec(question);
  return launchStart ? question.slice(launchStart.index)
    .split(/\.(?!\d)|[;!?]|\band\b(?!\s+(?:(?:an?|the)\s+)?angle\s+(?:of\s+|is\s+)?\(?\s*[+-]?\d|\s+(?:at\s+)?\d+(?:\.\d+)?\s*(?:°|deg))|\b(?:hence|show|it|maximum)\b/i)[0]! : "";
}

/** A later object's angle is not a measurement of the launch direction. */
export function projectileLaunchAngle(question: string): number | null {
  const clause = launchClause(question);
  return /\bhorizontally\b/i.test(clause) ? 0
    : /(?:\btheta\b|θ)(?!\s*[=:])/i.test(clause) ? null : firstAngle(clause);
}

/**
 * What a stem states about a launch that the level ground projectile reads.
 *
 * The projectile figure measures its angle from the horizontal, launches from
 * level ground or a read height, and computes with a read g (9.8 otherwise).
 * A stem that states something else is never drawn with the stock value in
 * its place:
 * - `angle` names a reference the figure does not draw (the vertical, a
 *   normal, an incline, below the horizontal) or a symbol it would relabel.
 *   Such a figure is false at any tier.
 * - `g` and `height` are "unread" when the stem states one in a spelling the
 *   reader does not take whole. Only a figure without numbers may then draw,
 *   with a display value and symbolic labels.
 */
export interface ProjectileStatedConditions {
  readonly angle: { readonly status: "read" } | { readonly status: "unread"; readonly reason: string };
  readonly g: { readonly status: "none" } | { readonly status: "read"; readonly value: number } | { readonly status: "unread"; readonly reason: string };
  readonly height: { readonly status: "none" } | { readonly status: "read"; readonly value: number } | { readonly status: "unread"; readonly reason: string };
}

const REFERENCE_NOUN = String.raw`(?:vertical|normal|perpendicular|inclined?\s+(?:plane|surface)|incline|plane|slope|ramp|wedge|hill(?:side)?)`;
// "the vertical component" or "the vertical height" is a quantity, not a reference.
const NOUN_CONTINUES = String.raw`(?!\s*(?:component|velocit|motion|height|displacement|distance|speed|acceleration|axis|position|coordinate|projection|line|range|plane|throw|drop|fall|direction\s+of\s+motion))`;
const NON_HORIZONTAL_REFERENCE = new RegExp(String.raw`\b(?:with|to|from|above|below|of|off|relative\s+to|respect\s+to|w\.?\s*r\.?\s*t\.?|measured\s+from)\s+(?:the\s+|a\s+|an\s+)?(?:local\s+|upward\s+|downward\s+)?${REFERENCE_NOUN}\b${NOUN_CONTINUES}`, "i");
const BELOW_HORIZONTAL = /\bbelow\s+(?:the\s+)?horizontal|\b(?:angle\s+of\s+)?depression\b|\bdownhill\b/i;
const OTHER_ANGLE_SYMBOL = /\b(?:alpha|beta|gamma|phi)\b|[αβγφϕ]/i;

const ACCEL_UNIT = String.raw`(?:m\s*\/\s*s(?:\s*\^\s*2|2)\b|m\s*s\s*\^\s*-\s*2|ms\s*\^?\s*-\s*2|m\s*\/\s*sec\s*\^?\s*2|m(?:etres?|eters?)?\s+per\s+s(?:ec(?:ond)?)?\s+(?:squared|per\s+s(?:ec(?:ond)?)?)|N\s*\/\s*kg)`;
const G_PREFIX = String.raw`(?:\bg\s*(?:=|≈|:)\s*|\bg\s+(?:is|as|to\s+be)\s+(?:taken\s+(?:as|to\s+be)\s+)?(?:equal\s+to\s+)?|\b(?:acceleration\s+(?:due\s+to|of)\s+(?:the\s+)?(?:gravity|free\s+fall)|gravitational\s+(?:acceleration|field\s+strength)|gravity)(?:\s*\(\s*g\s*\))?\s*(?:is\s+|=\s*|as\s+|of\s+|:\s*)(?:taken\s+(?:as|to\s+be)\s+)?(?:equal\s+to\s+)?)`;
const G_VALUE = new RegExp(`${G_PREFIX}${STEM_NUMBER}(?:\\s*${ACCEL_UNIT})?`, "gi");
const G_MENTION = new RegExp(String.raw`\bg\s*(?:=|≈|:)|\bg\s+(?:is|as|to\s+be)\s+(?:taken|equal|[\d.])|\b(?:take|taking|use|using|assume|assuming)\s+g\b|\bgravit\w*\s+(?:is|=|of|as|equals?)\b|\bacceleration\s+(?:due\s+to|of)\s+(?:the\s+)?(?:gravity|free\s+fall)\s*(?:\(\s*g\s*\)\s*)?(?:is|=|of|as|:)|\b(?:moon|lunar|mars|martian|jupiter|venus|mercury|saturn|planet|asteroid)\b`, "i");
const ACCEL_QUANTITY = new RegExp(`${STEM_NUMBER}\\s*${ACCEL_UNIT}`, "gi");

const HEIGHT_BODY = String.raw`(?:towers?|cliffs?|buildings?|roofs?|rooftops?|tables?|balcon(?:y|ies)|bridges?|hills?|hilltops?|platforms?|ledges?|terraces?|masts?)`;
const METRES = String.raw`(?:m|metres?|meters?)\b`;
const HEIGHT_VALUES: readonly RegExp[] = [
  new RegExp(String.raw`\b${HEIGHT_BODY}\s+(?:(?:of|with)\s+(?:a\s+)?height\s+(?:of\s+)?|whose\s+height\s+is\s+|of\s+)(?:h\s*=\s*)?${STEM_NUMBER}\s*${METRES}`, "gi"),
  new RegExp(String.raw`\b${HEIGHT_BODY}\s+(?:(?:which|that)\s+is\s+)?(?:h\s*=\s*)?${STEM_NUMBER}\s*${METRES}\s*(?:high|tall|in\s+height)\b`, "gi"),
  new RegExp(String.raw`${STEM_NUMBER}\s*${METRES}(?:\s*-\s*|\s+)?(?:high|tall)?\s+${HEIGHT_BODY}`, "gi"),
  new RegExp(String.raw`\b(?:from|at)\s+(?:a\s+|the\s+)?height\s+(?:of\s+)?(?:h\s*=\s*)?${STEM_NUMBER}\s*${METRES}`, "gi"),
  new RegExp(String.raw`${STEM_NUMBER}\s*${METRES}\s+above\s+(?:the\s+)?(?:level\s+)?(?:ground|floor|sea(?:\s+level)?|water)\b`, "gi"),
  new RegExp(String.raw`\bheight\s+of\s+(?:the\s+)?${HEIGHT_BODY}\s+(?:is\s+|=\s*)${STEM_NUMBER}\s*${METRES}`, "gi"),
];
// Every stated launch height, numeric or not. "The top of its path" is not one.
const HEIGHT_MENTION = new RegExp(String.raw`\b${HEIGHT_BODY}\b|\btop\s+of\s+(?:a|an|the)\s+(?!(?:trajectory|path|flight|parabola|arc|curve|motion|ascent|climb|rise)\b)|\b(?:from|at)\s+(?:a\s+|the\s+|some\s+)?(?:certain\s+)?(?:height|elevation)\b|\b(?:above|over)\s+(?:the\s+)?(?:level\s+)?(?:ground|floor|sea|water)\b(?<!\bheight\s+(?:above|over)\s+(?:the\s+)?(?:level\s+)?(?:ground|floor|sea|water))|\b(?:high|tall)\s+(?:above|from)\b|\belevated\b`, "i");
// A height the projectile lands on is not a launch height the figure draws.
const LANDING_ELEVATION = new RegExp(String.raw`\b(?:(?:lands?|landing|hits?|strikes?|falls?|drops?)\s+(?:on|onto|upon)|clears?|reaches|onto)\s+(?:(?:the\s+)?(?:top|roof|edge)\s+of\s+)?(?:(?:a|an|the|another|second)\s+)?(?:[\w.]+\s+){0,3}?${HEIGHT_BODY}\b`, "i");

function statedLaunchAngle(text: string): ProjectileStatedConditions["angle"] {
  const reference = NON_HORIZONTAL_REFERENCE.exec(text);
  if (reference) return { status: "unread", reason: `the angle is measured "${reference[0].trim()}", not from the horizontal` };
  const below = BELOW_HORIZONTAL.exec(text);
  if (below) return { status: "unread", reason: `the launch is "${below[0].trim()}", below the horizontal` };
  if (/\b(?:thrown|projected|launched|fired)\s+(?:\w+\s+){0,2}?downwards?\b|\bdownwards?\s+at\b|°\s*downwards?\b/i.test(text)) {
    return { status: "unread", reason: "the launch is directed downward" };
  }
  const vertical = /\b(?:straight|vertically)\s+(?:up|down)(?:wards?)?\b/i.exec(text);
  if (vertical) return { status: "unread", reason: `the launch is "${vertical[0]}", along the vertical` };
  if (OTHER_ANGLE_SYMBOL.test(text) && projectileLaunchAngle(text) === null) {
    return { status: "unread", reason: "the launch angle has a symbol the figure would relabel as θ" };
  }
  return { status: "read" };
}

function statedGravity(text: string): ProjectileStatedConditions["g"] {
  const reads = [...text.matchAll(G_VALUE)].map((match) => {
    const end = match.index! + match[0].length;
    // A number with no supported unit may still carry an unsupported one
    // ("980 cm/s^2", "32 ft/s^2"); that value is never m/s^2.
    const foreignUnit = /^\s*(?:[a-zµμ]{1,6}\s*(?:\/|\^|²|per\b)|(?:cm|mm|km|ft|feet|foot|inch(?:es)?|gal)\b)/i.test(text.slice(end));
    return { start: match.index!, end, value: foreignUnit ? null : parseStemNumber(match[1]!) };
  });
  // Every stated acceleration must be a read g; an unread one may be the g.
  const quantities = [...text.matchAll(ACCEL_QUANTITY)];
  const unreadQuantity = quantities.some((quantity) => !reads.some((read) => quantity.index! >= read.start && quantity.index! < read.end));
  if (reads.length === 0) {
    return G_MENTION.test(text) || quantities.length > 0
      ? { status: "unread", reason: "the question states a g the reader does not take whole" }
      : { status: "none" };
  }
  const values = [...new Set(reads.map((read) => read.value))];
  if (unreadQuantity || values.length !== 1 || values[0] === null || !(values[0] > 0)) {
    return { status: "unread", reason: "the stated g is not one positive value" };
  }
  return { status: "read", value: values[0] };
}

function statedHeight(text: string): ProjectileStatedConditions["height"] {
  if (!HEIGHT_MENTION.test(text)) return { status: "none" };
  if (LANDING_ELEVATION.test(text)) return { status: "unread", reason: "the projectile lands on a raised body the figure does not draw" };
  const reads = HEIGHT_VALUES.flatMap((pattern) => [...text.matchAll(pattern)]
    // A launch height is where the launch starts: "from", "off" or "on" it.
    .filter((match) => /\b(?:from|off|on|atop|top\s+of|edge\s+of)\b[^.;?!]{0,30}$/i.test(text.slice(Math.max(0, match.index! - 40), match.index!))
      || /^\s*(?:from|at)\b/i.test(match[0]))
    .map((match) => parseStemNumber(match[1]!)));
  const values = [...new Set(reads)];
  if (values.length === 0) return { status: "unread", reason: "the question states a launch height without a metre value bound to the launch" };
  if (values.length !== 1 || values[0] === null || !(values[0] >= 0)) return { status: "unread", reason: "the stated launch height is not one value" };
  return { status: "read", value: values[0] };
}

export function projectileStatedConditions(question: string): ProjectileStatedConditions {
  const text = prepareStem(question);
  return { angle: statedLaunchAngle(text), g: statedGravity(text), height: statedHeight(text) };
}
