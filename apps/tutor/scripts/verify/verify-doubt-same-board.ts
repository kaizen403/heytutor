/**
 * A doubt is answered on the page it was asked on.
 *
 * The owner's report (11 Sep 2026): circling a line and pressing Ask Doubt
 * restarted the whole board and re-taught the question from its givens. The
 * doubt ran as a brand new question, so `beginBoardEpoch` wiped the page, the
 * figure was dropped, the planner ran again, and the lesson opened a second
 * time. What should happen: the board stays, the tutor thinks over it, the
 * answer is written under what is already there, and a page only turns when
 * the column runs out.
 *
 * This gate holds the pure half of that (the room the doubt is told about is
 * the room the board will honour, the prompt describes the page as it stands,
 * the page decision matrix, what a doubt may draw) and pins the wiring that
 * keeps the page, with every source slice guarded at both ends.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WORK_ZONE,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
} from "@heytutor/drawing";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { getMockCodeLessonPlan, type CodeLessonPlan } from "@heytutor/tutor-core";
import type { RecordedSegmentPayload } from "../../lib/boards/boardsClient";
import {
  BOARD_WORK_ROWS_PER_PAGE,
  DIAGRAM_ZONE,
  TEXT_LAYOUT,
} from "../../features/tutor-session/constants";
import type { BoardLayoutState } from "../../features/tutor-session/types";
import {
  dropDiagramRects,
  findWorkTextSlot,
  registerBoardAnchor,
  withWorkRowIdentity,
  workColumnRoom,
  workColumnRows,
} from "../../features/tutor-session/lib/board/boardLayout";
import {
  buildMarkedDoubtPrompt,
  summarizeMarks,
  type BoardMark,
} from "../../features/tutor-session/lib/board/boardMarking";
import { doubtThinkingAnchor } from "../../features/tutor-session/lib/board/doubtAnchor";
import {
  DOUBT_INTERRUPT_HINT,
  buildDoubtPrompt,
  doubtTurnTitle,
  isDoubtPrompt,
} from "../../features/tutor-session/lib/input/askDoubt";
import {
  PARTIAL_TURN_NOTE,
  doubtPageRecord,
  doubtSegment,
  lessonPageRecord,
  pausedLessonFromLive,
  pausedLessonFromPage,
  partialTurnRawResponse,
  partialTurnScene,
  partialTurnSegments,
  planDoubtPage,
  reindexRecordedSegments,
  resumePageRecord,
  revealedCodeText,
  textOnlyTurnScene,
} from "../../features/tutor-session/lib/turn/doubtTurn";
import {
  buildDoubtTeachingPrompt,
  buildResumeTeachingPrompt,
  buildTurnTeachingPrompt,
  resumeLessonUserPrompt,
  type DoubtTeachingPromptInput,
} from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { boardContinuationOf } from "../../lib/boards/boardContinuation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ROW_WIDTH = 220;

/** Rows placed the way the live board places them: slot finder, then identity. */
function layoutWithRows(count: number, diagramActive: boolean): BoardLayoutState {
  const layout: BoardLayoutState = { rects: [], nextY: TEXT_LAYOUT.topY };
  for (let index = 0; index < count; index += 1) {
    const slot = findWorkTextSlot({
      layout,
      requestedX: TEXT_LAYOUT.marginX,
      requestedY: 0,
      width: ROW_WIDTH,
      height: TEXT_LAYOUT.textHeight,
      diagramActive,
      sequential: true,
      runtimeOwnsX: true,
    });
    assert(slot, `row ${index + 1} of ${count} should fit on one page`);
    registerBoardAnchor(
      layout,
      withWorkRowIdentity(layout, {
        x: slot.x,
        y: slot.y,
        width: ROW_WIDTH,
        height: TEXT_LAYOUT.textHeight,
        text: `row ${index + 1}`,
      }),
    );
    layout.nextY = Math.max(layout.nextY, slot.y + TEXT_LAYOUT.lineHeight);
  }
  return layout;
}

