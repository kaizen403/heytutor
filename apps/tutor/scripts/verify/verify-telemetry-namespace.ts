import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock, test } from "node:test";

Object.assign(process.env, {
  LANGFUSE_ENABLED: "1", LANGFUSE_PUBLIC_KEY: "fake-public-key",
  LANGFUSE_SECRET_KEY: "fake-secret-key", LANGFUSE_HOST: "https://fake-observability.invalid",
});
globalThis.fetch = async () => { throw new Error("Only explicitly installed fake observation reads are permitted"); };
const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const observedIds: Array<{ id: string; sessionId?: string }> = [];
type Span = { span: () => Span };
const span = (): Span => ({ span });
class FakeLangfuse {
  trace(value: { id: string; sessionId?: string }) {
    observedIds.push(value);
    return { generation: () => ({ update: () => undefined, end: () => undefined }), update: () => undefined, span };
  }
  async flushAsync(): Promise<void> {}
}
mock.module(load.resolve("langfuse"), { namedExports: { Langfuse: FakeLangfuse } });
mock.module(resolve(root, "lib/db/prisma.ts"), {
  namedExports: { prisma: { board: { findMany: async () => [{ id: "board-one", userId: "student-one" }] } } },
});
const namespace = load(resolve(root, "lib/obs/traceOwnership.ts")) as typeof import("../../lib/obs/traceOwnership");
const observations = load(resolve(root, "lib/obs/langfuse.ts")) as typeof import("../../lib/obs/langfuse");
const queries = load(resolve(root, "lib/obs/langfuseQuery.ts")) as typeof import("../../lib/obs/langfuseQuery");

test("reusing a retired client trace id cannot target another account's vendor trace", () => {
  const victimId = namespace.scopedTraceId("student-one", "reusable-trace");
  const attackerId = namespace.scopedTraceId("student-two", "reusable-trace");
  assert.notEqual(victimId, attackerId);
  assert.match(victimId, /^[a-f0-9]{64}$/);
  assert.notEqual(victimId, namespace.scopedSessionId("student-one", "reusable-trace"));
});

test("LLM, speech, and client telemetry writes share the authenticated account's vendor namespace", () => {
  observedIds.length = 0;
  observations.startTurnTrace({ userId: "student-one", traceId: "reusable-trace", sessionId: "board-one" });
  observations.recordTtsSpan({ userId: "student-one", traceId: "reusable-trace", sessionId: "board-one", characters: 10, model: "sonic-3", voiceId: "fake", transport: "http" });
  observations.recordTurnEvents({ userId: "student-one", traceId: "reusable-trace", sessionId: "board-one", events: [{ name: "thinking", startTime: new Date().toISOString(), endTime: new Date().toISOString() }] });
  observations.updateTurnTrace({ userId: "student-one", traceId: "reusable-trace", sessionId: "board-one", metadata: { client_telemetry: { cancelled: true } } });
  assert.equal(observedIds.length, 4);
  assert(observedIds.every(row => row.id === namespace.scopedTraceId("student-one", "reusable-trace")));
  assert(observedIds.every(row => row.sessionId === namespace.scopedSessionId("student-one", "board-one")));
  observations.updateTurnTrace({ userId: "student-two", traceId: "reusable-trace", sessionId: "board-one", metadata: {} });
  assert.notEqual(observedIds.at(-1)?.id, observedIds[0]?.id);
  assert.notEqual(observedIds.at(-1)?.sessionId, observedIds[0]?.sessionId);
});

function usage(sessionId: string, traceId: string) {
  return { id: "fake-observation", name: "tts-segment", type: "GENERATION", model: "sonic-3", sessionId, traceId, usageDetails: { characters: 1000 } };
}

test("the admin trace cost lookup resolves raw persisted ids to the owner-scoped observation", async () => {
  const traceId = namespace.scopedTraceId("student-one", "reusable-trace");
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://fake-observability.invalid");
    assert.equal(url.pathname, "/api/public/v2/observations");
    const filter = JSON.parse(url.searchParams.get("filter") ?? "[]") as Array<{ column: string; value: string[] }>;
    assert.equal(filter[0]?.column, "traceId");
    assert(filter[0]?.value.includes(traceId));
    return Response.json({ data: [usage("board-one", traceId)] });
  };
  const result = await queries.fetchRunCostForTraces(["reusable-trace"], new Map([["reusable-trace", "student-one"]]));
  assert.equal(result.error, undefined);
  assert.equal(result.byTraceId["reusable-trace"]?.observationTraceId, traceId);
  assert((result.byTraceId["reusable-trace"]?.ttsUsd ?? 0) > 0);
});

