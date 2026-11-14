import assert from "node:assert/strict";
import { fetchEntitlement, refreshPaidEntitlement } from "../../lib/billing/billingClient";
import { getEntitlementSnapshot, setEntitlementSnapshot } from "../../lib/billing/entitlementState";

// Real entitlement client and paid-refresh consumer. Only fetch is replaced;
// no provider, database, browser, or Sentry calls are made.
const baseline = { planId: "plus", remainingPct: 70, nextResetAt: 123, staff: false };
const stale = { planId: "free", remainingPct: 10, nextResetAt: 456, staff: false };
const tests: Array<[string, () => Promise<void>]> = [];
const check = (name: string, run: () => Promise<void>) => tests.push([name, run]);

for (const body of ["{", "null", "{}", '{"planId":"plus","staff":false}']) {
  check(`invalid success body ${body}`, async () => {
    setEntitlementSnapshot(baseline);
    globalThis.fetch = async () => new Response(body, { status: 200 });
    assert.equal(await refreshPaidEntitlement(), false, "a broken read cannot confirm a paid refresh");
    assert.equal(getEntitlementSnapshot(), baseline, "a broken read cannot replace known usage with a free default");
  });
}
check("network rejection remains owned by paid refresh", async () => {
  setEntitlementSnapshot(baseline);
  globalThis.fetch = async () => { throw new TypeError("synthetic network failure"); };
  assert.equal(await refreshPaidEntitlement(), false);
  assert.equal(getEntitlementSnapshot(), baseline);
});
check("body stream rejection cannot confirm a paid refresh", async () => {
  setEntitlementSnapshot(baseline);
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError("synthetic interrupted body")); },
  }));
  assert.equal(await refreshPaidEntitlement(), false);
  assert.equal(getEntitlementSnapshot(), baseline);
});
check("abort during body read cannot publish", async () => {
  setEntitlementSnapshot(baseline);
  const controller = new AbortController();
  globalThis.fetch = async () => ({ ok: true, json: async () => { controller.abort(); return stale; } }) as Response;
  await assert.rejects(fetchEntitlement(controller.signal), { name: "AbortError" });
  assert.equal(getEntitlementSnapshot(), baseline);
});
check("late startup read cannot overwrite newer lesson usage", async () => {
  setEntitlementSnapshot(baseline);
  // Use a distinct receipt: even identical values represent a newer owner.
  const newer = { ...baseline, remainingPct: 85 };
  globalThis.fetch = async () => ({ ok: true, json: async () => { setEntitlementSnapshot(newer); return stale; } }) as Response;
  await fetchEntitlement();
  assert.equal(getEntitlementSnapshot(), newer);
});
check("auth refusal cannot publish or refresh successfully", async () => {
  setEntitlementSnapshot(baseline);
  globalThis.fetch = async () => new Response("{", { status: 401 });
  assert.equal(await refreshPaidEntitlement(), false);
  assert.equal(getEntitlementSnapshot(), baseline);
});
check("two overlapping reads keep the newer receipt", async () => {
  setEntitlementSnapshot(baseline);
  let finish: (body: unknown) => void = () => {};
  const controller = new AbortController();
  globalThis.fetch = async () => ({ ok: true, json: () => new Promise((resolve) => { finish = resolve; }) }) as Response;
  const older = fetchEntitlement(controller.signal);
  await Promise.resolve();
  globalThis.fetch = async () => Response.json(baseline);
  assert.equal((await fetchEntitlement(new AbortController().signal)).ok, true);
  finish(stale);
  await older;
  assert.deepEqual(getEntitlementSnapshot(), baseline);
});
check("failed shared read releases its slot for retry", async () => {
  globalThis.fetch = async () => { throw new TypeError("synthetic offline"); };
  await assert.rejects(fetchEntitlement());
  globalThis.fetch = async () => Response.json(baseline);
  assert.equal((await fetchEntitlement()).ok, true);
});
check("successful read publishes usage and unlimited staff", async () => {
  for (const value of [baseline, { planId: "free", remainingPct: null, nextResetAt: null, staff: true }]) {
    setEntitlementSnapshot(null);
    globalThis.fetch = async () => Response.json(value);
    assert.equal(await refreshPaidEntitlement(), true);
    assert.deepEqual(getEntitlementSnapshot(), value);
  }
});
async function main() {
  const original = globalThis.fetch;
  const failures: string[] = [];
  try {
    for (const [name, run] of tests) {
      try { await run(); console.log(`pass ${name}`); }
      catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
    }
  } finally { globalThis.fetch = original; setEntitlementSnapshot(null); }
  assert.deepEqual(failures, []);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
