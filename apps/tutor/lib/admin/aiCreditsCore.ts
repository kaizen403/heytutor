/**
 * The monthly AI credits budget, measured from the relay's own usage counter.
 * The counter is the only figure that sees every call on the key: failed
 * attempts, aborted streams, staff, the lab and local runs that the per user
 * ledger leaves out. No database or network here, so the gate can run it.
 */
import type { CompatCircuit } from "../llm/llmProvider";

type Env = Record<string, string | undefined>;

export const DEFAULT_MONTHLY_USD = 1000;
export const DEFAULT_CYCLE_ANCHOR = "2026-11-04";
export const ALERT_PERCENTS = [50, 80, 95] as const;
/** A reading older than this is shown as stale. */
export const STALE_AFTER_MS = 5 * 60_000;

/** Cycles turn over at midnight India time, where the owner reads the panel. */
const CYCLE_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

export function monthlyBudgetUsd(env: Env = process.env): number {
  const value = Number(env.AI_CREDITS_MONTHLY_USD);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MONTHLY_USD;
}

function anchorDate(env: Env): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(env.AI_CREDITS_CYCLE_ANCHOR?.trim() || DEFAULT_CYCLE_ANCHOR)
    ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(DEFAULT_CYCLE_ANCHOR)!;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

/** Midnight India time on the anchor day of a month, the day clamped to short months. */
function cycleStartMs(year: number, month: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(day, lastDay)) - CYCLE_OFFSET_MS;
}

export interface CreditCycle {
  key: string;
  startMs: number;
  endMs: number;
}

/** The cycle holding `nowMs`. Before the first anchor, the first cycle. */
export function creditCycle(nowMs: number, env: Env = process.env): CreditCycle {
  const anchor = anchorDate(env);
  const local = new Date(nowMs + CYCLE_OFFSET_MS);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth();
  if (nowMs < cycleStartMs(year, month, anchor.day)) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }
  const firstMs = cycleStartMs(anchor.year, anchor.month, anchor.day);
  if (cycleStartMs(year, month, anchor.day) < firstMs) { year = anchor.year; month = anchor.month; }
  const startMs = cycleStartMs(year, month, anchor.day);
  const next = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
  const key = new Date(startMs + CYCLE_OFFSET_MS).toISOString().slice(0, 10);
  return { key, startMs, endMs: cycleStartMs(next.year, next.month, anchor.day) };
}

/**
 * Cents newly used between two counter readings. A counter that fell was reset
 * by a refill, so everything it now shows is new.
 */
export function counterDelta(lastCents: number, currentCents: number): number {
  return currentCents >= lastCents ? currentCents - lastCents : currentCents;
}

export interface CycleRow {
  cycleKey: string;
  startedAt: Date;
  spentCents: number;
  lastCounterCents: number;
  alertedPercent: number;
  polledAt: Date;
}

export interface CreditStore {
  find(cycleKey: string): Promise<CycleRow | null>;
  /** The most recent cycle, for carrying the counter into a new one. */
  latest(): Promise<CycleRow | null>;
  save(row: CycleRow): Promise<void>;
}

export interface PollDeps {
  store: CreditStore;
  /** The relay's lifetime usage in cents; throws when it cannot be read. */
  readCounterCents: () => Promise<number>;
  circuit: Pick<CompatCircuit, "setBudgetExhausted">;
  alert: (percent: number, spentUsd: number, budgetUsd: number) => void;
  now?: () => number;
  env?: Env;
}

function resetLabel(endMs: number): string {
  return new Date(endMs + CYCLE_OFFSET_MS - 1).toISOString().slice(0, 10);
}

function applyBudget(deps: PollDeps, spentCents: number, cycle: CreditCycle, budgetUsd: number): void {
  const spentUsd = spentCents / 100;
  deps.circuit.setBudgetExhausted(spentUsd >= budgetUsd
    ? `AI credits used: $${spentUsd.toFixed(2)} of $${budgetUsd} in the cycle ending ${resetLabel(cycle.endMs)}; using Fireworks until it resets`
    : null);
}

