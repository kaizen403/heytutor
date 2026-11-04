import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSnapshot, counterStep, creditCycle, monthlyBudgetUsd, pollAiCredits,
  type CreditStore, type CycleRow,
} from "../../lib/admin/aiCreditsCore";
import { CompatCircuit, resolveLlmEndpoint } from "../../lib/llm/llmProvider";

// The $1,000 monthly AI credits budget: cycles turn over on the 4th at midnight
// India time, spend comes from the relay's own counter, and running out moves new
// requests to Fireworks without ever blocking a lesson.
const root = resolve(import.meta.dirname, "../..");
const IST = (text: string) => Date.parse(`${text}+05:30`);
const env = { AI_CREDITS_MONTHLY_USD: "1000", AI_CREDITS_CYCLE_ANCHOR: "2026-11-04" };

function memoryStore(): CreditStore & { rows: Map<string, CycleRow> } {
  const rows = new Map<string, CycleRow>();
  return {
    rows,
    find: async (key) => rows.get(key) ?? null,
    latest: async () => [...rows.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null,
    save: async (row) => { rows.set(row.cycleKey, row); },
  };
}

function harness(counter: { cents: number | Error }, now: { ms: number }) {
  const store = memoryStore();
  const circuit = new CompatCircuit();
  const alerts: number[] = [];
  const state = { pendingReset: false };
  const poll = () => pollAiCredits({
    store, circuit, env, state, now: () => now.ms,
    readCounterCents: async () => { if (counter.cents instanceof Error) throw counter.cents; return counter.cents; },
    alert: (percent) => alerts.push(percent),
  });
  return { store, circuit, alerts, poll };
}

const checks: [string, () => void | Promise<void>][] = [
  ["cycles start on the 4th at midnight India time", () => {
    assert.equal(creditCycle(IST("2026-11-04T00:00:00"), env).key, "2026-11-04");
    assert.equal(creditCycle(IST("2026-12-03T23:59:59"), env).key, "2026-11-04");
    assert.equal(creditCycle(IST("2026-12-04T00:00:00"), env).key, "2026-12-04");
    assert.equal(creditCycle(IST("2027-01-01T12:00:00"), env).key, "2026-12-04", "across a new year");
    assert.equal(creditCycle(IST("2026-11-01T12:00:00"), env).key, "2026-11-04", "before the first anchor is the first cycle");
    const cycle = creditCycle(IST("2026-11-20T12:00:00"), env);
    assert.equal(cycle.startMs, IST("2026-11-04T00:00:00"));
    assert.equal(cycle.endMs, IST("2026-12-04T00:00:00"));
    // An anchor on the 31st clamps to short months and still covers every moment.
    const late = { AI_CREDITS_CYCLE_ANCHOR: "2026-10-31" };
    assert.equal(creditCycle(IST("2027-02-28T00:00:00"), late).key, "2027-02-28");
    assert.equal(creditCycle(IST("2027-02-27T23:00:00"), late).key, "2027-01-31");
    assert.equal(creditCycle(IST("2027-02-27T23:00:00"), late).endMs, IST("2027-02-28T00:00:00"));
  }],
  ["the budget defaults to $1,000 and ignores a bad setting", () => {
    assert.equal(monthlyBudgetUsd({}), 1000);
    assert.equal(monthlyBudgetUsd({ AI_CREDITS_MONTHLY_USD: "250" }), 250);
    assert.equal(monthlyBudgetUsd({ AI_CREDITS_MONTHLY_USD: "lots" }), 1000);
    assert.equal(monthlyBudgetUsd({ AI_CREDITS_MONTHLY_USD: "-5" }), 1000);
  }],
  ["a dip or a bad reading adds nothing; only two low readings in a row are a reset", () => {
    assert.deepEqual(counterStep(100, 150, false), { addCents: 50, baseCents: 150, pendingReset: false });
    assert.deepEqual(counterStep(100, 100, false), { addCents: 0, baseCents: 100, pendingReset: false });
    assert.deepEqual(counterStep(34000.5, 34000.4, false), { addCents: 0, baseCents: 34000.5, pendingReset: false });
    assert.deepEqual(counterStep(5000, 40, false), { addCents: 0, baseCents: 5000, pendingReset: true });
    assert.deepEqual(counterStep(5000, 60, true), { addCents: 60, baseCents: 60, pendingReset: false });
    assert.deepEqual(counterStep(5000, 5010, true), { addCents: 10, baseCents: 5010, pendingReset: false }, "a recovery drops the pending reset");
  }],
  ["spend survives dips, blips and a real refill reset", async () => {
    const run = async (readings: number[]) => {
      const counter = { cents: 0 }, now = { ms: IST("2026-11-20T10:00:00") };
      const { store, poll, circuit } = harness(counter, now);
      for (const cents of readings) { counter.cents = cents; await poll(); }
      return { spent: store.rows.get("2026-11-04")!.spentCents, circuit };
    };
    assert.equal((await run([30000, 34000.5, 34000.4, 34010])).spent, 34010, "a tiny dip costs nothing");
    const blip = await run([30000, 34000, 0, 34020]);
    assert.equal(blip.spent, 34020, "a zero blip that recovers costs nothing");
    assert.equal(blip.circuit.openReason(), null, "and lessons stay on the relay");
    assert.equal((await run([90000, 25, 40])).spent, 90040, "a real reset counts once it is confirmed");
    assert.equal((await run([90000, 25, 40, 90])).spent, 90090);
  }],
  ["the first cycle counts the whole counter, then only what is new", async () => {
    const counter = { cents: 397.5 }, now = { ms: IST("2026-11-04T18:00:00") };
    const { store, poll } = harness(counter, now);
    await poll();
    assert.equal(store.rows.get("2026-11-04")!.spentCents, 397.5, "test spend came out of the same $1,000");
    counter.cents = 500;
    await poll();
    assert.equal(store.rows.get("2026-11-04")!.spentCents, 500);
    await poll();
    assert.equal(store.rows.get("2026-11-04")!.spentCents, 500, "an unchanged counter adds nothing");
  }],
  ["a new cycle starts near zero, whether or not the refill reset the counter", async () => {
    for (const refillCounter of [90_500, 25]) {
      const counter = { cents: 90_000 }, now = { ms: IST("2026-12-03T23:00:00") };
      const { store, poll, alerts } = harness(counter, now);
      await poll();
      assert.deepEqual(alerts, [50, 80]);
      counter.cents = refillCounter;
      now.ms = IST("2026-12-04T00:01:00");
      await poll();
      if (refillCounter === 25) { counter.cents = 30; now.ms += 60_000; await poll(); }
      const fresh = store.rows.get("2026-12-04")!;
      assert.equal(fresh.spentCents, refillCounter === 25 ? 30 : 500, `counter ${refillCounter}`);
      assert.equal(fresh.alertedPercent, 0, "alerts start again each cycle");
      assert.equal(store.rows.get("2026-11-04")!.spentCents, 90_000, "last cycle's figure is kept");
    }
  }],
  ["each alert fires once per cycle", async () => {
    const counter = { cents: 0 }, now = { ms: IST("2026-11-10T10:00:00") };
    const { poll, alerts } = harness(counter, now);
    for (const cents of [49_999, 50_000, 60_000, 80_000, 95_000, 95_400, 99_500, 99_600, 100_000]) { counter.cents = cents; await poll(); }
    assert.deepEqual(alerts, [50, 80, 95, 100], "the move to Fireworks raises its own alert");
    const jump = harness({ cents: 96_000 }, now);
    await jump.poll();
    assert.deepEqual(jump.alerts, [50, 80, 95], "a jump past several still names each");
  }],
  ["$5 before the budget new requests move to Fireworks, and a new cycle moves them back", async () => {
    const counter = { cents: 99_499 }, now = { ms: IST("2026-11-20T10:00:00") };
    const { circuit, poll } = harness(counter, now);
    const relayEnv = { LLM_PROVIDER: "openai_compat", OPENAI_COMPAT_BASE_URL: "https://relay.test/v1", OPENAI_COMPAT_API_KEY: "k", OPENAI_COMPAT_MODEL: "gpt-6-sol", FIREWORKS_API_KEY: "fw" };
    await poll();
    assert.equal(resolveLlmEndpoint(relayEnv, circuit).provider, "openai_compat");
    counter.cents = 99_500;
    await poll();
    const moved = resolveLlmEndpoint(relayEnv, circuit);
    assert.equal(moved.provider, "fireworks");
    assert.match(moved.fallbackReason ?? "", /AI credits used: \$995.00 of \$1000 in the cycle ending 2026-12-03/);
    now.ms = IST("2026-12-04T00:00:30");
    await poll();
    assert.equal(resolveLlmEndpoint(relayEnv, circuit).provider, "openai_compat");
  }],
  ["an unreadable counter never blocks lessons and keeps the saved decision", async () => {
    const counter: { cents: number | Error } = { cents: 100_000 }, now = { ms: IST("2026-11-20T10:00:00") };
    const { store, circuit, poll } = harness(counter, now);
    await poll();
    assert.notEqual(circuit.openReason(), null);
    circuit.setBudgetExhausted(null); // a restart forgets the flag
    counter.cents = new Error("relay down");
    await assert.rejects(poll(), /relay down/);
    assert.notEqual(circuit.openReason(), null, "the saved spend still decides after a restart");
    assert.equal(store.rows.get("2026-11-04")!.spentCents, 100_000, "no reading changes nothing");
    const fresh = harness({ cents: new Error("relay down") }, now);
    await assert.rejects(fresh.poll(), /relay down/);
    assert.equal(fresh.circuit.openReason(), null, "no saved spend, no block");
  }],
  ["alerts wait for the save, and the budget still applies if the save fails", async () => {
    const counter = { cents: 99_600 }, now = { ms: IST("2026-11-20T10:00:00") };
    const circuit = new CompatCircuit();
    const alerts: number[] = [];
    const store = memoryStore();
    const failing: CreditStore = { ...store, save: async () => { throw new Error("db down"); } };
    await assert.rejects(pollAiCredits({ store: failing, circuit, env, state: { pendingReset: false }, now: () => now.ms, readCounterCents: async () => counter.cents, alert: (p) => alerts.push(p) }), /db down/);
    assert.deepEqual(alerts, [], "an unsaved alert would repeat every minute");
    assert.notEqual(circuit.openReason(), null, "the budget decision does not depend on the save");
  }],
  ["after a restart the saved figure decides before the relay is read", async () => {
    const now = { ms: IST("2026-11-20T10:00:00") };
    const store = memoryStore();
    store.rows.set("2026-11-04", { cycleKey: "2026-11-04", startedAt: new Date(IST("2026-11-04T00:00:00")), spentCents: 99_800, lastCounterCents: 99_800, alertedPercent: 100, polledAt: new Date(now.ms) });
    const circuit = new CompatCircuit();
    let openWhileReading: string | null = null;
    await pollAiCredits({ store, circuit, env, state: { pendingReset: false }, now: () => now.ms, readCounterCents: async () => { openWhileReading = circuit.openReason(); return 99_800; }, alert: () => undefined });
    assert.notEqual(openWhileReading, null);
  }],
  ["the snapshot states pace, run out date, staleness and past cycles", () => {
    const nowMs = IST("2026-11-14T00:00:00");
    const row = (cycleKey: string, cents: number, polledAt: number): CycleRow => ({ cycleKey, startedAt: new Date(IST(`${cycleKey}T00:00:00`)), spentCents: cents, lastCounterCents: cents, alertedPercent: 0, polledAt: new Date(polledAt) });
    const base = { nowMs, env, configured: true, servingProvider: "openai_compat", fallbackReason: null };
    const slow = buildSnapshot({ ...base, current: row("2026-11-04", 10_000, nowMs - 60_000), recent: [row("2026-11-04", 10_000, nowMs), row("2026-10-04", 7_000, nowMs)] });
    assert.equal(slow.spentUsd, 100);
    assert.equal(slow.remainingUsd, 900);
    assert.equal(slow.percent, 10);
    assert.equal(slow.dailyBurnUsd, 10);
    assert.equal(slow.projectedRunOutAt, null, "$10 a day lasts past the reset");
    assert.equal(slow.stale, false);
    assert.equal(slow.resetsAt, new Date(IST("2026-12-04T00:00:00")).toISOString());
    assert.deepEqual(slow.history, [{ cycleKey: "2026-10-04", spentUsd: 70 }]);
    const fast = buildSnapshot({ ...base, current: row("2026-11-04", 80_000, nowMs - 6 * 60_000), recent: [] });
    assert.equal(fast.dailyBurnUsd, 80);
    assert.equal(fast.projectedRunOutAt, new Date(nowMs + 2.5 * 86_400_000).toISOString());
    assert.equal(fast.stale, true);
    const over = buildSnapshot({ ...base, current: row("2026-11-04", 120_000, nowMs), recent: [] });
    assert.equal(over.exhausted, true);
    assert.equal(over.remainingUsd, 0);
    assert.equal(over.percent, 100);
    const empty = buildSnapshot({ ...base, current: null, recent: [] });
    assert.equal(empty.spentUsd, 0);
    assert.equal(empty.stale, true);
    assert.equal(empty.lastPolledAt, null);
  }],
  ["the worker starts with the server and the overview carries the snapshot", () => {
    const read = (file: string) => readFileSync(resolve(root, file), "utf8");
    assert.match(read("server.ts"), /\n\s+startAiCreditsWorker\(\);/);
    assert.match(read("lib/admin/overviewQueries.ts"), /await fetchAiCreditsSnapshot\(now\)/);
    assert.match(read("features/admin/analytics/OverviewView.tsx"), /<OverviewAiCredits credits=\{data\.aiCredits\} \/>/);
  }],
];

async function main() {
  let failed = 0;
  for (const [name, run] of checks) {
    try { await run(); console.log(`ok ${name}`); }
    catch (error) { failed += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (failed > 0) { console.error(`${failed}/${checks.length} AI credits checks failed`); process.exit(1); }
  console.log("AI credits verification passed");
}
void main();
