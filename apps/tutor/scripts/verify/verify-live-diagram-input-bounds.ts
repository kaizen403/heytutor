import assert from "node:assert/strict";
import { withTurnTraceHeaders } from "@heytutor/tutor-core";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildLiveDiagramPickerBody,
  filterLiveDiagramExamples,
  injectLiveDiagramExamples,
  liveDiagramPromptInputBounds,
} from "../../lib/scene/diagramExampleLibrary.server";
import { buildDiagramExampleCatalogue, type DiagramExemplar } from "../lecture-lab/diagramExamples";
import { readChatTraceHeaders } from "../../lib/obs/chatTrace";

assert.equal(typeof liveDiagramPromptInputBounds, "function", "the server must advertise prepared-message input bounds before lab dispatch");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const messages = (body: string): unknown => JSON.parse(body).messages ?? [];
let checked = 0;
function covered(raw: string, prepared: string, bound: { inputByteMultiplier: number; addedInputBytes: number }) {
  const actual = bytes(messages(prepared));
  const ceiling = bytes(messages(raw)) * bound.inputByteMultiplier + bound.addedInputBytes;
  assert(actual <= ceiling, `prepared messages need ${actual} UTF-8 bytes, exceeding the advertised ${ceiling}`);
  checked++;
}

const question = "Sketch the synthetic setup.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question,
  givens: [], unknowns: [], derived: [], assumptions: [], qualitativeClaims: [], lawIds: [],
  visualRequirement: "required",
};
const rawPicker = (submittedPlan: unknown) => JSON.stringify({ messages: [
  { role: "user", content: JSON.stringify({ plan: submittedPlan }) },
] });
const emptyBounds = liveDiagramPromptInputBounds([]);
const emptyPicker = buildLiveDiagramPickerBody(rawPicker(plan), question, []);
assert.deepEqual(JSON.parse(emptyPicker), {
  model: "server-selected", max_tokens: 60, temperature: 0, stream: false,
  messages: [{ role: "user", content: "Pick up to 3 catalogue examples whose DRAWN FIGURE would best guide a diagram for the student question.\n\nMatch meaning, not shared words. Return none when no figure fits.\n\nReturn strict JSON only: {\"ids\":[\"catalogue-id\"]} or {\"ids\":[]}.\n\nQUESTION\nSketch the synthetic setup.\n\nTURN PLAN SUMMARY\nvisual required\n\nCATALOGUE\n" }],
}, "advertising input bounds leaves the exact production picker body unchanged");
covered(rawPicker(plan), emptyPicker, emptyBounds.picker);

const exemplar = (id: string, text: string): DiagramExemplar => ({
  id, sourceKind: "synthesized", subject: "maths", question: null,
  depicts: text, figureKind: "geometry", family: null, archetype: null,
  document: { schemaVersion: "scene-document/v2", quantities: [], entities: [
    { id: "edge", kind: "segment", role: "edge", label: text },
  ], constructions: [] },
});
const catalogue = Array.from({ length: 500 }, (_, index) => exemplar(`synthesized:entry-${index}`,
  Array.from({ length: 16 }, (_, word) => `entry${index}word${word}अ\\\"`).join(" ")));
const packed = buildDiagramExampleCatalogue(catalogue, { question, plan });
assert(packed.omittedEntries > 0 && packed.estimatedTokens < 6000, "the test must reach real catalogue packing with multibyte entries");
const catalogueBounds = liveDiagramPromptInputBounds(catalogue);
covered(rawPicker(plan), buildLiveDiagramPickerBody(rawPicker(plan), question, catalogue), catalogueBounds.picker);
assert.deepEqual(liveDiagramPromptInputBounds([...catalogue].reverse()), catalogueBounds, "the advertised bound is independent of catalogue order");

