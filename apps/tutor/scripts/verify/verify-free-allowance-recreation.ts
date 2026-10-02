import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock, test } from "node:test";

// Executes the signup, account deletion, and allowance paths against retained
// in-memory data. The fake database models User foreign-key cascades.
Object.assign(process.env, { NODE_ENV: "production" });
process.env.AUTH_DISABLED = "0";
process.env.NEXT_PUBLIC_AUTH_DISABLED = "0";
process.env.BILLING_PROVIDER = "";
process.env.AUTUMN_SECRET_KEY = "";
process.env.AUTH_SECRET = "fake-security-verification-auth-secret";
globalThis.fetch = async () => { throw new Error("Security verification prohibits network requests"); };

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
type User = {
  id: string; email: string | null; name: string | null; image: string | null;
  createdAt: Date; emailVerified?: Date | null; planId: string | null;
};
type Spend = { userId: string; period: string; spentMillicents: number; bonusMillicents: number };
type Identity = { identityHash: string; freePeriod: string; spentMillicents: number; expiresAt: Date; freeWindowStartsAt?: Date | null };
const users = new Map<string, User>();
const spend = new Map<string, Spend>();
const identities = new Map<string, Identity>();
let sessionUserId: string | null = null;

const prisma = {
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => where.id
      ? users.get(where.id) ?? null
      : [...users.values()].find(user => user.email === where.email) ?? null,
    create: async ({ data }: { data: Partial<User> & { id: string } }) => {
      const user: User = { email: null, name: null, image: null, createdAt: new Date(), planId: "free", ...data };
      users.set(user.id, user);
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
      const previous = users.get(where.id);
      assert(previous, "the fake database requires the user to exist");
      const user = { ...previous, ...data };
      users.set(user.id, user);
      return user;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const user = users.get(where.id);
      assert(user, "the fake database requires the user to exist before deleting");
      users.delete(where.id);
      for (const [key, row] of spend) if (row.userId === where.id) spend.delete(key);
      return user;
    },
  },
  userSettings: { upsert: async () => undefined },
  board: { findMany: async () => [] },
  objectDeletionJob: { createMany: async () => ({ count: 1 }) },
  billingPurchase: { findMany: async () => [] },
  billingPeriodSpend: {
    findUnique: async ({ where }: { where: { userId_period: { userId: string; period: string } } }) => spend.get(`${where.userId_period.userId}:${where.userId_period.period}`) ?? null,
    findMany: async ({ where }: { where: { userId: string; period?: { in: string[] } } }) => [...spend.values()].filter(row => row.userId === where.userId && (!where.period || where.period.in.includes(row.period))),
    upsert: async ({ where, create, update }: {
      where: { userId_period: { userId: string; period: string } };
      create: Spend;
      update: { spentMillicents?: number | { increment: number }; bonusMillicents?: number | { increment: number } };
    }) => {
      const key = `${where.userId_period.userId}:${where.userId_period.period}`;
      const previous = spend.get(key);
      const next = previous ? {
        ...previous,
        spentMillicents: typeof update.spentMillicents === "number" ? update.spentMillicents : previous.spentMillicents + (update.spentMillicents?.increment ?? 0),
        bonusMillicents: typeof update.bonusMillicents === "number" ? update.bonusMillicents : previous.bonusMillicents + (update.bonusMillicents?.increment ?? 0),
      } : { ...create, spentMillicents: create.spentMillicents ?? 0, bonusMillicents: create.bonusMillicents ?? 0 };
      spend.set(key, next);
      return next;
    },
  },
  abuseIdentity: {
    findUnique: async ({ where }: { where: { identityHash: string } }) => identities.get(where.identityHash) ?? null,
    upsert: async ({ where, create, update }: { where: { identityHash: string }; create: Identity; update: Partial<Identity> }) => {
      const row = identities.get(where.identityHash);
      const next = row ? { ...row, ...update } : create;
      identities.set(where.identityHash, next);
      return next;
    },
    deleteMany: async ({ where }: { where: { expiresAt: { lte: Date } } }) => {
      let count = 0;
      for (const [key, row] of identities) if (row.expiresAt <= where.expiresAt.lte) {
        identities.delete(key);
        count++;
      }
      return { count };
    },
  },
  $executeRaw: async () => 0,
  $queryRaw: async () => [],
  $transaction: async (operation: (transaction: object) => Promise<unknown>) => operation(prisma),
};
mock.module(resolve(root, "auth.ts"), {
  namedExports: { auth: async () => sessionUserId ? { user: { id: sessionUserId } } : null, signOut: async () => undefined },
});
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma } });
mock.module(resolve(root, "lib/object-store/s3.ts"), {
  namedExports: { boardAudioPrefix: (id: string) => id, userImagePrefix: (id: string) => id, deletePrefix: async () => undefined },
});
const { findOrCreateSignedInUser } = load(resolve(root, "lib/auth/signedInUser.ts")) as typeof import("../../lib/auth/signedInUser");
const { addPeriodSpend, loadPeriodBalance } = load(resolve(root, "lib/billing/ledger.ts")) as typeof import("../../lib/billing/ledger");
const account = load(resolve(root, "app/api/account/route.ts")) as typeof import("../../app/api/account/route");
const onboarding = load(resolve(root, "app/api/account/onboarding/route.ts")) as typeof import("../../app/api/account/onboarding/route");

