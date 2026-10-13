/**
 * The scene planner prompt asks for complete figures and no longer pushes
 * towards minimal ones.
 *
 * - The COMPLETE FIGURE block is in every initial request (a scoped prompt
 *   with full contracts, the universal catalog with compact contracts, both
 *   live strategies) and in the completeness request. The block is generic:
 *   no topic words. A repair of an invalid candidate carries the short keep
 *   rule instead, because the worst-case repair has no room for the block.
 * - The wording that asked for the smallest scene is gone from the prompt,
 *   the live strategies and the repair text.
 * - Authority stays: the free_body contract still forbids an invented normal,
 *   friction or weight, and only adds that named forces are supplied; derived
 *   answers are still not placed initially.
 * - Size budgets: the universal initial request stays under 24,500 characters
 *   and the universal repair request under 27,000 (the measure used by
 *   verify-reusable-scene-capabilities).
 */
import assert from "node:assert/strict";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import {
  buildSceneDocumentPlannerPrompt,
  SCENE_COMPLETE_FIGURE_RULES,
  SCENE_CONSTRUCTION_INPUT_CONTRACTS,
  SCENE_DOCUMENT_PLANNER_PROMPT,
  selectConstructionInputContracts,
} from "../../src/planners/scenePlannerV2Prompt";
import {
  completeSceneDocument,
  planSceneDocument,
  planSceneDocumentWithRepair,
  repairSceneDocument,
} from "../../src/planners/scenePlannerV2";

const BLOCK_HEAD = "COMPLETE FIGURE\n";
const BLOCK_LINES = [
  "- Show every object,case,state and point the question names.",
  "- Mark every given or asked angle:",
  "- Draw the helpers the method relies on even if unasked:",
  "- Each directed quantity the question names or gives is a labelled vector at its point of action;",
  "- Name both axes. Label each given line or curve with its equation",
  "- Before returning, map every noun,value and angle in the question to an entity or label.",
];
const MINIMAL_WORDING = [
  /smallest sufficient/i,
  /minimal construction graph/i,
  /only when the question explicitly asks/i,
  /unnecessary entities/i,
  /weakly justified/i,
  /omit all optional helpers/i,
  /add only the geometry needed/i,
  /fewest deterministic operators/i,
];

function completeFigureBlock(text: string): string {
  const start = text.indexOf(BLOCK_HEAD);
  assert(start >= 0, "the COMPLETE FIGURE block is present");
  const block = text.slice(start).split("\n").slice(0, BLOCK_LINES.length + 1);
  return block.join("\n");
}
function assertComplete(text: string, where: string): void {
  const block = completeFigureBlock(text);
  BLOCK_LINES.forEach((line, index) => assert(block.split("\n")[index + 1]!.startsWith(line), `${where}: block line ${index + 1} is "${line}"`));
}
function assertNotMinimal(text: string, where: string): void {
  for (const pattern of MINIMAL_WORDING) assert(!pattern.test(text), `${where}: the minimal-scene wording ${pattern} is gone`);
}

// 1. The block itself: generic, about 710 characters.
const block = completeFigureBlock(SCENE_COMPLETE_FIGURE_RULES);
assert.equal(block, SCENE_COMPLETE_FIGURE_RULES, "the block is exactly the six rules");
assert(block.length >= 600 && block.length <= 760, `the block is about 710 characters: ${block.length}`);
const TOPIC_WORDS = /\b(?:lens|mirror|circuit|resistor|incline|friction|projectile|triangle|parabola|circle|charge|magnet|wave|pendulum|spring|capacitor)\w*\b/i;
assert(!TOPIC_WORDS.test(block), `the block names no topic: ${block.match(TOPIC_WORDS)?.[0]}`);
assertNotMinimal(SCENE_DOCUMENT_PLANNER_PROMPT, "planner prompt");
assertNotMinimal(SCENE_CONSTRUCTION_INPUT_CONTRACTS, "operator contracts");

// 2. Authority lines that stay: derived answers deferred, and no invented force.
assert(SCENE_DOCUMENT_PLANNER_PROMPT.includes("Do not place derived scalar answers initially"),
  "the setup-not-answer-sheet rule is unchanged");
const freeBody = SCENE_CONSTRUCTION_INPUT_CONTRACTS.split("\n").find((line) => line.startsWith("- free_body:"));
assert(freeBody, "the free_body contract exists");
assert(freeBody.includes("Supply each force the question names; do not invent any other normal, friction, or weight."),
  `free_body still forbids an invented normal, friction or weight and supplies named forces: ${freeBody}`);
const normalAt = SCENE_CONSTRUCTION_INPUT_CONTRACTS.split("\n").find((line) => line.startsWith("- normal_at outputs solver-only geometry."));
assert(normalAt?.includes("construct a separate visible normal whenever an angle is measured from it"),
  "a visible normal is drawn whenever an angle is measured from it");
assert(selectConstructionInputContracts(["normal_at"]).includes("whenever an angle is measured from it"),
  "the normal_at line still belongs to normal_at when contracts are scoped");
