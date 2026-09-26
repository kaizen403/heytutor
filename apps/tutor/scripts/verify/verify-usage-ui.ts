import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OUT_OF_USAGE_TITLE,
  TEEN_CHECKOUT_COPY,
  TOP_UP_CTA,
  UPGRADE_LABEL,
  isOutOfCreditsCode,
  isOutOfUsageLock,
  isTeenAgeBand,
  remainingPctBarWidth,
  remainingPctLabel,
  studentBillingMessage,
} from "../../lib/billing/studentCopy";
import { PLAN_CATALOG, TOP_UP_USD } from "../../lib/billing/catalog";
import { parseBillingFailureFromMessage } from "../../lib/billing/billingClient";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
const landing = (relative: string) =>
  readFileSync(resolve(root, "../landing/src", relative), "utf8");

assert(remainingPctLabel(72) === "72% left", "tooltip is remaining percent");
assert(remainingPctLabel(0) === "0% left", "empty bar still names percent left");
assert(remainingPctLabel(100) === "100% left", "full bar is 100% left");
assert(remainingPctLabel(null, { staff: true }) === "Unlimited", "staff is unlimited");
assert(remainingPctBarWidth(72) === 72, "bar width is remaining percent");
assert(remainingPctBarWidth(0) === 0, "zero remaining empties the bar");
assert(remainingPctBarWidth(null, { staff: true }) === 100, "staff bar stays full");
assert(isTeenAgeBand("13_17"), "13–17 is the teen band");
assert(!isTeenAgeBand("18_plus"), "18+ is not teen copy");
assert(isOutOfCreditsCode("out_of_credits"), "empty envelope is out of usage");
assert(isOutOfCreditsCode("daily_usd_limit"), "legacy daily fuse code still maps to out of usage");
assert(!isOutOfCreditsCode("no_grant"), "a lost grant is not an empty envelope");
assert(!isOutOfCreditsCode("unauthorized"), "401 is not out of usage");
assert(
  isOutOfUsageLock({ code: "out_of_credits", remaining: 80 }),
  "an empty-envelope 402 still locks Ask even if a stale percent is attached",
);
assert(
  !isOutOfUsageLock({ code: "no_grant", remaining: 80 }),
  "Explain this / Ask a doubt must not lock as Out of usage while leftover usage remains",
);
assert(
  isOutOfUsageLock({ code: "no_grant", remaining: 0 }),
  "no_grant with a zero bar still locks",
);
assert(studentBillingMessage("out_of_credits") === OUT_OF_USAGE_TITLE, "402 title");
assert(studentBillingMessage("no_grant") !== OUT_OF_USAGE_TITLE, "lost grant copy is not Out of usage");
assert(studentBillingMessage("no_grant").toLowerCase().includes("start"), "lost grant is retryable");
assert(studentBillingMessage("unauthorized") === "Sign in to continue", "401 is sign-in, not usage");
assert(studentBillingMessage("timeout").toLowerCase().includes("too long"), "begin-turn timeout is not a silent cancel");
assert(studentBillingMessage("rate_limited").toLowerCase().includes("too many"), "429 is rate limit copy");
assert(
  studentBillingMessage("doubt_limit") === OUT_OF_USAGE_TITLE,
  "a retired per-question doubt cap must not claim the student asked enough doubts",
);
assert(studentBillingMessage("autumn_unavailable").toLowerCase().includes("unavailable"), "503 copy");
assert(OUT_OF_USAGE_TITLE === "Out of usage", "402 title is Out of usage");
assert(TEEN_CHECKOUT_COPY.includes("parent or guardian"), "teen checkout copy");
assert(PLAN_CATALOG.free.includedUsdPerMonth === 3.5, "Free $3.50 envelope");
assert(PLAN_CATALOG.plus.priceUsdPerMonth === 19 && PLAN_CATALOG.plus.includedUsdPerMonth === 12, "Plus 19/$12");
assert(PLAN_CATALOG.pro.priceUsdPerMonth === 39 && PLAN_CATALOG.pro.includedUsdPerMonth === 24, "Pro 39/$24");
assert(TOP_UP_USD === 10 && TOP_UP_CTA === "Add usage · $10", "top-up CTA");

