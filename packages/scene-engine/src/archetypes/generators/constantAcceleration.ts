/**
 * One interval of straight-line motion under constant acceleration (SUVAT).
 *
 * Slots are read from the question's own numbers and from turn-plan givens
 * whose quoted source text is in the question. The five SUVAT quantities are
 * then recomputed here from any three of them; the plan's derived values are
 * never drawn, they are only compared, so a stale narration scalar declines
 * the figure instead of pairing with it.
 *
 * Supported: one interval, +x along the initial motion (u >= 0), the body
 * never reverses inside the interval, SI or common metric units. Declined:
 * vertical throws and free fall, several phases, reversal, a body that
 * stops before the stated time, over-determined givens that disagree, a
 * plan value that disagrees with the recomputed state, unknown units.
 */
import { SceneBuilder, fmt } from "../document";
import { parseStemNumber, STEM_NUMBER, type PlanQuantity, type SlotBag, type SlotSource } from "../slots";
import { maybeNum, type GeneratorContext, type GeneratorTable } from "./context";

export type SuvatRole = "u" | "v" | "a" | "t" | "s";
export type SuvatState = Record<SuvatRole, number>;
export type SuvatResolution =
  | { ok: true; state: SuvatState; knowns: Partial<Record<SuvatRole, SlotSource>> }
  | { ok: false; reason: string };

const ROLES: readonly SuvatRole[] = ["u", "v", "a", "t", "s"];
const RELATIVE_TOLERANCE = 0.005;

/* ------------------------------------------------------------------------- */
/* Solving                                                                    */
/* ------------------------------------------------------------------------- */

type Knowns = Partial<Record<SuvatRole, number>>;

function has(known: Knowns, ...roles: SuvatRole[]): boolean {
  return roles.every((role) => known[role] !== undefined);
}

/** The full state from one triple, or null when that triple cannot fix it. */
function fromTriple(known: Knowns): SuvatState | null {
  const { u, v, a, t, s } = known;
  if (has(known, "u", "a", "t")) return { u: u!, a: a!, t: t!, v: u! + a! * t!, s: u! * t! + 0.5 * a! * t! * t! };
  if (has(known, "u", "v", "t") && t! > 0) return { u: u!, v: v!, t: t!, a: (v! - u!) / t!, s: (u! + v!) * t! / 2 };
  if (has(known, "v", "a", "t")) return { v: v!, a: a!, t: t!, u: v! - a! * t!, s: v! * t! - 0.5 * a! * t! * t! };
  if (has(known, "u", "v", "a") && a! !== 0) {
    const time = (v! - u!) / a!;
    return { u: u!, v: v!, a: a!, t: time, s: (v! * v! - u! * u!) / (2 * a!) };
  }
  if (has(known, "u", "a", "s")) {
    if (a! === 0) return u! > 0 ? { u: u!, a: 0, s: s!, v: u!, t: s! / u! } : null;
    const disc = u! * u! + 2 * a! * s!;
    if (disc < 0) return null;
    const roots = [(-u! + Math.sqrt(disc)) / a!, (-u! - Math.sqrt(disc)) / a!].filter((root) => root > 0);
    if (roots.length === 0) return null;
    const time = Math.min(...roots);
    return { u: u!, a: a!, s: s!, t: time, v: u! + a! * time };
  }
  if (has(known, "u", "v", "s") && u! + v! > 0) {
    const time = 2 * s! / (u! + v!);
    return { u: u!, v: v!, s: s!, t: time, a: time > 0 ? (v! - u!) / time : NaN };
  }
  if (has(known, "v", "a", "s")) {
    const square = v! * v! - 2 * a! * s!;
    if (square < 0) return null;
    const initial = Math.sqrt(square);
    if (a! === 0) return v! > 0 ? { u: v!, v: v!, a: 0, s: s!, t: s! / v! } : null;
    return { u: initial, v: v!, a: a!, s: s!, t: (v! - initial) / a! };
  }
  if (has(known, "u", "t", "s") && t! > 0) {
    const accel = 2 * (s! - u! * t!) / (t! * t!);
    return { u: u!, t: t!, s: s!, a: accel, v: u! + accel * t! };
  }
  if (has(known, "v", "t", "s") && t! > 0) {
    const initial = 2 * s! / t! - v!;
    return { v: v!, t: t!, s: s!, u: initial, a: (v! - initial) / t! };
  }
  if (has(known, "a", "t", "s") && t! > 0) {
    const initial = s! / t! - a! * t! / 2;
    return { a: a!, t: t!, s: s!, u: initial, v: initial + a! * t! };
  }
  return null;
}