test("admin board cost lookup maps owner-scoped session reports back to the stored board", async () => {
  const sessionId = namespace.scopedSessionId("student-one", "board-one");
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://fake-observability.invalid");
    const filter = JSON.parse(url.searchParams.get("filter") ?? "[]") as Array<{ value: string[] }>;
    assert(filter[0]?.value.includes(sessionId));
    return Response.json({ data: [usage(sessionId, "trace-one")] });
  };
  const result = await queries.fetchRunCostForSessions(["board-one"]);
  assert.equal(result.error, undefined);
  assert.equal(result.report.bySession[0]?.sessionId, "board-one");
  assert((result.report.bySession[0]?.ttsUsd ?? 0) > 0);
});

test("admin logs retain a priced turn when another trace has no ingested observations", async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/public/v2/observations") {
      return Response.json({ data: [usage("board-one", "priced-trace")] });
    }
    if (url.pathname === "/api/public/traces/priced-trace") {
      return Response.json({ observations: [usage("board-one", "priced-trace")] });
    }
    return new Response(null, { status: 404 });
  };
  const result = await queries.fetchRunCostForTraces(["priced-trace", "not-ingested"]);
  assert((result.byTraceId["priced-trace"]?.totalUsd ?? 0) > 0,
    "a missing trace must not blank costs for the entire log page");
  assert.equal(result.byTraceId["not-ingested"], undefined);
});

test("admin logs fetch all 100 rows in one paginated batch and prefer scoped over legacy traces", async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `trace-${index}`);
  const scopedId = namespace.scopedTraceId("student-one", ids[0]!);
  const paths: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    paths.push(url);
    assert.equal(url.pathname, "/api/public/v2/observations");
    const filter = JSON.parse(url.searchParams.get("filter") ?? "[]") as Array<{ value: string[] }>;
    assert(ids.every(id => filter[0]?.value.includes(id)), "include every turn, including rows after 40");
    if (!url.searchParams.has("cursor")) {
      return Response.json({ data: [usage("board-one", ids[0]!), usage("board-one", scopedId)], meta: { cursor: "next" } });
    }
    assert.equal(url.searchParams.get("cursor"), "next");
    return Response.json({ data: ids.slice(1).map(id => usage("board-one", id)) });
  };
  const result = await queries.fetchRunCostForTraces(ids, new Map([
    [ids[0]!, "student-one"], [ids[1]!, "student-two"],
  ]));
  assert.equal(result.error, undefined);
  assert.equal(paths.length, 2, "a page of logs must not make a separate vendor request per turn");
  assert.equal(Object.keys(result.byTraceId).length, 100);
  assert.equal(result.byTraceId[ids[0]!]!.observationTraceId, scopedId);
  assert.equal(result.byTraceId[ids[1]!]!.observationTraceId, ids[1]);
  assert.equal(result.byTraceId[ids[0]!]!.totalUsd, result.byTraceId[ids[1]!]!.totalUsd,
    "the legacy copy must not double the scoped trace cost");
});

test("admin logs do not report a generation awaiting usage as a free turn", async () => {
  globalThis.fetch = async () => Response.json({ data: [{
    id: "pending-observation", traceId: "pending-trace", type: "GENERATION", name: "teaching",
  }] });
  const result = await queries.fetchRunCostForTraces(["pending-trace"]);
  assert.equal(result.error, undefined);
  assert.equal(result.byTraceId["pending-trace"], undefined, "unreported usage has unknown cost, not $0");
});

test("admin cost queries expose vendor failures without claiming zero spend", async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const result = await queries.fetchRunCostForTraces(["unavailable-trace"]);
  assert.equal(result.configured, true);
  assert.equal(result.error, "langfuse_unavailable");
  assert.deepEqual(result.byTraceId, {});
});
