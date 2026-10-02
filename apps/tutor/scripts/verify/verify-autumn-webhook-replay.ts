import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock, test } from "node:test";
import { Prisma } from "@prisma/client";

// Real signature verification, webhook handling, and balance calculation run
// against a fake ledger. No provider or real database can be reached.
globalThis.fetch = async () => { throw new Error("Security verification prohibits network requests"); };
process.env.BILLING_PROVIDER = "";
process.env.AUTUMN_WEBHOOK_SECRET = "security-verification-fake-webhook-secret";
const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
type SpendRow = { userId: string; period: string; spentMillicents: number; bonusMillicents: number };
const rows = new Map<string, SpendRow>();
const events = new Map<string, { provider: string; eventId: string }>();
let failCredit = false;
let transactionQueue = Promise.resolve();
const prisma = {
  user: { findUnique: async () => ({ id: "student-one", planId: "free" }), updateMany: async () => ({ count: 1 }) },
  billingPeriodSpend: {
    findUnique: async ({ where }: { where: { userId_period: { userId: string; period: string } } }) => rows.get(`${where.userId_period.userId}:${where.userId_period.period}`) ?? null,
    upsert: async ({ where, create, update }: {
      where: { userId_period: { userId: string; period: string } };
      create: SpendRow;
      update: { bonusMillicents?: { increment: number }; spentMillicents?: { increment: number } };
    }) => {
      if (failCredit) throw new Error("The fake database could not commit the credit");
      const key = `${where.userId_period.userId}:${where.userId_period.period}`;
      const previous = rows.get(key);
      const next = previous ? {
        ...previous,
        bonusMillicents: previous.bonusMillicents + (update.bonusMillicents?.increment ?? 0),
        spentMillicents: previous.spentMillicents + (update.spentMillicents?.increment ?? 0),
      } : { ...create, spentMillicents: create.spentMillicents ?? 0, bonusMillicents: create.bonusMillicents ?? 0 };
      rows.set(key, next);
      return next;
    },
  },
  billingWebhookEvent: {
    create: async ({ data }: { data: { provider: string; eventId: string } }) => {
      const key = `${data.provider}:${data.eventId}`;
      if (events.has(key)) throw new Prisma.PrismaClientKnownRequestError("Duplicate provider event", { code: "P2002", clientVersion: "fake" });
      events.set(key, data);
      return data;
    },
    findUnique: async ({ where }: { where: { provider_eventId: { provider: string; eventId: string } } }) => events.get(`${where.provider_eventId.provider}:${where.provider_eventId.eventId}`) ?? null,
    createMany: async ({ data }: { data: { provider: string; eventId: string }[] }) => {
      let count = 0;
      for (const event of data) {
        const key = `${event.provider}:${event.eventId}`;
        if (events.has(key)) continue;
        events.set(key, event);
        count++;
      }
      return { count };
    },
  },
  $transaction: async (operation: (transaction: object) => Promise<unknown>) => {
    const previous = transactionQueue;
    let release: () => void = () => undefined;
    transactionQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const originalRows = new Map(rows);
    const originalEvents = new Map(events);
    try {
      return await operation(prisma);
    } catch (error) {
      rows.clear();
      originalRows.forEach((row, key) => rows.set(key, row));
      events.clear();
      originalEvents.forEach((event, key) => events.set(key, event));
      throw error;
    } finally {
      release();
    }
  },
};
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma } });
const route = load(resolve(root, "app/api/billing/webhook/route.ts")) as typeof import("../../app/api/billing/webhook/route");

function signedTopUp(eventId: string): Request {
  const payload = JSON.stringify({ data: { customer_id: "student-one", plan_changes: [{ action: "activated", subscription: { plan_id: "lesson_top_up" } }] } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", process.env.AUTUMN_WEBHOOK_SECRET!).update(`${eventId}.${timestamp}.${payload}`).digest("base64");
  return new Request("https://app.accelute.co/api/billing/webhook", {
    method: "POST",
    headers: { "svix-id": eventId, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
    body: payload,
  });
}

test("a signed top-up event delivered twice credits the customer exactly once", async () => {
  rows.clear();
  events.clear();
  const first = await route.POST(signedTopUp("top-up-retry"));
  const retry = await route.POST(signedTopUp("top-up-retry"));
  assert.equal(first.status, 204);
  assert.equal(retry.status, 204);
  assert.equal([...rows.values()].reduce((sum, row) => sum + row.bonusMillicents, 0), 10_000);
});

test("two distinct signed top-up events each credit their own purchase", async () => {
  rows.clear();
  events.clear();
  const first = await route.POST(signedTopUp("top-up-distinct-one"));
  const second = await route.POST(signedTopUp("top-up-distinct-two"));
  assert.equal(first.status, 204);
  assert.equal(second.status, 204);
  assert.equal([...rows.values()].reduce((sum, row) => sum + row.bonusMillicents, 0), 20_000);
});

test("an unsigned event cannot credit a customer", async () => {
  rows.clear();
  events.clear();
  const request = signedTopUp("top-up-invalid");
  request.headers.set("svix-signature", "v1,invalid");
  assert.equal((await route.POST(request)).status, 400);
  assert.equal(rows.size, 0);
});

test("simultaneous deliveries of one signed purchase result in one credit", async () => {
  rows.clear();
  events.clear();
  const responses = await Promise.all([route.POST(signedTopUp("top-up-concurrent")), route.POST(signedTopUp("top-up-concurrent"))]);
  assert(responses.every(response => response.status === 204));
  assert.equal([...rows.values()].reduce((sum, row) => sum + row.bonusMillicents, 0), 10_000);
});

test("a failed credit commit leaves the signed purchase retryable", async () => {
  rows.clear();
  events.clear();
  failCredit = true;
  try {
    const response = await route.POST(signedTopUp("top-up-commit-retry"));
    assert(response.status >= 500);
  } catch (error) {
    assert.match(String(error), /fake database could not commit/);
  } finally {
    failCredit = false;
  }
  assert.equal(rows.size, 0);
  const retry = await route.POST(signedTopUp("top-up-commit-retry"));
  assert.equal(retry.status, 204);
  assert.equal([...rows.values()].reduce((sum, row) => sum + row.bonusMillicents, 0), 10_000);
});