export function agrees(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 + RELATIVE_TOLERANCE * Math.max(Math.abs(actual), Math.abs(expected));
}

/**
 * Resolve the interval from at least three source-bound quantities. Every
 * extra known and every claimed (plan) value must agree with the result.
 */
export function resolveConstantAcceleration(
  knowns: Knowns,
  claims: Knowns = {},
): { ok: true; state: SuvatState } | { ok: false; reason: string } {
  const count = ROLES.filter((role) => knowns[role] !== undefined).length;
  if (count < 3) return { ok: false, reason: `only ${count} source-bound quantities; three are needed` };
  const state = fromTriple(knowns);
  if (!state || ROLES.some((role) => !Number.isFinite(state[role]))) {
    return { ok: false, reason: "the stated quantities do not fix one forward interval" };
  }
  if (!(state.t > 0)) return { ok: false, reason: "the interval would need zero or negative time" };
  if (state.u < 0) return { ok: false, reason: "initial motion is against the declared +x direction" };
  if (state.v < 0) return { ok: false, reason: "the body would stop and reverse inside the interval" };
  if (state.s < 0) return { ok: false, reason: "negative displacement for forward motion" };
  for (const role of ROLES) {
    const given = knowns[role];
    if (given !== undefined && !agrees(state[role], given)) {
      return { ok: false, reason: `over-determined givens disagree: ${role}=${given} but the others give ${state[role]}` };
    }
    const claim = claims[role];
    if (claim !== undefined && !agrees(state[role], claim)) {
      return { ok: false, reason: `plan value ${role}=${claim} disagrees with the recomputed ${state[role]}` };
    }
  }
  return { ok: true, state };
}

/* ------------------------------------------------------------------------- */
/* Source binding                                                             */
/* ------------------------------------------------------------------------- */

type Dimension = "speed" | "accel" | "time" | "length";

const UNIT_TABLE: ReadonlyArray<{ dimension: Dimension; pattern: string; factor: number }> = [
  { dimension: "accel", pattern: String.raw`m\s*\/\s*s\s*\^\s*2|m\s*\/\s*s2|m\s*s\s*\^\s*-\s*2|ms\^-2`, factor: 1 },
  { dimension: "accel", pattern: String.raw`cm\s*\/\s*s\s*\^\s*2|cm\s*s\s*\^\s*-\s*2`, factor: 0.01 },
  { dimension: "speed", pattern: String.raw`km\s*\/\s*h(?:r|our)?|kmph|km\s*h\s*\^\s*-\s*1|kmh\^-1`, factor: 1 / 3.6 },
  { dimension: "speed", pattern: String.raw`cm\s*\/\s*s|cm\s*s\s*\^\s*-\s*1`, factor: 0.01 },
  { dimension: "speed", pattern: String.raw`m\s*\/\s*s|m\s*s\s*\^\s*-\s*1|ms\^-1|mps`, factor: 1 },
  { dimension: "time", pattern: String.raw`min(?:utes?|s)?`, factor: 60 },
  { dimension: "time", pattern: String.raw`h(?:ours?|rs?)?`, factor: 3600 },
  { dimension: "time", pattern: String.raw`s(?:ec(?:onds?|s)?)?|seconds?`, factor: 1 },
  { dimension: "length", pattern: String.raw`km|kilomet(?:er|re)s?`, factor: 1000 },
  { dimension: "length", pattern: String.raw`cm|centimet(?:er|re)s?`, factor: 0.01 },
  { dimension: "length", pattern: String.raw`m|met(?:er|re)s?`, factor: 1 },
];

