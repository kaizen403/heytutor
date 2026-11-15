import assert from "node:assert/strict";
import * as React from "react";
import { useLectureCosts, type LectureCostSession } from "../../features/admin/hooks/useLectureCosts";
import { aggregateRunCost, emptyRunCostSession, snapshotPricing } from "../../lib/obs/runCost";

type Slot = { value: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const slots: Slot[] = [];
let cursor = 0;
const effects: Array<() => void> = [];
const internals = (React as typeof React & {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const originalDispatcher = internals.H;
const depsChanged = (old?: readonly unknown[], next?: readonly unknown[]) =>
  !old || !next || old.length !== next.length || old.some((value, i) => !Object.is(value, next[i]));
const dispatcher = {
  useState<T>(initial: T | (() => T)) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: typeof initial === "function" ? (initial as () => T)() : initial };
    return [slots[index]!.value as T, (next: T | ((previous: T) => T)) => {
      const previous = slots[index]!.value as T;
      slots[index]!.value = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
    }] as const;
  },
  useRef<T>(initial: T) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: { current: initial } };
    return slots[index]!.value as { current: T };
  },
  useMemo<T>(make: () => T, deps?: readonly unknown[]) {
    const index = cursor++;
    if (!slots[index] || depsChanged(slots[index]!.deps, deps)) slots[index] = { value: make(), deps };
    return slots[index]!.value as T;
  },
  useCallback<T>(callback: T, deps?: readonly unknown[]) { return this.useMemo(() => callback, deps); },
  useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) { this.useEffect(effect, deps); },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const index = cursor++;
    if (slots[index] && !depsChanged(slots[index]!.deps, deps)) return;
    effects.push(() => {
      slots[index]?.cleanup?.();
      slots[index] = { value: null, deps, cleanup: effect() || undefined };
    });
  },
};
let sessions: LectureCostSession[] = [];
function RenderQueue() { return useLectureCosts(sessions); }
function render() {
  cursor = 0;
  internals.H = dispatcher;
  try { return RenderQueue(); }
  finally { internals.H = originalDispatcher; effects.splice(0).forEach((effect) => effect()); }
}

const timers = new Set<() => void>();
const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;
const originalNow = Date.now;
let now = 1_000;
Date.now = () => now;
(globalThis as { window: unknown }).window = {
  setInterval: (callback: () => void) => { timers.add(callback); return callback; },
  clearInterval: (callback: () => void) => timers.delete(callback),
};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function reset() {
  for (const slot of slots) slot.cleanup?.();
  slots.length = 0;
  timers.clear();
  now = 1_000;
}
const cost = { ...emptyRunCostSession("board"), observations: 2, inputTokens: 100, characters: 1_000, llmUsd: 0.02, ttsUsd: 0.05, totalUsd: 0.07 };
function payload(rows = [cost], options = {}) {
  return Response.json({ configured: true, report: { ...aggregateRunCost([]), bySession: rows }, pricing: snapshotPricing(), fetchedAt: "fixture", ...options });
}
async function main() {
  try {
    const requests: string[][] = [];
    sessions = Array.from({ length: 41 }, (_, i) => ({ sessionId: `board-${i}`, hot: false }));
    globalThis.fetch = async (_input, init) => {
      const ids = JSON.parse(String(init?.body)).sessionIds as string[];
      requests.push(ids);
      return requests.length === 1 ? new Response(null, { status: 503 }) : payload([{ ...cost, sessionId: ids[0]! }]);
    };
    render(); await flush(); render();
    assert.equal(requests.length, 2, "a failed batch cannot starve the remaining lectures");

    reset();
    sessions = [{ sessionId: "board", hot: false }];
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
      ? payload([{ ...cost, characters: 0, ttsUsd: 0, totalUsd: cost.llmUsd }]) : payload();
    render(); await flush(); render();
    now += 8_000;
    timers.forEach(callback => callback()); await flush();
    const settled = render();
    assert.equal(calls, 2, "historical AI-only costs must keep polling for late voice usage");
    assert.equal(settled.costsByBoardId.board?.ttsUsd, 0.05);

    reset();
    sessions = [{ sessionId: "old", hot: false }];
    let finishOld!: (response: Response) => void;
    const called: string[] = [];
    globalThis.fetch = async (_input, init) => {
      const id = JSON.parse(String(init?.body)).sessionIds[0] as string;
      called.push(id);
      return id === "old" ? new Promise(resolve => { finishOld = resolve; }) : payload([{ ...cost, sessionId: id }]);
    };
    render();
    sessions = [{ sessionId: "new", hot: false }];
    render(); await flush();
    assert.deepEqual(called, ["old", "new"], "switching chapters fetches immediately despite an aborted old request");
    finishOld(payload([{ ...cost, sessionId: "old" }])); await flush();
    assert.equal(render().costsByBoardId.old, undefined, "aborted responses cannot overwrite the current costs");

    reset();
    sessions = [{ sessionId: "board", hot: false }];
    globalThis.fetch = async () => payload([], { configured: false });
    render(); await flush();
    assert.equal(render().costStatesByBoardId.board, "unconfigured");
    reset();
    sessions = [{ sessionId: "board", hot: false }, { sessionId: "unavailable", hot: false }];
    globalThis.fetch = async () => payload([cost], { error: "langfuse_unavailable" });
    render(); await flush();
    const partial = render();
    assert.equal(partial.costsByBoardId.board?.totalUsd, cost.totalUsd, "healthy results survive partial vendor errors");
    assert.equal(partial.costStatesByBoardId.unavailable, "unavailable");
    console.log("verify-lecture-cost-loading: batch isolation, late voice, chapter switches, unavailable states passed");
  } finally {
    reset();
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
    Date.now = originalNow;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
