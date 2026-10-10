import assert from "node:assert/strict";
import { buildHybridAllowlist, simulatePhysicsHybrid, hybridMetrics, type HybridRow } from "../lecture-lab/physicsHybrid";

const figure: HybridRow = {
  id: "same", question: "same question", chapter: "physics|2", source: "fast_family", family: "motion_path",
  archetype: null, drawn: true, required: true, verdict: "partial",
};
const empty: HybridRow = { ...figure, source: "text_only", drawn: false, verdict: "empty_bad" };
const key = "fast_family:motion_path";
assert.equal(buildHybridAllowlist(Array(4).fill(figure), .1)[0]!.qualifies, false);
assert.equal(buildHybridAllowlist(Array(5).fill(figure), .1)[0]!.qualifies, true);
const oneWrong = [...Array(9).fill(figure), { ...figure, verdict: "wrong" as const }];
assert.equal(buildHybridAllowlist(oneWrong, .1)[0]!.qualifies, true, "10% boundary inclusive");
assert.equal(buildHybridAllowlist(oneWrong.slice(1), .1)[0]!.qualifies, false);
assert.equal(simulatePhysicsHybrid(figure, empty, new Set([key])), figure);
assert.equal(simulatePhysicsHybrid(figure, empty, new Set()), empty);
assert.equal(simulatePhysicsHybrid(figure, { ...figure, source: "planner", verdict: "wrong" }, new Set([key])).verdict, "wrong", "strict accepted always wins");
assert.equal(simulatePhysicsHybrid({ ...figure, source: "planner" }, empty, new Set([key])), empty, "never use current planner as a deterministic fallback");
assert.throws(() => simulatePhysicsHybrid({ ...figure, question: "different" }, empty, new Set([key])), /identical/);
assert.deepEqual(hybridMetrics([figure, empty]), { tested: 2, useful: 1, wrong: 0, requiredEmpty: 1 });
console.log("physics hybrid verification passed (zero model calls)");
