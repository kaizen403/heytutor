/**
 * The student level (Revise / Normal / More difficult) is one axis.
 *
 * It says how well the student already knows the topic, so "harder" means the
 * topic is hard FOR THEM and the lesson must assume the least and teach the
 * most. Guards the two ways that inverts by accident: an addon that treats
 * "harder" as a harder problem, and a second control re-stating step counts
 * that the LESSON LENGTH block already owns.
 */
import {
  DEFAULT_FAMILIARITY,
  isSubjectFamiliarity,
  FAMILIARITY_ADDONS,
  familiarityFromStoredValue,
  type SubjectFamiliarity,
} from "../../src/llm/systemPrompt";
import { resolveLessonBudget } from "../../src/llm/lessonScope";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- the axis itself --------------------------------------------------------
assert(DEFAULT_FAMILIARITY === "normal", "the default level must be the middle one");
assert(
  isSubjectFamiliarity("revision") && isSubjectFamiliarity("new") && !isSubjectFamiliarity("thorough"),
  "the level guard must accept the three levels and reject the retired depth names",
);
assert(FAMILIARITY_ADDONS.normal === "", "the middle level must add no prompt text");

// --- "harder" means teach more, never ask more ------------------------------
const learningNew = FAMILIARITY_ADDONS.new;
assert(
  /does not know this topic yet/i.test(learningNew) && /Assume no prior knowledge/i.test(learningNew),
  "Harder must mean the student is new to the topic, not that the problem gets harder",
);
assert(
  !/harder (?:problem|question|example)|more (?:advanced|challenging) (?:problem|question)|second problem/i
    .test(learningNew.replace(/no second problem/i, "")),
  "Harder must never ask for a harder or additional problem",
);
assert(
  /Define every term/i.test(learningNew) && /why the law/i.test(learningNew),
  "Harder must add scaffolding: definitions first, and why the method applies",
);

// --- "revise" trims scaffolding, never the derivation -----------------------
const revision = FAMILIARITY_ADDONS.revision;
assert(
  /already knows this topic/i.test(revision),
  "Revise must state that the student already knows the topic",
);
assert(
  /never merging two derivation lines/i.test(revision) && /never skipping the check/i.test(revision),
  "Revise must protect the derivation and the check while dropping beginner scaffolding",
);
assert(
  /\[WRITE\] every line of algebra/i.test(revision),
  "Revise must still write every line of algebra on the board",
);

// --- one axis: the level never re-states a step count -----------------------
for (const familiarity of ["revision", "new"] as const) {
  assert(
    !/\d+\s*-\s*\d+\s+steps/i.test(FAMILIARITY_ADDONS[familiarity]),
    `${familiarity} hard-codes a step range; only the LESSON LENGTH block may set one`,
  );
  assert(
    /LESSON LENGTH block|budget/i.test(FAMILIARITY_ADDONS[familiarity]),
    `${familiarity} must defer the step count to the lesson budget`,
  );
}

// --- the level moves the budget, monotonically ------------------------------
const question = "Find the area bounded by y = x^2 and y = 2x.";
const steps = (["revision", "normal", "new"] as const).map(
  (familiarity) => resolveLessonBudget(question, familiarity).maxSteps,
);
assert(
  steps[0]! < steps[1]! && steps[1]! < steps[2]!,
  `the level must lengthen the lesson monotonically, got ${steps.join(" / ")}`,
);

// --- a returning student keeps the preference they set ----------------------
const migrations: [string, SubjectFamiliarity][] = [
  ["concise", "revision"],
  ["standard", "normal"],
  ["thorough", "new"],
  ["revise", "revision"],
  ["harder", "new"],
];
for (const [stored, expected] of migrations) {
  assert(
    familiarityFromStoredValue(stored) === expected,
    `a stored "${stored}" depth must read back as "${expected}"`,
  );
}
assert(
  familiarityFromStoredValue("revision") === "revision",
  "an already-migrated value must round-trip",
);
assert(
  familiarityFromStoredValue("epic") === null && familiarityFromStoredValue(null) === null,
  "junk in localStorage must not resolve to a level",
);

console.log("verify-familiarity: ok");
