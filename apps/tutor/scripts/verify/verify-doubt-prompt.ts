/**
 * The doubt prompt, read the way the model reads it.
 *
 * A review of the first doubt prompt (11 Sep 2026) found rules that still
 * pulled a doubt back into a lesson: the base prompt's "every step writes a
 * row", its twelve and sixteen step floors, familiarity addons that say "use
 * all of it", a figure addon that says read the whole figure before any
 * calculation, row ids quoted as if they outlived a page turn, a second y grid,
 * and a code board where the model could not see the code it was asked about.
 * Each decision taken on those findings is pinned here against prompts built
 * for real boards, with the figure addon written by the same presentation the
 * live board uses.
 */
import type { RenderScene, SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";
import { WORK_ZONE } from "@heytutor/drawing";
import {
  FAMILIARITY_ADDONS,
  FAST_MODE_TEACHING_ADDON,
  TUTOR_SYSTEM_PROMPT,
} from "@heytutor/tutor-core";
import { BOARD_WORK_ROWS_PER_PAGE } from "../../features/tutor-session/constants";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  buildDoubtTeachingPrompt,
  figureAddonForDoubt,
  type DoubtTeachingPromptInput,
  type TurnTeachingPrompt,
} from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import {
  buildMarkedDoubtPrompt,
  type BoardMark,
} from "../../features/tutor-session/lib/board/boardMarking";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const LESSON = "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.";
const ROWS = [
  { text: "Given: f = 15 cm, u = 20 cm" },
  { workId: "w1", text: "v = ?" },
  { workId: "w2", text: "1/f = 1/v + 1/u" },
  { workId: "w3", text: "1/v =" },
];
/** Where the slot finder would put the next row. The prompt must not quote it. */
const FINDER_Y = 336;
const plan = {
  visualRequirement: "required",
  givens: [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given", sourceText: "f = 15 cm" },
    { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given", sourceText: "20 cm" },
  ],
  unknowns: [{ id: "v", symbol: "v", unit: "cm" }],
  derived: [],
  qualitativeClaims: [],
  lawIds: ["mirror_equation"],
  assumptions: [],
} as unknown as TurnPlanV3;

// A real figure addon, written by the presentation the live board uses, so the
// lines the doubt drops are the lines a lesson is actually given.
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "test" },
  source: { question: "test" },
  quantities: [],
  entities: [
    { id: "a", kind: "point", role: "start", label: "A" },
    { id: "ab", kind: "segment", role: "edge" },
  ],
  constructions: [],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["a", "ab"],
  revealGroups: [
    { id: "setup", entityIds: ["a"], dependsOn: [], narrationCue: "show A" },
    { id: "edge", entityIds: ["ab"], dependsOn: ["setup"], narrationCue: "join the edge" },
  ],
  teachingTimeline: [
    { id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "mark A" },
    { id: "reveal_edge", action: "reveal", targetId: "edge", dependsOn: ["reveal_setup"], narrationIntent: "draw AB" },
  ],
};
const renderScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: [
    { id: "p_a", entityId: "a", groupId: "setup", kind: "point", points: [{ x: 450, y: 300 }], text: "A" },
    { id: "p_label_a", entityId: "a", groupId: "setup", kind: "label", points: [{ x: 450, y: 300 }], text: "A", labelPlacement: "above" },
    { id: "p_ab", entityId: "ab", groupId: "edge", kind: "line", points: [{ x: 450, y: 300 }, { x: 700, y: 300 }] },
    { id: "p_ab_label", entityId: "ab", groupId: "edge", kind: "label", points: [{ x: 700, y: 400 }], text: "AB", labelPlacement: "absolute" },
  ],
  revealGroups: document.revealGroups,
  timeline: document.teachingTimeline,
  entityBounds: {
    a: { x: 445, y: 295, width: 10, height: 10 },
    ab: { x: 450, y: 300, width: 250, height: 0 },
  },
};
const figureAddon =
  buildVerifiedDiagramPresentation(document, renderScene, { figureFamily: "ray_diagram" }).diagram.promptAddon ?? "";
const codeLessonAddon =
  buildVerifiedDiagramPresentation(document, renderScene, { layout: "code_lesson" }).diagram.promptAddon ?? "";

/** The lesson flow the figure addon carries, which a doubt must not be given. */
const LESSON_FLOW = [
  "is being explained as it is revealed",
  "Read the figure to the student before you calculate with it",
  "do not speak a step with the marker parked",
  "This figure is what it is",
  "[ANNOTATE:entity_id] with one of",
];
for (const line of LESSON_FLOW) {
  assert(
    figureAddon.includes(line),
    `the presentation no longer writes "${line}". Update LESSON_FLOW and the doubt's filter together; do not delete the check`,
  );
}

function input(overrides: Partial<DoubtTeachingPromptInput>): DoubtTeachingPromptInput {
  return {
    lessonQuestion: LESSON,
    boardRows: ROWS,
    rowsLeftOnPage: 3,
    nextRowY: FINDER_Y,
    diagramPromptAddon: null,
    codePanelShowing: false,
    turnPlan: plan,
    solverProjection: null,
    familiarity: "normal",
    fastMode: false,
    ...overrides,
  };
}

