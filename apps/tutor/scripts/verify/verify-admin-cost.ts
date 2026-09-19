import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { millicentsToUsd, usdToMillicents } from "../../lib/billing/catalog";
import { previousPeriodKey, recentPeriodKeys } from "../../lib/admin/costPeriods";
import { formatMillicentsUsd } from "../../features/admin/shared/lib/format";

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
assert(read("lib/admin/userDetailQueries.ts").includes("fetchUserInferenceCost"), "user detail loads board Langfuse cost");
assert(read("lib/admin/turnsQueries.ts").includes("fetchRunCostForTraces"), "the turn log attaches per-turn cost");
assert(read("lib/admin/costPeriods.ts").includes("billingPeriodKey"), "month keys stay on the UTC ledger calendar");

console.log("✓ admin cost analytics: ledger months, millicents, and panel surfaces");
