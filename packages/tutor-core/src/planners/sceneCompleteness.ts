/**
 * Scene completeness checklist for scene-document/v2 figures.
 *
 * buildCompletenessChecklist(plan, problemIR, question) lists what a complete
 * teaching figure for this question shows: given values and angles, named
 * points, stated right angles, the equations the stem names, the vectors and
 * constructions the stem names. Structured plan data is read first; narrow,
 * generic stem patterns second. The vocabularies are engine operators, SI
 * unit dimensions and geometry words. There are no topic tables and no
 * per-question rules.
 *
 * checkSceneCompleteness(checklist, document, compiled) returns the items a
 * scene does not show, in the measured priority order, with the request capped
 * at six. It never changes validity, authority or proof: it only ranks valid
 * candidates and, later, names what a repair request should add.
 *
 * Ported from the measured prototype (.context/h4/phys/completeness/checklist.py,
 * final configuration: plan text from lawIds only, no answer lengths, no counts).
 */
import type { RenderScene, SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";

export type CompletenessItemKind = "label" | "angle" | "construction" | "vector" | "case" | "point" | "equation";

/** The rule that produced an item; it decides the priority. */
export type CompletenessRule =
  | "stated_angle"
  | "coordinate"
  | "given_value"
  | "point_name"
  | "right_angle"
  | "equation"
  | "vector"
  | "asked_angle"
  | "construction"
  | "case";

export type CompletenessSource = "plan_given" | "plan_unknown" | "plan_law" | "stem" | "problem_ir";

export type CompletenessVectorWord =
  | "weight" | "tension" | "friction" | "normal_force" | "force" | "velocity" | "current" | "field" | "momentum";

export type CompletenessConstructionWord =
  | "perpendicular" | "normal" | "tangent" | "bisector" | "radius" | "focus" | "directrix" | "intersection"
  | "midpoint" | "centre" | "median_altitude" | "asymptote" | "region" | "strip";

export type CompletenessMatcher =
  /** A visible text carries the value (SI prefix scaling, sign ignored). */
  | { type: "value"; value: number }
  /** An angle mark exists (enough marks for every angle item when `counted`), carrying the value when one is known. */
  | { type: "angle"; value: number | null; counted: boolean }
  | { type: "right_angle" }
  /** One visible text carries every component of the tuple. */
  | { type: "coordinate"; values: number[] }
  /** A label equal to, or starting with, the name. */
  | { type: "name"; name: string }
  | { type: "vector"; word: CompletenessVectorWord }
  | { type: "construction"; word: CompletenessConstructionWord }
  | { type: "equation"; equation: string }
  | { type: "count"; noun: string; count: number };

export interface CompletenessItem {
  kind: CompletenessItemKind;
  rule: CompletenessRule;
  /** Stable key within one checklist. */
  key: string;
  /** Short human request, e.g. "label the given μk = 0.32". */
  text: string;
  source: CompletenessSource;
  symbol?: string;
  matcher: CompletenessMatcher;
}

export interface CompletenessChecklist {
  question: string;
  items: CompletenessItem[];
}

export interface SceneCompletenessResult {
  /** Items in the checklist. */
  checked: number;
  /** Every item the scene does not show, in priority order. */
  missing: CompletenessItem[];
  /** The first COMPLETENESS_REQUEST_CAP missing items: what a repair request may ask for. */
  request: CompletenessItem[];
}

export interface CompletenessChecklistOptions {
  /** Counted objects ("two blocks"). Off in the measured configuration. */
  cases?: boolean;
}

export const COMPLETENESS_REQUEST_CAP = 6;

/** Measured precision order: given angle, coordinates, given value, point, right angle, equation, vector, asked angle, construction. */
const RULE_PRIORITY: Record<CompletenessRule, number> = {
  stated_angle: 0,
  coordinate: 1,
  given_value: 2,
  point_name: 3,
  right_angle: 4,
  equation: 5,
  vector: 6,
  asked_angle: 7,
  construction: 8,
  case: 10,
};

/* ------------------------------------------------------------------------- */
/* Text and numbers                                                          */
/* ------------------------------------------------------------------------- */

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};
const SUPERSCRIPTS: Record<string, string> = { ...SUPERSCRIPT_DIGITS, "⁻": "-", "⁺": "+" };

function norm(text: string | null | undefined): string {
  return (text ?? "").replace(/[−–—]/g, "-").replace(/[\u2009\u00a0]/g, " ");
}

function subscriptsToDigits(text: string): string {
  return text.replace(/[₀-₉]/g, (char) => SUBSCRIPT_DIGITS[char] ?? char);
}

const PI_RE = /(\d*)\s*π\s*(?:\/\s*(\d+))?/g;
const NUM_RE = new RegExp(
  String.raw`(?<![A-Za-z_\d.])([-+]?\d+(?:\.\d+)?)(?:\s*(?:×|x|\*)\s*10\s*(?:\^\s*\(?\s*([-+]?\d+)\)?|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)))?` +
  String.raw`|(?<![A-Za-z_\d.])([-+]?\d+(?:\.\d+)?)[eE]([-+]?\d+)`,
  "g",
);

/** Every numeric value written in a text: scientific notation, unicode exponents and π fractions. */
function numbers(text: string): number[] {
  const normalized = norm(text);
  const out: number[] = [];
  for (const match of normalized.matchAll(PI_RE)) {
    const numerator = match[1] ? Number(match[1]) : 1;
    const denominator = match[2] ? Number(match[2]) : 1;
    out.push((numerator * Math.PI) / denominator);
  }
  const withoutPi = normalized.replace(PI_RE, " ");
  for (const match of withoutPi.matchAll(NUM_RE)) {
    if (match[1] !== undefined) {
      let value = Number(match[1]);
      let exponent = match[2];
      if (exponent === undefined && match[3]) {
        exponent = [...match[3]].map((char) => SUPERSCRIPTS[char] ?? char).join("");
      }
      if (exponent !== undefined) {
        const power = Number.parseInt(exponent, 10);
        if (Number.isFinite(power)) value *= 10 ** power;
      }
      out.push(value);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      out.push(Number(match[4]) * 10 ** Number.parseInt(match[5], 10));
    }
  }
  return out;
}

function close(first: number, second: number, relative = 0.006): boolean {
  const a = Math.abs(first);
  const b = Math.abs(second);
  if (b === 0) return a === 0;
  return Math.abs(a - b) <= Math.max(relative * b, b < 1 ? 0.0051 : 0);
}

const PREFIX_POWERS = [0, 3, -3, 6, -6, 9, -9];

