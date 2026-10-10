/**
 * Numeric 3D vector questions are routed to coordinate_figure (a space stem)
 * and must still be offered the directed space vector and cross product, with
 * their full contracts, so the planner can draw a×b instead of declining.
 */
import assert from "node:assert/strict";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt } from "../../src/planners/scenePlannerV2Prompt";

// Coordinate triples route to coordinate_figure from the stem alone; i, j, k
// notation has no stem cue and reaches the catalog through the turn plan's
// required visual, as production passes it.
const required = { lawIds: ["vector_cross_product"], turnPlan: { lawIds: ["vector_cross_product"], visualRequirement: "required" } };
for (const [question, hints] of [
  ["Find the cross product of a=(1,2,3) and b=(4,5,6).", undefined],
  ["Find the area of the parallelogram whose adjacent sides are a = (1, 2, 3) and b = (2, -1, 1).", undefined],
  ["Find a vector perpendicular to both a = 2i - j + k and b = i + 3j - 2k.", required],
] as const) {
  const capabilities = inferSceneCapabilities(question, hints as Parameters<typeof inferSceneCapabilities>[1]);
  for (const operator of ["space_frame", "space_point", "space_vector", "space_cross"]) {
    assert(capabilities.constructionOperators.includes(operator), `${operator} must be offered for: ${question} (families ${JSON.stringify(capabilities.families)})`);
  }
  const prompt = buildSceneDocumentPlannerPrompt(question, capabilities);
  for (const operator of ["space_vector", "space_cross"]) assert(prompt.includes(`- ${operator}: {`), `${operator} contract must reach the planner for: ${question}`);
}
const planar = inferSceneCapabilities("Find the resultant of a 3 N force east and a 4 N force north.");
assert(planar.constructionOperators.includes("vector"), "planar vector questions keep the planar vector operator");
console.log("space vector offer: numeric 3D vector questions reach space_vector and space_cross contracts");
