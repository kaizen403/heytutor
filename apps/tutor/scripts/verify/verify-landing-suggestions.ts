import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_SUGGESTIONS } from "../../features/tutor-session/constants";
import {
  isLectureHomePrompt,
  mixHomeSuggestions,
  suggestionsForSubjects,
} from "../../lib/account/homeSuggestions";
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

function lectureCount(suggestions: { question: string; kind?: string }[]): number {
  return suggestions.filter(
    (suggestion) => suggestion.kind === "lecture" && isLectureHomePrompt(suggestion.question),
  ).length;
}

function problemCount(suggestions: { question: string; kind?: string }[]): number {
  return suggestions.filter(
    (suggestion) =>
      suggestion.kind === "problem" && !isLectureHomePrompt(suggestion.question),
  ).length;
}

assert(
  lectureCount(LANDING_SUGGESTIONS) >= 2,
  "the empty board must offer topic lectures (derive / explain / show how), not only numbered problems",
);
assert(
  problemCount(LANDING_SUGGESTIONS) >= 1,
  "the empty board still keeps at least one numbered problem beside the lectures",
);
assert(
  LANDING_SUGGESTIONS.every(
    (suggestion) =>
      (suggestion.kind === "lecture") === isLectureHomePrompt(suggestion.question),
  ),
  "kind: lecture must be a Derive / Explain / Show how prompt, and problems must not hide as lectures",
);
assert(
  /a lesson or a problem/i.test(landingCss),
  "the suggestion label must say the stack is lessons and problems, not only questions",
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

{
  const mixed = mixHomeSuggestions(
    [
      { topic: "A", kind: "problem", question: "Find x." },
      { topic: "B", kind: "problem", question: "Find y." },
      { topic: "C", kind: "lecture", question: "Derive the formula for z." },
    ],
    3,
  );
  assert(mixed[0]?.kind === "lecture", "a problems-first list must still open with a lecture");
  assert(
    mixed.some((suggestion) => suggestion.kind === "problem"),
    "mix keeps numbered problems beside the lectures",
  );
}

for (const subject of ["physics", "maths", "chemistry"] as const) {
  const picked = suggestionsForSubjects([subject]);
  assert(
    lectureCount(picked) >= 1,
    `${subject} empty board must include a topic lecture, not only problems`,
  );
  assert(
    problemCount(picked) >= 1,
    `${subject} empty board must still include a numbered problem`,
  );
}

console.log("verify-landing-suggestions: ok");
