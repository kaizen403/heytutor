/** Crossing-time roles remain distinct from a comparison's time difference. Synthetic source cases only. */
import assert from "node:assert/strict";
import {
  applyRiverCrossingAuthority, riverCrossingPlanConflicts, riverCrossingSpeeds, riverShortestTimeAsked,
} from "../../src/physics/riverCrossingSource";
import { motionPlanConflicts, motionQuantityAuthority, motionSymbolKey } from "../../src/physics/motionPlanAgreement";

const source = "The river is 96 m wide, the boat speed is 10 m/s in still water and the current is 6 m/s.";
const quantity = (symbol: string, value: number, unit = "s", id = symbol) =>
  ({ id, symbol, value, unit, provenance: "derived", sourceText: "", dependsOn: [] });
const plan = (derived: ReturnType<typeof quantity>[]) => ({ givens: [], derived, unknowns: [] });
let checks = 0;
function audit(question: string, derived: ReturnType<typeof quantity>[]) {
  const speeds = riverCrossingSpeeds(question);
  assert(speeds.status === "bound", "synthetic source speeds must bind");
  return { conflicts: riverCrossingPlanConflicts(speeds, plan(derived), question), authority: applyRiverCrossingAuthority(question, plan(derived)) };
}
function accepts(question: string, derived: ReturnType<typeof quantity>[], label: string) {
  const result = audit(question, derived);
  assert.deepEqual(result.conflicts, [], label);
  assert.deepEqual(result.authority?.corrections, [], `${label}: no correct value rewritten`);
  assert.deepEqual(result.authority?.withdrawn, [], `${label}: no correct value withdrawn`);
  checks += 3;
}
function refuses(question: string, row: ReturnType<typeof quantity>, label: string) {
  assert.equal(audit(question, [row]).conflicts.length, 1, label);
  checks += 1;
}
const independent = [
  `${source} Find the time to go straight across and compare it with the shortest possible crossing time.`,
  `${source} (a) Find the time to cross to the point directly opposite. (b) If the boat crosses in the minimum time, find the time and the drift.`,
  `${source} Find the time to reach the point directly opposite. Then find the time if instead it crosses as quickly as possible, and the drift.`,
  `${source} Find the time to land directly opposite, then find the time to cross as quickly as possible.`,
  `${source} Find the time to go straight across, and the time and drift when it crosses in the shortest possible time.`,
];
for (const question of independent) {
  assert(riverShortestTimeAsked(question), "the independent shortest-time crossing is requested"); checks += 1;
  accepts(question, [quantity("t_straight", 12), quantity("t_min", 9.6), quantity("drift", 57.6, "m")], "both crossings retain their own time and drift");
  for (const symbol of ["Δt", "\\Delta t", "delta_t", "time_difference", "time_saved"]) {
    accepts(question, [quantity(symbol, 2.4)], "a named comparison difference is supported");
    accepts(question, [quantity(symbol, 2.4 / 60, "min")], "a named comparison difference converts its time unit");
    refuses(question, quantity(symbol, 3), "a wrong named time difference is refused");
    refuses(question, quantity(symbol, -2.4), "a saved-time magnitude cannot be negative");
  }
  for (const symbol of ["t", "T", "t_min", "dt"]) refuses(question, quantity(symbol, 2.4), "a time difference cannot authorize a crossing time");
  refuses(question, quantity("t", 2.4, "s", "time_difference"), "a difference id cannot override a bare crossing-time symbol");
  refuses(question, quantity("t_min", 12), "the opposite-bank time cannot become the independent minimum time");
  refuses(question, quantity("t_straight", 9.6), "the independent minimum cannot become the opposite-bank time");
}
const constrained = [
  `${source} A boat must land directly opposite in the shortest possible crossing time. Find the time.`,
  `${source} A boat must reach the point directly opposite in the quickest time. Find the time.`,
  `${source} The boat crosses directly opposite with the minimum time. Find the time.`,
  `${source} In the least time, the boat must go directly across. Find the time.`,
  `${source} The boat goes straight across, taking the least possible time. Find the time.`,
  `${source} Land directly opposite within the shortest time. Find the time.`,
  `${source} Reach the point directly opposite as fast as possible. Find the time.`,
];
for (const question of constrained) {
  assert(!riverShortestTimeAsked(question), "a nearby time condition does not request an independent drifting crossing"); checks += 1;
  accepts(question, [quantity("t", 12), quantity("t_min", 12)], "the constrained crossing keeps its own minimum time");
  refuses(question, quantity("t", 9.6), "a constrained crossing cannot use the drifting crossing's time");
  refuses(question, quantity("Δt", 2.4), "one constrained crossing supplies no comparison difference");
}
const quick = `${source} Find the shortest possible crossing time and the drift.`;
accepts(quick, [quantity("t_min", 9.6), quantity("drift", 57.6, "m")], "the independent shortest-time spelling is read");
refuses(quick, quantity("t_min", 12), "a shortest-time crossing cannot use the straight-across time");
refuses(quick, quantity("Δt", 2.4), "one shortest-time crossing supplies no comparison difference");
const neither = `${source} The boat heads perpendicular to the bank. Describe its resultant velocity.`;
refuses(neither, quantity("Δt", 2.4), "absence of both mode words is not an explicit comparison");
assert.equal(motionSymbolKey("Δt"), "deltat", "Unicode delta is not erased onto t");
assert.equal(motionSymbolKey("\\Delta x"), "deltax", "LaTeX delta is not erased onto x");
checks += 2;
const adversaries = [
  { question: `${source} The boat heads at 60 degrees to the bank, upstream. Find the time taken to cross and compare it with the minimum crossing time.`, row: quantity("t", 96 / (10 * Math.sin(Math.PI / 3))), kind: "unsupported-heading" },
  { question: `${source} Find the minimum time compared with the directly opposite crossing.`, row: quantity("t_min", 9.6), kind: "valid-comparison" },
  { question: `${source} Find the minimum time compared to the directly opposite crossing.`, row: quantity("t_min", 9.6), kind: "valid-comparison" },
  { question: independent[0]!, row: quantity("t_cross", 2.4, "s", "time_difference"), kind: "mixed-role" },
  { question: independent[0]!, row: quantity("t_crossing", 2.4, "s", "time_difference"), kind: "mixed-role" },
  { question: independent[0]!, row: quantity("Δv", 2.4, "s", "time_difference"), kind: "mixed-role" },
  { question: independent[0]!, row: quantity("Δx", 2.4, "s", "time_difference"), kind: "mixed-role" },
  { question: independent[0]!, row: quantity("t_diff", 12), kind: "wrong-difference" },
];
const unsafe = adversaries.flatMap(({ question, row, kind }, index) => {
  const result = audit(question, [row]);
  const bad = kind === "valid-comparison" ? result.conflicts.length > 0 || result.authority!.corrections.length > 0 || result.authority!.withdrawn.length > 0
    : kind === "unsupported-heading" ? result.authority!.corrections.length > 0
      : result.conflicts.length !== 1 || (kind === "mixed-role" && result.authority!.corrections.some(c => c.corrected === 2.4));
  checks += 1;
  return bad ? [{ index, kind, result }] : [];
});
assert.deepEqual(unsafe, [], "comparison and difference roles must not rewrite another crossing");
for (const [symbol, unit, baseValue, target] of [["Δt", "s", 3, "t"], ["\\Delta x", "m", 20, "x"]] as const) {
  const row = quantity(symbol, 4, unit, target);
  const bindings = new Map([[target, { dimension: unit === "s" ? "time" as const : "length" as const, si: baseValue }]]);
  const conflicts = motionPlanConflicts(plan([row]), { time: [3], length: [20], velocity: [] }, "", bindings);
  const authority = motionQuantityAuthority("", plan([row]), conflicts, bindings);
  assert.deepEqual(authority.corrections, [], "a delta symbol must not acquire its underlying quantity's role from the id");
  checks += 1;
}
for (const separator of [".", ";", ":", "?", "!", "(b)", "[b]", "and", "compare", "compared with", "compared to", "comparing", "than", "if", "when", "then", "instead", "versus", "vs", "or", "but", "while", "also"]) {
  const question = `${source} Find the time to reach the point directly opposite ${separator} find the shortest possible crossing time.`;
  accepts(question, [quantity("t_straight", 12), quantity("t_min", 9.6)], "separate time requests retain both roles");
}
for (const symbol of ["δ", "difference", "diff"]) {
  accepts(independent[0]!, [quantity(symbol, Math.asin(0.6) * 180 / Math.PI, "deg", "heading_angle")], "an untyped difference name retains its source angle dimension");
  accepts(independent[0]!, [quantity(symbol, 96, "m", "distance_difference")], "an untyped difference name retains its source length dimension");
}
refuses(independent[0]!, quantity("Δt", 2.4, "m/s"), "an explicitly timed difference cannot become a velocity");
const coupled = `${source} The boatman wants to land directly opposite and be quickest. Find the time.`;
accepts(coupled, [quantity("t_min", 12)], "ambiguous coordination cannot activate new independent-time role bindings");
refuses(coupled, quantity("Δt", 2.4), "ambiguous coordination supplies no explicit two-crossing difference");
for (const question of [
  `${source} Compare the boat and current speeds. The boatman wants to land directly opposite and be quickest. Find the time.`,
  `${source} Find the heading and calculate the time to land directly opposite and be quickest.`,
]) {
  accepts(question, [quantity("t_min", 12)], "unrelated comparison words and non-time requests cannot activate a second time role");
  refuses(question, quantity("Δt", 2.4), "unrelated requests supply no two-crossing difference");
}
for (const time of [9.6, 12]) refuses(independent[0]!, quantity("Δt", time), "a full crossing time cannot be a difference");
accepts(independent[0]!, [quantity("Δv", 4, "m/s")], "a delta velocity retains its physical dimension");
refuses(independent[0]!, quantity("t_min", 2.4, "s", "tdiff"), "a difference id cannot override the minimum-time symbol");
refuses(independent[0]!, quantity("t", 2.4, "s", "dt"), "a dt id cannot turn a crossing time into a difference");
console.log(`river crossing time roles: ${checks} checks passed`);
