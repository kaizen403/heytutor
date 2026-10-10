/** Engine safety operators must reach the actual initial and repair requests. */
import assert from "node:assert/strict";
import { isSupportedSceneOperator, SUPPORTED_SCENE_CONSTRUCTION_OPERATORS } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocument, repairSceneDocument } from "../../src/planners/scenePlannerV2";

const question = "Draw the helical path of a charged particle in a uniform magnetic field, with nonzero parallel and perpendicular velocity.";
const caps = inferSceneCapabilities(question, { turnPlan: { visualRequirement: "required", givens: [] } });
assert(isSupportedSceneOperator("magnetic_helix"), "the runtime engine supports magnetic_helix");
for (const name of ["space_frame", "space_point", "magnetic_helix"]) assert(caps.constructionOperators.includes(name), `${name} reaches the field offer`);
for (const detail of [undefined, []] as const) {
  const contracts = selectConstructionInputContracts(["magnetic_helix"], detail);
  for (const key of ["frame:", "origin:", "mass", "charge", "velocity:", "magneticField:", "turns", "displayScale?", 'mass:"kg"', 'charge:"C"', 'velocity:"m/s"', 'magneticField:"T"']) assert(contracts.includes(key), `${key} survives full and compact helix contracts`);
  assert(contracts.includes("Output 1 polyline"), "helix output kind stays explicit");
  assert(/parallel\/transverse|parallel\/transverse velocity/.test(contracts), "a true helix needs both velocity components");
}
const requests: Array<{ messages: Array<{ content: string }> }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }), { status: 200 });
};
try {
  const options = { ...caps, proxyUrl: "http://planner.test", timeoutMs: 2000 };
  await planSceneDocument(question, options);
  await repairSceneDocument(question, { schemaVersion: "scene-document/v2", constructions: [{ id: "helix", operator: "magnetic_helix", outputs: ["path"] }] }, [{ code: "construction_failed", message: "Restore the source-bound field and velocity.", severity: "fatal" }], options);
  assert.equal(requests.length, 2);
  for (const [index, request] of requests.entries()) {
    const content = request.messages.map((message) => message.content).join("\n");
    assert(content.includes("- magnetic_helix: {"), "helix contract reaches initial and repair");
    assert(content.includes("literal direction arrays") && content.includes("never declare a helper vector as physical ink"), "direction helpers cannot become extra physical ink");
    assert(content.length <= (index === 0 ? 24_500 : 27_000), `transport budget (${content.length})`);
  }
  const universal = buildSceneDocumentPlannerPrompt("Draw the supplied source arrangement.", { constructionOperators: SUPPORTED_SCENE_CONSTRUCTION_OPERATORS });
  assert(universal.includes("- magnetic_helix: {"), "universal catalog does not hide helix");
  assert(universal.length + 800 <= 24_500, "universal catalog leaves strategy/transport room");
} finally { globalThis.fetch = originalFetch; }
console.log("physics safety prompt contract: helix schema, field offer and initial/repair helper authority passed");
