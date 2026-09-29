import { mock } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const load = createRequire(import.meta.url);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Mock only authentication and persistence. Both HTTP handlers, the billing
// gate, and the in-memory grant implementation execute unmodified.
const actor = {
  userId: "paid-route-seam-user",
  email: null,
  staff: false,
  lectureLab: false,
  skipAutumn: true,
  skipGates: false,
};
const billingPath = resolve(import.meta.dirname, "../../lib/billing");
const appPath = resolve(import.meta.dirname, "../../app/api");
mock.module(resolve(billingPath, "actor.ts"), {
  namedExports: { requireSpendActor: async () => actor, isSpendActor: () => true },
});
mock.module(resolve(billingPath, "ledger.ts"), {
  namedExports: {
    loadPeriodBalance: async () => ({ remainingMillicents: 0, remainingPct: 0 }),
    cacheUsageOnUser: async () => undefined,
  },
});
mock.module(resolve(import.meta.dirname, "../../lib/db/prisma.ts"), {
  namedExports: { prisma: { user: { findUnique: async () => ({ planId: "free" }) } } },
});

const { createLessonGrant, consumeUsdMillicents, resetTurnGrantsForTests } =
  load(resolve(billingPath, "grant.ts")) as typeof import("../../lib/billing/grant");
const { beginTurnForActor } = load(resolve(billingPath, "gate.ts")) as typeof import("../../lib/billing/gate");
const routes = [
  ["stt", load(resolve(appPath, "stt/route.ts")) as typeof import("../../app/api/stt/route")],
  ["extract-question", load(resolve(appPath, "extract-question/route.ts")) as typeof import("../../app/api/extract-question/route")],
] as const;

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("paid upstream was called by an authorization test"); };
  try {
    resetTurnGrantsForTests();
    const minted = createLessonGrant({ userId: actor.userId, traceId: "original", usdMillicents: 1 });
    assert(minted.ok, "preexisting grant minted");
    consumeUsdMillicents(minted.grant, 1);
    for (const [name, route] of routes) {
      const post = (trace?: string) => route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST",
        headers: trace ? { "x-heytutor-trace-id": trace } : {},
      }));
      const known = await post("original");
      assert(known.status === 400 || known.status === 503,
        `${name}: the known trace reaches request validation, not a paid provider`);
      const fresh = await post("new-trace");
      assert(fresh.status === 402, `${name}: exhausted grant denies unknown trace before provider`);
      const missing = await post();
      assert(missing.status === 402, `${name}: exhausted grant denies missing trace before provider`);
      assert(!minted.grant.allowedTraceIds.has("new-trace"), `${name}: refused trace is not cached`);
    }
    resetTurnGrantsForTests();
    const stale = createLessonGrant({ userId: actor.userId, traceId: "original", usdMillicents: 10 });
    assert(stale.ok, "stale in-memory grant minted");
    for (const [name, route] of routes) {
      const response = await route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST", headers: { "x-heytutor-trace-id": "unknown" },
      }));
      assert(response.status === 402, `${name}: persisted zero beats stale in-memory grant`);
    }
    resetTurnGrantsForTests();
    const bypass = createLessonGrant({ userId: actor.userId, traceId: "original", skipGates: true });
    assert(bypass.ok, "old privileged grant exists");
    const oldTraceBegin = await beginTurnForActor(actor, { traceId: "original", kind: "lesson" });
    assert(oldTraceBegin instanceof Response,
      "an ordinary begin-turn cannot reclassify a cached privileged grant");
    for (const [name, route] of routes) {
      const response = await route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST", headers: { "x-heytutor-trace-id": "original" },
      }));
      assert(response.status !== 400 && response.status !== 503,
        `${name}: ordinary actor cannot use previously privileged grant`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    resetTurnGrantsForTests();
  }
  console.log("✓ STT and extraction HTTP handlers enforce trace, balance, and entitlement before providers");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
