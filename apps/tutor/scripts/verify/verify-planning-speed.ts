import assert from "node:assert/strict";
import { applyPlannerSpeedSettings, plannerSpeedSettings, plannerTierCostMultiplier } from "../../lib/llm/planningSpeed";
import { azureChatBody } from "../../lib/llm/llmProvider";
import { serverChatBody } from "../../lib/llm/chatRequest";
import { labProviderConfig } from "../../lib/llm/labProviderConfig";
import { PlannerUsageTracker } from "../lecture-lab/diagramEval";
import { endLlmGeneration, type TurnTrace } from "../../lib/obs/langfuse";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { buildSceneDocumentPlannerPrompt } from "../../../../packages/tutor-core/src/planners/scenePlannerV2Prompt";

const ordinary = { max_tokens: 4000, thinking: { type: "disabled" }, messages: [] };
assert.deepEqual(plannerSpeedSettings({}), { sceneEffort: "low", priority: false });
for (const value of ["", "true", "0", "off", "HIGH", "high", "none"]) {
  assert.equal(plannerSpeedSettings({ DIAGRAM_PLANNER_PRIORITY: value }).priority, false);
  assert.equal(plannerSpeedSettings({ DIAGRAM_SCENE_REASONING_EFFORT: value }).sceneEffort, "low");
}
const env = { DIAGRAM_PLANNER_PRIORITY: "1", DIAGRAM_SCENE_REASONING_EFFORT: "medium" };
assert.equal(applyPlannerSpeedSettings(ordinary, { provider: "azure", scene: true }, {}), ordinary);
assert.equal(applyPlannerSpeedSettings(ordinary, { provider: "fireworks", scene: true }, env), ordinary);
const otherPlanner = applyPlannerSpeedSettings(ordinary, { provider: "azure", scene: false }, env);
assert.equal(azureChatBody(otherPlanner, {}).reasoning_effort, "low");
assert.equal(otherPlanner.service_tier, "priority");
const scene = applyPlannerSpeedSettings(ordinary, { provider: "azure", scene: true }, env);
assert.equal(azureChatBody(scene, {}).reasoning_effort, "medium");
assert.equal(azureChatBody(scene, {}).max_completion_tokens, 8096);
assert.equal(azureChatBody(ordinary, {}).max_completion_tokens, 6048);
assert.deepEqual(ordinary, { max_tokens: 4000, thinking: { type: "disabled" }, messages: [] });
assert.equal(plannerTierCostMultiplier("priority", true), 2);
assert.equal(plannerTierCostMultiplier("default", true), 1);
assert.equal(plannerTierCostMultiplier(null, true), 2);
assert.equal(plannerTierCostMultiplier("auto", true), 2);
assert.equal(plannerTierCostMultiplier(null, false), 1);
const question = "A circle has radius 5. Construct its chord at y=3.";
const context = { constructionOperators: ["point", "circle", "segment", "intersection"] };
const baseline = buildSceneDocumentPlannerPrompt(question, { ...context, compactOperatorContracts: false });
const compact = buildSceneDocumentPlannerPrompt(question, { ...context, compactOperatorContracts: true });
assert.ok(compact.length < baseline.length);
for (const phrase of ["AUTHORITY", "AVAILABLE PROOF PREDICATES", "QUESTION", question, "point:", "circle:", "segment/connect:", "intersection:"]) {
  assert.ok(compact.includes(phrase), phrase);
}
const repair = buildSceneDocumentPlannerPrompt(question, { ...context, compactOperatorContracts: true }, context.constructionOperators);
assert.equal(repair, baseline, "repairs retain full contracts for every used operator");
const standard = applyPlannerSpeedSettings(ordinary, { provider: "azure", scene: true }, { DIAGRAM_PLANNER_PRIORITY: "0" });
assert.equal(standard.service_tier, "default", "an explicit standard experiment cannot inherit deployment priority");
assert.equal(azureChatBody(standard, {}).reasoning_effort, "low");
assert.equal(applyPlannerSpeedSettings(ordinary, { provider: "fireworks", scene: true }, { DIAGRAM_PLANNER_PRIORITY: "0" }), ordinary);
assert.equal(applyPlannerSpeedSettings(ordinary, { provider: "azure", scene: true }, {}), ordinary, "omitted controls preserve body identity");

