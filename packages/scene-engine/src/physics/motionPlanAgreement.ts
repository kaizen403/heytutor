/**
 * Plan numbers that narration will speak must agree with the source figure.
 *
 * Relative motion and river crossing figures compute their values from the
 * question. A turn plan quantity of the same physical dimension (velocity,
 * time, length, angle) that matches none of those values is stale or wrong;
 * the caller then withholds the figure so the student never hears one number
 * while seeing another. Units are converted; signs must agree unless the
 * plan states a positive magnitude.
 */
import { motionRationalNumber, relativeMotionSource, type RelativeMotionSource } from "./relativeMotionSource";
import { STEM_NUMBER, parseStemNumber } from "../archetypes/slots";

export type MotionDimension = "velocity" | "time" | "length" | "angle";

export interface MotionPlanConflict {
  id: string;
  symbol: string;
  value: number;
  unit: string;
  dimension: MotionDimension;
}

export type MotionValues = Partial<Record<MotionDimension, number[]>>;

const UNITS: ReadonlyArray<readonly [RegExp, MotionDimension, number]> = [
  [/^(?:m\/s|ms\^?-1|ms⁻¹|m\s*s\^?-1|m\s*s⁻¹|metres?\/s|meters?\/s|m\/sec)$/i, "velocity", 1],
  [/^(?:km\/h|km\/hr|kmph|kmh|km\s*h\^?-1|km\s*h⁻¹|kmh\^?-1|km\/hour)$/i, "velocity", 1000 / 3600],
  [/^(?:s|sec|secs|second|seconds)$/i, "time", 1],
  [/^(?:min|mins|minute|minutes)$/i, "time", 60],
  [/^(?:h|hr|hrs|hour|hours)$/i, "time", 3600],
  [/^(?:m|metre|metres|meter|meters)$/i, "length", 1],
  [/^(?:km|kilometre|kilometres|kilometer|kilometers)$/i, "length", 1000],
  [/^(?:cm)$/i, "length", 0.01],
  [/^(?:°|deg|degree|degrees)$/i, "angle", 1],
  [/^(?:rad|radian|radians)$/i, "angle", 180 / Math.PI],
];

function measured(unit: unknown): { dimension: MotionDimension; factor: number } | null {
  if (typeof unit !== "string") return null;
  const text = unit.trim().replace(/\s+/g, " ");
  for (const [pattern, dimension, factor] of UNITS) if (pattern.test(text)) return { dimension, factor };
  return null;
}

function rows(turnPlan: unknown): Array<Record<string, unknown> & { given: boolean }> {
  if (typeof turnPlan !== "object" || turnPlan === null) return [];
  const plan = turnPlan as Record<string, unknown>;
  const list = (value: unknown, given: boolean) => (Array.isArray(value) ? value : [])
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({ ...row, given }));
  return [...list(plan.givens, true), ...list(plan.derived, false)];
}

/** Relative tolerance covers a plan that rounds to three significant figures. */
function agrees(value: number, allowed: readonly number[], dimension: MotionDimension, magnitude = true): boolean {
  return allowed.some((candidate) => {
    const tolerance = Math.max(5e-3 * Math.abs(candidate), 1e-9);
    if (Math.abs(value - candidate) <= tolerance) return true;
    // A positive plan speed may describe a signed velocity component; a time
    // or position keeps its sign (a past root is not a future meeting).
    return magnitude && dimension === "velocity" && value > 0 && Math.abs(value - Math.abs(candidate)) <= tolerance;
  });
}

/**
 * `question`: a plan given that copies a number stated in the question (a
 * stated heading, a distance the figure does not model) is source, not stale.
 */
export function motionPlanConflicts(turnPlan: unknown, values: MotionValues, question = "", bound: MotionBindings = new Map()): MotionPlanConflict[] {
  const conflicts: MotionPlanConflict[] = [];
  const stated = new Set([...question.matchAll(new RegExp(STEM_NUMBER, "g"))].flatMap((match) => {
    const value = parseStemNumber(match[1]!);
    return value === null ? [] : [Math.abs(value)];
  }));
  for (const row of rows(turnPlan)) {
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
    const unit = measured(row.unit);
    const target = bound.get(motionSymbolKey(row.symbol)) ?? bound.get(motionSymbolKey(row.id));
    if (target && (!unit || target.dimension !== unit.dimension)) {
      // A velocity named vAB cannot become a time just because its number
      // also equals the encounter time. No conversion can repair that type.
      conflicts.push({ id: String(row.id ?? ""), symbol: String(row.symbol ?? ""), value: row.value, unit: String(row.unit), dimension: target.dimension });
      continue;
    }
    // A named role has exactly its own value, even when the wrong value is
    // another body's speed or a literal elsewhere in the source question.
    const named = unit && target?.dimension === unit.dimension ? target : null;
    if (!named && row.given && stated.has(Math.abs(row.value))) continue;
    const allowed = named ? [named.si] : unit ? values[unit.dimension] : undefined;
    if (!unit || !allowed) continue;
    const si = row.value * unit.factor;
    if (!agrees(si, allowed, unit.dimension, !named?.signed)) {
      conflicts.push({ id: String(row.id ?? ""), symbol: String(row.symbol ?? ""), value: row.value, unit: String(row.unit), dimension: unit.dimension });
    }
  }
  return conflicts;
}

