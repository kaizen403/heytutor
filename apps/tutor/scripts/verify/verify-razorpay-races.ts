import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { prisma } from "../../lib/db/prisma";
import { loadRazorpayBalance } from "../../lib/billing/razorpayBalance";
import { createLessonGrant, getTurnGrant } from "../../lib/billing/grant";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
let pauseRefresh = false;
let readStarted!: () => void;
let resumeRead!: () => void;
const started = new Promise<void>(resolve => { readStarted = resolve; });
const resumed = new Promise<void>(resolve => { resumeRead = resolve; });
mock.module(resolve(root, "lib/billing/razorpayBalance.ts"), { namedExports: {
  loadRazorpayBalance: async (userId: string) => {
    const balance = await loadRazorpayBalance(userId);
    if (pauseRefresh) { readStarted(); await resumed; }
    return balance;
  },
} });
mock.module(resolve(root, "lib/billing/razorpayCheckout.ts"), { namedExports: {
  openRazorpayCheckout: async () => true,
} });
const { applyRazorpayPayment } = load(resolve(root, "lib/billing/razorpayPayments.ts")) as typeof import("../../lib/billing/razorpayPayments");
const { followBillingRedirect } = load(resolve(root, "lib/billing/billingClient.ts")) as typeof import("../../lib/billing/billingClient");

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.startsWith("/heytutor_razorpay_verify_"), "Dedicated local test database required");
  Object.assign(process.env, { BILLING_PROVIDER: "razorpay", RAZORPAY_KEY_ID: "rzp_test_races" });
  const userId = randomUUID();
  const id = randomUUID();
  await prisma.user.create({ data: { id: userId } });
  const originalFetch = globalThis.fetch;
  try {
    const purchase = await prisma.billingPurchase.create({ data: { id, userId, idempotencyKey: randomUUID(), planId: "plus", amount: 1900, usageMillicents: 12000, currency: "USD", keyId: "rzp_test_races", testMode: true, orderId: `order_${id.replaceAll("-", "")}` } });
    const retained = createLessonGrant({ userId, traceId: "capture-refund-race", usdMillicents: 0 });
    assert(retained.ok);
    const payment = { id: "pay_race", order_id: purchase.orderId!, amount: 1900, currency: "USD", status: "captured", captured: true, amount_refunded: 0 };
    pauseRefresh = true;
    const activating = applyRazorpayPayment(payment);
    await started;
    await applyRazorpayPayment({ ...payment, status: "refunded", amount_refunded: 1900 });
    resumeRead();
    await activating;
    assert.equal(getTurnGrant(userId), null);
    assert.equal(retained.grant.usdMillicentsRemaining, 0, "a stale activation read must not revive the refunded WS grant");

    globalThis.fetch = async () => { throw new Error("connection lost after payment confirmation"); };
    const result = await followBillingRedirect({ ok: true, checkout: { provider: "razorpay", purchaseId: id, keyId: "rzp_test_races", orderId: purchase.orderId!, amount: 1900, currency: "USD", planId: "plus", testMode: true } });
    assert.equal(result, "paid_refresh_needed", "confirmed payment stays confirmed when the usage refresh fails");
    console.log("✓ Razorpay concurrent refund revocation and confirmed-payment refresh recovery");
  } finally {
    resumeRead();
    globalThis.fetch = originalFetch;
    await prisma.user.delete({ where: { id: userId } });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