test("deleting and recreating the same verified identity does not reset its free allowance", async () => {
  users.clear();
  spend.clear();
  identities.clear();
  const original = await findOrCreateSignedInUser({ email: "student@example.edu", emailVerified: new Date() });
  sessionUserId = original.id;
  const before = await loadPeriodBalance({ userId: original.id, planId: "free" });
  assert(before.remainingMillicents > 0, "a new verified student starts with a free allowance");
  const used = await addPeriodSpend({ userId: original.id, planId: "free", usd: before.remainingMillicents / 1000 });
  assert.equal(used.remainingMillicents, 0);
  assert.equal((await account.DELETE()).status, 200);
  assert.equal(users.has(original.id), false);

  const rejoined = await findOrCreateSignedInUser({ email: " STUDENT@example.edu ", emailVerified: new Date() });
  const after = await loadPeriodBalance({ userId: rejoined.id, planId: "free" });
  assert.equal(after.remainingMillicents, 0);
  assert(identities.size > 0);
  assert.equal(JSON.stringify([...identities.values()]).includes("student@example.edu"), false);
});

test("a different verified identity can still receive its own free allowance", async () => {
  const other = await findOrCreateSignedInUser({ email: "another@example.edu", emailVerified: new Date() });
  const balance = await loadPeriodBalance({ userId: other.id, planId: "free" });
  assert(balance.remainingMillicents > 0);
});

test("successive deletions preserve additional spend instead of restoring an older floor", async () => {
  users.clear(); spend.clear(); identities.clear();
  const original = await findOrCreateSignedInUser({ email: "partial@example.edu", emailVerified: new Date() });
  sessionUserId = original.id;
  const baseline = await loadPeriodBalance({ userId: original.id, planId: "free" });
  await addPeriodSpend({ userId: original.id, planId: "free", usd: 1 });
  await account.DELETE();
  const second = await findOrCreateSignedInUser({ email: "partial@example.edu", emailVerified: new Date() });
  sessionUserId = second.id;
  const restored = await loadPeriodBalance({ userId: second.id, planId: "free" });
  assert.equal(restored.remainingMillicents, baseline.remainingMillicents - 1000);
  await addPeriodSpend({ userId: second.id, planId: "free", usd: 0.5 });
  await account.DELETE();
  const third = await findOrCreateSignedInUser({ email: "partial@example.edu", emailVerified: new Date() });
  const after = await loadPeriodBalance({ userId: third.id, planId: "free" });
  assert.equal(after.remainingMillicents, baseline.remainingMillicents - 1500);
});

test("the underage refusal deletion path cannot reset a previously consumed allowance", async () => {
  users.clear(); spend.clear(); identities.clear();
  const original = await findOrCreateSignedInUser({ email: "refused@example.edu", emailVerified: new Date() });
  sessionUserId = original.id;
  const before = await loadPeriodBalance({ userId: original.id, planId: "free" });
  await addPeriodSpend({ userId: original.id, planId: "free", usd: before.remainingMillicents / 1000 });
  const response = await onboarding.POST(new Request("https://app.accelute.co/api/account/onboarding", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ageBand: "under_13" }),
  }));
  assert.equal(response.status, 403);
  const rejoined = await findOrCreateSignedInUser({ email: "refused@example.edu", emailVerified: new Date() });
  assert.equal((await loadPeriodBalance({ userId: rejoined.id, planId: "free" })).remainingMillicents, 0);
});

test("Razorpay free allowance consumption also survives account recreation", async () => {
  users.clear(); spend.clear(); identities.clear();
  process.env.BILLING_PROVIDER = "razorpay";
  process.env.RAZORPAY_KEY_ID = "rzp_live_fake";
  try {
    const original = await findOrCreateSignedInUser({ email: "razor-free@example.edu", emailVerified: new Date() });
    sessionUserId = original.id;
    const before = await loadPeriodBalance({ userId: original.id, planId: "free" });
    await addPeriodSpend({ userId: original.id, planId: "free", usd: before.remainingMillicents / 1000 });
    await account.DELETE();
    const rejoined = await findOrCreateSignedInUser({ email: "razor-free@example.edu", emailVerified: new Date() });
    assert.equal((await loadPeriodBalance({ userId: rejoined.id, planId: "free" })).remainingMillicents, 0);
  } finally {
    process.env.BILLING_PROVIDER = "";
  }
});

