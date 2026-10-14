/** Harness 1: the actual repair transport must explain the failing input, not IDs alone. */
import assert from "node:assert/strict";
import { planSceneDocumentWithRepair, repairSceneDocument, revalidateScenePlanWithRepairResult, type SceneRepairError, type SceneRepairRequestEvidence } from "../../src/planners/scenePlannerV2";

const originalFetch = globalThis.fetch;
const candidate = {
  schemaVersion: "scene-document/v2", source: { question: "Construct the stated ellipse." },
  constructions: [{ id: "curve-build", operator: "conic", outputs: ["curve"],
    inputs: { kind: "ellipse", center: "centre", a: "axis-a", b: "axis-b", tMin: "bad-angle-27", tMax: "end-angle" } }],
  entities: [{ id: "curve", kind: "curve" }],
};
const errors: SceneRepairError[] = [{
  code: "invalid_conic_tMin", severity: "fatal", path: "constructions[0].inputs.tMin", entityIds: ["curve"],
  message: "tMin must resolve to a finite angle in radians.", expected: "finite radian quantity", actual: "bad-angle-27",
}];
const prompts: string[] = [];
globalThis.fetch = (async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
  prompts.push(body.messages.at(-1)!.content);
  return Response.json({ choices: [{ message: { content: JSON.stringify(candidate) } }] });
}) as typeof fetch;
const options = { proxyUrl: "https://repair-fixture.invalid", constructionOperators: ["conic", "point"], repairRecoveryEnabled: false };

async function verifyStagnationRecovery(enabled: boolean) {
  const calls: Array<{ phase: string; lane: string; deadline: number }> = [];
  const budget = { remaining: 6 };
  const repairRequests: Array<{ seedRequestId?: string; requestId: string }> = [];
  let planCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    const phase = headers.get("x-scene-planner-phase")!;
    calls.push({ phase, lane: headers.get("x-scene-planner-lane")!, deadline: Number(headers.get("x-planner-deadline-ms")) });
    if (phase === "plan") planCalls++;
    const document = phase === "plan" && planCalls > 2 ? { ...candidate, recovered: true } : candidate;
    return Response.json({ choices: [{ message: { content: JSON.stringify(document) } }] });
  }) as typeof fetch;
  const result = await planSceneDocumentWithRepair(candidate.source.question,
    (document) => document.recovered ? { valid: true, errors: [], value: document } : { valid: false, errors },
    { ...options, repairRecoveryEnabled: enabled, timeoutMs: 60_000, maxConcurrentRequests: 2, requestBudget: budget,
      onRepairRequest: (request) => { if (request.requestContext) repairRequests.push(request.requestContext); } });
  assert.ok(repairRequests.every((request) => request.seedRequestId), "each repair records the exact generating seed");
  assert.equal(new Set(result?.candidates.map((entry) => entry.response.requestContext?.requestId)).size,
    result?.candidates.length, "repeated lanes have unique request IDs");
  assert.ok(calls.every((call) => call.deadline <= 30_000 && call.deadline > 0), "every replacement stays in the shared production deadline");
  if (!enabled) {
    assert.equal(calls.filter((call) => call.phase === "repair").length, 4, "off retains two legacy repair batches");
    assert.equal(planCalls, 2, "off never adds a fresh candidate for invalid output");
    assert.equal(result?.validation.valid, false);
  } else {
    assert.equal(calls.filter((call) => call.phase === "repair").length, 2, "an unchanged fully failed batch is not repeated");
    assert.equal(planCalls, 3, "the remaining round buys one fresh fully validated candidate");
    assert.equal(result?.validation.valid, true);
    assert.equal(result?.selectedFromRepair, false, "fresh is planning, not a repaired-fragment certification");
    assert.equal(budget.remaining, 1, "fresh replaces two repair calls without expanding the six-call budget");
    assert.equal(result.repairRounds, 1, "fresh is not reported as a repair round");
    const revalidated = await revalidateScenePlanWithRepairResult(result, () => ({ valid: false, errors }));
    assert.equal(revalidated.validation.valid, false, "fresh must still pass final authority revalidation");
  }
}

async function verifyRecoveryGuards() {
  for (const scenario of ["inputs", "target", "rule", "expected", "actual", "residual", "details", "warning", "untargeted", "null-peer", "valid-peer", "short-budget"] as const) {
    let plans = 0;
    let repairs = 0;
    let validations = 0;
    globalThis.fetch = (async (_input, init) => {
      const phase = new Headers(init?.headers).get("x-scene-planner-phase");
      if (phase === "plan") plans++; else repairs++;
      const document = phase === "repair" && scenario === "inputs"
        ? { ...candidate, constructions: [{ ...candidate.constructions[0], inputs: { ...candidate.constructions[0]!.inputs, tMin: "corrected-angle" } }] }
        : candidate;
      return Response.json({ choices: [{ message: { content:
        phase === "repair" && repairs === 2 && scenario === "null-peer" ? "not-json" : JSON.stringify(document) } }] });
    }) as typeof fetch;
    const budget = { remaining: scenario === "short-budget" ? 4 : 6 };
    const result = await planSceneDocumentWithRepair(candidate.source.question, () => {
      validations++;
      if (scenario === "valid-peer" && validations === 4) return { valid: true, errors: [] };
      const error = { ...errors[0]! };
      if (scenario === "untargeted") { delete error.path; delete error.entityIds; }
      if (scenario === "warning") error.severity = "warning";
      if (validations > 2) {
        if (scenario === "target") error.path = "constructions[0].inputs.tMax";
        if (scenario === "rule") error.message = "A different precise rule.";
        if (scenario === "expected") error.expected = "another quantity";
        if (scenario === "actual") error.actual = "another-angle";
        if (scenario === "residual") error.residual = 0.01;
        if (scenario === "details") error.details = { changed: true };
      }
      return { valid: false, errors: [error] };
    }, { ...options, repairRecoveryEnabled: true, requestBudget: budget, maxConcurrentRequests: 2 });
    assert.equal(plans, 2, `${scenario}: insufficient evidence of stagnation cannot add fresh planning`);
    assert.equal(repairs, scenario === "valid-peer" || scenario === "short-budget" ? 2 : 4,
      `${scenario}: progress, missing evidence and valid peers retain legacy admission`);
    assert.equal(result?.validation.valid, scenario === "valid-peer");
    assert.ok(budget.remaining >= 0, `${scenario}: no request budget overrun`);
  }
}