export interface Token { value: number; dimension: Dimension; start: number; end: number }

/** Every number-with-unit in the text, in SI, read with the shared stem number grammar. */
export function tokens(text: string): Token[] {
  const found: Token[] = [];
  const taken: Array<[number, number]> = [];
  for (const unit of UNIT_TABLE) {
    const pattern = new RegExp(`${STEM_NUMBER}\\s*(?:${unit.pattern})(?![a-zA-Z0-9^/])`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      const value = parseStemNumber(match[1]!);
      if (value === null) continue;
      taken.push([start, end]);
      found.push({ value: value * unit.factor, dimension: unit.dimension, start, end });
    }
  }
  return found.sort((x, y) => x.start - y.start);
}

export const DECELERATION = /\b(?:decelerat\w*|retard\w*|brak(?:e|es|ed|ing)|slows?(?:\s+down)?|slowing)\b/i;
export const STARTS_AT_REST = /\b(?:(?:starts?|starting|started)\s+(?:from|at)\s+rest|from rest|initially at rest)\b/i;
export const ENDS_AT_REST = /\b(?:comes?\s+to\s+(?:a\s+)?(?:rest|stop|halt)|brought\s+to\s+(?:rest|a\s+stop)|until\s+it\s+stops|stops|to\s+rest|to\s+a\s+(?:stop|halt)|halts|stopping distance)\b/i;
export const FINAL_SPEED_BEFORE = /(?:\breach(?:es|ed|ing)?|\battain(?:s|ed|ing)?|\bfinal\s+(?:velocity|speed)(?:\s+(?:of|is|=))?|\bacquires?|\bgains?|\bbecomes?|\bincreases?\s+to|\bdecreases?\s+to|\bto)\s*(?:a\s+)?(?:(?:velocity|speed)\s+(?:of\s+)?)?$/i;

export function normalized(text: string): string {
  return text.toLowerCase().replace(/[–—−]/g, "-").replace(/²/g, "^2").replace(/⁻¹/g, "^-1").replace(/⁻²/g, "^-2").replace(/\s+/g, " ").trim();
}

/** Role values read straight from the question. Ambiguity reads nothing. */
export function stemKnowns(stem: string): Knowns {
  const text = normalized(stem);
  const found = tokens(text);
  const known: Knowns = {};
  const accel = found.filter((token) => token.dimension === "accel");
  if (accel.length === 1) {
    const value = accel[0]!.value;
    known.a = value > 0 && DECELERATION.test(text) ? -value : value;
  }
  const times = found.filter((token) => token.dimension === "time");
  if (times.length === 1) known.t = times[0]!.value;
  const lengths = found.filter((token) => token.dimension === "length");
  if (lengths.length === 1) known.s = lengths[0]!.value;
  const speeds = found.filter((token) => token.dimension === "speed");
  const restStart = STARTS_AT_REST.test(text);
  const restEnd = ENDS_AT_REST.test(text);
  const roleOfSpeed = (token: Token): "u" | "v" => FINAL_SPEED_BEFORE.test(text.slice(Math.max(0, token.start - 40), token.start).trim()) ? "v" : "u";
  if (speeds.length === 1) {
    const role = restStart ? "v" : restEnd ? "u" : roleOfSpeed(speeds[0]!);
    known[role] = speeds[0]!.value;
  } else if (speeds.length === 2) {
    const roles = speeds.map(roleOfSpeed);
    if (roles[0] === "u" && roles[1] === "v") {
      known.u = speeds[0]!.value;
      known.v = speeds[1]!.value;
    }
  }
  if (restStart && known.u === undefined) known.u = 0;
  if (restEnd && known.v === undefined) known.v = 0;
  // A v-t graph stated as a horizontal line, or one constant velocity, has a=0.
  if (known.a === undefined && VT_GRAPH.test(text) && /\b(?:horizontal (?:straight )?line|constant (?:velocity|speed)|uniform (?:velocity|speed))\b/i.test(text)) {
    known.a = 0;
  }
  return known;
}