const chat402 = parseBillingFailureFromMessage(
  'LLM proxy error (402): {"code":"out_of_credits","remainingPct":0}',
);
assert(chat402?.code === "out_of_credits" && chat402.status === 402 && chat402.remaining === 0, "parse chat 402 JSON remainingPct");
const chat402legacy = parseBillingFailureFromMessage(
  'LLM proxy error (402): {"code":"out_of_credits","remaining":0}',
);
assert(chat402legacy?.code === "out_of_credits" && chat402legacy.remaining === 0, "parse chat 402 JSON remaining");
const lostGrant = parseBillingFailureFromMessage(
  'LLM proxy error (402): {"code":"no_grant","remainingPct":80}',
);
assert(
  lostGrant?.code === "no_grant" && lostGrant.remaining === 80,
  "a lost grant with leftover usage must not be rewritten as out_of_credits",
);
const chat429 = parseBillingFailureFromMessage(
  'LLM proxy error (429): {"code":"rate_limited","remaining":3}',
);
assert(chat429?.code === "rate_limited" && chat429.status === 429, "parse chat 429 JSON");
const chat503 = parseBillingFailureFromMessage("LLM proxy error (503): ");
assert(chat503?.code === "autumn_unavailable" && chat503.status === 503, "bare 503 is autumn");
const chat401 = parseBillingFailureFromMessage("LLM proxy error (401): unauthorized");
assert(chat401 === null, "bare 401 is not treated as out of usage");

const usage = read("features/account/UsageScreen.tsx");
assert(usage.includes("PlanUsageCard"), "usage page shows plan + checkout");
assert(usage.includes("Plans and usage"), "usage page is the Upgrade plan destination");
assert(!usage.includes("What uses a credit"), "usage page drops credit explainer");
assert(!usage.includes("Credits remaining"), "usage page does not show remaining credits");
assert(!usage.includes("Lessons this period"), "usage page drops lesson counts");
assert(!/token count|Fireworks tokens|TTS characters/i.test(usage), "usage page must not show token counts");
assert(!usage.includes("Credits and plans will live here"), "placeholder copy is gone from usage");

const settings = read("features/account/SettingsScreen.tsx");
assert(settings.includes("PlanUsageCard"), "settings plan section uses the shared card");
assert(settings.includes('onOpenUsage={() => router.push("/usage")}'), "settings still opens /usage");
assert(!settings.includes("There are no prices and no checkout"), "settings placeholder copy is gone");

const planCard = read("features/account/PlanUsageCard.tsx");
assert(planCard.includes("startCheckout"), "plan card can checkout Plus/Pro");
assert(planCard.includes("startTopUp"), "plan card can top up");
assert(planCard.includes("openCustomerPortal"), "plan card opens the portal");
assert(planCard.includes("TEEN_CHECKOUT_COPY"), "plan card has 13–17 copy");
assert(planCard.includes("AccountCard"), "plan card stays on account chrome");
assert(planCard.includes("SiteButton"), "plan card uses SiteButton");
assert(planCard.includes("UsageMeter"), "plan card uses remaining-% meter");
assert(planCard.includes("TOP_UP_CTA"), "plan card top-up is Add usage");
assert(!planCard.includes("credits"), "plan card has no credit copy");
assert(!planCard.includes("3.50") && !planCard.includes("3.5"), "student bar does not show $3.50");

const dialog = read("features/account/OutOfCreditsDialog.tsx");
assert(dialog.includes("OUT_OF_USAGE_TITLE"), "402 dialog title is Out of usage");
assert(dialog.includes("UPGRADE_LABEL"), "402 dialog has Upgrade");
assert(dialog.includes('router.push("/usage")'), "Upgrade goes to /usage");
assert(!dialog.includes("401"), "402 dialog is not a generic 401");

const history = read("features/tutor-session/components/BoardHistory.tsx");
assert(history.includes("CreditsFooterButton"), "board footer is a usage bar");
assert(history.includes("remainingPctLabel"), "footer tooltip is remaining percent");
assert(history.includes("bh__credits-track"), "footer has a thin usage track");
assert(history.includes("bh__credits-pct"), "footer shows remaining percent with the bar");
assert(history.includes("bh__credits-row"), "footer pairs Usage with the remaining percent");
assert(!/token/i.test(history.slice(history.indexOf("function CreditsFooterButton"), history.indexOf("function AccountNavLink"))), "footer bar has no token counts");
assert(history.includes(">Usage<"), "footer label is Usage");

