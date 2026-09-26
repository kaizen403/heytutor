import { includedUsdMillicents } from "./catalog";

export interface PeriodBalance {
  period: string;
  planId: string;
  spentMillicents: number;
  bonusMillicents: number;
  allowanceMillicents: number;
  remainingMillicents: number;
  remainingPct: number;
  nextResetAt: number;
}

const nowFn: () => number = Date.now;

export function billingPeriodKey(ms = nowFn()): string {
  return new Date(ms).toISOString().slice(0, 7);
}

function billingPeriodResetAt(ms = nowFn()): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/**
 * Whole millicents to post now, plus the fraction still owed.
 * Jev and short Cartesia clips are often below $0.001; rounding each call
 * would drop them from the monthly admin total.
 */
export function takePostedMillicents(
  pending: number,
  usd: number,
): { millicents: number; pending: number } {
  const next = pending + usd * 1000;
  if (!Number.isFinite(next) || next <= 0) return { millicents: 0, pending: 0 };
  const millicents = Math.floor(next + 1e-9);
  return { millicents, pending: next - millicents };
}

export function remainingUsagePct(spentMillicents: number, allowanceMillicents: number): number {
  if (allowanceMillicents <= 0) return 0;
  const remaining = Math.max(0, allowanceMillicents - Math.max(0, spentMillicents));
  return Math.max(0, Math.min(100, Math.round((remaining / allowanceMillicents) * 100)));
}

export function balanceFromRow(input: {
  planId: string;
  spentMillicents: number;
  bonusMillicents: number;
  period?: string;
  nowMs?: number;
}): PeriodBalance {
  const nowMs = input.nowMs ?? nowFn();
  const included = includedUsdMillicents(input.planId);
  const allowanceMillicents = included + Math.max(0, input.bonusMillicents);
  const spentMillicents = Math.max(0, input.spentMillicents);
  return {
    period: input.period ?? billingPeriodKey(nowMs),
    planId: input.planId,
    spentMillicents,
    bonusMillicents: Math.max(0, input.bonusMillicents),
    allowanceMillicents,
    remainingMillicents: Math.max(0, allowanceMillicents - spentMillicents),
    remainingPct: remainingUsagePct(spentMillicents, allowanceMillicents),
    nextResetAt: billingPeriodResetAt(nowMs),
  };
}