const DOUBT_HEADER = "THIS TURN ANSWERS A DOUBT ON THE SAME BOARD";
function doubtBlockOf(prompt: TurnTeachingPrompt, label: string): string {
  const at = prompt.runtimeAddon.indexOf(DOUBT_HEADER);
  assert(at >= 0, `${label}: the doubt block header "${DOUBT_HEADER}" is gone`);
  return prompt.runtimeAddon.slice(at);
}

const CODE = "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):";
const variants = {
  figure: buildDoubtTeachingPrompt(input({ diagramPromptAddon: figureAddon, fastMode: true, familiarity: "new" })),
  full: buildDoubtTeachingPrompt(input({ rowsLeftOnPage: 0, nextRowY: null, familiarity: "revision" })),
  noFigure: buildDoubtTeachingPrompt(input({})),
  codePanel: buildDoubtTeachingPrompt(
    input({ codePanelShowing: true, codeLessonBoard: true, codePanelText: CODE, diagramPromptAddon: codeLessonAddon }),
  ),
  codeHidden: buildDoubtTeachingPrompt(input({ codeLessonBoard: true, codePanelShowing: false })),
};
const notebook = { figure: variants.figure, full: variants.full, noFigure: variants.noFigure, codeHidden: variants.codeHidden };

// 1. The first step points and writes nothing; row ids die with the page.
for (const [label, prompt] of Object.entries(notebook)) {
  const block = doubtBlockOf(prompt, label);
  assert(block.includes("Your first step points and writes nothing"), `${label}: the first step must point, not write`);
  assert(block.includes("[EMPHASIZE:wN]"), `${label}: the pointing form uses a placeholder id`);
  assert(block.includes("old ids name new rows"), `${label}: a row id must not be trusted after the page turns`);
}
for (const [label, prompt] of Object.entries(variants)) {
  assert(!/\[EMPHASIZE:w\d/.test(doubtBlockOf(prompt, label)), `${label}: a literal row id in a rule reads as the row to box`);
}

// 2. The base prompt's lesson rules are named as replaced, and room is a preference.
for (const [label, prompt] of Object.entries(variants)) {
  const block = doubtBlockOf(prompt, label);
  assert(block.includes("the rule that every step writes a board line"), `${label}: a pointing step would break "every step writes"`);
  assert(block.includes("a relation already on this page is pointed at, not rewritten"), `${label}: an existing relation must not be rewritten`);
}
assert(
  doubtBlockOf(variants.figure, "figure").includes("Fit an ordinary doubt in that room") &&
    doubtBlockOf(variants.figure, "figure").includes("keep writing past the bottom"),
  "an ordinary doubt fits the room, and a longer one may still turn the page",
);

// 3. A doubt's own length, and no lesson-length addons.
for (const [label, prompt] of Object.entries(variants)) {
  assert(prompt.runtimeAddon.includes("LESSON LENGTH FOR THIS DOUBT"), `${label}: without it the base prompt's 12 and 16 step floors apply`);
  assert(!prompt.runtimeAddon.includes("LESSON LENGTH FOR THIS QUESTION"), `${label}: a lesson budget would stretch the doubt`);
}
assert(!variants.figure.runtimeAddon.includes(FAST_MODE_TEACHING_ADDON), "fast mode's keep every rung is a lesson rule");
assert(!variants.figure.runtimeAddon.includes(FAMILIARITY_ADDONS.new), "the New addon says use all of it");
assert(variants.figure.runtimeAddon.includes("define each term in plain words"), "a new student still gets terms defined");
assert(!variants.full.runtimeAddon.includes(FAMILIARITY_ADDONS.revision), "the Revision addon is written for a lesson");
assert(variants.full.runtimeAddon.includes("state the law and move quickly"), "a revising student gets the short version");
assert(
  !variants.noFigure.runtimeAddon.includes("define each term") && !variants.noFigure.runtimeAddon.includes("move quickly"),
  "normal familiarity adds nothing",
);

// 4. Going through the whole thing has a path that neither rewrites nor stalls.
for (const [label, prompt] of Object.entries(notebook)) {
  const block = doubtBlockOf(prompt, label);
  assert(
    block.includes("boxing every row is right here") && block.includes("write only the lines that are missing"),
    `${label}: "go through the whole thing" must walk the rows already written`,
  );
  assert(block.includes("write it again under the last row"), `${label}: "start over" writes under the last row`);
}

// 5. The one question, and examples that never pose as givens.
for (const [label, prompt] of Object.entries(variants)) {
  const block = doubtBlockOf(prompt, label);
  assert(
    block.includes("If the mark landed on an empty area and nothing was typed, ask one short question"),
    `${label}: an empty mark with no words needs one question, not a guess`,
  );
  assert(block.includes("\"for example\" and never written as givens"), `${label}: an example must not pose as a given`);
  assert(!/tiny example with numbers|small concrete example/.test(block), `${label}: an invented example contradicts the base prompt`);
}

// 6. Code boards.
{
  const block = doubtBlockOf(variants.codePanel, "codePanel");
  assert(block.includes(CODE), "a doubt beside the code panel must see the code it is asked about");
  assert(block.includes("On this board a step with no tag is correct"), "speech only steps must be allowed where nothing may be written");
  assert(block.includes("Never [WRITE], never [TYPE] and never [FOCUS]"), "nothing is written into the editor");
  assert(variants.codePanel.systemPrompt.startsWith(TUTOR_SYSTEM_PROMPT), "the doubt keeps the teaching base prompt");
  assert(!variants.codePanel.runtimeAddon.includes("This turn overrides the FOCUS instructions above"), "the code lesson frame contract is not handed over");
  assert(!block.includes("w2: 1/f"), "there is no notebook to list beside the panel");
  assert(!variants.codePanel.runtimeAddon.includes("TURN PLAN V3"), "a code lesson's fallback plan invites talk about givens");
}
{
  const block = doubtBlockOf(variants.codeHidden, "codeHidden");
  assert(block.includes("w2: 1/f = 1/v + 1/u"), "with the panel hidden the notebook rows are listed");
  assert(block.includes("Do not point at it with [FOCUS]"), "the worked example is named in words, not pointed at");
  assert(!block.includes("No figure is on this board"), "the worked example is on the board, so it is not declared absent");
  assert(!variants.codeHidden.runtimeAddon.includes("TURN PLAN V3"), "a code lesson's fallback plan is not printed");
}

// 7. The figure addon keeps the parts and loses the lesson flow.
{
  const addon = variants.figure.runtimeAddon;
  for (const line of LESSON_FLOW) {
    assert(!addon.includes(line), `the doubt must not be told "${line}"`);
  }
  assert(addon.includes("already drawn on this page"), "the figure is introduced as already drawn");
  assert(addon.includes("Parts the student can read"), "the parts a doubt may point at survive");
  const codeFiltered = figureAddonForDoubt(codeLessonAddon);
  for (const line of ["This turn overrides the FOCUS instructions above", "Always write it as [FOCUS:frame_id", "The left side of the board is the code editor"]) {
    assert(codeLessonAddon.includes(line), `the code lesson addon no longer writes "${line}"; update the filter and this check together`);
    assert(!codeFiltered.includes(line), `the filtered addon must drop "${line}"`);
  }
}

// 8. One y grid, and the figure only stays where there is one.
{
  const expected = WORK_ZONE.topY + (BOARD_WORK_ROWS_PER_PAGE - 3) * WORK_ZONE.lineHeight;
  const block = doubtBlockOf(variants.figure, "figure");
  assert(block.includes(`your first row is y = ${expected}`), `the next row is quoted on the base grid (${expected})`);
  assert(!block.includes(`y = ${FINDER_Y}`), "the slot finder's coordinate is a second grid");
  assert(doubtBlockOf(variants.full, "full").includes(`at y = ${WORK_ZONE.topY}`), "a fresh page starts on the grid's first row");
  assert(block.includes("and the figure stays"), "a page turn keeps a drawn figure");
  for (const label of ["full", "noFigure", "codeHidden"] as const) {
    assert(!doubtBlockOf(variants[label], label).includes("the figure stays"), `${label}: no figure, so none can stay`);
  }
}

// 9 and the ANNOTATE rule: every variant.
for (const [label, prompt] of Object.entries(variants)) {
  const block = doubtBlockOf(prompt, label);
  assert(block.includes("Never use [ANNOTATE] in this turn"), `${label}: a doubt is saved text only, and ANNOTATE fails that save`);
  assert(block.includes("The lesson continues by itself after you stop"), `${label}: a doubt must not end the lecture`);
  assert(!/[—–]| - /.test(block), `${label}: the doubt block carries dash punctuation`);
}

// The marked prompt: an empty mark with no words.
{
  const rect = { x: 500, y: 560, width: 80, height: 40 };
  const empty: BoardMark = {
    id: "m1",
    gesture: "circle",
    points: [],
    bounds: rect,
    target: { kind: "region", text: "the board", rect },
    targets: [{ kind: "region", text: "the board", rect }],
  };
  const marked = buildMarkedDoubtPrompt([empty], "", LESSON);
  assert(marked.includes("ask what it is about before assuming"), "an empty mark asks before assuming");
  assert(marked.includes("nothing written is under that mark"), "the prompt says the mark is on empty paper");
  assert(marked.includes("do not re-teach the whole lesson"), "a marked doubt is a re-teach of one part");
  assert(marked.includes("\"for example\" and never written as givens"), "a marked doubt's example is not a given");
  assert(!/[—–]/.test(marked), "the student's words carry no dash punctuation");
  assert(marked.includes("ray diagram\".") && !marked.includes("diagram.\"."), "a stem ending on a full stop is not quoted as `.\".`");
}

console.log("doubt prompt verification passed");
