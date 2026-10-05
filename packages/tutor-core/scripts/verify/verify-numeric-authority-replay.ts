/**
 * Offline numeric-authority regression gate. No server, no LLM, no network.
 *
 * Replays every captured turn-plan lane response (56 JEE/NEET numeric
 * questions, 2 rounds, primary + alternate lanes, plus the retry lane when
 * both failed) through the real post-HTTP path of `planTurnV3`
 * (`parseTurnPlanV3Content`: normalize, explicit-arithmetic reconcile,
 * validate with claim checks, optics law audit, minimum visual requirement),
 * then lane selection via `selectTurnPlanV3Consensus` in arrival order, then
 * the `createFallbackTurnPlanV3` fallback when nothing parses. The selected
 * plan's asked unknown is scored against the hand-written truth in
 * fixtures/numeric-authority/truth.py.
 *
 * Usage:
 *   tsx scripts/verify/verify-numeric-authority-replay.ts           report only, exit 0
 *   tsx scripts/verify/verify-numeric-authority-replay.ts --assert  enforce thresholds.json, exit 1 on regression
 *   add --verbose to list every changed or failing case.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import {
  createFallbackTurnPlanV3,
  parseTurnPlanV3Content,
  selectTurnPlanV3Consensus,
  type TurnPlanV3ParseTrace,
} from "../../src/planners/turnPlannerV3";

interface Question {
  id: string;
  topic: string;
  question: string;
  unknown: string;
  unit: string;
  truth: number;
  tol: number;
  absOk: boolean;
}

interface LaneFixture {
  id: string;
  round: number;
  lane: "primary" | "alternate" | "retry";
  /** Response time; only used to replay arrival order into the consensus. */
  ms: number;
  raw: string;
}

interface Thresholds {
  max: Record<string, number>;
  min: Record<string, number>;
}

type LoosePlan = {
  unknowns?: Array<{ id?: unknown; unit?: unknown }>;
  derived?: Array<{ id?: unknown; value?: unknown; unit?: unknown }>;
} | null | undefined;

type Verdict = "correct" | "wrong" | "missing";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "numeric-authority");
const assertMode = process.argv.includes("--assert");
const verbose = process.argv.includes("--verbose");

function readJsonl<T>(name: string): T[] {
  return readFileSync(join(FIXTURES, name), "utf8").trim().split("\n").map((line) => JSON.parse(line) as T);
}

// ---------------------------------------------------------------------------
// Scoring (ported from the study's score.py; it is the oracle, not the pipeline)
// ---------------------------------------------------------------------------

const UNITS: Record<string, [string, number]> = {
  m: ["L", 1], cm: ["L", 1e-2], mm: ["L", 1e-3], km: ["L", 1e3], nm: ["L", 1e-9], "å": ["L", 1e-10], angstrom: ["L", 1e-10],
  s: ["T", 1], sec: ["T", 1], min: ["T", 60], h: ["T", 3600], hr: ["T", 3600],
  "m/s": ["V", 1], "km/s": ["V", 1e3], "cm/s": ["V", 1e-2], "km/h": ["V", 1 / 3.6], "mm/s": ["V", 1e-3],
  "m/s^2": ["A", 1], "m/s2": ["A", 1], "m/s²": ["A", 1], "ms^-2": ["A", 1], "ms-2": ["A", 1],
  n: ["F", 1], kn: ["F", 1e3],
  j: ["E", 1], mj: ["E", 1e-3], kj: ["E", 1e3], uj: ["E", 1e-6], ev: ["E", 1.602176634e-19],
  w: ["P", 1], kw: ["P", 1e3],
  pa: ["Pr", 1], kpa: ["Pr", 1e3], "n/m^2": ["Pr", 1], "n/m2": ["Pr", 1], "n/m²": ["Pr", 1], atm: ["Pr", 101325],
  deg: ["Ang", Math.PI / 180], "°": ["Ang", Math.PI / 180], degree: ["Ang", Math.PI / 180], degrees: ["Ang", Math.PI / 180], rad: ["Ang", 1],
  "kgm^2": ["I", 1], "kg·m^2": ["I", 1], "kgm²": ["I", 1], "kg·m²": ["I", 1], "kg*m^2": ["I", 1],
  nm_torque: ["Tq", 1], "n·m": ["Tq", 1], "n*m": ["Tq", 1],
  c: ["Q", 1], uc: ["Q", 1e-6], mc: ["Q", 1e-3], nc: ["Q", 1e-9],
  a: ["Cur", 1], ma: ["Cur", 1e-3], ua: ["Cur", 1e-6],
  v: ["Volt", 1], mv: ["Volt", 1e-3], kv: ["Volt", 1e3],
  ohm: ["R", 1], ohms: ["R", 1],
  t: ["B", 1], mt: ["B", 1e-3], ut: ["B", 1e-6], g_gauss: ["B", 1e-4],
  hz: ["Hz", 1], khz: ["Hz", 1e3],
  d: ["Pow", 1], dioptre: ["Pow", 1], diopter: ["Pow", 1], dioptres: ["Pow", 1], "m^-1": ["Pow", 1],
  "%": ["Frac", 0.01], percent: ["Frac", 0.01], "1": ["Frac", 1], "": ["Frac", 1], none: ["Frac", 1], dimensionless: ["Frac", 1],
};