// ── The room a doubt is told about is the room the board honours ────────────
{
  for (let written = 0; written <= BOARD_WORK_ROWS_PER_PAGE; written += 1) {
    const room = workColumnRoom(layoutWithRows(written, true), true);
    assert(
      room.rowsLeft === BOARD_WORK_ROWS_PER_PAGE - written,
      `after ${written} rows the page has ${BOARD_WORK_ROWS_PER_PAGE - written} rows left, the doubt was told ${room.rowsLeft}`,
    );
    assert(
      (room.rowsLeft === 0) === (room.nextRowY === null),
      "a full page has no next row, and a page with room always names one",
    );
  }

  const three = layoutWithRows(3, true);
  const room = workColumnRoom(three, true);
  const actualNext = findWorkTextSlot({
    layout: three,
    requestedX: TEXT_LAYOUT.marginX,
    requestedY: 0,
    width: ROW_WIDTH,
    height: TEXT_LAYOUT.textHeight,
    diagramActive: true,
    sequential: true,
    runtimeOwnsX: true,
  });
  assert(
    actualNext && room.nextRowY === actualNext.y,
    "the next row the doubt is told about is the slot the board will write it in",
  );

  // A figure's labels sit right of the column; they must not eat its rows.
  const withFigure = layoutWithRows(3, true);
  registerBoardAnchor(withFigure, {
    x: DIAGRAM_ZONE.x + 40,
    y: TEXT_LAYOUT.workTopY,
    width: 80,
    height: 30,
    text: "F",
  });
  assert(
    workColumnRoom(withFigure, true).rowsLeft === BOARD_WORK_ROWS_PER_PAGE - 3,
    "figure labels do not cost the work column any rows",
  );

  const listed = layoutWithRows(3, true);
  registerBoardAnchor(listed, { x: TEXT_LAYOUT.marginX, y: 70, width: 200, height: 40, text: "  Heading  " });
  registerBoardAnchor(listed, { x: DIAGRAM_ZONE.x + 60, y: 200, width: 40, height: 30, text: "N" });
  const rows = workColumnRows(listed);
  assert(
    rows.map((row) => row.text).join("|") === "Heading|row 1|row 2|row 3",
    `the board rows are listed top to bottom, without figure labels: ${JSON.stringify(rows)}`,
  );
  assert(
    rows[0]!.workId === undefined && rows[1]!.workId === "w1" && rows[3]!.workId === "w3",
    "numbered rows carry the id the doubt can box them by; the heading has none",
  );

  dropDiagramRects(listed);
  assert(
    listed.rects.length === 4 && listed.rects.every((rect) => rect.x < DIAGRAM_ZONE.x),
    "an aborted figure forgets its anchors and keeps every row the student can still see",
  );
}

