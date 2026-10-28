/**
 * A doubt that drew its own figure is saved with that figure, replayed,
 * restored and exported with it, and the lesson's figure comes back on the
 * resume (DIAGRAM_DOUBT_FIGURES, phase 2 lane D).
 *
 * Mutations this gate catches (brief section 3, phase 2 gate table):
 * (a) the server checks the scene's source question against Turn.question;
 * (b) insertMissing goes back to `continuation === null`;
 * (c) the lesson's figure is returned rebuilt fresh, without consumedIds.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  takeDeferredAnnotations,
  type DrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { doubtFigureOf, composeDoubtFigureQuestion } from "../../lib/boards/doubtFigure";
import { boardContinuationArtifacts, boardContinuationOf, storedTurnContinuesBoard } from "../../lib/boards/boardContinuation";
import { lessonFigureReturnAfter, pageFigureAt } from "../../lib/boards/pageFigure";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import {
  consumedDeferredIds,
  releasedEntityIds,
  returnPageFigure,
  swapFigureIn,
} from "../../features/tutor-session/lib/scene/figureSwap";
import { syncStoredPageFigure } from "../../features/tutor-session/lib/replay/pageFigureSync";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import {
  doubtFigureTurnScene,
  doubtPageRecord,
  pausedLessonFromPage,
  type PersistedTurnScene,
} from "../../features/tutor-session/lib/turn/doubtTurn";
import { liveTurnScene } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import type { BoardLayoutState } from "../../features/tutor-session/types";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { DOUBT_TITLE, LESSON_TURN_ID, doubtFigurePageFixture, teachingRow } from "./fixtures/doubtFigureScene";

let checks = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`verify-doubt-figure-persist: ${message}`);
  checks += 1;
}

type Drawn = { type: string; text: string | undefined; durationScale: number | undefined; trusted: boolean };

function board() {
  const events: string[] = [];
  const drawn: Drawn[] = [];
  const wb = {
    eraseSceneInk: async (duration: number) => { events.push(`eraseSceneInk:${duration}`); },
    erasePinnedInk: () => { events.push("erasePinnedInk"); },
  } as unknown as WhiteboardHandle;
  const executeCommand = async (command: DrawCommand, options?: { durationScale?: number; trustedDiagramGeometry?: boolean }) => {
    drawn.push({ type: command.type, text: command.text, durationScale: options?.durationScale, trusted: options?.trustedDiagramGeometry === true });
  };
  return { wb, events, drawn, executeCommand };
}

const layoutWithFigure = (): BoardLayoutState => ({
  rects: [
    { x: 40, y: 120, width: 200, height: 30 },
    { x: 620, y: 200, width: 40, height: 24 },
  ] as BoardLayoutState["rects"],
  nextY: 160,
});

const labelsOf = (drawn: readonly Drawn[]) => drawn.filter((entry) => entry.type === "LABEL").map((entry) => entry.text);

async function main(): Promise<void> {
  const fixture = await doubtFigurePageFixture();
  const { lesson, composed } = fixture;
  const [lessonTurn, doubtFigureTurn, plainDoubt, resumeTurn] = fixture.turns as [
    typeof fixture.turns[0], typeof fixture.turns[0], typeof fixture.turns[0], typeof fixture.turns[0],
  ];

  // --- the server: marker, continuation, flag, and the composed question -----
  assert(composed === composeDoubtFigureQuestion(lesson.question, DOUBT_TITLE) && composed !== DOUBT_TITLE,
    "the composed question is the lesson's plus the doubt, never the title");
  {
    // (a) The scene was planned on the composed question; Turn.question is the title.
    assert(doubtFigureTurn.visualStatus === "validated", "a doubt with the marker, its page and the flag saves validated");
    assert(doubtFigureTurn.question === DOUBT_TITLE, "Turn.question stays the doubt's title");
    const source = (doubtFigureTurn.sceneDocument as { source: { question: string } }).source.question;
    assert(source === composed, "the saved scene's source question is the recomputed composed question");
    const artifacts = doubtFigureTurn.sceneArtifacts as Record<string, unknown>;
    assert(doubtFigureOf(artifacts)?.replacedTurnId === LESSON_TURN_ID, "the doubt figure marker survives the save");
    assert(boardContinuationOf(artifacts)?.lessonQuestion === lesson.question, "the continuation marker survives the save");
    assert(artifacts.turnPlan && artifacts.problemIR && artifacts.solverResult && artifacts.solverAuthority,
      "the doubt figure carries the plan and canonical solver artifacts, as a lesson would");
    assert(storedTurnContinuesBoard(doubtFigureTurn), "the doubt figure stays on the lesson's page");
    assert(parseStoredSegmentCommands(doubtFigureTurn.segments.at(-1)!.command).some((command) => command.type === "FOCUS"),
      "the doubt's FOCUS on its own figure is kept");
  }
  {
    // The same scene without its marker is checked against the title and refused.
    const unmarked = fixture.doubtMetadata(fixture.doubtSegments, { doubtFigure: undefined });
    delete (unmarked.sceneArtifacts as Record<string, unknown>).doubtFigure;
    const saved = await canonicalizeTurnSceneMetadata({ ...unmarked, question: DOUBT_TITLE }, { kind: "doubt", doubtFiguresEnabled: true });
    assert(!saved.ok && (saved.code === "scene_source_question_mismatch" || saved.code === "scene_turn_plan_invalid"),
      `without the marker the composed scene does not match the title (${saved.ok ? "saved" : saved.code})`);
  }
  {
    const metadata = { ...fixture.doubtMetadata(fixture.doubtSegments), question: DOUBT_TITLE };
    const off = await canonicalizeTurnSceneMetadata(metadata, { kind: "doubt", doubtFiguresEnabled: false });
    assert(!off.ok && off.code === "scene_doubt_figure_disabled", "the marker is refused when the flag is off at save time");
    const envOff = await canonicalizeTurnSceneMetadata(metadata, { kind: "doubt" });
    assert(!envOff.ok && envOff.code === "scene_doubt_figure_disabled", "the flag is read from the environment, off by default");
    const lessonKind = await canonicalizeTurnSceneMetadata(metadata, { kind: "lesson", doubtFiguresEnabled: true });
    assert(!lessonKind.ok && lessonKind.code === "scene_doubt_figure_invalid", "only a doubt may carry a doubt figure");
    const noKind = await canonicalizeTurnSceneMetadata(metadata, { doubtFiguresEnabled: true });
    assert(!noKind.ok && noKind.code === "scene_doubt_figure_invalid", "a save that does not name its kind cannot carry a doubt figure");
    const offPage = structuredClone(metadata);
    delete (offPage.sceneArtifacts as Record<string, unknown>).boardContinuation;
    const unpaged = await canonicalizeTurnSceneMetadata(offPage, { kind: "doubt", doubtFiguresEnabled: true });
    assert(!unpaged.ok && unpaged.code === "scene_doubt_figure_invalid", "a doubt figure needs the lesson's page");
    const forged = fixture.doubtMetadata(fixture.doubtSegments, boardContinuationArtifacts("Some other lesson."));
    const wrongPage = await canonicalizeTurnSceneMetadata({ ...forged, question: DOUBT_TITLE }, { kind: "doubt", doubtFiguresEnabled: true });
    assert(!wrongPage.ok && (wrongPage.code === "scene_source_question_mismatch" || wrongPage.code === "scene_turn_plan_invalid"),
      "the source question is recomputed from the page's lesson, so another lesson's scene is refused");
  }
  {
    // (b) A doubt figure is new on the page: its intro rows are inserted when missing.
    const words = [teachingRow(0, "Three more lands on five.", [])];
    const saved = await canonicalizeTurnSceneMetadata(
      { ...fixture.doubtMetadata(words), question: DOUBT_TITLE }, { kind: "doubt", doubtFiguresEnabled: true });
    assert(saved.ok, `a doubt figure saved without its intro rows still saves: ${saved.ok ? "" : saved.error}`);
    const intro = saved.value.segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command));
    assert(intro.length > 0, "the server inserts the doubt figure's missing intro rows");
    // A resume continues the lesson's figure and never gets its intro again.
    assert(!resumeTurn.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)),
      "a resume's figure intro is never inserted again");
  }

  // --- the live save -------------------------------------------------------
  {
    const lessonScene = lessonTurn as unknown as PersistedTurnScene;
    const record = doubtPageRecord({
      boardId: "b1", lessonQuestion: lesson.question, title: DOUBT_TITLE, continuesBoard: true,
      figureDrawn: false, turnPlan: null, solverProjection: null,
    });
    const doubtScene = { ...doubtFigureTurn } as unknown as PersistedTurnScene;
    record.turn.scene = doubtFigureTurnScene(doubtScene, lesson.question, LESSON_TURN_ID);
    record.zoneStash = null;
    const before = liveTurnScene({ page: record, kind: "doubt", preview: DOUBT_TITLE, opensPage: false, status: "stopped", textOnly: false });
    assert(before.visualStatus === "text_only" && boardContinuationOf(before.sceneArtifacts) !== null &&
      doubtFigureOf(before.sceneArtifacts) === null,
      "before its figure commits the doubt is text on the page, with no figure marker");
    record.figureDrawn = true;
    const after = liveTurnScene({ page: record, kind: "doubt", preview: DOUBT_TITLE, opensPage: false, status: "complete", textOnly: false });
    assert(after.visualStatus === "validated" && after.sceneDocument === doubtFigureTurn.sceneDocument &&
      doubtFigureOf(after.sceneArtifacts)?.replacedTurnId === LESSON_TURN_ID &&
      boardContinuationOf(after.sceneArtifacts)?.lessonQuestion === lesson.question,
      "a doubt with its own committed figure saves as its own validated scene with both markers");
    const textOnly = liveTurnScene({ page: record, kind: "doubt", preview: DOUBT_TITLE, opensPage: false, status: "complete", textOnly: true });
    assert(textOnly.visualStatus === "text_only", "the text only fallback still drops the doubt's figure");
    const pausedNoStash = pausedLessonFromPage(record, false);
    assert(pausedNoStash?.figureDrawn === false && pausedNoStash.scene === null,
      "a doubt's own figure is not the lesson's figure for Continue");
    record.zoneStash = { diagram: {} as VerifiedDiagram, presentation: { diagram: {} as VerifiedDiagram, introSegments: [] }, turnId: LESSON_TURN_ID };
    assert(pausedLessonFromPage(record, false)?.figureDrawn === true, "a stashed lesson figure was drawn");
    void lessonScene;
  }

  // --- pageFigureAt --------------------------------------------------------
  const turns = fixture.turns;
  {
    const at0 = pageFigureAt(turns, 0);
    assert(at0.sourceIndex === 0 && !at0.swapIn && !at0.returnsLesson && at0.consumedIds.length === 0, "the opener's figure starts the page");
    const at1 = pageFigureAt(turns, 1);
    assert(at1.sourceIndex === 1 && at1.swapIn && !at1.returnsLesson, "the doubt with its own figure swaps it in");
    const at2 = pageFigureAt(turns, 2);
    assert(at2.sourceIndex === 1 && !at2.swapIn && !at2.returnsLesson && at2.consumedIds.join() === "sum_value",
      "a second doubt keeps the doubt's figure, with what the doubt released");
    const at3 = pageFigureAt(turns, 3);
    assert(at3.sourceIndex === 0 && at3.returnsLesson && !at3.swapIn && at3.consumedIds.join() === "start_value",
      "the resume returns the lesson's figure with only what the lesson released");
    const plain = pageFigureAt([lessonTurn, plainDoubt, resumeTurn], 2);
    assert(plain.sourceIndex === 0 && !plain.returnsLesson && !plain.swapIn, "with no doubt figure the resume keeps the zone");
    assert(pageFigureAt([lessonTurn, plainDoubt], 1).sourceIndex === 0, "a doubt without a figure keeps the zone's figure");
    const reload = lessonFigureReturnAfter(turns.slice(0, 3));
    assert(reload?.sourceIndex === 0 && reload.consumedIds.join() === "start_value", "a reloaded board knows what the resume returns");
    assert(lessonFigureReturnAfter(turns) === null, "after the resume nothing is left to return");
  }

  // --- figureSwap: the zone, and consumedIds with no label twice ------------
  {
    const { wb, events } = board();
    const layout = layoutWithFigure();
    assert(await swapFigureIn(wb, layout, {} as VerifiedDiagram), "the swap clears the zone");
    assert(events.includes("eraseSceneInk:0") && events.includes("erasePinnedInk"), "the swap erases scene ink and kept rings at once");
    assert(layout.rects.length === 1 && layout.rects[0]!.x < 400, "the swap drops the figure's rects and keeps the work rows");
    const cancelled = board();
    assert(!await swapFigureIn(cancelled.wb, layoutWithFigure(), {} as VerifiedDiagram, { shouldCancel: () => true }) &&
      cancelled.events.length === 0, "a cancelled swap leaves the zone alone");
  }
  {
    const presentation = restoreVerifiedPresentationFromTurn(lessonTurn)!;
    assert(presentation && presentation.diagram.deferredAnnotations?.length === 2, "the lesson figure withholds its two labels");
    // Live: the lesson's FOCUS on the starting value letters "2".
    const live = structuredClone(presentation.diagram);
    const liveLettered = takeDeferredAnnotations(live, { entityIds: releasedEntityIds(live, ["start_value"]) });
    assert(liveLettered.length === 1 && liveLettered[0]!.text === "2", "live, the lesson's FOCUS letters 2");
    assert(consumedDeferredIds(presentation.diagram, live).join() === "start_value", "the live object's consumed ids are readable");

    const { wb, drawn, executeCommand } = board();
    const pristine = JSON.stringify(presentation.diagram);
    const returned = await returnPageFigure(wb, layoutWithFigure(), presentation, ["start_value"], { executeCommand });
    assert(returned, "the lesson figure returns");
    assert(JSON.stringify(presentation.diagram) === pristine, "the presentation is never mutated");
    assert(drawn.every((entry) => entry.durationScale === 0 && entry.trusted), "the returned figure is stamped at once as trusted ink");
    assert(labelsOf(drawn).join() === "2", "the label the student already saw is drawn back, the withheld one is not");
    // (c) The returned figure's deferred state is the live one: nothing twice.
    assert(JSON.stringify(returned.deferredAnnotations) === JSON.stringify(live.deferredAnnotations),
      "consumedIds reproduce the live deferred state");
    assert(takeDeferredAnnotations(returned, { entityIds: ["start_value"] }).length === 0,
      "a later FOCUS on the starting value letters nothing a second time");
    assert(takeDeferredAnnotations(returned, { entityIds: ["sum_value"] }).length === 1, "the sum is still withheld for its own FOCUS");
    assert(await returnPageFigure(wb, layoutWithFigure(), presentation, [], {}) === null, "without an executor nothing is drawn");
  }

  // --- the replay, restore and export step through the stored page ----------
  {
    const { wb, events, drawn, executeCommand } = board();
    const swap = await syncStoredPageFigure({ turns, turnIndex: 1, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(swap.changed && !swap.cancelled && swap.diagram !== null && events.includes("eraseSceneInk:0") && drawn.length === 0,
      "at the doubt figure the zone clears and its own figure is installed (its stored intro draws it)");
    const keep = await syncStoredPageFigure({ turns, turnIndex: 2, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(!keep.changed, "a plain doubt keeps the zone");
    const back = await syncStoredPageFigure({ turns, turnIndex: 3, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(back.changed && !back.cancelled && back.diagram, "at the resume the lesson's figure returns");
    const stampedLines = drawn.filter((entry) => entry.type === "DRAW_LINE").length;
    assert(stampedLines > 0 && labelsOf(drawn).join() === "2", "the stored intro and the released label are stamped back, nothing else");
    assert(takeDeferredAnnotations(back.diagram, { entityIds: ["start_value"] }).length === 0,
      "the replayed resume cannot letter the starting value twice");
    assert(!(await syncStoredPageFigure({ turns, turnIndex: 0, whiteboard: wb, executeCommand, shouldCancel: () => false })).changed,
      "the opener is not a continuation step");
  }

  // --- restore after a reload: Continue knows what the lesson drew ----------
  {
    const stopped = turns.slice(0, 3).map((turn, index) => index === 0
      ? { ...turn, status: "stopped" as const, persistedStatus: "stopped" as const }
      : { ...turn, persistedStatus: "complete" as const });
    const request = pausedLessonFromStoredTurns(stopped, { boardId: "b1", ownerState: "inactive" });
    assert(request, "a stopped lesson under a doubt figure can Continue");
    assert(request.figureDrawn === true, "figureDrawn comes from the lesson's figure");
    assert(request.returnsFigure?.turnId === LESSON_TURN_ID && request.returnsFigure.consumedIds.join() === "start_value",
      "Continue after a reload carries the lesson figure to return");
    const textLesson = [{ ...stopped[0]!, segments: stopped[0]!.segments.filter((segment) => !isStoredCommandTrustedGeometry(segment.command)),
      visualStatus: "text_only" as const, sceneDocument: null }, stopped[1]!];
    const textRequest = pausedLessonFromStoredTurns(textLesson, { boardId: "b1", ownerState: "inactive" });
    assert(textRequest?.figureDrawn === false, "a doubt's own figure never counts as the lesson's figure");
  }

  // --- every sync point asks pageFigureAt (both anchors guarded) ------------
  {
    const root = resolve(import.meta.dirname, "../..");
    const between = (path: string, start: string, end: string): string => {
      const source = readFileSync(resolve(root, path), "utf8");
      const from = source.indexOf(start);
      assert(from >= 0, `${path}: start anchor "${start}" is gone; repoint this gate, do not relax it`);
      const to = source.indexOf(end, from + start.length);
      assert(to > from, `${path}: end anchor "${end}" is gone; repoint this gate, do not relax it`);
      return source.slice(from, to);
    };
    const points: Array<[string, string, string, RegExp]> = [
      ["features/tutor-session/hooks/useReplay.ts", "const syncReplayTurn = useCallback(", "const runReplaySegmentDraw = useCallback(",
        /storedTurnContinuesBoard\(turn\)\) \{\s*const figure = await syncStoredPageFigure\(/],
      ["features/tutor-session/hooks/useLecturePlayer.ts", "const syncTurn = useCallback(", "const publishCueText = useCallback(",
        /storedTurnContinuesBoard\(turn\)\) \{[\s\S]*?const figure = await syncStoredPageFigure\(/],
      ["lib/lecture-export/exportLectureMp4.ts", "onCueStart: async (cue) => {", "options.onTurnStart?.(turn, activeDiagram);",
        /\} else \{[\s\S]*?const figure = await syncStoredPageFigure\(/],
      ["features/tutor-session/hooks/useLectureExport.ts", "onTurnStart: (turn, diagram) => {", "cueBytes: lectureExportCueBytes(source),",
        /else if \(storedPageFigureChange\(turns, turns\.indexOf\(turn\)\)\.kind !== "keep"\)/],
      ["features/tutor-session/hooks/useBoardSession.ts", "const continuesPage = storedTurnContinuesBoard(turn);", "await completeStoredTurnDiagram({",
        /\} else \{[\s\S]*?const figure = await syncStoredPageFigure\(/],
      ["lib/replay/lecturePlayer.ts", "const installedDiagramByTurn = new Map", "workPages: recordedLectureWorkPages(",
        /const figure = pageFigureAt\(turns, cue\.turnIndex\);/],
      ["features/tutor-session/lib/replay/pageFigureSync.ts", "export function storedPageFigureChange(", "export function storedTurnFigureDiagram(",
        /const at = pageFigureAt\(turns, turnIndex\);/],
    ];
    for (const [path, start, end, pattern] of points) {
      assert(pattern.test(between(path, start, end)), `${path} must consult pageFigureAt instead of returning early`);
    }
    const replaySync = between("features/tutor-session/hooks/useReplay.ts", "const syncReplayTurn = useCallback(", "const runReplaySegmentDraw = useCallback(");
    assert(/activeVerifiedDiagramRef\.current = figure\.diagram/.test(replaySync), "replay installs the figure the step resolved");
  }

  console.log(`verify-doubt-figure-persist: ${checks} checks passed`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
