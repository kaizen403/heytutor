import { calculateLlmCostDetails, calculateTtsCostDetails } from "@/lib/obs/usageCost";
import { AutumnUnavailableError, trackFeature } from "./autumnClient";
import { BILLING_FEATURES, usdToMillicents } from "./catalog";
import { isProviderMockMode, isTtsConfigured } from "./flags";
import { consumeUsdMillicents, getTurnGrant, syncGrantUsdRemaining } from "./grant";
import { addPeriodSpend, cacheUsageOnUser } from "./ledger";
import type { SpendActor } from "./actor";

function shouldCountUsd(input: { skipGates?: boolean }): boolean {
  return !input.skipGates && !isProviderMockMode();
}

function shouldTrackAutumn(input: { skipAutumn?: boolean; skipGates?: boolean }): boolean {
  return !input.skipAutumn && !input.skipGates && !isProviderMockMode();
}

function rememberSpend(input: {
  userId: string;
  planId?: string | null;
  usd: number;
}): void {
  const millicents = usdToMillicents(input.usd);
  const grant = getTurnGrant(input.userId);
  if (grant && millicents > 0) {
    consumeUsdMillicents(grant, millicents);
  }
  void addPeriodSpend({
    userId: input.userId,
    planId: input.planId ?? grant?.planId,
    usd: input.usd,
  })
    .then((balance) => {
      syncGrantUsdRemaining(input.userId, balance.remainingMillicents);
      return cacheUsageOnUser({
        userId: input.userId,
        planId: balance.planId,
        remainingPct: balance.remainingPct,
      });
    })
    .catch((error) => {
      console.error("[billing] period spend failed", error);
    });
}

export function recordLlmSpend(input: {
  actor: SpendActor;
  model?: string | null;
  usage?: { input?: number; output?: number; total?: number };
}): void {
  const usage = input.usage ?? {};
  const tokens = (usage.input ?? 0) + (usage.output ?? 0) || usage.total || 0;
  const usd = calculateLlmCostDetails(usage, { model: input.model }).total ?? 0;
  if (shouldCountUsd(input.actor) && usd > 0) {
    rememberSpend({
      userId: input.actor.userId,
      planId: getTurnGrant(input.actor.userId)?.planId,
      usd,
    });
  }
  if (!shouldTrackAutumn(input.actor) || tokens <= 0) {
    return;
  }
  void trackFeature({
    userId: input.actor.userId,
    featureId: BILLING_FEATURES.llmTokens,
    value: tokens,
    properties: { model: input.model ?? "unknown" },
  }).catch((error) => {
    if (!(error instanceof AutumnUnavailableError)) {
      console.error("[billing] llm_tokens track failed", error);
    }
  });
}

export function recordTtsSpend(input: {
  userId: string;
  characters: number;
  model?: string | null;
  skipAutumn?: boolean;
  skipGates?: boolean;
}): void {
  if (input.characters <= 0 || !isTtsConfigured()) {
    return;
  }
  const usd = calculateTtsCostDetails(input.characters, { model: input.model }).total ?? 0;
  if (shouldCountUsd(input) && usd > 0) {
    rememberSpend({
      userId: input.userId,
      planId: getTurnGrant(input.userId)?.planId,
      usd,
    });
  }
  if (!shouldTrackAutumn(input)) {
    return;
  }
  void trackFeature({
    userId: input.userId,
    featureId: BILLING_FEATURES.ttsChars,
    value: input.characters,
  }).catch((error) => {
    if (!(error instanceof AutumnUnavailableError)) {
      console.error("[billing] tts_chars track failed", error);
    }
  });
}

export function recordNotesMessage(actor: SpendActor): void {
  if (!shouldTrackAutumn(actor)) return;
  void trackFeature({
    userId: actor.userId,
    featureId: BILLING_FEATURES.notesMessages,
    value: 1,
  }).catch((error) => {
    if (!(error instanceof AutumnUnavailableError)) {
      console.error("[billing] notes_messages track failed", error);
    }
  });
}
