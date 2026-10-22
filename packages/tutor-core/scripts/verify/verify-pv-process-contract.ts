import assert from "node:assert/strict";
import { isSupportedSceneOperator } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocument, repairSceneDocument } from "../../src/planners/scenePlannerV2";

async function main(): Promise<void> {
  const question = "Compare named isobaric, isochoric, isothermal and adiabatic processes on a P-V diagram.";
  const capabilities = inferSceneCapabilities(question);
  assert.ok(isSupportedSceneOperator("pv_process") && capabilities.constructionOperators.includes("pv_process"), "the reusable state-plot capability exposes the operator");
  for (const detail of [undefined, [], ["pv_process"]]) {
    const card = selectConstructionInputContracts(["pv_process"], detail);
    for (const term of ["states", "processes", "isobar", "isochor", "isotherm", "adiabat", "physical", "conceptual", "nonMetric", "qualitative_verified", "quantity IDs"]) assert.ok(card.includes(term), `${term} survives contract compaction`);
  }
  const requests: Array<{ messages: Array<{ content: string }> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }), { status: 200 });
  };
  try {
    const options = { ...capabilities, proxyUrl: "http://planner.test", timeoutMs: 2000 };
    assert.ok(await planSceneDocument(question, options, "Use complete named states and engine-owned process laws."));
    assert.ok(await repairSceneDocument(question, { schemaVersion: "scene-document/v2", constructions: [{ id: "plot", operator: "pv_process", inputs: {}, outputs: ["plot"] }] },
      [{ code: "invalid_pv_process", message: "Supply consistent complete states, not a chord or invented gamma.", severity: "fatal" }], options));
  } finally { globalThis.fetch = originalFetch; }
  const sizes = requests.map((request) => request.messages.reduce((total, message) => total + message.content.length, 0));
  assert.equal(requests.length, 2);
  assert.ok(sizes[0]! <= 24_500 && sizes[1]! <= 27_000, `scoped PV request budgets: ${sizes}`);
  assert.ok(requests[1]!.messages.some((message) => message.content.includes("Never invent missing endpoints/constants")), "used repair operator retains its full truth contract");
  console.log(`P-V planner contracts passed; mocked scoped initial/repair ${sizes.join("/")} characters`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
