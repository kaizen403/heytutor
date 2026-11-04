import * as Sentry from "@sentry/nextjs";
import { prisma } from "../db/prisma";
import { compatChatUrl, compatCircuit, resolveLlmEndpoint } from "../llm/llmProvider";
import { logWorkerFailure } from "../obs/workerFailureLog";
import { buildSnapshot, creditCycle, pollAiCredits, type AiCreditsSnapshot, type CreditStore, type CycleRow } from "./aiCreditsCore";

const POLL_MS = 60_000;
const HISTORY_CYCLES = 6;

type Env = Record<string, string | undefined>;

function relayConfigured(env: Env): boolean {
  return env.LLM_PROVIDER?.trim().toLowerCase() === "openai_compat"
    && Boolean(env.OPENAI_COMPAT_BASE_URL?.trim() && env.OPENAI_COMPAT_API_KEY?.trim());
}

/** The relay's lifetime usage for this key, in cents (`total_usage`). */
async function readRelayCounterCents(env: Env): Promise<number> {
  const url = compatChatUrl(env.OPENAI_COMPAT_BASE_URL!).replace(/\/chat\/completions$/, "/dashboard/billing/usage");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.OPENAI_COMPAT_API_KEY!.trim()}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`relay usage answered ${response.status}`);
  const total = ((await response.json()) as { total_usage?: unknown }).total_usage;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) throw new Error("relay usage has no total_usage");
  return total;
}

const store: CreditStore = {
  find: (cycleKey) => prisma.aiCreditCycle.findUnique({ where: { cycleKey } }),
  latest: () => prisma.aiCreditCycle.findFirst({ orderBy: { startedAt: "desc" } }),
  save: async (row: CycleRow) => {
    await prisma.aiCreditCycle.upsert({ where: { cycleKey: row.cycleKey }, create: row, update: row });
  },
};

function alert(percent: number, spentUsd: number, budgetUsd: number): void {
  const message = `AI credits at ${percent}%: $${spentUsd.toFixed(2)} of $${budgetUsd} this cycle`;
  console.error(`[ai-credits] ${message}`);
  Sentry.captureMessage(message, { level: percent >= 95 ? "error" : "warning", tags: { area: "ai-credits" } });
}

/** Reads the relay counter once a minute while the relay is the configured provider. */
export function startAiCreditsWorker(env: Env = process.env): () => void {
  if (!relayConfigured(env)) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollAiCredits({ store, readCounterCents: () => readRelayCounterCents(env), circuit: compatCircuit, alert, env });
    } catch (error) {
      logWorkerFailure("ai_credits_poll", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, POLL_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

export async function fetchAiCreditsSnapshot(nowMs: number = Date.now(), env: Env = process.env): Promise<AiCreditsSnapshot> {
  const [current, recent] = await Promise.all([
    store.find(creditCycle(nowMs, env).key),
    prisma.aiCreditCycle.findMany({ orderBy: { startedAt: "desc" }, take: HISTORY_CYCLES }),
  ]);
  const endpoint = resolveLlmEndpoint(env);
  return buildSnapshot({
    nowMs, env, configured: relayConfigured(env), current, recent,
    servingProvider: endpoint.provider, fallbackReason: endpoint.fallbackReason,
  });
}
