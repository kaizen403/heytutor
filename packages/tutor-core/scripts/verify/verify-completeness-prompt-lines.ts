/** Completeness is a parked experiment. Default prompt and authority remain
 * unchanged; explicit opt-in adds the generic checklist within the old budget.
 * All HTTP responses below are local fixtures; no provider is contacted.
 */
import assert from "node:assert/strict";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, SCENE_COMPLETE_FIGURE_RULES, SCENE_CONSTRUCTION_INPUT_CONTRACTS, SCENE_DOCUMENT_PLANNER_PROMPT } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocumentWithRepair, repairSceneDocument } from "../../src/planners/scenePlannerV2";
const flag = "NEXT_PUBLIC_EXPERIMENTAL_SCENE_COMPLETENESS";
const old = process.env[flag], fetchBefore = globalThis.fetch;
const seen: Array<{ phase: string; text: string }> = [];
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
  seen.push({ phase: new Headers(init?.headers).get("x-scene-planner-phase") ?? "", text: body.messages.map(m => m.content).join("\n") });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }));
};
try {
  assert(!/\b(?:lens|mirror|circuit|incline|projectile|triangle)\b/i.test(SCENE_COMPLETE_FIGURE_RULES));
  assert.equal(SCENE_COMPLETE_FIGURE_RULES.split("\n").length, 7);
  assert(SCENE_DOCUMENT_PLANNER_PROMPT.includes("Do not place derived scalar answers initially"));
  assert(SCENE_CONSTRUCTION_INPUT_CONTRACTS.includes("Do not invent a normal, friction, or weight"));
  assert(SCENE_CONSTRUCTION_INPUT_CONTRACTS.includes("do not invent a degree label"));
  for (const question of ["Draw the free body diagram of a block on an incline.", "Draw the supplied conditional outcomes and mark every joint leaf probability."]) {
    const context = inferSceneCapabilities(question);
    delete process.env[flag];
    const baseline = buildSceneDocumentPlannerPrompt(question, context);
    assert(!baseline.includes("COMPLETE FIGURE\n"));
    assert.equal(buildSceneDocumentPlannerPrompt(question, context, undefined, { completeFigure: false }), baseline);
    for (const value of ["0", "true", "yes", "invalid"]) {
      process.env[flag] = value;
      assert.equal(buildSceneDocumentPlannerPrompt(question, context), baseline, "only exact1 opts in");
    }
    process.env[flag] = "1";
    const enabled = buildSceneDocumentPlannerPrompt(question, context);
    assert(enabled.includes(SCENE_COMPLETE_FIGURE_RULES));
    assert.equal(enabled.replace(`\n\n${SCENE_COMPLETE_FIGURE_RULES}`, ""), baseline, "the opt-in block cannot change default authority or operator contracts");
    assert.equal(buildSceneDocumentPlannerPrompt(question, context, undefined, { completeFigure: false }), baseline);
    delete process.env[flag];
    const options = { ...context, proxyUrl: "http://planner.test", timeoutMs: 2000 };
    await planSceneDocumentWithRepair(question, () => ({ valid: true, errors: [] }), options);
    const off = seen.splice(0);
    assert.equal(off.filter(r => r.phase === "plan").length, 2);
    assert(off.every(r => !r.text.includes("COMPLETE FIGURE\n")));
    process.env[flag] = "1";
    await planSceneDocumentWithRepair(question, () => ({ valid: true, errors: [] }), options);
    const on = seen.splice(0);
    assert.equal(on.filter(r => r.phase === "plan").length, 2);
    assert(on.every(r => r.text.includes(SCENE_COMPLETE_FIGURE_RULES)));
    assert(on.every(r => r.text.length <= 24500), "initial request retains its existing size bound");
    await repairSceneDocument(question, { schemaVersion: "scene-document/v2", constructions: [] }, [], options);
    const repairs = seen.splice(0);
    assert(repairs.every(r => !r.text.includes("COMPLETE FIGURE\n")), "invalid-candidate repairs retain the compact authoritative contract");
    assert(repairs.every(r => r.text.length <= 27000));
  }
  console.log("Completeness prompt: default/invalid/exact1/explicitfalse and actual two-request planner paths pass; authority and size bounds retained");
} finally {
  if (old === undefined) delete process.env[flag]; else process.env[flag] = old;
  globalThis.fetch = fetchBefore;
}
