import assert from "node:assert/strict";
import { fetchVisualNeed, fetchVisualNeedAssessment } from "../../features/tutor-session/lib/scene/visualNeedClient";
import { LabSpendCap } from "../lecture-lab/run";
import { runLecture } from "../lecture-lab/lecturePipeline";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { budgetedVisualNeedFetch, visualNeedRequestWorstCaseUsd, visualNeedQuestionHash,
  parseVisualNeedReplay, visualNeedActionChange, compareVisualNeedAudit } from "../lecture-lab/labVisualNeed";

async function main(): Promise<void> {
  const reply = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch;
  const unavailable = await fetchVisualNeedAssessment({ url: "synthetic", question: "Synthetic question.",
    fetchImpl: reply({ decision: null, source: "unavailable", unavailableReason: "circuit_open" }) });
  assert.equal(unavailable.decision, null);
  assert.equal(unavailable.source, "unavailable");
  assert.equal(unavailable.unavailableReason, "circuit_open", "service failure must not be recorded as a no-figure vote");
  const explicitNone = await fetchVisualNeedAssessment({ url: "synthetic", question: "Synthetic question.",
    fetchImpl: reply({ decision: "none", source: "jev", usage: { knownUsage: true, inputTokens: 1200, outputTokens: 0,
      estimatedUsd: 0.0000504, reportedCostUsd: null }, provenance: { model: "typesafe-ai/jev", rubricVersion: "visual-need/v1",
      policyVersion: "advisory/v1", inputHash: "synthetic", latencyMs: 12, gatewayModel: null, generationId: null } }) });
  assert.equal(explicitNone.decision, "none");
  assert.equal(explicitNone.source, "jev");
  assert.equal(explicitNone.unavailableReason, null);
  assert.equal(explicitNone.usage?.knownUsage, true);
  assert.equal(explicitNone.provenance?.model, "typesafe-ai/jev");
  assert.equal(await fetchVisualNeed({ url: "synthetic", question: "Synthetic question.",
    fetchImpl: reply({ decision: "none" }) }), "none", "the live compatibility wrapper preserves its existing answer");
  const malformed = await fetchVisualNeedAssessment({ url: "synthetic", question: "Synthetic question.",
    fetchImpl: reply({ decision: "draw whatever", source: "jev" }) });
  assert.equal(malformed.decision, null);
  assert.equal(malformed.unavailableReason, "invalid_response");
  const denied = await fetchVisualNeedAssessment({ url: "synthetic", question: "Synthetic question.", fetchImpl: reply({}, 401) });
  assert.equal(denied.unavailableReason, "http_401");
  const controller = new AbortController(); controller.abort();
  const aborted = await fetchVisualNeedAssessment({ url: "synthetic", question: "Synthetic question.", signal: controller.signal,
    fetchImpl: async () => { throw new DOMException("aborted", "AbortError"); } });
  assert.equal(aborted.unavailableReason, "aborted");
  const originalTimeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = () => { throw new Error("unsupported timeout"); };
    assert.equal((await fetchVisualNeedAssessment({ url: "synthetic", question: "Synthetic question.",
      fetchImpl: reply({ decision: "required" }) })).unavailableReason, "transport",
    "the existing live client fails closed if timeout creation itself fails");
  } finally { AbortSignal.timeout = originalTimeout; }
  const request = { body: JSON.stringify({ question: "Synthetic question." }) };
  const ceiling = visualNeedRequestWorstCaseUsd(request);
  assert(ceiling > 0.002);
  let dispatched = 0;
  const deniedCap = new LabSpendCap(0.001);
  await assert.rejects(() => budgetedVisualNeedFetch("synthetic", request, async () => {
    dispatched += 1; return Response.json({});
  }, { reserve: (usd) => deniedCap.reserveCall(usd), beforeDispatch: () => {},
    settle: (reserved, charged) => deniedCap.settleCall(reserved, charged), onAccounting: () => {}, onDenied: () => {} }), /max-usd/);
  assert.equal(dispatched, 0, "Jev cannot bypass the hard cap");
  const unknownCap = new LabSpendCap(1);
  await budgetedVisualNeedFetch("synthetic", request, reply({ decision: null, source: "unavailable", unavailableReason: "deadline" }), {
    reserve: (usd) => unknownCap.reserveCall(usd), beforeDispatch: () => {},
    settle: (reserved, charged) => unknownCap.settleCall(reserved, charged), onAccounting: () => {}, onDenied: () => {},
  });
  assert.equal(unknownCap.summary(0, 0).chargedUsd, Math.round(ceiling * 1e6) / 1e6, "unknown dispatched usage retains its full reservation");
  assert.equal(visualNeedActionChange("none", "required", false), "allow_previously_skipped");
  assert.equal(visualNeedActionChange("optional", "none", true), "skip_previously_drawn");
  assert.equal(visualNeedActionChange("optional", "required", false), null, "a stronger vote alone does not establish changed admission");
  assert.equal(visualNeedActionChange(null, "required", false), null, "untested historical rows are not planner-none rows");
  const frozen = { id: "synthetic", questionHash: visualNeedQuestionHash("Synthetic question."),
    evidenceVersion: "live-visual-need/v1", model: "typesafe-ai/jev", rubricVersion: "visual-need/v1", policyVersion: "advisory/v1",
    clientTimeoutMs: 3000, serverTimeoutMs: 2400, assessment: explicitNone };
  assert.equal(parseVisualNeedReplay(JSON.stringify(frozen), [{ id: "synthetic", question: "Synthetic question." }]).get("synthetic")?.decision, "none");
  assert.throws(() => parseVisualNeedReplay(JSON.stringify(frozen), [{ id: "synthetic", question: "Different question." }]), /question/);
  assert.throws(() => parseVisualNeedReplay(JSON.stringify({ ...frozen, model: "other" }), [{ id: "synthetic", question: "Synthetic question." }]), /policy|model/);
  assert.throws(() => parseVisualNeedReplay(JSON.stringify(frozen) + "\n" + JSON.stringify(frozen), []), /duplicate/);
  const audited = compareVisualNeedAudit([{ id: "synthetic", question: "Synthetic question.", subject: "maths", figure_need: "optional" as const }],
    new Map([["synthetic", explicitNone]]), { current: new Map([["synthetic", {
      question: "Synthetic question.", requirement: "optional" as const, committed: true }]]), strict: new Map() });
  assert.equal(audited.summary.byArm.current?.skipPreviouslyDrawn, 1);
  assert.equal(audited.summary.byArm.strict?.missingHistorical, 1);
  assert.equal(audited.changedRows.length, 1, "the union reruns both arms, even when only one original arm changed");
  assert.equal(audited.records.find((row) => row.arm === "strict")?.mergedRequirement, null);
  const nativeFetch = globalThis.fetch;
  const events: string[] = [];
  const question = "Explain the meaning of a dimensionless ratio.";
  let releaseJev: (() => void) | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/visual-need")) {
      events.push("jev_start");
      await new Promise<void>((resolve) => { releaseJev = resolve; });
      events.push("jev_done");
      return Response.json({ decision: "none", source: "jev" });
    }
    if (new Headers(init?.headers).get("x-turn-planner-version") === "3") {
      events.push("planner_start"); releaseJev?.();
      return Response.json({ choices: [{ message: { content: JSON.stringify({ ...createFallbackTurnPlanV3(question), visualRequirement: "optional" }) } }] });
    }
    throw new Error("merged none must not dispatch a scene, picker or teaching request in a figure-only test");
  };
  try {
    const live = await runLecture(question, { origin: "http://synthetic", cookie: "", figureOnly: true });
    assert.equal(live.visualNeed?.plannerRequirement, "optional");
    assert.equal(live.visualNeed?.assessment.decision, "none");
    assert.equal(live.visualNeed?.mergedRequirement, "none");
    assert.equal(live.plan?.visualRequirement, "none");
    assert.equal(live.diagram.committed, false);
    assert(events.indexOf("jev_start") < events.indexOf("planner_start") && events.indexOf("planner_start") < events.indexOf("jev_done"),
      "Jev runs beside the turn planner, not serially after it");
    events.length = 0;
    const replayed = await runLecture(question, { origin: "http://synthetic", cookie: "", figureOnly: true, visualNeedReplay: explicitNone });
    assert.equal(replayed.visualNeed?.origin, "frozen_replay");
    assert.equal(replayed.plan?.visualRequirement, "none");
    assert(!events.includes("jev_start"), "frozen replay never silently pays for another Jev call");
  } finally { globalThis.fetch = nativeFetch; }
  console.log("lab visual-need evidence: shared live answer, typed usage and unavailable reasons pass (mocked)");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