// ── The doubt prompt describes the page as it stands ────────────────────────
const LESSON = "A ball is thrown at 20 m/s at 30 degrees. Find the range.";
const plan = {
  visualRequirement: "preferred",
  givens: [{ id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given", sourceText: "20 m/s" }],
  unknowns: [{ id: "R", symbol: "R", unit: "m" }],
  derived: [],
  qualitativeClaims: [],
  lawIds: ["projectile_range"],
  assumptions: [],
} as unknown as TurnPlanV3;

function doubtInput(overrides: Partial<DoubtTeachingPromptInput> = {}): DoubtTeachingPromptInput {
  return {
    lessonQuestion: LESSON,
    boardRows: [
      { text: "Given: u = 20 m/s" },
      { workId: "w1", text: "R = ?" },
      { workId: "w2", text: "R = u^2 sin 2θ / g" },
    ],
    rowsLeftOnPage: 3,
    nextRowY: 336,
    diagramPromptAddon: null,
    codePanelShowing: false,
    turnPlan: plan,
    solverProjection: null,
    familiarity: "normal",
    fastMode: false,
    ...overrides,
  };
}

{
  const prompt = buildDoubtTeachingPrompt(doubtInput());
  assert(prompt.openingSegment === null, "a doubt does not open the lesson a second time");
  assert(prompt.givenSegments.length === 0, "a doubt does not write the given rows again");
  assert(
    prompt.systemPrompt.includes("THIS TURN ANSWERS A DOUBT ON THE SAME BOARD"),
    "the doubt turn must be told it is a doubt on this board",
  );
  assert(prompt.systemPrompt.includes(LESSON), "the doubt is told which lesson it stopped");
  assert(
    prompt.systemPrompt.includes("w2: R = u^2 sin 2θ / g") && prompt.systemPrompt.includes("Given: u = 20 m/s"),
    "the doubt sees every row on the page, with the id it can box it by",
  );
  // Quoted on the base prompt's own row grid, so the model reads one grid.
  const firstRowY = WORK_ZONE.topY + (BOARD_WORK_ROWS_PER_PAGE - 3) * WORK_ZONE.lineHeight;
  assert(
    prompt.systemPrompt.includes("room for 3 more rows") &&
      prompt.systemPrompt.includes(`y = ${firstRowY}`),
    "the doubt is told how much of the page is left and where its first row goes",
  );
  assert(
    prompt.systemPrompt.includes("restates, in symbols, the line the doubt is about"),
    "a doubt that runs onto a fresh page must bring the line in question with it",
  );
  assert(
    prompt.runtimeAddon.trimEnd().endsWith("the student chooses to pick the lecture back up or ask another doubt."),
    "the doubt block is the last word of the prompt",
  );
  assert(
    !prompt.systemPrompt.includes("LESSON LENGTH FOR THIS QUESTION"),
    "a lesson step budget would stretch a doubt back into a whole lesson",
  );
  assert(prompt.systemPrompt.includes("TURN PLAN V3"), "a doubt about a number is held to the lesson's plan");
  assert(prompt.systemPrompt.includes("Do not use [FOCUS]"), "a doubt on a board with no figure points at nothing");
  assert(
    prompt.continuationPrompt.startsWith("Continue the answer to the student's doubt"),
    "a cut off doubt continues the doubt, not the lesson",
  );

  const full = buildDoubtTeachingPrompt(doubtInput({ rowsLeftOnPage: 0, nextRowY: null }));
  assert(
    full.systemPrompt.includes("This page is full") &&
      full.systemPrompt.includes("Make that first row the line the doubt is about"),
    "on a full page the doubt turns it and opens the new page on the line in question",
  );

  const ADDON = "PARTS: \"u\" [FOCUS:v0]";
  const figure = buildDoubtTeachingPrompt(doubtInput({ diagramPromptAddon: ADDON }));
  assert(
    figure.systemPrompt.includes(ADDON) && figure.systemPrompt.includes("[FOCUS:entity_id] on that figure part"),
    "a doubt on a board with a drawn figure may point at the part in question",
  );
  assert(!figure.systemPrompt.includes("Do not use [FOCUS]"), "a drawn figure is not declared absent");

  const code = buildDoubtTeachingPrompt(doubtInput({ codePanelShowing: true, diagramPromptAddon: ADDON }));
  assert(
    code.systemPrompt.includes("Never [WRITE], never [TYPE] and never [FOCUS]"),
    "a doubt beside the code panel writes nothing into the editor",
  );
  assert(!code.systemPrompt.includes(ADDON), "a code lesson's frame contract is not handed to the doubt");
  assert(!code.systemPrompt.includes("w2: R ="), "there is no notebook to list beside the code panel");

  // The shared plan block must still read the same for a lesson.
  const lesson = buildTurnTeachingPrompt({
    question: LESSON,
    diagramPromptAddon: null,
    turnPlan: plan,
    solverProjection: null,
    codeLesson: null,
    isDsa: false,
    familiarity: "normal",
    fastMode: false,
  });
  assert(
    lesson.systemPrompt.includes("TURN PLAN V3") && lesson.systemPrompt.includes("LESSON LENGTH FOR THIS QUESTION"),
    "moving the plan block into a shared helper must not change a lesson's prompt",
  );
}

// ── What a doubt may assume about the page ──────────────────────────────────
{
  const base = { boardId: "b1", recordedSegmentCount: 0, storedTurnCount: 2, afterReplay: false, hasActiveFigure: true };

  const restored = planDoubtPage({ ...base, record: null });
  assert(
    restored.continuesBoard && !restored.savePartialTurn && restored.figureOnPage,
    "a restored board continues its last saved page and keeps the figure restore drew",
  );
  assert(!planDoubtPage({ ...base, record: null, storedTurnCount: 0 }).continuesBoard, "an empty board has no page to continue");

  const lessonUnsaved = lessonPageRecord("b1", LESSON);
  const withInk = planDoubtPage({ ...base, record: lessonUnsaved, recordedSegmentCount: 4 });
  assert(
    withInk.savePartialTurn && withInk.continuesBoard,
    "a stopped lesson's ink is saved first, so the doubt continues a saved page",
  );
  assert(!withInk.figureOnPage, "a figure that was planned but never drawn is not on the page");
  const noInk = planDoubtPage({ ...base, record: lessonUnsaved });
  assert(
    !noInk.savePartialTurn && !noInk.continuesBoard,
    "a lesson stopped before it wrote anything left a blank page, which the doubt opens itself",
  );

  const drawnUnsaved = lessonPageRecord("b1", LESSON);
  drawnUnsaved.figureDrawn = true;
  const drawn = planDoubtPage({ ...base, record: drawnUnsaved, recordedSegmentCount: 0 });
  assert(
    drawn.continuesBoard && drawn.savePartialTurn && drawn.figureOnPage,
    "a committed figure is a page to continue even if no segment has been recorded yet",
  );

  const lessonSaved = lessonPageRecord("b1", LESSON);
  lessonSaved.turn.saved = true;
  lessonSaved.figureDrawn = true;
  const saved = planDoubtPage({ ...base, record: lessonSaved, recordedSegmentCount: 9 });
  assert(
    saved.continuesBoard && !saved.savePartialTurn && saved.figureOnPage,
    "a finished lesson is saved already: the doubt continues it and never saves it twice",
  );

  const doubtOnPage = doubtPageRecord({
    boardId: "b1",
    lessonQuestion: LESSON,
    title: "Doubt: why sin 2θ",
    continuesBoard: true,
    figureDrawn: true,
    turnPlan: null,
    solverProjection: null,
  });
  assert(
    planDoubtPage({ ...base, record: doubtOnPage }).continuesBoard,
    "a doubt stopped before it wrote anything still leaves the saved page it was continuing",
  );

  assert(
    !planDoubtPage({ ...base, record: lessonSaved, afterReplay: true }).continuesBoard,
    "a doubt that stopped a replay is not on the last saved page, so it cannot claim to continue it",
  );
  const otherBoard = planDoubtPage({ ...base, record: lessonUnsaved, boardId: "b2", recordedSegmentCount: 4 });
  assert(
    !otherBoard.savePartialTurn && otherBoard.continuesBoard,
    "another board's record is ignored: no foreign ink is saved onto this board",
  );
}

// ── A paused lesson is what the doubt hands back to continue ────────────────
{
  const lesson = lessonPageRecord("b1", LESSON);
  lesson.figureDrawn = true;
  lesson.turn.scene = textOnlyTurnScene();
  const paused = pausedLessonFromPage(lesson, false);
  assert(
    paused?.lessonQuestion === LESSON &&
      paused.boardId === "b1" &&
      paused.figureDrawn &&
      paused.scene === lesson.turn.scene,
    "a lesson page snapshots the figure and scene the resume will keep",
  );
  assert(pausedLessonFromPage(null, false) === null, "no page, nothing to resume");
  const early = pausedLessonFromLive({
    record: null,
    boardId: "b1",
    lessonQuestion: LESSON,
    codeLesson: true,
    figureDrawn: true,
  });
  assert(
    early?.lessonQuestion === LESSON &&
      early.boardId === "b1" &&
      early.codeLesson &&
      early.figureDrawn &&
      early.scene === null,
    "a doubt asked before the page record lands still snapshots the live lesson",
  );
  assert(
    pausedLessonFromLive({
      record: null,
      boardId: "b1",
      lessonQuestion: "  ",
      codeLesson: false,
      figureDrawn: false,
    }) === null,
    "no live question, nothing to resume",
  );

  const doubtPage = doubtPageRecord({
    boardId: "b1",
    lessonQuestion: LESSON,
    title: "Doubt: why",
    continuesBoard: true,
    figureDrawn: true,
    turnPlan: null,
    solverProjection: null,
  });
  const fromDoubt = pausedLessonFromPage(doubtPage, false);
  assert(
    fromDoubt?.scene === null && fromDoubt.lessonQuestion === LESSON,
    "a doubt's text-only page must not pose as the lesson's scene",
  );

  const resumed = resumePageRecord({
    boardId: "b1",
    lessonQuestion: LESSON,
    figureDrawn: true,
    turnPlan: null,
    solverProjection: null,
    scene: textOnlyTurnScene(),
  });
  assert(
    resumed.turn.kind === "lesson" && resumed.turn.continuesBoard && resumed.turn.question === LESSON,
    "the rest of the lesson is saved onto the same page, under the original question",
  );

  const resumePrompt = buildResumeTeachingPrompt(doubtInput());
  assert(resumePrompt.openingSegment === null, "a resume does not open the lesson a second time");
  assert(resumePrompt.givenSegments.length === 0, "a resume does not write the given rows again");
  assert(
    resumePrompt.systemPrompt.includes("THIS TURN CONTINUES THE PAUSED LESSON"),
    "the resume turn must be told it is continuing, not starting",
  );
  assert(
    resumePrompt.systemPrompt.includes("The doubt has been answered"),
    "the resume must know the doubt is already done",
  );
  assert(
    !resumePrompt.systemPrompt.includes("LESSON LENGTH FOR THIS QUESTION"),
    "a full lesson budget would restart the derivation",
  );
  assert(
    resumeLessonUserPrompt().includes("continue") &&
      resumeLessonUserPrompt().includes("Pick up the original lesson") &&
      resumeLessonUserPrompt().includes("teach it to the end"),
    "the resume user prompt must not be the original question",
  );
  assert(
    resumePrompt.systemPrompt.includes("The original question is still the question of this lesson"),
    "a resume must keep teaching the question that started the lecture",
  );
  assert(
    resumePrompt.systemPrompt.includes("Finish the original question completely"),
    "a resume must not be a two-step coda; it finishes the lecture",
  );

  const codePlan = getMockCodeLessonPlan("two sum with a hash map");
  const codeResume = buildResumeTeachingPrompt({
    ...doubtInput(),
    lessonQuestion: "Given nums and target, return the two indices that add to target.",
    codePanelShowing: true,
    codeLessonBoard: true,
    codeLesson: codePlan,
    codeLessonFrames: [
      { id: "f1", caption: "start", narrationIntent: "the input" },
      { id: "f2", caption: "next", narrationIntent: "the next move" },
    ],
    alreadyRevealedBlockIds: codePlan.sections[0] ? [codePlan.sections[0].blocks[0]!.id] : [],
    framesAlreadyShown: 1,
  });
  assert(
    codeResume.systemPrompt.includes("REMAINING STEPS of the original lesson"),
    "a DSA resume lists every leftover beat so the lecture can finish",
  );
  assert(
    !codeResume.systemPrompt.includes("what the question is asking, in plain words"),
    "a DSA resume must not restart from the opening",
  );
  assert(
    codeResume.systemPrompt.includes("complexity close"),
    "a DSA resume is told to finish on complexity, the way the lecture ends",
  );
}

// ── What a stopped turn is saved as ─────────────────────────────────────────
{
  const record = lessonPageRecord("b1", LESSON);
  record.turn.scene = {
    sceneDocument: { planned: true },
    sceneEngineVersion: "engine",
    validationReport: { valid: true },
    visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      turnPlan: { id: "plan" },
      codeLesson: { id: "code" },
      candidates: [{ id: "c1" }],
    },
  };
  const undrawn = partialTurnScene(record);
  const artifacts = undrawn.sceneArtifacts as Record<string, unknown>;
  assert(
    undrawn.visualStatus === "text_only" && undrawn.sceneDocument === null,
    "a figure the student never saw is not saved, or replay would draw it",
  );
  assert(
    artifacts.turnPlan !== undefined && artifacts.codeLesson !== undefined && artifacts.candidates === undefined,
    "the plan and the code lesson survive; the unseen scene candidates do not",
  );
  record.figureDrawn = true;
  assert(partialTurnScene(record) === record.turn.scene, "a drawn figure is saved as the lesson's scene");

  const doubt = doubtPageRecord({
    boardId: "b1",
    lessonQuestion: LESSON,
    title: "Doubt: why",
    continuesBoard: true,
    figureDrawn: true,
    turnPlan: null,
    solverProjection: null,
  });
  assert(
    boardContinuationOf(partialTurnScene(doubt).sceneArtifacts)?.lessonQuestion === LESSON,
    "a stopped doubt is saved onto the lesson's page too",
  );

  assert(partialTurnRawResponse([{ narration: " so R " }, { narration: "" }, { narration: "equals" }]) === "so R equals", "the saved text is what was said, in order");
  assert(partialTurnRawResponse([{ narration: "  " }]) === PARTIAL_TURN_NOTE, "a stopped turn that said nothing still saves some text");
  const reindexed = reindexRecordedSegments([
    { orderIndex: 4, narration: "a", spokenText: "a", command: null, audioBytes: null, durationMs: null, timings: null },
    { orderIndex: 9, narration: "b", spokenText: "b", command: null, audioBytes: null, durationMs: null, timings: null },
  ]);
  assert(reindexed.map((segment) => segment.orderIndex).join(",") === "0,1", "a turn saved without its CLEAR still has dense order indexes");
}

// ── What a doubt may draw ───────────────────────────────────────────────────
{
  const command = (type: DrawCommand["type"], text?: string): DrawCommand => ({
    type,
    params: type === "WRITE" ? [90, 336] : [],
    ...(text ? { text } : {}),
    charPosition: 0,
    narrationBefore: "",
  });
  const segment: TutorSegment = {
    narration: "so two theta is sixty degrees",
    command: command("WRITE", "2θ = 60°"),
    commands: [command("WRITE", "2θ = 60°"), command("EMPHASIZE", "last"), command("TYPE"), command("FRAME"), command("POINT", "cell_0")],
  };
  const onNotebook = doubtSegment(segment, { codePanelShowing: false });
  assert(
    onNotebook && (onNotebook.commands ?? [onNotebook.command]).map((c) => c?.type).join(",") === "WRITE,EMPHASIZE",
    "a doubt keeps its rows and boxes and drops code lesson steps it does not conduct",
  );
  const besideCode = doubtSegment(segment, { codePanelShowing: true });
  assert(
    besideCode && besideCode.command === null && besideCode.commands === undefined && besideCode.narration === segment.narration,
    "beside the code panel a doubt keeps its words and writes nothing",
  );
  assert(
    doubtSegment({ narration: "  ", command: command("TYPE"), commands: undefined }, { codePanelShowing: false }) === null,
    "a segment left with nothing to say or draw is dropped",
  );
  assert(doubtSegment(segment.commands![0] ? { narration: "x", command: command("WRITE", "x") } : segment, { codePanelShowing: false })?.command?.type === "WRITE", "an allowed segment passes through untouched");
}

// ── Titles, prompts, anchor, copy ───────────────────────────────────────────
{
  assert(doubtTurnTitle("  why is it  negative ") === "Doubt: why is it negative", "a typed doubt is saved under its own words");
  assert(doubtTurnTitle("", 'circled "R = ?"') === 'Doubt: circled "R = ?"', "a marked doubt is saved under what was marked");
  assert(doubtTurnTitle("x".repeat(400)).length <= 160, "a doubt title stays short enough for a list");
  assert(isDoubtPrompt(buildDoubtPrompt("why", LESSON)) && isDoubtPrompt(buildDoubtPrompt("why")), "both plain doubt prompts are recognised on retry");
  assert(!isDoubtPrompt("Find the range of the projectile."), "a question is not mistaken for a doubt");

  const rect = { x: TEXT_LAYOUT.marginX, y: 240, width: 200, height: 40 };
  const mark: BoardMark = {
    id: "m1",
    gesture: "circle",
    points: [],
    bounds: { x: 80, y: 230, width: 230, height: 60 },
    target: { kind: "work", text: "R = ?", rect, workId: "w1" },
    targets: [{ kind: "work", text: "R = ?", rect, workId: "w1" }],
  };
  const marked = buildMarkedDoubtPrompt([mark], "", LESSON);
  assert(isDoubtPrompt(marked), "a marked doubt prompt is recognised on retry");
  assert(marked.includes('"R = ?" (row w1)'), "a marked row carries the id the answer can box it by");
  assert(summarizeMarks([mark]) === 'circled "R = ?"', "one mark is summarised in the board's words");
  assert(summarizeMarks([mark, { ...mark, id: "m2" }]).endsWith("and 1 more"), "several marks say how many");

  const anchor = doubtThinkingAnchor([mark], layoutWithRows(2, true), true);
  assert(anchor.x > mark.bounds.x + mark.bounds.width && Math.abs(anchor.y - 260) < 1, "the clicker thinks beside what was marked");
  const typedAnchor = doubtThinkingAnchor([], layoutWithRows(2, true), true);
  const next = workColumnRoom(layoutWithRows(2, true), true).nextRowY!;
  assert(typedAnchor.y > next && typedAnchor.y < next + TEXT_LAYOUT.lineHeight, "with nothing marked it thinks at the row the answer starts on");

  assert(!/clear/i.test(DOUBT_INTERRUPT_HINT), "the student is no longer told the board clears");
  assert(!/[—–]| - /.test(DOUBT_INTERRUPT_HINT), "UI copy carries no dash punctuation");
}

// ── The wiring that keeps the page ──────────────────────────────────────────
const root = resolve(import.meta.dirname, "../..");
function read(relative: string): string {
  return readFileSync(resolve(root, relative), "utf8");
}
/** Both anchors are checked: a missing end anchor would silently slice to the file's end. */
function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to);
}

