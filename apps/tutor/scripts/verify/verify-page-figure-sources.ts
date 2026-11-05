/**
 * A resume can be the turn that first drew a lesson's figure: a Stop or a
 * doubt before the figure's first beat saves the opener as text only, and the
 * resume draws the whole figure from its own trusted rows. Replay, restore,
 * export and the player must take that resume as the page's lesson figure
 * source (round 2, lane 1), and a Continue after a reload must restore its
 * scene and return its figure.
 *
 * Named mutations (each turns this gate red):
 * (1) `pageFigureAt` sets `source = openerSource` at every resume again;
 * (2) `storedTurnDrawsLessonFigure` drops its trusted-row test;
 * (3) `storedPageFigureChange` sends `clearFirst: false` always;
 * (4) `syncStoredPageFigure` treats `install` as `keep`;
 * (5) `lessonRecoveryFromStoredTurns` keeps `turnScene(source)`;
 * (6) `lecturePlayer` drops `figure.installsLesson` from its install test.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isStoredCommandTrustedGeometry, type DrawCommand } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import {
  lessonFigureReturnAfter,
  lessonFigureSourceAt,
  pageFigureAt,
  storedTurnDrawsLessonFigure,
} from "../../lib/boards/pageFigure";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { storedPageFigureChange, syncStoredPageFigure } from "../../features/tutor-session/lib/replay/pageFigureSync";
import { lessonRecoveryFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import { doubtFigurePageFixture, doubtPageCheck, focus, stored, teachingRow } from "./fixtures/doubtFigureScene";

let checks = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`verify-page-figure-sources: ${message}`);
  checks += 1;
}

const TEXT_LESSON_ID = "55555555-5555-4555-8555-555555555555";
const DRAWING_RESUME_ID = "66666666-6666-4666-8666-666666666666";
const write = (text: string): DrawCommand => ({ type: "WRITE", params: [90, 142], text, charPosition: 0, narrationBefore: "" });

function board() {
  const events: string[] = [];
  const wb = {
    eraseSceneInk: async (duration: number) => { events.push(`eraseSceneInk:${duration}`); },
    erasePinnedInk: () => { events.push("erasePinnedInk"); },
  } as unknown as WhiteboardHandle;
  const drawn: string[] = [];
  const executeCommand = async (command: DrawCommand) => { drawn.push(command.type); };
  return { wb, events, drawn, executeCommand };
}

const trustedRows = (turn: StoredTurn) => turn.segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command)).length;

async function main(): Promise<void> {
  const fixture = await doubtFigurePageFixture();
  const { lesson } = fixture;
  const [lessonTurn, doubtFigureTurn, , resumeTurn] = fixture.turns as [StoredTurn, StoredTurn, StoredTurn, StoredTurn];
  const artifacts = lesson.metadata.sceneArtifacts as Record<string, unknown>;

  // L: Stop before the figure's first beat saved the opener as text only,
  // with its plan (doubtTurn.ts partialTurnScene).
  const textLesson = stored(TEXT_LESSON_ID, 0, lesson.question, {
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: { turnPlan: artifacts.turnPlan },
    segments: [teachingRow(0, "Let us add two and three.", [write("2 + 3")])],
  }, { opensOnClear: true, kind: "lesson" });

  // R1: the resume drew the whole figure, then lettered the starting value,
  // saved through the real server canonicalizer as a continuation.
  const drawingSaved = await canonicalizeTurnSceneMetadata({
    ...lesson.metadata,
    sceneArtifacts: { ...artifacts, ...boardContinuationArtifacts(lesson.question) },
    segments: [
      ...lesson.metadata.segments,
      teachingRow(lesson.metadata.segments.length, "We start at two.", [focus("start_value")]),
    ],
  }, { kind: "resume" });
  assert(drawingSaved.ok, `the drawing resume saves: ${drawingSaved.ok ? "" : drawingSaved.error}`);
  const drawingResume = stored(DRAWING_RESUME_ID, 1, lesson.question, drawingSaved.value, { opensOnClear: false, kind: "resume" });
  assert(trustedRows(drawingResume) > 0, "the drawing resume keeps its trusted figure rows (insertMissing false keeps them in place)");

  // D: a doubt's own figure replacing R1's, saved through the real page check.
  const doubtSaved = await canonicalizeTurnSceneMetadata(
    { ...fixture.doubtMetadata(fixture.doubtSegments, doubtFigureArtifacts(DRAWING_RESUME_ID)) },
    { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([textLesson, drawingResume]) },
  );
  assert(doubtSaved.ok, `the doubt figure over a resume-drawn figure saves: ${doubtSaved.ok ? "" : doubtSaved.error}`);
  const doubt = stored(doubtFigureTurn.id, 2, doubtFigureTurn.question, doubtSaved.value, { opensOnClear: false, kind: "doubt" });
  // R2: the next resume, saved with the lesson's scene and no figure rows.
  const resume2 = { ...resumeTurn, orderIndex: 3 };
  assert(trustedRows(resume2) === 0, "the later resume saves no figure rows");

  // --- the predicate --------------------------------------------------------
  assert(!storedTurnDrawsLessonFigure(textLesson, true), "a text only opener drew no figure");
  assert(storedTurnDrawsLessonFigure(lessonTurn, true), "an opener with a validated scene drew the figure");
  assert(storedTurnDrawsLessonFigure(drawingResume, false), "a resume whose own trusted rows drew the scene drew the figure");
  assert(!storedTurnDrawsLessonFigure(resume2, false), "a resume with the scene but no trusted rows drew nothing");
  assert(!storedTurnDrawsLessonFigure(doubt, false), "a doubt's figure is never the lesson's");

  // --- case 1: L(text) R1(draws) D(fig) R2 ------------------------------------
  const page1 = [textLesson, drawingResume, doubt, resume2];
  {
    const at0 = pageFigureAt(page1, 0);
    assert(at0.sourceIndex === null && !at0.installsLesson, "the text only opener leaves the zone empty");
    const at1 = pageFigureAt(page1, 1);
    assert(at1.sourceIndex === 1 && at1.installsLesson && !at1.swapIn && !at1.returnsLesson,
      "R1 installs the lesson's figure, it is not a return or a swap");
    const change1 = storedPageFigureChange(page1, 1);
    assert(change1.kind === "install" && change1.sourceIndex === 1 && change1.clearFirst === false,
      "R1 is an install with nothing to clear");
    assert(storedPageFigureChange(page1, 2).kind === "swap", "D swaps its own figure in");
    const at3 = pageFigureAt(page1, 3);
    assert(at3.returnsLesson && !at3.installsLesson && at3.sourceIndex === 1,
      "R2 returns R1's figure, not the opener's empty zone");
    assert(at3.consumedIds.join() === "start_value", "R2 replays what R1 released on its figure, and only that");
    const change3 = storedPageFigureChange(page1, 3);
    assert(change3.kind === "return" && change3.sourceIndex === 1, "R2's stored change is a return to R1");
    assert(lessonFigureSourceAt(page1, 3) === 1 && lessonFigureSourceAt(page1, 0) === null,
      "the lesson figure source is R1 from R1 on, none before");
    const reload = lessonFigureReturnAfter(page1.slice(0, 3));
    assert(reload?.sourceIndex === 1 && reload.consumedIds.join() === "start_value",
      "a reloaded board returns R1's figure after the doubt");
  }

  // --- case 2: L(drew) R1(no rows) D R2: byte-identical to before -------------
  {
    const resume1 = { ...resumeTurn, id: DRAWING_RESUME_ID, orderIndex: 1 };
    const page2 = [lessonTurn, resume1, { ...doubtFigureTurn, orderIndex: 2 }, resume2];
    const at1 = pageFigureAt(page2, 1);
    assert(!at1.installsLesson && at1.sourceIndex === 0, "a resume without figure rows keeps the opener's figure");
    assert(storedPageFigureChange(page2, 1).kind === "keep", "R1 keeps the zone");
    const at3 = pageFigureAt(page2, 3);
    assert(at3.returnsLesson && at3.sourceIndex === 0 && !at3.installsLesson, "R2 returns the opener's figure");
    assert(lessonFigureSourceAt(page2, 3) === 0, "the opener stays the lesson figure source");
  }

  // --- case 3: L(text) D(empty-zone figure) R1(draws) -------------------------
  {
    const page3 = [textLesson, { ...doubt, orderIndex: 1 }, { ...drawingResume, orderIndex: 2 }];
    const at2 = pageFigureAt(page3, 2);
    assert(at2.installsLesson && at2.sourceIndex === 2, "R1 installs the lesson's figure over the doubt's");
    const change = storedPageFigureChange(page3, 2);
    assert(change.kind === "install" && change.clearFirst === true, "the doubt's figure leaves the zone before R1's rows draw");
    const { wb, events, executeCommand } = board();
    const synced = await syncStoredPageFigure({ turns: page3, turnIndex: 2, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(synced.changed && !synced.cancelled && synced.diagram !== null && events.includes("eraseSceneInk:0"),
      "the install clears the doubt's figure first and installs R1's diagram");
  }

  // --- syncStoredPageFigure at R1 ---------------------------------------------
  {
    const { wb, events, drawn, executeCommand } = board();
    const synced = await syncStoredPageFigure({ turns: page1, turnIndex: 1, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(synced.changed && !synced.cancelled && synced.diagram !== null,
      "replay at R1 installs the lesson's diagram so its FOCUS has a target");
    assert(events.length === 0 && drawn.length === 0, "the install erases nothing and stamps nothing: R1's own rows draw the figure");
    const cancelled = await syncStoredPageFigure({ turns: page1, turnIndex: 1, whiteboard: wb, executeCommand, shouldCancel: () => true });
    assert(cancelled.changed && cancelled.cancelled, "a cancelled install reports cancelled");
    const back = await syncStoredPageFigure({ turns: page1, turnIndex: 3, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(back.changed && !back.cancelled && back.diagram !== null && drawn.length > 0,
      "replay at R2 stamps R1's figure back and resolves its diagram");
  }

  // --- Continue after a reload ------------------------------------------------
  {
    const stoppedAt = (turns: StoredTurn[], lastLesson: number) => turns.map((turn, index) => index === lastLesson
      ? { ...turn, status: "stopped" as const, persistedStatus: "stopped" as const }
      : { ...turn, persistedStatus: "complete" as const });
    // F4: no doubt figure; the next resume points at R1's figure.
    const plain = lessonRecoveryFromStoredTurns(stoppedAt([textLesson, drawingResume], 1), { boardId: "b1", ownerState: "inactive" });
    assert(plain?.kind === "continue", "a stopped resume-drawn lesson can Continue");
    assert(plain.request.scene?.sceneDocument === drawingResume.sceneDocument && plain.request.scene?.visualStatus === "validated",
      "Continue restores R1's scene, not the text only opener's");
    assert(plain.request.figureDrawn === true && !plain.request.returnsFigure, "the figure is drawn and nothing is returned");
    assert(plain.request.turnPlan !== null, "the opener stays the plan source");
    // F2: after a doubt figure, Continue returns R1's figure.
    const afterDoubt = lessonRecoveryFromStoredTurns(stoppedAt([textLesson, drawingResume, doubt], 1), { boardId: "b1", ownerState: "inactive" });
    assert(afterDoubt?.kind === "continue", "a stopped lesson under a doubt figure can Continue");
    assert(afterDoubt.request.scene?.sceneDocument === drawingResume.sceneDocument, "Continue after the doubt restores R1's scene");
    assert(afterDoubt.request.returnsFigure?.turnId === DRAWING_RESUME_ID &&
      afterDoubt.request.returnsFigure.consumedIds.join() === "start_value",
      "Continue after the doubt returns R1's figure with what R1 released");
    // Byte-identical when the opener drew.
    const opener = lessonRecoveryFromStoredTurns(stoppedAt([lessonTurn, { ...doubtFigureTurn, orderIndex: 1 }], 0), { boardId: "b1", ownerState: "inactive" });
    assert(opener?.kind === "continue" && opener.request.scene?.sceneDocument === lessonTurn.sceneDocument &&
      opener.request.returnsFigure?.turnId === lessonTurn.id, "a page whose opener drew restores and returns the opener's figure");
  }

  // --- every sync point handles install (both anchors guarded) ----------------
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
    // Surfaces that step through syncStoredPageFigure take any change (install
    // included) on `figure.changed`; none may branch on swap or return kinds.
    const viaSync: Array<[string, string, string]> = [
      ["features/tutor-session/hooks/useReplay.ts", "const syncReplayTurn = useCallback(", "const runReplaySegmentDraw = useCallback("],
      ["features/tutor-session/hooks/useLecturePlayer.ts", "const syncTurn = useCallback(", "const publishCueText = useCallback("],
      ["lib/lecture-export/exportLectureMp4.ts", "onCueStart: async (cue) => {", "options.onTurnStart?.(turn, activeDiagram);"],
      ["features/tutor-session/hooks/useBoardSession.ts", "const continuesPage = storedTurnContinuesBoard(turn);", "await completeStoredTurnDiagram({"],
    ];
    for (const [path, start, end] of viaSync) {
      const slice = between(path, start, end);
      assert(/const figure = await syncStoredPageFigure\(/.test(slice) && /if \(figure\.changed/.test(slice),
        `${path} must take every page figure change, install included, through syncStoredPageFigure`);
      assert(!/\.kind === "(?:swap|return)"/.test(slice), `${path} must not branch on swap or return only`);
    }
    assert(/storedPageFigureChange\(turns, turns\.indexOf\(turn\)\)\.kind !== "keep"/.test(
      between("features/tutor-session/hooks/useLectureExport.ts", "onTurnStart: (turn, diagram) => {", "cueBytes: lectureExportCueBytes(source),")),
    "useLectureExport points FOCUS at the figure any non-keep change drew");
    assert(/figure\.swapIn \|\| figure\.returnsLesson \|\| figure\.installsLesson/.test(
      between("lib/replay/lecturePlayer.ts", "const installedDiagramByTurn = new Map", "workPages: recordedLectureWorkPages(")),
    "lecturePlayer counts an installing resume as installing the diagram");
    const change = between("features/tutor-session/lib/replay/pageFigureSync.ts", "export function storedPageFigureChange(", "export function storedTurnFigureDiagram(");
    assert(/if \(at\.installsLesson\)/.test(change), "storedPageFigureChange maps installsLesson to install");
    const sync = between("features/tutor-session/lib/replay/pageFigureSync.ts", "export async function syncStoredPageFigure(", "const source = change.sourceIndex === null");
    assert(/change\.kind === "install"/.test(sync), "syncStoredPageFigure handles install before the return path");
  }

  console.log(`verify-page-figure-sources: ${checks} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