function normUnit(unit: unknown): string {
  const u = (typeof unit === "string" && unit.trim() ? unit : "1")
    .trim().toLowerCase().replace(/[µμ]/g, "u").replace(/ /g, "").replace(/ω/g, "ohm");
  if (["n·m", "n*m", "nm_torque", "newton-metre", "newtonmetre"].includes(u)) return "nm_torque";
  return u;
}

function convert(value: number, fromUnit: unknown, truthUnit: string): number | null {
  let from = normUnit(fromUnit);
  let to = normUnit(truthUnit);
  if (truthUnit === "N m") {
    to = "nm_torque";
    if (from === "nm") from = "nm_torque";
  }
  if (truthUnit === "kg m^2") to = "kgm^2";
  if (from === to) return value;
  const f = UNITS[from];
  const t = UNITS[to];
  if (f && t && f[0] === t[0]) return (value * f[1]) / t[1];
  return null;
}

/** Manual asked-unknown choice where a plan lists several compatible unknowns. */
const ASKED_OVERRIDE: Record<string, string> = { op3: "d" };

function askedValue(plan: LoosePlan, q: Question): number | null {
  const unknowns = Array.isArray(plan?.unknowns) ? plan.unknowns : [];
  if (unknowns.length === 0) return null;
  let asked = unknowns.length === 1 ? unknowns[0] : undefined;
  if (!asked && ASKED_OVERRIDE[q.id]) asked = unknowns.find((u) => u.id === ASKED_OVERRIDE[q.id]);
  if (!asked && unknowns.length > 1) {
    const compatible = unknowns.filter((u) => convert(1, u.unit, q.unit) !== null);
    if (compatible.length === 1) asked = compatible[0];
  }
  if (!asked) return null;
  const derived = (Array.isArray(plan?.derived) ? plan.derived : []).find((d) => d.id === asked.id);
  if (!derived || typeof derived.value !== "number" || !Number.isFinite(derived.value)) return null;
  return convert(derived.value, derived.unit, q.unit) ?? derived.value;
}

function verdict(value: number | null, q: Question): Verdict {
  if (value === null) return "missing";
  const v = q.absOk ? Math.abs(value) : value;
  return Math.abs(v - q.truth) <= q.tol * Math.max(Math.abs(q.truth), 1e-12) ? "correct" : "wrong";
}

function changed(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > 1e-6 * Math.max(Math.abs(a), Math.abs(b), 1e-12);
}

