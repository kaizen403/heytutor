/**
 * A required figure keeps every started scene planner lane after a fast text
 * only decline; optional and none keep the 750 ms grace. Production replay
 * 24 Oct: in 3 of 8 recorded physics lessons one lane declined in about 3.7 s
 * and the peer still building the scene was aborted at that moment.
 * The planner behaviour is proven in tutor-core
 * verify-required-scene-peer-drain; this checks live and lab ask for it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { waitForRequiredScenePeers } from "../../features/tutor-session/lib/scene/diagramGeneration";

assert.equal(waitForRequiredScenePeers("required"), true, "a required figure waits for its peers");
assert.equal(waitForRequiredScenePeers("optional"), false, "an optional figure keeps the grace window");
assert.equal(waitForRequiredScenePeers("none"), false, "no figure never waits");

const call = "waitForRequiredScenePeers: waitForRequiredScenePeers(planningTurnPlan.visualRequirement),";
for (const file of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
  const source = readFileSync(resolve(import.meta.dirname, "../..", file), "utf8");
  const start = source.indexOf("planSceneDocumentWithRepair(");
  assert(start >= 0, `${file} plans scenes`);
  assert(source.indexOf(call, start) > start && source.indexOf(call, start) - start < 2_000, `${file} passes the required figure peer policy to the scene planner`);
}
console.log("required figure peer drain wiring: required only, live and lab both pass it");
