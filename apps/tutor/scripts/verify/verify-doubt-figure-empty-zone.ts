/**
 * DIAGRAM_DOUBT_FIGURES lane 2: a doubt draws its own figure on an empty zone,
 * and on a restored board, and the lesson's resume puts the zone back.
 *
 * Behaviour, through the real server canonicalizer and a fake whiteboard:
 *   an empty zone takes a figure only when no work row reaches it; the empty
 *   stash's return erases the doubt's figure and clears the holders, a
 *   cancelled one keeps them; replay and restore clear the zone at the same
 *   resume (decision D1); the server admits the empty zone's marker
 *   (`replacedTurnId: null`) on the lesson's page; Continue after an empty
 *   zone doubt owes no lesson figure; a restored board rebuilds the stash from
 *   its stored turns with the marks the live figure already released.
 * Source (useQuestionHandler, both anchors guarded): after an empty return the
 *   lesson's planned but undrawn figure may still draw.
 *
 * Mutations this gate catches (brief lane 2 table):
 * (a) drop the zoneOccupied check in doubtFigureNeedSkip;
 * (b) returnZoneStash returns the same (cancelled) result for cancel and empty;
 * (c) pausedLessonFromPage reads `Boolean(record.zoneStash)`;
 * (d) storedZoneStash builds the stash from the live diagram as its own pristine;
 * (e) the restore guard keeps `!zoneStash`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { takeDeferredAnnotations, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { doubtFigureArtifacts, doubtFigureOf } from "../../lib/boards/doubtFigure";
import { lessonFigureReturnAfter, pageFigureAt } from "../../lib/boards/pageFigure";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import {
  EMPTY_ZONE_STASH,
  consumedDeferredIds,
  releasedEntityIds,
  returnZoneStash,
  type ZoneStash,
} from "../../features/tutor-session/lib/scene/figureSwap";
import { storedFigurePresentation, storedPageFigureChange, syncStoredPageFigure } from "../../features/tutor-session/lib/replay/pageFigureSync";
import {
  doubtFigureNeedSkip,
  storedPageZoneStash,
  storedZoneStash,
  zoneInkOccupied,
} from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { doubtFigureTurnScene, doubtPageRecord, pausedLessonFromPage, type PersistedTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";
import { pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import type { BoardLayoutState } from "../../features/tutor-session/types";
import { DOUBT_FIGURE_TURN_ID, DOUBT_TITLE, LESSON_TURN_ID, doubtFigurePageFixture, doubtPageCheck, stored, teachingRow } from "./fixtures/doubtFigureScene";

let checks = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`verify-doubt-figure-empty-zone: ${message}`);
  checks += 1;
}

const root = resolve(import.meta.dirname, "../..");
function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to + end.length);
}

/** Index of `needle`, asserted present: an order check on a missing string (-1) must never pass (review N2). */
function at(haystack: string, needle: string, from = 0): number {
  const index = haystack.indexOf(needle, from);
  assert(index >= 0, `present in the slice: ${needle.slice(0, 72)}`);
  return index;
}

type Drawn = { type: string; text: string | undefined };

function board() {
  const events: string[] = [];
  const drawn: Drawn[] = [];
  const wb = {
    eraseSceneInk: async (duration: number) => { events.push(`eraseSceneInk:${duration}`); },
    erasePinnedInk: () => { events.push("erasePinnedInk"); },
  } as unknown as WhiteboardHandle;
  const executeCommand = async (command: DrawCommand) => { drawn.push({ type: command.type, text: command.text }); };
  return { wb, events, drawn, executeCommand };
}

/** The work column of a text only lesson: one short row, and the doubt figure's rects in the zone. */
const layoutWithDoubtFigure = (): BoardLayoutState => ({
  rects: [
    { x: 40, y: 120, width: 200, height: 30 },
    { x: 620, y: 200, width: 40, height: 24 },
  ],
  nextY: 160,
});

const write = (text: string): DrawCommand => ({ type: "WRITE", params: [90, 142], text, charPosition: 0, narrationBefore: "" });
const labelsOf = (drawn: readonly Drawn[]) => drawn.filter((entry) => entry.type === "LABEL").map((entry) => entry.text);

