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

let nowFn: () => number = Date.now;

export function setLedgerNowForTests(now: () => number): void {
  nowFn = now;
}

export function resetLedgerNowForTests(): void {
  nowFn = Date.now;
}

export function billingPeriodKey(ms = nowFn()): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export function billingPeriodResetAt(ms = nowFn()): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
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
