/**
 * Autumn CLI catalog. Sync with `pnpm dlx atmn push` after `atmn login`.
 * Runtime numbers live in `lib/billing/catalog.ts` — keep them identical.
 * Lesson counts are unlimited here; the student bar is remaining % of USD.
 */
import { atmn, feature, plan } from "atmn";

export const lessons = feature({
  featureId: "lessons",
  name: "Lesson usage",
  type: "metered",
  consumable: true,
});

export const notesMessages = feature({
  featureId: "notes_messages",
  name: "Notes messages",
  type: "metered",
  consumable: true,
});

export const ttsChars = feature({
  featureId: "tts_chars",
  name: "TTS characters",
  type: "metered",
  consumable: true,
});

export const llmTokens = feature({
  featureId: "llm_tokens",
  name: "LLM tokens",
  type: "metered",
  consumable: true,
});

const trackedMeters = [
  { featureId: lessons.featureId, unlimited: true },
  { featureId: ttsChars.featureId, unlimited: true },
  { featureId: llmTokens.featureId, unlimited: true },
];

export const free = plan({
  planId: "free",
  versionSlug: "v2",
  active: true,
  name: "Free",
  autoEnable: true,
  group: "main",
  items: [
    { featureId: notesMessages.featureId, included: 30, reset: { interval: "month" } },
    ...trackedMeters,
  ],
});

export const plus = plan({
  planId: "plus",
  versionSlug: "v2",
  active: true,
  name: "Plus",
  group: "main",
  price: { amount: 19, interval: "month" },
  items: [
    { featureId: notesMessages.featureId, included: 200, reset: { interval: "month" } },
    ...trackedMeters,
  ],
});

export const pro = plan({
  planId: "pro",
  versionSlug: "v2",
  active: true,
  name: "Pro",
  group: "main",
  price: { amount: 39, interval: "month" },
  items: [
    { featureId: notesMessages.featureId, included: 500, reset: { interval: "month" } },
    ...trackedMeters,
  ],
});

export const lessonTopUp = plan({
  planId: "lesson_top_up",
  versionSlug: "v2",
  active: true,
  name: "Usage top-up",
  addOn: true,
  price: { amount: 10, interval: "one_off" },
  items: [...trackedMeters],
});

export default atmn({
  features: [lessons, notesMessages, ttsChars, llmTokens],
  plans: [free, plus, pro, lessonTopUp],
});
