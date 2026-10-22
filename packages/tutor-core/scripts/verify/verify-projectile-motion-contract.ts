import assert from "node:assert/strict";
import { buildSceneDocumentPlannerPrompt, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";

let checks = 0;
for (const prompt of [selectConstructionInputContracts(["projectile_trajectory"], []), selectConstructionInputContracts(["projectile_trajectory"]), buildSceneDocumentPlannerPrompt("Show a source-grounded projectile flight.")]) {
  const line = prompt.split("\n").find(value => value.startsWith("- projectile_trajectory: {"));
  assert(line); checks++;
  for (const text of ["showMeasurements", "R dimension,height dimension", "heightReference", "H above level ground", "Δh above launch", "No units block", "source-backed numeric", "tangent_line/vector", "never guess an independent direction"]) {
    assert(line.includes(text), `compact/detailed contract includes ${text}`); checks++;
  }
  assert(!line.includes('units:{')); checks++;
}
console.log(`projectile motion planner contract: ${checks} checks passed`);
