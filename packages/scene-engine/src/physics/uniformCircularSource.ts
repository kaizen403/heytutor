/**
 * Uniform circular motion source authority.
 *
 * Reads the submitted question (never options) for one body moving uniformly
 * on a circle, binds each stated number to its physical role by its unit and
 * the words around it, and recomputes every derived state deterministically:
 * ω, v, T, f, a_c = v²/r = ω²r, F_c = m v²/r and the angle and arc after a
 * stated time. Nothing is guessed: no rotation sense unless the source states
 * one, no numeric state from symbolic R/v/θ, and a contradictory, degenerate
 * or nonuniform source is rejected so no other family can paint a replacement.
 *
 * Returns null when the question is not a uniform circular motion question in
 * this grammar, so other topics (vertical circles, banked roads, conical
 * pendula, charged particles, orbits under gravitation) keep their own paths.
 */

import { readUniformCircularRuntimeContract, uniformCircularRuntimePlanConflicts, uniformCircularRuntimeQuantityValue, uniformCircularRuntimeDerivedDisplayMatches } from "./uniformCircularAuthority";
import { STEM_NUMBER, TUPLE_COMPONENT_NUMBER, parseStemNumber } from "../archetypes/slots";

export type RotationSense = "clockwise" | "anticlockwise";

export interface UniformCircularNumeric {
  status: "numeric";
  /** Radius as stated, in its source length unit. */
  radius: number;
  radiusUnit: "m" | "cm" | "mm" | "km";
  radiusM: number;
  /** How the radius was bound: stated radius, half a stated diameter, or the string length of a horizontal circle. */
  radiusSource: "radius" | "diameter" | "string_length" | "position";
  /**
   * Position of the body as a phase from +x (x right, y up), when the source
   * states one: a Cartesian point relative to the centre, or a compass point
   * under the standard diagram convention east = +x, north = +y. Null means
   * the source gives no position and the drawn position is a display choice.
   */
  phase: number | null;
  phaseSource: "cartesian" | "compass" | null;
  /** Literal name attached to the stated Cartesian body position, if any. */
  positionName?: string;
  /** Which stated rate fixed the motion. */
  rateSource: "speed" | "angular_speed" | "period" | "frequency" | "revolutions_in_time" | "centripetal_acceleration";
  /** Magnitudes, SI. Signed angular velocity only exists when a sense is stated. */
  speed: number;
  angularSpeed: number;
  period: number;
  frequency: number;
  centripetalAcceleration: number;
  mass: number | null;
  centripetalForce: number | null;
  elapsedTime: number | null;
  angleSwept: number | null;
  arcLength: number | null;
  sense: RotationSense | null;
  /** Signed ω under x right, y up, positive anticlockwise; null without a stated sense. */
  signedAngularVelocity: number | null;
  /** Source facts the reader consumed, for narration and audit. */
  givens: ReadonlyArray<{ role: string; value: number; unit: string; text: string }>;
}

export interface UniformCircularSymbolic {
  status: "symbolic";
  radiusSymbol: string | null;
  /** A stated numeric radius when no rate is given (qualitative state only). */
  radiusText: string | null;
  speedSymbol: string | null;
  angleSymbol: string | null;
  /** θ measured from the positive x-axis, when the source says so. */
  angleFromPositiveX: boolean;
  sense: RotationSense | null;
}

export interface UniformCircularReject {
  status: "reject";
  code:
    | "nonpositive_radius"
    | "nonpositive_rate"
    | "contradictory_sense"
    | "contradictory_rates"
    | "ambiguous_radius"
    | "ambiguous_position"
    | "contradictory_position"
    | "unsupported_position_name"
    | "unreadable_quantity"
    | "nonuniform"
    | "out_of_range";
  reason: string;
}

export type UniformCircularSource = UniformCircularNumeric | UniformCircularSymbolic | UniformCircularReject;

const TWO_PI = 2 * Math.PI;
const MAX_RADIUS_M = 1e12;
const MAX_SPEED = 3e7;
const CONSISTENCY = 1e-3;

type Dim = "length" | "speed" | "acceleration" | "angular" | "frequency" | "time" | "mass" | "force";
interface Mention { value: number; unit: string; dim: Dim; factor: number; start: number; end: number; text: string }

// Longest units first so "m/s^2" never reads as "m/s" and "km/h" never as "km".
const UNITS: ReadonlyArray<readonly [RegExp, Dim, number, string]> = [
  [/^(?:m\/s\^?2|m\/s²|m\s*s\^?-2|m\s*s⁻²)/, "acceleration", 1, "m/s^2"],
  [/^(?:cm\/s\^?2|cm\/s²)/, "acceleration", 0.01, "cm/s^2"],
  [/^(?:rad\s*\/\s*ms|rad\s*ms\^?-1)/, "angular", 1000, "rad/ms"],
  [/^(?:rad\s*\/\s*s(?:ec(?:ond)?)?|rad\s*s\^?-1|rad\s*s⁻¹|radians? per second)/, "angular", 1, "rad/s"],
  [/^(?:rev(?:olutions?)?\s*(?:\/|per)\s*min(?:ute)?|r\.?p\.?m\.?|rpm)/, "frequency", 1 / 60, "rev/min"],
  [/^(?:rev(?:olutions?)?\s*(?:\/|per)\s*s(?:ec(?:ond)?)?|r\.?p\.?s\.?|rps)/, "frequency", 1, "rev/s"],
  [/^(?:hz|hertz)\b/, "frequency", 1, "Hz"],
  [/^(?:km\s*\/\s*h(?:r|our)?|km\s*h\^?-1|km\s*h⁻¹|kmph|km per hour)/, "speed", 1000 / 3600, "km/h"],
  [/^(?:km\s*\/\s*s|km\s*s\^?-1|km\s*s⁻¹)/, "speed", 1000, "km/s"],
  [/^(?:cm\s*\/\s*s|cm\s*s\^?-1|cm\s*s⁻¹)/, "speed", 0.01, "cm/s"],
  [/^(?:m\s*\/\s*s(?:ec)?|m\s*s\^?-1|m\s*s⁻¹|metres? per second|meters? per second)/, "speed", 1, "m/s"],
  [/^(?:kg|kilograms?)\b/, "mass", 1, "kg"],
  [/^(?:g|grams?)\b/, "mass", 0.001, "g"],
  [/^(?:n|newtons?)\b/, "force", 1, "N"],
  [/^(?:km|kilomet(?:er|re)s?)\b/, "length", 1000, "km"],
  [/^(?:cm|centimet(?:er|re)s?)\b/, "length", 0.01, "cm"],
  [/^(?:mm|millimet(?:er|re)s?)\b/, "length", 0.001, "mm"],
  [/^(?:m|met(?:er|re)s?)\b/, "length", 1, "m"],
  [/^(?:ms|milliseconds?)\b/, "time", 0.001, "ms"],
  [/^(?:s|sec|secs|seconds?)\b/, "time", 1, "s"],
  [/^(?:min|mins|minutes?)\b/, "time", 60, "min"],
  [/^(?:h|hr|hrs|hours?)\b/, "time", 3600, "h"],
];

