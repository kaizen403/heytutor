/**
 * River crossing: the crossing time the source authority binds when the stem
 * states the boat's heading.
 *
 * "A boat heads straight across" (or "heads due north" across an east flowing
 * river) is where the boat points: the least-time crossing, t = w / v. Main
 * read "straight across" as the straight-across path and rewrote t to the
 * path time w / √(v² − u²). "Wants to head straight across" is an intent: the
 * place the boat should reach, the path time.
 *
 * Between the two, "is made to head", "is steered to head" and "is rowed so
 * as to head" can state either. Per the PR #249 review the source binds no
 * crossing time there and allows none: a plan's t is withdrawn, never
 * rewritten to either crossing.
 *
 * Fixture: fixtures/river-crossing-heading-plans.json, the two recorded turn
 * plans of v3 p2c-t2 (network.jsonl), both with t = 25 s.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-river-heading-time.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TurnPlanV3 } from "../../src";

const engine = process.argv.includes("--compiled-boundary") ? await import("../../dist/index.js") : await import("../../src/index");
const here = dirname(fileURLToPath(import.meta.url));
let checks = 0;
function check(value: unknown, message: string): asserts value { checks += 1; assert.ok(value, message); }

type Raw = Record<string, unknown>;
type Plan = { question: string; givens: Raw[]; derived: Raw[]; unknowns?: Raw[] } & Raw;
function riverPlan(question: string, extras: Array<[string, number, string]>, givens: Array<[string, number, string]>): Plan {
  const quantity = ([symbol, value, unit]: [string, number, string], provenance: string) => ({ id: symbol, symbol, value, unit, provenance });
  return {
    schemaVersion: "turn-plan/v3", subject: "physics", question,
    givens: givens.map((given) => quantity(given, "given")), unknowns: [],
    derived: extras.map((extra) => quantity(extra, "derived")),
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
}
function riverTime(plan: Plan): { t: unknown; corrections: string[]; codes: string[] } {
  const result = engine.applySourceQuantityAuthority(plan as unknown as TurnPlanV3, null, plan.question);
  const outcome = result.outcomes.find((candidate: { topic: string }) => candidate.topic === "physics|2|relative-velocity-in-a-plane");
  const after = result.plan as unknown as Plan;
  return {
    t: [...after.givens, ...after.derived].find((quantity) => quantity.symbol === "t")?.value,
    corrections: (outcome?.corrections ?? []).map((correction: { symbol: string; corrected: number }) => `${correction.symbol}=${correction.corrected}`),
    codes: outcome?.issueCodes ?? [],
  };
}

// ------------------------------------------------------------ recorded plans
const riverPlans = JSON.parse(readFileSync(join(here, "fixtures/river-crossing-heading-plans.json"), "utf8")) as Plan[];
check(riverPlans.length === 2, "two recorded p2c-t2 plans");
for (const [index, plan] of riverPlans.entries()) {
  const result = riverTime(plan);
  check(result.t === 25 && result.corrections.length === 0, `p2c-t2 plan ${index}: heads due north is the least-time crossing; t = 25 s must stand, got ${JSON.stringify(result)}`);
  check(!result.codes.some((code) => /withdrawn|unbound/.test(code)), `p2c-t2 plan ${index}: no value of either crossing is withdrawn: ${result.codes.join(", ")}`);
}
check(engine.riverNormalHeadingStated(riverPlans[0]!.question) && engine.riverShortestPathAsked(riverPlans[0]!.question), "p2c-t2 states the normal heading and asks the straight-across heading");

// ------------------------------------------------------------ the review table
// 120 m wide, boat 5 m/s, current 3 m/s: least time 24 s, straight across 30 s.
const RIVER = [["vb", 5, "m/s"], ["vc", 3, "m/s"], ["w", 120, "m"]] as Array<[string, number, string]>;
const stem = (heading: string) =>
  `A boat that moves at 5 m/s in still water ${heading} a river 120 m wide that flows at 3 m/s. Find the time to cross.`;
for (const [heading, expected] of [
  ["heads straight across", 24],
  ["is directed straight across", 24],
  ["is made to head straight across", null],
  ["is steered to head straight across", null],
  ["is rowed so as to head straight across", null],
  ["wants to head straight across", 30],
] as Array<[string, number | null]>) {
  for (const planned of [24, 30]) {
    const result = riverTime(riverPlan(stem(heading), [["t", planned, "s"]], RIVER));
    if (expected === null) {
      check(result.t === undefined && !result.corrections.some((correction) => correction.startsWith("t=")),
        `"${heading}" with plan t = ${planned}: no crossing time is bound; t is withdrawn, got ${JSON.stringify(result)}`);
    } else {
      check(result.t === expected, `"${heading}" with plan t = ${planned}: t must be ${expected} s, got ${JSON.stringify(result)}`);
    }
  }
  check(engine.riverNormalHeadingUnclear(stem(heading)) === (expected === null),
    `riverNormalHeadingUnclear("${heading}") must be ${expected === null}`);
}

// ------------------------------------------------------------ heading reads
const LEAST = "A boat can row at 5 m/s in still water. A river 120 m wide flows at 3 m/s. Find the minimum time to cross the river and the drift.";
const STRAIGHT = "A boat can row at 5 m/s in still water. A river 120 m wide flows at 3 m/s. The boatman wants to go straight across to the point directly opposite. Find the time taken to cross.";
check(riverTime(riverPlan(STRAIGHT, [["t", 24, "s"]], RIVER)).t === 30, "pure straight across: t = w/√(v²−u²) = 30 s");
check(riverTime(riverPlan(LEAST, [["t", 30, "s"]], RIVER)).t === 24, "pure least time: t = w/v = 24 s");
for (const [question, normal] of [
  ["A river flows east at 3 m/s and a boat heads due north at 5 m/s relative to the water.", true],
  ["A river flows east at 3 m/s and a boat heads south at 5 m/s relative to the water.", true],
  ["A river flows east at 3 m/s and a boat heads north-east at 5 m/s relative to the water.", false],
  ["A river flows east at 3 m/s and a boat heads north of west at 5 m/s relative to the water.", false],
  ["A river flows east at 3 m/s and a boat heads due east at 5 m/s relative to the water.", false],
  ["A swimmer swims perpendicular to the current at 2 m/s in a river flowing at 1 m/s.", true],
  ["A swimmer wants to swim straight across a river flowing at 1 m/s; he swims at 2 m/s.", false],
  ["A river 100 m wide flows at 3 m/s. Find the heading to go straight across for a boat of speed 4 m/s.", false],
] as Array<[string, boolean]>) {
  check(engine.riverNormalHeadingStated(question) === normal, `riverNormalHeadingStated(${JSON.stringify(question)}) must be ${normal}`);
}
check(engine.riverShortestPathAsked("A swimmer wants to swim straight across a river flowing at 1 m/s."), "a desired path straight across is still the shortest-path case");
check(!engine.riverShortestPathAsked(stem("heads straight across")), "a heading straight across is not a path request");

// "The point directly across" is a place, and a heading after an intent "to"
// is an intent: neither may turn a straight-across question into the
// least-time crossing (v = 5, u = 3, w = 400: straight across t = 100 s,
// least time 80 s). After any other "to" the time is withdrawn ("withdrawn").
const RIVER_400 = [["vb", 5, "m/s"], ["vc", 3, "m/s"], ["w", 400, "m"]] as Array<[string, number, string]>;
for (const [question, path, heading, t] of [
  ["A boat moves at 5 m/s in still water. A river 400 m wide flows at 3 m/s. The boat must reach the point directly across the river. Find the time taken to cross.", true, false, 100],
  ["To steer straight across a 400 m wide river flowing at 3 m/s, a boat that moves at 5 m/s in still water must head upstream at what angle? Find the time taken to cross.", true, false, 100],
  ["A boatman wants to head straight across a 400 m wide river flowing at 3 m/s. His boat moves at 5 m/s in still water. Find the time taken to cross.", true, false, 100],
  ["A boatman has to head straight across a 400 m wide river flowing at 3 m/s. His boat moves at 5 m/s in still water. Find the time taken to cross.", true, false, 100],
  ["In order to head straight across a 400 m wide river flowing at 3 m/s, a boat moves at 5 m/s in still water. Find the time taken to cross.", true, false, 100],
  ["A river 400 m wide flows east at 3 m/s. A man who can swim at 5 m/s in still water wishes to swim due north. In which direction should he head? Find the time taken to cross.", false, false, null],
  ["A river 400 m wide flows east at 3 m/s. A boat which can row at 5 m/s in still water wants to row due north. In which direction should it head? Find the time taken to cross.", false, false, null],
  ["A boat that moves at 5 m/s in still water heads straight across a river 400 m wide that flows at 3 m/s. Find the time to cross.", false, true, 80],
  ["A boat that moves at 5 m/s in still water aims directly across a river 400 m wide that flows at 3 m/s. Find the time to cross.", false, true, 80],
  ["A boat that moves at 5 m/s in still water heads straight across a river 400 m wide that flows at 3 m/s. Will it reach the point directly opposite? Find the time to cross.", true, true, null],
  ["A river 400 m wide flows east at 3 m/s. A boat which can row at 5 m/s in still water is made to head due north. Find the time taken to cross.", false, false, "withdrawn"],
] as Array<[string, boolean, boolean, number | null | "withdrawn"]>) {
  check(engine.riverShortestPathAsked(question) === path, `riverShortestPathAsked(${JSON.stringify(question)}) must be ${path}`);
  check(engine.riverNormalHeadingStated(question) === heading, `riverNormalHeadingStated(${JSON.stringify(question)}) must be ${heading}`);
  // One crossing read: the other crossing's t is rewritten to it. Both read:
  // t is unbound, so either crossing's t stands untouched. Unclear: withdrawn.
  for (const planned of [80, 100]) {
    const result = riverTime(riverPlan(question, [["t", planned, "s"]], RIVER_400));
    const expected = t === "withdrawn" ? undefined : t === null ? planned : t;
    check(result.t === expected && (t !== null || result.corrections.length === 0), `${JSON.stringify(question)} with plan t = ${planned}: t must be ${expected} s, got ${JSON.stringify(result)}`);
  }
}

console.log(`verify-river-heading-time: ${checks} checks passed`);