/** Every velocity, time and length the relative-motion figure and its arithmetic imply, SI. */
export function relativeMotionValues(source: RelativeMotionSource): MotionValues {
  const num = motionRationalNumber;
  const a = source.subject; const b = source.reference; const o = source.observer;
  const vA = num(a.v); const vB = num(b.v); const vAB = num(source.relativeVelocity);
  const xA = num(a.x0); const xB = num(b.x0);
  const velocity = [vA, vB, vAB, -vAB, 0];
  const length = [xA, xB, Math.abs(xB - xA)];
  const time: number[] = [];
  if (o) velocity.push(num(o.v), vA - num(o.v), vB - num(o.v), num(o.v) - vA, num(o.v) - vB);
  if (o) length.push(num(o.x0));
  const encounter = source.encounter;
  if (encounter.kind === "future" || encounter.kind === "initial") {
    const t = num(encounter.time); const x = num(encounter.position);
    time.push(t);
    length.push(x, Math.abs(x - xA), Math.abs(x - xB), Math.abs(vA) * t, Math.abs(vB) * t);
    if (o) length.push(x - (num(o.x0) + num(o.v) * t));
  } else if (encounter.kind === "past_root") {
    time.push(num(encounter.algebraicTime));
  }
  return { velocity, time, length };
}

export function relativeMotionPlanConflicts(source: RelativeMotionSource, turnPlan: unknown, question = ""): MotionPlanConflict[] {
  return judgedRelativeConflicts(source, turnPlan, question);
}

export interface MotionQuantityCorrection {
  quantityId: string;
  symbol: string;
  previous: number;
  corrected: number;
  unit: string;
}

/**
 * Source quantity authority for one topic (registered in
 * ir/sourceQuantityAuthority.ts). A plan value that binds by symbol and unit
 * to one source quantity is corrected in the plan's own unit; a value of a
 * judged class that binds to nothing and equals no source value is withdrawn
 * from givens, derived values and unknowns, so narration never states it;
 * `unbound` lists conflicts that remain after that (none for these topics,
 * kept for the seam's decline flag).
 */
export interface MotionQuantityAuthority {
  plan: unknown;
  corrections: MotionQuantityCorrection[];
  withdrawn: MotionPlanConflict[];
  unbound: MotionPlanConflict[];
  reasons: string[];
}

export type MotionBindings = ReadonlyMap<string, { dimension: MotionDimension; si: number; signed?: boolean }>;

export const motionSymbolKey = (value: unknown) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\\(?:mathrm|text)/g, "").replace(/[^a-z0-9]/g, "");

export function motionUnitFactor(unit: unknown): { dimension: MotionDimension; factor: number } | null {
  return measured(unit);
}

/** Applies corrections and withdrawals to a copy of the plan; the input is not mutated. */
export function applyMotionQuantityCorrections<T>(turnPlan: T, corrections: readonly MotionQuantityCorrection[], withdrawn: readonly { id: string }[] = []): T {
  if ((corrections.length === 0 && withdrawn.length === 0) || typeof turnPlan !== "object" || turnPlan === null) return turnPlan;
  const byId = new Map(corrections.map((correction) => [correction.quantityId, correction]));
  const gone = new Set(withdrawn.map((entry) => entry.id));
  const plan = turnPlan as Record<string, unknown>;
  const fix = (rows: unknown) => Array.isArray(rows)
    ? rows.flatMap((row) => {
        const id = typeof row === "object" && row !== null ? String((row as Record<string, unknown>).id) : "";
        if (gone.has(id)) return [];
        const correction = byId.get(id);
        return [correction ? { ...(row as Record<string, unknown>), value: correction.corrected, sourceText: `Source-verified ${correction.symbol} = ${correction.corrected} ${correction.unit}` } : row];
      })
    : rows;
  return { ...plan, givens: fix(plan.givens), derived: fix(plan.derived), unknowns: fix(plan.unknowns) } as T;
}

/**
 * `unjudged`: dimensions whose unbound values are left alone (a relative
 * motion plan may state an intermediate distance the figure does not model).
 */