{
  const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
  const handler = between(read(file), file, "const handleQuestion = useCallback(", "return { handleQuestion };");
  assert(
    (handler.match(/beginBoardEpoch\(\)/g) ?? []).length === 1 &&
      /if \(!doubt && !resume\) \{\s*await beginBoardEpoch\(\);/.test(handler),
    "only a fresh lesson clears the board; a doubt and a resume keep the page",
  );
  assert(/if \(!doubt && dsaClassification\.isDsa\)/.test(handler), "a doubt never plans a new code lesson");
  // Comment lines may sit between the guard and the pipeline's first statement.
  assert(
    /\} else if \(!doubt && !resume\) \{(?:\s*\/\/[^\n]*)*\s*const recentConversation/.test(handler),
    "a doubt never runs the planning pipeline again",
  );
  assert(handler.includes("buildDoubtTeachingPrompt("), "a doubt is taught under the doubt prompt");
  assert(handler.includes("buildResumeTeachingPrompt("), "the rest of the lesson continues under the resume prompt");
  assert(handler.includes("offerPausedLessonResume("), "a finished doubt offers to continue the paused lesson");
  assert(handler.includes("clearPausedLesson("), "a fresh question drops the paused lecture");
  assert(handler.includes("revealDeferredAnnotations: !doubt"), "a doubt does not reveal what the stopped lesson had not reached");
  assert(handler.includes("partialTurnScene(") && handler.includes("savePartialTurn"), "a stopped turn's ink is saved before the doubt that continues it");
}

{
  const file = "features/tutor-session/hooks/turn/useTurnControl.ts";
  const source = read(file);
  const ask = between(source, file, "const handleAskDoubt", "return {\n    finishLectureUi");
  assert(/handleQuestionRef\.current\(\s*[\w.]+,\s*\{ doubt: /.test(ask), "Ask Doubt hands the turn a doubt, not a question");
  assert(ask.includes("keepVisibleBoard: true"), "Ask Doubt keeps the visible board when it stops the lesson");
  assert(ask.includes("pausedLessonFromLive("), "Ask Doubt snapshots the paused lesson so it can continue after the doubt");
  assert(
    ask.includes("setPausedLessonOfferBoardId") && ask.includes("offerPausedLessonResume"),
    "a finished doubt waits for Continue instead of restarting on its own",
  );
  assert(
    ask.includes("handleQuestionRef.current(resume.lessonQuestion, { resume })") ||
      /handleQuestionRef\.current\(\s*resume\.lessonQuestion,\s*\{\s*resume/.test(ask),
    "the paused lesson is handed back as a resume, not as a new question",
  );
  const intro = between(source, file, "const enqueueVerifiedIntro", "const processResponseText");
  assert(
    !intro.includes("resetBoardLayout(") && intro.includes("dropDiagramRects("),
    "an aborted figure intro forgets the figure, not the rows the doubt continues under",
  );
  assert(intro.includes("figureDrawn = true"), "a committed intro marks the figure as drawn on the page");
}

{
  const file = "features/tutor-session/TutorSessionShell.tsx";
  const shell = read(file);
  assert(shell.includes("onBoardAt={"), "a doubt thinks over the page instead of under paper");
  assert(shell.includes("setHeldDoubtMarks("), "the student's rings stay up while the tutor thinks about them");
}

// ── A stopped turn saves only what the server accepts ───────────────────────
{
  const draw = (type: DrawCommand["type"], text?: string): DrawCommand => ({
    type,
    params: type === "WRITE" ? [90, 200] : type === "DRAW_LINE" ? [500, 300, 700, 300] : [],
    ...(text ? { text } : {}),
    charPosition: 0,
    narrationBefore: "",
  });
  const segment = (orderIndex: number, narration: string, command: RecordedSegmentPayload["command"]): RecordedSegmentPayload => ({
    orderIndex,
    narration,
    spokenText: narration,
    command,
    audioBytes: null,
    durationMs: null,
    timings: null,
  });
  const intro = segment(0, "this is the mirror", serializeSegmentCommands([draw("DRAW_LINE")], { trustedDiagramGeometry: true }));
  const row = segment(1, "one over f", serializeSegmentCommands([draw("WRITE", "1/f = 1/v + 1/u"), draw("FOCUS", "mirror")]));
  const walk = segment(2, "", serializeSegmentCommands([draw("POINT", "w1")]));
  const kept = partialTurnSegments([intro, row, walk], textOnlyTurnScene());
  assert(
    kept.length === 1 && parseStoredSegmentCommands(kept[0]!.command).map((c) => c.type).join(",") === "WRITE",
    "saved as text only, a stopped turn drops the figure ink it never committed and every pointing at it, and keeps its rows",
  );
  assert(
    partialTurnSegments([intro, row, walk], { ...textOnlyTurnScene(), visualStatus: "validated" }).length === 3,
    "saved with its figure, a stopped turn keeps every segment",
  );

  const annotating = doubtSegment(
    { narration: "and that label is v", command: draw("ANNOTATE", "v") },
    { codePanelShowing: false },
  );
  assert(
    annotating !== null && annotating.command === null,
    "a doubt never reveals a withheld label: the server refuses ANNOTATE in a text only save",
  );

  const plan = {
    sections: [
      { title: "setup", blocks: [{ id: "b1", code: "a = 1\nb = 2" }, { id: "b2", code: "print(a)" }] },
      { title: "loop", blocks: [{ id: "b3", code: "for x in a:" }] },
    ],
  } as unknown as CodeLessonPlan;
  assert(revealedCodeText(plan, { b1: 5 }) === "setup:\na = 1", "a doubt beside the code panel sees only the code typed so far");
  assert(revealedCodeText(plan, {}) === null, "nothing typed, nothing quoted");
}

// ── Nothing a stopped turn does can hold or harm the doubt ──────────────────
{
  const file = "features/tutor-session/hooks/turn/useTurnControl.ts";
  const source = read(file);
  const stop = between(source, file, "const stopTurn = useCallback(", "const pauseTurn = useCallback(");
  assert(
    stop.includes("pendingSegmentCountRef.current = 0;"),
    "stopping a turn zeroes the live count, so a doubt never waits on the stopped turn's stragglers",
  );
  assert(
    stop.includes("keepVisibleBoard") && stop.includes("commitDrawTransaction"),
    "a doubt interrupt commits an in-flight intro instead of rolling the figure back",
  );
  assert(
    stop.includes("boardShowsStoppedReplayRef.current = true"),
    "stopping a replay records that the board now shows one of its pages",
  );
  const enqueue = between(source, file, "const enqueueSegment = useCallback(", "const enqueueVerifiedIntro = useCallback(");
  assert(
    (enqueue.match(/if \(counted\(\)\)/g) ?? []).length >= 2 && enqueue.includes("counted() && shouldAbandonTurn("),
    "a stopped turn's segments neither take from the live count nor cancel the turn that replaced them",
  );
  const intro = between(source, file, "const enqueueVerifiedIntro = useCallback(", "const processResponseText");
  assert(
    /catch \(error\) \{[\s\S]*?introKeptByStopRef[\s\S]*?wb\.abortDrawTransaction\(transactionId\);[\s\S]*?if \(counted\(\)\) \{[\s\S]*?cancelRef\.current = true;/.test(intro),
    "a stopped intro unwinding late tears down only its own turn, never the doubt",
  );
  const respond = between(source, file, "const processResponseText", "const stopTurn = useCallback(");
  assert(
    (respond.match(/for \(const command of leftover\) \{\s*(?:\/\/[^\n]*\s*)*if \(turnGeneration !== turnGenerationRef\.current\)/g) ?? []).length === 2,
    "both withheld label loops stop the moment their turn is replaced",
  );
  assert(
    respond.includes("options?.errorQuestion ??"),
    "an empty reply names the turn it answered, so a retried doubt stays a doubt",
  );
  const ask = between(source, file, "const handleAskDoubt", "return {\n    finishLectureUi");
  assert(ask.includes("!isRuntimeReadyForDoubt(runtime)"), "a doubt the runtime is not ready for waits instead of being dropped");
  assert(
    ask.includes("boardShowsStoppedReplayRef.current"),
    "a doubt over a stopped replay's page does not claim to continue the saved lecture",
  );
}

{
  const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
  const handler = between(read(file), file, "const handleQuestion = useCallback(", "return { handleQuestion };");
  assert(
    /await boardCommitted;\s*(?:\/\/[^\n]*\s*)*if \(turnGeneration !== turnGenerationRef\.current\) \{\s*return;/.test(handler),
    "a turn replaced while its board row was written stops there, before it clears or claims the page",
  );
  assert(handler.includes("partialTurnSegments("), "a stopped turn saves only what the server accepts");
  assert(
    /const continues =\s*page\.turn\.continuesBoard && \(partialTurnSaved \? await partialTurnSaved : true\)/.test(handler),
    "a doubt continues a page only once the part it continues is saved",
  );
  assert(
    handler.includes("pendingQuestionOptionsRef.current = options ?"),
    "a doubt queued while the board loads still runs as a doubt",
  );
}

console.log("doubt same board verification passed");
