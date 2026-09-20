/**
 * Concept explain lessons: keep the richer turn plan, do not force a P–V
 * family, compact long-session history, and teach on the figure.
 */
import {
  compactConversationHistory,
  CONCEPT_LESSON_RUNTIME_ADDON,
  inferSceneCapabilities,
  isExplainRequest,
  selectTurnPlanV3Consensus,
  TUTOR_SYSTEM_PROMPT,
  TURN_PLAN_V3_PROMPT,
  type ConversationExchange,
} from "../../src";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(isExplainRequest("can u explain me laws of thermodynamics"), "explain-the-laws is an explain request");
assert(isExplainRequest("Explain Kirchhoff's junction rule."), "a leading explain is an explain request");
assert(
  !isExplainRequest("Which of the following statements is correct?"),
  "an MCQ is not an explain request",
);

const thermo = "can u explain me laws of thermodynamics";
const capabilities = inferSceneCapabilities(thermo, {
  lawIds: [
    "zeroth-law-of-thermodynamics",
    "first-law-of-thermodynamics",
    "second-law-of-thermodynamics",
  ],
  turnPlan: { lawIds: ["first-law-of-thermodynamics"], visualRequirement: "optional" },
});
assert(
  !capabilities.families.includes("state_plot"),
  `explain-the-laws must not select a P–V family (got ${capabilities.families.join(",")})`,
);
assert(
  !capabilities.families.includes("point_field"),
  `explain-the-laws must not select a point-field family (got ${capabilities.families.join(",")})`,
);

const pvDraw =
  "Draw a labelled diagram for First law of thermodynamics. Draw the named process on a P-V diagram.";
const pvCapabilities = inferSceneCapabilities(pvDraw, {
  lawIds: ["first-law-of-thermodynamics"],
});
assert(
  pvCapabilities.families.includes("state_plot"),
  "an explicit P–V first-law diagram request must keep the state plot family",
);

const thin: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: thermo,
  givens: [],
  unknowns: [],
  derived: [],
  qualitativeClaims: [{
    id: "c1",
    claim: "Zeroth Law: If two systems are each in thermal equilibrium with a third system, they are in thermal equilibrium with each other.",
    expected: true,
  }],
  lawIds: ["zeroth_law_thermodynamics"],
  assumptions: [],
  visualRequirement: "optional",
};
const rich: TurnPlanV3 = {
  ...thin,
  qualitativeClaims: [
    {
      id: "c0",
      claim: thin.qualitativeClaims[0]!.claim,
      expected: true,
      relatedEntityHints: ["system A", "system B", "system C (thermometer)"],
    },
    {
      id: "c1",
      claim: "First Law: ΔU = Q − W.",
      expected: true,
      relatedEntityHints: ["heat Q", "work W"],
    },
  ],
};
const picked = selectTurnPlanV3Consensus(thin, rich);
assert(picked === rich, "concept-plan consensus must keep the plan with entity hints");

assert(
  TURN_PLAN_V3_PROMPT.includes("an explain names systems or flows"),
  "TurnPlanV3 prompt must judge teaching schematics for explain questions",
);
assert(
  CONCEPT_LESSON_RUNTIME_ADDON.includes("Do not invent measurements"),
  "concept lessons must not invent numerical examples",
);
assert(
  CONCEPT_LESSON_RUNTIME_ADDON.includes("Do not write a summary"),
  "concept lessons must not fill leftover steps with a recap",
);
assert(
  CONCEPT_LESSON_RUNTIME_ADDON.includes("[FOCUS]"),
  "concept lessons with a figure must FOCUS labeled parts",
);
assert(
  TUTOR_SYSTEM_PROMPT.includes("earlier turns in this session are background only"),
  "long sessions must not reuse earlier numbers by default",
);

const longHistory: ConversationExchange[] = Array.from({ length: 12 }, (_, index) => ({
  user: `question ${index} with extra padding to look like a real stem about resistors and voltages`,
  assistant: `this is a long spoken lesson ${index} ${"word ".repeat(200)}and the result was ${index * 3} volts`,
}));
const compact = compactConversationHistory(longHistory);
assert(compact.length === 6, `history must keep six turns, got ${compact.length}`);
assert(
  compact[0]?.user.includes("question 6") && !compact.some((exchange) => exchange.user.includes("question 0")),
  "history must drop the oldest turns, not keep all twelve",
);
assert(
  compact.every((exchange, index) =>
    index === compact.length - 1
      ? exchange.assistant.length <= 900
      : exchange.assistant.length <= 280),
  "older turns must be clipped so the next lesson cannot drown in prior speech",
);
assert(
  !compact[compact.length - 1]?.assistant.includes("33 volts"),
  "the last lesson must be clipped before the leftover spoken tail",
);

console.log("concept lesson verification passed");