const profileMenuStart = history.indexOf('className="bh__profile-menu"');
assert(profileMenuStart > 0, "profile menu markup is gone");
const profileMenuEnd = history.indexOf("className={`bh__profile${profileOpen", profileMenuStart);
assert(profileMenuEnd > profileMenuStart, "profile menu has no closing avatar button");
const profileMenu = history.slice(profileMenuStart, profileMenuEnd);
assert(profileMenu.includes("Upgrade plan"), "avatar menu offers Upgrade plan");
{
  const upgradeAt = profileMenu.indexOf("Upgrade plan");
  const hrefs = [...profileMenu.slice(0, upgradeAt).matchAll(/href="([^"]+)"/g)];
  const upgradeHref = hrefs.at(-1)?.[1] ?? "";
  assert(
    upgradeHref === "/usage" || upgradeHref === "/usage#plans",
    "Upgrade plan opens /usage (Plus/Pro/top-up live there)",
  );
}
assert(!/href="\/progress"/.test(profileMenu) && !/>\s*Progress\s*</.test(profileMenu), "avatar menu dropped Progress");
assert(!/href="\/library"/.test(profileMenu) && !/>\s*Library\s*</.test(profileMenu), "avatar menu dropped Library");
assert(!profileMenu.includes("\n                Usage\n"), "avatar menu does not duplicate Usage next to Upgrade plan");
assert(history.includes("function ProfileAvatar"), "sidebar avatar is a dedicated control");
assert(history.includes('referrerPolicy="no-referrer"'), "Google avatars must not send a Referer");

const handler = read("features/tutor-session/hooks/turn/useQuestionHandler.ts");
assert(handler.includes("studentBillingMessage"), "begin-turn failures use student billing copy");
assert(handler.includes("parseBillingFailureFromUnknown"), "chat 402/429/503 is parsed");
assert(handler.includes("billing:"), "errors carry the billing payload");

const input = read("features/tutor-session/components/InputBar.tsx");
assert(input.includes("OUT_OF_USAGE_TITLE"), "input bar says Out of usage");
assert(input.includes("UPGRADE_LABEL"), "input bar offers Upgrade");
assert(input.includes("isOutOfUsageLock"), "Ask / Explain this lock on leftover usage, not a lost grant");
assert(input.includes("parseBillingFailureFromBody"), "photo OCR 402 is parsed");

const shell = read("features/tutor-session/TutorSessionShell.tsx");
assert(shell.includes("OutOfCreditsDialog"), "session shows the 402 modal");
assert(shell.includes("isOutOfUsageLock"), "402 modal does not treat a lost grant as empty usage");
assert(shell.includes("billingNotice"), "session wires billing into the composer");

const entitlement = read("app/api/billing/entitlement/route.ts");
assert(entitlement.includes("remainingPct"), "entitlement JSON is remainingPct");
assert(!entitlement.includes("remainingLessons"), "entitlement does not return lesson counts");
assert(!entitlement.includes("dailyUsdRemaining"), "entitlement does not return daily USD");

const beginTurn = read("app/api/billing/begin-turn/route.ts");
assert(beginTurn.includes("remainingPct"), "begin-turn JSON is remainingPct");

assert(UPGRADE_LABEL === "Upgrade", "upgrade label");

const plans = landing("lib/plans.ts");
assert(!plans.includes("creditsPerMonth"), "landing plans have no credit counts");
assert(!plans.includes("CREDIT_UNIT"), "landing plans drop credit unit copy");
assert(!/lesson or two|doubt chain|monthly included usage/i.test(plans), "landing plans avoid allowance copy");

const pricing = landing("components/PricingSection.tsx");
assert(!/credits/i.test(pricing), "pricing section has no credit copy");
assert(!/included usage|Doubts on those questions|Top-up/i.test(pricing), "pricing section avoids allowance copy");

const terms = landing("pages/TermsPage.tsx");
assert(!/8 credits|40 credits|90 credits|15 credits/i.test(terms), "terms drop credit counts");
assert(terms.includes("monthly included usage"), "terms name included usage");
assert(terms.includes("pooled usage"), "terms team copy is pooled usage");

const privacy = landing("pages/PrivacyPage.tsx");
assert(!/credit balance|remaining credits|one credit/i.test(privacy), "privacy drops credit counts");
assert(privacy.includes("remaining usage"), "privacy shows remaining usage");

console.log("✓ usage UI: remaining-% bar, 402 copy, Usage/Settings, landing catalog");
