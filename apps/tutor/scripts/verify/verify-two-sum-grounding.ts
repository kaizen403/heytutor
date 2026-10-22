/** Real simulator -> compiled frames -> teaching prompt; no model or provider. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulateHashMapTwoSum } from "../../../../packages/scene-engine/src/dsa/trace/simulators/stackAndMap";
import { validateCodeLessonPlan, type CodeLessonPlan } from "@heytutor/tutor-core";
import { resolveCodeLessonBoardContext, resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const captured = JSON.parse(readFileSync(new URL("./fixtures/two-sum-grounding.json", import.meta.url), "utf8")) as {
  question: string;
  recordedFalseStep: string;
  plan: CodeLessonPlan;
};
assert.match(captured.recordedFalseStep, /input में values sorted नहीं हैं/, "retain the actual false launch claim as evidence");

const cases: Array<{ name: string; values: number[]; target: number; answer: [number, number] | null }> = [
  { name: "sorted launch L21", values: [2, 7, 11, 15], target: 9, answer: [0, 1] },
  { name: "unsorted original indices", values: [11, 2, 15, 7], target: 9, answer: [1, 3] },
  { name: "descending original indices", values: [15, 11, 7, 2], target: 9, answer: [2, 3] },
  { name: "duplicate values are distinct positions", values: [3, 3, 4, 8], target: 6, answer: [0, 1] },
  { name: "negative values", values: [-5, -2, 7, 10], target: 5, answer: [1, 2] },
  { name: "no pair", values: [1, 2, 4, 8], target: 20, answer: null },
  { name: "a value cannot pair with itself", values: [3, 1, 8, 10], target: 6, answer: null },
  { name: "two zeroes can pair", values: [0, 4, 0, 9], target: 0, answer: [0, 2] },
];

for (const [index, test] of cases.entries()) {
  const question = index === 0 ? captured.question
    : `Explain Two Sum in Python: nums = [${test.values.join(", ")}], target = ${test.target}. Use a hash map.`;
  const plan: CodeLessonPlan = {
    ...captured.plan,
    question,
    sections: captured.plan.sections.map((section) => ({
      ...section,
      explanation: index === 0 ? section.explanation
        : "Look up the complement among earlier values before storing this value and its original index.",
      blocks: section.blocks.map((block) => ({
        ...block,
        code: block.code.replace(/nums = \[[^\]]*\]/, `nums = [${test.values.join(", ")}]`)
          .replace(/target = 9/, `target = ${test.target}`),
      })),
    })),
  };
  const validation = validateCodeLessonPlan(plan);
  assert(validation.plan && validation.issues.length === 0, `${test.name}: recorded program shape remains valid`);
  const trace = simulateHashMapTwoSum({ values: [...test.values], target: test.target });
  assert(trace, `${test.name}: real simulator accepts the example`);
  assert.deepEqual(trace.input, { values: test.values, target: test.target }, `${test.name}: input order is preserved`);
  assert.deepEqual(trace.result, test.answer, `${test.name}: hand-computed original indices`);
  assert.equal(trace.resultText, test.answer ? `[${test.answer.join(", ")}]` : "no pair");
  assert.equal(trace.frames.at(-1)?.id, test.answer ? `hit${test.answer[1]}` : `store${test.values.length - 1}`);
  for (const frame of trace.frames) {
    assert.equal(frame.state.kind, "array");
    if (frame.state.kind === "array") assert.deepEqual(frame.state.cells.map((cell) => cell.text), test.values.map(String));
  }

  const context = resolveCodeLessonBoardContext(question);
  const walk = resolveDsaFrames(question, plan.diagramHint, plan);
  assert(context && walk, `${test.name}: actual board context and frames compile`);
  assert.equal(walk.algorithmId, "hash_map_two_sum");
  assert.equal(walk.frameSource, "trace", `${test.name}: never substitute the model hint`);
  assert.equal(walk.exampleSource, "question", `${test.name}: never silently use the family default`);
  assert.deepEqual(context.context.input, trace.input);
  assert.equal(context.facts.resultText, trace.resultText);
  assert.deepEqual(walk.frames.map((frame) => frame.id), trace.frames.map((frame) => frame.id));
  for (const [frameIndex, frame] of walk.frames.entries()) {
    assert.equal(frame.narrationIntent, trace.frames[frameIndex]!.narrationIntent);
    for (const [cellIndex, value] of test.values.entries()) {
      assert(frame.presentation.diagram.commands.some((command) => command.type === "LABEL"
        && command.semanticRef?.entityId === `cell${cellIndex}` && command.text === String(value)),
      `${test.name}: compiled cell ${cellIndex} retains its source value ${value}`);
    }
  }

  const prompt = buildTurnTeachingPrompt({
    question, turnPlan: null, solverProjection: null,
    diagramPromptAddon: walk.frames[0]!.presentation.diagram.promptAddon,
    codeLesson: plan, codeLessonFrames: walk.frames, codeLessonFacts: context.facts,
    isDsa: true, familiarity: "normal", fastMode: true,
  });
  const grounding = walk.frames[0]!.narrationIntent;
  assert(prompt.runtimeAddon.includes(grounding) && prompt.systemPrompt.includes(grounding),
    `${test.name}: the actual model prompt receives the simulator's facts`);
  assert.doesNotMatch(grounding, /(?:array|input|values) (?:is|are) (?:not sorted|unsorted)|both ends will not work|two pointers will not work/i,
    `${test.name}: selecting a hash map cannot assert the input is unsorted or exclude a valid alternative`);
  assert.match(grounding, /(?:does not require sorted|without (?:requiring |assuming )?sorted|regardless of.*order)/i,
    `${test.name}: method applicability is independent of the example's order`);
  assert.match(grounding, /look up.*before storing/i, `${test.name}: complement lookup precedes storing this position`);
  assert.match(grounding, /original ind(?:ex|ices)/i, `${test.name}: positions refer to the original input`);
  assert(prompt.runtimeAddon.includes(`what it establishes: ${grounding}`));
  console.log(`PASS ${test.name}: ${JSON.stringify(test.values)} -> ${trace.resultText}, ${walk.frames.length} compiled frames`);
}

console.log(`verify-two-sum-grounding: ${cases.length} real simulator/frame/prompt cases passed; no providers`);
