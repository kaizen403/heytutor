import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_SUGGESTIONS } from "../../features/tutor-session/constants";

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

console.log("verify-landing-suggestions: ok");
