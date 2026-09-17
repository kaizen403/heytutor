import {
  PLAN_CATALOG,
  TOP_UP_USD,
  usdToMillicents,
} from "../../lib/billing/catalog";
import {
  balanceFromRow,
  remainingUsagePct,
} from "../../lib/billing/ledgerMath";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(usdToMillicents(3.5) === 3500, "$3.50 is 3500 millicents");
assert(usdToMillicents(12) === 12_000, "$12 is 12000 millicents");
assert(usdToMillicents(10) === 10_000, "$10 top-up is 10000 millicents");
assert(remainingUsagePct(0, 3500) === 100, "unused Free bar is 100%");
assert(remainingUsagePct(3500, 3500) === 0, "spent Free bar is 0%");
assert(remainingUsagePct(875, 3500) === 75, "25% spent is 75% left");
assert(remainingUsagePct(0, 0) === 0, "zero allowance is 0%");

const unusedFree = balanceFromRow({
  planId: PLAN_CATALOG.free.planId,
  spentMillicents: 0,
  bonusMillicents: 0,
});
assert(unusedFree.allowanceMillicents === 3500, "Free allowance is $3.50");
assert(unusedFree.remainingPct === 100, "unused Free remainingPct is 100");
assert(unusedFree.remainingMillicents === 3500, "unused Free remaining millicents");

const spentFree = balanceFromRow({
  planId: "free",
  spentMillicents: 3500,
  bonusMillicents: 0,
});
assert(spentFree.remainingMillicents === 0 && spentFree.remainingPct === 0, "spent Free is empty");

const topped = balanceFromRow({
  planId: "free",
  spentMillicents: 0,
  bonusMillicents: usdToMillicents(TOP_UP_USD),
});
assert(topped.allowanceMillicents === 13_500, "top-up sits above the Free envelope");
assert(topped.remainingPct === 100, "unused combined budget still reads 100%");

const plus = balanceFromRow({
  planId: "plus",
  spentMillicents: 6000,
  bonusMillicents: 0,
});
assert(plus.allowanceMillicents === 12_000, "Plus envelope is $12");
assert(plus.remainingPct === 50, "half spent Plus is 50% left");

const pro = balanceFromRow({
  planId: "pro",
  spentMillicents: 0,
  bonusMillicents: 0,
});
assert(pro.allowanceMillicents === 24_000, "Pro envelope is $24");

console.log("✓ monthly USD ledger math: remainingPct from millicents");