test("account recreation retains each billing namespace without transferring sandbox spend to live", async () => {
  users.clear(); spend.clear(); identities.clear();
  const previousProvider = process.env.BILLING_PROVIDER;
  const previousKey = process.env.RAZORPAY_KEY_ID;
  process.env.BILLING_PROVIDER = "razorpay";
  process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
  try {
    const sandbox = await findOrCreateSignedInUser({ email: "mode-isolation@example.edu", emailVerified: new Date() });
    sessionUserId = sandbox.id;
    await addPeriodSpend({ userId: sandbox.id, planId: "free", usd: 1 });
    await account.DELETE();

    process.env.RAZORPAY_KEY_ID = "rzp_live_fake";
    const live = await findOrCreateSignedInUser({ email: "mode-isolation@example.edu", emailVerified: new Date() });
    sessionUserId = live.id;
    assert.equal((await loadPeriodBalance({ userId: live.id })).remainingMillicents, 3500, "sandbox spend must not debit a live account");
    await addPeriodSpend({ userId: live.id, planId: "free", usd: 0.5 });
    await account.DELETE();

    process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
    const sandboxAgain = await findOrCreateSignedInUser({ email: "mode-isolation@example.edu", emailVerified: new Date() });
    assert.equal((await loadPeriodBalance({ userId: sandboxAgain.id })).remainingMillicents, 2500, "sandbox recreation preserves only its original sandbox spend");
    process.env.RAZORPAY_KEY_ID = "rzp_live_fake";
    assert.equal((await loadPeriodBalance({ userId: sandboxAgain.id })).remainingMillicents, 3000, "live recreation preserves only its original live spend");
    process.env.BILLING_PROVIDER = "";
    assert.equal((await loadPeriodBalance({ userId: sandboxAgain.id })).remainingMillicents, 3500, "Razorpay spend must not transfer into the Autumn ledger");
  } finally {
    process.env.BILLING_PROVIDER = previousProvider;
    process.env.RAZORPAY_KEY_ID = previousKey;
  }
});

test("historical unscoped identity floors remain conservative in production without debiting sandbox", async () => {
  users.clear(); spend.clear(); identities.clear();
  const email = "legacy-floor@example.edu";
  const identityHash = createHmac("sha256", process.env.AUTH_SECRET!).update(`free-allowance:v1:${email}`).digest("hex");
  identities.set(identityHash, { identityHash, freePeriod: new Date().toISOString().slice(0, 7), spentMillicents: 1000, expiresAt: new Date(Date.now() + 86_400_000) });
  const previousProvider = process.env.BILLING_PROVIDER;
  const previousKey = process.env.RAZORPAY_KEY_ID;
  process.env.BILLING_PROVIDER = "razorpay";
  process.env.RAZORPAY_KEY_ID = "rzp_live_fake";
  try {
    const rejoined = await findOrCreateSignedInUser({ email, emailVerified: new Date() });
    assert.equal((await loadPeriodBalance({ userId: rejoined.id })).remainingMillicents, 2500);
    process.env.BILLING_PROVIDER = "";
    assert.equal((await loadPeriodBalance({ userId: rejoined.id })).remainingMillicents, 2500, "historical production usage is not reset during compatibility migration");
    process.env.BILLING_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
    assert.equal((await loadPeriodBalance({ userId: rejoined.id })).remainingMillicents, 3500, "historical production floors must not debit sandbox usage");
  } finally {
    process.env.BILLING_PROVIDER = previousProvider;
    process.env.RAZORPAY_KEY_ID = previousKey;
  }
});

test("expired purpose-limited identity records do not live on through another signup", async () => {
  users.clear(); spend.clear(); identities.clear();
  const original = await findOrCreateSignedInUser({ email: "expired@example.edu", emailVerified: new Date() });
  sessionUserId = original.id;
  const before = await loadPeriodBalance({ userId: original.id, planId: "free" });
  await addPeriodSpend({ userId: original.id, planId: "free", usd: before.remainingMillicents / 1000 });
  await account.DELETE();
  for (const row of identities.values()) row.expiresAt = new Date(Date.now() - 1000);
  const rejoined = await findOrCreateSignedInUser({ email: "expired@example.edu", emailVerified: new Date() });
  assert((await loadPeriodBalance({ userId: rejoined.id, planId: "free" })).remainingMillicents > 0);
  assert.equal(identities.size, 0);
});
