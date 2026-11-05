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
/** The alert level recorded once the budget has moved lessons to Fireworks. */
export const SWITCHED_ALERT = 100;
/**
 * Move to Fireworks this far below the budget. The relay's own limit equals the
 * budget and it may refuse a request that would cross it, so the counter may
 * never reach the full amount.
 */
export const SWITCH_MARGIN_USD = 5;
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

export function budgetReached(spentUsd: number, budgetUsd: number): boolean {
  return spentUsd >= budgetUsd - SWITCH_MARGIN_USD;
}

export interface CounterStep {
  /** Cents newly used. */
  addCents: number;
  /** The reading later spend is measured from. */
  baseCents: number;
  /** A low reading is waiting for a second one to prove a reset. */
  pendingReset: boolean;
}

/**
 * Cents newly used between two counter readings. The counter is not strictly
 * rising: a small dip or a bad reading must add nothing, or the key's whole
 * lifetime would land in one month. So the base stays at its high water mark, and
 * only two readings in a row below half of it count as a refill's reset.
 */
export function counterStep(baseCents: number, currentCents: number, pendingReset: boolean): CounterStep {
  if (currentCents >= baseCents) return { addCents: currentCents - baseCents, baseCents: currentCents, pendingReset: false };
  if (currentCents >= baseCents / 2) return { addCents: 0, baseCents, pendingReset: false };
  if (!pendingReset) return { addCents: 0, baseCents, pendingReset: true };
  return { addCents: currentCents, baseCents: currentCents, pendingReset: false };
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
  /** Held by the worker between polls; a restart only asks for one more reading. */
  state: { pendingReset: boolean };
  now?: () => number;
  env?: Env;
}

function resetLabel(endMs: number): string {
  return new Date(endMs + CYCLE_OFFSET_MS - 1).toISOString().slice(0, 10);
}

function applyBudget(deps: PollDeps, spentCents: number, cycle: CreditCycle, budgetUsd: number): void {
  const spentUsd = spentCents / 100;
  deps.circuit.setBudgetExhausted(budgetReached(spentUsd, budgetUsd)
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
  // The saved figure decides first, so a restart never sends traffic past the budget.
  applyBudget(deps, saved?.spentCents ?? 0, cycle, budgetUsd);
  const counter = await deps.readCounterCents();
  const previous = saved ?? await deps.store.latest();
  const step = counterStep(previous?.lastCounterCents ?? 0, counter, deps.state.pendingReset);
  deps.state.pendingReset = step.pendingReset;
  const spentCents = (saved?.spentCents ?? 0) + step.addCents;
  const spentUsd = spentCents / 100;
  const percent = spentUsd / budgetUsd * 100;
  const reached = budgetReached(spentUsd, budgetUsd);
  const due = [
    ...ALERT_PERCENTS.filter((threshold) => percent >= threshold && (saved?.alertedPercent ?? 0) < threshold),
    ...(reached && (saved?.alertedPercent ?? 0) < SWITCHED_ALERT ? [SWITCHED_ALERT] : []),
  ];
  applyBudget(deps, spentCents, cycle, budgetUsd);
  const row: CycleRow = {
    cycleKey: cycle.key,
    startedAt: saved?.startedAt ?? new Date(cycle.startMs),
    spentCents,
    lastCounterCents: step.baseCents,
    alertedPercent: due.at(-1) ?? saved?.alertedPercent ?? 0,
    polledAt: new Date(nowMs),
  };
  await deps.store.save(row);
  for (const threshold of due) deps.alert(threshold, spentUsd, budgetUsd);
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
    exhausted: budgetReached(spentUsd, budgetUsd),
    history: input.recent.filter((row) => row.cycleKey !== cycle.key).map((row) => ({ cycleKey: row.cycleKey, spentUsd: row.spentCents / 100 })),
  };
}