const angleMark = SCENE_CONSTRUCTION_INPUT_CONTRACTS.split("\n").find((line) => line.startsWith("- angle_mark:"));
assert(angleMark?.includes("Bind a given or measured value") && angleMark.includes("do not invent a degree label"),
  "a given angle shows its value through a binding, and no degree label is invented");

// 3. Initial prompts: scoped with full contracts, and the universal compact catalog.
const scopedQuestion = "Draw the free body diagram of the block on the incline with its weight, normal reaction and friction.";
const scopedCapabilities = inferSceneCapabilities(scopedQuestion);
const scoped = buildSceneDocumentPlannerPrompt(scopedQuestion, scopedCapabilities);
assertComplete(scoped, "scoped initial prompt");
assert(scoped.indexOf("LABELS AND REVEAL") < scoped.indexOf(BLOCK_HEAD) && scoped.indexOf(BLOCK_HEAD) < scoped.indexOf("AVAILABLE CONSTRUCTION OPERATORS"),
  "the block follows the label rules and precedes the operator catalog");
assertNotMinimal(scoped, "scoped initial prompt");
const unknownQuestion = "Draw the supplied conditional outcomes and mark every joint leaf probability.";
const unknownCapabilities = inferSceneCapabilities(unknownQuestion);
const universal = buildSceneDocumentPlannerPrompt(unknownQuestion, unknownCapabilities);
assertComplete(universal, "universal compact prompt");
assertNotMinimal(universal, "universal compact prompt");
const withExamples = buildSceneDocumentPlannerPrompt(unknownQuestion, {
  ...unknownCapabilities,
  workedExamples: [{ id: "ex-1", sourceKind: "curated", question: "An invented example.", depicts: "a figure", document: { entities: [] } }],
} as Parameters<typeof buildSceneDocumentPlannerPrompt>[1]);
assert(withExamples.includes("show every object, value, angle and helper it names even where an example omits one"),
  "worked examples never set a lower bar than the current question");

// 4. Every live request: both initial strategies, both repair strategies and the completeness request.
const originalFetch = globalThis.fetch;
const requests: Array<{ phase: string; content: string; size: number }> = [];
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
  requests.push({
    phase: new Headers(init?.headers).get("x-scene-planner-phase") ?? "",
    content: body.messages.map((message) => message.content).join("\n"),
    size: body.messages.reduce((total, message) => total + message.content.length, 0),
  });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }), { status: 200 });
};
try {
  const options = { ...unknownCapabilities, proxyUrl: "http://planner.test", timeoutMs: 2_000 };
  await planSceneDocumentWithRepair(unknownQuestion,
    () => ({ valid: false, errors: [{ code: "assertion_failed", message: "stub", severity: "fatal" as const }] }), options);
  const live = requests.splice(0);
  assert.equal(live.filter((request) => request.phase === "plan").length, 2, "both live initial strategies are sent");
  assert(live.filter((request) => request.phase === "repair").length >= 2, "the live repair strategies are sent");
  for (const request of live) {
    if (request.phase === "plan") assertComplete(request.content, "live plan request");
    assertNotMinimal(request.content, `live ${request.phase} request`);
  }
  assert(live.some((request) => request.content.includes("SYNTHESIS STRATEGY\nBuild the complete teaching figure")),
    "the first live strategy builds the complete teaching figure");
  assert(live.some((request) => request.phase === "repair" && request.content.includes("keep every named object, given label and angle mark")),
    "the repair text keeps named objects, given labels and angle marks");

  await completeSceneDocument(unknownQuestion, { schemaVersion: "scene-document/v2", entities: [], constructions: [] },
    [{ text: "label the given p = 0.3" }], options);
  const completion = requests.splice(0);
  assert.equal(completion[0]?.phase, "complete");
  assertComplete(completion[0]!.content, "completeness request");

  // 5. Size budgets, measured exactly as verify-reusable-scene-capabilities does.
  assert(await planSceneDocument(unknownQuestion, options, "Build the smallest sufficient scene and preserve every exact conditional outcome."));
  assert(await repairSceneDocument(unknownQuestion, {
    schemaVersion: "scene-document/v2", constructions: [{ id: "tree", operator: "probability_tree", outputs: ["root", "a", "b", "branch_a", "branch_b", "joint_a", "joint_b"] }],
  }, [{ code: "invalid_probability_output", message: "Rebuild the ordered node/branch/leaf outputs from explicit conditionals.", severity: "fatal" }], options));
  const [initial, repair] = requests;
  assert(initial && repair);
  assert(initial.size <= 24_500, `universal initial request exceeds its budget: ${initial.size}`);
  assert(repair.size <= 27_000, `universal repair request exceeds its budget: ${repair.size}`);
  console.log(`verify-completeness-prompt-lines: block ${block.length} chars; universal initial ${initial.size} of 24,500; universal repair ${repair.size} of 27,000; scoped ${scoped.length}`);
} finally {
  globalThis.fetch = originalFetch;
}