export function motionQuantityAuthority(question: string, turnPlan: unknown, conflicts: readonly MotionPlanConflict[], bound: MotionBindings, unjudged: readonly MotionDimension[] = []): MotionQuantityAuthority {
  const corrections: MotionQuantityCorrection[] = [];
  const withdrawn: MotionPlanConflict[] = [];
  const reasons: string[] = [];
  for (const conflict of conflicts) {
    const unit = measured(conflict.unit);
    const target = bound.get(motionSymbolKey(conflict.symbol)) ?? bound.get(motionSymbolKey(conflict.id));
    if (unit && target && target.dimension === unit.dimension) {
      if (corrections.some((correction) => correction.quantityId === conflict.id)) continue;
      const corrected = Number((target.si / unit.factor).toPrecision(12));
      corrections.push({ quantityId: conflict.id, symbol: conflict.symbol, previous: conflict.value, corrected, unit: conflict.unit });
      reasons.push(`${conflict.symbol}: ${conflict.value} -> ${corrected} ${conflict.unit} (source)`);
    } else if (target || !unjudged.includes(conflict.dimension)) {
      withdrawn.push(conflict);
      reasons.push(target
        ? `${conflict.symbol}=${conflict.value} ${conflict.unit} has an unsupported unit or a dimension inconsistent with its source role: withdrawn`
        : `${conflict.symbol}=${conflict.value} ${conflict.unit} equals no source value and binds to none: withdrawn`);
    }
  }
  return { plan: applyMotionQuantityCorrections(turnPlan, corrections, withdrawn), corrections, withdrawn, unbound: [], reasons };
}

/** Symbols that bind without doubt to one relative-motion quantity. */
export function relativeMotionBindings(source: RelativeMotionSource): MotionBindings {
  const a = source.subject.name.toLowerCase(); const b = source.reference.name.toLowerCase();
  const vAB = motionRationalNumber(source.relativeVelocity);
  const bound = new Map<string, { dimension: MotionDimension; si: number; signed?: boolean }>();
  bound.set(`v${a}${b}`, { dimension: "velocity", si: vAB, signed: true });
  for (const name of ["vrel", "vrelative"]) bound.set(name, { dimension: "velocity", si: vAB });
  bound.set(`v${b}${a}`, { dimension: "velocity", si: -vAB, signed: true });
  bound.set(`v${a}`, { dimension: "velocity", si: motionRationalNumber(source.subject.v) });
  bound.set(`v${b}`, { dimension: "velocity", si: motionRationalNumber(source.reference.v) });
  bound.set(`v${a}ms`, { dimension: "velocity", si: motionRationalNumber(source.subject.v) });
  bound.set(`v${b}ms`, { dimension: "velocity", si: motionRationalNumber(source.reference.v) });
  if (source.observer) {
    const o = source.observer.name.toLowerCase(); const vO = motionRationalNumber(source.observer.v);
    bound.set(`v${o}`, { dimension: "velocity", si: vO });
    for (const body of [source.subject, source.reference]) {
      const name = body.name.toLowerCase(); const relative = motionRationalNumber(body.v) - vO;
      bound.set(`v${name}${o}`, { dimension: "velocity", si: relative, signed: true });
      bound.set(`v${o}${name}`, { dimension: "velocity", si: -relative, signed: true });
    }
  }
  const encounter = source.encounter;
  if (encounter.kind === "future" || encounter.kind === "initial") {
    const time = motionRationalNumber(encounter.time);
    for (const actor of [source.subject, source.reference]) {
      const name = actor.name.toLowerCase();
      const distance = Math.abs(motionRationalNumber(actor.v)) * time;
      for (const key of [`d${name}`, `s${name}`, `distance${name}`]) bound.set(key, { dimension: "length", si: distance });
    }
    for (const name of ["t", "tmeet", "tmeeting", "tencounter", "tcatch", "tcatchup", "tovertake", "tm"]) bound.set(name, { dimension: "time", si: motionRationalNumber(encounter.time) });
    for (const name of ["xmeet", "xmeeting", "xencounter", "xm"]) bound.set(name, { dimension: "length", si: motionRationalNumber(encounter.position) });
  }
  return bound;
}

/** Relative-motion conflicts the figure judges: lengths only when their symbol binds. */
function judgedRelativeConflicts(source: RelativeMotionSource, turnPlan: unknown, question: string): MotionPlanConflict[] {
  const bound = relativeMotionBindings(source);
  return motionPlanConflicts(turnPlan, relativeMotionValues(source), question, bound)
    .filter((conflict) => conflict.dimension !== "length" || bound.has(motionSymbolKey(conflict.symbol)) || bound.has(motionSymbolKey(conflict.id)));
}

export function applyRelativeMotionAuthority(question: string, turnPlan: unknown): MotionQuantityAuthority | null {
  const admission = relativeMotionSource(question);
  if (admission?.status !== "admitted") return null;
  return motionQuantityAuthority(question, turnPlan, judgedRelativeConflicts(admission.source, turnPlan, question), relativeMotionBindings(admission.source));
}