const ROLE_ALIASES: Record<SuvatRole, readonly string[]> = {
  u: ["u", "v0", "u0", "vi", "initialvelocity", "initialspeed", "vinitial"],
  v: ["v", "vf", "v1", "finalvelocity", "finalspeed", "vfinal"],
  a: ["a", "acceleration", "deceleration", "retardation"],
  t: ["t", "time", "duration"],
  s: ["s", "d", "x", "deltax", "dx", "distance", "displacement", "stoppingdistance"],
};

function key(value: string): string {
  return value.toLowerCase().replace(/\\(?:mathrm|text|operatorname)/g, "").replace(/[^a-z0-9]/g, "");
}

function roleOf(quantity: PlanQuantity): SuvatRole | null {
  for (const role of ROLES) {
    if (ROLE_ALIASES[role].some((alias) => alias === key(quantity.symbol) || alias === key(quantity.id))) return role;
  }
  return null;
}

const ROLE_DIMENSION: Record<SuvatRole, Dimension> = { u: "speed", v: "speed", a: "accel", t: "time", s: "length" };

export function siValue(quantity: PlanQuantity, dimension: Dimension): number | null {
  const unit = normalized(quantity.unit ?? "");
  const entry = UNIT_TABLE.find((candidate) => candidate.dimension === dimension && new RegExp(`^(?:${candidate.pattern})$`, "i").test(unit));
  return entry ? quantity.value * entry.factor : null;
}

/** A plan given is source-bound when its quote is in the question and states its value. */
export function sourceBound(quantity: PlanQuantity, text: string): boolean {
  if (quantity.origin === "derived") return false;
  if (!quantity.sourceText) return false;
  const quote = normalized(quantity.sourceText);
  if (!quote || !text.includes(quote)) return false;
  if (quantity.value === 0) return STARTS_AT_REST.test(quote) || ENDS_AT_REST.test(quote) || /(?:^|[^\d.])0(?:\.0+)?(?![\d.])/.test(quote);
  return [...quote.matchAll(new RegExp(STEM_NUMBER, "g"))].some((match) => {
    const stated = parseStemNumber(match[1]!);
    return stated !== null && agrees(Math.abs(quantity.value), Math.abs(stated));
  });
}

const VT_GRAPH = /\b(?:velocity-?\s?time|v-t) (?:graph|curve|plot)\b/i;

export interface SuvatSlots {
  knowns: Knowns;
  sources: Partial<Record<SuvatRole, SlotSource>>;
  claims: Knowns;
}

/** Merge stem and source-bound plan givens; any disagreement reads nothing. */
export function suvatSlots(stem: string, plan: readonly PlanQuantity[]): SuvatSlots | { conflict: string } {
  const text = normalized(stem);
  const decelerating = DECELERATION.test(text);
  const knowns = stemKnowns(stem);
  const sources: Partial<Record<SuvatRole, SlotSource>> = {};
  for (const role of ROLES) if (knowns[role] !== undefined) sources[role] = "stem";
  const claims: Knowns = {};
  for (const quantity of plan) {
    const role = roleOf(quantity);
    if (!role) continue;
    let value = siValue(quantity, ROLE_DIMENSION[role]);
    if (value === null) continue;
    if (role === "a" && value > 0 && (decelerating || /decel|retard/i.test(`${quantity.id} ${quantity.symbol}`))) value = -value;
    if (sourceBound(quantity, text)) {
      const existing = knowns[role];
      if (existing !== undefined && !agrees(existing, value)) return { conflict: `${role}: question ${existing} vs plan given ${value}` };
      knowns[role] = value;
      sources[role] = "plan";
    } else if (claims[role] === undefined) {
      claims[role] = value;
    }
  }
  return { knowns, sources, claims };
}

