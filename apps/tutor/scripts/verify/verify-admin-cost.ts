import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminTurnRow } from "../../lib/admin/types";
import { TurnsTable } from "../../features/admin/turns/TurnsTable";
import { millicentsToUsd, usdToMillicents } from "../../lib/billing/catalog";
import { previousPeriodKey, recentPeriodKeys } from "../../lib/admin/costPeriods";
import { formatMillicentsUsd } from "../../features/admin/shared/lib/format";
import { createStaleCache } from "../../lib/admin/staleCache";
import { windowObservationsPath } from "../../lib/obs/langfuseQuery";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(usdToMillicents(3.5) === 3500, "$3.50 is 3500 millicents");
assert(millicentsToUsd(3500) === 3.5, "3500 millicents is $3.50");
assert(formatMillicentsUsd(3500) === "$3.50", "admin money must use thousandths of a dollar");
assert(formatMillicentsUsd(12) === "$0.012", "sub-cent spend still prints");
assert(formatMillicentsUsd(0) === "$0", "zero spend");

assert(previousPeriodKey(Date.parse("2026-09-19T12:00:00.000Z")) === "2026-08", "previous UTC month");
assert(
  recentPeriodKeys(3, Date.parse("2026-09-19T12:00:00.000Z")).join(",") === "2026-07,2026-08,2026-09",
  "recent periods are oldest-first and include the current month",
);

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

assert(read("lib/admin/types.ts").includes("inference7d"), "overview payload carries Langfuse 7d inference");
assert(read("lib/admin/costQueries.ts").includes("billingPeriodSpend"), "dashboard cost reads the monthly ledger");
assert(read("lib/obs/langfuseQuery.ts").includes("fetchRunCostForWindow"), "7d AI/voice comes from Langfuse observations");
assert(read("lib/obs/langfuseQuery.ts").includes("fetchRunCostForTraces"), "turn rows price their Langfuse traces");
assert(read("features/admin/analytics/OverviewCost.tsx").includes("AI vs voice"), "overview splits AI and voice");
assert(read("features/admin/users/UsersView.tsx").includes('value: "spend"'), "users can sort by spend");
assert(read("features/admin/users/UserDetailView.tsx").includes("AI / voice"), "user detail shows inference split");
assert(read("lib/admin/userDetailQueries.ts").includes("fetchUserBoardCosts"), "user detail prices every listed board");
assert(read("features/admin/users/UserBoards.tsx").includes("CostChip"), "each user board shows its lecture cost");
assert(read("lib/admin/turnsQueries.ts").includes("fetchRunCostForTraces"), "the turn log attaches per-turn cost");
assert(read("lib/admin/costPeriods.ts").includes("billingPeriodKey"), "month keys stay on the UTC ledger calendar");

const windowPath = windowObservationsPath(new Date("2026-11-04T00:00:00.000Z"), new Date("2026-11-11T00:00:00.000Z"), "next");
assert(windowPath.startsWith("/api/public/v2/observations?"), "the 7d window reads v2 observations, not the rate-limited legacy list");
assert(!windowPath.includes("page=") && windowPath.includes("cursor=next"), "the 7d window pages by cursor");
assert(!read("lib/obs/langfuseQuery.ts").includes("`/api/public/observations?"), "no admin read uses the legacy observations list");
assert(read("lib/admin/costQueries.ts").includes("createStaleCache"), "the overview's 7d window is cached between polls");

async function verifyStaleCache(): Promise<void> {
  type Value = { ok: boolean; n: number };
  let loads = 0;
  const loadCount = (): number => loads;
  let next: Value = { ok: true, n: 1 };
  const cache = createStaleCache<Value>({
    load: async () => {
      loads += 1;
      return next;
    },
    isFailure: (value) => !value.ok,
    freshMs: 1_000,
    staleMs: 10_000,
  });
  const [a, b] = await Promise.all([cache.read(0), cache.read(0)]);
  assert(loadCount() === 1 && a.n === 1 && b.n === 1, "concurrent polls share one Langfuse load");
  assert((await cache.read(500)).n === 1 && loadCount() === 1, "a fresh value is reused without a load");
  next = { ok: false, n: 2 };
  const stale = await cache.read(2_000);
  assert(loadCount() === 2 && stale.n === 1, "a rate-limited load keeps the last good total");
  assert((await cache.read(20_000)).n === 2, "past the stale limit the failure is shown");
  next = { ok: true, n: 3 };
  assert((await cache.read(21_000)).n === 3, "a later good load replaces the failure");
}

Object.defineProperty(globalThis, "React", { value: React, configurable: true });
const turn: AdminTurnRow = {
  turnId: "turn-one", question: "Explain gravity", outcome: "validated", tier: "exact_verified",
  degradationReason: null, issueCodes: [], candidateCount: null, sceneEngineVersion: "test",
  traceId: "trace-one", traceUrl: null, sentryEventId: null, sentryUrl: null,
  userId: "user-one", userLabel: "Student", boardId: "board-one", boardTitle: "Physics",
  createdAt: "2026-11-10T00:00:00.000Z", llmUsd: null, ttsUsd: null, totalUsd: null,
  ratings: [],
};
const renderTurn = (overrides: Partial<AdminTurnRow>) =>
  renderToStaticMarkup(React.createElement(TurnsTable, { turns: [{ ...turn, ...overrides }] }));
assert(renderTurn({}).includes("Unavailable"), "missing log costs must have a visible state");
assert(renderTurn({ llmUsd: 0, ttsUsd: 0, totalUsd: 0 }).includes("$0"), "a known zero cost must remain visible");
const priced = renderTurn({ llmUsd: 0.0012, ttsUsd: 0.05, totalUsd: 0.0512 });
assert(priced.includes("$0.051") && priced.includes("$0.0012"), "log costs keep sub-cent precision");
assert(priced.includes("AI") && priced.includes("Voice"), "the log renders the AI and voice split");
assert(!priced.includes('role="tooltip"'), "log cost details must not be clipped inside the scrolling table");
assert(!renderTurn({}).includes("During") && !renderTurn({}).includes("After"), "an unrated lecture adds no rating line");
const rated = renderTurn({
  ratings: [
    { moment: "during", stars: 4, feedback: null },
    { moment: "after", stars: 2, feedback: "the figure was wrong" },
  ],
});
assert(rated.includes("During 4/5") && rated.includes("After 2/5"), "the log shows both rating moments");
assert(rated.includes("the figure was wrong"), "the log shows the student's note");
assert(rated.includes("text-danger"), "a 1 or 2 star rating is marked on the log");

verifyStaleCache().then(() => {
  console.log("✓ admin cost analytics: ledger months, millicents, panel surfaces, cached 7d window");
}, (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
