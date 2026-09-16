/**
 * The chemistry lane in the app: the subject is offered, a chemistry
 * question gets the chemistry teaching addon and never the LLM scene planner,
 * and the figure is named to the tutor in words. Source anchors are asserted
 * on both ends so a moved control fails loud instead of failing open.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHEMISTRY_LESSON_RUNTIME_ADDON } from "@heytutor/tutor-core";
import { describeSceneFamily, isChemistryQuestion } from "@heytutor/scene-engine";
import { AVAILABLE_SUBJECTS } from "../../lib/account/types";
import { suggestionsForSubjects } from "../../lib/account/homeSuggestions";
import { inferBoardSubject } from "../../lib/account/progress";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), "utf8");

function slice(source: string, start: string, end: string, name: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${name}: start anchor missing; repoint this gate at the control that replaced it`);
  const to = source.indexOf(end, from);
  assert(to > from, `${name}: end anchor missing; repoint this gate at the control that replaced it`);
  return source.slice(from, to);
}

// 1. The subject is offered and stored.
assert(AVAILABLE_SUBJECTS.includes("chemistry"), "chemistry must be an available subject");
const onboarding = read("../../features/account/OnboardingScreen.tsx");
assert(!/Chemistry soon/.test(onboarding), "the onboarding screen still shows the disabled Chemistry chip");
const chemistrySuggestions = suggestionsForSubjects(["chemistry"]);
assert(chemistrySuggestions.length >= 4, "chemistry needs at least four home suggestions");
for (const suggestion of chemistrySuggestions) {
  assert(isChemistryQuestion(suggestion.question), `chemistry suggestion is not read as chemistry: ${suggestion.question}`);
}
assert(inferBoardSubject("Daniell cell", "Zn|Zn2+||Cu2+|Cu electrode potential", ["chemistry"]) === "chemistry", "progress must file a cell board under chemistry");

// 2. A chemistry question gets the chemistry addon; a physics question does not.
const chemistryPrompt = buildTurnTeachingPrompt({
  question: "Predict the hybridisation and shape of SF4 and XeF4.",
  diagramPromptAddon: null,
  turnPlan: null,
  solverProjection: null,
  codeLesson: null,
  isDsa: false,
  familiarity: "normal",
  fastMode: false,
});
assert(chemistryPrompt.systemPrompt.includes(CHEMISTRY_LESSON_RUNTIME_ADDON), "chemistry question lacks the chemistry lesson addon");
const physicsPrompt = buildTurnTeachingPrompt({
  question: "A ball is thrown at 20 m/s at 30 degrees. Find the range.",
  diagramPromptAddon: null,
  turnPlan: null,
  solverProjection: null,
  codeLesson: null,
  isDsa: false,
  familiarity: "normal",
  fastMode: false,
});
assert(!physicsPrompt.systemPrompt.includes(CHEMISTRY_LESSON_RUNTIME_ADDON), "a physics question carries the chemistry addon");
assert(/H_2SO_4/.test(CHEMISTRY_LESSON_RUNTIME_ADDON) && /⇌/.test(CHEMISTRY_LESSON_RUNTIME_ADDON) && /balanced/.test(CHEMISTRY_LESSON_RUNTIME_ADDON), "the chemistry addon must teach script notation, the equilibrium arrow, and balanced rows");

// 3. The LLM scene planner is skipped for a chemistry question.
const handler = read("../../features/tutor-session/hooks/turn/useQuestionHandler.ts");
const decision = slice(handler, "const chemistryLane =", "const planContext =", "exact-scene decision");
assert(/isChemistrySceneFamily/.test(decision) && /isChemistryQuestion\(question\)/.test(decision), "the chemistry lane must be decided from the families and the question");
assert(/shouldPlanExactScene = planningTurnPlan\.visualRequirement !== "none" && !chemistryLane/.test(decision), "a chemistry question must skip the LLM scene planner");

// 4. The figure is named in words the student uses.
assert(describeSceneFamily("chem_vsepr") === "VSEPR molecular shape", "chemistry families must be described in words");
assert(describeSceneFamily("circuit_network") === "circuit network", "physics families keep their plain description");
const presentation = read("../../features/tutor-session/lib/scene/verifiedScenePresentation.ts");
assert(/describeSceneFamily\(options\.figureFamily\)/.test(presentation), "the figure contract must name the family through describeSceneFamily");

console.log("verify-chemistry-lane: ok (subject offered, addon keyed off the question, exact planner skipped, figure named)");
