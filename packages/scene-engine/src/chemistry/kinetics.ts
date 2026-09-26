/**
 * Chemical kinetics figures (JEE Main): the first order decay of [A]/[A]_0
 * against time with the half life and any asked instant proved on the curve,
 * the straight line plots that identify an order (ln[A] vs t, log([A]_0/[A])
 * vs t, [A] vs t, 1/[A] vs t), the Arrhenius line ln k vs 1/T with two
 * measured points, and the concentration against time plot of a reaction
 * that attains equilibrium.
 *
 * Every number on a figure comes from the stem or the plan. The pure solvers
 * (`kineticsFromStem`, `solveKinetics`, and the small formula helpers) are
 * exported so other lanes can reuse the same arithmetic.
 *
 * Display convention: every graph is `scene.axes` plus `scene.curve` in
 * display units (x span about 10, y span about 6) so the plot fills the
 * board; the true values live in the labels, the caption, and
 * `scene.quantity`. Axis labels are pinned texts at the axis ends.
 */
import type { SceneDocument } from "../types";
import { fmt } from "../archetypes/document";
import { ChemScene, chemStem, planQuantity, type ChemPlanQuantity } from "./sceneKit";

export const KINETICS_FAMILY = "chem_kinetics" as const;

/** Gas constant in J per mol per K, the value JEE stems quote. */
const GAS_CONSTANT = 8.314;

export type ReactionOrder = 0 | 1 | 2;

export type KineticsPlot = "concentration" | "linear" | "arrhenius" | "equilibrium";

/**
 * Which straight line plot the stem asks for. `compare_orders` is the three
 * panel figure (zero, first, second), `compare_first` shows the candidate
 * plots for one named order so the student sees which one is straight.
 */
export type LinearPlotKind = "A_t" | "lnA_t" | "logA0A_t" | "invA_t" | "compare_orders" | "compare_first";

export interface ArrheniusSpec {
  /** Kelvin. */
  T1: number | null;
  T2: number | null;
  /** Rate constants in the stem's own unit, when quoted. */
  k1: number | null;
  k2: number | null;
  /** k2 / k1 when the stem gives it in words ("doubles", "4 times"). */
  ratio: number | null;
  /** J per mol. */
  Ea: number | null;
  /** Pre exponential factor, when quoted. */
  A: number | null;
  /** From a stated "ln k = a - b/T" (b in K) or "log k = a - b/T". */
  statedSlope: { natural: boolean; b: number } | null;
}

export interface KineticsSpec {
  order: ReactionOrder | null;
  /** Orders the stem names, in reading order (a comparison stem names several). */
  ordersNamed: ReactionOrder[];
  /** Rate constant in 1 / timeUnit (first order) or in the stem's unit otherwise. */
  k: number | null;
  kUnit: string | null;
  tHalf: number | null;
  /** The unit every time value below is expressed in. */
  timeUnit: string;
  /** Initial concentration and its unit when quoted. */
  a0: number | null;
  concUnit: string | null;
  /** "50 % of A is decomposed in 120 min". */
  completion: { fraction: number; time: number } | null;
  /** Percent completion asked for, as fractions of the reaction complete. */
  fractionsAsked: number[];
  /** Fractions remaining asked for in that form ("to one eighth of its initial concentration"). */
  remainingAsked: number[];
  /** Instants asked for ("after 60 min"), in timeUnit. */
  timesAsked: number[];
  /** Concentrations asked for ("from 0.50 to 0.25 mol/L"). */
  concentrationsAsked: number[];
  arrhenius: ArrheniusSpec | null;
  plot: KineticsPlot | null;
  linear: LinearPlotKind | null;
  /** Equilibrium constant when the stem quotes one for A <=> B. */
  equilibriumK: number | null;
}

export interface KineticsSolution {
  order: ReactionOrder | null;
  k: number | null;
  tHalf: number | null;
  timeUnit: string;
  /** Time to reach each asked completion fraction. */
  timesForFractions: Array<{ fraction: number; time: number }>;
  /** Time for [A]/[A]_0 to fall to each asked remaining fraction. */
  timesForRemaining: Array<{ remaining: number; time: number }>;
  /** [A]/[A]_0 remaining at each asked instant. */
  remainingAtTimes: Array<{ time: number; remaining: number }>;
  /** Times at which [A] reaches each asked concentration. */
  timesForConcentrations: Array<{ concentration: number; time: number }>;
  /** J per mol. */
  Ea: number | null;
  /** k2 / k1 across the two temperatures. */
  ratio: number | null;
  /** The second temperature when the stem gives k1, k2 and Ea instead. */
  T2: number | null;
  A: number | null;
}

/* ------------------------------------------------------------------------- */
/* Pure formulas                                                              */

function rateConstantFromHalfLife(order: ReactionOrder, tHalf: number, a0?: number | null): number | null {
  if (!(tHalf > 0)) return null;
  if (order === 1) return Math.LN2 / tHalf;
  if (order === 0) return a0 && a0 > 0 ? a0 / (2 * tHalf) : null;
  return a0 && a0 > 0 ? 1 / (tHalf * a0) : null;
}

function halfLifeFromRateConstant(order: ReactionOrder, k: number, a0?: number | null): number | null {
  if (!(k > 0)) return null;
  if (order === 1) return Math.LN2 / k;
  if (order === 0) return a0 && a0 > 0 ? a0 / (2 * k) : null;
  return a0 && a0 > 0 ? 1 / (k * a0) : null;
}

/** Time for the reaction to be `fraction` complete (0.9 for 90 %). */
function timeForCompletion(order: ReactionOrder, k: number, fraction: number, a0?: number | null): number | null {
  if (!(k > 0) || !(fraction > 0) || !(fraction < 1)) return null;
  if (order === 1) return Math.log(1 / (1 - fraction)) / k;
  if (order === 0) return a0 && a0 > 0 ? (fraction * a0) / k : null;
  return a0 && a0 > 0 ? (1 / (1 - fraction) - 1) / (k * a0) : null;
}

/** [A]/[A]_0 remaining after time t. */
function fractionRemaining(order: ReactionOrder, k: number, t: number, a0?: number | null): number | null {
  if (!(k > 0) || !(t >= 0)) return null;
  if (order === 1) return Math.exp(-k * t);
  if (order === 0) return a0 && a0 > 0 ? Math.max(0, 1 - (k * t) / a0) : null;
  return a0 && a0 > 0 ? 1 / (1 + k * a0 * t) : null;
}

/** Ea in J per mol from the ratio k2/k1 between T1 and T2 (K). */
function activationEnergyFromRatio(ratio: number, T1: number, T2: number): number | null {
  if (!(ratio > 0) || !(T1 > 0) || !(T2 > 0) || T1 === T2) return null;
  return (GAS_CONSTANT * Math.log(ratio)) / (1 / T1 - 1 / T2);
}

/** k2 / k1 from Ea (J per mol) between T1 and T2 (K). */
function rateConstantRatio(Ea: number, T1: number, T2: number): number | null {
  if (!(T1 > 0) || !(T2 > 0)) return null;
  return Math.exp((Ea / GAS_CONSTANT) * (1 / T1 - 1 / T2));
}

/** The temperature (K) at which k reaches k2 given k1 at T1 and Ea (J per mol). */
function temperatureForRateConstant(k1: number, T1: number, k2: number, Ea: number): number | null {
  if (!(k1 > 0) || !(k2 > 0) || !(T1 > 0) || !(Ea > 0)) return null;
  const inverse = 1 / T1 - (GAS_CONSTANT / Ea) * Math.log(k2 / k1);
  return inverse > 0 ? 1 / inverse : null;
}

export function solveKinetics(spec: KineticsSpec): KineticsSolution {
  const order = spec.order;
  let k = spec.k;
  let tHalf = spec.tHalf;
  if (order !== null) {
    if (k === null && spec.completion && order === 1) {
      k = Math.log(1 / (1 - spec.completion.fraction)) / spec.completion.time;
    }
    if (k === null && tHalf !== null) k = rateConstantFromHalfLife(order, tHalf, spec.a0);
    if (tHalf === null && k !== null) tHalf = halfLifeFromRateConstant(order, k, spec.a0);
  }
  const timesForFractions = order !== null && k !== null
    ? spec.fractionsAsked
      .map((fraction) => ({ fraction, time: timeForCompletion(order, k!, fraction, spec.a0) }))
      .filter((entry): entry is { fraction: number; time: number } => entry.time !== null)
    : [];
  const timesForRemaining = order !== null && k !== null
    ? spec.remainingAsked
      .map((remaining) => ({ remaining, time: timeForCompletion(order, k!, 1 - remaining, spec.a0) }))
      .filter((entry): entry is { remaining: number; time: number } => entry.time !== null)
    : [];
  const remainingAtTimes = order !== null && k !== null
    ? spec.timesAsked
      .map((time) => ({ time, remaining: fractionRemaining(order, k!, time, spec.a0) }))
      .filter((entry): entry is { time: number; remaining: number } => entry.remaining !== null)
    : [];
  const timesForConcentrations = order !== null && k !== null && spec.a0
    ? spec.concentrationsAsked
      .filter((c) => c > 0 && c < spec.a0!)
      .map((concentration) => ({ concentration, time: timeForCompletion(order, k!, 1 - concentration / spec.a0!, spec.a0) }))
      .filter((entry): entry is { concentration: number; time: number } => entry.time !== null)
    : [];

  let Ea: number | null = null;
  let ratio: number | null = null;
  let T2: number | null = null;
  let A: number | null = null;
  const arr = spec.arrhenius;
  if (arr) {
    Ea = arr.Ea;
    A = arr.A;
    ratio = arr.ratio ?? (arr.k1 !== null && arr.k2 !== null ? arr.k2 / arr.k1 : null);
    if (arr.statedSlope) Ea = arr.statedSlope.natural ? arr.statedSlope.b * GAS_CONSTANT : arr.statedSlope.b * GAS_CONSTANT * Math.LN10;
    if (Ea === null && ratio !== null && arr.T1 !== null && arr.T2 !== null) Ea = activationEnergyFromRatio(ratio, arr.T1, arr.T2);
    if (ratio === null && Ea !== null && arr.T1 !== null && arr.T2 !== null) ratio = rateConstantRatio(Ea, arr.T1, arr.T2);
    T2 = arr.T2;
    if (T2 === null && Ea !== null && arr.k1 !== null && arr.k2 !== null && arr.T1 !== null) {
      T2 = temperatureForRateConstant(arr.k1, arr.T1, arr.k2, Ea);
    }
  }
  return { order, k, tHalf, timeUnit: spec.timeUnit, timesForFractions, timesForRemaining, remainingAtTimes, timesForConcentrations, Ea, ratio, T2, A };
}

