import assert from "node:assert/strict";
import { sceneDeclineExperimentGuidance } from "../lecture-lab/sceneDeclineExperiment";
import { parseOptions } from "../lecture-lab/run";

assert.deepEqual(sceneDeclineExperimentGuidance("unchanged"), [], "off leaves planner prompt unchanged");
const guidance = sceneDeclineExperimentGuidance("qualitative_setup_v1").join(" ");
assert.match(guidance, /dimensionless layout/i);
assert.match(guidance, /must still decline/);
assert.match(guidance, /question\/authoritative plan/);
assert.equal(parseOptions(["--eval", "x.jsonl", "--max-usd", "15"]).sceneDeclinePolicy, "unchanged");
assert.equal(parseOptions(["--eval", "x.jsonl", "--max-usd", "15", "--scene-decline-policy", "qualitative_setup_v1"]).sceneDeclinePolicy, "qualitative_setup_v1");
assert.throws(() => parseOptions(["--max-usd", "15", "--scene-decline-policy", "qualitative_setup_v1"]), /evaluation-only/);
assert.throws(() => parseOptions(["--eval", "x.jsonl", "--max-usd", "15", "--scene-decline-policy", "bad"]), /scene-decline-policy/);
console.log("scene decline experiment verification passed (zero model calls)");
