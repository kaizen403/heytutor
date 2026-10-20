import assert from "node:assert/strict";
import { codeLessonBeatPlan, dsaLessonIncludesCode, isExplanationOnlyDsaQuestion, type CodeLessonPlan } from "../../src/code/codeLessonPlan";
import { CODE_LESSON_SYSTEM_PROMPT, codeLessonPromptAddon } from "../../src/code/codeLessonTeaching";

// Synthetic controls for a copied input and blocks split across branch boundaries.
// The recorded questions, learner text and identifiers stay outside the repository.
const plan: CodeLessonPlan = {
  schemaVersion: "code-lesson/v1", language: "python", title: "Adjacent exchanges",
  question: "Explain sorting neighbouring entries and show its code.",
  diagramHint: { structure: "none" },
  sections: [{ id: "s", title: "Sort a copy", explanation: "Exchange neighbouring inverted values.",
    typeAlongRanges: [],
    blocks: [
      { id: "copy", code: "def arrange(items):\n    work = list(items)\n    size = len(work)" },
      { id: "branch", code: "    if size > 1:\n        size -= 1\n    else:\n        return work" },
      { id: "end", code: "    return work" },
    ],
  }],
};
const before = JSON.stringify(plan);
assert(dsaLessonIncludesCode(isExplanationOnlyDsaQuestion("Explain iteration in programming")),
  "a programming explanation needs a concrete implementation example");
for (const question of ["Explain iteration in programming without code", "Explain a call stack in programming, no code", "Explain iteration in programming without writing code", "Explain a call stack in programming without showing any code", "Explain iteration in programming, don't include code", "Explain dynamic programming", "Explain adjacent swaps with a visual example"]) {
  assert(!dsaLessonIncludesCode(isExplanationOnlyDsaQuestion(question)),
    "an explicit no-code request or a visual algorithm explanation still owes no TYPE blocks");
}
const system = CODE_LESSON_SYSTEM_PROMPT;
assert.match(system, /every statement in the current block/i,
  "a block crossing a branch boundary must not move its last clause into the next narration beat");
assert.match(system, /do not move.*(?:next|previous) block/i);
assert.match(system, /loop condition.*meet.*cross/i,
  "termination comes from the actual comparison, not a stock two-pointer ending");
assert.match(system, /copies.*slices.*buffers.*recursion/i,
  "implementation complexity must account for allocations and stack frames");
assert.match(system, /sorting a copy.*not.*constant/i,
  "mutating an allocated copy is not constant total extra space");

for (const familiarity of ["new", "normal", "revision"] as const) {
  const addon = codeLessonPromptAddon(plan, { familiarity, includeCode: true });
  for (const block of plan.sections[0]!.blocks) {
    assert(addon.includes(`[TYPE:${block.id}]`));
    assert(addon.includes(block.code.split("\n").map((line) => `      ${line}`).join("\n")),
      "the exact source of each block must accompany its own beat");
  }
  assert.match(addon, /complexity of the committed program.*allocations/i);
  assert.match(addon, /all statements.*branch.*boundar/i);
  assert.doesNotMatch(addon, /Give the slow way and why it struggles/i);
  const beats = codeLessonBeatPlan({ frames: [], blockIds: ["copy", "branch", "end"], familiarity });
  for (const beat of beats.filter((entry) => entry.kind === "brute_force")) {
    assert.match(beat.brief, /same.*complexity|same.*cost/i);
    assert.doesNotMatch(beat.brief, /why it is too slow/i,
      "a baseline with the same bound cannot be invented as an asymptotic improvement");
  }
  for (const beat of beats.filter((entry) => entry.kind === "idea")) {
    assert.doesNotMatch(beat.brief, /fast approach/i);
  }
}
assert.equal(JSON.stringify(plan), before, "truth guidance never rewrites the committed program");
const visual = codeLessonPromptAddon(plan, { includeCode: false });
assert.doesNotMatch(visual, /\[TYPE:|work = list/,
  "implementation-specific allocation facts must not leak unseen code into a visual explanation");
console.log("Code teaching truth: exact block boundaries, termination, implementation space and honest motivation pass.");
