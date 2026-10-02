import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { billingPeriodKey } from "../billing/ledgerMath";

const IDENTITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
type Database = Pick<Prisma.TransactionClient, "abuseIdentity" | "billingPeriodSpend" | "$executeRaw">;
type VerifiedIdentity = { email: string | null; emailVerified: Date | null };
type FreeNamespace = "autumn" | "razorpay:live" | "razorpay:test";
type RetainedUsage = { freePeriod: string; spentMillicents: number; expiresAt: Date };

export function abuseIdentityHash(user: VerifiedIdentity, namespace?: FreeNamespace): string | null {
  const email = user.email?.trim().toLowerCase();
  if (!email || !user.emailVerified) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for retained identity abuse controls");
  const purpose = namespace ? `free-allowance:v2:${namespace}:${email}` : `free-allowance:v1:${email}`;
  return createHmac("sha256", secret).update(purpose).digest("hex");
}

function freeLedgers(period: string): { namespace: FreeNamespace; period: string }[] {
  return [
    { namespace: "autumn", period },
    { namespace: "razorpay:live", period: `razorpay:live:free:${period}` },
    { namespace: "razorpay:test", period: `razorpay:test:free:${period}` },
  ];
}

function retainedFloor(row: RetainedUsage | null, period: string, now: Date): number {
  return row && row.freePeriod === period && row.expiresAt > now ? Math.max(0, row.spentMillicents) : 0;
}

async function lockIdentity(tx: Database, identityHash: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`free-identity:${identityHash}`}, 0))`;
}

/** Each billing namespace retains its own keyed consumed floor. The original
 * identity hash remains the common lock, including older deployed callers. */
export async function retainIdentityUsage(
  tx: Database,
  user: VerifiedIdentity & { id: string },
  now = new Date(),
): Promise<void> {
  const identityHash = abuseIdentityHash(user);
  if (!identityHash) return;
  await lockIdentity(tx, identityHash);
  const freePeriod = billingPeriodKey(now.getTime());
  const ledgers = freeLedgers(freePeriod);
  const legacy = await tx.abuseIdentity.findUnique({ where: { identityHash } });
  const rows = await tx.billingPeriodSpend.findMany({
    where: { userId: user.id, period: { in: ledgers.map(ledger => ledger.period) } },
    select: { period: true, spentMillicents: true },
  });
  for (const ledger of ledgers) {
    const scopedHash = abuseIdentityHash(user, ledger.namespace)!;
    const previous = await tx.abuseIdentity.findUnique({ where: { identityHash: scopedHash } });
    // Historical records did not identify their billing mode. Preserve their
    // production floor conservatively, without importing it into sandbox.
    const legacyFloor = ledger.namespace === "razorpay:test" ? 0 : retainedFloor(legacy, freePeriod, now);
    const spentMillicents = Math.max(legacyFloor, retainedFloor(previous, freePeriod, now), rows.find(row => row.period === ledger.period)?.spentMillicents ?? 0);
    if (spentMillicents <= 0) continue;
    const record = {
      freePeriod,
      spentMillicents,
      freeWindowStartsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      expiresAt: new Date(now.getTime() + IDENTITY_RETENTION_MS),
    };
    await tx.abuseIdentity.upsert({ where: { identityHash: scopedHash }, create: { identityHash: scopedHash, ...record }, update: record });
  }
  await tx.abuseIdentity.deleteMany({ where: { expiresAt: { lte: now } } });
}

/** A returning verified email keeps its consumed allowance under the new id. */
export async function restoreIdentityUsage(
  tx: Database,
  user: VerifiedIdentity & { id: string },
  now = new Date(),
): Promise<void> {
  const identityHash = abuseIdentityHash(user);
  if (!identityHash) return;
  await lockIdentity(tx, identityHash);
  const legacy = await tx.abuseIdentity.findUnique({ where: { identityHash } });
  const freePeriod = billingPeriodKey(now.getTime());
  for (const ledger of freeLedgers(freePeriod)) {
    const scopedHash = abuseIdentityHash(user, ledger.namespace)!;
    const retained = await tx.abuseIdentity.findUnique({ where: { identityHash: scopedHash } });
    const legacyFloor = ledger.namespace === "razorpay:test" ? 0 : retainedFloor(legacy, freePeriod, now);
    const spentMillicents = Math.max(legacyFloor, retainedFloor(retained, freePeriod, now));
    if (spentMillicents <= 0) continue;
    await tx.billingPeriodSpend.upsert({
      where: { userId_period: { userId: user.id, period: ledger.period } },
      create: { userId: user.id, period: ledger.period, spentMillicents },
      update: {},
    });
  }
  await tx.abuseIdentity.deleteMany({ where: { expiresAt: { lte: now } } });
}
