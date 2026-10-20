/** Actual offline planning/repair transport for the engine's load-count contract. */
import assert from "node:assert/strict";
import { PLANNER_VISIBLE_SCENE_PROOF_PREDICATES } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocument, repairSceneDocument } from "../../src/planners/scenePlannerV2";
assert.ok(PLANNER_VISIBLE_SCENE_PROOF_PREDICATES.includes("loadBranchCount"), "the engine must expose a separate load-branch count");
const question = "What is a parallel circuit?";
const capabilities = inferSceneCapabilities(question);
assert.ok(capabilities.proofPredicates.includes("loadBranchCount"), "circuit planning must receive the new proof");
const scoped = buildSceneDocumentPlannerPrompt(question, capabilities);
assert.match(scoped, /loadBranchCount/);
assert.match(scoped, /source branch.*excluded|exclude.*source branch/i);
assert.match(scoped, /pathCount.*all.*paths/i);
const originalFetch = globalThis.fetch;
const requests: Array<{ messages: Array<{ content: string }> }> = [];
globalThis.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }), { status: 200 });
};
try {
  const options = { ...capabilities, proxyUrl: "http://planner.test", timeoutMs: 2000 };
  assert.ok(await planSceneDocument(question, options));
  assert.ok(await repairSceneDocument(question, { schemaVersion: "scene-document/v2", constructions: [] }, [
    { code: "assertion_failed", message: "loadBranchCount expected 2 passive branches, found 3; the source branch is excluded", severity: "fatal" },
  ], options));
  assert.equal(requests.length, 2);
  for (const [index, request] of requests.entries()) {
    const text = request.messages.map(message => message.content).join("\n");
    assert.match(text, /loadBranchCount/);
    assert.match(text, /source branch.*excluded|exclude.*source branch/i);
    assert.ok(text.length <= (index === 0 ? 24_500 : 27_000), "new contract must retain the existing transport budget");
  }
} finally { globalThis.fetch = originalFetch; }
console.log("verify-parallel-load-count-contract: planner-visible and transported in initial + repair requests");