function transition(before: Verdict, after: Verdict): "rightToWrong" | "wrongToRight" | "neutral" {
  if (before === "correct" && after !== "correct") return "rightToWrong";
  if (before !== "correct" && after === "correct") return "wrongToRight";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

const questions = new Map(readJsonl<Question>("questions.jsonl").map((q) => [q.id, q]));
const lanes = readJsonl<LaneFixture>("lanes.jsonl");
const thresholds = JSON.parse(readFileSync(join(FIXTURES, "thresholds.json"), "utf8")) as Thresholds;

const turns = new Map<string, LaneFixture[]>();
for (const lane of lanes) {
  const key = `${lane.id}#${lane.round}`;
  turns.set(key, [...(turns.get(key) ?? []), lane]);
}

const rejectedByCode = new Map<string, number>();
const issueOccurrences = new Map<string, number>();
const rejectedLanes: string[] = [];
const fallbackTurns: string[] = [];
const asked: Record<Verdict, string[]> = { correct: [], wrong: [], missing: [] };
const arithmetic = {
  rightToWrong: [] as string[], wrongToRight: [] as string[], neutral: [] as string[],
  reconciliations: 0, acceptedLanes: { rightToWrong: 0, wrongToRight: 0, neutral: 0 },
};
const optics = {
  rightToWrong: [] as string[], wrongToRight: [] as string[], neutral: [] as string[], corrections: 0, lanes: 0,
  /** Corrected quantities sharing the asked dimension, scored against truth even when not the asked one. */
  quantityRightToWrong: [] as string[],
};
let laneCount = 0;

function replayLane(lane: LaneFixture, q: Question): TurnPlanV3 | null {
  laneCount += 1;
  const tag = `${lane.id} r${lane.round} ${lane.lane}`;
  const trace: TurnPlanV3ParseTrace = {};
  const plan = parseTurnPlanV3Content(lane.raw, q.question, trace);

  if (!plan) {
    const codes = trace.parseError || !trace.issues
      ? ["parse_error"]
      : [...new Set(trace.issues.map((issue) => issue.code))];
    for (const code of codes) rejectedByCode.set(code, (rejectedByCode.get(code) ?? 0) + 1);
    for (const issue of trace.issues ?? []) {
      issueOccurrences.set(issue.code, (issueOccurrences.get(issue.code) ?? 0) + 1);
    }
    rejectedLanes.push(`${tag}: ${codes.join(",")}`);
  }

  const arith = trace.arithmetic;
  if (arith && arith.reconciliations.length > 0) {
    arithmetic.reconciliations += arith.reconciliations.length;
    const before = askedValue(trace.normalized as LoosePlan, q);
    const after = askedValue(arith.plan as LoosePlan, q);
    if (changed(before, after)) {
      const kind = transition(verdict(before, q), verdict(after, q));
      if (plan) arithmetic.acceptedLanes[kind] += 1;
      arithmetic[kind].push(`${tag}: ${before} -> ${after} (truth ${q.truth} ${q.unit}${plan ? "" : ", lane rejected"})`);
    }
  }

  if (trace.optics && trace.optics.corrections.length > 0) {
    optics.lanes += 1;
    optics.corrections += trace.optics.corrections.length;
    const before = askedValue(trace.preOptics, q);
    const after = askedValue(trace.optics.plan, q);
    const kind = changed(before, after) ? transition(verdict(before, q), verdict(after, q)) : "neutral";
    optics[kind].push(`${tag}: ${before} -> ${after} (truth ${q.truth} ${q.unit}; ${trace.optics.corrections
      .map((c) => `${c.lawId} ${c.quantityId} ${c.previousValue}->${c.correctedValue}`).join("; ")})`);
    for (const correction of trace.optics.corrections) {
      const quantity = trace.optics.plan.derived.find((item) => item.id === correction.quantityId);
      const previous = convert(correction.previousValue, quantity?.unit, q.unit);
      const corrected = convert(correction.correctedValue, quantity?.unit, q.unit);
      if (previous === null || corrected === null) continue;
      if (transition(verdict(previous, q), verdict(corrected, q)) === "rightToWrong") {
        optics.quantityRightToWrong.push(`${tag}: ${correction.lawId} ${correction.quantityId} ${correction.previousValue} -> ${correction.correctedValue} ${quantity?.unit ?? ""} (truth ${q.truth} ${q.unit})`);
      }
    }
  }
  return plan;
}

for (const [key, turnLanes] of turns) {
  const q = questions.get(turnLanes[0]!.id);
  if (!q) throw new Error(`no question for ${key}`);
  // Both lanes start together; planTurnV3 collects them in arrival order.
  const parallel = turnLanes.filter((lane) => lane.lane !== "retry").sort((a, b) => a.ms - b.ms);
  const completed = parallel
    .map((lane) => replayLane(lane, q))
    .filter((plan): plan is TurnPlanV3 => plan !== null);
  let selected: TurnPlanV3 | null;
  if (completed.length > 0) {
    selected = selectTurnPlanV3Consensus(null, completed[0], completed.slice(1)) ?? completed[0]!;
  } else {
    // planTurnV3 issues one corrected retry when every parallel lane failed.
    const retry = turnLanes.find((lane) => lane.lane === "retry");
    selected = retry ? replayLane(retry, q) : null;
  }
  if (!selected) {
    fallbackTurns.push(key);
    selected = createFallbackTurnPlanV3(q.question);
  }
  const value = askedValue(selected, q);
  asked[verdict(value, q)].push(`${key}: ${value} (truth ${q.truth} ${q.unit})`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const metrics: Record<string, number> = {
  lanes: laneCount,
  turns: turns.size,
  lanesRejected: rejectedLanes.length,
  claimQuantityMismatchLanes: rejectedByCode.get("claim_quantity_mismatch") ?? 0,
  fallbackTurns: fallbackTurns.length,
  askedCorrect: asked.correct.length,
  askedWrong: asked.wrong.length,
  askedMissing: asked.missing.length,
  arithmeticChangedAsked: arithmetic.rightToWrong.length + arithmetic.wrongToRight.length + arithmetic.neutral.length,
  arithmeticRightToWrong: arithmetic.rightToWrong.length,
  arithmeticWrongToRight: arithmetic.wrongToRight.length,
  opticsCorrectedLanes: optics.lanes,
  opticsRightToWrong: optics.rightToWrong.length,
  opticsWrongToRight: optics.wrongToRight.length,
  opticsQuantityRightToWrong: optics.quantityRightToWrong.length,
};

const list = (label: string, items: string[], always = false) => {
  if (items.length === 0 || (!verbose && !always)) return;
  console.log(`  ${label}:`);
  for (const item of items) console.log(`    ${item}`);
};

console.log(`numeric authority replay: ${metrics.turns} turns, ${metrics.lanes} lanes`);
console.log(`lanes rejected: ${metrics.lanesRejected}`);
for (const [code, count] of [...rejectedByCode].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code}: ${count} lanes (${issueOccurrences.get(code) ?? count} issues)`);
}
list("rejected", rejectedLanes);
console.log(`turns on fallback plan: ${metrics.fallbackTurns}${fallbackTurns.length ? ` (${fallbackTurns.join(", ")})` : ""}`);
console.log(`asked values: correct ${metrics.askedCorrect}, wrong ${metrics.askedWrong}, missing ${metrics.askedMissing}`);
list("wrong", asked.wrong, true);
list("missing", asked.missing);
console.log(`explicit-arithmetic reconcile: ${arithmetic.reconciliations} values rewritten; asked value changed in ${metrics.arithmeticChangedAsked} lanes: right->wrong ${metrics.arithmeticRightToWrong}, wrong->right ${metrics.arithmeticWrongToRight}, neutral ${arithmetic.neutral.length}`);
const accepted = arithmetic.acceptedLanes;
console.log(`  in accepted lanes only: changed ${accepted.rightToWrong + accepted.wrongToRight + accepted.neutral}: right->wrong ${accepted.rightToWrong}, wrong->right ${accepted.wrongToRight}, neutral ${accepted.neutral}`);
list("right->wrong", arithmetic.rightToWrong, true);
list("wrong->right", arithmetic.wrongToRight);
list("neutral", arithmetic.neutral);
console.log(`optics law reconcile: ${optics.corrections} corrections in ${optics.lanes} lanes: right->wrong ${metrics.opticsRightToWrong}, wrong->right ${metrics.opticsWrongToRight}, neutral ${optics.neutral.length}`);
list("right->wrong", optics.rightToWrong, true);
console.log(`  corrected quantity in the asked dimension moved right->wrong: ${metrics.opticsQuantityRightToWrong}`);
list("quantity right->wrong", optics.quantityRightToWrong, true);
list("wrong->right", optics.wrongToRight);
list("neutral", optics.neutral);

if (assertMode) {
  const failures: string[] = [];
  for (const [name, limit] of Object.entries(thresholds.max)) {
    if (!(name in metrics)) failures.push(`unknown threshold metric ${name}`);
    else if (metrics[name]! > limit) failures.push(`${name} = ${metrics[name]} exceeds max ${limit}`);
  }
  for (const [name, limit] of Object.entries(thresholds.min)) {
    if (!(name in metrics)) failures.push(`unknown threshold metric ${name}`);
    else if (metrics[name]! < limit) failures.push(`${name} = ${metrics[name]} below min ${limit}`);
  }
  if (failures.length > 0) {
    console.error(`numeric authority replay FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("numeric authority replay: thresholds hold");
}