/** Detection hook: fills the slots only for a resolvable, consistent interval. */
export function extractSuvatSlots(stem: string, plan: readonly PlanQuantity[], bag: SlotBag, set: (bag: SlotBag, key: string, value: number | string, source: SlotSource) => void): void {
  const slots = suvatSlots(stem, plan);
  if ("conflict" in slots) return;
  const resolved = resolveConstantAcceleration(slots.knowns, slots.claims);
  if (!resolved.ok) return;
  // Computed roles inherit the weakest source of the knowns they came from.
  const computedSource: SlotSource = ROLES.some((role) => slots.sources[role] === "stem") ? "stem" : "plan";
  for (const role of ROLES) set(bag, role, resolved.state[role], slots.sources[role] ?? computedSource);
  set(bag, "state", "resolved", "stem");
}

/* ------------------------------------------------------------------------- */
/* Figure                                                                     */
/* ------------------------------------------------------------------------- */

function displayFactor(xSpan: number, yMin: number, yMax: number): number {
  const ySpan = Math.max(yMax - yMin, 1e-9);
  const ratio = ySpan / Math.max(xSpan, 1e-9);
  if (ratio > 1.4) return (xSpan * 0.7) / ySpan;
  if (ratio < 0.3) return (xSpan * 0.45) / ySpan;
  return 1;
}

const label = (symbol: string, value: number, unit: string) => `${symbol} = ${fmt(value)} ${unit}`;

function uniformAccelerationVt(context: GeneratorContext) {
  const [u, v, a, t, s] = (["u", "v", "a", "t", "s"] as const).map((role) => maybeNum(context, role));
  if (u === null || v === null || a === null || t === null || s === null) return null;
  // Re-check the interval from the slots themselves: a generator must not
  // draw a state it did not resolve.
  const check = resolveConstantAcceleration({ u, a, t }, { v, s });
  if (!check.ok) return null;
  const k = displayFactor(t, 0, Math.max(u, v));
  const top = Math.max(u, v) * k;
  const span = Math.max(top, 1e-6);
  const scene = new SceneBuilder(context.question, "velocity-time graph of one constant-acceleration interval", "uniform_acceleration_vt");
  scene.quantity("q_u", "u", u, "m/s");
  scene.quantity("q_v", "v", v, "m/s");
  scene.quantity("q_a", "a", a, "m/s^2");
  scene.quantity("q_t", "t", t, "s");
  scene.quantity("q_s", "s", s, "m");
  scene.axes("axes", -0.06 * t, 1.18 * t, -0.12 * span, top + 0.22 * span, "v-t axes", "v-t");
  scene.curve("graph", `${u * k} + ${a * k}*x`, 0, t, "velocity v(t) = u + a t", label("a", a, "m/s^2"), 17);
  scene.curve("zero", "0", 0, t, "time axis under the area", undefined, 17);
  scene.region("area", "graph", "zero", "area under the v-t graph = displacement", 0, t);
  scene.point("start", { x: 0, y: u * k }, "initial velocity on the graph", label("u", u, "m/s"));
  scene.point("end", { x: t, y: v * k }, "final velocity on the graph", label("v", v, "m/s"));
  scene.point("foot", { x: t, y: 0 }, "end of the interval on the time axis", label("t", t, "s"));
  if (v > 1e-9) scene.segment("drop", "end", "foot", "ordinate at the end of the interval");
  scene.labelAt("s_label", { x: t / 2, y: Math.max(u, v) * k * 0.3 }, "displacement as the area", label("s", s, "m"));
  scene.assert("u_on_graph", "function_value", ["graph"], { x: 0, y: Number((u * k).toFixed(6)) });
  scene.assert("v_on_graph", "function_value", ["graph"], { x: Number(t.toFixed(6)), y: Number((v * k).toFixed(6)) });
  scene.labelled("axes", "start", "end", "foot");
  scene.group("axes_group", ["axes"], "velocity on the vertical axis, time on the horizontal");
  scene.group("graph_group", ["graph", "start", "end", "foot", ...(v > 1e-9 ? ["drop"] : [])], "a straight line from u to v whose slope is the acceleration", ["axes_group"]);
  scene.group("area_group", ["zero", "area", "s_label"], "the area under the line is the displacement", ["graph_group"]);
  return scene.build();
}