/**
 * One reading. The first ever cycle counts the key's whole counter, because
 * that spend came out of the same $1,000. If the counter cannot be read, the
 * saved figure still decides the budget and lessons are never blocked.
 */
export async function pollAiCredits(deps: PollDeps): Promise<CycleRow | null> {
  const nowMs = deps.now?.() ?? Date.now();
  const env = deps.env ?? process.env;
  const cycle = creditCycle(nowMs, env);
  const budgetUsd = monthlyBudgetUsd(env);
  const saved = await deps.store.find(cycle.key);
  let counter: number;
  try {
    counter = await deps.readCounterCents();
  } catch (error) {
    applyBudget(deps, saved?.spentCents ?? 0, cycle, budgetUsd);
    throw error;
  }
  const previous = saved ?? await deps.store.latest();
  const delta = counterDelta(previous?.lastCounterCents ?? 0, counter);
  const spentCents = (saved?.spentCents ?? 0) + delta;
  const percent = spentCents / 100 / budgetUsd * 100;
  let alertedPercent = saved?.alertedPercent ?? 0;
  for (const threshold of ALERT_PERCENTS) {
    if (percent >= threshold && alertedPercent < threshold) {
      alertedPercent = threshold;
      deps.alert(threshold, spentCents / 100, budgetUsd);
    }
  }
  const row: CycleRow = {
    cycleKey: cycle.key,
    startedAt: saved?.startedAt ?? new Date(cycle.startMs),
    spentCents,
    lastCounterCents: counter,
    alertedPercent,
    polledAt: new Date(nowMs),
  };
  await deps.store.save(row);
  applyBudget(deps, spentCents, cycle, budgetUsd);
  return row;
}

export interface AiCreditsSnapshot {
  configured: boolean;
  model: string | null;
  servingProvider: string;
  fallbackReason: string | null;
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  percent: number;
  cycleKey: string;
  resetsAt: string;
  dailyBurnUsd: number;
  /** When the budget runs out at this pace; null if the cycle ends first. */
  projectedRunOutAt: string | null;
  lastPolledAt: string | null;
  stale: boolean;
  exhausted: boolean;
  history: { cycleKey: string; spentUsd: number }[];
}

export function buildSnapshot(input: {
  nowMs: number;
  env: Env;
  configured: boolean;
  servingProvider: string;
  fallbackReason: string | null;
  current: CycleRow | null;
  recent: CycleRow[];
}): AiCreditsSnapshot {
  const { nowMs, env, current } = input;
  const cycle = creditCycle(nowMs, env);
  const budgetUsd = monthlyBudgetUsd(env);
  const spentUsd = (current?.spentCents ?? 0) / 100;
  const dailyBurnUsd = spentUsd / Math.max(1, (nowMs - cycle.startMs) / DAY_MS);
  const remainingUsd = Math.max(0, budgetUsd - spentUsd);
  const runOutMs = dailyBurnUsd > 0 ? nowMs + remainingUsd / dailyBurnUsd * DAY_MS : null;
  return {
    configured: input.configured,
    model: env.OPENAI_COMPAT_MODEL?.trim() || null,
    servingProvider: input.servingProvider,
    fallbackReason: input.fallbackReason,
    budgetUsd,
    spentUsd,
    remainingUsd,
    percent: Math.min(100, spentUsd / budgetUsd * 100),
    cycleKey: cycle.key,
    resetsAt: new Date(cycle.endMs).toISOString(),
    dailyBurnUsd,
    projectedRunOutAt: runOutMs !== null && runOutMs < cycle.endMs ? new Date(runOutMs).toISOString() : null,
    lastPolledAt: current?.polledAt.toISOString() ?? null,
    stale: !current || nowMs - current.polledAt.getTime() > STALE_AFTER_MS,
    exhausted: spentUsd >= budgetUsd,
    history: input.recent.filter((row) => row.cycleKey !== cycle.key).map((row) => ({ cycleKey: row.cycleKey, spentUsd: row.spentCents / 100 })),
  };
}
