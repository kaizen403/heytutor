import assert from "node:assert/strict";
import { validateTurnPlanSceneProofs } from "@heytutor/scene-engine";
import { capacitorPlan, capacitorQuestion, freeCapacitorPlates } from "../../../scene-engine/scripts/verify/fixtures/capacitor-circuit";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { planSceneDocument, repairSceneDocument } from "../../src/planners/scenePlannerV2";

const candidate = freeCapacitorPlates();
const issues = validateTurnPlanSceneProofs(candidate, capacitorPlan);
assert.ok(issues.some(({ code }) => code === "source_loop_not_closed"));
const originalFetch = globalThis.fetch;
const requests: Array<{ messages: Array<{ content: string }> }> = [];
globalThis.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }), { status: 200 });
};
try {
  const options = { ...inferSceneCapabilities(capacitorQuestion), proxyUrl: "http://planner.test", timeoutMs: 2000 };
  assert.ok(options.constructionOperators.includes("symbol"));
  assert.ok(await planSceneDocument(capacitorQuestion, options));
  assert.ok(await repairSceneDocument(capacitorQuestion, { ...candidate }, issues, options));
  assert.equal(requests.length, 2);
  for (const [index, request] of requests.entries()) {
    const text = request.messages.map(({ content }) => content).join("\n");
    assert.match(text, /symbol.*capacitor/);
    assert.match(text, /start.*end/);
    assert.match(text, /point IDs/);
    if (index === 0) assert.match(text, /engine fixes two equal parallel plates/);
    else assert.match(text, /Free plate segments and coincident coordinates do not establish/);
    assert.ok(text.length <= (index === 0 ? 24_500 : 27_000), `scoped capacitor request budget: ${text.length}`);
  }
} finally { globalThis.fetch = originalFetch; }
console.log("Capacitor contract: native symbol and terminal repair reach initial + repair requests without external calls");
