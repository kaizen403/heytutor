/**
 * Prewarm the reference picture cache for common topics, so a student's first
 * ask is a cache hit (about 1 s) instead of a cold search, judge and fact
 * check (14 to 25 s, sometimes past the turn's 25 s wait). Paid: about $0.02 to
 * $0.08 a topic on Fireworks; stops at --max-usd. Writes to whatever database
 * DATABASE_URL names, so point it at production only on purpose.
 *
 *   pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/live/reference-picture-prewarm.ts --questions topics.txt --max-usd 5
 *
 * One question per line, written the way a student asks ("Explain the water
 * cycle."); lines starting with # are skipped. Topics already cached are free.
 */
import { readFileSync } from "node:fs";
import { actualLlmCost } from "@/lib/billing/paidUsage";
import { parseProviderUsage, usageDetailsFromParsed } from "@/lib/obs/providerUsage";
import { createPictureSpend, findReferencePicture } from "@/lib/reference-picture/findReferencePicture";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const file = arg("questions");
  const maxUsd = Number(arg("max-usd") ?? "");
  const apiKey = process.env.FIREWORKS_API_KEY?.trim() ?? "";
  if (!file || !(maxUsd > 0)) throw new Error("--questions <file> and a positive --max-usd are required");
  if (!apiKey) throw new Error("FIREWORKS_API_KEY is not set");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").host; } catch { return "unknown"; } })();
  const questions = readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  console.log(`prewarming ${questions.length} topics into ${host}, cap $${maxUsd}`);
  let spent = 0;
  const tally = { ready: 0, cached: 0, declined: 0, failed: 0 };
  for (const question of questions) {
    if (spent >= maxUsd) { console.log(`cap $${maxUsd} reached`); break; }
    const spend = createPictureSpend();
    const started = Date.now();
    try {
      const outcome = await findReferencePicture(question, undefined, { apiKey, spend, imageProvider: null });
      if (outcome.status === "ready") tally[outcome.cached ? "cached" : "ready"]++;
      else tally.declined++;
      const label = outcome.status === "ready" ? `${outcome.cached ? "cached" : "READY"} ${outcome.picture.title}` : `declined ${outcome.reason}`;
      console.log(`${String(Date.now() - started).padStart(6)} ms  ${label}  <- ${question.slice(0, 70)}`);
    } catch (error) {
      tally.failed++;
      console.log(`failed ${error instanceof Error ? error.message : String(error)}  <- ${question.slice(0, 70)}`);
    }
    // Calls still counted in flight after a failure are priced at the judge's ceiling.
    spent += spend.usages.reduce((sum, u) => sum + (actualLlmCost(usageDetailsFromParsed(parseProviderUsage(u.usage)), u.model) ?? 0.063), 0) + spend.inFlight.judge * 0.063;
  }
  console.log(`done: ${tally.ready} new, ${tally.cached} already cached, ${tally.declined} declined, ${tally.failed} failed; about $${spent.toFixed(3)}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
