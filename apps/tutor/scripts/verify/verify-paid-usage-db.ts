import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// No dotenv, workstation DATABASE_URL, provider, or production account is used.
// Run only against the parent's disposable migrated Postgres database:
// SECURITY_TEST_DATABASE_URL=postgresql://.../heytutor_security_... pnpm exec tsx scripts/verify/verify-paid-usage-db.ts
const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");

async function main(): Promise<void> {
  const input = process.env.SECURITY_TEST_DATABASE_URL;
  assert(
    input,
    "SECURITY_TEST_DATABASE_URL must explicitly identify a disposable local security database",
  );
  const url = new URL(input);
  assert(
    ["postgres:", "postgresql:"].includes(url.protocol),
    "the security database must be Postgres",
  );
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "security database tests only allow loopback hosts",
  );
  assert(
    /^\/heytutor_security_[a-zA-Z0-9_]+$/.test(url.pathname),
    "use a dedicated heytutor_security_ prefixed database",
  );
  process.env.DATABASE_URL = input;
  process.env.BILLING_PROVIDER = "";
  process.env.RAZORPAY_KEY_ID = "rzp_test_security_ledger";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Database verification prohibits provider/network calls");
  };
  // Import only after validating and installing the explicit test DB URL.
  const { prisma } = load(
    resolve(root, "lib/db/prisma.ts"),
  ) as typeof import("../../lib/db/prisma");
  const ledger = load(
    resolve(root, "lib/billing/ledger.ts"),
  ) as typeof import("../../lib/billing/ledger");
  const createdUsers: string[] = [];
  const failures: string[] = [];
  async function user(): Promise<string> {
    const id = `security-ledger-${randomUUID()}`;
    await prisma.user.create({ data: { id } });
    createdUsers.push(id);
    return id;
  }
  const reserve = (
    userId: string,
    millicents = 1000,
    traceId = randomUUID(),
    maxCalls = 12,
    kind = "teaching",
  ) =>
    ledger.reservePeriodUsage({
      userId,
      planId: "free",
      traceId,
      kind,
      millicents,
      maxCalls,
    });
  async function purchase(
    userId: string,
    planId: string,
    usageMillicents: number,
    endsAt = new Date(Date.now() + 86_400_000),
  ) {
    return prisma.billingPurchase.create({
      data: {
        id: randomUUID(),
        userId,
        idempotencyKey: randomUUID(),
        planId,
        usageMillicents,
        amount: planId === "plus" ? 2900 : 1000,
        currency: "USD",
        keyId: "rzp_test_security_ledger",
        testMode: true,
        status: "paid",
        accessStartsAt: new Date(Date.now() - 60_000),
        accessEndsAt: endsAt,
      },
    });
  }
  async function check(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(
        `✗ ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  try {
    await check(
      "unknown/cancelled usage is charged before dispatch and replay cannot refund it",
      async () => {
        const id = await user();
        const receipt = await reserve(id);
        assert(receipt);
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          2500,
          "the charge is committed before a caller could dispatch",
        );
        assert.equal(
          (
            await prisma.paidUsageReservation.findUniqueOrThrow({
              where: { id: receipt.id },
            })
          ).settledMillicents,
          null,
        );
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
        });
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
          actualMillicents: 0,
        });
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).spentMillicents,
          1000,
        );
        assert.equal(
          (
            await prisma.paidUsageReservation.findUniqueOrThrow({
              where: { id: receipt.id },
            })
          ).settledMillicents,
          1000,
        );
      },
    );
    await check(
      "known lower usage and definitely undispatched work refund once",
      async () => {
        const id = await user();
        const receipt = await reserve(id);
        assert(receipt);
        await Promise.all(
          Array.from({ length: 8 }, () =>
            ledger.settlePeriodUsage({
              userId: id,
              reservationId: receipt.id,
              actualMillicents: 200,
            }),
          ),
        );
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).spentMillicents,
          200,
        );
        const undispatched = await reserve(id);
        assert(undispatched);
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: undispatched.id,
          actualMillicents: 0,
        });
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: undispatched.id,
          actualMillicents: 0,
        });
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).spentMillicents,
          200,
        );
      },
    );
    await check(
      "known actual spend above the reserved cap is recorded as debt",
      async () => {
        const id = await user();
        const receipt = await reserve(id, 1000);
        assert(receipt);
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
          actualMillicents: 4000,
        });
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).spentMillicents,
          4000,
          "reported vendor spend is never silently clamped away",
        );
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          0,
        );
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
          actualMillicents: 0,
        });
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).spentMillicents,
          4000,
          "replay cannot erase recorded debt",
        );
      },
    );
    await check(
      "a different account cannot reconcile someone else's receipt",
      async () => {
        const owner = await user();
        const attacker = await user();
        const receipt = await reserve(owner);
        assert(receipt);
        await ledger.settlePeriodUsage({
          userId: attacker,
          reservationId: receipt.id,
          actualMillicents: 0,
        });
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: owner })).spentMillicents,
          1000,
        );
        assert.equal(
          (
            await prisma.paidUsageReservation.findUniqueOrThrow({
              where: { id: receipt.id },
            })
          ).settledMillicents,
          null,
        );
      },
    );
    await check(
      "insufficient credit creates neither a spend nor a reservation",
      async () => {
        const id = await user();
        assert.equal(await reserve(id, 3501), null);
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          3500,
        );
        assert.equal(
          await prisma.paidUsageReservation.count({ where: { userId: id } }),
          0,
        );
      },
    );
    await check(
      "stale paid-plan metadata cannot upgrade the locked account allowance",
      async () => {
        const id = await user();
        const receipt = await ledger.reservePeriodUsage({
          userId: id,
          planId: "pro",
          traceId: randomUUID(),
          kind: "teaching",
          millicents: 4000,
          maxCalls: 4,
        });
        assert.equal(
          receipt,
          null,
          "the current free account cannot spend 4000 using a cached pro grant",
        );
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).spentMillicents,
          0,
        );
      },
    );
    await check(
      "current paid accounts retain their allowance despite stale free metadata",
      async () => {
        const id = await user();
        await prisma.user.update({ where: { id }, data: { planId: "pro" } });
        const receipt = await ledger.reservePeriodUsage({
          userId: id,
          planId: "free",
          traceId: randomUUID(),
          kind: "teaching",
          millicents: 4000,
          maxCalls: 4,
        });
        assert(receipt);
        assert.equal(receipt.planId, "pro");
        assert.equal(receipt.remainingMillicents, 20000);
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
        });
      },
    );
    await check(
      "parallel reservations cannot spend the same last balance",
      async () => {
        const id = await user();
        const results = await Promise.all(
          Array.from({ length: 12 }, () => reserve(id)),
        );
        const admitted = results.filter(
          (receipt): receipt is NonNullable<typeof receipt> => receipt !== null,
        );
        assert.equal(admitted.length, 3);
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          500,
        );
        assert.equal(
          await prisma.paidUsageReservation.count({ where: { userId: id } }),
          3,
        );
        await Promise.all(
          admitted.map((receipt) =>
            ledger.settlePeriodUsage({
              userId: id,
              reservationId: receipt.id,
              actualMillicents: 0,
            }),
          ),
        );
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          3500,
        );
      },
    );
    await check(
      "global pending-work admission is atomic across separate traces",
      async () => {
        const id = await user();
        const results = await Promise.all(
          Array.from({ length: 12 }, () => reserve(id, 1)),
        );
        const admitted = results.filter(
          (receipt): receipt is NonNullable<typeof receipt> => receipt !== null,
        );
        assert.equal(
          admitted.length,
          4,
          "ordinary paid work has four durable pending slots",
        );
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: admitted[0]!.id,
        });
        assert(
          await reserve(id, 1),
          "sealing a finished call releases one pending slot",
        );
      },
    );
    await check(
      "settled same-trace calls still consume their finite request allowance",
      async () => {
        const id = await user();
        const trace = randomUUID();
        for (let count = 0; count < 2; count += 1) {
          const receipt = await reserve(id, 1, trace, 2);
          assert(receipt);
          await ledger.settlePeriodUsage({
            userId: id,
            reservationId: receipt.id,
            actualMillicents: 0,
          });
        }
        assert.equal(
          await reserve(id, 1, trace, 2),
          null,
          "a refund is not a new phase-call allowance",
        );
        assert.equal(
          await prisma.paidUsageReservation.count({
            where: { userId: id, traceId: trace },
          }),
          2,
        );
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          3500,
        );
      },
    );
    await check(
      "period rollover reconciliation touches only the charged original period",
      async () => {
        const id = await user();
        const receipt = await reserve(id);
        assert(receipt);
        const saved = await prisma.paidUsageReservation.findUniqueOrThrow({
          where: { id: receipt.id },
        });
        const current = saved.period;
        const old = "1999-01";
        // Arrange a genuine prior-month receipt without changing the global clock.
        await prisma.$transaction([
          prisma.billingPeriodSpend.update({
            where: { userId_period: { userId: id, period: current } },
            data: { spentMillicents: 800 },
          }),
          prisma.billingPeriodSpend.create({
            data: { userId: id, period: old, spentMillicents: 1000 },
          }),
          prisma.paidUsageReservation.update({
            where: { id: receipt.id },
            data: {
              period: old,
              allocations: [{ period: old, millicents: 1000 }],
            },
          }),
        ]);
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
          actualMillicents: 250,
        });
        assert.equal(
          (
            await prisma.billingPeriodSpend.findUniqueOrThrow({
              where: { userId_period: { userId: id, period: old } },
            })
          ).spentMillicents,
          250,
        );
        assert.equal(
          (
            await prisma.billingPeriodSpend.findUniqueOrThrow({
              where: { userId_period: { userId: id, period: current } },
            })
          ).spentMillicents,
          800,
        );
      },
    );
    process.env.BILLING_PROVIDER = "razorpay";
    await check(
      "Razorpay reservation and reconciliation preserve included/top-up allocation",
      async () => {
        const id = await user();
        const plan = await purchase(id, "plus", 12000);
        const topup = await purchase(id, "lesson_top_up", 1000);
        const later = await purchase(
          id,
          "lesson_top_up",
          1000,
          new Date(Date.now() + 2 * 86_400_000),
        );
        const period = `razorpay:${plan.id}`;
        await prisma.billingPeriodSpend.create({
          data: { userId: id, period, spentMillicents: 11900 },
        });
        const receipt = await reserve(id, 500);
        assert(receipt);
        assert.equal(
          (
            await prisma.billingPeriodSpend.findUniqueOrThrow({
              where: { userId_period: { userId: id, period } },
            })
          ).spentMillicents,
          12000,
        );
        assert.equal(
          (
            await prisma.billingPurchase.findUniqueOrThrow({
              where: { id: topup.id },
            })
          ).spentMillicents,
          400,
        );
        assert.equal(
          (
            await prisma.billingPurchase.findUniqueOrThrow({
              where: { id: later.id },
            })
          ).spentMillicents,
          0,
        );
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
          actualMillicents: 200,
        });
        assert.equal(
          (
            await prisma.billingPeriodSpend.findUniqueOrThrow({
              where: { userId_period: { userId: id, period } },
            })
          ).spentMillicents,
          12000,
        );
        assert.equal(
          (
            await prisma.billingPurchase.findUniqueOrThrow({
              where: { id: topup.id },
            })
          ).spentMillicents,
          100,
        );
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          1900,
        );
      },
    );
    await check(
      "refund after subscription replacement cannot credit the new purchase period",
      async () => {
        const id = await user();
        const original = await purchase(id, "plus", 12000);
        const receipt = await reserve(id, 1000);
        assert(receipt);
        await prisma.billingPurchase.update({
          where: { id: original.id },
          data: { accessEndsAt: new Date(Date.now() - 1) },
        });
        const replacement = await purchase(id, "pro", 24000);
        const replacementPeriod = `razorpay:${replacement.id}`;
        await prisma.billingPeriodSpend.create({
          data: { userId: id, period: replacementPeriod, spentMillicents: 800 },
        });
        await ledger.settlePeriodUsage({
          userId: id,
          reservationId: receipt.id,
          actualMillicents: 250,
        });
        assert.equal(
          (
            await prisma.billingPeriodSpend.findUniqueOrThrow({
              where: {
                userId_period: {
                  userId: id,
                  period: `razorpay:${original.id}`,
                },
              },
            })
          ).spentMillicents,
          250,
        );
        assert.equal(
          (
            await prisma.billingPeriodSpend.findUniqueOrThrow({
              where: {
                userId_period: { userId: id, period: replacementPeriod },
              },
            })
          ).spentMillicents,
          800,
        );
        assert.equal(
          (await ledger.loadPeriodBalance({ userId: id })).remainingMillicents,
          23200,
        );
      },
    );
    await check(
      "deleted accounts cannot create paid reservations",
      async () => {
        const id = await user();
        await prisma.user.delete({ where: { id } });
        assert.equal(await reserve(id, 1), null);
        assert.equal(
          await prisma.paidUsageReservation.count({ where: { userId: id } }),
          0,
        );
      },
    );
  } finally {
    try {
      await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    } finally {
      await prisma.$disconnect();
      globalThis.fetch = originalFetch;
    }
  }
  assert.equal(
    failures.length,
    0,
    `${failures.length} paid-usage database checks failed`,
  );
  console.log(
    "✓ real Postgres paid reservations, concurrency, replay, allocation, and deletion",
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