async function verifyFeedbackBounds() {
  globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: JSON.stringify(candidate) } }] })) as typeof fetch;
  for (const target of ["constructions[0].inputs.tMin", "constructions.0.inputs.tMin", "/constructions/0/inputs/tMin", undefined]) {
    const requests: SceneRepairRequestEvidence[] = [];
    await repairSceneDocument(candidate.source.question, candidate, [{ ...errors[0]!, path: target }], {
      ...options, repairRecoveryEnabled: true, onRepairRequest: (request) => { requests.push(request); },
    });
    const feedback = requests[0]!.previousStructure.failingElements as Array<{ field: string; node: unknown }>;
    assert.ok(feedback.some((entry) => entry.field === "constructions" && JSON.stringify(entry.node).includes("bad-angle-27")),
      `${target ?? "output entity ID"}: exact failing arguments are visible`);
  }
  const idRequests: SceneRepairRequestEvidence[] = [];
  await repairSceneDocument(candidate.source.question, candidate, [{ ...errors[0]!,
    code: "normal_must_be_constructed", path: "constructions.curve-build.inputs.normal", entityIds: undefined,
  }], { ...options, repairRecoveryEnabled: true, onRepairRequest: (request) => { idRequests.push(request); } });
  assert.ok(JSON.stringify(idRequests[0]!.previousStructure.failingElements).includes("bad-angle-27"),
    "production construction-ID paths without entityIds retain exact failing inputs");
  const many = { ...candidate, constructions: Array.from({ length: 12 }, (_, index) => ({
    id: `build-${index}`, operator: "conic", inputs: { note: "🧪".repeat(index === 11 ? 800 : 220) }, outputs: [`curve-${index}`],
  })) };
  const before = JSON.stringify(many);
  const requests: SceneRepairRequestEvidence[] = [];
  await repairSceneDocument(candidate.source.question, many, many.constructions.map((entry) => ({
    ...errors[0]!, path: undefined, entityIds: entry.outputs,
  })), { ...options, repairRecoveryEnabled: true, onRepairRequest: (request) => { requests.push(request); } });
  const feedback = requests[0]!.previousStructure.failingElements as Array<{ node?: unknown; nodeOmitted?: boolean }>;
  assert.equal(feedback.length, 12, "every failing target remains identified even when its raw node is omitted");
  const bytes = feedback.reduce((sum, entry) => sum + (entry.node ? Buffer.byteLength(JSON.stringify(entry.node)) : 0), 0);
  assert.ok(bytes <= 6_000, "raw element feedback has a shared UTF-8 byte budget");
  assert.ok(feedback.filter((entry) => entry.node).every((entry) => Buffer.byteLength(JSON.stringify(entry.node)) <= 2_048));
  assert.ok(feedback.at(-1)?.nodeOmitted, "oversized node is explicitly omitted, not malformed/truncated");
  assert.equal(JSON.stringify(many), before, "feedback never mutates the candidate");
  await repairSceneDocument(candidate.source.question, candidate, errors,
    { ...options, repairRecoveryEnabled: true, onRepairRequest: () => { throw new Error("private observer failed"); } });
}

async function main(): Promise<void> {
  try {
    await repairSceneDocument(candidate.source.question, candidate, errors, options);
    await repairSceneDocument(candidate.source.question, candidate, errors,
      { ...options, repairRecoveryEnabled: true });
    assert.ok(!prompts[0]!.includes('"tMin":"bad-angle-27"'), "off preserves the legacy structure-only prompt");
    assert.ok(prompts[1]!.includes('"id":"curve-build"'), "feedback identifies the failing construction");
    assert.ok(prompts[1]!.includes('"tMin":"bad-angle-27"'), "repair can inspect the exact failing construction inputs");
    for (const fact of [errors[0]!.code, errors[0]!.path!, errors[0]!.message, "finite radian quantity"]) {
      assert.ok(prompts[1]!.includes(fact), `repair retains the exact validator rule: ${fact}`);
    }
    assert.deepEqual(errors[0]!.entityIds, ["curve"], "feedback does not rewrite validator ownership");
    assert.equal(candidate.constructions[0]!.inputs.tMin, "bad-angle-27", "feedback does not patch invalid geometry");
    await verifyStagnationRecovery(false);
    await verifyStagnationRecovery(true);
    await verifyRecoveryGuards();
    await verifyFeedbackBounds();
    console.log("scene repair recovery: exact failing element/input/rule feedback and unchanged off path pass");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
