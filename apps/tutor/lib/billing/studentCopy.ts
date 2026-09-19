import { TOP_UP_USD } from "./catalog";

export const OUT_OF_USAGE_TITLE = "Out of usage";
export const UPGRADE_LABEL = "Upgrade";
export const TEEN_CHECKOUT_COPY = "Ask a parent or guardian to upgrade.";
export const TOP_UP_CTA = `Add usage · $${TOP_UP_USD}`;

export function isTeenAgeBand(ageBand: string | null | undefined): boolean {
  return ageBand === "13_17";
}

export function remainingPctLabel(
  remainingPct: number | null,
  options?: { staff?: boolean },
): string {
  if (options?.staff || remainingPct == null) return "Unlimited";
  return `${Math.max(0, Math.min(100, Math.round(remainingPct)))}% left`;
}

export function remainingPctBarWidth(
  remainingPct: number | null,
  options?: { staff?: boolean },
): number {
  if (options?.staff || remainingPct == null) return 100;
  return Math.max(0, Math.min(100, Math.round(remainingPct)));
}

export function formatResetLabel(nextResetAt: number | null): string {
  if (nextResetAt == null) return "Resets each calendar month";
  const date = new Date(nextResetAt);
  if (!Number.isFinite(date.getTime())) return "Resets each calendar month";
  return `Resets ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

export function isOutOfCreditsCode(code: string): boolean {
  return code === "out_of_credits" || code === "daily_usd_limit";
}

/**
 * A lost in-memory grant (`no_grant`) is not an empty envelope. Mapping it to
 * Out of usage locked Ask / Explain this while the usage bar still had leftover.
 */
export function isOutOfUsageLock(failure: { code: string; remaining?: number | null }): boolean {
  if (failure.code === "no_grant") {
    return failure.remaining == null || failure.remaining <= 0;
  }
  return isOutOfCreditsCode(failure.code);
}

export function studentBillingMessage(code: string): string {
  switch (code) {
    case "out_of_credits":
    case "daily_usd_limit":
      return OUT_OF_USAGE_TITLE;
    case "no_grant":
      return "Could not start the lesson";
    case "notes_limit":
      return "Out of notes messages this month";
    case "rate_limited":
      return "Too many questions. Try again in a bit";
    case "concurrent_limit":
      return "A lesson is already in progress";
    case "doubt_limit":
      return "You've asked enough doubts on this question";
    case "autumn_unavailable":
      return "Billing is temporarily unavailable";
    case "unauthorized":
      return "Sign in to continue";
    case "tts_budget":
      return "Voice paused for this lesson";
    case "timeout":
      return "the request took too long. try asking again.";
    default:
      return "Could not start the lesson";
  }
}

export function outOfCreditsDescription(ageBand?: string | null): string {
  const base = "Upgrade to keep going.";
  if (isTeenAgeBand(ageBand)) return `${base} ${TEEN_CHECKOUT_COPY}`;
  return base;
}
