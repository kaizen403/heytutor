import assert from "node:assert/strict";
import { buildLessonSegments, getSegmentCommands } from "@heytutor/drawing";
import {
  codeLessonPromptAddon, dsaLessonIncludesCode, isExplanationOnlyDsaQuestion, type CodeLessonPlan,
} from "@heytutor/tutor-core";
import { codeLessonResumeNote, createCodeLessonConductor } from "../../features/tutor-session/lib/code-lesson/codeLessonSegments";

const plan: CodeLessonPlan = {
  schemaVersion: "code-lesson/v1", language: "python", question: "Explain iteration in programming",
  title: "Count a sequence", diagramHint: { structure: "none" },
  sections: [{ id: "s", title: "Count", explanation: "Count one item at a time.", typeAlongRanges: [],
    blocks: [{ id: "begin", code: "def count(items):\n    total = 0" },
      { id: "walk", code: "    for item in items:\n        total += 1\n    return total" }],
  }],
};
const order = plan.sections.flatMap((section) => section.blocks.map((block) => block.id));
for (const question of [plan.question, "Explain iteration in programming without showing code", "Explain iteration with a visual example"]) {
  const includeCode = dsaLessonIncludesCode(isExplanationOnlyDsaQuestion(question));
  const expected = question === plan.question;
  assert.equal(includeCode, expected);
  const prompt = codeLessonPromptAddon(plan, { includeCode });
  assert.deepEqual([...prompt.matchAll(/\[TYPE:([^\]]+)\]/g)].map((match) => match[1]), expected ? order : []);
  // A recorded-style explanation with no TYPE must not silently finish a
  // programming lesson. The real continuation names the missing source.
  const conductor = createCodeLessonConductor(plan, { includeCode });
  conductor.resolve(buildLessonSegments("[STEP]We repeat one operation for each item.[/STEP]"));
  conductor.finish();
  assert.deepEqual(conductor.status().missingBlockIds, expected ? order : []);
  const note = codeLessonResumeNote(conductor.status(), plan);
  if (!expected) { assert.equal(note, ""); continue; }
  assert.match(note, /2 code blocks.*begin/);
  const reply = order.map((id) => `[STEP]Here is the next part. [TYPE:${id}][/STEP]`).join("\n");
  const resolved = conductor.resolve(buildLessonSegments(reply));
  const tail = conductor.finish();
  const typed = [...resolved.segments, ...tail.segments].flatMap(getSegmentCommands).filter((command) => command.type === "TYPE");
  assert.deepEqual(typed.map((command) => command.semanticRef?.entityId), order);
  assert.deepEqual(typed.map((command) => command.text), plan.sections[0]!.blocks.map((block) => block.code));
  assert.deepEqual(conductor.status().missingBlockIds, []);
  // The progress used by a resume cannot request or type the same source twice.
  const resumed = createCodeLessonConductor(plan, { includeCode, alreadyRevealedBlockIds: order });
  assert.deepEqual(resumed.status().missingBlockIds, []);
  assert.equal(codeLessonResumeNote(resumed.status(), plan), "");
}
console.log("Programming example: intent, prompt, streamed missing-code continuation and exact source reveal pass; no model calls.");
