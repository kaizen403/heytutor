import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db/prisma";
import { applyRazorpayPayment } from "../../lib/billing/razorpayPayments";
import { loadRazorpayAccess, lockRazorpayUser } from "../../lib/billing/razorpayPurchases";
import { loadPeriodBalance, reservePeriodUsage, settlePeriodUsage } from "../../lib/billing/ledger";
import { addPeriodSpend } from "../../lib/billing/ledger";
import { reserveRazorpayNote } from "../../lib/billing/razorpayNotes";
import { createLessonGrant, getTurnGrant } from "../../lib/billing/grant";
import { holdNotesReservation } from "../../lib/billing/notesReservation";

async function verifyCheckoutUsageLockOrder() {
  const userId = randomUUID();
  await prisma.user.create({ data: { id: userId } });
  // Checkout owns the advisory lock before inserting its user foreign key.
  // Force real usage admission/reconciliation to wait at that same lock;
  // taking FOR UPDATE first would deadlock with checkout's FOR KEY SHARE.
  async function overlap<T>(work: () => Promise<T>): Promise<T> {
    let operation: Promise<T>;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const checkout = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      await lockRazorpayUser(tx, userId);
      operation = work();
      started();
      const deadline = Date.now() + 2_000;
      while (true) {
        const waiting = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        if (waiting[0]?.count) break;
        assert(Date.now() < deadline, "usage must reach checkout's advisory lock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await tx.billingPurchase.create({ data: {
        id: randomUUID(), userId, idempotencyKey: randomUUID(), planId: "plus",
        amount: 2900, usageMillicents: 12000, currency: "USD",
        keyId: "rzp_test_verification", testMode: true,
      } });
    });
    void checkout.finally(started).catch(() => undefined);
    const outcomes = await Promise.allSettled([checkout, ready.then(() => operation)]);
    assert.equal(outcomes[0].status, "fulfilled", "checkout must complete while usage waits");
    assert.equal(outcomes[1].status, "fulfilled", "usage must complete after checkout releases its lock");
    assert(outcomes[1].status === "fulfilled");
    return outcomes[1].value;
  }
  try {
    const receipt = await overlap(() => reservePeriodUsage({
      userId, planId: "free", traceId: randomUUID(), kind: "chat", millicents: 100, maxCalls: 1,
    }));
    assert(receipt);
    await overlap(() => settlePeriodUsage({ userId, reservationId: receipt.id, actualMillicents: 25 }));
    assert.equal((await loadPeriodBalance({ userId })).spentMillicents, 25);
    console.log("PASS concurrent checkout and usage reserve/settle lock order");
  } finally {
    await prisma.user.delete({ where: { id: userId } });
  }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.startsWith("/heytutor_razorpay_verify_"), "Use a dedicated local Razorpay verification database");
  process.env.BILLING_PROVIDER = "razorpay";
  process.env.RAZORPAY_KEY_ID = "rzp_test_verification";
  await verifyCheckoutUsageLockOrder();
  const userId = randomUUID();
  await prisma.user.create({ data: { id: userId } });
  async function purchase(planId = "plus", amount = 1900, usageMillicents = 12000) {
    const id = randomUUID();
    return prisma.billingPurchase.create({ data: { id, userId, idempotencyKey: randomUUID(), planId, amount, usageMillicents, currency: "USD", keyId: "rzp_test_verification", testMode: true, orderId: `order_${id.replaceAll("-", "")}` } });
  }
  const first = await purchase();
  const payment = { id: "pay_first", order_id: first.orderId!, amount: 1900, currency: "USD", status: "authorized", captured: false, amount_refunded: 0 };
  await assert.rejects(applyRazorpayPayment(payment), /payment_pending/);
  assert.equal((await loadRazorpayAccess(userId)).planId, "free");
  await assert.rejects(applyRazorpayPayment({ ...payment, status: "captured", captured: true, amount: 1 }), /invalid_payment/);
  const captured = { ...payment, status: "captured", captured: true };
  await Promise.all([applyRazorpayPayment(captured), applyRazorpayPayment(captured), applyRazorpayPayment(captured)]);
  const active = await loadRazorpayAccess(userId);
  assert.equal(active.planId, "plus");
  assert.equal(active.period, `razorpay:${first.id}`);
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 12000);
  const topup = await purchase("lesson_top_up", 1000, 10000);
  const topupPayment = { ...captured, id: "pay_topup", order_id: topup.orderId!, amount: 1000 };
  await Promise.all([applyRazorpayPayment(topupPayment), applyRazorpayPayment(topupPayment)]);
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 22000, "top-up only credited once under concurrency");
  await applyRazorpayPayment({ ...topupPayment, amount_refunded: 500 });
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 17000, "partial refund removes proportional top-up");
  await applyRazorpayPayment(topupPayment);
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 17000, "stale capture cannot undo a refund");
  await applyRazorpayPayment({ ...topupPayment, status: "refunded", amount_refunded: 1000 });
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 12000);
  const renewal = await purchase();
  await applyRazorpayPayment({ ...captured, id: "pay_renewal", order_id: renewal.orderId! });
  const queued = await prisma.billingPurchase.findUniqueOrThrow({ where: { id: renewal.id } });
  assert.equal(queued.accessStartsAt?.getTime(), active.endsAt?.getTime(), "early renewal queues the next full month");
  const upgrade = await purchase("pro", 3900, 24000);
  const portable = await purchase("lesson_top_up", 1000, 10000);
  const emptyGrant = createLessonGrant({ userId, traceId: "paid-follow-on", usdMillicents: 0 });
  assert(emptyGrant.ok);
  await applyRazorpayPayment({ ...captured, id: "pay_portable", order_id: portable.orderId!, amount: 1000 });
  assert(emptyGrant.grant.usdMillicentsRemaining > 0, "new capture revives exhausted same-trace grants");
  emptyGrant.grant.usdMillicentsRemaining = 0;
  await applyRazorpayPayment({ ...captured, id: "pay_portable", order_id: portable.orderId!, amount: 1000 });
  assert.equal(emptyGrant.grant.usdMillicentsRemaining, 0, "duplicate capture cannot revive allowance already consumed by a lesson");
  await addPeriodSpend({ userId, usd: 14 });
  assert.equal((await loadPeriodBalance({ userId })).remainingMillicents, 8000);
  await applyRazorpayPayment({ ...captured, id: "pay_pro", order_id: upgrade.orderId!, amount: 3900 });
  assert.equal((await loadPeriodBalance({ userId })).remainingMillicents, 32000, "unused top-up remains available through upgrade");
  const pro = await loadRazorpayAccess(userId);
  assert.equal(pro.planId, "pro");
  const cachedGrant = createLessonGrant({ userId, traceId: "refund-trace", usdMillicents: 24000 });
  assert(cachedGrant.ok);
  await applyRazorpayPayment({ ...captured, id: "pay_pro", order_id: upgrade.orderId!, amount: 3900, status: "refunded", amount_refunded: 3900 });
  assert.equal((await loadRazorpayAccess(userId)).planId, "plus", "full refund revokes only the refunded purchase");
  assert.equal(getTurnGrant(userId), null, "refund removes cached admission");
  assert.equal(cachedGrant.grant.usdMillicentsRemaining, 0, "refund revokes retained WS allowance too");
  assert.equal((await loadPeriodBalance({ userId })).remainingMillicents, 8000, "top-up remains available when refunded Pro reveals Plus again");
  await prisma.billingPurchase.updateMany({ where: { userId, planId: "lesson_top_up" }, data: { accessEndsAt: new Date("2020-02-01") } });
  await prisma.billingPurchase.updateMany({ where: { userId, planId: "plus" }, data: { accessStartsAt: new Date("2020-01-01"), accessEndsAt: new Date("2020-02-01") } });
  assert.equal((await loadRazorpayAccess(userId)).planId, "free", "expired purchases cannot grant perpetual paid access");
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 3500);
  const free = await loadRazorpayAccess(userId);
  await prisma.billingPeriodSpend.upsert({ where: { userId_period: { userId, period: free.period } }, create: { userId, period: free.period, notesMessages: 29 }, update: { notesMessages: 29 } });
  const notes = await Promise.all(Array.from({ length: 8 }, () => reserveRazorpayNote(userId)));
  assert.equal(notes.filter(Boolean).length, 1, "only one concurrent notes request reserves the last slot");
  await notes.find(Boolean)!.release();
  const reservation = await reserveRazorpayNote(userId);
  assert(reservation, "failed notes request releases its slot");
  const failedStream = holdNotesReservation(new Response(new ReadableStream({ start(controller) { controller.error(new Error("provider stream failed")); } })), reservation.release);
  await assert.rejects(failedStream.text(), /provider stream failed/);
  assert.equal((await prisma.billingPeriodSpend.findUniqueOrThrow({ where: { userId_period: { userId, period: free.period } } })).notesMessages, 29, "failed 200 stream releases undelivered message");
  const oldOriginal = await purchase();
  const oldRenewal = await purchase();
  await prisma.billingPurchase.update({ where: { id: oldOriginal.id }, data: { status: "paid", paymentId: "pay_old", accessStartsAt: new Date("2020-01-01"), accessEndsAt: new Date("2020-02-01") } });
  await prisma.billingPurchase.update({ where: { id: oldRenewal.id }, data: { status: "paid", accessStartsAt: new Date("2020-02-01"), accessEndsAt: new Date("2020-03-01") } });
  await applyRazorpayPayment({ ...captured, id: "pay_old", order_id: oldOriginal.orderId!, status: "refunded", amount_refunded: 1900 });
  assert.equal((await prisma.billingPurchase.findUniqueOrThrow({ where: { id: oldRenewal.id } })).accessEndsAt?.toISOString(), "2020-03-01T00:00:00.000Z", "late refund cannot revive a used or expired renewal");
  const mixedPlus = await purchase();
  const mixedRenewal = await purchase();
  const mixedPro = await purchase("pro", 3900, 24000);
  const mixedPayment = { ...captured, id: "pay_mixed_plus", order_id: mixedPlus.orderId! };
  await applyRazorpayPayment(mixedPayment);
  await applyRazorpayPayment({ ...captured, id: "pay_mixed_renewal", order_id: mixedRenewal.orderId! });
  await applyRazorpayPayment({ ...captured, id: "pay_mixed_pro", order_id: mixedPro.orderId!, amount: 3900 });
  await applyRazorpayPayment({ ...mixedPayment, status: "refunded", amount_refunded: 1900 });
  const proCoverage = await prisma.billingPurchase.findUniqueOrThrow({ where: { id: mixedPro.id } });
  assert.equal((await prisma.billingPurchase.findUniqueOrThrow({ where: { id: mixedRenewal.id } })).accessStartsAt?.getTime(), proCoverage.accessEndsAt?.getTime(), "refunded Plus cannot shift a renewal underneath active Pro");
  await applyRazorpayPayment({ ...captured, id: "pay_mixed_pro", order_id: mixedPro.orderId!, amount: 3900, status: "refunded", amount_refunded: 3900 });
  assert.equal((await loadRazorpayAccess(userId)).planId, "plus", "an unused queued month starts when the coverage ahead of it is refunded");
  await prisma.billingPurchase.updateMany({ where: { userId, status: "paid", planId: "plus" }, data: { accessStartsAt: new Date("2020-01-01"), accessEndsAt: new Date("2020-02-01") } });
  const testTopup = await purchase("lesson_top_up", 1000, 10000);
  await applyRazorpayPayment({ ...captured, id: "pay_test_free", order_id: testTopup.orderId!, amount: 1000 });
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 13500);
  process.env.RAZORPAY_KEY_ID = "rzp_live_verification";
  assert.equal((await loadRazorpayAccess(userId)).planId, "free", "test purchases never grant live access");
  assert.equal((await loadPeriodBalance({ userId })).allowanceMillicents, 3500, "free-user test top-ups never become live credits");
  await prisma.user.delete({ where: { id: userId } });
  console.log("✓ Razorpay Postgres capture, concurrency, top-up/refund, renewal, upgrade, expiry, and mode isolation");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
