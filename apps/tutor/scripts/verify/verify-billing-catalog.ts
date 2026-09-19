import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BILLING_FEATURES,
  BILLING_PLANS,
  GRANT_TTL_MS,
  MAX_DOUBTS_PER_CREDIT,
  MAX_NEW_QUESTIONS_PER_HOUR,
  PLAN_CATALOG,
  TOP_UP_USD,
  TTS_CHARS_PER_LESSON,
  millicentsToUsd,
  usdToMillicents,
} from "../../lib/billing/catalog";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(PLAN_CATALOG.free.includedUsdPerMonth === 3.5, "Free envelope is $3.50");
assert(PLAN_CATALOG.plus.priceUsdPerMonth === 19 && PLAN_CATALOG.plus.includedUsdPerMonth === 12, "Plus is $19 / $12 envelope");
assert(PLAN_CATALOG.pro.priceUsdPerMonth === 39 && PLAN_CATALOG.pro.includedUsdPerMonth === 24, "Pro is $39 / $24 envelope");
assert(PLAN_CATALOG.free.notesMessagesPerMonth === 30, "Free notes 30");
assert(PLAN_CATALOG.plus.notesMessagesPerMonth === 200, "Plus notes 200");
assert(PLAN_CATALOG.pro.notesMessagesPerMonth === 500, "Pro notes 500");
assert(TOP_UP_USD === 10, "top-up is $10");
assert(usdToMillicents(3.5) === 3500, "Free envelope is 3500 millicents");
assert(millicentsToUsd(3500) === 3.5, "3500 millicents is $3.50");
assert(TTS_CHARS_PER_LESSON === 12_000, "TTS fuse is 12000 chars");
assert(GRANT_TTL_MS === 20 * 60 * 1000, "grant TTL is 20 minutes");
assert(MAX_DOUBTS_PER_CREDIT === 8, "8 doubts per grant");
assert(MAX_NEW_QUESTIONS_PER_HOUR === 3, "3 new questions per hour");
assert(BILLING_FEATURES.lessons === "lessons", "lessons feature id");
assert(BILLING_FEATURES.notesMessages === "notes_messages", "notes feature id");
assert(BILLING_FEATURES.ttsChars === "tts_chars", "tts feature id");
assert(BILLING_FEATURES.llmTokens === "llm_tokens", "llm feature id");
assert(BILLING_PLANS.lessonTopUp === "lesson_top_up", "top-up plan id");

const config = readFileSync(resolve(import.meta.dirname, "../../autumn.config.ts"), "utf8");
assert(config.includes('featureId: "lessons"'), "autumn.config must define lessons");
assert(config.includes('featureId: "notes_messages"'), "autumn.config must define notes_messages");
assert(config.includes('featureId: "tts_chars"'), "autumn.config must define tts_chars");
assert(config.includes('featureId: "llm_tokens"'), "autumn.config must define llm_tokens");
assert(config.includes("unlimited: true"), "autumn.config lessons/meters are unlimited");
assert(!config.includes("included: 8"), "autumn.config must not include 8 lesson credits");
assert(!config.includes("included: 40"), "autumn.config must not include 40 lesson credits");
assert(!config.includes("included: 90"), "autumn.config must not include 90 lesson credits");
assert(!config.includes("included: 15"), "autumn.config must not include 15 top-up credits");
assert(config.includes("amount: 19"), "autumn.config Plus price");
assert(config.includes("amount: 39"), "autumn.config Pro price");
assert(config.includes("amount: 10"), "autumn.config top-up price");
assert(config.includes("autoEnable: true"), "Free auto-enables on first customer");

console.log("✓ billing catalog and autumn.config.ts stay aligned");