async function main(): Promise<void> {
  const fixture = await doubtFigurePageFixture();
  const { lesson, turns } = fixture;
  const [lessonTurn, doubtFigureTurn, , resumeTurn] = turns as [StoredTurn, StoredTurn, StoredTurn, StoredTurn];

  // A text only lesson: its opener drew no figure, so the zone is empty.
  const textLesson = stored(LESSON_TURN_ID, 0, lesson.question, {
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
    segments: [teachingRow(0, "Start with two.", [write("2")])],
  }, { opensOnClear: true, kind: "lesson" });

  // --- (a) the occupancy guard ---------------------------------------------
  {
    const empty = {
      granted: true, codeBoard: false, markedFigureIds: [] as string[], zoneFigure: null,
      zoneReturnable: false, zoneEmpty: true,
    };
    const shortRows: BoardLayoutState = { rects: [{ x: 40, y: 120, width: 200, height: 30 }], nextY: 160 };
    // With no figure the column runs to the board's right margin (workColumnMaxWidth).
    const longRow: BoardLayoutState = { rects: [{ x: 40, y: 120, width: 1100, height: 30 }], nextY: 160 };
    assert(doubtFigureNeedSkip({ ...empty, zoneOccupied: zoneInkOccupied(shortRows) }) === null,
      "an empty zone with short work rows asks the need check");
    assert(doubtFigureNeedSkip({ ...empty, zoneOccupied: zoneInkOccupied(longRow) }) === "zone_occupied",
      "an empty zone a long text only row runs across is refused: never draw over ink");
  }

  // --- the server admits the empty zone's marker on the lesson's page -------
  const emptyDoubtSaved = await canonicalizeTurnSceneMetadata(
    fixture.doubtMetadata(fixture.doubtSegments, doubtFigureArtifacts(null)),
    { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([textLesson]) },
  );
  assert(emptyDoubtSaved.ok && emptyDoubtSaved.value.visualStatus === "validated" &&
    doubtFigureOf(emptyDoubtSaved.value.sceneArtifacts)?.replacedTurnId === null,
  `an empty zone's doubt figure saves validated with replacedTurnId null: ${emptyDoubtSaved.ok ? "" : emptyDoubtSaved.error}`);
  const emptyDoubt = stored(DOUBT_FIGURE_TURN_ID, 1, DOUBT_TITLE, emptyDoubtSaved.value, { opensOnClear: false, kind: "doubt" });
  const textResume = { ...resumeTurn, orderIndex: 2 } as StoredTurn;
  const emptyPage = [textLesson, emptyDoubt, textResume];

  // --- (b) the empty stash's return ------------------------------------------
  {
    const stash: ZoneStash = { ...EMPTY_ZONE_STASH };
    assert(Object.isFrozen(EMPTY_ZONE_STASH) && !Object.isFrozen(stash), "the empty stash constant is frozen; records hold a copy");
    const holders = () => [{ zoneStash: stash as ZoneStash | null }, { zoneStash: null as ZoneStash | null }];

    const { wb, events, drawn, executeCommand } = board();
    const layout = layoutWithDoubtFigure();
    const done = holders();
    const back = await returnZoneStash(wb, layout, stash, done, { shouldCancel: () => false, executeCommand });
    assert(back.cancelled === false && back.diagram === null, "an empty return resolves { cancelled: false, diagram: null }");
    assert(events.includes("eraseSceneInk:0") && events.includes("erasePinnedInk"), "an empty return erases the doubt's figure and its rings");
    assert(drawn.length === 0, "an empty return stamps nothing");
    assert(layout.rects.length === 1 && layout.rects[0]!.x < 400, "an empty return drops the doubt figure's rects and keeps the work rows");
    assert(done.every((holder) => holder.zoneStash === null), "an empty return clears the stash on both records");

    const stopped = board();
    const cut = holders();
    const cancelled = await returnZoneStash(stopped.wb, layoutWithDoubtFigure(), stash, cut, { shouldCancel: () => true, executeCommand });
    assert(cancelled.cancelled === true && cancelled.diagram === null, "a cancelled empty return says so");
    assert(cut.every((holder) => holder.zoneStash === stash), "a cancelled empty return keeps the stash on both records, for the next Continue");
    const noBoard = holders();
    assert((await returnZoneStash(null, layoutWithDoubtFigure(), stash, noBoard, { executeCommand })).cancelled,
      "no board erases nothing and keeps the stash");
    assert(noBoard.every((holder) => holder.zoneStash === stash), "no board keeps the stash");
  }

  // --- live equals stored at the resume (decision D1) -----------------------
  {
    const at = pageFigureAt(emptyPage, 1);
    assert(at.swapIn && at.sourceIndex === 1, "replay swaps the empty zone's doubt figure in");
    const change = storedPageFigureChange(emptyPage, 2);
    assert(change.kind === "return" && change.sourceIndex === null, "replay returns nothing at the resume: the zone empties");
    const { wb, events, drawn, executeCommand } = board();
    const synced = await syncStoredPageFigure({ turns: emptyPage, turnIndex: 2, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(synced.changed && !synced.cancelled && synced.diagram === null && events.includes("eraseSceneInk:0") && drawn.length === 0,
      "replay, restore and export clear the zone at the resume, as the live empty return does");
    const reload = lessonFigureReturnAfter(emptyPage.slice(0, 2));
    assert(reload !== null && reload.sourceIndex === null, "a reloaded board's resume returns nothing: the zone empties");
  }

  // --- (c) Continue after an empty zone doubt owes no lesson figure ---------
  {
    const record = doubtPageRecord({
      boardId: "b1", lessonQuestion: lesson.question, title: DOUBT_TITLE, continuesBoard: true,
      figureDrawn: true, turnPlan: null, solverProjection: null,
    });
    record.turn.scene = doubtFigureTurnScene({ ...emptyDoubt } as unknown as PersistedTurnScene, lesson.question, null);
    record.zoneStash = { ...EMPTY_ZONE_STASH };
    assert(pausedLessonFromPage(record, false)?.figureDrawn === false,
      "a doubt that drew on an empty zone stashed no drawn lesson figure");
    const reloaded = pausedLessonFromStoredTurns(
      [{ ...textLesson, status: "stopped", persistedStatus: "stopped" }, { ...emptyDoubt, persistedStatus: "complete" }] as StoredTurn[],
      { boardId: "b1", ownerState: "inactive" },
    );
    assert(reloaded && reloaded.figureDrawn === false && reloaded.returnsFigure?.turnId === null,
      "after a reload Continue owes no lesson figure and clears the zone");
  }

  // --- (d) a restored board's stash ----------------------------------------
  {
    // The lesson's figure on a restored board: rebuilt from its turn, and the
    // lesson's FOCUS already lettered the starting value on the live object.
    const live = storedFigurePresentation(lessonTurn).diagram!;
    const fresh = structuredClone(live);
    takeDeferredAnnotations(live, { entityIds: releasedEntityIds(live, ["start_value"]) });
    const liveReleased = consumedDeferredIds(fresh, live);
    assert(liveReleased.join() === "start_value", "the live figure released the starting value");
    const stash = storedZoneStash(live, lessonTurn);
    assert(stash && stash.diagram === live && stash.turnId === LESSON_TURN_ID, "the stash is the stored lesson figure, held live");
    assert(consumedDeferredIds(stash.presentation!.diagram, stash.diagram!).join() === liveReleased.join(),
      "the stash's consumed ids are exactly what the live figure released");
    const { wb, drawn, executeCommand } = board();
    const back = await returnZoneStash(wb, layoutWithDoubtFigure(), stash, [], { shouldCancel: () => false, executeCommand });
    assert(!back.cancelled && back.diagram && JSON.stringify(back.diagram.deferredAnnotations) === JSON.stringify(live.deferredAnnotations),
      "the returned figure has the live deferred state");
    assert(labelsOf(drawn).join() === "2", "the label the student saw comes back, the withheld one does not");

    const other = structuredClone(storedFigurePresentation(doubtFigureTurn).diagram!);
    other.anchors = other.anchors.map((anchor) => ({ ...anchor, labels: [...anchor.labels, "other"] }));
    assert(storedZoneStash(other, lessonTurn) === null, "a stored figure that is not the zone's gives no stash");

    // The page read: the lesson's figure in the zone, a doubt's figure over
    // it, and a doubt's figure over an empty zone.
    const onLesson = storedPageZoneStash([lessonTurn], live);
    assert(onLesson?.turnId === LESSON_TURN_ID && onLesson.diagram === live, "a restored lesson page stashes the lesson's figure");
    const doubtLive = storedFigurePresentation(doubtFigureTurn).diagram!;
    const overLesson = storedPageZoneStash([lessonTurn, doubtFigureTurn], doubtLive);
    assert(overLesson?.turnId === LESSON_TURN_ID && overLesson.diagram && overLesson.presentation &&
      consumedDeferredIds(overLesson.presentation.diagram, overLesson.diagram).join() === "start_value",
    "with a doubt's figure in the zone the stash is the lesson's, with what the lesson released (as replay returns it)");
    const overEmpty = storedPageZoneStash([textLesson, emptyDoubt], storedFigurePresentation(emptyDoubt).diagram!);
    assert(overEmpty !== null && overEmpty.diagram === null && overEmpty.turnId === null,
      "a doubt's figure over an empty zone stashes the empty zone");
    assert(storedPageZoneStash([lessonTurn], other) === null, "a page whose stored figure is not the zone's gives no stash");
    assert(storedPageZoneStash([textLesson], live) === null, "a page with no stored figure gives no stash");

    // A doubt on a restored board is not skipped as zone_not_returnable.
    assert(doubtFigureNeedSkip({
      granted: true, codeBoard: false, markedFigureIds: [], zoneFigure: live,
      zoneReturnable: storedPageZoneStash([lessonTurn], live) !== null, zoneEmpty: false, zoneOccupied: false,
    }) === null, "a restored board's doubt asks the need check");
    // The restored stash names a turn the server's page check admits.
    const restoredDoubt = await canonicalizeTurnSceneMetadata(
      fixture.doubtMetadata(fixture.doubtSegments, doubtFigureArtifacts(overLesson.turnId)),
      { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([lessonTurn, doubtFigureTurn]) },
    );
    assert(restoredDoubt.ok && restoredDoubt.value.visualStatus === "validated",
      `a second doubt figure on a restored board saves with the lesson's turn as replaced: ${restoredDoubt.ok ? "" : restoredDoubt.error}`);
  }

  // --- (e) the live resume, from source -----------------------------------
  {
    const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
    const handler = readFileSync(resolve(root, file), "utf8");
    const back = between(handler, file, "// doubt-figure-return:begin", "// doubt-figure-return:end");
    const stashReturn = at(back, "const stashReturn = await returnZoneStash(");
    const emptied = at(back, "zoneEmptied = !stashReturn.cancelled && zoneStash.diagram === null;");
    assert(back.includes("let zoneEmptied = pageReturned;") && stashReturn >= 0 && emptied > stashReturn,
      "the live resume notes an empty return only after it resolved uncancelled");
    assert(at(back, "zoneEmptied = !result.cancelled && back.turnId === null && billed.doubtFigures === true;") > at(back, "returnFigureToZone("),
      "after a reload, a return with no stored source empties the zone too (flag on only)");
    const restore = between(handler, file, "// doubt-figure-restore:begin", "// doubt-figure-restore:end");
    assert(at(handler, "// doubt-figure-return:end") < at(handler, "// doubt-figure-restore:begin"), "the restore follows the return");
    assert(restore.includes("const zoneHeld = Boolean(zoneStash || resume.returnsFigure) && !zoneEmptied;"),
      "an emptied zone is not held by a returned figure");
    assert(/if \(!rebuildingCodeIntro && !activeDiagram && !zoneHeld &&\s*resume\.scene\?\.sceneDocument\) \{/.test(restore),
      "after an empty return the lesson's planned but undrawn figure still draws");
    assert(!/!zoneStash &&/.test(restore), "the restore guard does not refuse every stash");
  }

  console.log(`verify-doubt-figure-empty-zone: ${checks} checks passed`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
