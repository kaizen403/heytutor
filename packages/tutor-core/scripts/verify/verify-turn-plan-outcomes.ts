import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import * as sceneEngine from "@heytutor/scene-engine";
import * as sourcePlanner from "../../src/planners/turnPlannerV3";
import * as fastMode from "../../src/llm/fastMode";
import * as traceHeaders from "../../src/llm/traceHeaders";
import * as debug from "../../src/tutorDebug";
import * as capabilities from "../../src/planners/sceneCapabilities";
import * as optics from "../../src/planners/opticsPlanAudit";
import * as subject from "../../src/planners/diagramSubject";
import * as framing from "../../src/planners/turnPlanJson";
import type { TurnPlanRequestOutcome } from "../../src/planners/turnPlannerV3";

async function plannerUnderTest(): Promise<typeof sourcePlanner> {
  const path = join(process.cwd(), "src/planners/turnPlannerV3.ts");
  if (process.argv.includes("--built-package")) return import("@heytutor/tutor-core");
  if (!process.argv.includes("--mutate-planner-callback")) return sourcePlanner;
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  let mutations = 0;
  const transform = ts.transform(source, [(context) => (root) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "observer" &&
        node.initializer?.getText(source) === "options.onRequestOutcome") {
        mutations += 1;
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, ts.factory.createIdentifier("undefined"));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  assert.equal(mutations, 1, "mutation must remove the actual source notification, not the test adapter");
  const code = ts.transpileModule(ts.createPrinter().printFile(transform.transformed[0]!), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  transform.dispose();
  const compiledModule = { exports: {} };
  // ESM-only dependencies are the actual source namespaces, not mocked behavior.
  const dependencies: Record<string, unknown> = { "@heytutor/scene-engine": sceneEngine,
    "../llm/fastMode": fastMode, "../llm/traceHeaders": traceHeaders, "../tutorDebug": debug,
    "./sceneCapabilities": capabilities, "./opticsPlanAudit": optics, "./diagramSubject": subject,
    "./turnPlanJson": framing };
  const seed = { module: compiledModule, exports: compiledModule.exports, require: (id: string) => {
    assert.ok(id in dependencies, "mutant dependencies must remain actual existing source modules");
    return dependencies[id];
  }, console, process,
    Date, Error, DOMException, AbortController, AbortSignal, setTimeout, clearTimeout, structuredClone };
  Object.defineProperty(seed, "fetch", { get: () => globalThis.fetch });
  new Script(code, { filename: path }).runInContext(createContext(seed));
  return compiledModule.exports as typeof sourcePlanner;
}

const { planTurnV3, auditTurnPlanV3 } = await plannerUnderTest();

const originalFetch = globalThis.fetch;
const question = "Explain a public test concept.";
const plan = {
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [],
  derived: [],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
  visualRequirement: "none",
} satisfies TurnPlanV3;

function response(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

try {
  const outcomes: TurnPlanRequestOutcome[] = [];
  globalThis.fetch = async () => response(JSON.stringify(plan));
  const result = await planTurnV3(question, {
    proxyUrl: "http://planner.test",
    timeoutMs: 1_000,
    onRequestOutcome: (outcome) => outcomes.push(outcome),
  });
  assert.ok(result, "a valid TurnPlan remains admitted");
  assert.equal(outcomes.length, 2, "each actual initial attempt reports one content-free completion");
  assert.deepEqual(outcomes.map(({ requestKind, lane, httpStatus, code, issueCodes, unrecognizedIssueCount }) =>
    ({ requestKind, lane, httpStatus, code, issueCodes, unrecognizedIssueCount })), [
    { requestKind: "initial", lane: "primary", httpStatus: 200, code: "accepted", issueCodes: [], unrecognizedIssueCount: 0 },
    { requestKind: "initial", lane: "alternate", httpStatus: 200, code: "accepted", issueCodes: [], unrecognizedIssueCount: 0 },
  ]);
  assert.ok(outcomes.every(({ elapsedMs }) => typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0));
  const rejected: TurnPlanRequestOutcome[] = [];
  const privateSentinel = "private-fixture-quantity-and-message";
  globalThis.fetch = async () => response(JSON.stringify({
    ...plan, unknowns: [{ id: privateSentinel, symbol: privateSentinel }],
  }));
  const nullPlan = await planTurnV3(question, {
    proxyUrl: "http://planner.test", timeoutMs: 1_000,
    onRequestOutcome: (outcome) => rejected.push(outcome),
  });
  assert.equal(nullPlan, null, "invalid requested results still fail closed");
  assert.equal(rejected.length, 3, "two rejected initial lanes preserve the one existing retry");
  assert.deepEqual(rejected.map(({ requestKind, code, issueCodes }) => ({ requestKind, code, issueCodes })), [
    { requestKind: "initial", code: "plan_validation_failed", issueCodes: ["unresolved_numeric_unknown"] },
    { requestKind: "initial", code: "plan_validation_failed", issueCodes: ["unresolved_numeric_unknown"] },
    { requestKind: "retry", code: "plan_validation_failed", issueCodes: ["unresolved_numeric_unknown"] },
  ]);
  assert.ok(!JSON.stringify(rejected).includes(privateSentinel), "diagnostics exclude quantity IDs and validator messages");
  for (const [code, makeResponse] of [
    ["content_missing", () => response(null)],
    ["http_error", () => response({ privateSentinel }, 429)],
    ["response_json_failed", () => new Response(`invalid-envelope-${privateSentinel}`)],
    ["plan_json_missing", () => response(`no-object-${privateSentinel}`)],
    ["plan_json_invalid", () => response(`{invalid-object-${privateSentinel}}`)],
  ] as const) {
    const failed: TurnPlanRequestOutcome[] = [];
    globalThis.fetch = async () => makeResponse();
    assert.equal(await planTurnV3(question, {
      proxyUrl: "http://planner.test", timeoutMs: 1_000,
      onRequestOutcome: (outcome) => failed.push(outcome),
    }), null);
    assert.equal(failed.length, 3, `${code}: only the existing finite attempts run`);
    assert.ok(failed.every((outcome) => outcome.code === code), `${code}: actual rejected stage survives HTTP completion`);
    assert.ok(!JSON.stringify(failed).includes(privateSentinel), `${code}: never serialize private response/exception text`);
  }
  // The retry deadline is elapsed-time dependent; compare byte parity at one controlled clock.
  const originalClock = Date.now;
  Date.now = () => 10_000;
  try { for (const succeeds of [true, false]) {
    let reference: { plan: unknown; requests: string[] } | undefined;
    for (const mode of ["absent", "enabled", "throwing"] as const) {
      const requests: string[] = [];
      const observed: TurnPlanRequestOutcome[] = [];
      globalThis.fetch = async (_url, init) => {
        requests.push(createHash("sha256").update(JSON.stringify({
          headers: [...new Headers(init?.headers).entries()], body: init?.body,
        })).digest("hex"));
        return response(JSON.stringify(succeeds ? plan : { ...plan, unknowns: [{ id: privateSentinel }] }));
      };
      const result = await planTurnV3(question, {
        proxyUrl: "http://planner.test", timeoutMs: 1_000,
        ...(mode === "absent" ? {} : { onRequestOutcome: (outcome: TurnPlanRequestOutcome) => {
          observed.push(outcome);
          if (mode === "throwing") throw new Error(privateSentinel);
        } }),
      });
      const captured = { plan: result?.turnPlan ?? null, requests };
      if (reference) assert.deepEqual(captured, reference, "observer cannot change HTTP bytes, finite calls, or admission");
      else reference = captured;
      assert.equal(requests.length, succeeds ? 2 : 3);
      assert.equal(observed.length, mode === "absent" ? 0 : requests.length);
    }
  } } finally { Date.now = originalClock; }

  const auditOutcomes: TurnPlanRequestOutcome[] = [];
  globalThis.fetch = async () => response(JSON.stringify(plan));
  assert.ok(await auditTurnPlanV3(question, plan, {
    proxyUrl: "http://planner.test", timeoutMs: 1_000,
    onRequestOutcome: (outcome) => auditOutcomes.push(outcome),
  }));
  assert.equal(auditOutcomes.length, 1);
  assert.deepEqual([auditOutcomes[0]?.phase, auditOutcomes[0]?.lane, auditOutcomes[0]?.requestKind, auditOutcomes[0]?.code],
    ["audit", "alternate", "audit", "accepted"]);

  const mixed: TurnPlanRequestOutcome[] = [];
  globalThis.fetch = async (_url, init) => response(new Headers(init?.headers).get("x-turn-planner-lane") === "primary"
    ? JSON.stringify(plan) : JSON.stringify({ ...plan, unknowns: [{ id: privateSentinel }] }));
  assert.ok(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1_000,
    onRequestOutcome: (outcome) => mixed.push(outcome) }));
  assert.deepEqual(mixed.map(({ code }) => code), ["accepted", "plan_validation_failed"]);

  const mirrorQuestion = "An object is 6 cm in front of a concave mirror of focal length 12 cm. Find the image distance.";
  const mirror = { ...plan, question: mirrorQuestion,
    givens: [
      { id: "u", symbol: "u", value: -6, unit: "cm", provenance: "given", sign: "negative" },
      { id: "f", symbol: "f", value: -12, unit: "cm", provenance: "given", sign: "negative" },
    ],
    unknowns: [{ id: "v", symbol: "v", unit: "cm" }],
    derived: [{ id: "v", symbol: "v", value: 4, unit: "cm", provenance: "derived", dependsOn: ["u", "f"] }],
    lawIds: ["mirror formula"], visualRequirement: "required",
  };
  const optics: TurnPlanRequestOutcome[] = [];
  globalThis.fetch = async () => response(JSON.stringify(mirror));
  assert.equal(await planTurnV3(mirrorQuestion, { proxyUrl: "http://planner.test", timeoutMs: 1_000,
    onRequestOutcome: (outcome) => optics.push(outcome) }), null);
  assert.ok(optics.every(({ code, issueCodes }) => code === "optics_law_mismatch" && issueCodes.includes("optics_law_mismatch")));

  const network: TurnPlanRequestOutcome[] = [];
  globalThis.fetch = async () => { throw new Error(privateSentinel); };
  assert.equal(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1_000,
    onRequestOutcome: (outcome) => network.push(outcome) }), null);
  assert.ok(network.every(({ httpStatus, code }) => httpStatus === null && code === "transport_failed"));
  assert.ok(!JSON.stringify(network).includes(privateSentinel));

  for (const cancelled of [false, true]) {
    const controller = new AbortController();
    const aborted: TurnPlanRequestOutcome[] = [];
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const fail = () => reject(new DOMException(privateSentinel, "AbortError"));
      if (signal?.aborted) fail();
      else signal?.addEventListener("abort", fail, { once: true });
    });
    const cancelTimer = cancelled ? setTimeout(() => controller.abort(), 5) : undefined;
    try {
      assert.equal(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: cancelled ? 1_000 : 20,
        ...(cancelled ? { signal: controller.signal } : {}), onRequestOutcome: (outcome) => aborted.push(outcome) }), null);
      assert.equal(aborted.length, cancelled ? 3 : 2, "cancellation preserves the existing retry/deadline policy");
      assert.ok(aborted.every(({ code }) => code === (cancelled ? "cancelled" : "timeout")));
      assert.ok(!JSON.stringify(aborted).includes(privateSentinel));
    } finally { clearTimeout(cancelTimer); }
  }
  const safeStatuses: TurnPlanRequestOutcome[] = [];
  globalThis.fetch = async () => {
    const value = response(JSON.stringify(plan));
    Object.defineProperty(value, "status", { get: () => { throw new Error(privateSentinel); } });
    return value;
  };
  assert.ok(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1_000,
    onRequestOutcome: (outcome) => safeStatuses.push(outcome) }));
  assert.ok(safeStatuses.every(({ code, httpStatus }) => code === "accepted" && httpStatus === null));
  for (const unreadable of ["nonfinite", "throwing"] as const) {
    const originalClock = Date.now;
    let reads = 0;
    const unknownClock: TurnPlanRequestOutcome[] = [];
    Date.now = () => {
      if (unreadable === "nonfinite") return Number.NaN;
      if (++reads === 3) throw new Error(privateSentinel);
      return 10_000;
    };
    globalThis.fetch = async () => response(JSON.stringify(plan));
    try {
      assert.ok(await auditTurnPlanV3(question, plan, { proxyUrl: "http://planner.test", timeoutMs: 1_000,
        onRequestOutcome: (outcome) => unknownClock.push(outcome) }), "diagnostic clock cannot change admission");
      assert.equal(unknownClock[0]?.elapsedMs, null, "unreadable elapsed clock stays unknown rather than fabricated zero");
      assert.equal(unknownClock[0]?.code, "accepted");
    } finally { Date.now = originalClock; }
  }

  const late: TurnPlanRequestOutcome[] = [];
  let peerSettled = false;
  globalThis.fetch = async (_url, init) => {
    if (new Headers(init?.headers).get("x-turn-planner-lane") === "primary") return response(JSON.stringify(plan));
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => {
      setTimeout(() => { peerSettled = true; reject(new DOMException(privateSentinel, "AbortError")); }, 30);
    }, { once: true }));
  };
  const earlyWinner = await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 5_000,
    onRequestOutcome: (outcome) => late.push(outcome) });
  assert.ok(earlyWinner);
  assert.equal(peerSettled, false, "optional diagnostics add no peer drain to the existing selection path");
  assert.equal(late.length, 1, "the returned winner may have incomplete observed attempt coverage");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(late.map(({ code }) => code), ["accepted", "cancelled"]);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  globalThis.fetch = async () => response(JSON.stringify(plan));
  try {
    assert.ok(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1_000,
      onRequestOutcome: async () => { throw new Error(privateSentinel); } }), "an async diagnostic sink is never awaited");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled.length, 0, "void-compatible async sink rejection must also be isolated");
  } finally { process.off("unhandledRejection", onUnhandled); }
  const responseTail: TurnPlanRequestOutcome[] = [];
  globalThis.fetch = async () => {
    const value = response(JSON.stringify(plan));
    Object.defineProperty(value, "headers", { get: () => { throw new Error(privateSentinel); } });
    return value;
  };
  assert.equal(await planTurnV3(question, { proxyUrl: "http://planner.test", timeoutMs: 1_000,
    onRequestOutcome: (outcome) => responseTail.push(outcome) }), null, "the existing response-tail failure remains rejected");
  assert.equal(responseTail.length, 3);
  assert.ok(responseTail.every(({ code }) => code === "plan_processing_failed"), "HTTP-200 null is not called accepted when response construction fails");
  assert.deepEqual(Object.keys(outcomes[0]!).sort(),
    ["code", "elapsedMs", "httpStatus", "issueCodes", "lane", "phase", "requestKind", "unrecognizedIssueCount"]);
  console.log("TurnPlan content-free outcomes passed: 25 scenarios.");
} finally {
  globalThis.fetch = originalFetch;
}