/* ------------------------------------------------------------------------- */
/* Stem reading                                                               */

const NUMBER = String.raw`(\d+(?:\.\d+)?)(?:\s*(?:[x×*]\s*10\s*\^?\s*\(?\s*(-?\d+)\s*\)?|e(-?\d+)))?`;

function numberFrom(match: RegExpExecArray, offset: number): number {
  const mantissa = Number(match[offset]);
  const exponent = match[offset + 1] !== undefined ? Number(match[offset + 1]) : match[offset + 2] !== undefined ? Number(match[offset + 2]) : 0;
  return mantissa * Math.pow(10, exponent);
}

/**
 * OCR turns "2 x 10^-6" into "2x10~°" and "5.5 x 10^-14" into "5.5 x 107!4".
 * A number whose power of ten did not parse cleanly, or whose exponent runs
 * into stray glyphs, is unreadable: better no figure than a wrong half life.
 */
function damagedNumber(stem: string, match: RegExpExecArray, offset: number): boolean {
  const mantissa = match[offset];
  if (mantissa === undefined) return true;
  const within = match[0].indexOf(mantissa);
  if (within < 0) return true;
  const start = match.index + within + mantissa.length;
  const tail = stem.slice(start, start + 24);
  const exponentParsed = match[offset + 1] !== undefined || match[offset + 2] !== undefined;
  if (!exponentParsed) {
    if (/^\s*[x×*]\s*10/.test(tail)) return true;
    if (/^\s+10\s*[°~!^"]/.test(tail)) return true;
    return false;
  }
  const exponentText = match[offset + 1] ?? match[offset + 2] ?? "";
  const exponentAt = tail.indexOf(exponentText);
  if (exponentAt < 0) return false;
  const after = tail.slice(exponentAt + exponentText.length, exponentAt + exponentText.length + 2);
  return /^[!~°"\d]/.test(after);
}

/** The stem before its answer options; numbers inside options are not givens. */
function questionBody(stem: string): string {
  const cut = /\boptions?\s*:|\b\d{8,}\b|\(a\)\s+[^()]{3,}\(b\)/.exec(stem);
  return cut ? stem.slice(0, cut.index) : stem;
}

const TIME_UNIT = String.raw`(min(?:ute)?s?|sec(?:ond)?s?|s|h(?:ou)?rs?|days?|y(?:ea)?rs?)`;

const SECONDS: Record<string, number> = { s: 1, min: 60, h: 3600, days: 86400, yr: 3.156e7 };

function canonicalTimeUnit(raw: string | undefined): string | null {
  if (!raw) return null;
  const unit = raw.toLowerCase();
  if (/^min/.test(unit)) return "min";
  if (/^(?:s|sec)/.test(unit)) return "s";
  if (/^h/.test(unit)) return "h";
  if (/^d/.test(unit)) return "days";
  if (/^y/.test(unit)) return "yr";
  return null;
}

function convertTime(value: number, from: string, to: string): number {
  return (value * (SECONDS[from] ?? 1)) / (SECONDS[to] ?? 1);
}

interface Reading { value: number; unit: string | null; index: number }

/** The first number (with an optional time unit) after `phrase`. */
function readAfter(stem: string, phrase: RegExp, strict = false): Reading | null {
  const pattern = new RegExp(`${phrase.source}\\s*(=|is|was|of|:|are|be|equal to|equals)?\\s*(?:about|nearly|approximately)?\\s*${NUMBER}\\s*${TIME_UNIT}?\\b`, "i");
  const match = pattern.exec(stem);
  if (!match) return null;
  const unit = canonicalTimeUnit(match[5]);
  // "half life of reaction 1" must not read 1 as the half life.
  if (strict && !unit && !match[1]) return null;
  if (damagedNumber(stem, match, 2)) return null;
  return { value: numberFrom(match, 2), unit, index: match.index };
}

const RATE_UNIT = /(s|sec|min|h|hr|hour|day|year)s?\s*(?:\^\s*\(?\s*-\s*1\s*\)?|-1\b|~!|⁻¹|\^-¹)/i;

function readOrders(stem: string): ReactionOrder[] {
  const found: Array<{ order: ReactionOrder; index: number }> = [];
  const patterns: Array<[RegExp, ReactionOrder]> = [
    [/\b(?:zero|zeroth|0th)[ -]?order\b/g, 0],
    [/\b(?:pseudo[ -]?)?(?:first|1st)[ -]?order\b/g, 1],
    [/\b(?:second|2nd)[ -]?order\b/g, 2],
  ];
  for (const [pattern, order] of patterns) {
    for (const match of stem.matchAll(pattern)) found.push({ order, index: match.index ?? 0 });
  }
  // "zero, first and second order" names every order in the run.
  const run = /\b((?:zero|zeroth|first|second)(?:\s*(?:,|and|or|\/)\s*(?:zero|zeroth|first|second))+)[ -]?orders?\b/.exec(stem);
  if (run) {
    const names: Record<string, ReactionOrder> = { zero: 0, zeroth: 0, first: 1, second: 2 };
    for (const word of run[1]!.split(/[^a-z]+/)) {
      if (word in names) found.push({ order: names[word]!, index: run.index });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const orders: ReactionOrder[] = [];
  for (const entry of found) if (!orders.includes(entry.order)) orders.push(entry.order);
  // "rate = k[A]" with a single concentration and no exponent is first order.
  if (orders.length === 0 && /\b(?:rate|r)\s*=\s*k\s*\[[a-z0-9]+\]\s*(?![[^0-9])/.test(stem)) orders.push(1);
  return orders;
}

function readHalfLife(stem: string): Reading | null {
  return readAfter(stem, /(?:half[ -]?life(?:\s*period)?|t\s*1\s*\/\s*2|t½|t_?\(?1\/2\)?|t_half)\b(?:\s*\([^)]{0,12}\))?(?:\s*(?:of|for)\s+(?:the |a |an |this )?(?:[a-z0-9_[\]()+<=>-]+\s+){0,8}?)?/, true);
}

function readRateConstant(stem: string): { value: number; unit: string | null } | null {
  const pattern = new RegExp(String.raw`(?:rate constant|\bk\b)(?:\s*,?\s*\(?k\)?)?\s*(?:for|of)?\s*(?:the |this |a )?(?:reaction|it)?\s*(?:=|is|:|equals|equal to)\s*${NUMBER}`, "i");
  const match = pattern.exec(stem);
  if (!match) return null;
  if (damagedNumber(stem, match, 1)) return null;
  const value = numberFrom(match, 1);
  const tail = stem.slice(match.index + match[0].length, match.index + match[0].length + 24);
  const unit = RATE_UNIT.exec(tail);
  let timeUnit: string | null = null;
  if (unit) timeUnit = canonicalTimeUnit(unit[1]);
  else {
    const per = /(?:per|\/)\s*(second|minute|hour|s|min|h)\b/i.exec(tail);
    if (per) timeUnit = canonicalTimeUnit(per[1]);
  }
  // A second order constant carries a concentration unit too; keep the time part.
  return { value, unit: timeUnit };
}

function readInitialConcentration(stem: string): { value: number; unit: string | null } | null {
  const pattern = new RegExp(String.raw`(?:initial concentration(?:\s+of\s+(?:the\s+)?[a-z\[\]0-9_]+)?|\[a\]\s*_?\s*0|\[a\]_0|\ba_?0\b|starting concentration)\s*(?:of\s+[a-z\[\]0-9]+\s*)?(?:is|=|:|was|of|being)?\s*${NUMBER}\s*(mol\s*(?:l\^?\(?-1\)?|\/\s*l|dm\^?\(?-3\)?|per litre|l-1|l~!)?|m\b)`, "i");
  const match = pattern.exec(stem);
  if (!match || damagedNumber(stem, match, 1)) return null;
  return { value: numberFrom(match, 1), unit: "M" };
}

/** "50 % of A is decomposed in 120 min" and its relatives. */
function readCompletionGiven(stem: string): { fraction: number; time: number; unit: string | null; span: [number, number] } | null {
  const unitTail = String.raw`\s*${NUMBER}\s*${TIME_UNIT}\b`;
  const patterns = [
    new RegExp(String.raw`(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?[a-z\[\]0-9_]+\s+)?(?:is|was|gets|has been|had been|are|were)?\s*(?:decomposed|completed?|consumed|converted|reacted|complete|over|finished|dissociated|used up)\s*(?:in|after|within|takes)${unitTail}`, "i"),
    new RegExp(String.raw`(?:time|t)\s*(?:required|taken|needed)?\s*(?:for|to)\s*(?:reach\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:completion|complete|decomposition|conversion|reaction|of the reaction|to complete)?\s*(?:of\s+[a-z\[\]0-9_ ]{1,20}?)?\s*(?:is|was|=|:)${unitTail}`, "i"),
    new RegExp(String.raw`(?:takes|took|requires|required)${unitTail}\s*(?:for|to)\s*(?:reach|complete|attain|be)?\s*(\d+(?:\.\d+)?)\s*%`, "i"),
    new RegExp(String.raw`(?:in|after|within)${unitTail}\s*,?\s*(?:the\s+)?(?:reaction\s+)?(?:is|was|becomes|gets)?\s*(\d+(?:\.\d+)?)\s*%\s*(?:complete|completed|over|decomposed|consumed)`, "i"),
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.exec(stem);
    if (!match) continue;
    const percentFirst = index === 0 || index === 1;
    const percent = Number(percentFirst ? match[1] : match[5]);
    const time = percentFirst ? numberFrom(match, 2) : numberFrom(match, 1);
    const unit = canonicalTimeUnit(percentFirst ? match[5] : match[4]);
    if (!(percent > 0 && percent < 100) || !(time > 0)) continue;
    return { fraction: percent / 100, time, unit, span: [match.index, match.index + match[0].length] };
  }
  return null;
}

const WORD_FRACTIONS: Array<[RegExp, number]> = [
  [/\bone[ -]?fourth\b|\b1\s*\/\s*4\b|\bquarter\b/g, 1 / 4],
  [/\bone[ -]?eighth\b|\b1\s*\/\s*8\b/g, 1 / 8],
  [/\bone[ -]?tenth\b|\b1\s*\/\s*10\b/g, 1 / 10],
  [/\bone[ -]?third\b|\b1\s*\/\s*3\b/g, 1 / 3],
  [/\bone[ -]?sixteenth\b|\b1\s*\/\s*16\b/g, 1 / 16],
  [/\bthree[ -]?fourths?\b|\b3\s*\/\s*4\b/g, 3 / 4],
  [/\btwo[ -]?thirds?\b|\b2\s*\/\s*3\b/g, 2 / 3],
];

/** Completions asked for (as fractions complete) and remaining fractions asked for, excluding the given completion. */
function readFractionsAsked(stem: string, givenSpan: [number, number] | null): { completion: number[]; remaining: number[] } {
  const completion: number[] = [];
  const remaining: number[] = [];
  const push = (list: number[], fraction: number) => {
    if (fraction > 0 && fraction < 1 && Math.abs(fraction - 0.5) > 1e-9 && !list.some((f) => Math.abs(f - fraction) < 1e-9)) list.push(fraction);
  };
  for (const match of stem.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const index = match.index ?? 0;
    if (givenSpan && index >= givenSpan[0] && index < givenSpan[1]) continue;
    const before = stem.slice(Math.max(0, index - 70), index);
    const after = stem.slice(index, index + 70);
    const percent = Number(match[1]);
    if (!(percent > 0 && percent < 100)) continue;
    // A rise in temperature or a yield is not a completion.
    if (/\b(?:temperature|yield|error|efficiency|purity|dissociat)\w*\s*$/.test(before) || /^\d+(?:\.\d+)?\s*%\s*(?:rise|increase|error)/.test(after)) continue;
    const asksRemaining = /\b(?:remain|left|unreacted|falls? to|reduced? to|decreases? to|drops? to|decays? to|reach)/.test(before + after.slice(0, 40)) && !/\b(?:decompos|complet|consum|convert|react)/.test(after.slice(0, 30));
    const asksCompletion = /\b(?:completion|complete|completed|decompos|consum|convert|react|disappear|over|conversion|dissociat|time)/.test(before + after);
    if (!asksRemaining && !asksCompletion) continue;
    if (asksRemaining) push(remaining, percent / 100);
    else push(completion, percent / 100);
  }
  for (const [pattern, fraction] of WORD_FRACTIONS) {
    for (const match of stem.matchAll(pattern)) {
      const index = match.index ?? 0;
      const before = stem.slice(Math.max(0, index - 70), index);
      const after = stem.slice(index, index + 60);
      const asksRemaining = /\b(?:to|reduce|fall|decrease|remain|left|becomes?)\b[^.]{0,30}$/.test(before) || /^[^.]{0,20}(?:of (?:its|the) (?:initial|original)|remain|left)/.test(after.slice(match[0].length));
      const asksCompletion = /\b(?:completion|complete|completed|decompos|consum|convert|react)/.test(after) || /\b(?:for|of)\s*$/.test(before);
      if (asksRemaining) push(remaining, fraction);
      else if (asksCompletion) push(completion, fraction);
    }
  }
  return { completion, remaining };
}

/** Instants asked for ("after 60 min", "at t = 40 s"), in their own units. */
function readTimesAsked(stem: string, givenSpan: [number, number] | null): Array<{ value: number; unit: string }> {
  const out: Array<{ value: number; unit: string }> = [];
  const pattern = new RegExp(String.raw`(?:after|at\s*t\s*=|at the end of|in the next|elapsed)\s*${NUMBER}\s*${TIME_UNIT}\b`, "gi");
  for (const match of stem.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (givenSpan && index >= givenSpan[0] && index < givenSpan[1]) continue;
    const unit = canonicalTimeUnit(match[4]);
    if (!unit) continue;
    const value = numberFrom(match as RegExpExecArray, 1);
    if (value > 0 && !out.some((entry) => entry.value === value && entry.unit === unit)) out.push({ value, unit });
  }
  return out;
}

function readConcentrationsAsked(stem: string): number[] {
  const match = new RegExp(String.raw`from\s*${NUMBER}\s*(?:mol[^ ]*\s*)?to\s*${NUMBER}\s*(?:mol|m\b)`, "i").exec(stem);
  if (!match) return [];
  return [numberFrom(match, 1), numberFrom(match, 4)];
}

function readTemperatures(stem: string): number[] {
  const temps: Array<{ value: number; index: number }> = [];
  for (const match of stem.matchAll(/(?:^|[^^\d.])(\d+(?:\.\d+)?)\s*k\b(?!\s*(?:=|\/|\[))/g)) {
    const value = Number(match[1]);
    if (value >= 100 && value <= 2000) temps.push({ value, index: match.index ?? 0 });
  }
  for (const match of stem.matchAll(/(\d+(?:\.\d+)?)\s*(?:°\s*c|deg(?:rees?)?\s*(?:c|celsius)|celsius)\b/g)) {
    temps.push({ value: Number(match[1]) + 273, index: match.index ?? 0 });
  }
  temps.sort((a, b) => a.index - b.index);
  return temps.map((entry) => entry.value);
}

function readArrhenius(stem: string, quantities: readonly ChemPlanQuantity[]): ArrheniusSpec | null {
  const mentions = /\b(?:arrhenius|activation energy|e_?a\b|frequency factor|pre[ -]?exponential|ln\s*k|log\s*k|rate constant)/.test(stem)
    && /\b(?:temperature|arrhenius|activation energy|ln\s*k|log\s*k|\d\s*k\b|°\s*c)/.test(stem);
  if (!mentions) return null;
  let Ea: number | null = planQuantity(quantities, ["Ea", "E_a", "activation_energy", "activationEnergy"]);
  const eaRead = new RegExp(String.raw`(?:activation energy|\be_?a\b)(?:\s*(?:of|for)\s+(?:the |a |this )?(?:[a-z]+\s+){0,4}?)?(?:\(?e_?a\)?)?\s*(?:is|=|:|was|of|equal to|found to be)?\s*(?:about|nearly)?\s*${NUMBER}\s*(k?j|k?cal)\b`, "i").exec(stem);
  if (Ea === null && eaRead && !damagedNumber(stem, eaRead, 1)) {
    const value = numberFrom(eaRead, 1);
    const unit = eaRead[4]!.toLowerCase();
    Ea = unit === "kj" ? value * 1000 : unit === "kcal" ? value * 4184 : unit === "cal" ? value * 4.184 : value;
  }
  let A: number | null = planQuantity(quantities, ["A", "frequency_factor", "pre_exponential"]);
  const aRead = new RegExp(String.raw`(?:frequency factor|pre[ -]?exponential factor)\s*(?:\(?a\)?)?\s*(?:is|=|:|of)?\s*${NUMBER}`, "i").exec(stem);
  if (A === null && aRead) A = numberFrom(aRead, 1);

  const statedNatural = new RegExp(String.raw`ln\s*k\s*=\s*(-?\d+(?:\.\d+)?)\s*-\s*${NUMBER}\s*(?:k\s*)?\/\s*t\b`, "i").exec(stem);
  const statedLog = new RegExp(String.raw`log\s*k\s*=\s*(-?\d+(?:\.\d+)?)\s*-\s*${NUMBER}\s*(?:k\s*)?\/\s*t\b`, "i").exec(stem);
  const statedExp = new RegExp(String.raw`e\s*\^?\s*\(?\s*-\s*${NUMBER}\s*(?:k\s*)?\/\s*t\s*\)?`, "i").exec(stem);
  let statedSlope: ArrheniusSpec["statedSlope"] = null;
  if (statedNatural) statedSlope = { natural: true, b: numberFrom(statedNatural, 2) };
  else if (statedLog) statedSlope = { natural: false, b: numberFrom(statedLog, 2) };
  else if (statedExp) statedSlope = { natural: true, b: numberFrom(statedExp, 1) };

  let T1: number | null = planQuantity(quantities, ["T1", "T_1"]);
  let T2: number | null = planQuantity(quantities, ["T2", "T_2"]);
  const temps = readTemperatures(stem);
  const rise = /(?:rise|raised|increase[sd]?|increasing|rising|goes up|raising)\b[^.]{0,40}?\bby\s*(\d+(?:\.\d+)?)\s*(?:k\b|°\s*c|degrees?|deg)/.exec(stem)
    ?? /(\d+(?:\.\d+)?)\s*(?:k|°\s*c|degrees?)\s*(?:rise|increase)\s+in\s+temperature/.exec(stem);
  if (T1 === null || T2 === null) {
    const pair = /(\d+(?:\.\d+)?)\s*(?:k|°\s*c)\s*(?:to|and|&)\s*(\d+(?:\.\d+)?)\s*(?:k|°\s*c)\b/.exec(stem);
    if (pair) {
      const celsius = /°\s*c/.test(pair[0]);
      T1 = Number(pair[1]) + (celsius ? 273 : 0);
      T2 = Number(pair[2]) + (celsius ? 273 : 0);
    } else if (rise) {
      const delta = Number(rise[1]);
      const base = temps.find((value) => value !== delta) ?? null;
      if (base !== null) { T1 = base; T2 = base + delta; }
    } else if (temps.length >= 2) {
      T1 = temps[0]!;
      T2 = temps[1]!;
    } else if (temps.length === 1) {
      T1 = temps[0]!;
    }
  }

  let ratio: number | null = planQuantity(quantities, ["ratio", "k2_k1", "k2/k1"]);
  if (ratio === null) {
    const near = /\b(?:rate constant|rate|k)\b[^.]{0,60}?\b(doubl\w*|tripl\w*|quadrupl\w*|twice|halved|(?:\d+(?:\.\d+)?|two|three|four|five|ten)\s*(?:-|\s)?(?:times|fold))/.exec(stem);
    const sentence = near ? stem.slice(Math.max(0, stem.lastIndexOf(".", near.index)), stem.indexOf(".", near.index + near[0].length) === -1 ? undefined : stem.indexOf(".", near.index + near[0].length)) : "";
    if (near && /\b(?:temperature|°\s*c|\d\s*k\b|heat|rise|raised|warm)/.test(sentence)) {
      const word = near[1]!;
      if (/^doubl|^twice/.test(word)) ratio = 2;
      else if (/^tripl/.test(word)) ratio = 3;
      else if (/^quadrupl/.test(word)) ratio = 4;
      else if (/^halved/.test(word)) ratio = 0.5;
      else {
        const named: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, ten: 10 };
        const numeric = /^(\d+(?:\.\d+)?)/.exec(word);
        ratio = numeric ? Number(numeric[1]) : named[word.split(/[\s-]/)[0]!] ?? null;
      }
    }
  }

  let k1: number | null = planQuantity(quantities, ["k1", "k_1"]);
  let k2: number | null = planQuantity(quantities, ["k2", "k_2"]);
  if (k1 === null || k2 === null) {
    const values: number[] = [];
    const pattern = new RegExp(String.raw`(?:rate constant|\bk\b)\s*(?:_?[12]|₁|₂)?\s*(?:,?\s*k\s*)?(?:=|is|:)\s*${NUMBER}`, "gi");
    for (const match of stem.matchAll(pattern)) {
      if (damagedNumber(stem, match as RegExpExecArray, 1)) { values.length = 0; break; }
      values.push(numberFrom(match as RegExpExecArray, 1));
    }
    if (values.length >= 2) { k1 = values[0]!; k2 = values[1]!; }
    else if (values.length === 1 && k1 === null) k1 = values[0]!;
  }
  if (Ea === null && ratio === null && k1 === null && statedSlope === null) return null;
  return { T1, T2, k1, k2, ratio, Ea, A, statedSlope };
}

function readLinearPlot(stem: string, orders: ReactionOrder[]): LinearPlotKind | null {
  const vs = String.raw`\s*(?:vs\.?|versus|against|v\/s|with|as a function of)\s*`;
  const compareAsk = /\b(?:which|correct)\b[^.?]{0,80}?\b(?:plot|graph|graphical representation|curve)s?\b[^.?]{0,80}?\b(?:linear|straight line|straight)\b/.test(stem)
    || /\b(?:straight line|linear)\b[^.?]{0,60}?\b(?:plot|graph)s?\b/.test(stem)
    || /\bcorrect graphical representation/.test(stem)
    || /\b(?:plot|graph)s?\b[^.?]{0,40}\b(?:straight line|linear)\b/.test(stem);
  if (compareAsk) return orders.length >= 2 ? "compare_orders" : "compare_first";
  if (new RegExp(String.raw`ln\s*\[?[a-z]\]?${vs}(?:t\b|time)`).test(stem) || /plot of ln\s*\[?[a-z]\]?(?!\s*k)/.test(stem)) return "lnA_t";
  if (new RegExp(String.raw`log\s*\(?\s*\[?[a-z]\]?\s*_?0\s*\/\s*\[?[a-z]\]?\s*\)?${vs}(?:t\b|time)`).test(stem) || /log\s*\(?\s*\[a\]\s*_?0\s*\/\s*\[a\]/.test(stem)) return "logA0A_t";
  if (new RegExp(String.raw`1\s*\/\s*\[?[a-z]\]?${vs}(?:t\b|time)`).test(stem)) return "invA_t";
  if (new RegExp(String.raw`(?:\[a\]|concentration(?: of (?:the )?reactant)?)${vs}(?:t\b|time)`).test(stem)) return "A_t";
  return null;
}

const EQUILIBRIUM_PLOT = /(?:variation (?:of|in) (?:the )?concentrations?[^.]{0,40}with time|concentration[^.]{0,30}(?:vs\.?|versus|against) time|attains? equilibrium[^.]{0,80}(?:graph|plot|curve|diagram)|(?:graph|plot|curve)[^.]{0,80}attains? equilibrium|(?:graph|plot)[^.]{0,60}\bequilibrium\b[^.]{0,60}\btime\b)/;

/** Everything the stem (and the plan) says about the kinetics, or null when nothing is readable. */
export function kineticsFromStem(question: string, quantities: readonly ChemPlanQuantity[] = []): KineticsSpec | null {
  const stem = questionBody(chemStem(question));
  const ordersNamed = readOrders(stem);
  const order: ReactionOrder | null = ordersNamed.length === 1 ? ordersNamed[0]! : null;
  const reversible = /<=>|\breversible\b|\bequilibrium\b/.test(stem);

  // Half life, in the stem's unit.
  let tHalf: number | null = null;
  let timeUnit: string | null = null;
  const planHalf = planQuantity(quantities, ["t_half", "t12", "t1/2", "half_life", "halfLife", "t_1/2", "thalf"]);
  const halfRead = readHalfLife(stem);
  if (halfRead) { tHalf = halfRead.value; timeUnit = halfRead.unit; }
  if (planHalf !== null) {
    tHalf = planHalf;
    const planEntry = quantities.find((q) => ["t_half", "t12", "t1/2", "half_life", "halflife", "t_1/2", "thalf"].includes(q.id.toLowerCase().replace(/[^a-z0-9/]/g, "")));
    timeUnit = canonicalTimeUnit(planEntry?.unit) ?? timeUnit;
  }

  // Rate constant, in 1 / its own unit.
  let k: number | null = null;
  let kUnit: string | null = null;
  const planK = planQuantity(quantities, ["k", "rate_constant", "rateConstant"]);
  const kRead = readRateConstant(stem);
  if (kRead) { k = kRead.value; kUnit = kRead.unit; }
  if (planK !== null) {
    k = planK;
    const planEntry = quantities.find((q) => ["k", "rateconstant", "rate_constant"].includes(q.id.toLowerCase().replace(/[^a-z0-9_]/g, "")));
    const unitMatch = planEntry?.unit ? RATE_UNIT.exec(planEntry.unit) : null;
    kUnit = unitMatch ? canonicalTimeUnit(unitMatch[1]) : kUnit;
  }

  const a0Read = readInitialConcentration(stem);
  const planA0 = planQuantity(quantities, ["A0", "[A]0", "a_0", "initial_concentration", "c0"]);
  const a0 = planA0 ?? a0Read?.value ?? null;
  const concUnit = a0 !== null ? "M" : null;

  const given = readCompletionGiven(stem);
  const timesAskedRaw = readTimesAsked(stem, given?.span ?? null);
  const asked = readFractionsAsked(stem, given?.span ?? null);
  const fractionsAsked = asked.completion;
  const remainingAsked = asked.remaining;
  const concentrationsAsked = readConcentrationsAsked(stem);

  // One unit for the plot: the half life's, else k's, else the given completion's, else the asked instant's.
  const unit = timeUnit ?? kUnit ?? given?.unit ?? timesAskedRaw[0]?.unit ?? "min";
  if (k !== null && kUnit && kUnit !== unit) k = k / convertTime(1, unit, kUnit);
  if (tHalf !== null && timeUnit && timeUnit !== unit) tHalf = convertTime(tHalf, timeUnit, unit);
  const completion = given ? { fraction: given.fraction, time: convertTime(given.time, given.unit ?? unit, unit) } : null;
  const timesAsked = timesAskedRaw.map((entry) => convertTime(entry.value, entry.unit, unit));

  const arrhenius = readArrhenius(stem, quantities);
  const linear = readLinearPlot(stem, ordersNamed);
  const arrheniusPlot = /(?:ln|log)\s*k\b[^.]{0,20}(?:vs\.?|versus|against)\s*(?:1\s*\/\s*t|t\^?\(?-1\)?|reciprocal)|arrhenius plot|plot of (?:ln|log)\s*k\b/.test(stem);

  let plot: KineticsPlot | null = null;
  if (reversible && EQUILIBRIUM_PLOT.test(stem)) plot = "equilibrium";
  else if (arrheniusPlot || (arrhenius && (arrhenius.ratio !== null || arrhenius.k2 !== null || arrhenius.statedSlope !== null))) plot = "arrhenius";
  else if (linear) plot = "linear";
  else if (order !== null && (k !== null || tHalf !== null || completion !== null)) plot = "concentration";
  else if (order !== null && /(?:concentration|\[a\])[^.]{0,40}(?:with|vs\.?|versus|against) time|(?<!pre[ -])exponential|decreases with time/.test(stem)) plot = "concentration";
  // With only percentages asked and no rate, the decay can still be drawn in half life units.
  else if (order === 1 && (fractionsAsked.length > 0 || remainingAsked.length > 0)) plot = "concentration";

  let equilibriumK: number | null = null;
  const kc = new RegExp(String.raw`(?:equilibrium constant|k_?c|k_?p|\bk\b)\s*(?:=|is|:|of)\s*${NUMBER}`, "i").exec(stem);
  if (reversible && kc) equilibriumK = numberFrom(kc, 1);

  if (order === null && ordersNamed.length === 0 && k === null && tHalf === null && !arrhenius && !linear && plot === null) return null;
  return {
    order,
    ordersNamed,
    k,
    kUnit: kUnit ?? (k !== null ? unit : null),
    tHalf,
    timeUnit: unit,
    a0,
    concUnit,
    completion,
    fractionsAsked,
    remainingAsked,
    timesAsked,
    concentrationsAsked,
    arrhenius,
    plot,
    linear,
    equilibriumK,
  };
}

/* ------------------------------------------------------------------------- */
/* Cues                                                                       */

const HARD_VETO = /\b(?:radioactiv\w*|radio[ -]?nuclide|nucleus|nuclei|nuclear|decay constant|disintegrat\w*|isotope|energy profile|transition state|activated complex)\b/;
const PROFILE_WORDS = /\b(?:reaction coordinate|potential energy diagram|energy diagram|catalyst (?:lowers|reduces|decreases)|lowers the activation energy|progress of (?:the )?reaction)\b/;
const FIGURE_ABSENT = /\b(?:shown (?:below|above|in the (?:figure|graph|plot|diagram))|as shown|(?:is|are) shown\b|given below|given above|in the (?:given |following |above )?(?:figure|graph|plot|diagram)|figure is showing|the graph shown|the plot shown|plotted as a function of [^.]{0,40} as given|graph showing variation of reactant)/;
const LISTED_PLOTS = /(?:following|above|given) (?:graph|plot|figure|curve|diagram)s?\b/;
const BARE_OPTIONS = /\(a\)\s*\(b\)|\(c\)\s*\(d\)/;

/** A stem that refers to a picture we do not have; a stem that lists its plots in words is not one. */
function figureAbsent(stem: string): boolean {
  if (FIGURE_ABSENT.test(stem) || BARE_OPTIONS.test(stem)) return true;
  const listed = LISTED_PLOTS.exec(stem);
  if (!listed) return false;
  const sentence = stem.slice(listed.index).split(/[.?]/)[0] ?? "";
  return !/\b(?:vs\.?|versus|against)\b/.test(sentence);
}

function hasRateTemperatureNumbers(stem: string): boolean {
  return readTemperatures(stem).length > 0 && /\b(?:rate constant|\bk\b|doubl|tripl|times|fold|kj|j mol|kcal)/.test(stem);
}

/** True when the kinetics family should draw for this stem. */
export function isKineticsStem(question: string): boolean {
  const stem = chemStem(question);
  if (HARD_VETO.test(stem)) return false;
  if (PROFILE_WORDS.test(stem) && !hasRateTemperatureNumbers(stem)) return false;
  const orderWord = /\b(?:zero|zeroth|first|second|pseudo[ -]?first|1st|2nd|0th)[ -]?order\b/.test(stem);
  const plotCue = /\b(?:plot|graph|straight line|linear|slope|variation of|vs\.?|versus|against)\b/.test(stem);
  const halfLife = /half[ -]?li(?:fe|ves)\b|\bt\s*1\s*\/\s*2\b|t½|\bt_?\(?1\/2\)?/.test(stem);
  const rateConstant = /\brate constant\b/.test(stem);
  const rateLaw = /\brate law\b/.test(stem) && /\d/.test(stem);
  const arrhenius = /\barrhenius\b/.test(stem);
  const activation = /\bactivation energy\b/.test(stem) && hasRateTemperatureNumbers(stem);
  const lnk = /(?:ln|log)\s*k\b[^.]{0,20}(?:vs\.?|versus|against)\s*1\s*\/\s*t|plot of (?:ln|log)/.test(stem);
  const logRatio = /log\s*\(?\s*\[a\]\s*_?0\s*\/\s*\[a\]/.test(stem);
  const concTime = /concentration[^.]{0,30}(?:vs\.?|versus|against|with) time|attains? equilibrium/.test(stem);
  const orderPlot = /\border of (?:the |a )?reaction\b/.test(stem) && plotCue;
  return orderWord || halfLife || rateConstant || rateLaw || arrhenius || activation || lnk || logRatio || concTime || orderPlot;
}

/* ------------------------------------------------------------------------- */
/* Drawing helpers                                                            */

const X_SPAN = 10;
const Y_SPAN = 6;

function fitLabel(prefix: string, value: string): string {
  const spaced = `${prefix} = ${value}`;
  if (spaced.length <= 16) return spaced;
  const tight = `${prefix}=${value}`;
  if (tight.length <= 16) return tight;
  const tighter = `${prefix}=${value.replace(/\s+/g, "")}`;
  if (tighter.length <= 16) return tighter;
  return tighter.slice(0, 16);
}

/** "1/8" for a remaining fraction that is a unit fraction, else the percent left. */
function remainingLabel(remaining: number): string {
  const text = fractionText(remaining);
  return text.endsWith("%") ? `t_${fmt(100 - remaining * 100, 3)}` : `t_${text}`;
}

function timeLabel(prefix: string, value: number, unit: string): string {
  return fitLabel(prefix, `${fmt(value, 3)} ${unit}`);
}

/** A fraction label: 1/8 for 0.125, else a percent. */
function fractionText(remaining: number): string {
  for (const n of [2, 3, 4, 5, 8, 10, 16, 20, 32, 100, 1000]) {
    if (Math.abs(remaining * n - 1) < 1e-6) return `1/${n}`;
  }
  return `${fmt(remaining * 100, 3)} %`;
}

function percentText(fraction: number): string {
  const percent = fraction * 100;
  const rounded = Number(percent.toFixed(2));
  return `${rounded}`;
}

interface Panel { x0: number; y0: number; ids: string[] }

/** Axes with pinned end labels. A single figure uses the engine's `axes` (always through the origin). */
function axesWithLabels(c: ChemScene, tag: string, x0: number, xLabel: string, yLabel: string, panel: Panel, xPad = 0.6, yPad = 0.6): void {
  const axes = c.scene.axes(`${tag}_axes`, x0 - 0.45, x0 + X_SPAN + xPad, -0.45, Y_SPAN + yPad, "axes");
  const xl = c.text(`${tag}_xl`, { x: x0 + X_SPAN + xPad, y: -0.6 }, xLabel, "axis label");
  const yl = c.text(`${tag}_yl`, { x: x0 + 0.05, y: Y_SPAN + yPad + 0.4 }, yLabel, "axis label");
  panel.ids.push(axes, xl, yl);
}

/** Panel axes drawn as two arrows so several panels can sit at offsets in one document. */
function panelAxes(c: ChemScene, tag: string, panel: Panel, xLabel: string, yLabel: string, xPad = 0.6, yPad = 0.6): void {
  const { x0, y0 } = panel;
  const xAxis = c.arrow(`${tag}_xaxis`, { x: x0 - 0.45, y: y0 }, { x: x0 + X_SPAN + xPad, y: y0 }, "x axis");
  const yAxis = c.arrow(`${tag}_yaxis`, { x: x0, y: y0 - 0.45 }, { x: x0, y: y0 + Y_SPAN + yPad }, "y axis");
  const xl = c.text(`${tag}_xl`, { x: x0 + X_SPAN + xPad, y: y0 - 0.7 }, xLabel, "axis label");
  const yl = c.text(`${tag}_yl`, { x: x0 + 0.05, y: y0 + Y_SPAN + yPad + 0.55 }, yLabel, "axis label");
  panel.ids.push(xAxis, yAxis, xl, yl);
}

function dropLinks(c: ChemScene, tag: string, x0: number, x: number, y: number, panel: Panel, toY = true, toX = true): void {
  if (toX && y > 0.05) panel.ids.push(c.link(`${tag}_dx`, { x, y: 0 }, { x, y }, "drop to the time axis"));
  if (toY && x - x0 > 0.05) panel.ids.push(c.link(`${tag}_dy`, { x: x0, y }, { x, y }, "drop to the concentration axis"));
}

/** A marked point drawn as a filled dot with a solver placed label. */
function dot(c: ChemScene, id: string, at: { x: number; y: number }, role: string, label: string): string {
  c.scene.point(id, at, role, label);
  const entity = c.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.provenance = { ...(entity.provenance ?? {}), pointStyle: "filled" };
  return id;
}

function unitForConcentration(unit: string | null): string {
  return unit ?? "M";
}

/* ------------------------------------------------------------------------- */
/* Figure 1: first order decay with the half life on the curve               */

function buildFirstOrderDecay(question: string, spec: KineticsSpec, solution: KineticsSolution, qualitative: boolean): SceneDocument | null {
  const c = new ChemScene(question, "first order decay: [A]/[A]_0 falls exponentially, halving every half life", KINETICS_FAMILY);
  const panel: Panel = { x0: 0, y0: 0, ids: [] };
  // Relative mode: no rate is known, so time is measured in half lives. The
  // multiples (t_90 = 3.32 t_1/2) follow from the stem's percentages alone.
  const relative = qualitative && (spec.fractionsAsked.length > 0 || spec.remainingAsked.length > 0);
  const unit = relative ? "t_1/2" : spec.timeUnit;
  axesWithLabels(c, "p", 0, relative ? "t / t_1/2" : qualitative ? "t" : `t (${unit})`, "[A]/[A]_0", panel);
  if (qualitative && !relative) {
    const K = 0.35;
    panel.ids.push(c.scene.curve("curve", `${Y_SPAN}*exp(-${K}*x)`, 0, X_SPAN, "[A]/[A]_0 against t", undefined, 81));
    const xHalf = Math.LN2 / K;
    panel.ids.push(dot(c, "t_half", { x: xHalf, y: Y_SPAN / 2 }, "half life", "t_1/2"));
    dropLinks(c, "h", 0, xHalf, Y_SPAN / 2, panel);
    panel.ids.push(c.text("half", { x: -0.35, y: Y_SPAN / 2 }, "1/2", "tick"));
    panel.ids.push(c.text("one", { x: -0.35, y: Y_SPAN }, "1", "tick"));
    c.scene.labelled("t_half");
    return c.build({ caption: "First order: [A] = [A]_0 e^(-kt); the concentration halves every t_1/2 = 0.693/k, whatever the starting amount." });
  }
  const k = relative ? Math.LN2 : solution.k;
  const tHalf = relative ? 1 : solution.tHalf;
  if (k === null || tHalf === null) return null;
  const marks: Array<{ t: number; label: string; ytick: string | null }> = [];
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, a, b);
  const place = (t: number, label: string, ytick: string | null, replace: boolean) => {
    const existing = marks.find((m) => same(m.t, t));
    if (existing) {
      if (replace) existing.label = label;
      if (existing.ytick === null) existing.ytick = ytick;
      return;
    }
    marks.push({ t, label, ytick });
  };
  const multiple = (t: number) => fitLabel("", `${fmt(t, 3)} ${unit}`).replace(/^ ?= ?/, "");
  const at = (prefix: string, t: number) => relative ? fitLabel(prefix, `${fmt(t, 3)} ${unit}`) : timeLabel(prefix, t, unit);
  void multiple;
  place(tHalf, relative ? "t_1/2" : timeLabel("t_1/2", tHalf, unit), "1/2", false);
  place(2 * tHalf, relative ? "2t_1/2" : timeLabel("2t_1/2", 2 * tHalf, unit), "1/4", false);
  const completions = relative
    ? spec.fractionsAsked.map((fraction) => ({ fraction, time: Math.log2(1 / (1 - fraction)) }))
    : solution.timesForFractions;
  const remainings = relative
    ? spec.remainingAsked.map((remaining) => ({ remaining, time: Math.log2(1 / remaining) }))
    : solution.timesForRemaining;
  for (const entry of completions) place(entry.time, at(`t_${percentText(entry.fraction)}`, entry.time), fractionText(1 - entry.fraction), true);
  for (const entry of remainings) place(entry.time, at(remainingLabel(entry.remaining), entry.time), fractionText(entry.remaining), true);
  if (!relative) {
    for (const entry of solution.remainingAtTimes) place(entry.time, timeLabel("t", entry.time, unit), fractionText(entry.remaining), true);
    if (spec.completion) place(spec.completion.time, timeLabel(`t_${percentText(spec.completion.fraction)}`, spec.completion.time, unit), fractionText(1 - spec.completion.fraction), false);
  }
  marks.sort((a, b) => a.t - b.t);
  const tMax = Math.max(3.4 * tHalf, 1.12 * marks[marks.length - 1]!.t);
  const sx = X_SPAN / tMax;
  const K = Number((k / sx).toFixed(6));
  const curve = c.scene.curve("curve", `${Y_SPAN}*exp(-${K}*x)`, 0, X_SPAN, "[A]/[A]_0 against t", undefined, 97);
  panel.ids.push(curve);
  panel.ids.push(c.text("one", { x: -0.35, y: Y_SPAN }, "1", "tick"));
  const usedTicks = new Set<string>();
  marks.forEach((mark, index) => {
    const x = Number((mark.t * sx).toFixed(6));
    const y = Number((Y_SPAN * Math.exp(-K * x)).toFixed(6));
    const id = `m${index + 1}`;
    panel.ids.push(dot(c, id, { x, y }, index === 0 ? "half life" : "marked instant", mark.label));
    c.scene.assert(`${id}_on_curve`, "function_value", [curve], { x, y });
    dropLinks(c, id, 0, x, y, panel, y > 0.35, true);
    if (mark.ytick && y > 0.35 && !usedTicks.has(mark.ytick)) {
      usedTicks.add(mark.ytick);
      panel.ids.push(c.text(`${id}_tick`, { x: -0.35, y }, mark.ytick, "tick"));
    }
    c.scene.labelled(id);
  });
  if (relative) {
    const sentences: string[] = ["First order: every half life leaves half of what was there, so time is counted in half lives."];
    for (const entry of completions) sentences.push(`${percentText(entry.fraction)} % completion takes ${fmt(entry.time, 3)} t_1/2 (log2 of ${fmt(1 / (1 - entry.fraction), 4)}).`);
    for (const entry of remainings) sentences.push(`Falling to ${fractionText(entry.remaining)} of [A]_0 takes ${fmt(entry.time, 3)} t_1/2.`);
    if (completions.length === 2) sentences.push(`Ratio ${fmt(completions[1]!.time / completions[0]!.time, 3)}.`);
    if (remainings.length === 2) sentences.push(`Ratio ${fmt(remainings[0]!.time / remainings[1]!.time, 3)}.`);
    return c.build({ caption: sentences.join(" ") });
  }
  c.scene.quantity("k", "k", k, `1/${unit}`);
  c.scene.quantity("t_half", "t_1/2", tHalf, unit);
  const sentences: string[] = [`First order, t_1/2 = ${fmt(tHalf, 3)} ${unit} (k = ${fmt(k, 3)} per ${unit}).`];
  for (const entry of solution.timesForFractions) sentences.push(`Time for ${percentText(entry.fraction)} % completion: ${fmt(entry.time, 3)} ${unit}.`);
  for (const entry of solution.timesForRemaining) sentences.push(`Time to fall to ${fractionText(entry.remaining)} of [A]_0: ${fmt(entry.time, 3)} ${unit}.`);
  for (const entry of solution.remainingAtTimes) sentences.push(`After ${fmt(entry.time, 3)} ${unit}, [A]/[A]_0 = ${fractionText(entry.remaining)} (${fmt(entry.remaining * 100, 3)} % left).`);
  return c.build({ caption: sentences.join(" ") });
}

/* ------------------------------------------------------------------------- */
/* Figure 2: straight line plots                                              */

interface LinePanelSpec {
  tag: string;
  title: string;
  xLabel: string;
  yLabel: string;
  /** Display expression in x over 0..10. */
  expression: string;
  slopeLabel: string;
  interceptLabel: string | null;
  straight: boolean;
}

const LINE_PANELS: Record<Exclude<LinearPlotKind, "compare_orders" | "compare_first">, LinePanelSpec> = {
  A_t: { tag: "a", title: "zero order", xLabel: "t", yLabel: "[A]", expression: "6 - 0.5*x", slopeLabel: "slope = -k", interceptLabel: "[A]_0", straight: true },
  lnA_t: { tag: "ln", title: "first order", xLabel: "t", yLabel: "ln[A]", expression: "6 - 0.5*x", slopeLabel: "slope = -k", interceptLabel: "ln[A]_0", straight: true },
  logA0A_t: { tag: "lg", title: "first order", xLabel: "t", yLabel: "log([A]_0/[A])", expression: "0.55*x", slopeLabel: "slope = k/2.303", interceptLabel: null, straight: true },
  invA_t: { tag: "inv", title: "second order", xLabel: "t", yLabel: "1/[A]", expression: "1.2 + 0.48*x", slopeLabel: "slope = k", interceptLabel: "1/[A]_0", straight: true },
};

const CURVED_A_T: LinePanelSpec = { tag: "ca", title: "first order", xLabel: "t", yLabel: "[A]", expression: "6*exp(-0.3*x)", slopeLabel: "not a line", interceptLabel: "[A]_0", straight: false };

function drawLinePanel(c: ChemScene, spec: LinePanelSpec, x0: number, y0: number, withTitle: boolean): Panel {
  const panel: Panel = { x0, y0, ids: [] };
  if (withTitle) panelAxes(c, spec.tag, panel, spec.xLabel, spec.yLabel);
  else axesWithLabels(c, spec.tag, x0, spec.xLabel, spec.yLabel, panel);
  const shifted = `${y0} + (${spec.expression.replace(/\bx\b/g, `(x-${x0})`)})`;
  panel.ids.push(c.scene.curve(`${spec.tag}_line`, shifted, x0, x0 + X_SPAN, `${spec.yLabel} against t`, undefined, 65));
  const falling = spec.expression.startsWith("6") || spec.expression.startsWith("5.8");
  const slopeAt = falling || spec.straight === false ? { x: x0 + 6.6, y: y0 + 4.7 } : { x: x0 + 3.0, y: y0 + 5.0 };
  panel.ids.push(c.text(`${spec.tag}_slope`, slopeAt, spec.slopeLabel, "slope label"));
  // In the grid the scale is small, so the intercept label sits inside the plot beside the line start.
  const interceptAt = withTitle
    ? { x: x0 + 2.4, y: y0 + (falling ? 6.45 : 0.6) }
    : { x: x0 - 0.75, y: y0 + (falling ? 6 : 1.2) };
  if (spec.interceptLabel) panel.ids.push(c.text(`${spec.tag}_int`, interceptAt, spec.interceptLabel, "intercept"));
  if (withTitle) panel.ids.push(c.text(`${spec.tag}_title`, { x: x0 + 6.2, y: y0 + Y_SPAN + 1.75 }, spec.title, "panel title"));
  return panel;
}

function buildLinearPlots(question: string, spec: KineticsSpec, solution: KineticsSolution): SceneDocument | null {
  const kind = spec.linear;
  if (!kind) return null;
  const c = new ChemScene(question, "the straight line plot that identifies the order", KINETICS_FAMILY);
  if (kind === "compare_orders" || kind === "compare_first") {
    const order = spec.order ?? (kind === "compare_first" ? 1 : null);
    const panels: LinePanelSpec[] = kind === "compare_orders" || order === null
      ? [LINE_PANELS.A_t, LINE_PANELS.lnA_t, LINE_PANELS.invA_t]
      : order === 1
        ? [CURVED_A_T, LINE_PANELS.lnA_t, LINE_PANELS.logA0A_t]
        : order === 0
          ? [LINE_PANELS.A_t, { ...CURVED_A_T, tag: "ln0", title: "zero order", yLabel: "ln[A]", expression: "5.8 - 0.06*x*x", interceptLabel: "ln[A]_0" }]
          : [LINE_PANELS.invA_t, { ...CURVED_A_T, tag: "a2", title: "second order", expression: "6/(1+0.4*x)" }];
    // Two panels per row: three panels in one row shrink to slivers.
    const width = X_SPAN + 4.4;
    const height = Y_SPAN + 4.6;
    panels.forEach((panelSpec, index) => {
      const panel = drawLinePanel(c, panelSpec, (index % 2) * width, -Math.floor(index / 2) * height, true);
      c.scene.group(`panel_${panelSpec.tag}`, panel.ids, `${panelSpec.title}: ${panelSpec.yLabel} against t`, index === 0 ? [] : [`panel_${panels[index - 1]!.tag}`]);
    });
    const caption = kind === "compare_orders" || order === null
      ? "Zero order: [A] vs t is straight (slope -k). First order: ln[A] vs t is straight (slope -k). Second order: 1/[A] vs t is straight (slope k)."
      : order === 1
        ? "First order: [A] vs t curves down, ln[A] vs t is a straight line of slope -k, and log([A]_0/[A]) vs t is a straight line of slope k/2.303."
        : order === 0
          ? "Zero order: [A] vs t is the straight line (slope -k); ln[A] vs t bends."
          : "Second order: 1/[A] vs t is the straight line (slope k); [A] vs t curves.";
    return c.build({ caption });
  }
  const panelSpec = LINE_PANELS[kind];
  const panel = drawLinePanel(c, panelSpec, 0, 0, false);
  const order = spec.order ?? (kind === "A_t" ? 0 : kind === "invA_t" ? 2 : 1);
  const straightFor = kind === "A_t" ? 0 : kind === "invA_t" ? 2 : 1;
  // A first order stem asking for [A] vs t is the decay curve, not a line.
  if (kind === "A_t" && order === 1) return null;
  if (order !== straightFor) return null;
  const unit = spec.timeUnit;
  if (solution.k !== null && solution.tHalf !== null) {
    // Mark the half life on the line: over the display domain 0..10 the line
    // spans three half lives for the exponential kinds, and [A]_0 to 0 for zero order.
    const shifted = panelSpec.expression;
    const xHalf = kind === "A_t" ? 5 : kind === "invA_t" ? 10 / 3 : 10 / 3;
    const yHalf = kind === "A_t" ? 3.5 : kind === "invA_t" ? 1.2 + 0.48 * xHalf : kind === "lnA_t" ? 6 - 0.5 * xHalf : 0.55 * xHalf;
    void shifted;
    const x = Number(xHalf.toFixed(6));
    const y = Number(yHalf.toFixed(6));
    panel.ids.push(dot(c, "m_half", { x, y }, "half life", timeLabel("t_1/2", solution.tHalf, unit)));
    c.scene.assert("m_half_on_line", "function_value", [`${panelSpec.tag}_line`], { x, y });
    panel.ids.push(c.link("m_half_dx", { x, y: 0 }, { x, y }, "drop to the time axis"));
    c.scene.labelled("m_half");
    c.scene.quantity("k", "k", solution.k, `1/${unit}`);
    c.scene.quantity("t_half", "t_1/2", solution.tHalf, unit);
  }
  const captions: Record<typeof kind, string> = {
    A_t: "Zero order: [A] = [A]_0 - kt, a straight line of slope -k from the intercept [A]_0.",
    lnA_t: "First order: ln[A] = ln[A]_0 - kt, a straight line of slope -k and intercept ln[A]_0.",
    logA0A_t: "First order: log([A]_0/[A]) = kt/2.303, a straight line through the origin of slope k/2.303.",
    invA_t: "Second order: 1/[A] = 1/[A]_0 + kt, a straight line of slope k rising from 1/[A]_0.",
  };
  const extra = solution.tHalf !== null ? ` Here t_1/2 = ${fmt(solution.tHalf, 3)} ${unit}.` : "";
  return c.build({ caption: captions[kind] + extra });
}

/* ------------------------------------------------------------------------- */
/* Figure 2b: zero and second order with the stem's numbers                  */

function buildZeroOrderNumeric(question: string, spec: KineticsSpec, solution: KineticsSolution): SceneDocument | null {
  const { k, tHalf } = solution;
  const a0 = spec.a0;
  if (k === null || tHalf === null || a0 === null) return null;
  const unit = spec.timeUnit;
  const tEnd = a0 / k;
  const c = new ChemScene(question, "zero order: [A] falls along a straight line of slope -k", KINETICS_FAMILY);
  const panel: Panel = { x0: 0, y0: 0, ids: [] };
  axesWithLabels(c, "z", 0, `t (${unit})`, `[A] (${unitForConcentration(spec.concUnit)})`, panel);
  const curve = c.scene.curve("curve", `${Y_SPAN} - ${Y_SPAN / X_SPAN}*x`, 0, X_SPAN, "[A] against t", undefined, 33);
  panel.ids.push(curve);
  panel.ids.push(c.text("a0", { x: 1.7, y: Y_SPAN + 0.25 }, fitLabel("[A]_0", `${fmt(a0, 3)} M`), "intercept"));
  const marks: Array<{ t: number; label: string }> = [{ t: tHalf, label: timeLabel("t_1/2", tHalf, unit) }, { t: tEnd, label: timeLabel("t", tEnd, unit) }];
  for (const entry of solution.timesForConcentrations) {
    marks.push({ t: entry.time, label: `${fmt(entry.concentration, 3)} M, ${fmt(entry.time, 3)} ${unit}`.length <= 16 ? `${fmt(entry.concentration, 3)} M, ${fmt(entry.time, 3)} ${unit}` : timeLabel(`${fmt(entry.concentration, 2)} M`, entry.time, unit) });
  }
  marks.forEach((mark, index) => {
    const x = Number(((mark.t / tEnd) * X_SPAN).toFixed(6));
    const y = Number((Y_SPAN - (Y_SPAN / X_SPAN) * x).toFixed(6));
    const id = `m${index + 1}`;
    panel.ids.push(dot(c, id, { x, y }, index === 0 ? "half life" : "marked instant", mark.label));
    c.scene.assert(`${id}_on_line`, "function_value", [curve], { x, y });
    dropLinks(c, id, 0, x, y, panel, index === 0, y > 0.05);
    if (index === 0) panel.ids.push(c.text("half_tick", { x: -0.5, y }, `${fmt(a0 / 2, 3)} M`, "tick"));
    c.scene.labelled(id);
  });
  panel.ids.push(c.text("slope", { x: 6.6, y: 4.4 }, "slope = -k", "slope label"));
  c.scene.quantity("k", "k", k, `M/${unit}`);
  c.scene.quantity("t_half", "t_1/2", tHalf, unit);
  const sentences = [`Zero order: [A] = [A]_0 - kt with k = [A]_0/(2 t_1/2) = ${fmt(k, 3)} M per ${unit}; the line reaches zero at t = ${fmt(tEnd, 3)} ${unit}.`];
  if (solution.timesForConcentrations.length === 2) {
    const [first, second] = solution.timesForConcentrations;
    sentences.push(`From ${fmt(first!.concentration, 3)} M to ${fmt(second!.concentration, 3)} M takes ${fmt(Math.abs(second!.time - first!.time), 3)} ${unit}.`);
  }
  return c.build({ caption: sentences.join(" ") });
}

function buildSecondOrderNumeric(question: string, spec: KineticsSpec, solution: KineticsSolution): SceneDocument | null {
  const { k, tHalf } = solution;
  const a0 = spec.a0;
  if (k === null || tHalf === null || a0 === null) return null;
  const unit = spec.timeUnit;
  const c = new ChemScene(question, "second order: 1/[A] rises along a straight line of slope k", KINETICS_FAMILY);
  const panel: Panel = { x0: 0, y0: 0, ids: [] };
  axesWithLabels(c, "s", 0, `t (${unit})`, "1/[A]", panel);
  // Three half lives across the display: 1/[A] goes from 1/[A]_0 to 4/[A]_0.
  const curve = c.scene.curve("curve", "1.5 + 0.45*x", 0, X_SPAN, "1/[A] against t", undefined, 33);
  panel.ids.push(curve);
  panel.ids.push(c.text("inv0", { x: 1.75, y: 0.7 }, fitLabel("1/[A]_0", `${fmt(1 / a0, 3)} L/mol`), "intercept"));
  const x = Number((X_SPAN / 3).toFixed(6));
  const y = Number((1.5 + 0.45 * x).toFixed(6));
  panel.ids.push(dot(c, "m1", { x, y }, "half life", timeLabel("t_1/2", tHalf, unit)));
  c.scene.assert("m1_on_line", "function_value", [curve], { x, y });
  dropLinks(c, "m1", 0, x, y, panel);
  c.scene.labelled("m1");
  panel.ids.push(c.text("slope", { x: 3.0, y: 4.9 }, "slope = k", "slope label"));
  c.scene.quantity("k", "k", k, `1/(M ${unit})`);
  c.scene.quantity("t_half", "t_1/2", tHalf, unit);
  return c.build({ caption: `Second order: 1/[A] = 1/[A]_0 + kt; t_1/2 = 1/(k[A]_0) = ${fmt(tHalf, 3)} ${unit}, which depends on [A]_0.` });
}

/* ------------------------------------------------------------------------- */
/* Figure 3: Arrhenius                                                        */

function buildArrhenius(question: string, spec: KineticsSpec, solution: KineticsSolution, qualitative: boolean): SceneDocument | null {
  const arr = spec.arrhenius;
  const c = new ChemScene(question, "Arrhenius: ln k against 1/T is a straight line of slope -E_a/R", KINETICS_FAMILY);
  const panel: Panel = { x0: 0, y0: 0, ids: [] };
  axesWithLabels(c, "ar", 0, "1/T", "ln k", panel);
  const T1 = arr?.T1 ?? null;
  const T2 = solution.T2;
  const ratio = solution.ratio;
  const Ea = solution.Ea;
  const numeric = !qualitative && T1 !== null && T2 !== null && ratio !== null && Ea !== null && T1 !== T2 && ratio > 0 && ratio !== 1;
  if (!numeric) {
    if (!qualitative && Ea === null) return null;
    const line = c.scene.curve("line", "5.4 - 0.45*x", 0, X_SPAN, "ln k against 1/T", undefined, 33);
    panel.ids.push(line);
    panel.ids.push(c.text("slope", { x: 6.6, y: 4.6 }, "slope = -E_a/R", "slope label"));
    panel.ids.push(c.text("lnA", { x: -0.75, y: 5.4 }, "ln A", "intercept"));
    const eaText = Ea !== null ? ` Here E_a = ${fmt(Ea / 1000, 3)} kJ/mol.` : "";
    return c.build({ caption: `ln k = ln A - E_a/(RT): the plot against 1/T is a straight line, slope -E_a/R and intercept ln A.${eaText}` });
  }
  // Display map: 1/T on x (linear), ln k on y (linear); the hotter temperature sits left.
  const invLo = Math.min(1 / T1!, 1 / T2!);
  const invHi = Math.max(1 / T1!, 1 / T2!);
  const xOf = (T: number) => 2 + ((1 / T - invLo) / (invHi - invLo)) * 6;
  const lnLo = Math.min(0, Math.log(ratio!));
  const lnHi = Math.max(0, Math.log(ratio!));
  const yOf = (lnRel: number) => 1.5 + ((lnRel - lnLo) / (lnHi - lnLo)) * 3;
  const x1 = Number(xOf(T1!).toFixed(6));
  const x2 = Number(xOf(T2!).toFixed(6));
  const y1 = Number(yOf(0).toFixed(6));
  const y2 = Number(yOf(Math.log(ratio!)).toFixed(6));
  const m = Number(((y2 - y1) / (x2 - x1)).toFixed(6));
  const b = Number((y1 - m * x1).toFixed(6));
  const line = c.scene.curve("line", `${b} ${m < 0 ? "-" : "+"} ${Math.abs(m)}*x`, 0, X_SPAN, "ln k against 1/T", undefined, 33);
  panel.ids.push(line);
  const hot = T1! > T2! ? "p1" : "p2";
  void hot;
  const p1y = Number((m * x1 + b).toFixed(6));
  const p2y = Number((m * x2 + b).toFixed(6));
  panel.ids.push(dot(c, "p1", { x: x1, y: p1y }, "measured point", fitLabel("T_1", `${fmt(T1!, 4)} K`)));
  panel.ids.push(dot(c, "p2", { x: x2, y: p2y }, "measured point", fitLabel("T_2", `${fmt(T2!, 4)} K`)));
  c.scene.assert("p1_on_line", "function_value", [line], { x: x1, y: p1y });
  c.scene.assert("p2_on_line", "function_value", [line], { x: x2, y: p2y });
  panel.ids.push(c.link("p1_dx", { x: x1, y: 0 }, { x: x1, y: p1y }, "drop to the 1/T axis"));
  panel.ids.push(c.link("p2_dx", { x: x2, y: 0 }, { x: x2, y: p2y }, "drop to the 1/T axis"));
  panel.ids.push(c.link("p1_dy", { x: 0, y: p1y }, { x: x1, y: p1y }, "drop to the ln k axis"));
  panel.ids.push(c.link("p2_dy", { x: 0, y: p2y }, { x: x2, y: p2y }, "drop to the ln k axis"));
  panel.ids.push(c.text("slope", { x: 6.9, y: 5.2 }, "slope = -E_a/R", "slope label"));
  panel.ids.push(c.text("ea", { x: 6.9, y: 4.5 }, fitLabel("E_a", `${fmt(Ea! / 1000, 3)} kJ/mol`), "result"));
  c.scene.labelled("p1", "p2");
  c.scene.quantity("Ea", "E_a", Ea!, "J/mol");
  c.scene.quantity("T1", "T_1", T1!, "K");
  c.scene.quantity("T2", "T_2", T2!, "K");
  c.scene.quantity("ratio", "k_2/k_1", ratio!, "");
  const ratioText = arr?.ratio !== null && arr?.ratio !== undefined
    ? `k rises ${fmt(ratio!, 3)} times from ${fmt(T1!, 4)} K to ${fmt(T2!, 4)} K`
    : arr?.k1 !== null && arr?.k2 !== null
      ? `k goes from ${fmt(arr!.k1!, 3)} at ${fmt(T1!, 4)} K to ${fmt(arr!.k2!, 3)} at ${fmt(T2!, 4)} K`
      : `between ${fmt(T1!, 4)} K and ${fmt(T2!, 4)} K, k changes by a factor ${fmt(ratio!, 3)}`;
  const derived = arr?.Ea === null && !arr?.statedSlope
    ? `so E_a = R ln(k_2/k_1)/(1/T_1 - 1/T_2) = ${fmt(Ea! / 1000, 3)} kJ/mol.`
    : arr?.T2 === null
      ? `with E_a = ${fmt(Ea! / 1000, 3)} kJ/mol, so T_2 = ${fmt(T2!, 4)} K (${fmt(T2! - 273, 3)} °C).`
      : `with E_a = ${fmt(Ea! / 1000, 3)} kJ/mol.`;
  return c.build({ caption: `ln k against 1/T is a straight line of slope -E_a/R; ${ratioText}, ${derived}` });
}

/* ------------------------------------------------------------------------- */
/* Figure 4: concentration against time to equilibrium                       */

function buildEquilibriumPlot(question: string, spec: KineticsSpec): SceneDocument | null {
  const K = spec.equilibriumK;
  const aEq = K !== null && K > 0.05 && K < 20 ? Y_SPAN / (1 + K) : 2.4;
  const bEq = Y_SPAN - aEq;
  const r = 0.75;
  const tEq = Math.log(50) / r;
  const c = new ChemScene(question, "A <=> B: the reactant falls and the product rises until both concentrations become constant at equilibrium", KINETICS_FAMILY);
  const panel: Panel = { x0: 0, y0: 0, ids: [] };
  axesWithLabels(c, "eq", 0, "t", "conc.", panel, 1.4, 0.9);
  const a = c.scene.curve("curve_a", `${aEq.toFixed(4)} + ${bEq.toFixed(4)}*exp(-${r}*x)`, 0, X_SPAN, "[A] against t", undefined, 81);
  const bCurve = c.scene.curve("curve_b", `${bEq.toFixed(4)} - ${bEq.toFixed(4)}*exp(-${r}*x)`, 0, X_SPAN, "[B] against t", undefined, 81);
  panel.ids.push(a, bCurve);
  panel.ids.push(c.text("la", { x: X_SPAN + 0.55, y: aEq }, "[A]", "curve label"));
  panel.ids.push(c.text("lb", { x: X_SPAN + 0.55, y: bEq }, "[B]", "curve label"));
  panel.ids.push(c.text("a0", { x: -0.75, y: Y_SPAN }, "[A]_0", "intercept"));
  panel.ids.push(c.link("teq", { x: tEq, y: 0 }, { x: tEq, y: Y_SPAN + 0.3 }, "equilibrium reached"));
  panel.ids.push(c.text("teq_label", { x: tEq, y: Y_SPAN + 0.75 }, "equilibrium", "marker"));
  panel.ids.push(c.text("teq_t", { x: tEq, y: -0.55 }, "t_eq", "tick"));
  const caption = K !== null
    ? `[A] falls and [B] rises until, at t_eq, both stay constant: forward and backward rates are equal (K = ${fmt(K, 3)}, so [B]/[A] = ${fmt(K, 3)} at equilibrium).`
    : "[A] falls and [B] rises until, at t_eq, both stay constant: the forward and backward rates have become equal, not zero.";
  return c.build({ caption });
}

/* ------------------------------------------------------------------------- */
/* Entry                                                                      */

/** The kinetics figure, or null when the stem does not ground one. */
export function buildKineticsScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  const stem = chemStem(question);
  if (HARD_VETO.test(stem)) return null;
  if (figureAbsent(stem)) return null;
  if (/half[ -]?lives\b/.test(stem) && /\brespectively\b|\band\b[^.]{0,20}\bmin\b|two (?:independent|different)/.test(stem)) return null;
  const spec = kineticsFromStem(question, quantities);
  if (!spec) return null;
  const solution = solveKinetics(spec);
  try {
    if (spec.plot === "equilibrium") return buildEquilibriumPlot(question, spec);
    if (spec.plot === "arrhenius") {
      const numericReady = spec.arrhenius !== null && spec.arrhenius.T1 !== null && solution.T2 !== null && solution.ratio !== null && solution.Ea !== null;
      const plotCue = /(?:ln|log)\s*k\b[^.]{0,20}(?:vs\.?|versus|against)\s*(?:1\s*\/\s*t|reciprocal)|arrhenius plot|plot of (?:ln|log)\s*k\b/.test(stem);
      if (numericReady) return buildArrhenius(question, spec, solution, false);
      if (plotCue || schematic) return buildArrhenius(question, spec, solution, true);
      return null;
    }
    const numericLine = solution.k !== null && solution.tHalf !== null && spec.a0 !== null;
    if (spec.order === 0 && numericLine && (spec.linear === null || spec.linear === "A_t")) return buildZeroOrderNumeric(question, spec, solution);
    if (spec.order === 2 && numericLine && (spec.linear === null || spec.linear === "invA_t")) return buildSecondOrderNumeric(question, spec, solution);
    if (spec.plot === "linear") return buildLinearPlots(question, spec, solution);
    if (spec.order === 1) {
      const numeric = solution.k !== null && solution.tHalf !== null;
      if (numeric) return buildFirstOrderDecay(question, spec, solution, false);
      if (spec.plot === "concentration" || schematic) return buildFirstOrderDecay(question, spec, solution, true);
      return null;
    }
    if (spec.order === 0 && solution.k !== null && solution.tHalf !== null && spec.a0 !== null) return buildZeroOrderNumeric(question, spec, solution);
    if (spec.order === 2 && solution.k !== null && solution.tHalf !== null && spec.a0 !== null) return buildSecondOrderNumeric(question, spec, solution);
    if (spec.order === 0 && (spec.plot === "concentration" || schematic)) {
      return buildLinearPlots(question, { ...spec, linear: "A_t" }, solution);
    }
    if (spec.order === 2 && (spec.plot === "concentration" || schematic)) {
      return buildLinearPlots(question, { ...spec, linear: "invA_t" }, solution);
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                     */

export const KINETICS_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  {
    question: "For a first order reaction, 50 % of A is decomposed in 120 min. Calculate the time required for 90 % decomposition of A.",
    expect: "draw",
    labels: ["t_1/2 = 120 min", "2t_1/2 = 240 min", "t_90 = 399 min", "[A]/[A]_0", "t (min)"],
    note: "t_90 = t_1/2 log 10 / log 2 = 120 x 3.3219 = 398.6 min",
  },
  {
    question: "The half life of a first order reaction is 20 min. What fraction of the reactant remains after 60 min?",
    expect: "draw",
    labels: ["t_1/2 = 20 min", "2t_1/2 = 40 min", "t = 60 min", "1/8"],
    note: "three half lives leave 1/8 = 12.5 %",
  },
  {
    question: "The rate constant of a first order reaction is k = 6.93 x 10^-3 s^-1. Find the half life of the reaction.",
    expect: "draw",
    labels: ["t_1/2 = 100 s", "2t_1/2 = 200 s", "t (s)"],
    note: "t_1/2 = 0.693/k = 100 s",
  },
  {
    question: "For a first order reaction the rate constant is 2.3 x 10^-3 s^-1. Calculate the time required for 75 % completion of the reaction.",
    expect: "draw",
    labels: ["t_1/2 = 301 s", "t_75 = 603 s"],
    note: "t_75 = (2.303/k) log 4 = 602.7 s, exactly two half lives",
  },
  {
    question: "The rate constant of a reaction doubles when the temperature is raised from 300 K to 310 K. Calculate the activation energy of the reaction. (R = 8.314 J K^-1 mol^-1)",
    expect: "draw",
    labels: ["T_1 = 300 K", "T_2 = 310 K", "slope = -E_a/R", "E_a=53.6 kJ/mol", "ln k", "1/T"],
    note: "E_a = ln 2 x 8.314 / (1/300 - 1/310) = 53.6 kJ/mol",
  },
  {
    question: "Which of the following plots is a straight line for a first order reaction: [A] vs t, ln[A] vs t, or log([A]0/[A]) vs t?",
    expect: "draw",
    labels: ["slope = -k", "slope = k/2.303", "ln[A]", "log([A]_0/[A])", "not a line"],
    note: "three panels: [A] vs t curved, ln[A] vs t straight, log([A]_0/[A]) vs t straight",
  },
  {
    question: "Half life of a zero order reaction A -> product is 1 hour when the initial concentration of the reactant is 2.0 mol L^-1. Draw the plot of [A] vs t and find the time required to decrease the concentration of A from 0.50 to 0.25 mol L^-1.",
    expect: "draw",
    labels: ["t_1/2 = 1 h", "[A]_0 = 2 M", "slope = -k", "t = 2 h"],
    note: "k = [A]_0/(2 t_1/2) = 1 M/h; 0.50 to 0.25 M takes 0.25 h = 15 min",
  },
  {
    question: "For a second order reaction with rate constant k = 0.5 L mol^-1 min^-1 and initial concentration [A]0 = 0.2 mol L^-1, draw the graph of 1/[A] vs t and mark the half life.",
    expect: "draw",
    labels: ["t_1/2 = 10 min", "slope = k", "1/[A]", "1/[A]_0=5 L/mol"],
    note: "t_1/2 = 1/(k[A]_0) = 1/(0.5 x 0.2) = 10 min",
  },
  {
    question: "For the reversible reaction A <=> B starting with pure A, draw the graph showing the variation of concentration of A and B with time as the reaction attains equilibrium.",
    expect: "draw",
    labels: ["[A]", "[B]", "equilibrium", "[A]_0"],
    note: "reactant falls, product rises, both flatten at t_eq",
  },
  {
    question: "For a first order reaction, plot ln[A] vs t and state the slope of the line.",
    expect: "draw",
    labels: ["slope = -k", "ln[A]_0", "ln[A]"],
  },
  {
    question: "Which of the following graphs is a straight line for zero, first and second order reactions: [A] vs t, ln[A] vs t and 1/[A] vs t respectively?",
    expect: "draw",
    labels: ["zero order", "first order", "second order", "slope = -k", "slope = k"],
    note: "three panels by order",
  },
  {
    question: "A radioactive nucleus has a half life of 20 min. What fraction of the sample remains after 60 min?",
    expect: "decline",
    note: "radioactive decay belongs to physics",
  },
  {
    question: "Draw the energy profile diagram for an exothermic reaction and mark the activation energy and the transition state.",
    expect: "decline",
    note: "energy profile lane",
  },
  {
    question: "The graph shown below gives the variation of ln k with 1/T for a first order reaction. Find the activation energy from the slope.",
    expect: "decline",
    note: "figure absent",
  },
  {
    question: "A catalyst lowers the activation energy of a reaction. Explain with reference to the reaction coordinate diagram how the rate increases.",
    expect: "decline",
    note: "catalysis prose with no rate or temperature numbers",
  },
  {
    question: "State Le Chatelier's principle and explain the effect of increasing pressure on the equilibrium N2 + 3H2 <=> 2NH3.",
    expect: "decline",
    note: "Le Chatelier is text only",
  },
];