interface Unreadable { text: string }

/**
 * Every number with a unit. A fraction (1/2 m) or mixed number (1 1/2 m) is
 * read whole; a number joined to any other operator (π/2 rad/s, 2^3 m, 3*4 m)
 * is reported as unreadable so the caller declines rather than binding a
 * piece of an expression.
 */
function mentions(text: string, unreadable: Unreadable[] = []): Mention[] {
  const found: Mention[] = [];
  const pattern = new RegExp(`${STEM_NUMBER}\\s*`, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const rest = text.slice(match.index + match[0].length).toLowerCase();
    const unit = UNITS.find(([unitPattern]) => unitPattern.test(rest));
    if (!unit) continue;
    const unitText = unit[0].exec(rest)![0];
    const end = match.index + match[0].length + unitText.length;
    pattern.lastIndex = end;
    const value = parseStemNumber(match[1]!);
    if (value === null || !Number.isFinite(value)) { unreadable.push({ text: match[0].trim() }); continue; }
    found.push({ value, unit: unit[3], dim: unit[1], factor: unit[2], start: match.index, end, text: text.slice(match.index, end).trim() });
  }
  // The shared grammar never starts a number after an operator, so π/2 rad/s
  // yields nothing above. Such a quantity is reported, not silently dropped.
  for (const match of text.matchAll(/[/^*×÷πθ·]\s*(\d+(?:\.\d+)?)\s*/g)) {
    const start = match.index! + match[0].indexOf(match[1]!);
    if (found.some((mention) => start >= mention.start && start < mention.end)) continue;
    const rest = text.slice(match.index! + match[0].length).toLowerCase();
    if (UNITS.some(([unitPattern]) => unitPattern.test(rest))) unreadable.push({ text: text.slice(match.index!, match.index! + match[0].length + 8).trim() });
  }
  return found;
}

function before(text: string, mention: Mention, span = 40): string {
  const head = text.slice(Math.max(0, mention.start - span), mention.start).toLowerCase();
  // Stay inside the clause: a comma, full stop or "and" boundary ends the context.
  const parts = head.split(/[.;,]|\band\b|\bwith\b/);
  return parts[parts.length - 1] ?? "";
}

function after(text: string, mention: Mention, span = 16): string {
  return text.slice(mention.end, mention.end + span).toLowerCase();
}

const CIRCLE = /\b(?:circle|circular|orbit)\b/i;
const UNIFORM_CLAUSE = new RegExp([
  String.raw`uniform circular motion`,
  String.raw`\b(?:uniform|constant|steady) (?:speed|angular (?:speed|velocity))`,
  String.raw`\buniformly\b`,
  String.raw`\bwhirl(?:ed|s|ing)?\b`,
  String.raw`\brevolv(?:es|ing|e)\b`,
  String.raw`\b(?:moves?|moving|travels?|travelling|traveling|goes|going|runs?|running|rotat(?:es|ing)) (?:(?:anti-?|counter-?)?clockwise |\w+ly )?(?:with [^.]{0,40})?(?:in|on|along|round|around) (?:a|the) (?:horizontal )?(?:circle|circular)`,
  String.raw`\bcircular (?:path|track|orbit|road|turn)`,
  String.raw`\bhorizontal circle`,
  String.raw`\b(?:omega|ω|angular (?:speed|velocity))\b`,
].join("|"), "i");
// Other topics own these setups: forces in a vertical circle, banking and
// friction limits, pendula, charged particles in fields, gravitation and
// rigid-body rotation.
const OTHER_TOPIC = /\bvertical circle|\bloop\b|conical pendulum|\bpendulum\b|\bbank(?:ed|ing)?\b|friction|coefficient|magnetic|electric field|\bcharge[ds]?\b|\belectron\b|\bproton\b|\bion\b|gravitational constant|universal gravitation|mass of the earth|\bplanet\b|torque|moment of inertia|\brolling\b|\bdisc\b|\bdisk\b|\bwheel\b|\bflywheel\b|\bfan\b|lowest point|highest point|\bbohr\b|\bnucleus\b|\bspring\b|\brod\b|\bbar\b|rigid body|\bblade\b|\bcylinder\b|\bsphere\b/i;
const PARTICLE_RATE = /\b(?:particle|body|point mass|bead)\b[^.]*\b(?:omega|ω|angular (?:speed|velocity))\b/i;
const NONUNIFORM = /angular acceleration|tangential acceleration|non-?uniform|speed (?:increases|decreases|is increasing|is decreasing)|(?:increasing|decreasing) speed|accelerat(?:es|ing) (?:uniformly )?from rest/i;

function senseOf(text: string): RotationSense | null | "both" {
  const anti = /\b(?:anti-?\s?clockwise|counter-?\s?clockwise)\b/i.test(text);
  const plain = /(?<!anti-?\s?|counter-?\s?)\bclockwise\b/i.test(text.replace(/\b(?:anti-?\s?clockwise|counter-?\s?clockwise)\b/gi, ""));
  if (anti && plain) return "both";
  return anti ? "anticlockwise" : plain ? "clockwise" : null;
}

function relativeClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= CONSISTENCY * Math.max(Math.abs(a), Math.abs(b));
}

function reject(code: UniformCircularReject["code"], reason: string): UniformCircularReject {
  return { status: "reject", code, reason };
}