// The same trust boundary used by the route rejects client-owned vendor knobs.
const clientRequest = { messages: [{ role: "user", content: "Explain the supplied calculation." }],
  service_tier: "priority", reasoning_effort: "high", thinking: { type: "enabled", budget_tokens: 8192 } };
for (const kind of ["planner", "teaching"] as const) {
  const sanitized = serverChatBody(clientRequest, kind);
  for (const key of ["service_tier", "reasoning_effort", "thinking"]) assert.equal(sanitized[key], undefined, `${kind} clients cannot select ${key}`);
}

async function verifyAccounting(): Promise<void> {
  const rates = { AZURE_GPT_SOL_INPUT_USD_PER_1M: "2", AZURE_GPT_SOL_OUTPUT_USD_PER_1M: "10", AZURE_GPT_SOL_CACHED_INPUT_USD_PER_1M: "0.1",
    LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://planning-speed-fixture.invalid", AZURE_OPENAI_API_KEY: "fixture-only", AZURE_OPENAI_DEPLOYMENT: "gpt-6.1-sol",
    DIAGRAM_PLANNER_PRIORITY: undefined, DIAGRAM_SCENE_REASONING_EFFORT: undefined };
  const originalEnv = new Map(Object.keys(rates).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(rates)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    const baseUsage = { prompt_tokens: 1000, completion_tokens: 800, total_tokens: 1800,
      prompt_tokens_details: { cached_tokens: 200 } };
    // 800 uncached input, 200 cached input and 800 output tokens: reasoning
    // is already a subset of the output, not an additional charge.
    const standardCost = 0.00962;
    const responseFor = (returnedTier: string | null, reasoning: number | undefined, requestedTier = "priority", attempts = 1) => Response.json({
      model: "gpt-6.1-sol", service_tier: returnedTier,
      usage: { ...baseUsage, ...(reasoning === undefined ? {} : { completion_tokens_details: { reasoning_tokens: reasoning } }) },
    }, { headers: { "x-heytutor-planner-model": "gpt-6.1-sol", "x-heytutor-service-tier-requested": requestedTier,
      ...(returnedTier === null ? {} : { "x-heytutor-service-tier": returnedTier }),
      "x-heytutor-reasoning-effort": "medium", "x-heytutor-upstream-attempts": String(attempts),
      "x-heytutor-planner-prompt-chars": "12000" } });
    for (const [returnedTier, reasoning, requestedTier, multiplier] of [
      ["priority", 123, "priority", 2], ["default", 0, "priority", 1], [null, undefined, "priority", 2],
      ["unknown", undefined, "priority", 2], ["default", undefined, "default", 1], [null, undefined, "auto", 1],
    ] as const) {
      const settlements: Array<{ charged: number; reserved: number }> = [];
      const tracker = new PlannerUsageTracker((charged, reserved) => settlements.push({ charged, reserved }), "response_usage");
      tracker.recordRequest("priced", 0.4, "planner", 2);
      await tracker.recordResponse("priced", responseFor(returnedTier, reasoning, requestedTier), 0.4, 2, "gpt-6.1-sol", {
        requestKind: "scene", phase: "repair", lane: "alternate", elapsedMs: 250, requestChars: 90 });
      const result = await tracker.finishAsync("priced");
      const call = result.modelCalls[0]!;
      assert.equal(call.costMultiplier, multiplier);
      assert.equal(call.measuredCostUsd, standardCost * multiplier);
      assert.equal(result.knownUsageUsd, standardCost * multiplier);
      assert.equal(call.estimatedCostUsd, standardCost * multiplier);
      assert.equal(call.reasoningTokens, reasoning ?? null, "missing reasoning is distinct from reported zero");
      assert.deepEqual([call.requestKind, call.phase, call.lane, call.elapsedMs, call.requestChars, call.promptChars], ["scene", "repair", "alternate", 250, 90, 12000],
        "proxy input size is distinct from provider-bound messages after server injection");
      assert.equal(call.cachedInputTokens, 200);
      assert.equal(call.outputTokens, 800, "reasoning tokens are not counted twice");
      assert.equal(call.unresolvedAttempts, 0);
      assert.deepEqual(settlements, [{ charged: standardCost * multiplier, reserved: 0.4 }]);
    }
    for (const mode of ["conservative", "response_usage"] as const) {
      const tracker = new PlannerUsageTracker(undefined, mode);
      tracker.recordRequest("unknown-usage", 0.4, "planner", 2);
      await tracker.recordResponse("unknown-usage", Response.json({ model: "gpt-6.1-sol" }), 0.4, 2, "gpt-6.1-sol", {
        requestKind: "turn_plan", phase: "audit", lane: "alternate", requestChars: 15, serviceTierRequested: "priority" });
      const result = tracker.finish("unknown-usage");
      const call = result.modelCalls[0]!;
      assert.equal(call.costMultiplier, 2, "an error without response headers retains requested-priority exposure");
      assert.equal(call.usageKnown, false);
      assert.equal(call.measuredCostUsd, null);
      assert.equal(call.reasoningTokens, null);
      assert.equal(call.requestChars, 15);
      assert.equal(call.promptChars, null, "missing provider-bound prompt size cannot be replaced by client request size");
      assert.equal(call.unresolvedAttempts, 2);
      assert.equal(call.unresolvedAllowanceUsd, 0.4);
      assert.equal(result.knownUsageUsd, 0);
      assert.equal(result.estimatedCostUsd, mode === "conservative" ? 0.4 : 0);
    }
    const retryTracker = new PlannerUsageTracker(undefined, "response_usage");
    retryTracker.recordRequest("retried", 0.4, "planner", 2);
    await retryTracker.recordResponse("retried", responseFor("default", 0, "priority", 2), 0.4, 2, "gpt-6.1-sol");
    const retry = retryTracker.finish("retried").modelCalls[0]!;
    assert.equal(retry.measuredCostUsd, standardCost, "the final standard response does not reprice an unmetered earlier retry");
    assert.equal(retry.unresolvedAllowanceUsd, 0.2);

    // Both responses are pending together; complete the second dispatch first.
    // Equal reservation sizes make the distinct request metadata the oracle.
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const delayedResponse = (release: (callback: () => void) => void, returnedTier: string, reasoning: number, promptChars: number) => {
      const ready = responseFor(returnedTier, reasoning);
      ready.headers.set("x-heytutor-planner-prompt-chars", String(promptChars));
      const payload = JSON.stringify({ model: "gpt-6.1-sol", usage: { ...baseUsage, completion_tokens_details: { reasoning_tokens: reasoning } } });
      return new Response(new ReadableStream({ start(controller) {
        release(() => { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); });
      } }), { headers: ready.headers });
    };
    const parallel = new PlannerUsageTracker(undefined, "response_usage");
    parallel.recordRequest("crossed", 0.4, "planner", 2);
    parallel.recordRequest("crossed", 0.4, "planner", 2);
    const first = parallel.recordResponse("crossed", delayedResponse(callback => { releaseFirst = callback; }, "priority", 100, 11000), 0.4, 2, "gpt-6.1-sol", {
      requestKind: "turn_plan", phase: "audit", lane: "alternate", elapsedMs: 110, requestChars: 11 });
    const second = parallel.recordResponse("crossed", delayedResponse(callback => { releaseSecond = callback; }, "default", 0, 22000), 0.4, 2, "gpt-6.1-sol", {
      requestKind: "scene", phase: "repair", lane: "primary", elapsedMs: 220, requestChars: 22 });
    releaseSecond(); await second; releaseFirst(); await first;
    const crossed = parallel.finish("crossed");
    assert.deepEqual(crossed.modelCalls.map(call => [call.requestKind, call.phase, call.lane, call.requestChars, call.promptChars, call.reasoningTokens, call.costMultiplier]), [
      ["scene", "repair", "primary", 22, 22000, 0, 1], ["turn_plan", "audit", "alternate", 11, 11000, 100, 2],
    ], "crossed parallel callbacks retain their own request attribution and returned tier");
    assert.equal(crossed.knownUsageUsd, standardCost * 3);

    process.env.DIAGRAM_PLANNER_PRIORITY = "0";
    const defaultConfig = labProviderConfig();
    process.env.DIAGRAM_PLANNER_PRIORITY = "1";
    process.env.DIAGRAM_SCENE_REASONING_EFFORT = "medium";
    const experimentConfig = labProviderConfig();
    assert.equal(defaultConfig.planningSpeed.priority, false);
    assert.equal(defaultConfig.planningSpeed.sceneEffort, "low");
    assert.equal(defaultConfig.planningSpeed.requestTier, "default", "standard and auto experiments have distinct resume identities");
    assert.equal(experimentConfig.planningSpeed.priority, true);
    assert.equal(experimentConfig.planningSpeed.sceneEffort, "medium");
    assert.equal(experimentConfig.planningSpeed.requestTier, "priority");
    assert.ok(experimentConfig.plannerOutputCap > defaultConfig.plannerOutputCap, "preflight reserves medium scene reasoning headroom");
    assert.equal(experimentConfig.teachingOutputCap, defaultConfig.teachingOutputCap, "planner experiments do not expand teaching budgets");

    const noneQuestion = "A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Find AB and BA.";
    const nonePlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: noneQuestion, visualRequirement: "none",
      givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
    const selectionInput = { question: noneQuestion, turnPlan: nonePlan, problemIR: null, visualNeedDecision: "none" as const };
    const withExperiments = selectProductionScene(selectionInput);
    delete process.env.DIAGRAM_PLANNER_PRIORITY; delete process.env.DIAGRAM_SCENE_REASONING_EFFORT;
    assert.equal(labProviderConfig().planningSpeed.requestTier, "auto", "omitted controls retain deployment-auto provenance");
    const withoutExperiments = selectProductionScene(selectionInput);
    assert.equal(withExperiments.representation, null);
    assert.equal(withExperiments.gate.shouldAttemptLlmScene, false);
    assert.deepEqual(withExperiments, withoutExperiments, "transport experiments cannot reopen explicit no-figure admission");

    const generationEnds: Array<Record<string, unknown>> = [];
    let parentUpdates = 0;
    // Only the SDK methods consumed by this boundary are implemented; no
    // Langfuse client or background exporter is instantiated by this fixture.
    const generation = { end(data: Record<string, unknown>) { generationEnds.push(data); }, update() {} } as unknown as NonNullable<TurnTrace["generation"]>;
    const trace = { update() { parentUpdates++; } } as unknown as NonNullable<TurnTrace["trace"]>;
    const turn = { traceId: "fixture", model: "gpt-6.1-sol", generation, trace };
    for (const costMultiplier of [1, 2] as const) endLlmGeneration(turn, {
      output: "{}", usageDetails: { input: 1000, output: 800, cachedInput: 200, total: 1800 }, costMultiplier, updateTrace: false });
    const standardDetails = generationEnds[0]!.costDetails as Record<string, number>;
    const priorityDetails = generationEnds[1]!.costDetails as Record<string, number>;
    assert.equal(standardDetails.total, standardCost);
    for (const key of Object.keys(standardDetails)) assert.equal(priorityDetails[key], standardDetails[key]! * 2);
    assert.equal(parentUpdates, 0, "planner accounting cannot overwrite the parent teaching trace");
  } finally {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

void verifyAccounting().then(() => console.log("planning speed: default/provider scoping, compact authority, medium headroom, actual tracker/trace priority pricing, crossed attribution and no-figure admission pass"));
