import assert from "node:assert/strict";
import { fetchVisualNeedAssessment } from "../../features/tutor-session/lib/scene/visualNeedClient";
import { budgetedVisualNeedFetch, visualNeedRequestWorstCaseUsd, summarizeVisualNeedCalls, type VisualNeedCallAccounting } from "../lecture-lab/labVisualNeed";
import { labProviderConfig } from "../../lib/llm/labProviderConfig";
import { resolveLlmRates } from "../../lib/obs/usageCost";
import { LabSpendCap, parseOptions, restoredLabCharge, selectResumeProbes, plannerRequestWorstCaseUsd, directProviderRequestModel, reserveLabRequest, runBudgetedLabRows } from "../lecture-lab/run";
import { PlannerUsageTracker } from "../lecture-lab/diagramEval";
import { assertLabSpendMode, assertLabUsageCheckpoint } from "../lecture-lab/labSpend";
import { pickDiagramExamples } from "../lecture-lab/diagramExamplePicker";
import { buildDiagramExampleCatalogue } from "../lecture-lab/diagramExamples";

async function main(): Promise<void> {
  assert.equal(parseOptions(["--max-usd", "10"]).spendMode, "conservative");
  assert.equal(parseOptions(["--max-usd", "10", "--spend-mode", "response_usage"]).spendMode, "response_usage");
  assert.throws(() => parseOptions(["--max-usd", "10", "--spend-mode", "invalid"]), /spend-mode/);
  assert.throws(() => assertLabSpendMode(undefined, "response_usage"), /legacy.*conservative/);
  assert.throws(() => assertLabSpendMode("response_usage", "conservative"), /identical/);
  assert.doesNotThrow(() => assertLabSpendMode(undefined, "conservative"));

  const cap = new LabSpendCap(0.4, "response_usage");
  const tracker = new PlannerUsageTracker((usd, reserved, observation, context) => cap.settleCall(reserved, usd, observation, context), "response_usage");
  assert.equal(await cap.reserveCallAsync(0.3), true);
  tracker.recordRequest("plan", 0.3, "planner", 2);
  let dispatched = false;
  const queued = cap.reserveCallAsync(0.2).then((allowed) => { dispatched = allowed; return allowed; });
  await Promise.resolve();
  assert.equal(dispatched, false, "concurrent dispatch waits until measured usage frees headroom");
  await tracker.recordResponse("plan", Response.json({ usage: {
    prompt_tokens: 1000, completion_tokens: 800, total_tokens: 1800,
    prompt_tokens_details: { cached_tokens: 500 }, completion_tokens_details: { reasoning_tokens: 100 },
  } }, { headers: { "x-heytutor-planner-model": "gpt-6-1-sol", "x-heytutor-upstream-attempts": "2" } }), 0.3, 2);
  assert.equal(await queued, true);
  const plan = tracker.finish("plan");
  assert.equal(plan.estimatedCostUsd, 0.00905, "only the response usage is charged, including cache and reasoning");
  assert.equal(plan.modelCalls[0]?.measuredCostUsd, 0.00905);
  assert.equal(plan.modelCalls[0]?.unresolvedAttempts, 1);
  assert.equal(plan.modelCalls[0]?.unresolvedAllowanceUsd, 0.15, "earlier retry exposure is visible without pricing it as paid");

  tracker.recordRequest("teach", 0.2, "teaching", 3);
  const sse = 'data: {"choices":[{"delta":{"content":"A step."}}]}\n\ndata: broken-content-chunk\n\ndata:{"choices":[],"usage":{"input":500,"output":200,"total":700}}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(sse);
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 37)); controller.enqueue(bytes.slice(37, 91));
    controller.enqueue(bytes.slice(91)); controller.close();
  } }), { headers: { "x-heytutor-model": "gpt-6-1-sol", "x-heytutor-upstream-attempts": "1" } });
  tracker.recordStreamingResponse("teach", response, 0.2, 3);
  assert.equal(await response.text(), sse, "accounting leaves the teaching stream intact");
  const teaching = await tracker.finishAsync("teach");
  assert.equal(teaching.estimatedCostUsd, 0.003, "terminal SSE usage must settle teaching cost");
  assert.equal(teaching.modelCalls[0]?.unresolvedAttempts, 0, "unused maximum retry slots are not billed");

  assert.equal(await cap.reserveCallAsync(0.1), true);
  tracker.recordRequest("missing", 0.1, "planner", 2);
  await tracker.recordResponse("missing", Response.json({ usage: { total_tokens: 10 } }, {
    headers: { "x-heytutor-planner-model": "gpt-6-1-sol", "x-heytutor-upstream-attempts": "1" },
  }), 0.1, 2);
  const missing = tracker.finish("missing");
  assert.equal(missing.modelCalls[0]?.measuredCostUsd, null, "partial or absent usage is unknown, never measured zero");
  assert.equal(missing.modelCalls[0]?.usageKnown, false);
  assert.equal(cap.summary(0, 0).chargedUsd, 0.01205);
  assert.equal(cap.summary(0, 0).unresolvedCalls.length, 2);
  assert.equal(cap.summary(0, 0).reservedUsd, 0, "historical unknown exposure does not consume settled usage cap");

  assert.equal(await cap.reserveCallAsync(0.35), true);
  const aborter = new AbortController();
  const blocked = cap.reserveCallAsync(0.1, aborter.signal);
  aborter.abort(new Error("synthetic deadline"));
  await assert.rejects(blocked, /synthetic deadline/);
  tracker.recordRequest("failure", 0.35, "teaching", 3);
  tracker.recordFailure("failure", "gpt-6-1-sol", 0.35);
  assert.equal(tracker.finish("failure").modelCalls[0]?.unresolvedAttempts, 3);
  assert.equal(cap.summary(0, 0).inFlightCalls, 0);
  assert.equal(await cap.reserveCallAsync(0.4), false, "dispatch stops before known usage plus maximum in-flight exposure exceeds cap");

  const beforeCrash = { ...cap.summary(0, 0), reservedUsd: 0.1, inFlightCalls: 1 };
  const resumed = new LabSpendCap(0.4, "response_usage");
  resumed.recordCost(restoredLabCharge(0.01205, beforeCrash, 0, "response_usage"));
  resumed.restoreUnresolvedCheckpoint(beforeCrash, "gpt-6-1-sol");
  assert.equal(resumed.summary(0, 0).chargedUsd, 0.01205, "interrupted reservations are not recast as measured spend on resume");
  assert.equal(resumed.summary(0, 0).unresolvedCalls.at(-1)?.kind, "checkpoint");
  assert.throws(() => resumed.restoreUnresolvedCheckpoint({ reservedUsd: 0.1, inFlightCalls: 1 }, "test"), /evidence/);

  const env = { LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid", AZURE_OPENAI_API_KEY: "offline-fixture", AZURE_OPENAI_DEPLOYMENT: "gpt-6-1-sol" };
  let pickerCalls = 0;
  const picker = await pickDiagramExamples([], buildDiagramExampleCatalogue([]), {
    question: "Synthetic fixture.", families: [], archetypeId: null, env, spendMode: "response_usage",
    fetchImpl: async () => {
      pickerCalls += 1;
      return Response.json({ choices: [{ message: { content: pickerCalls === 1 ? "invalid JSON" : '{"ids":[]}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 } });
    },
  });
  assert.equal(pickerCalls, 2);
  assert.equal(picker.record.estimatedCostUsd, 0.0006, "both directly metered picker attempts are priced");
  assert.equal(picker.record.knownUsageUsd, 0.0006);
  assert.equal(picker.record.unresolvedUsageCalls, 0);
  const failedPicker = await pickDiagramExamples([], buildDiagramExampleCatalogue([]), {
    question: "Synthetic fixture.", families: [], archetypeId: null, env, spendMode: "response_usage",
    fetchImpl: async () => { throw new Error("synthetic transport failure"); },
  });
  assert.equal(failedPicker.record.usageKnown, false);
  assert.equal(failedPicker.record.unresolvedUsageCalls, 1);
  assert(failedPicker.record.unresolvedAllowanceUsd! > 0);
  assert.equal(failedPicker.record.estimatedCostUsd, 0, "picker reports a known subtotal and explicit unresolved exposure");
  for (const spendMode of ["response_usage", "conservative"] as const) {
    const admissions = spendMode === "response_usage" ? ["timeout", "denied"] as const : ["denied"] as const;
    for (const admission of admissions) {
      const blockedCap = new LabSpendCap(admission === "timeout" ? 0.4 : 0.1, spendMode);
      if (admission === "timeout") assert.equal(await blockedCap.reserveCallAsync(0.3), true);
      let nativeCalls = 0;
      let costCallbacks = 0;
      const unsent = await pickDiagramExamples([], buildDiagramExampleCatalogue([]), {
        question: "Synthetic fixture.", families: [], archetypeId: null, env, spendMode,
        onModelCost: () => { costCallbacks += 1; },
        fetchImpl: async () => {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(new DOMException("Synthetic deadline", "TimeoutError")), 5);
          try {
            await reserveLabRequest(blockedCap, 0.2, abort.signal);
            nativeCalls += 1;
            return Response.json({});
          } finally { clearTimeout(timer); }
        },
      });
      assert.equal(nativeCalls, 0, `${spendMode}/${admission}: no provider dispatch`);
      assert.equal(unsent.record.status, admission === "timeout" ? "timeout" : "failed");
      assert.equal(unsent.record.attempts, 0, "unsent requests do not count as provider attempts");
      assert.equal(unsent.record.unresolvedUsageCalls, 0, "unsent picker has no possible provider charge");
      assert.equal(unsent.record.unresolvedAllowanceUsd, 0);
      assert.equal(unsent.record.estimatedCostUsd, 0);
      assert.equal(costCallbacks, 0, "unsent picker never calls the cost observer");
      assert.equal(blockedCap.summary(0, 0).chargedUsd, 0);
      assert.equal(blockedCap.summary(0, 0).unresolvedCalls.length, 0);
    }
    let retryCalls = 0;
    const unsentRetry = await pickDiagramExamples([], buildDiagramExampleCatalogue([]), {
      question: "Synthetic fixture.", families: [], archetypeId: null, env, spendMode,
      fetchImpl: async () => {
        if (++retryCalls === 1) return Response.json({ choices: [{ message: { content: "invalid JSON" } }],
          usage: { prompt_tokens: 100, completion_tokens: 10 } });
        await reserveLabRequest(new LabSpendCap(0.1, spendMode), 0.2);
        throw new Error("denied retry cannot reach the provider");
      },
    });
    assert.equal(unsentRetry.record.attempts, 1, "a denied retry preserves the earlier dispatched attempt");
    assert.equal(unsentRetry.record.usageKnownCalls, 1);
    assert.equal(unsentRetry.record.usageKnown, true);
    assert.equal(unsentRetry.record.knownUsageUsd, 0.0003);
    assert.equal(unsentRetry.record.unresolvedUsageCalls, 0);
    assert.equal(unsentRetry.record.unresolvedAllowanceUsd, 0);
  }
  await verifyPortRegressions();
  console.log("Lab response-usage checks passed (zero network/model calls).");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });


async function verifyPortRegressions(): Promise<void> {
  assert.doesNotThrow(() => assertLabUsageCheckpoint({ chargedUsd: 1 }, "conservative"));
  assert.throws(() => assertLabUsageCheckpoint({ chargedUsd: 1 }, "response_usage"), /measured/);
  assert.throws(() => assertLabUsageCheckpoint({ chargedUsd: 1, knownUsageUsd: 0.5 }, "response_usage"), /measured/);
  assert.throws(() => assertLabUsageCheckpoint({ chargedUsd: 1, knownUsageUsd: 2 }, "conservative"), /measured/);
  const provider = { provider: "azure", deployment: "gpt-6-1-sol" };
  assert.deepEqual(selectResumeProbes([{ id: "pi", question: "Find the area of radius 2 using π." }],
    [{ probeId: "pi", question: "Find the area of radius 2 using pi.", arm: "current", providerConfig: provider }], "current", provider), [],
    "non-evaluation resume accepts the same normalized question; the exact raw sample stays fingerprinted");
  const cap = new LabSpendCap(1, "response_usage");
  const tracker = new PlannerUsageTracker((usd, reserved, observation, context) => cap.settleCall(reserved, usd, observation, context), "response_usage");
  cap.reserveCall(0.2); tracker.recordRequest("aborted", 0.2);
  tracker.finish("aborted");
  cap.reserveCall(0.2); tracker.recordRequest("active", 0.2);
  await tracker.recordResponse("aborted", Response.json({ model: "gpt-6-1-sol", usage: { input: 50, output: 10 } }), 0.2);
  tracker.recordFailure("aborted", "unknown", 0.2);
  assert.equal(cap.summary(0, 0).inFlightCalls, 1, "late callbacks cannot settle another trace");
  assert.equal(cap.summary(0, 0).reservedUsd, 0.2);
  tracker.recordFailure("active", "unknown", 0.2); tracker.finish("active");
  assert.equal(cap.summary(0, 0).inFlightCalls, 0);
  assert.throws(() => tracker.recordRequest("aborted", 0.2), /finished/);
  assert.throws(() => cap.restoreKnownUsage(NaN), /invalid/);
  const cancelled = new AbortController(); cancelled.abort(new Error("already cancelled"));
  await assert.rejects(new LabSpendCap(1).reserveCallAsync(0.2, cancelled.signal), /cancelled/);

  const started: number[] = [];
  let finishSibling!: () => void;
  const sibling = new Promise<void>((resolve) => { finishSibling = resolve; });
  let roundFinished = false;
  let siblingFinished = false;
  const failingRound = runBudgetedLabRows([0, 1, 2, 3], 2, new LabSpendCap(1), async (row) => {
    started.push(row);
    if (row === 0) throw new Error("synthetic startup failure");
    await sibling;
    siblingFinished = true;
  }).then(() => { throw new Error("failure must be surfaced"); }, (error) => {
    roundFinished = true; assert.match(String(error), /startup/); assert.equal(siblingFinished, true);
  });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(roundFinished, false, "round cannot exit while an admitted sibling is running");
  finishSibling(); await failingRound;
  assert.deepEqual(started, [0, 1], "no later bank row starts after a worker rejection");

  const priorEnv = { ...process.env };
  try {
    Object.assign(process.env, { LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid", AZURE_OPENAI_API_KEY: "offline-fixture", AZURE_OPENAI_DEPLOYMENT: "st-gpt-6-sol", FIREWORKS_MAX_TOKENS: "6000", FW_SCENE_PLANNER_MAX_TOKENS: "6000" });
    assert.equal(resolveLlmRates("st-gpt-6-sol").lane, "gpt-6.1-sol");
    const server = labProviderConfig();
    assert(server.plannerOutputCap >= 6000 + 2048);
    assert(server.teachingOutputCap >= 6000 + 2048 + 4096, "server preflight bounds nondefault teaching caps and code lessons");
    assert(plannerRequestWorstCaseUsd({ body: JSON.stringify({ messages: [], max_tokens: 1 }) }, "st-gpt-6-sol", server.teachingOutputCap) >= server.teachingOutputCap * 10 / 1_000_000);
    const directBody = { body: JSON.stringify({ model: "accounts/fireworks/models/deepseek-v4p1-flash", messages: [], max_tokens: 1200 }) };
    assert.equal(directProviderRequestModel(directBody, { provider: "azure", deployment: "st-gpt-6-sol" }), "st-gpt-6-sol");
    process.env.LLM_PROVIDER = "fireworks";
    const directModel = directProviderRequestModel(directBody, { provider: "fireworks", deployment: null });
    assert.equal(directModel, "accounts/fireworks/models/deepseek-v4p1-flash");
    const cheapCeiling = plannerRequestWorstCaseUsd(directBody, directModel);
    const teachingCeiling = plannerRequestWorstCaseUsd(directBody, "accounts/fireworks/models/kimi-k3");
    assert(cheapCeiling < teachingCeiling / 10, "direct picker reservation uses its cheap model rather than teaching rates");
    const cheapPicker = await pickDiagramExamples([], buildDiagramExampleCatalogue([]), { question: "Synthetic fixture.", families: [], archetypeId: null,
      env: { LLM_PROVIDER: "fireworks", FIREWORKS_API_KEY: "offline-fixture", FIREWORKS_CHEAP_MODEL: directModel, FIREWORKS_TEACHING_MODEL: "accounts/fireworks/models/kimi-k3" }, spendMode: "response_usage",
      fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ids":[]}' } }], usage: { input: 100, output: 10 } }),
    });
    assert.equal(cheapPicker.record.knownUsageUsd, 0.000029, "picker metering uses the direct cheap model's input/output rates");
    process.env.LLM_PROVIDER = "azure";
    const streamTracker = new PlannerUsageTracker(undefined, "response_usage");
    let release!: () => void;
    let closeStream!: () => void;
    const headersReady = new Promise<void>((resolve) => { release = resolve; });
    const bytes = 'data: {"model":"gpt-6-sol","usage":{"input":100,"output":10}}\n\ndata: [DONE]\n\n';
    const original = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(bytes)); closeStream = () => controller.close();
    } }), { headers: { "x-heytutor-upstream-attempts": "1" } });
    const operation = (async () => {
      await headersReady;
      streamTracker.recordRequest("stream", 0.2, "teaching", 3);
      streamTracker.recordStreamingResponse("stream", original, 0.2, 3, "st-gpt-6-sol");
    })();
    streamTracker.trackOperation("stream", operation);
    let drained = false;
    const finishing = streamTracker.finishAsync("stream").then((value) => { drained = true; return value; });
    release(); await operation; await Promise.resolve();
    assert.equal(drained, false, "HTTP completion adds a new SSE observer wave that finish must drain");
    const consumed = original.text(); closeStream();
    const usage = await finishing;
    assert.equal(await consumed, bytes, "original stream remains byte-identical");
    assert.equal(usage.estimatedCostUsd, 0.0003);
    assert.equal(usage.modelCalls[0]?.model, "gpt-6-sol");
    assert.equal(usage.modelCalls[0]?.pricingModel, "st-gpt-6-sol", "Azure base model identity uses configured alias rates");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
    Object.assign(process.env, priorEnv);
  }

  const exceeded = new LabSpendCap(1, "response_usage");
  const exceededTracker = new PlannerUsageTracker((usd, reserved, observation, context) => exceeded.settleCall(reserved, usd, observation, context), "response_usage");
  exceeded.reserveCall(0.2); exceededTracker.recordRequest("exceeded", 0.2, "planner", 2);
  await exceededTracker.recordResponse("exceeded", Response.json({ usage: { input: 100, output: 10 } }, { headers: { "x-heytutor-planner-model": "gpt-6-1-sol", "x-heytutor-upstream-attempts": "3" } }), 0.2, 2);
  assert.equal(exceededTracker.finish("exceeded").modelCalls[0]?.unresolvedAttempts, 2, "an unexpected attempt count is retained, never clamped away");
  assert.equal(exceeded.summary(0, 0).unresolvedCalls[0]?.reason, "upstream_attempts_exceed_dispatch_ceiling");

  const request = { body: JSON.stringify({ question: "Synthetic question." }) };
  for (const admission of ["waiting_deadline", "synchronous_failure"] as const) {
    const deniedVisualCap = new LabSpendCap(0.01, "response_usage");
    assert.equal(deniedVisualCap.reserveCall(0.009), true);
    const beforeDenial = deniedVisualCap.summary(0, 0);
    const deadline = new AbortController();
    let deniedRows = 0;
    let providerAttempts = 0;
    let checkpoints = 0;
    let accountingCalls = 0;
    const assessmentPromise = fetchVisualNeedAssessment({ url: "synthetic", question: "Synthetic question.",
      signal: deadline.signal,
      fetchImpl: (input, init) => budgetedVisualNeedFetch(input, init, async () => {
        providerAttempts++;
        return Response.json({ decision: "none" });
      }, {
        reserve: (usd) => {
          if (admission === "synchronous_failure") throw new Error("synthetic admission failure");
          return deniedVisualCap.reserveCallAsync(usd, init?.signal);
        },
        spendMode: "response_usage",
        beforeDispatch: () => { checkpoints++; },
        settle: (reserved, charged, observation) => deniedVisualCap.settleCall(reserved, charged, observation),
        onAccounting: () => { accountingCalls++; },
        onDenied: () => { deniedRows++; },
      }),
    });
    if (admission === "waiting_deadline") deadline.abort(new Error("synthetic client deadline"));
    const assessment = await assessmentPromise;
    assert.equal(assessment.source, "unavailable");
    assert.equal(deniedRows, 1, `${admission}: the runner must save an untested_budget row instead of grading the unavailable result`);
    assert.equal(providerAttempts, 0);
    assert.equal(checkpoints, 0);
    assert.equal(accountingCalls, 0);
    assert.deepEqual(deniedVisualCap.summary(0, 0), beforeDenial, "a request denied before sending creates no usage or unresolved exposure");
  }
  const visualCap = new LabSpendCap(0.01, "response_usage");
  visualCap.reserveCall(0.009);
  let sent = 0;
  const records: VisualNeedCallAccounting[] = [];
  const hooks = {
    reserve: (usd: number) => visualCap.reserveCallAsync(usd), spendMode: "response_usage" as const,
    beforeDispatch: () => {},
    settle: (reserved: number, charged: number, observation?: Parameters<LabSpendCap["settleCall"]>[2]) => visualCap.settleCall(reserved, charged, observation, { traceId: "visual", kind: "visual_need" }),
    onAccounting: (record: VisualNeedCallAccounting) => { records.push(record); },
    onDenied: () => { throw new Error("temporary headroom must wait"); },
  };
  const awaitingHeadroom = budgetedVisualNeedFetch("synthetic", request, async () => {
    sent++;
    return Response.json({ decision: "none", usage: { knownUsage: true, inputTokens: 1200, outputTokens: 0,
      estimatedUsd: 0.0000504, reportedCostUsd: null }, provenance: { model: "typesafe-ai/jev", rubricVersion: "visual-need/v1",
      policyVersion: "advisory/v1", inputHash: "synthetic", latencyMs: 12, gatewayModel: null, generationId: null } });
  }, hooks);
  await Promise.resolve();
  assert.equal(sent, 0); assert.equal(visualCap.canStartRow(), true, "busy headroom does not stop response-mode visual admission");
  visualCap.settleCall(0.009, 0.0005, { model: "fixture", measuredUsd: 0.0005, unresolvedAttempts: 0, unresolvedAllowanceUsd: 0, reason: null });
  await awaitingHeadroom;
  assert.equal(sent, 1); assert.equal(visualCap.summary(0, 0).reservedUsd, 0);
  assert.equal(records[0]?.measuredCostUsd, 0.00005);
  assert.equal(visualCap.summary(0, 0).knownUsageUsd, 0.00055);
  await budgetedVisualNeedFetch("synthetic", request, async () => Response.json({ source: "unavailable", unavailableReason: "deadline" }), hooks);
  assert.equal(records[1]?.chargedUsd, 0); assert.equal(records[1]?.measuredCostUsd, null);
  assert.equal(records[1]?.unresolvedAllowanceUsd, visualNeedRequestWorstCaseUsd(request));
  assert.equal(visualCap.summary(0, 0).unresolvedCalls.at(-1)?.kind, "visual_need");
  assert.equal(summarizeVisualNeedCalls(records).unknownUsageCalls, 1);
  await budgetedVisualNeedFetch("synthetic", request, async () => Response.json({ source: "unavailable", unavailableReason: "missing_key" }), hooks);
  assert.equal(records[2]?.chargedUsd, 0); assert.equal(records[2]?.measuredCostUsd, 0, "proved no dispatch needs no missing-usage allowance");
  assert.equal(visualCap.summary(0, 0).unresolvedCalls.length, 1);
}