const verbosePlan = { ...plan,
  lawIds: ["अक्षर\\\"".repeat(2000)],
  qualitativeClaims: [{ id: "scope", claim: "दिशा\\\"".repeat(2000), expected: "उत्तर\\\"".repeat(2000), relatedEntityHints: ["बिन्दु".repeat(2000)] }],
};
assert(validateTurnPlanV3(verbosePlan, question).plan, "the long summary must come from a genuinely accepted plan");
covered(rawPicker(verbosePlan), buildLiveDiagramPickerBody(rawPicker(verbosePlan), question, catalogue), catalogueBounds.picker);
for (const text of ["अ".repeat(2000), "😀".repeat(1000), "\u0000".repeat(2000)]) {
  const traceQuestion = readChatTraceHeaders(new Headers(withTurnTraceHeaders({}, { question: text }))).question!;
  assert.equal(traceQuestion.length, 2000, "the test must use the actual maximum trace-question transport");
  const invalidPlan = rawPicker(null);
  covered(invalidPlan, buildLiveDiagramPickerBody(invalidPlan, traceQuestion, catalogue), catalogueBounds.picker);
}

const sourceBody = JSON.stringify({ messages: [
  { role: "system", content: "Keep this exact contract." },
  { role: "user", content: "Plan this figure.\nअक्षर\\\"" },
  { role: "assistant", content: "Keep this earlier reply." },
] });
const examples = Array.from({ length: 5 }, (_, index) => exemplar(`synthesized:large-${index}`,
  "अ😀\\\"\n".repeat((index + 1) * 1600)));
const sceneBounds = liveDiagramPromptInputBounds(examples);
assert.equal(sceneBounds.scene.inputByteMultiplier, 1, "scene injection only appends to one existing message");
assert(sceneBounds.scene.addedInputBytes > 48_000, "large legal examples must not be capped by an assumed 48k allowance");
for (let a = 0; a < examples.length; a++) for (let b = a + 1; b < examples.length; b++) for (let c = b + 1; c < examples.length; c++) {
  for (const selected of [[a, b, c], [c, a, b]]) {
    const ids = selected.map(index => examples[index]!.id);
    const admitted = filterLiveDiagramExamples(examples, question, [...ids, "synthesized:unknown"]);
    assert.equal(admitted.length, 3, "the real resolver must supply the maximum three examples");
    const injected = injectLiveDiagramExamples(sourceBody, admitted);
    covered(sourceBody, injected, sceneBounds.scene);
    const output = JSON.parse(injected).messages as Array<{ role: string; content: string }>;
    assert.equal(output[0]!.content, "Keep this exact contract.");
    assert.equal(output[2]!.content, "Keep this earlier reply.");
    assert.equal((output[1]!.content.match(/EXAMPLE [123] \(/g) ?? []).length, 3);
  }
}
assert.equal(injectLiveDiagramExamples(sourceBody, []), sourceBody, "requests without examples keep their original bytes");
assert.equal(emptyBounds.scene.addedInputBytes, 0);
const one = exemplar("synthesized:one", "edge");
assert.equal(JSON.parse(injectLiveDiagramExamples(JSON.stringify({ messages: [{ role: "user", content: "Plan." }] }), [one])).messages[0].content,
  'Plan.\n\nWORKED SCENE EXAMPLES\nUse only their structural ideas; never copy quantities, labels, or facts.\n\nEXAMPLE 1 (synthesized:one)\nFigure: edge\nSCENE\n{"schemaVersion":"scene-document/v2","quantities":[],"entities":[{"id":"edge","kind":"segment","role":"edge","label":"edge"}],"constructions":[]}',
  "sharing scene formatting with its bound leaves the exact injected prompt unchanged");

const liveBounds = liveDiagramPromptInputBounds();
const livePicker = buildLiveDiagramPickerBody(rawPicker(plan), question);
covered(rawPicker(plan), livePicker, liveBounds.picker);
assert(liveBounds.scene.addedInputBytes > 0 && Number.isSafeInteger(liveBounds.scene.addedInputBytes), "the checked library advertises a finite scene allowance");
console.log(`live diagram input bounds: ${checked} actual prepared-message cases PASS; no provider requests`);