function valueIn(value: number, values: readonly number[], angle = false): boolean {
  for (const candidate of values) {
    for (const power of PREFIX_POWERS) {
      if (close(candidate * 10 ** power, value)) return true;
    }
    if (angle && (close((candidate * 180) / Math.PI, value) || close(candidate, (value * Math.PI) / 180))) return true;
  }
  return false;
}

/** Python's "%g": six significant digits, no trailing zeros. */
function formatNumber(value: number): string {
  return String(Number(value.toPrecision(6)));
}

/* ------------------------------------------------------------------------- */
/* Units                                                                     */
/* ------------------------------------------------------------------------- */

type UnitClass =
  | "none" | "angle" | "length" | "mass" | "time" | "force" | "velocity" | "accel" | "current" | "field"
  | "charge" | "voltage" | "resistance" | "capacitance" | "other";

const ANGLE_UNITS = new Set(["°", "deg", "degree", "degrees", "rad", "radian", "radians"]);
const UNIT_CLASSES: Array<[UnitClass, RegExp]> = [
  ["length", /^(m|cm|mm|km|nm|μm|um|AU|ly|pm|length units?|units|coordinate units)$/],
  ["mass", /^(kg|g|mg)$/],
  ["time", /^(s|ms|μs|min|h|hr|year|years|days?)$/],
  ["force", /^(N|kN|mN)$/],
  ["velocity", /^(m\/s|km\/s|km\/h|cm\/s)$/],
  ["accel", /^(m\/s\^?2|m\/s²|cm\/s²)$/],
  ["current", /^(A|mA|μA|kA)$/],
  ["field", /^(T|mT|μT|G|N\/C|kN\/C|V\/m|kV\/m|MV\/m|V\/cm)$/],
  ["charge", /^(C|nC|μC|mC|pC|e)$/],
  ["voltage", /^(V|kV|mV)$/],
  ["resistance", /^(Ω|kΩ|MΩ|ohm|ohms)$/],
  ["capacitance", /^(F|μF|nF|pF)$/],
];

function unitClass(unit: string | null | undefined): UnitClass {
  if (!unit) return "none";
  const trimmed = unit.trim();
  if (ANGLE_UNITS.has(trimmed) || trimmed === "π rad") return "angle";
  for (const [name, pattern] of UNIT_CLASSES) {
    if (pattern.test(trimmed)) return name;
  }
  return "other";
}

/** An angle in degrees from a value in an angle unit: radians and multiples of π rad are converted. */
function angleInDegrees(value: number, unit: string | null | undefined): number {
  const trimmed = (unit ?? "").trim();
  if (trimmed === "π rad") return value * 180;
  if (trimmed.startsWith("rad")) return (value * 180) / Math.PI;
  return value;
}

/** A physical constant: the symbol names a constant AND the value is its standard value. */
const CONSTANTS: Array<[RegExp, number[]]> = [
  [/^g$/, [9.8, 9.81, 10]],
  [/^G$/, [6.67e-11]],
  [/^c$/, [3e8, 2.998e8]],
  [/^h$/, [6.63e-34, 6.626e-34]],
  [/^(k|k_?e|K)$/, [9e9, 8.99e9, 1.38e-23]],
  [/^(ε|ε₀|ε0|epsilon0|ε_0)$/, [8.85e-12, 8.854e-12]],
  [/^(μ₀|μ0|mu0|μ_0)$/, [4e-7 * Math.PI, 1.2566e-6]],
  [/^(e|q_e)$/, [1.6e-19, 1.602e-19]],
  [/^(N_A|NA)$/, [6.02e23]],
  [/^R$/, [8.31, 8.314]],
  [/^(k_B|kB)$/, [1.38e-23]],
  [/^σ$/, [5.67e-8]],
];

function isConstant(symbol: string | null | undefined, value: number): boolean {
  const trimmed = (symbol ?? "").trim();
  return CONSTANTS.some(([pattern, values]) =>
    pattern.test(trimmed) && values.some((standard) => close(value, standard, 0.02)));
}

/* ------------------------------------------------------------------------- */
/* Stem patterns                                                             */
/* ------------------------------------------------------------------------- */

const FUNCTION_NAMES = /sin|cos|tan|log|ln|exp|sec|cosec|cot|sqrt|arg/g;

