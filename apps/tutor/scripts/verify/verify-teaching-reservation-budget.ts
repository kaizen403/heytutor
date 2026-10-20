import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

// Actual billing/ledger/quote code, with a serial, rollback-capable transaction
// double. No dotenv, live database, provider key, or external request is used.
const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
assert.equal(typeof mock.module, "function", "run with --experimental-test-module-mocks");
for (const key of Object.keys(process.env)) {
  if (/^(?:FIREWORKS_.*USD_PER|AZURE_GPT_SOL_.*USD_PER|AZURE_OPENAI_DEPLOYMENT)/.test(key)) delete process.env[key];
}
process.env.BILLING_PROVIDER = "";
globalThis.fetch = async () => { throw new Error("External requests prohibited"); };
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T23:59:00Z") });

type Allocation = { period: string; millicents: number } | { purchaseId: string; millicents: number };
type Receipt = { id: string; userId: string; traceId: string; kind: string; period: string; planId: string; amountMillicents: number; allocations: Allocation[]; settledMillicents: number | null };
type Purchase = { id: string; userId: string; planId: string; spentMillicents: number; usageMillicents: number; refundAmount: number; amount: number; testMode: boolean; status: string; accessStartsAt: Date; accessEndsAt: Date; createdAt: Date };
let spent = 1330;
let forcePending = 0;
let forceCalls = 0;
let failReceiptUpdate = false;
let accountPlan = "free";
const receipts = new Map<string, Receipt>();
const periodSpends = new Map<string, number>();
const purchases = new Map<string, Purchase>();
const tx = {
  $queryRaw: async () => [{ id: "synthetic-budget-user", planId: accountPlan }],
  $executeRaw: async () => 0,
  billingPeriodSpend: {
    findUnique: async ({ where }: { where: { userId_period: { period: string } } }) => ({ spentMillicents: process.env.BILLING_PROVIDER === "razorpay" ? periodSpends.get(where.userId_period.period) ?? 0 : spent, bonusMillicents: 0 }),
    upsert: async ({ where, update }: { where: { userId_period: { period: string } }; update: { spentMillicents: { increment: number } } }) => {
      if (process.env.BILLING_PROVIDER === "razorpay") {
        const period = where.userId_period.period;
        periodSpends.set(period, (periodSpends.get(period) ?? 0) + update.spentMillicents.increment);
        return { spentMillicents: periodSpends.get(period), bonusMillicents: 0 };
      }
      spent += update.spentMillicents.increment; return { spentMillicents: spent, bonusMillicents: 0 };
    },
    updateMany: async ({ where, data }: { where: { period: string }; data: { spentMillicents: { decrement: number } } }) => {
      if (process.env.BILLING_PROVIDER === "razorpay") {
        periodSpends.set(where.period, (periodSpends.get(where.period) ?? 0) - data.spentMillicents.decrement);
        return { count: 1 };
      }
      spent -= data.spentMillicents.decrement;
      return { count: 1 };
    },
  },
  billingPurchase: {
    findMany: async ({ where }: { where: { planId: string | { in: string[] }; status: string | { in: string[] }; testMode: boolean } }) => [...purchases.values()].filter(row =>
      (typeof where.planId === "string" ? row.planId === where.planId : where.planId.in.includes(row.planId)) &&
      (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status)) && row.testMode === where.testMode),
    update: async ({ where, data }: { where: { id: string }; data: { spentMillicents: { increment: number } } }) => {
      const row = purchases.get(where.id); assert(row); row.spentMillicents += data.spentMillicents.increment; return row;
    },
    updateMany: async ({ where, data }: { where: { id: string }; data: { spentMillicents: { decrement: number } } }) => {
      const row = purchases.get(where.id); assert(row); row.spentMillicents -= data.spentMillicents.decrement; return { count: 1 };
    },
  },
  paidUsageReservation: {
    count: async ({ where }: { where: { traceId?: string } }) => where.traceId ? forceCalls : forcePending,
    create: async ({ data }: { data: Omit<Receipt, "settledMillicents"> }) => {
      const receipt = { ...data, settledMillicents: null };
      receipts.set(data.id, receipt);
      return receipt;
    },
    findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
      const receipt = receipts.get(where.id);
      return receipt?.userId === where.userId ? structuredClone(receipt) : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: { settledMillicents?: number; amountMillicents?: number | { increment: number }; allocations?: Allocation[] } }) => {
      if (failReceiptUpdate) throw new Error("synthetic transaction failure");
      const receipt = receipts.get(where.id);
      assert(receipt);
      if (data.amountMillicents !== undefined) receipt.amountMillicents = typeof data.amountMillicents === "number" ? data.amountMillicents : receipt.amountMillicents + data.amountMillicents.increment;
      if (data.allocations) receipt.allocations = data.allocations;
      if (data.settledMillicents !== undefined) receipt.settledMillicents = data.settledMillicents;
      return structuredClone(receipt);
    },
  },
};
let transaction = Promise.resolve();
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: {
  prisma: { $transaction: <T>(run: (client: typeof tx) => Promise<T>) => {
    const next = transaction.then(async () => {
      const beforeSpent = spent;
      const beforeReceipts = structuredClone(receipts);
      const beforePeriods = structuredClone(periodSpends);
      const beforePurchases = structuredClone(purchases);
      try { return await run(tx); }
      catch (error) {
        spent = beforeSpent; receipts.clear();
        for (const [id, receipt] of beforeReceipts) receipts.set(id, receipt);
        periodSpends.clear(); for (const [period, value] of beforePeriods) periodSpends.set(period, value);
        purchases.clear(); for (const [id, purchase] of beforePurchases) purchases.set(id, purchase);
        throw error;
      }
    });
    transaction = next.then(() => undefined, () => undefined);
    return next;
  }, billingPeriodSpend: tx.billingPeriodSpend, billingPurchase: tx.billingPurchase,
    user: { findUnique: async () => ({ planId: accountPlan }) } },
} });
const paid = load(resolve(root, "lib/billing/paidUsage.ts")) as typeof import("../../lib/billing/paidUsage");
const ledger = load(resolve(root, "lib/billing/ledger.ts")) as typeof import("../../lib/billing/ledger");
const grants = load(resolve(root, "lib/billing/grant.ts")) as typeof import("../../lib/billing/grant");
const { balanceFromRow } = load(resolve(root, "lib/billing/ledgerMath.ts")) as typeof import("../../lib/billing/ledgerMath");
const copy = load(resolve(root, "lib/billing/studentCopy.ts")) as typeof import("../../lib/billing/studentCopy");
const client = load(resolve(root, "lib/billing/billingClient.ts")) as typeof import("../../lib/billing/billingClient");
const entitlement = load(resolve(root, "lib/billing/entitlementState.ts")) as typeof import("../../lib/billing/entitlementState");
const teaching = load(resolve(root, "lib/llm/teachingTransport.ts")) as typeof import("../../lib/llm/teachingTransport");
const route = teaching.resolveTeachingModelRoute({ LLM_PROVIDER: "fireworks" }, { fastMode: true });
const messages = [{ role: "system", content: "x".repeat(200_000) }, { role: "user", content: "Explain a synthetic conceptual chemistry question." }];
const maxTokens = teaching.resolveTeachingContentBudget({ env: {} });
const costs = [0, 1, 2].map(attempt => paid.maximumLlmCost(messages, maxTokens, [teaching.teachingAttemptModel(route, attempt, 3)]));
const quote = (usd: number) => Math.ceil(usd * 1000);
const actor = { userId: "synthetic-budget-user", email: null, staff: false, lectureLab: false, skipGates: false, skipAutumn: true };
function grant() {
  grants.resetTurnGrantsForTests();
  const result = grants.createLessonGrant({ userId: actor.userId, traceId: "synthetic-budget-trace", planId: "free", usdMillicents: 3500 - spent });
  assert(result.ok); return result.grant;
}
function reset(value = 0) { spent = value; forcePending = 0; forceCalls = 0; failReceiptUpdate = false; accountPlan = "free"; receipts.clear(); }
async function reserve(usd: number) { return paid.reservePaidUsage({ actor, grant: grant(), kind: "teaching", traceId: "synthetic-budget-trace", usd }); }

