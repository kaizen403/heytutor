import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock, test } from "node:test";

globalThis.fetch = async () => { throw new Error("Security verification prohibits network requests"); };
const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const authenticatedUserId = "student-one";
const telemetry = new Map<string, unknown[]>();
const ownerByTrace = new Map<string, string>([["foreign-trace", "student-two"]]);
const expiresByTrace = new Map<string, Date>([["foreign-trace", new Date(Date.now() + 60_000)]]);
mock.module(resolve(root, "lib/auth.ts"), {
  namedExports: { getUserId: async () => authenticatedUserId, ensureUser: async () => undefined },
});
mock.module(resolve(root, "lib/db/prisma.ts"), {
  namedExports: {
    prisma: {
      ownedTrace: {
        findUnique: async ({ where }: { where: { traceId: string } }) => {
          const userId = ownerByTrace.get(where.traceId);
          return userId ? { traceId: where.traceId, userId, expiresAt: expiresByTrace.get(where.traceId) } : null;
        },
        createMany: async ({ data }: { data: { userId: string; traceId: string; expiresAt: Date }[] }) => {
          let count = 0;
          for (const row of data) if (!ownerByTrace.has(row.traceId)) {
            ownerByTrace.set(row.traceId, row.userId);
            expiresByTrace.set(row.traceId, row.expiresAt);
            count++;
          }
          return { count };
        },
        deleteMany: async () => ({ count: 0 }),
      },
      board: { findUnique: async ({ where }: { where: { id: string } }) => where.id === "foreign-board" ? { userId: "student-two" } : null },
    },
  },
});
function storeUpdate(value: { traceId: string }): void {
  const previous = telemetry.get(value.traceId) ?? [];
  telemetry.set(value.traceId, [...previous, value]);
}
mock.module(resolve(root, "lib/obs/langfuse.ts"), {
  namedExports: { recordTurnEvents: storeUpdate, updateTurnTrace: storeUpdate, flushSafely: async () => undefined },
});
const route = load(resolve(root, "app/api/trace/event/route.ts")) as typeof import("../../app/api/trace/event/route");
const ownership = load(resolve(root, "lib/obs/traceOwnership.ts")) as typeof import("../../lib/obs/traceOwnership");

function updateTrace(traceId: string): Promise<Response> {
  return route.POST(new Request("https://app.accelute.co/api/trace/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ traceId, sessionId: "foreign-session", traceMetadata: { outcome: "forged" } }),
  }));
}

test("a student cannot mutate another student's trace metadata", async () => {
  telemetry.clear();
  const response = await updateTrace("foreign-trace");
  assert([403, 404].includes(response.status), `Expected ownership rejection, received ${response.status}`);
  assert.equal(telemetry.has("foreign-trace"), false);
});

test("a guessed trace that was never issued to the student cannot be created by telemetry", async () => {
  telemetry.clear();
  const response = await updateTrace("unregistered-trace");
  assert([403, 404].includes(response.status), `Expected ownership rejection, received ${response.status}`);
  assert.equal(telemetry.has("unregistered-trace"), false);
});

test("a trace registered for the student accepts bounded client diagnostics", async () => {
  telemetry.clear();
  assert.equal(await ownership.registerOwnedTrace(authenticatedUserId, "owned-trace"), true);
  const response = await updateTrace("owned-trace");
  assert.equal(response.status, 200);
  assert.equal(telemetry.has("owned-trace"), true);
});

test("a trace cannot be reassigned to a different authenticated student", async () => {
  assert.equal(await ownership.registerOwnedTrace(authenticatedUserId, "foreign-trace"), false);
  assert.equal(ownerByTrace.get("foreign-trace"), "student-two");
});

test("an owned trace cannot be grouped into another student's existing board", async () => {
  await ownership.registerOwnedTrace(authenticatedUserId, "owned-trace");
  assert.equal(await ownership.assertOwnedTrace(authenticatedUserId, "owned-trace", "foreign-board"), false);
});

test("client metadata cannot overwrite server accounting fields", async () => {
  telemetry.clear();
  await ownership.registerOwnedTrace(authenticatedUserId, "accounting-trace");
  const response = await route.POST(new Request("https://app.accelute.co/api/trace/event", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ traceId: "accounting-trace", traceMetadata: { llm_cost_usd: 0, billing_authorized: true } }),
  }));
  assert.equal(response.status, 200);
  const written = telemetry.get("accounting-trace")?.[0];
  assert(written && typeof written === "object" && "metadata" in written);
  const metadata = written.metadata;
  assert(metadata && typeof metadata === "object");
  assert.equal("llm_cost_usd" in metadata, false);
  assert.equal("billing_authorized" in metadata, false);
  assert.equal("client_telemetry" in metadata, true);
});

test("expired registrations cannot authorize telemetry", async () => {
  ownerByTrace.set("expired-trace", authenticatedUserId);
  expiresByTrace.set("expired-trace", new Date(Date.now() - 60_000));
  const response = await updateTrace("expired-trace");
  assert([403, 404].includes(response.status));
});
