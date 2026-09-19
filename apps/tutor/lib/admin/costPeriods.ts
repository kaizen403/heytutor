import { billingPeriodKey } from "@/lib/billing/ledgerMath";

export function previousPeriodKey(nowMs: number): string {
  const date = new Date(nowMs);
  return billingPeriodKey(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

/** Last `count` UTC calendar months, oldest first, including the current month. */
export function recentPeriodKeys(count: number, nowMs: number = Date.now()): string[] {
  const date = new Date(nowMs);
  const keys: string[] = [];
  for (let offset = Math.max(1, count) - 1; offset >= 0; offset -= 1) {
    keys.push(billingPeriodKey(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - offset, 1)));
  }
  return keys;
}