async function main() {
assert.equal(maxTokens, 3600, "generation adequacy is unchanged");
assert.equal(balanceFromRow({ planId: "free", spentMillicents: spent, bonusMillicents: 0 }).remainingPct, 62);
assert(quote(costs[0]!) < 2170 && quote(costs.reduce((sum, cost) => sum + cost, 0)) > 2170);
const reservation = await reserve(costs[0]!);
assert(!(reservation instanceof Response), "the first full generation can start with 62% remaining");
assert.equal(typeof reservation.ensureReserved, "function", "retry costs are reserved on demand on the same logical receipt");
assert.equal(receipts.size, 1);
const receipt = [...receipts.values()][0]!;
const initialSpent = spent;
assert.equal(await reservation.ensureReserved(costs[0]!), null, "a known-free earlier attempt reuses its existing maximum");
assert.equal(spent, initialSpent);
const secondMaximum = costs[0]! + costs[1]!;
const extended = await Promise.all([reservation.ensureReserved(secondMaximum), reservation.ensureReserved(secondMaximum)]);
assert.deepEqual(extended, [null, null]);
assert.equal(receipts.size, 1, "retry top-ups do not create another logical call");
assert.equal(grants.getTurnGrant(actor.userId)?.paidCallCounts.get("synthetic-budget-trace:teaching"), 1);
assert.equal(receipt.amountMillicents, quote(secondMaximum));
assert.equal(spent, 1330 + quote(secondMaximum), "concurrent coverage checks charge only the missing amount");
const denied = await reservation.ensureReserved(secondMaximum + costs[2]!);
assert(denied instanceof Response && denied.status === 402);
const retryBody = await denied.json() as { code: string; remaining: number };
assert.equal(retryBody.code, "retry_budget");
assert(retryBody.remaining > 0);
const retryFailure = client.parseBillingFailureFromBody(402, retryBody);
assert(retryFailure);
client.rememberBillingFailure(retryFailure);
assert.equal(entitlement.getEntitlementSnapshot()?.remainingPct, retryBody.remaining);
assert.equal(copy.isOutOfUsageLock(retryFailure), false, "a funded request refusal never locks the next question");
assert.match(copy.studentBillingMessage(retryBody.code), /Try a new question/);
assert.equal(receipt.amountMillicents, quote(secondMaximum), "unaffordable retry never dispatches or enlarges its receipt");
await reservation.settle(1.2);
assert.equal(spent, 2530, "known final usage refunds only the unused precharge");
await reservation.finish();
assert.equal(spent, 2530, "duplicate finish cannot settle twice");
assert((await reservation.ensureReserved(3)) instanceof Response, "a closed receipt cannot admit another attempt");
assert.equal(spent, 2530);
assert.equal(grants.getTurnGrant(actor.userId)?.paidCallsPending.get("ai"), 0);

reset();
const unknown = await reserve(0.3); assert(!(unknown instanceof Response));
assert.equal(await unknown.ensureReserved(0.7), null);
await unknown.finish();
assert.equal(spent, 700, "unknown usage retains the complete funded bound");
reset();
const undispatched = await reserve(0.3); assert(!(undispatched instanceof Response));
assert.equal(await undispatched.ensureReserved(0.7), null);
await undispatched.cancelBeforeDispatch();
assert.equal(spent, 0, "definitely undispatched cancellation refunds exactly its own allocation");
reset();
const raced = await reserve(0.3); assert(!(raced instanceof Response));
await Promise.all([raced.ensureReserved(0.7), raced.finish()]);
assert.equal(spent, 700, "a settlement racing a top-up retains the funded uncertain maximum");
reset();
const closed = await reserve(0.3); assert(!(closed instanceof Response));
await closed.finish();
assert((await closed.ensureReserved(0.7)) instanceof Response);
assert.equal(spent, 300, "a completed receipt never accepts a late charge");
reset();
const externallySettled = await reserve(0.3); assert(!(externallySettled instanceof Response));
await ledger.settlePeriodUsage({ userId: actor.userId, reservationId: [...receipts.values()][0]!.id, actualMillicents: 300 });
const staleGrowth = await externallySettled.ensureReserved(0.7);
assert(staleGrowth instanceof Response && staleGrowth.status === 503, "a receipt closed by another process is a service refusal, not depleted credits");
assert.equal(spent, 300);
reset();
const ceiling = await reserve(0.01); assert(!(ceiling instanceof Response));
const capped = await ceiling.ensureReserved(100.001); assert(capped instanceof Response);
const cappedBody = await capped.json() as { code: string; remaining: number };
assert.equal(cappedBody.code, "retry_budget");
assert(cappedBody.remaining > 0);
assert.equal(spent, 10, "the existing request-wide 100000 millicent ceiling is unchanged");
reset();
const rolledBack = await reserve(0.3); assert(!(rolledBack instanceof Response));
failReceiptUpdate = true;
const unavailable = await rolledBack.ensureReserved(0.7);
assert(unavailable instanceof Response && unavailable.status === 503);
assert.equal(spent, 300, "a failed receipt extension rolls back its spend increment");
assert.equal([...receipts.values()][0]!.amountMillicents, 300);
failReceiptUpdate = false;
await rolledBack.finish();
assert.equal(spent, 300, "the original uncertain attempt survives an extension service failure");
reset(2400);
const sharedGrant = grant();
const first = await paid.reservePaidUsage({ actor, grant: sharedGrant, kind: "teaching", traceId: "synthetic-budget-trace", usd: 0.3 });
const second = await paid.reservePaidUsage({ actor, grant: sharedGrant, kind: "teaching", traceId: "synthetic-budget-trace", usd: 0.3 });
assert(!(first instanceof Response) && !(second instanceof Response));
const competing = await Promise.all([first.ensureReserved(0.7), second.ensureReserved(0.7)]);
assert.equal(competing.filter(result => result === null).length, 1, "account-locked competing retries cannot both spend the same balance");
assert.equal(competing.filter(result => result instanceof Response && result.status === 402).length, 1);
assert.equal(spent, 3400, "concurrent receipt growth never overdraws the allowance");
assert.equal(sharedGrant.paidCallCounts.get("synthetic-budget-trace:teaching"), 2);
await Promise.all([first.finish(), second.finish()]);
assert.equal(spent, 3400);
assert.equal(sharedGrant.paidCallsPending.get("ai"), 0);

reset(); forcePending = 4;
const capacity = await reserve(0.01); assert(capacity instanceof Response);
assert.equal(capacity.status, 429, "funded pending capacity is not empty credits");
assert.equal((await capacity.json()).code, "concurrent_limit");
reset(); forceCalls = 4;
const exhaustedCalls = await reserve(0.01); assert(exhaustedCalls instanceof Response);
assert.equal(exhaustedCalls.status, 429);
assert.equal((await exhaustedCalls.json()).code, "rate_limited");
reset(3500);
const empty = await reserve(0.01); assert(empty instanceof Response && empty.status === 402);
assert.equal(spent, 3500);
reset(4000); accountPlan = "plus"; grants.resetTurnGrantsForTests();
const ancillary = await paid.reservePaidUsage({ actor, grant: null, kind: "suggestions", traceId: "synthetic-ancillary-trace", usd: 9 });
assert(ancillary instanceof Response && ancillary.status === 402);
const ancillaryBody = await ancillary.json() as { code: string; remaining: number };
assert.equal(ancillaryBody.code, "retry_budget", "a grantless paid account is not classified using the free allowance");
assert.equal(ancillaryBody.remaining, 67);
assert.equal(spent, 4000);
const affordableAncillary = await paid.reservePaidUsage({ actor, grant: null, kind: "suggestions", traceId: "synthetic-ancillary-trace", usd: 0.1 });
assert(!(affordableAncillary instanceof Response));
await affordableAncillary.finish();
assert.equal(spent, 4100);

reset();
const owned = await ledger.reservePeriodUsage({ userId: actor.userId, planId: "free", traceId: "synthetic-budget-trace", kind: "teaching", millicents: 10, maxCalls: 4 });
assert(owned);
for (const input of [
  { userId: "another-synthetic-user", traceId: "synthetic-budget-trace", kind: "teaching" },
  { userId: actor.userId, traceId: "another-synthetic-trace", kind: "teaching" },
  { userId: actor.userId, traceId: "synthetic-budget-trace", kind: "planner" },
]) {
  assert.equal(await ledger.reservePeriodUsage({ ...input, planId: "free", reservationId: owned.id, millicents: 10, maxCalls: 4 }), null, "extensions retain account, trace and kind ownership");
}
assert.equal(spent, 10);
await ledger.settlePeriodUsage({ userId: actor.userId, reservationId: owned.id, actualMillicents: 10 });
assert.equal(await ledger.reservePeriodUsage({ userId: actor.userId, planId: "free", traceId: "synthetic-budget-trace", kind: "teaching", reservationId: owned.id, millicents: 10, maxCalls: 4 }), null, "settled receipts cannot grow");

// Production's Razorpay branch: grow one receipt across the included envelope,
// a portable purchase, and a calendar boundary; refunds reverse only its own
// original allocations. Every provider/database operation remains a local double.
reset(); process.env.BILLING_PROVIDER = "razorpay"; process.env.RAZORPAY_KEY_ID = "rzp_test_synthetic_budget";
const october = "razorpay:test:free:2026-10", november = "razorpay:test:free:2026-11";
periodSpends.set(october, 3400);
const topUp: Purchase = { id: "synthetic-top-up", userId: actor.userId, planId: "lesson_top_up", spentMillicents: 0, usageMillicents: 1000, refundAmount: 0, amount: 1000, testMode: true, status: "paid", accessStartsAt: new Date("2026-10-01"), accessEndsAt: new Date("2027-01-01"), createdAt: new Date("2026-10-01") };
purchases.set(topUp.id, topUp);
const spanning = await reserve(0.2); assert(!(spanning instanceof Response));
const spanningReceipt = [...receipts.values()][0]!;
assert.deepEqual(spanningReceipt.allocations, [{ period: october, millicents: 100 }, { purchaseId: topUp.id, millicents: 100 }]);
mock.timers.setTime(new Date("2026-11-01T00:01:00Z").getTime());
assert.equal(await spanning.ensureReserved(0.6), null);
assert.equal(receipts.size, 1);
assert.deepEqual(spanningReceipt.allocations, [{ period: october, millicents: 100 }, { purchaseId: topUp.id, millicents: 100 }, { period: november, millicents: 400 }]);
await spanning.settle(0.05);
assert.equal(periodSpends.get(october), 3450, "actual usage remains in its original period");
assert.equal(periodSpends.get(november), 0, "unused next-period growth refunds to that period");
assert.equal(purchases.get(topUp.id)?.spentMillicents, 0, "the portable top-up refund returns to its own purchase");

reset(); periodSpends.clear(); purchases.clear();
periodSpends.set(november, 3400); purchases.set(topUp.id, { ...topUp, spentMillicents: 0 });
const purchased = await reserve(0.1); assert(!(purchased instanceof Response));
assert.equal(await purchased.ensureReserved(0.3), null);
assert.equal(purchases.get(topUp.id)?.spentMillicents, 200, "growth uses the portable purchase after included usage");
await purchased.settle(0.15);
assert.equal(periodSpends.get(november), 3500);
assert.equal(purchases.get(topUp.id)?.spentMillicents, 50, "reverse allocation refund preserves consumed purchase usage");

reset(); periodSpends.clear(); purchases.clear();
periodSpends.set(november, 3400); purchases.set(topUp.id, { ...topUp, spentMillicents: 900 });
const failedPurchase = await reserve(0.1); assert(!(failedPurchase instanceof Response));
failReceiptUpdate = true;
const purchaseFailure = await failedPurchase.ensureReserved(0.2);
assert(purchaseFailure instanceof Response && purchaseFailure.status === 503);
assert.equal(purchases.get(topUp.id)?.spentMillicents, 900, "receipt failure rolls back the purchase debit atomically");
assert.equal([...receipts.values()][0]!.amountMillicents, 100);
assert.equal([...receipts.values()][0]!.allocations.length, 1);
failReceiptUpdate = false; await failedPurchase.finish();
assert.equal(periodSpends.get(november), 3500, "uncertain original usage remains charged after rollback");
mock.timers.reset();
console.log("teaching reservation budget PASS: funded first attempt, atomic retry coverage, privacy-safe capacity errors, settlement/cancellation and ownership; external calls 0");

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