export const CONSTANT_ACCELERATION_GENERATORS: GeneratorTable = {
  uniform_acceleration_vt: uniformAccelerationVt,
};

/* ------------------------------------------------------------------------- */
/* Vertical motion slots (free_fall archetype)                                */
/* ------------------------------------------------------------------------- */

const HEIGHT_ALIASES = ["h", "height", "hmax", "maxheight", "maximumheight", "H"].map(key);
const SPEED_ALIASES = ["u", "v0", "u0", "initialspeed", "initialvelocity", "speed"].map(key);
const GRAVITY_ALIASES = ["g", "gravity", "accelerationduetogravity"].map(key);

function aliasOf(quantity: PlanQuantity, aliases: readonly string[]): boolean {
  return aliases.includes(key(quantity.symbol)) || aliases.includes(key(quantity.id));
}

/**
 * Height and launch speed for a body dropped or thrown vertically. A drop
 * labels the one stated length; an upward throw labels H = u^2 / (2g) only
 * when u and g are both stated. Plan derived values are compared, never
 * drawn; a disagreement sets `conflict` and the generator declines.
 */
export function extractFreeFallSlots(stem: string, plan: readonly PlanQuantity[], bag: SlotBag, set: (bag: SlotBag, key: string, value: number | string, source: SlotSource) => void): void {
  const text = normalized(stem);
  const up = /thrown (?:vertically )?up/i.test(text);
  set(bag, "direction", up ? "up" : "down", "stem");
  const found = tokens(text);
  const givens = plan.filter((quantity) => sourceBound(quantity, text));
  const claims = plan.filter((quantity) => quantity.origin === "derived");
  const pick = (aliases: readonly string[], dimension: Dimension): { value: number; source: SlotSource } | null => {
    const quantity = givens.find((candidate) => aliasOf(candidate, aliases));
    const value = quantity ? siValue(quantity, dimension) : null;
    return value === null ? null : { value: Math.abs(value), source: "plan" };
  };
  const speeds = found.filter((token) => token.dimension === "speed");
  const lengths = found.filter((token) => token.dimension === "length");
  const accels = found.filter((token) => token.dimension === "accel");
  const u = pick(SPEED_ALIASES, "speed") ?? (/thrown/i.test(text) && speeds.length === 1 ? { value: speeds[0]!.value, source: "stem" as const } : null);
  const g = pick(GRAVITY_ALIASES, "accel") ?? (accels.length === 1 ? { value: Math.abs(accels[0]!.value), source: "stem" as const } : null);
  let h: { value: number; source: SlotSource } | null = null;
  if (up) {
    // The drawn height is the highest point; only u and g fix it.
    if (u && g && g.value > 0 && lengths.length === 0) {
      h = { value: u.value * u.value / (2 * g.value), source: u.source === "plan" && g.source === "plan" ? "plan" : "stem" };
    }
  } else {
    h = pick(HEIGHT_ALIASES, "length") ?? (lengths.length === 1 ? { value: lengths[0]!.value, source: "stem" as const } : null);
  }
  const disagrees = (aliases: readonly string[], dimension: Dimension, value: number) => claims.some((claim) => {
    if (!aliasOf(claim, aliases)) return false;
    const claimed = siValue(claim, dimension);
    return claimed !== null && !agrees(Math.abs(claimed), value);
  });
  if ((h && disagrees(HEIGHT_ALIASES, "length", h.value)) || (u && disagrees(SPEED_ALIASES, "speed", u.value))) {
    set(bag, "conflict", "plan value disagrees with the source-bound state", "stem");
    return;
  }
  if (h) set(bag, "h", h.value, h.source);
  if (u) set(bag, "u", u.value, u.source);
}