function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start]!)) start += 1;
  while (end > start && chars.includes(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

function mathy(token: string): boolean {
  const trimmed = stripChars(token, ",;:.");
  if (!trimmed) return false;
  if (/[^\-+*/^=<>≤≥()[\],.√π²³⁴|a-zA-Zθ0-9₀-₉']/.test(trimmed)) return false;
  return !/[A-Za-z]{2,}/.test(trimmed.replace(FUNCTION_NAMES, ""));
}

/** Equation and inequality spans in the stem that draw a curve or line in x, y or z. */
function stemEquations(question: string): string[] {
  const words = norm(question).split(/(\s+)/);
  const out: string[] = [];
  const used = new Set<number>();
  const anchors = words.flatMap((word, index) =>
    /[=≤≥<>]/.test(word) && !/[A-Za-z]{3,}/.test(word) ? [index] : []);
  for (const anchor of anchors) {
    if (used.has(anchor)) continue;
    let low = anchor;
    while (low - 2 >= 0 && mathy(words[low - 2]!)) low -= 2;
    let high = anchor;
    while (high + 2 < words.length && mathy(words[high + 2]!)) high += 2;
    const span = words.slice(low, high + 1).join("").trim().replace(/[,;:.]+$/, "");
    for (let index = low; index <= high; index += 1) used.add(index);
    if (!/(?<![A-Za-z])[xyz](?![A-Za-z])/.test(span)) continue;
    if (span.replace(/\s/g, "").length < 3) continue;
    // A single-letter assignment to a number is a given, not a curve.
    if (/^[A-Za-z][₀-₉0-9_]*\s*=\s*[-+]?[\d.]+\s*$/.test(span)) continue;
    const variables = new Set([...span.matchAll(/(?<![A-Za-z])([xyzt])(?![A-Za-z])/g)].map((match) => match[1]!));
    // A time-dependent relation is not a curve in the plane.
    if (variables.has("t")) continue;
    // A polynomial in z alone: its roots are the figure, not the equation.
    if ([...variables].every((variable) => variable === "z") && !/^z[₀-₉0-9]?\s*=/.test(span)) continue;
    if (!/\d/.test(span) && !/^[xyz]\s*=\s*-?[xyz]$/.test(span)) continue;
    out.push(span);
  }
  return out;
}

function equationKey(text: string): string {
  return subscriptsToDigits(norm(text).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (char) => SUPERSCRIPT_DIGITS[char] ?? char))
    .replace(/\^/g, "").replace(/\*\*/g, "").replace(/·/g, "").replace(/\*/g, "").replace(/ /g, "")
    .toLowerCase();
}

/** Case-insensitive letters for a lowercase noun alternation (no escapes inside). */
function anyCase(pattern: string): string {
  return pattern.replace(/[a-z]/g, (char) => `[${char}${char.toUpperCase()}]`);
}

const OBJECT_NOUNS = anyCase("points?|vertex|vertices|cent(?:re|er)s?|foci|focus|origin|foot|pole|midpoint|corners?");
const SHAPE_NOUNS = anyCase(
  "triangle|quadrilateral|square|rectangle|parallelogram|rhombus|trapezium|polygon|pentagon|hexagon|tetrahedron|pyramid|prism|cube|cuboid|circle|sector|plane",
);
const LINE_NOUNS = anyCase(
  "lines?|segments?|chords?|sides?|diameters?|tangents?|rays?|arcs?|edges?|diagonals?|medians?|altitudes?|bisectors?|vectors?",
);
const BODY_NOUN_SOURCE = "blocks?|balls?|bod(?:y|ies)|particles?|cars?|trains?|boats?|charges?|masses|spheres?|plates?|wires?|beads?|discs?|rings?|lens(?:es)?|mirrors?|resistors?|capacitors?|cells?|batteries|battery|slits?|springs?|stones?|objects?|bulbs?|loops?|coils?|rods?";
const BODY_NOUNS = anyCase(BODY_NOUN_SOURCE);
const NAME = String.raw`(?:[A-Z](?:[₀-₉0-9]|')?|[a-z][₀-₉0-9])`;
const NAME_LIST = String.raw`((?:\s*(?:,|and|or)\s*${NAME}(?![A-Za-z]))*)`;
const NAME_RE = new RegExp(NAME, "g");
const SHAPE_NAME_RE = new RegExp(String.raw`(?:${SHAPE_NOUNS})\s+([A-Z]{2,6})\b`, "g");
const ANGLE_NAME_RE = /(?:∠|angle\s+)([A-Z]{3})\b/g;
const LINE_PAIR_RE = new RegExp(String.raw`(?:${LINE_NOUNS})\s+([A-Z]{2})\b((?:\s*(?:,|and|or)\s*[A-Z]{2}\b)*)`, "g");
const LINE_NAME_RE = new RegExp(String.raw`(?:${LINE_NOUNS})\s+(${NAME})(?![A-Za-z(])${NAME_LIST}`, "g");
const OBJECT_NAME_RE = new RegExp(String.raw`\b(?:${OBJECT_NOUNS})\s+(${NAME})(?![A-Za-z])${NAME_LIST}`, "g");
const BODY_NAME_RE = new RegExp(String.raw`\b(?:${BODY_NOUNS})\s+(${NAME})(?![A-Za-z])${NAME_LIST}`, "g");
const COORDINATE_NAME_RE = /(?<![A-Za-z])([A-Z])\s*\(\s*-?\d/g;
const PREPOSITION_NAME_RE = new RegExp(
  String.raw`\b(?:${anyCase("at|from|to|through|via|meets?|cuts?|and")})\b\s+([A-Z](?:[₀-₉0-9]|')?)(?=[\s,.;:)]|$)`,
  "g",
);

/** Point and object names the stem gives after generic nouns ("triangle ABC", "point P", "block A", "at D"). */
function namedObjects(question: string): string[] {
  const text = norm(question);
  const names: string[] = [];
  const add = (name: string) => {
    const normalized = subscriptsToDigits(name);
    if (!names.includes(normalized)) names.push(normalized);
  };
  for (const match of text.matchAll(SHAPE_NAME_RE)) [...match[1]!].forEach(add);
  for (const match of text.matchAll(ANGLE_NAME_RE)) [...match[1]!].forEach(add);
  for (const match of text.matchAll(LINE_PAIR_RE)) [...(match[1]! + match[2]!.replace(/[^A-Z]/g, ""))].forEach(add);
  for (const pattern of [LINE_NAME_RE, OBJECT_NAME_RE, BODY_NAME_RE]) {
    for (const match of text.matchAll(pattern)) {
      add(match[1]!);
      for (const extra of match[2]!.matchAll(NAME_RE)) add(extra[0]);
    }
  }
  for (const match of text.matchAll(COORDINATE_NAME_RE)) add(match[1]!);
  for (const match of text.matchAll(PREPOSITION_NAME_RE)) {
    // "A" is usually the article and "I" the pronoun.
    if (match[1] !== "A" && match[1] !== "I") add(match[1]!);
  }
  return names;
}

const COORDINATE_RE = /(?:(?<![A-Za-z])([A-Z])\s*)?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?\s*\)/g;

function coordinatePoints(question: string): Array<{ name: string | null; values: number[]; raw: string }> {
  return [...norm(question).matchAll(COORDINATE_RE)].map((match) => ({
    name: match[1] ?? null,
    values: [match[2], match[3], match[4]].filter((part): part is string => part !== undefined).map(Number),
    raw: match[0],
  }));
}

const DEGREE_RE = /(\d+(?:\.\d+)?)\s*(?:°|degrees?\b)/g;

interface ConstructionRule {
  /** Searched case-insensitively in the stem (and, for PLAN_TEXT_WORDS, in the plan's lawIds). */
  stem: RegExp;
  operators: ReadonlySet<string>;
  entityKinds: ReadonlySet<string>;
  /** Searched in every entity's id, role and label and every construction's id and outputs. */
  evidence: RegExp;
}

const CONSTRUCTIONS: Record<CompletenessConstructionWord, ConstructionRule> = {
  perpendicular: {
    stem: /\bperpendicular\b|\bfoot of\b/i,
    operators: new Set(["perpendicular_through", "project", "space_project", "normal_line", "right_angle_mark", "space_right_angle_mark"]),
    entityKinds: new Set(["right_angle_mark"]),
    evidence: /perp|foot|⊥|normal|altitude|right.?angle/i,
  },
  normal: {
    stem: /\bnormals?\b(?!\s+(?:reaction|force|contact|distribution|stress|adjustment|mode|component|forces))/i,
    operators: new Set(["normal_line", "normal_at", "perpendicular_through", "right_angle_mark"]),
    entityKinds: new Set(["right_angle_mark"]),
    evidence: /normal|perp/i,
  },
  tangent: {
    stem: /\btangents?\b(?! of)|\btangential(?:ly)?\b(?! (?:acceleration|velocity|component|speed))/i,
    operators: new Set(["tangent_line", "circle_tangent_at", "circle_tangency_points", "conic_tangent"]),
    entityKinds: new Set(),
    evidence: /tangent/i,
  },
  bisector: {
    stem: /\bbisect(?:or|ors|s|ing)?\b/i,
    operators: new Set(["angle_bisector", "midpoint"]),
    entityKinds: new Set(),
    evidence: /bisect/i,
  },
  radius: {
    stem: /\bradius\b|\bradii\b|\bdiameter\b/i,
    operators: new Set(["circle"]),
    entityKinds: new Set(),
    evidence: /radius|radii|diameter|\br\b/i,
  },
  focus: {
    stem: /\bfoc(?:us|i)\b/i,
    operators: new Set(["conic_anchor", "optical_focus", "gaussian_image", "principal_rays", "optical_train"]),
    entityKinds: new Set(),
    evidence: /focus|foci|focal|\bF\d?\b|\bf\b/,
  },
  directrix: {
    stem: /\bdirectri(?:x|ces)\b/i,
    operators: new Set(["conic_directrix"]),
    entityKinds: new Set(),
    evidence: /directrix/i,
  },
  intersection: {
    stem: /\bintersect(?:ion|ions|s|ing)?\b|\bwhere\b[^.]{0,60}\b(?:meet|cross|cut)s?\b|\bpoint of contact\b/i,
    operators: new Set(["intersection", "circle_intersections", "space_intersection", "surface_intersection", "circle_tangency_points", "space_closest_points"]),
    entityKinds: new Set(),
    evidence: /intersect|meet|cross|contact|common|solution/i,
  },
  midpoint: {
    stem: /\bmid-?points?\b/i,
    operators: new Set(["midpoint"]),
    entityKinds: new Set(),
    evidence: /mid/i,
  },
  centre: {
    stem: /\b(?:centroid|circumcent(?:re|er)|incent(?:re|er)|orthocent(?:re|er)|excent(?:re|er))\b/i,
    operators: new Set(["triangle_center", "circle_from_three_points"]),
    entityKinds: new Set(),
    evidence: /centroid|circum|incent|orthocent|cent(?:re|er)/i,
  },
  median_altitude: {
    stem: /\b(?:median|altitude)s?\b/i,
    operators: new Set(["midpoint", "perpendicular_through", "project"]),
    entityKinds: new Set(),
    evidence: /median|altitude/i,
  },
  asymptote: {
    stem: /\basymptot/i,
    operators: new Set(["conic_anchor"]),
    entityKinds: new Set(),
    evidence: /asymptot/i,
  },
  region: {
    stem: /\barea (?:of the region|enclosed|bounded|between|under)\b|\bshade|\bregion (?:enclosed|bounded|between|under)\b(?=[^.]*(?:curve|parabola|line|graph|circle|=))/i,
    operators: new Set(["function_region", "region", "polygon", "hatch"]),
    entityKinds: new Set(["polygon", "region"]),
    evidence: /region|area|shade/i,
  },
  strip: {
    stem: /\bstrip\b|\belementa?l?\b (?:ring|strip|shell|disc|slice|length|area)|\bslice\b/i,
    operators: new Set(["representative_slice"]),
    entityKinds: new Set(),
    evidence: /strip|slice|element/i,
  },
};

/** Constructions whose word may come from the plan's lawIds as well as the stem (measured on the dev half). */
const PLAN_TEXT_WORDS = new Set<CompletenessConstructionWord>(["normal", "bisector", "radius", "strip"]);

const VECTORS: Record<CompletenessVectorWord, { stem: RegExp; alias: RegExp }> = {
  weight: { stem: /\bweight\b|\bgravity\b|\bgravitational force\b/i, alias: /weight|mg|\bW\b|grav/i },
  tension: { stem: /\btension\b/i, alias: /tension|\bT\d?\b/ },
  friction: { stem: /\bfriction(?:al)?\b/i, alias: /friction|\bf_?[skr]?[₀-₉0-9]?(?![A-Za-z])|\bF_?f\b/i },
  normal_force: { stem: /\bnormal (?:reaction|force|contact)\b|\breaction force\b/i, alias: /normal|\bN\d?\b|\bR\b|reaction/ },
  force: {
    stem: /\bforces?\b|\bpush(?:es|ed)?\b|\bpull(?:s|ed)?\b|\bthrust\b|\bdrag\b|\bbuoyan/i,
    alias: /force|\bF|thrust|drag|buoy|push|pull|\bmg\b|\bT\b|\bN\b/i,
  },
  velocity: { stem: /\bvelocit(?:y|ies)\b/i, alias: /veloc|\bv|\bu\b|speed|heading/i },
  current: { stem: /\bcurrents?\b|\bcarr(?:y|ies|ying) a current\b/i, alias: /current|\bI\d?\b/ },
  field: { stem: /\b(?:electric|magnetic|gravitational) fields?\b|\bfield of\b|\buniform field\b/i, alias: /field|\bE\b|\bB\b|\bg\b/ },
  momentum: { stem: /\bmomentum\b/i, alias: /moment|\bp\d?\b/i },
};
/** Generic force and tension agreed with judges only 23% and 25% of the time. */
const DROPPED_VECTOR_WORDS = new Set<CompletenessVectorWord>(["force", "tension"]);
/** Current is a drawn vector only in a magnetic context; in a circuit it is a branch label. */
const MAGNETIC_CONTEXT = /magnetic|\bsolenoid|\btoroid|\bcoil\b|\bfield\b/i;
/** Velocity and acceleration units alone are too noisy to demand an arrow. */
const VECTOR_UNIT_WORDS: Partial<Record<UnitClass, CompletenessVectorWord>> = { force: "force", current: "current", field: "field" };
const VECTOR_ENTITY_KINDS = new Set(["vector", "arrow"]);
const VECTOR_OPERATORS = new Set([
  "vector", "space_vector", "vector_sum", "electric_field", "gravitational_force", "magnetic_force", "buoyancy",
  "vector_components", "transverse_field", "trajectory_state",
]);

const COUNT_WORDS: Record<string, number> = { two: 2, both: 2, three: 3, four: 4 };
const COUNT_RE = new RegExp(
  String.raw`\b(two|both|three|four)\s+(?:(?:identical|equal|parallel|similar|point|thin|long|small|large|plane|concave|convex|converging|diverging|charged|series|parallel|separate|different|positive|negative)\s+)?(?:${BODY_NOUN_SOURCE})`,
  "g",
);

const COORDINATE_COMPONENT_SYMBOL = /^(x|y|z)_?[A-Z₀-₉0-9]|^(Re|Im)\(|^[xyz][₀-₉0-9]$|^[A-Z][_]?[xyz]$/;
const ANGLE_SYMBOL = /^(θ|α|β|γ|φ|ψ|δ|∠)/;
const GREEK_ANGLE_RE = /(?<![A-Za-z\\])([θαβφ])(?![A-Za-z])/g;
const ANGLE_PHRASE_RE = /\bangles? (?:of (?:incidence|refraction|reflection|deviation|inclination|projection|elevation|depression|dip|contact|minimum deviation)|between\b)/i;
const RIGHT_ANGLE_RE = /\bperpendicular\b|\bright[- ]angled?\b|⊥|\bat right angles\b|\bnormal (?:to|at)\b/i;

/** The ProblemIR view the checklist reads: only its constraint kinds. */
export interface CompletenessProblemView {
  constraints?: ReadonlyArray<{ kind?: string }>;
}

type PlanQuantity = { id?: string; symbol?: string; value?: unknown; unit?: string; provenance?: string };

function asQuantities(value: unknown): PlanQuantity[] {
  return Array.isArray(value) ? value.filter((entry): entry is PlanQuantity => typeof entry === "object" && entry !== null) : [];
}

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/* ------------------------------------------------------------------------- */
/* Checklist                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Items a complete figure for this question shows. Structured plan data first
 * (givens, unknowns, lawIds; ProblemIR perpendicular constraints), narrow
 * generic stem patterns second. Givens not written in the stem, physical
 * constants and coordinate components are never demanded as value labels.
 */
export function buildCompletenessChecklist(
  plan: Pick<TurnPlanV3, "givens" | "unknowns" | "derived" | "lawIds"> | null | undefined,
  problemIR: CompletenessProblemView | null | undefined,
  question: string,
  options: CompletenessChecklistOptions = {},
): CompletenessChecklist {
  const stem = norm(question);
  const equations = stemEquations(stem);
  let stemWithoutEquations = stem;
  for (const equation of equations) stemWithoutEquations = stemWithoutEquations.split(equation).join(" ");
  const stemNumbers = numbers(stemWithoutEquations);
  const items: CompletenessItem[] = [];
  const seenValues: number[] = [];
  const givens = asQuantities(plan?.givens);
  const unknowns = asQuantities(plan?.unknowns);

  // 1. Givens: a value label, or an angle mark for an angle.
  for (const given of givens) {
    if ((given.provenance ?? "given") !== "given") continue;
    const value = given.value;
    if (!finiteNumber(value)) continue;
    const symbol = given.symbol || given.id || "";
    if (COORDINATE_COMPONENT_SYMBOL.test(symbol)) continue; // a coordinate component is a point item
    const valueClass = unitClass(given.unit);
    if (isConstant(symbol, value)) continue;
    // Not written in the stem outside its equations: not source grounded.
    if (!valueIn(value, stemNumbers, valueClass === "angle")) continue;
    const unit = given.unit ?? "";
    // The request says degrees and the matcher compares degrees (a radian label still matches), so a
    // radian given is converted first, as the asked-angle path does.
    const degrees = valueClass === "angle" ? angleInDegrees(value, unit) : null;
    const seenValue = degrees ?? value;
    if (seenValues.some((seen) => close(seenValue, seen))) continue;
    seenValues.push(seenValue);
    if (degrees !== null) {
      const shown = degrees === value ? value : Math.round(degrees * 10) / 10;
      items.push({
        kind: "angle", rule: "stated_angle", key: `${symbol}=${value}${unit}`, source: "plan_given", symbol,
        text: `mark the angle ${symbol} = ${formatNumber(shown)}° with an angle_mark and label it`,
        matcher: { type: "angle", value: degrees, counted: false },
      });
    } else {
      items.push({
        kind: "label", rule: "given_value", key: `${symbol}=${value}${unit}`, source: "plan_given", symbol,
        text: `label the given ${symbol} = ${formatNumber(value)} ${unit}`.trim(),
        matcher: { type: "value", value },
      });
    }
  }
  // 1b. Degree values the stem writes and the plan missed.
  for (const match of stemWithoutEquations.matchAll(DEGREE_RE)) {
    const value = Number(match[1]);
    if (seenValues.some((seen) => close(value, seen))) continue;
    seenValues.push(value);
    items.push({
      kind: "angle", rule: "stated_angle", key: `${value}deg`, source: "stem",
      text: `mark the ${formatNumber(value)}° angle with an angle_mark and label it`,
      matcher: { type: "angle", value, counted: true },
    });
  }
  // 1c. Asked angles: plan unknowns with an angle unit, or a Greek angle symbol when the stem says angle.
  const derived = new Map<string, PlanQuantity>();
  for (const quantity of asQuantities(plan?.derived)) {
    if (quantity.id !== undefined && finiteNumber(quantity.value)) derived.set(quantity.id, quantity);
  }
  for (const unknown of unknowns) {
    const symbol = unknown.symbol ?? "";
    const unknownClass = unitClass(unknown.unit);
    const isAngle = unknownClass === "angle" ||
      (ANGLE_SYMBOL.test(symbol) && /\bangles?\b/i.test(stem) && unknownClass === "none");
    if (!isAngle) continue;
    const solved = unknown.id !== undefined ? derived.get(unknown.id) : undefined;
    let value: number | null = solved && finiteNumber(solved.value) ? solved.value : null;
    if (value !== null && solved && !["angle", "none"].includes(unitClass(solved.unit))) value = null;
    if (value !== null) value = angleInDegrees(value, solved?.unit);
    items.push({
      kind: "angle", rule: "asked_angle", key: `unknown:${symbol}`, source: "plan_unknown", symbol,
      text: `mark the asked angle ${symbol} with an angle_mark` +
        (value !== null ? ` labelled ${formatNumber(Math.round(value * 10) / 10)}°` : ""),
      matcher: { type: "angle", value, counted: true },
    });
  }
  // 1d. Angles the stem names without a value: Greek angle letters, then "angle of incidence/between".
  const angleSymbols = new Set(items.filter((item) => item.matcher.type === "angle").map((item) => item.symbol));
  for (const match of stem.matchAll(GREEK_ANGLE_RE)) {
    const letter = match[1]!;
    if (angleSymbols.has(letter)) continue;
    if (items.some((item) => item.matcher.type === "angle" && (item.symbol ?? "").startsWith(letter))) continue;
    angleSymbols.add(letter);
    items.push({
      kind: "angle", rule: "stated_angle", key: `sym:${letter}`, source: "stem", symbol: letter,
      text: `mark the angle ${letter} with an angle_mark labelled ${letter}`,
      matcher: { type: "angle", value: null, counted: true },
    });
  }
  if (!items.some((item) => item.matcher.type === "angle")) {
    const phrase = stem.match(ANGLE_PHRASE_RE)?.[0]?.toLowerCase();
    if (phrase) {
      items.push({
        kind: "angle", rule: "stated_angle", key: `phrase:${phrase}`, source: "stem",
        text: `mark the ${phrase} with an angle_mark`,
        matcher: { type: "angle", value: null, counted: true },
      });
    }
  }
  // 1e. A right angle the stem states.
  if (RIGHT_ANGLE_RE.test(stem)) {
    items.push({
      kind: "angle", rule: "right_angle", key: "right-angle", source: "stem",
      text: "mark the right angle the stem states with a right_angle_mark",
      matcher: { type: "right_angle" },
    });
  }
  // 2. Coordinate points and named objects.
  const coordinates = coordinatePoints(stem);
  for (const point of coordinates) {
    items.push({
      kind: "label", rule: "coordinate", key: point.raw, source: "stem", ...(point.name ? { symbol: point.name } : {}),
      text: `label ${point.raw.trim()} at its point`,
      matcher: { type: "coordinate", values: point.values },
    });
  }
  const coordinateNames = new Set(coordinates.flatMap((point) => point.name ? [point.name] : []));
  for (const name of namedObjects(stem)) {
    if (coordinateNames.has(name)) continue;
    items.push({
      kind: "point", rule: "point_name", key: name, source: "stem", symbol: name,
      text: `label ${name} on its point or object`,
      matcher: { type: "name", name },
    });
  }
  // 3. Vectors: unit dimensions of plan quantities, then stem words.
  const vectorWords: CompletenessVectorWord[] = [];
  for (const quantity of [...givens, ...unknowns]) {
    const word = VECTOR_UNIT_WORDS[unitClass(quantity.unit)];
    if (!word || isConstant(quantity.symbol, finiteNumber(quantity.value) ? quantity.value : 0)) continue;
    if (word === "current" && !MAGNETIC_CONTEXT.test(stem)) continue;
    if (word === "field" && !/\bfield/i.test(stem)) continue;
    if (!vectorWords.includes(word)) vectorWords.push(word);
  }
  for (const [word, rule] of Object.entries(VECTORS) as Array<[CompletenessVectorWord, (typeof VECTORS)[CompletenessVectorWord]]>) {
    if (word === "current" && !MAGNETIC_CONTEXT.test(stem)) continue;
    if (rule.stem.test(stem) && !vectorWords.includes(word)) vectorWords.push(word);
  }
  for (const word of vectorWords) {
    if (DROPPED_VECTOR_WORDS.has(word)) continue;
    items.push({
      kind: "vector", rule: "vector", key: word, source: "stem",
      text: `draw the ${word.replace(/_/g, " ")} vector arrow`,
      matcher: { type: "vector", word },
    });
  }
  // 4. Constructions the stem names; normals, bisectors, radii and strips may come from the plan's laws.
  const lawText = `${stem} ${(plan?.lawIds ?? []).join(" ")}`;
  if ((problemIR?.constraints ?? []).some((constraint) => constraint.kind === "perpendicular") &&
    !items.some((item) => item.rule === "right_angle")) {
    items.push({
      kind: "angle", rule: "right_angle", key: "right-angle", source: "problem_ir",
      text: "mark the right angle the solution relies on with a right_angle_mark",
      matcher: { type: "right_angle" },
    });
  }
  for (const [word, rule] of Object.entries(CONSTRUCTIONS) as Array<[CompletenessConstructionWord, ConstructionRule]>) {
    const text = PLAN_TEXT_WORDS.has(word) ? lawText : stem;
    if (!rule.stem.test(text)) continue;
    items.push({
      kind: "construction", rule: "construction", key: word, source: rule.stem.test(stem) ? "stem" : "plan_law",
      text: `draw the ${word.replace(/_/g, " ")} the stem names`,
      matcher: { type: "construction", word },
    });
  }
  // 5. Every equation the stem names, drawn and labelled.
  for (const equation of equations) {
    items.push({
      kind: "equation", rule: "equation", key: equation, source: "stem",
      text: `draw and label ${equation}`,
      matcher: { type: "equation", equation },
    });
  }
  // 6. Counted objects (off unless asked for: not measured as precise).
  if (options.cases) {
    for (const match of stem.toLowerCase().matchAll(COUNT_RE)) {
      const count = COUNT_WORDS[match[1]!] ?? 2;
      const noun = match[0].split(/\s+/).at(-1)!.replace(/(es|s)$/, "");
      items.push({
        kind: "case", rule: "case", key: `${count}x${noun}`, source: "stem",
        text: `draw all ${count} ${noun}s the stem names`,
        matcher: { type: "count", noun, count },
      });
    }
  }
  return { question, items };
}

/* ------------------------------------------------------------------------- */
/* Scene check                                                               */
/* ------------------------------------------------------------------------- */

/** The parts of a scene document the check reads. */
export type CompletenessSceneDocument = Partial<Pick<SceneDocument, "entities" | "constructions" | "annotations" | "assertions" | "quantities">>;
/**
 * The parts of a compiled scene the check reads: its label and dimension text,
 * and the entity each label belongs to (a compiled RenderScene always has it).
 */
export type CompletenessCompiledScene = {
  primitives: ReadonlyArray<Pick<RenderScene["primitives"][number], "kind" | "text"> & { entityId?: string }>;
};
type SceneDocumentLike = CompletenessSceneDocument;
type CompiledSceneLike = CompletenessCompiledScene;

interface SceneView {
  texts: string[];
  numbers: number[];
  entityKinds: string[];
  operators: string[];
  /** [entity kind or "op:operator", its id/role/label or id/outputs words] */
  semantics: Array<[string, string]>;
  /** The numbers angle marks carry; the only place an angle value is matched. */
  angleNumbers: number[];
  annotationKinds: string[];
  labelNames: Set<string>;
}

const ANGLE_MARK_KINDS = new Set(["angle_mark", "right_angle_mark", "space_angle_mark"]);
const ANGLE_MARK_OPERATORS = new Set(["angle_mark", "right_angle_mark", "space_angle_mark", "space_right_angle_mark"]);
const RIGHT_ANGLE_KINDS = new Set(["right_angle_mark", "space_right_angle_mark"]);

const textOf = (value: unknown): string => value === null || value === undefined ? "" : String(value);

/** A degree sign, an angle unit or an angle symbol: the text states an angle. */
const ANGLE_TEXT_RE = /°|∠|\b(?:deg|degrees?|rad|radians?)\b|[θαβγφψ]/;
/** A number followed by a unit: "75 cm", "2.5 N", "60 deg", "75 Ω". */
const NUMBER_WITH_UNIT_RE = /(\d+(?:\.\d+)?)\s*([A-Za-zΩμ][A-Za-zΩμ/²³^0-9]*)/g;

/** The numbers a text can give as an angle: a number written with a length, mass or other physical unit never is. */
function angleTextNumbers(text: string): number[] {
  const withoutQuantities = norm(text).replace(NUMBER_WITH_UNIT_RE, (whole, _value: string, unit: string) => {
    let unitName = unitClass(unit);
    if (unitName === "other") unitName = unitClass(unit.replace(/\^?[23²³]$/, ""));
    // "other" is a word that is not a unit ("75 at Q"); only a physical unit removes the number.
    return unitName === "angle" || unitName === "other" ? whole : " ";
  });
  return numbers(withoutQuantities);
}

const identifierKey = (value: string): string => value.trim().toLowerCase().replace(/[₀-₉]/g, (digit) => SUBSCRIPT_DIGITS[digit] ?? digit);

/** The text the compiler prints for a quantity it finds by id or symbol (its label, else value and unit). */
function quantityText(designator: string, quantities: CompletenessSceneDocument["quantities"]): string | undefined {
  const key = identifierKey(designator);
  const quantity = (quantities ?? []).find((candidate) => identifierKey(textOf(candidate.id)) === key ||
    (typeof candidate.symbol === "string" && identifierKey(candidate.symbol) === key));
  if (!quantity) return undefined;
  if (typeof quantity.label === "string" && quantity.label.trim()) return quantity.label.trim();
  const value = quantity.value;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const unit = typeof quantity.unit === "string" && !/^(?:1|dimensionless)$/i.test(quantity.unit.trim()) ? ` ${quantity.unit.trim()}` : "";
  return `${value}${unit}`;
}

const ANGLE_PREDICATES = new Set(["angle_between", "angle_equals", "angle"]);
const LABEL_TARGET_KEYS = ["target", "at", "point"];

/**
 * The numbers angle marks carry. An angle value is matched only here, never on
 * a side length or a label elsewhere in the figure:
 * - the mark's own label;
 * - a label annotation aimed at the mark, or the quantity a text-less one binds
 *   (the compiler prints it on the mark), or a quantity named by the mark's id;
 * - a `label` operator whose target is the mark;
 * - an angle assertion on the mark (the compiler prints its value there);
 * - a compiled label the mark owns. A compiled label whose owner is unknown
 *   (text only, as in an offline replay) counts only when it states an angle.
 * A number written with a physical unit ("75 cm") is dropped from every one.
 */
function angleMarkNumbers(document: SceneDocumentLike, compiled?: CompiledSceneLike | null): number[] {
  const entities = document.entities ?? [];
  const constructions = document.constructions ?? [];
  const marks = new Set<string>();
  for (const entity of entities) if (ANGLE_MARK_KINDS.has(textOf(entity.kind))) marks.add(textOf(entity.id));
  for (const construction of constructions) {
    if (ANGLE_MARK_OPERATORS.has(textOf(construction.operator))) for (const output of construction.outputs ?? []) marks.add(textOf(output));
  }
  if (marks.size === 0) return [];
  const texts: string[] = [];
  const values: number[] = [];
  const spoken = new Set<string>();
  for (const entity of entities) {
    if (!marks.has(textOf(entity.id)) || !entity.label) continue;
    texts.push(textOf(entity.label));
    spoken.add(textOf(entity.id));
  }
  for (const annotation of document.annotations ?? []) {
    const targets = (annotation.targetIds ?? []).map(textOf).filter((id) => marks.has(id));
    if (annotation.kind === "narration" || targets.length === 0) continue;
    if (annotation.text) texts.push(textOf(annotation.text));
    else if (annotation.quantityId && targets.some((id) => !spoken.has(id))) {
      const text = quantityText(annotation.quantityId, document.quantities);
      if (text) texts.push(text);
    }
    if (annotation.text || annotation.quantityId) for (const id of targets) spoken.add(id);
  }
  for (const id of marks) {
    if (spoken.has(id)) continue;
    const text = quantityText(id, document.quantities);
    if (text) texts.push(text);
  }
  for (const construction of constructions) {
    const inputs = construction.inputs;
    if (construction.operator !== "label" || !inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    const target = LABEL_TARGET_KEYS.map((key) => inputs[key]).find((value) => value !== undefined);
    if (typeof target === "string" && marks.has(target) && inputs.text) texts.push(textOf(inputs.text));
  }
  for (const assertion of document.assertions ?? []) {
    const expected = assertion.expected as { value?: unknown } | null | undefined;
    if (!ANGLE_PREDICATES.has(assertion.predicate) || !(assertion.entities ?? []).some((id) => marks.has(textOf(id)))) continue;
    if (expected && typeof expected === "object" && finiteNumber(expected.value)) values.push(expected.value);
  }
  for (const primitive of compiled?.primitives ?? []) {
    if ((primitive.kind !== "label" && primitive.kind !== "dimension") || !primitive.text) continue;
    if (primitive.entityId !== undefined ? marks.has(primitive.entityId) : ANGLE_TEXT_RE.test(primitive.text)) texts.push(primitive.text);
  }
  return [...values, ...texts.flatMap(angleTextNumbers)];
}

function labelNames(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    const cleaned = subscriptsToDigits(norm(text)).replace(/_/g, "").trim();
    const leading = cleaned.match(/^([A-Za-z](?:\d|')?)(?![A-Za-z])/);
    if (leading) out.add(leading[1]!);
    if (cleaned.length <= 14) {
      for (const token of cleaned.matchAll(/(?<![A-Za-z])([A-Z](?:\d|')?)(?![A-Za-z])/g)) out.add(token[1]!);
    }
  }
  return out;
}

/**
 * Visible text: entity labels, non-narration annotations, label/dimension
 * operator text and compiled labels, trimmed, in document order. The
 * completeness round compares these before and after a reply, so a reply that
 * drops an old label is refused.
 */
export function sceneVisibleTexts(document: SceneDocumentLike, compiled?: CompiledSceneLike | null): string[] {
  const entities = document.entities ?? [];
  const constructions = document.constructions ?? [];
  const annotations = document.annotations ?? [];
  const texts: string[] = [];
  for (const entity of entities) if (entity.label) texts.push(textOf(entity.label));
  for (const annotation of annotations) {
    if (annotation.text && annotation.kind !== "narration") texts.push(textOf(annotation.text));
  }
  for (const construction of constructions) {
    const inputs = construction.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    if (construction.operator === "label" && inputs.text) texts.push(textOf(inputs.text));
    if (construction.operator === "dimension") {
      for (const key of ["label", "text"]) if (inputs[key]) texts.push(textOf(inputs[key]));
    }
  }
  for (const primitive of compiled?.primitives ?? []) {
    if (primitive.kind !== "label" && primitive.kind !== "dimension") continue;
    const text = primitive.text?.trim();
    if (text) texts.push(text);
  }
  return texts.map((text) => text.trim()).filter((text) => text.length > 0);
}

/** Every entity id the document declares. */
export function sceneEntityIds(document: SceneDocumentLike): string[] {
  return (document.entities ?? []).map((entity) => textOf(entity.id)).filter((id) => id.length > 0);
}

/** Visible text first, then what the check derives from the document. */
function sceneView(document: SceneDocumentLike, compiled?: CompiledSceneLike | null): SceneView {
  const entities = document.entities ?? [];
  const constructions = document.constructions ?? [];
  const annotations = document.annotations ?? [];
  const texts = sceneVisibleTexts(document, compiled);
  const semantics: Array<[string, string]> = [
    ...entities.map((entity): [string, string] =>
      [textOf(entity.kind), [entity.id, entity.role, entity.label].map(textOf).join(" ")]),
    ...constructions.map((construction): [string, string] =>
      [`op:${textOf(construction.operator)}`, `${textOf(construction.id)} ${(construction.outputs ?? []).map(textOf).join(" ")}`]),
  ];
  return {
    texts,
    numbers: texts.flatMap(numbers),
    entityKinds: entities.map((entity) => textOf(entity.kind)),
    operators: constructions.map((construction) => textOf(construction.operator)),
    semantics,
    angleNumbers: angleMarkNumbers(document, compiled),
    annotationKinds: annotations.map((annotation) => textOf(annotation.kind)),
    labelNames: labelNames(texts),
  };
}

function satisfied(item: CompletenessItem, view: SceneView, countedAngleItems: number): boolean {
  const { matcher } = item;
  switch (matcher.type) {
    case "value":
      return valueIn(matcher.value, view.numbers);
    case "angle": {
      let marks = view.entityKinds.filter((kind) => ANGLE_MARK_KINDS.has(kind)).length;
      if (marks === 0) marks = view.operators.filter((operator) => ANGLE_MARK_OPERATORS.has(operator)).length;
      if (marks === 0) return false;
      if (matcher.counted && marks < countedAngleItems) return false;
      if (matcher.value === null) return true;
      // Only on an angle mark: a side labelled "75 cm" or a bare 75 elsewhere is not the 75° angle.
      return valueIn(matcher.value, view.angleNumbers, true);
    }
    case "right_angle":
      return view.entityKinds.some((kind) => RIGHT_ANGLE_KINDS.has(kind)) ||
        view.operators.some((operator) => RIGHT_ANGLE_KINDS.has(operator));
    case "coordinate":
      return view.texts.some((text) => {
        const found = numbers(text);
        return found.length >= matcher.values.length &&
          matcher.values.every((value) => found.some((candidate) => close(value, candidate)));
      });
    case "name":
      return view.labelNames.has(matcher.name);
    case "vector": {
      // Aliases for tension, normal force, current and field are case sensitive (T, N, I, E, B).
      const pattern = VECTORS[matcher.word].alias;
      const drawn = view.semantics.some(([kind, words]) =>
        (VECTOR_ENTITY_KINDS.has(kind) || VECTOR_OPERATORS.has(kind.replace(/^op:/, ""))) && pattern.test(words));
      if (drawn) return true;
      return matcher.word === "current" && view.annotationKinds.some((kind) => kind === "sense" || kind === "loop");
    }
    case "construction": {
      const rule = CONSTRUCTIONS[matcher.word];
      if (view.operators.some((operator) => rule.operators.has(operator))) return true;
      if (view.entityKinds.some((kind) => rule.entityKinds.has(kind))) return true;
      return view.semantics.some(([, words]) => rule.evidence.test(words));
    }
    case "equation": {
      const target = equationKey(matcher.equation);
      const targetNumbers = numbers(matcher.equation);
      const rightSide = target.includes("=") ? target.slice(target.indexOf("=") + 1) : "";
      return view.texts.some((text) => {
        const shown = equationKey(text);
        if (shown.includes(target) || (shown.length >= 3 && shown.includes("=") && target.includes(shown))) return true;
        if (rightSide.length >= 2 && /[a-z]/.test(rightSide) && shown.includes(rightSide)) return true;
        if (!/[=<>≤≥]/.test(shown) || targetNumbers.length === 0) return false;
        const shownNumbers = numbers(text);
        return targetNumbers.every((value) => shownNumbers.some((candidate) => close(value, candidate)));
      });
    }
    case "count": {
      const noun = new RegExp(matcher.noun.slice(0, 5).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      return view.semantics.filter(([kind, words]) => !kind.startsWith("op:") && noun.test(words)).length >= matcher.count;
    }
  }
}

/**
 * Missing checklist items for one scene, in priority order. `compiled` adds the
 * compiled label text, so a label the planner wrote but layout dropped still
 * counts as present (a layout problem, not a completeness one).
 */
export function checkSceneCompleteness(
  checklist: CompletenessChecklist | readonly CompletenessItem[],
  sceneDocument: SceneDocumentLike,
  compiled?: CompiledSceneLike | null,
): SceneCompletenessResult {
  const items = "items" in checklist ? checklist.items : checklist;
  const view = sceneView(sceneDocument, compiled);
  // Prototype parity: every angle item (given, stated or asked) needs its own mark.
  const countedAngleItems = items.filter((item) => item.rule === "stated_angle" || item.rule === "asked_angle").length;
  const missing = items
    .filter((item) => !satisfied(item, view, countedAngleItems))
    .map((item, index) => ({ item, index }))
    .sort((first, second) => RULE_PRIORITY[first.item.rule] - RULE_PRIORITY[second.item.rule] || first.index - second.index)
    .map(({ item }) => item);
  return { checked: items.length, missing, request: missing.slice(0, COMPLETENESS_REQUEST_CAP) };
}