/** Whether the question is a uniform circular motion question this reader owns. */
export function isUniformCircularQuestion(question: string): boolean {
  const text = question.trim();
  if (/\bG\s*=/.test(text)) return false;
  // A particle moving uniformly with a stated angular rate is on a circle even
  // when the word is left out ("at P=(-3,4) m relative to O ... angular speed").
  const circular = CIRCLE.test(text) || (PARTICLE_RATE.test(text) && /\buniform(?:ly)?\b/i.test(text));
  return circular && UNIFORM_CLAUSE.test(text) && !OTHER_TOPIC.test(text);
}

export interface UniformCircularReadOptions {
  /**
   * The turn plan or ProblemIR already names a circular-motion law or
   * quantity. The plan, not wording, then decides the topic; the source is
   * only read for its quantities, and other-topic vetoes still apply.
   */
  planNamesCircularMotion?: boolean;
}

export function readUniformCircularSource(question: string, options: UniformCircularReadOptions = {}): Readonly<UniformCircularSource> | null {
  if (typeof question !== "string" || question.length > 4000) return null;
  const text = question.trim().replace(/[−–]/g, "-");
  const admitted = options.planNamesCircularMotion
    ? !OTHER_TOPIC.test(text) && !/\bG\s*=/.test(text)
    : isUniformCircularQuestion(text);
  if (!admitted) return null;
  if (NONUNIFORM.test(text)) return reject("nonuniform", "the source states a changing speed; a uniform circular state would omit its tangential acceleration");
  const sense = senseOf(text);
  if (sense === "both") return reject("contradictory_sense", "the source states both clockwise and anticlockwise motion");

  const unreadable: Unreadable[] = [];
  const found = mentions(text, unreadable);
  if (unreadable.length) return reject("unreadable_quantity", `a stated quantity is part of an expression the reader does not evaluate: ${unreadable.map((entry) => entry.text).join("; ")}`);
  const givens: Array<{ role: string; value: number; unit: string; text: string }> = [];
  const radii: Array<{ value: number; unit: Mention["unit"]; factor: number; source: UniformCircularNumeric["radiusSource"]; text: string }> = [];
  const speeds: Mention[] = [];
  const angulars: Mention[] = [];
  const frequencies: Mention[] = [];
  const accelerations: Mention[] = [];
  const masses: Mention[] = [];
  const forces: Mention[] = [];
  let period: Mention | null = null;
  let elapsed: Mention | null = null;
  let revolutionsInTime: { count: number; time: Mention } | null = null;

  // "makes 14 revolutions in 25 s" / "completes one revolution in 2 s".
  const revs = /\b(\d+(?:\.\d+)?|one|a|an|two|three|four|five|ten)\s+(?:complete\s+)?(?:revolutions?|rotations?|rounds?|turns?|laps?)\s+(?:in|every|each)\s+/i.exec(text);
  const words: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };

  for (const mention of found) {
    const context = before(text, mention);
    const next = after(text, mention);
    if (mention.dim === "time" && revs && mention.start >= revs.index + revs[0].length - 1 && mention.start <= revs.index + revs[0].length + 1) {
      const count = words[revs[1]!.toLowerCase()] ?? Number(revs[1]);
      revolutionsInTime = { count, time: mention };
      continue;
    }
    switch (mention.dim) {
      case "length": {
        if (/\bdiameter\b/.test(context) || /^\s*(?:in )?diameter\b/.test(next)) radii.push({ value: mention.value / 2, unit: mention.unit, factor: mention.factor, source: "diameter", text: mention.text });
        else if (/\bradius\b|\br\s*=\s*$|\bradii\b/.test(context) || /^\s*(?:in )?radius\b/.test(next)) radii.push({ value: mention.value, unit: mention.unit, factor: mention.factor, source: "radius", text: mention.text });
        else if (/\b(?:string|cord|rope|thread)\b/.test(context) && /horizontal circle/i.test(text)) radii.push({ value: mention.value, unit: mention.unit, factor: mention.factor, source: "string_length", text: mention.text });
        else if (/\b(?:string|cord|rope|thread)\b/.test(next) && /\blong\b|length/.test(context + next) && /horizontal circle/i.test(text)) radii.push({ value: mention.value, unit: mention.unit, factor: mention.factor, source: "string_length", text: mention.text });
        else if (/^\s*long\b/.test(next) && /\b(?:string|cord|rope|thread)\b/.test(text.slice(Math.max(0, mention.start - 60), mention.start).toLowerCase()) && /horizontal circle/i.test(text)) radii.push({ value: mention.value, unit: mention.unit, factor: mention.factor, source: "string_length", text: mention.text });
        // Other lengths (a height, a distance asked for) are not the radius.
        break;
      }
      case "speed": speeds.push(mention); break;
      case "acceleration":
        // g = 9.8 m/s^2 is the gravitational field, not this body's centripetal acceleration.
        if (!/\bg\s*=\s*$|gravit|free fall/.test(context)) accelerations.push(mention);
        break;
      case "angular": angulars.push(mention); break;
      case "frequency": frequencies.push(mention); break;
      case "mass": masses.push(mention); break;
      case "force": forces.push(mention); break;
      case "time": {
        if (/\b(?:period|time period|periodic time)\b/.test(context) || /\b(?:one|a|each|every|per|single) (?:complete )?(?:revolution|rotation|round|lap|turn)\b[^.]{0,20}$/.test(context) || /^\s*(?:to|for) (?:complete|make|go)/.test(next)) period = mention;
        else if (/\b(?:after|in|for|during|within)\s*(?:a time (?:of\s*)?)?$|\bt\s*=\s*$|\btime (?:of|interval of)?\s*$/.test(context)) elapsed = mention;
        break;
      }
    }
  }

  const radiusKeys = new Set(radii.map((entry) => entry.value * entry.factor));
  if (radiusKeys.size > 1) return reject("ambiguous_radius", "more than one distinct radius is stated");
  if (speeds.length > 1 && new Set(speeds.map((m) => m.value * m.factor)).size > 1) return reject("contradictory_rates", "more than one distinct speed is stated");

  // A stated body position: a Cartesian point about the centre, or a compass point.
  let phase: number | null = null;
  let phaseSource: UniformCircularNumeric["phaseSource"] = null;
  const pairMatches = [...text.matchAll(new RegExp(`\\(\\s*${TUPLE_COMPONENT_NUMBER}\\s*(m|cm|mm|km)?\\s*,\\s*${TUPLE_COMPONENT_NUMBER}\\s*(m|cm|mm|km)?\\s*\\)(?:\\s*(m|cm|mm|km)\\b)?`, "g"))];
  // An unreadable stated coordinate must not disappear into a display phase.
  const statedPairs = [...text.matchAll(/\([^()]*,[^()]*\)/g)].filter((pair) => /\d/.test(pair[0]));
  if (statedPairs.some((pair) => !pairMatches.some((match) => match.index === pair.index))) {
    return reject("unreadable_quantity", "a stated position coordinate could not be read whole");
  }
  const pairs = pairMatches
    .map((match) => {
      const units = [match[2], match[4], match[5]].filter(Boolean) as string[];
      const lead = text.slice(Math.max(0, match.index! - 30), match.index!);
      const fullLead = text.slice(0, match.index!);
      const name = /\b([\p{L}][\p{L}\p{N}_'′]*)\s*=\s*$/u.exec(fullLead)?.[1]
        ?? /\b([A-Z][A-Za-z0-9_'′]*)\s*$/u.exec(fullLead)?.[1];
      return { x: parseStemNumber(match[1]!) ?? Number.NaN, y: parseStemNumber(match[3]!) ?? Number.NaN, units, name, centre: /\b(?:centre|center|centred|centered)\b(?:\s+(?:at|is))?\s*(?:O\s*)?=?\s*$/i.test(lead), text: match[0] };
    });
  const centres = pairs.filter((entry) => entry.centre);
  const points = pairs.filter((entry) => !entry.centre);
  if (centres.length > 1 || points.length > 1) return reject("ambiguous_position", "more than one centre or body position is stated");
  const point = points[0];
  // The rotational kernel distinguishes single uppercase point identities
  // from physical value claims. Other names must not fall back to a renamed P.
  if (point?.name && !/^[A-Z]$/.test(point.name)) return reject("unsupported_position_name", "the rotational position supports a single uppercase point identity");
  if (point) {
    const centre = centres[0] ?? { x: 0, y: 0, units: [] as string[] };
    const units = new Set([...point.units, ...centre.units]);
    if (units.size > 1) return reject("ambiguous_position", "a stated position needs one length unit");
    const radiusUnit = radii[0]?.unit;
    // A unitless pair takes the radius unit only when its length is that radius.
    const unitText = [...units][0] ?? radiusUnit;
    if (!unitText) return reject("ambiguous_position", "a stated position needs a length unit");
    const factor = ({ m: 1, cm: 0.01, mm: 0.001, km: 1000 } as Record<string, number>)[unitText]!;
    const x = point.x - centre.x; const y = point.y - centre.y;
    const norm = Math.hypot(x, y);
    if (!Number.isFinite(norm)) return reject("unreadable_quantity", "a stated position coordinate could not be read");
    if (!(norm > 0)) return reject("nonpositive_radius", "the stated position is the centre itself");
    // The pair is a position about the centre only when the source says where
    // the centre is, or when its length is exactly the stated radius.
    const aboutCentre = centres.length === 1 || /\b(?:centred|centered)\s+at\s+(?:the\s+)?origin\b|\brelative to (?:the )?(?:O|centre|center|origin)\b|\bfrom (?:the )?(?:O|centre|center)\b|\babout (?:the )?(?:O|origin)\b|\b(?:centre|center)\s+O\b|\bcentred at O\b|\bcentered at O\b/i.test(text);
    const onStatedCircle = radii.length > 0 && relativeClose(radii[0]!.value * radii[0]!.factor, norm * factor);
    if (radii.length > 0 && !onStatedCircle) return reject("contradictory_position", "the stated position is not on the stated circle");
    if (!aboutCentre && !onStatedCircle) return reject("ambiguous_position", "a stated position must be relative to the centre of the circle");
    if (units.size === 0 && !onStatedCircle) return reject("ambiguous_position", "a unitless position must lie on the stated circle");
    phase = Math.atan2(y, x); phaseSource = "cartesian";
    if (radii.length === 0) radii.push({ value: norm, unit: unitText, factor, source: "position", text: point.text });
  }
  const compass = [...text.matchAll(/\b(east|north|west|south)(?:ernmost)?\s+(?:point|end|side)\b|\bat\s+(?:the\s+)?(east|north|west|south)\b|\bdue\s+(east|north|west|south)\s+of\s+(?:the\s+)?(?:centre|center|O)\b/gi)]
    .map((match) => (match[1] ?? match[2] ?? match[3])!.toLowerCase());
  if (new Set(compass).size > 1) return reject("ambiguous_position", "more than one compass position is stated");
  if (compass.length) {
    const compassPhase = { east: 0, north: Math.PI / 2, west: Math.PI, south: -Math.PI / 2 }[compass[0] as "east"];
    if (phase !== null && Math.abs(Math.atan2(Math.sin(phase - compassPhase), Math.cos(phase - compassPhase))) > 1e-6) return reject("contradictory_position", "the compass and Cartesian positions disagree");
    if (phase === null) { phase = compassPhase; phaseSource = "compass"; }
  }
  const radius = radii[0];
  const hasRate = speeds.length + angulars.length + frequencies.length + accelerations.length > 0 || period || revolutionsInTime;
  if (!radius || !hasRate) {
    if (radius && radius.value <= 0) return reject("nonpositive_radius", "a circular path needs a positive radius");
    // Without a bound radius and rate, only a stem that itself names a circle gets the qualitative figure.
    if (!CIRCLE.test(text)) return null;
    return symbolic(text, radius ? `${radius.value} ${radius.unit}` : null, sense);
  }
  if (!(radius.value > 0)) return reject("nonpositive_radius", "a circular path needs a positive radius");
  const radiusM = radius.value * radius.factor;
  if (!(radiusM <= MAX_RADIUS_M)) return reject("out_of_range", "the radius is outside the supported range");
  givens.push({ role: radius.source, value: radius.source === "diameter" ? radius.value * 2 : radius.value, unit: radius.unit, text: radius.text });

  // Every stated rate yields an ω; they must agree.
  const omegas: Array<{ omega: number; source: UniformCircularNumeric["rateSource"] }> = [];
  for (const m of speeds) { if (!(m.value > 0)) return reject("nonpositive_rate", "speed must be positive"); omegas.push({ omega: m.value * m.factor / radiusM, source: "speed" }); givens.push({ role: "speed", value: m.value, unit: m.unit, text: m.text }); }
  for (const m of angulars) { if (!(m.value > 0)) return reject("nonpositive_rate", "a signed or zero angular rate needs an explicit frame; only a positive angular speed is supported"); omegas.push({ omega: m.value * m.factor, source: "angular_speed" }); givens.push({ role: "angular_speed", value: m.value, unit: m.unit, text: m.text }); }
  for (const m of frequencies) { if (!(m.value > 0)) return reject("nonpositive_rate", "frequency must be positive"); omegas.push({ omega: TWO_PI * m.value * m.factor, source: "frequency" }); givens.push({ role: "frequency", value: m.value, unit: m.unit, text: m.text }); }
  if (period) { const p = period as Mention; if (!(p.value > 0)) return reject("nonpositive_rate", "period must be positive"); omegas.push({ omega: TWO_PI / (p.value * p.factor), source: "period" }); givens.push({ role: "period", value: p.value, unit: p.unit, text: p.text }); }
  if (revolutionsInTime) { const { count, time } = revolutionsInTime; if (!(count > 0) || !(time.value > 0)) return reject("nonpositive_rate", "revolution count and time must be positive"); omegas.push({ omega: TWO_PI * count / (time.value * time.factor), source: "revolutions_in_time" }); givens.push({ role: "revolutions", value: count, unit: "rev", text: revs![0].trim() }, { role: "revolution_time", value: time.value, unit: time.unit, text: time.text }); }
  for (const m of accelerations) { if (!(m.value > 0)) return reject("nonpositive_rate", "centripetal acceleration must be positive"); omegas.push({ omega: Math.sqrt(m.value * m.factor / radiusM), source: "centripetal_acceleration" }); givens.push({ role: "centripetal_acceleration", value: m.value, unit: m.unit, text: m.text }); }
  const first = omegas[0]!;
  if (omegas.some((entry) => !relativeClose(entry.omega, first.omega))) return reject("contradictory_rates", "the stated speed, angular speed, period or acceleration disagree for this radius");

  const angularSpeed = first.omega;
  // Canonical source equation tree: (2πr)/T, then v²/r. SourceIR uses the
  // same order; the scoped restore proof handles earlier binary64 drift.
  const speed = first.source === "speed" ? speeds[0]!.value * speeds[0]!.factor
    : first.source === "period" ? TWO_PI * radiusM / ((period as Mention).value * (period as Mention).factor)
    : angularSpeed * radiusM;
  if (!(speed > 0) || speed > MAX_SPEED || !Number.isFinite(angularSpeed)) return reject("out_of_range", "the derived speed is outside the supported nonrelativistic range");
  const mass = masses.length === 1 ? masses[0]!.value * masses[0]!.factor : null;
  if (masses.length > 1) return reject("contradictory_rates", "more than one mass is stated for one body");
  if (mass !== null && !(mass > 0)) return reject("nonpositive_rate", "mass must be positive");
  if (mass !== null) givens.push({ role: "mass", value: masses[0]!.value, unit: masses[0]!.unit, text: masses[0]!.text });
  const centripetalAcceleration = speed * speed / radiusM;
  const centripetalForce = mass === null ? null : mass * centripetalAcceleration;
  if (forces.length) {
    // A stated force must agree with m v²/r; without a mass it cannot be checked, so it is not a rate source.
    if (centripetalForce === null || forces.some((f) => !relativeClose(f.value * f.factor, centripetalForce))) {
      if (centripetalForce !== null) return reject("contradictory_rates", "the stated force disagrees with m v^2 / r");
    }
  }
  const elapsedTime = elapsed ? (elapsed as Mention).value * (elapsed as Mention).factor : null;
  if (elapsedTime !== null && !(elapsedTime > 0)) return reject("nonpositive_rate", "elapsed time must be positive");
  if (elapsed) givens.push({ role: "elapsed_time", value: (elapsed as Mention).value, unit: (elapsed as Mention).unit, text: (elapsed as Mention).text });

  return Object.freeze({
    status: "numeric",
    radius: radius.value,
    radiusUnit: radius.unit as UniformCircularNumeric["radiusUnit"],
    radiusM,
    radiusSource: radius.source,
    phase,
    phaseSource,
    ...(point?.name ? { positionName: point.name } : {}),
    rateSource: first.source,
    speed,
    angularSpeed,
    period: first.source === "period" ? (period as Mention).value * (period as Mention).factor
      : first.source === "speed" ? TWO_PI * radiusM / speed : TWO_PI / angularSpeed,
    frequency: angularSpeed / TWO_PI,
    centripetalAcceleration,
    mass,
    centripetalForce,
    elapsedTime,
    angleSwept: elapsedTime === null ? statedSweep(text) : angularSpeed * elapsedTime,
    arcLength: elapsedTime === null ? (statedSweep(text) === null ? null : radiusM * statedSweep(text)!) : speed * elapsedTime,
    sense,
    signedAngularVelocity: sense === null ? null : sense === "anticlockwise" ? angularSpeed : -angularSpeed,
    givens: Object.freeze(givens.map((entry) => Object.freeze(entry))),
  } satisfies UniformCircularNumeric);
}

/** A swept angle the stem states in words or degrees (half a revolution, through 60°). */
function statedSweep(text: string): number | null {
  if (/\bhalf (?:a |of a |the )?(?:revolution|turn|rotation|circle|round|lap)\b|\bdiametrically opposite\b|\bsemi-?circle\b/i.test(text)) return Math.PI;
  if (/\bquarter (?:of )?(?:a |the )?(?:revolution|turn|rotation|circle|round|lap)\b/i.test(text)) return Math.PI / 2;
  if (/\b(?:one|a) (?:complete|full) (?:revolution|turn|rotation|round|lap)\b/i.test(text)) return 2 * Math.PI;
  const degrees = /\b(?:through|turns?|swe(?:eps|pt)|rotates?)\s+(?:an angle of\s+)?(\d+(?:\.\d+)?)\s*(?:°|degrees?)/i.exec(text);
  return degrees ? Number(degrees[1]) * Math.PI / 180 : null;
}

function symbolic(text: string, radiusText: string | null, sense: RotationSense | null): Readonly<UniformCircularSymbolic> {
  const radiusSymbol = radiusText ? null : /\bradius\s+(?:of\s+)?([Rr])\b|\bP\s*\(\s*([Rr])\s*,/.exec(text)?.slice(1).find(Boolean) ?? null;
  const speedSymbol = /\b(?:speed|velocity)\s+(?:of\s+)?([vVu])\b|\b([vV]) is (?:the )?(?:uniform |constant )?speed\b/.exec(text)?.slice(1).find(Boolean) ?? null;
  const angleSymbol = /[θφ]/.exec(text)?.[0] ?? null;
  const angleFromPositiveX = angleSymbol !== null && new RegExp(`${angleSymbol}\\s+(?:is\\s+)?measured\\s+from\\s+(?:the\\s+)?positive\\s+x[- ]?axis`, "i").test(text);
  return Object.freeze({ status: "symbolic", radiusSymbol, radiusText, speedSymbol, angleSymbol, angleFromPositiveX, sense });
}

/* ------------------------------------------------------------------------- */
/* Turn plan admission and numeric agreement                                 */
/* ------------------------------------------------------------------------- */

// A bare ω, omega or "angular frequency" also names AC and SHM laws, so only circular relations count.
const CIRCULAR_LAW = /centripetal|circular motion|uniform circular|circular path|angular (?:speed|velocity)|v\s*=\s*(?:ω|omega)\s*\*?\s*r|a\w*\s*=\s*v\s*\^?\s*2\s*\/\s*r|v²\s*\/\s*r|(?:ω|omega)\s*\^?\s*2\s*\*?\s*r|2\s*\*?\s*(?:π|pi)\s*\*?\s*r\s*\/\s*t|2\s*\*?\s*(?:π|pi)\s*\/\s*t|period of (?:revolution|rotation)/i;
// Symbols that name a circular quantity on their own. ω, omega and w also name
// AC or wave angular frequency, river width or weight, so they count only
// through an angular rate unit below.
const CIRCULAR_SYMBOL = /^(?:a_?c|a_?cp|F_?c|F_?cp)$/;

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
}

function strings(...values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

function planUnit(value: unknown): { dim: Dim; factor: number } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim().toLowerCase().replace(/²/g, "^2").replace(/⁻¹/g, "^-1").replace(/⁻²/g, "^-2").replace(/\s+/g, " ");
  const entry = UNITS.find(([pattern]) => { const match = pattern.exec(text); return match !== null && match[0].length === text.length; });
  return entry ? { dim: entry[1], factor: entry[2] } : null;
}

/**
 * Whether the turn plan or ProblemIR names circular motion: a law tag, a
 * quantity symbol, an angular-rate unit, or a ProblemIR fact or entity that
 * does. Only structured planner output is read here, never the question.
 */
export function planNamesCircularMotion(turnPlan: unknown, problemIR?: unknown): boolean {
  const plan = typeof turnPlan === "object" && turnPlan !== null ? turnPlan as Record<string, unknown> : {};
  const laws = strings(...(Array.isArray(plan.lawIds) ? plan.lawIds : []));
  if (laws.some((law) => CIRCULAR_LAW.test(law.replace(/_/g, " ")))) return true;
  const quantities = [...records(plan.givens), ...records(plan.derived), ...records(plan.unknowns)];
  for (const quantity of quantities) {
    const symbol = typeof quantity.symbol === "string" ? quantity.symbol.replace(/[{}\\]/g, "").trim() : "";
    if (CIRCULAR_SYMBOL.test(symbol)) return true;
    const unit = planUnit(quantity.unit);
    // rad/s and revolutions per time; a bare Hz is a wave or AC frequency too.
    if (unit?.dim === "angular" || (unit?.dim === "frequency" && unit.factor !== 1)) return true;
    if (unit?.dim === "frequency" && typeof quantity.unit === "string" && /rev|rps|r\.?p\.?s/i.test(quantity.unit)) return true;
    if (strings(quantity.id, quantity.sourceText).some((text) => /centripetal|angular (?:speed|velocity)/i.test(text.replace(/_/g, " ")))) return true;
  }
  if (planQuantitiesSatisfyCircularRelation(plan)) return true;
  const ir = typeof problemIR === "object" && problemIR !== null ? problemIR as Record<string, unknown> : {};
  return [...records(ir.facts), ...records(ir.entities)].some((entry) =>
    strings(entry.statement, entry.label, entry.kind).some((text) => /centripetal|uniform circular|circular motion|angular (?:speed|velocity)/i.test(text.replace(/_/g, " "))));
}

/**
 * Structural evidence: the plan's own derived value satisfies a circular
 * relation with the plan's own givens. A derived acceleration equal to
 * v^2/r or ω^2 r, a derived time equal to 2πr/v, or a derived force equal to
 * m v^2/r, within the rounding of the derived value as written. Symbols are
 * not read; only units, provenance and values.
 */
function planQuantitiesSatisfyCircularRelation(plan: Record<string, unknown>): boolean {
  type Si = { value: number; written: number; factor: number };
  const si = (list: unknown, dim: Dim): Si[] => records(list).flatMap((quantity) => {
    const unit = planUnit(quantity.unit);
    if (!unit || unit.dim !== dim || typeof quantity.value !== "number" || !Number.isFinite(quantity.value) || quantity.value === 0) return [];
    if (dim === "acceleration" && (/^g$/i.test(String(quantity.symbol ?? "")) || /gravit/i.test(String(quantity.id ?? "")))) return [];
    return [{ value: Math.abs(quantity.value) * unit.factor, written: Math.abs(quantity.value), factor: unit.factor }];
  });
  const lengths = si(plan.givens, "length");
  const speeds = si(plan.givens, "speed");
  const omegas = si(plan.givens, "angular");
  const masses = si(plan.givens, "mass");
  const matches = (derived: Si, expected: number): boolean =>
    Math.abs(derived.value - expected) <= Math.max(roundingTolerance(derived.written) * derived.factor, 1e-9 * expected);
  const centripetal = lengths.flatMap((r) => [...speeds.map((v) => v.value ** 2 / r.value), ...omegas.map((w) => w.value ** 2 * r.value)]);
  if (si(plan.derived, "acceleration").some((a) => centripetal.some((expected) => matches(a, expected)))) return true;
  const periods = lengths.flatMap((r) => speeds.map((v) => 2 * Math.PI * r.value / v.value));
  if (si(plan.derived, "time").some((t) => periods.some((expected) => matches(t, expected)))) return true;
  const forces = masses.flatMap((m) => centripetal.map((a) => m.value * a));
  return si(plan.derived, "force").some((f) => forces.some((expected) => matches(f, expected)));
}

function roundingTolerance(value: number): number {
  const text = String(Math.abs(value));
  const decimals = /e/i.test(text) ? 0 : (text.split(".")[1] ?? "").length;
  return Math.max(1e-3 * Math.abs(value), 0.5 * 10 ** -decimals);
}

export interface StalePlanQuantity { id: string; symbol: string; planValue: number; sourceValue: number; unit: string }

/**
 * Plan givens and derived values that disagree with the source authority.
 * Each plan quantity is matched by its unit dimension and symbol to one
 * recomputed state value; a plan value only counts as agreeing within the
 * rounding its own written digits allow in the historical extended profile.
 * The bounded runtime profile instead uses an arithmetic roundoff proof and
 * declines unknown physical roles, units and requests without removing them.
 */
export function stalePlanQuantities(source: UniformCircularNumeric, turnPlan: unknown): StalePlanQuantity[] {
  const plan = typeof turnPlan === "object" && turnPlan !== null ? turnPlan as Record<string, unknown> : {};
  const stale: StalePlanQuantity[] = [];
  const runtime = typeof plan.question === "string" ? readUniformCircularRuntimeContract(plan.question) : null;
  for (const quantity of [...records(plan.givens), ...records(plan.derived)]) {
    if (runtime?.status === "bound" && typeof quantity.symbol === "string" && typeof quantity.value === "number") {
      const expected = uniformCircularRuntimeQuantityValue(source, { symbol: quantity.symbol, unit: typeof quantity.unit === "string" ? quantity.unit : undefined });
      if (expected !== null) {
        const u = Number.EPSILON / 2;
        const allowance = quantity.provenance === "given" ? 0 : 8 * u / (1 - 8 * u) * Math.abs(expected);
        if (Math.abs(quantity.value - expected) > allowance && !uniformCircularRuntimeDerivedDisplayMatches(runtime.contract, quantity)) stale.push({ id: String(quantity.id ?? ""), symbol: quantity.symbol, planValue: quantity.value, sourceValue: expected, unit: String(quantity.unit ?? "") });
        continue;
      }
    }
    const verdict = judgePlanQuantity(source, quantity);
    if (verdict?.agrees === false) stale.push(verdict.stale);
  }
  return [...stale, ...(typeof plan.question === "string" ? uniformCircularRuntimePlanConflicts(plan.question, plan) : [])];
}

type Verdict = { agrees: true } | { agrees: false; bound: boolean; corrected: number | null; stale: StalePlanQuantity };

/**
 * Judge one plan value against the source state. A value whose unit and
 * symbol bind to one recomputed quantity is compared with it. An unbound
 * value of a class the state fixes (angular rate, frequency, centripetal
 * acceleration, a speed, a centripetal force or mass when known) must equal
 * some recomputed value of that class. Changes and averages over an interval
 * (Δv, a_avg, v_avg), and unbound lengths and times, are judged only when
 * the source fixes them, otherwise left unjudged (null).
 */
function judgePlanQuantity(source: UniformCircularNumeric, quantity: Record<string, unknown>): Verdict | null {
  if (typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return null;
  const unit = planUnit(quantity.unit);
  if (!unit) return null;
  const symbol = typeof quantity.symbol === "string" ? quantity.symbol.replace(/[{}\\]/g, "").trim() : "";
  const id = typeof quantity.id === "string" ? quantity.id : "";
  const planValue = Math.abs(quantity.value) * unit.factor;
  const close = (expected: number): boolean => Math.abs(planValue - expected) <= roundingTolerance(Math.abs(quantity.value as number)) * unit.factor;
  const stale = (expected: number): StalePlanQuantity => ({ id: id || symbol, symbol, planValue, sourceValue: expected, unit: String(quantity.unit) });
  const interval = /^(?:Δ|delta|d)\s*_?\s*[va]|change|avg|average|mean/i.test(`${symbol} ${id}`);
  if (interval) {
    // |Δv| = 2 v |sin(θ/2)| over a stated sweep; other interval quantities are not judged.
    if (unit.dim !== "speed" || source.angleSwept === null || !/^(?:Δ|delta|d)\s*_?\s*v|change/i.test(`${symbol} ${id}`)) return null;
    const expected = 2 * source.speed * Math.abs(Math.sin(source.angleSwept / 2));
    return close(expected) ? { agrees: true } : { agrees: false, bound: true, corrected: expected, stale: stale(expected) };
  }
  const key = boundState(unit.dim, symbol, id);
  if (key) {
    const expected = stateValue(source, key);
    if (expected === null) return null;
    return close(expected) && (key !== "r" || quantity.value >= 0)
      ? { agrees: true }
      : { agrees: false, bound: true, corrected: expected, stale: stale(expected) };
  }
  if (/^g$/i.test(symbol) || /gravit/i.test(id)) return null;
  const classValues: Partial<Record<Dim, Array<number | null>>> = {
    speed: [source.speed],
    angular: [source.angularSpeed],
    frequency: [source.frequency],
    acceleration: [source.centripetalAcceleration],
    force: [source.centripetalForce],
    mass: [source.mass],
  };
  const values = (classValues[unit.dim] ?? []).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.some(close) ? { agrees: true } : { agrees: false, bound: false, corrected: null, stale: stale(values[0]!) };
}

/* ------------------------------------------------------------------------- */
/* Plan correction (registered in ir/sourceQuantityAuthority)                */
/* ------------------------------------------------------------------------- */

type StateKey = "r" | "s" | "v" | "omega" | "f" | "a" | "T" | "t" | "m" | "F";

/**
 * The one recomputed quantity a plan symbol names without doubt, or null.
 * Binding needs both the unit dimension and the symbol (or an id naming the
 * quantity); a bare unit match is never enough.
 */
function boundState(dim: Dim, symbol: string, id: string): StateKey | null {
  const key = id.toLowerCase();
  switch (dim) {
    case "length": return /^(?:r|R|radius)$/.test(symbol) || /radius/.test(key) ? "r" : /^(?:s|arc)$/.test(symbol) || /arc/.test(key) ? "s" : null;
    case "speed": return /^(?:v|v_?t|speed)$/i.test(symbol) || (/speed|velocity/.test(key) && !/angular|relative/.test(key)) ? "v" : null;
    case "angular": return /^(?:ω|omega|w)$/i.test(symbol) || /angular/.test(key) ? "omega" : null;
    case "frequency": return /^(?:f|n|ν|nu|rpm)$/i.test(symbol) || /freq|rpm/.test(key) ? "f" : null;
    case "acceleration": return /^g$/i.test(symbol) || /gravit/.test(key) ? null : /^(?:a|a_?c|a_?r|a_?cp|a_?n)$/i.test(symbol) || /centripetal|radial/.test(key) ? "a" : null;
    case "time": return /^T(?:_?p)?$/.test(symbol) || /period/.test(key) ? "T" : /^t$/.test(symbol) || /elapsed/.test(key) ? "t" : null;
    case "mass": return /^m$/.test(symbol) || /mass/.test(key) ? "m" : null;
    case "force": return /^(?:F|F_?c|F_?cp|F_?net)$/.test(symbol) || /centripetal/.test(key) ? "F" : null;
  }
  return null;
}

function stateValue(source: UniformCircularNumeric, key: StateKey): number | null {
  switch (key) {
    case "r": return source.radiusM;
    case "s": return source.arcLength;
    case "v": return source.speed;
    case "omega": return source.angularSpeed;
    case "f": return source.frequency;
    case "a": return source.centripetalAcceleration;
    case "T": return source.period;
    case "t": return source.elapsedTime;
    case "m": return source.mass;
    case "F": return source.centripetalForce;
  }
}

export interface UniformCircularPlanCorrection {
  quantityId: string;
  symbol: string;
  previous: number;
  corrected: number;
  unit: string;
}

export interface UniformCircularPlanAuthority {
  plan: Record<string, unknown>;
  source: UniformCircularNumeric;
  corrections: UniformCircularPlanCorrection[];
  /** Historical extended-profile withdrawals; bounded runtime obligations stay in the plan. */
  withdrawn: StalePlanQuantity[];
  /** Conflicts or unsupported obligations still in the plan; the figure declines on any. */
  unbound: StalePlanQuantity[];
}

/**
 * Correct the plan's uniform circular values to the source state. Runs only
 * when the plan or ProblemIR names circular motion and the source binds a
 * numeric state. A given or derived value whose unit and symbol name exactly
 * one recomputed quantity is set to it (in the plan's own unit); every other
 * value is left exactly as written. Values that still disagree after that
 * are returned as unbound, and the family declines the figure on them.
 */
export function applyUniformCircularAuthority(question: string, turnPlan: unknown, problemIR?: unknown): UniformCircularPlanAuthority | null {
  if (!planNamesCircularMotion(turnPlan, problemIR)) return null;
  const source = readUniformCircularSource(question, { planNamesCircularMotion: true });
  if (source?.status !== "numeric") return null;
  const plan = turnPlan as Record<string, unknown>;
  const runtime = readUniformCircularRuntimeContract(question);
  if (runtime?.status === "declined") return { plan, source, corrections: [], withdrawn: [], unbound: [
    { id: "source", symbol: "", planValue: Number.NaN, sourceValue: Number.NaN, unit: "" },
  ] };
  // Prove the original whole Plan before scalar correction. Correcting a
  // bound number cannot remove or replace an unproved textual obligation.
  if (runtime?.status === "bound") {
    const unbound = uniformCircularRuntimePlanConflicts(question, plan);
    if (unbound.length) return { plan, source, corrections: [], withdrawn: [], unbound };
  }
  const corrections: UniformCircularPlanCorrection[] = [];
  const withdrawn: StalePlanQuantity[] = [];
  const review = (list: unknown): unknown => Array.isArray(list) ? list.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [entry];
    const quantity = entry as Record<string, unknown>;
    if (runtime?.status === "bound" && typeof quantity.symbol === "string" && typeof quantity.value === "number") {
      const expected = uniformCircularRuntimeQuantityValue(source, { symbol: quantity.symbol, unit: typeof quantity.unit === "string" ? quantity.unit : undefined });
      if (expected !== null) {
        if (quantity.value === expected) return [entry];
        corrections.push({ quantityId: String(quantity.id ?? ""), symbol: quantity.symbol, previous: quantity.value, corrected: expected, unit: String(quantity.unit ?? "") });
        return [{ ...quantity, value: expected }];
      }
      return [entry];
    }
    const verdict = judgePlanQuantity(source, quantity);
    if (!verdict || verdict.agrees) return [entry];
    if (!verdict.bound || verdict.corrected === null) {
      // Outside the bounded runtime profile, retain the historical policy.
      withdrawn.push(verdict.stale);
      return [];
    }
    const unit = planUnit(quantity.unit)!;
    const symbol = verdict.stale.symbol;
    const value = quantity.value as number;
    const isRadius = boundState(unit.dim, symbol, String(quantity.id ?? "")) === "r";
    const corrected = (!isRadius && value < 0 ? -1 : 1) * Number((verdict.corrected / unit.factor).toPrecision(6));
    corrections.push({ quantityId: verdict.stale.id, symbol, previous: value, corrected, unit: String(quantity.unit) });
    return [{ ...quantity, value: corrected, sourceText: `Source-verified ${symbol || verdict.stale.id} = ${corrected} ${String(quantity.unit)}` }];
  }) : list;
  const givens = review(plan.givens);
  const derived = review(plan.derived);
  const withdrawnIds = new Set(withdrawn.map((entry) => entry.id));
  const unknowns = Array.isArray(plan.unknowns)
    ? plan.unknowns.filter((entry) => !(typeof entry === "object" && entry !== null && withdrawnIds.has(String((entry as Record<string, unknown>).id))))
    : plan.unknowns;
  const corrected = { ...plan, givens, derived, unknowns };
  return { plan: corrected, source, corrections, withdrawn, unbound: stalePlanQuantities(source, corrected) };
}
