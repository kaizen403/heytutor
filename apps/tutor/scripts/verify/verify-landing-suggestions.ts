import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_SUGGESTIONS } from "../../features/tutor-session/constants";
import { suggestionsForSubjects } from "../../lib/account/homeSuggestions";
import { AVAILABLE_SUBJECTS, COMING_SOON_SUBJECTS } from "../../lib/account/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const landingCss = readFileSync(
  join(here, "../../features/tutor-session/components/CanvasLanding.tsx"),
  "utf8",
);
const listBlock = landingCss.match(
  /\.ac-landing__question-list\s*\{[\s\S]*?\n\}/,
)?.[0];
assert(listBlock, "the landing question list styles must exist");
assert(
  /flex-direction:\s*column/.test(listBlock),
  "landing suggestions must be one stacked column — a second column clips on the empty-board panel",
);
assert(
  !/grid-template-columns:\s*1fr\s+1fr/.test(listBlock),
  "landing suggestions must not use a two-column grid",
);

const landingBlock = landingCss.match(/\.ac-landing\s*\{[\s\S]*?\n\}/)?.[0];
assert(landingBlock, "the landing column styles must exist");
assert(
  /max-width:\s*40rem/.test(landingBlock),
  "the landing column must stay 40rem so cards do not clip the panel edge",
);

const textBlock = landingCss.match(
  /\.ac-landing__question-text\s*\{[\s\S]*?\n\}/,
)?.[0];
assert(textBlock, "the landing question text styles must exist");
assert(
  !/-webkit-line-clamp/.test(textBlock),
  "landing card copy must not be line-clamped — the full prompt has to stay readable",
);

assert(
  LANDING_SUGGESTIONS.length >= 4 && LANDING_SUGGESTIONS.length <= 5,
  `landing suggestions must stay between 4 and 5 so the one-column stack fits one page (got ${LANDING_SUGGESTIONS.length})`,
);
assert(
  LANDING_SUGGESTIONS.some((suggestion) =>
    /\b(?:explain|derive)\b/i.test(suggestion.question),
  ),
  "the landing list must include at least one explain or derive prompt",
);
assert(
  new Set(LANDING_SUGGESTIONS.map((suggestion) => suggestion.question)).size ===
    LANDING_SUGGESTIONS.length,
  "landing suggestion prompts must be unique",
);
assert(
  new Set(
    LANDING_SUGGESTIONS.map((suggestion) => suggestion.topic.trim().toLowerCase()),
  ).size === LANDING_SUGGESTIONS.length,
  "landing suggestion topics must each be a different chapter — the empty board must not stack two cards from the same unit",
);

assert(
  !AVAILABLE_SUBJECTS.includes("dsa"),
  "DSA is not student-ready — do not offer it in onboarding",
);
assert(
  COMING_SOON_SUBJECTS.includes("dsa") &&
    COMING_SOON_SUBJECTS.every((subject) => !AVAILABLE_SUBJECTS.includes(subject)),
  "DSA stays a coming-soon chip until the code lane is offered",
);
const onboarding = readFileSync(
  join(here, "../../features/account/OnboardingScreen.tsx"),
  "utf8",
);
assert(
  onboarding.includes("COMING_SOON_SUBJECTS") &&
    onboarding.includes("${SUBJECT_LABELS[subject]} soon") &&
    /disabled/.test(onboarding),
  "onboarding must show DSA as a disabled coming-soon chip, not as a selectable subject",
);
const physicsQuestions = new Set(LANDING_SUGGESTIONS.map((suggestion) => suggestion.question));
assert(
  suggestionsForSubjects(["dsa"]).every((suggestion) => physicsQuestions.has(suggestion.question)),
  "a DSA-only profile must fall back to physics landing prompts, not LeetCode cards",
);
assert(
  !suggestionsForSubjects(["physics", "dsa", "chemistry"]).some((suggestion) =>
    /Two Sum|Valid Parentheses|longest substring/i.test(suggestion.question),
  ),
  "stored DSA must not leak LeetCode cards onto a mixed-subject empty board",
);

console.log("verify-landing-suggestions: ok");
