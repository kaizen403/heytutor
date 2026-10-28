/**
 * A doubt that drew its own figure is saved with that figure, replayed,
 * restored and exported with it, and the lesson's figure comes back on the
 * resume (DIAGRAM_DOUBT_FIGURES, phase 2 lane D).
 *
 * Mutations this gate catches (brief section 3, phase 2 gate table):
 * (a) the server checks the scene's source question against Turn.question;
 * (b) insertMissing goes back to `continuation === null`;
 * (c) the lesson's figure is returned rebuilt fresh, without consumedIds;
 * (d) a stored surface rebuilds or source checks a doubt figure on its title
 *     instead of `storedTurnSceneQuestion` (restore, sourceCheckedStoredTurn,
 *     the page figure loader).
 */
import { readFileSync } from "node:fs";
import { compileSceneDocument, validateSceneDocument, validateTurnPlanV3, type SceneDocument } from "@heytutor/scene-engine";
import { resolve } from "node:path";
import {
  getSegmentCommands,
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  takeDeferredAnnotations,
  type DrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { doubtFigureArtifacts, doubtFigureOf, composeDoubtFigureQuestion, storedTurnSceneQuestion } from "../../lib/boards/doubtFigure";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { bindDoubtFigurePageCheck, bindPageFigureLoader, memoryPageFigureStore, type PageFigureTurn } from "../../lib/scene/pageFigureLoader";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { selectProductionScene, type ProductionSceneSelectionInput } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import electrolysis from "./fixtures/recorded-electrolysis-given-replay.json";
import { boardContinuationArtifacts, boardContinuationOf, storedTurnContinuesBoard } from "../../lib/boards/boardContinuation";
import { lessonFigureReturnAfter, pageFigureAt } from "../../lib/boards/pageFigure";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import {
  consumedDeferredIds,
  releasedEntityIds,
  returnPageFigure,
  swapFigureIn,
} from "../../features/tutor-session/lib/scene/figureSwap";
import { storedFigurePresentation, syncStoredPageFigure } from "../../features/tutor-session/lib/replay/pageFigureSync";
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
import { DOUBT_FIGURE_TURN_ID, DOUBT_TITLE, LESSON_TURN_ID, doubtFigurePageFixture, doubtPageCheck, pageRowsOf, sceneMetadataOn, stored, teachingRow } from "./fixtures/doubtFigureScene";

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


/** A doubt figure the server did not admit: saved as the text doubt, words kept, figure and pointing gone. */
function savedAsText(saved: Awaited<ReturnType<typeof canonicalizeTurnSceneMetadata>>, why: string): void {
  assert(saved.ok, `${why}: the doubt's words still save (${saved.ok ? "" : saved.code})`);
  const value = saved.value;
  assert(value.visualStatus === "text_only" && value.sceneDocument === null, `${why}: saved as text, with no scene`);
  assert(doubtFigureOf(value.sceneArtifacts) === null && boardContinuationOf(value.sceneArtifacts) !== null,
    `${why}: no doubt figure marker, still on the lesson's page`);
  assert(!value.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)), `${why}: none of the figure's ink`);
  assert(!value.segments.some((segment) => parseStoredSegmentCommands(segment.command).some((command) => command.type === "FOCUS" || command.type === "ANNOTATE")),
    `${why}: no pointing at a figure that is not saved`);
  assert(value.segments.some((segment) => segment.narration.trim().length > 0), `${why}: the doubt's words are kept`);
}

/** What the presentation a FOCUS resolves against holds: its parts and what it withholds. */
function pointable(diagram: VerifiedDiagram): string {
  return JSON.stringify({ anchors: diagram.anchors, deferred: diagram.deferredAnnotations ?? [] });
}

/** The live doubt figure presentation, as doubtFigurePlan builds it on the composed question. */
function livePresentation(sceneDocument: unknown, sceneArtifacts: unknown, composed: string): VerifiedDiagram {
  const document = validateSceneDocument(sceneDocument).document as SceneDocument;
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, "the doubt figure compiles");
  const turnPlan = validateTurnPlanV3((sceneArtifacts as Record<string, unknown>).turnPlan, composed).plan;
  assert(turnPlan, "the doubt figure's plan validates on the composed question");
  return buildVerifiedDiagramPresentation(document, compiled.renderScene, { originalQuestion: composed, turnPlan }).diagram;
}

function storedRow(id: string, orderIndex: number, question: string, saved: { sceneDocument: unknown; sceneEngineVersion: string | null; validationReport: unknown; visualStatus: string; sceneArtifacts: unknown; segments: ReadonlyArray<{ narration: string; spokenText?: string | null; command: unknown }> }, kind: StoredTurn["kind"], opensOnClear: boolean): StoredTurn {
  const lead = opensOnClear
    ? [{ id: `${id}-clear`, orderIndex: 0, narration: "", spokenText: "", command: { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" }, audioUrl: null, durationMs: 50, timings: null }]
    : [];
  return {
    id, orderIndex, question, rawResponse: question, speedMultiplier: 1, traceId: null,
    sceneDocument: saved.sceneDocument, sceneEngineVersion: saved.sceneEngineVersion, validationReport: saved.validationReport,
    visualStatus: saved.visualStatus, sceneArtifacts: saved.sceneArtifacts, kind, status: "complete",
    segments: [...lead, ...saved.segments.map((segment, index) => ({
      id: `${id}-${index}`, orderIndex: lead.length + index, narration: segment.narration, spokenText: segment.spokenText ?? segment.narration,
      command: segment.command, audioUrl: null, durationMs: 900, timings: null,
    }))],
  } as unknown as StoredTurn;
}

/**
 * (d) The stored doubt figure rebuilds to exactly the live presentation, and a
 * source checked family (point line: its validator reads the question text)
 * survives the stored source check and the server's page figure loader.
 */
async function storedDoubtFigureMatchesLive(): Promise<void> {
  const submitted = structuredClone(JSON.parse(readFileSync(
    resolve(import.meta.dirname, "fixtures/point-line/annotation-link-positive.json"), "utf8")).submitted);
  const lessonQuestion: string = submitted.question;
  const title = "Doubt: why is the foot on the perpendicular?";
  const composed = composeDoubtFigureQuestion(lessonQuestion, title);
  const lessonSaved = await canonicalizeTurnSceneMetadata(submitted);
  assert(lessonSaved.ok, `the point line lesson saves: ${lessonSaved.ok ? "" : lessonSaved.error}`);
  const doubtSaved = await canonicalizeTurnSceneMetadata({
    ...sceneMetadataOn(submitted, composed, { ...boardContinuationArtifacts(lessonQuestion), ...doubtFigureArtifacts(LESSON_TURN_ID) },
      [teachingRow(0, "The foot is where the perpendicular meets the line.", [])]),
    question: title,
  }, { kind: "doubt", doubtFiguresEnabled: true,
    checkDoubtFigurePage: doubtPageCheck([storedRow(LESSON_TURN_ID, 0, lessonQuestion, lessonSaved.value, "lesson", true)]) });
  assert(doubtSaved.ok, `a point line doubt figure saves on the composed question: ${doubtSaved.ok ? "" : doubtSaved.error}`);
  const lessonRow = storedRow(LESSON_TURN_ID, 0, lessonQuestion, lessonSaved.value, "lesson", true);
  const doubtRow = storedRow(DOUBT_FIGURE_TURN_ID, 1, title, doubtSaved.value, "doubt", false);
  assert(storedTurnSceneQuestion(doubtRow) === composed && storedTurnSceneQuestion(lessonRow) === lessonQuestion,
    "the scene question of a stored doubt figure is the composed one; of a lesson, its own");
  const plainDoubt = { ...doubtRow, sceneArtifacts: boardContinuationArtifacts(lessonQuestion) };
  assert(storedTurnSceneQuestion(plainDoubt) === title, "a doubt without its own figure keeps its title");

  const checked = sourceCheckedStoredTurn(doubtRow);
  assert(checked === doubtRow && checked.visualStatus === "validated",
    "a source checked doubt figure survives the stored source check (replay and reload keep its figure)");
  const live = livePresentation(doubtRow.sceneDocument, doubtRow.sceneArtifacts, composed);
  const restored = restoreVerifiedPresentationFromTurn(doubtRow);
  assert(restored, "the stored point line doubt figure restores");
  assert(pointable(restored.diagram) === pointable(live),
    "the restored doubt figure has the live anchors and the live withheld set");

  // The page figure loader: a second doubt pointing at the first doubt's figure.
  const asLoaderRow = (turn: StoredTurn): PageFigureTurn => ({
    id: turn.id, boardId: "b1", userId: "u1", orderIndex: turn.orderIndex, question: turn.question,
    visualStatus: turn.visualStatus, sceneDocument: turn.sceneDocument, sceneArtifacts: turn.sceneArtifacts,
    segments: turn.segments.map((segment) => ({ orderIndex: segment.orderIndex, command: segment.command })),
  });
  const rows = [asLoaderRow(lessonRow), asLoaderRow(doubtRow)];
  const loader = bindPageFigureLoader({ boardId: "b1", userId: "u1", turnId: null }, {
    store: memoryPageFigureStore(rows),
  });
  const loaded = await loader({ schemaVersion: "doubt-figure-ref/v1", turnId: DOUBT_FIGURE_TURN_ID, kind: "verified_scene" }, { lessonQuestion });
  assert(loaded && pointable(loaded) === pointable(live),
    "a second doubt pointing at the doubt's figure resolves it on the server, as live drew it");

  // A figure whose opening letters a source given only with the plan: the
  // recorded electrolysis current. Rebuilt on the title the plan would not
  // validate, the current would be withheld and a FOCUS in replay would
  // letter a label live already drew.
  const recorded = structuredClone(electrolysis.input) as unknown as ProductionSceneSelectionInput & {
    turnPlan: { question: string }; problemIR: { question: string };
  };
  const chemTitle = "Doubt: why does the current set the mass?";
  const chemComposed = composeDoubtFigureQuestion(recorded.question, chemTitle);
  const onComposed = { ...recorded, question: chemComposed,
    turnPlan: { ...recorded.turnPlan, question: chemComposed }, problemIR: { ...recorded.problemIR, question: chemComposed } };
  const turnPlan = validateTurnPlanV3(onComposed.turnPlan, chemComposed).plan;
  assert(turnPlan, "the electrolysis plan validates on the composed question");
  const selected = selectProductionScene({ ...onComposed, turnPlan } as ProductionSceneSelectionInput).representation;
  assert(selected, "the electrolysis figure is selected on the composed question");
  const chemLive = buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene, { originalQuestion: chemComposed, turnPlan }).diagram;
  const chemSaved = await canonicalizeTurnSceneMetadata({
    question: chemTitle, sceneDocument: selected.sceneDocument, visualStatus: "validated", segments: [],
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: onComposed.problemIR, solverResult: electrolysis.input.solverAuthority.solverResult,
      representationTier: selected.tier, nonMetric: selected.nonMetric, candidates: [], figureSource: selected.figureSource, diagramResultStatus: "ready",
      ...boardContinuationArtifacts(recorded.question), ...doubtFigureArtifacts(LESSON_TURN_ID),
    },
  }, { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([storedRow(LESSON_TURN_ID, 0, recorded.question, {
    sceneDocument: selected.sceneDocument, sceneEngineVersion: null, validationReport: null, visualStatus: "validated", sceneArtifacts: null, segments: [],
  }, "lesson", true)]) });
  assert(chemSaved.ok, `the electrolysis doubt figure saves: ${chemSaved.ok ? "" : chemSaved.error}`);
  const chemRow = storedRow(DOUBT_FIGURE_TURN_ID, 1, chemTitle, chemSaved.value, "doubt", false);
  const chemRestored = restoreVerifiedPresentationFromTurn(sourceCheckedStoredTurn(chemRow));
  assert(chemRestored && pointable(chemRestored.diagram) === pointable(chemLive),
    "the restored electrolysis doubt figure withholds exactly what live withheld (the source given current is not withheld again)");
}

/**
 * A Stop cut the lesson's intro short, a doubt drew its own figure, then
 * Continue. Live returns the whole stashed intro (returnZoneStash); replay
 * and restore return the opener's stored intro rows. They agree because the
 * stopped lesson's save holds the whole figure: the server inserts the intro
 * rows the lesson did not draw.
 */
async function stoppedIntroReturnMatchesReplay(): Promise<void> {
  const fixture = resolve(import.meta.dirname, "fixtures/recorded-intro/vt-graph-car-p4c-t5.scene.json");
  const submittedDocument = JSON.parse(readFileSync(fixture, "utf8"));
  submittedDocument.source.representationTier = "qualitative_verified";
  submittedDocument.source.nonMetric = true;
  const question: string = submittedDocument.source.question;
  const document = validateSceneDocument(submittedDocument).document as SceneDocument;
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, "the recorded velocity time graph compiles");
  const live = buildVerifiedDiagramPresentation(document, compiled.renderScene, { originalQuestion: question });
  assert(live.introSegments.length >= 2, "the lesson's intro has beats a Stop can cut");
  const first = live.introSegments[0]!;
  const stopped = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: submittedDocument, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true, candidates: [], diagramResultStatus: "ready" },
    // Stop landed after the first beat: only that beat's row was drawn and held.
    segments: [{ orderIndex: 0, narration: first.narration, spokenText: first.narration,
      command: serializeSegmentCommands(getSegmentCommands(first), { trustedDiagramGeometry: true }) }],
  });
  assert(stopped.ok, `a lesson stopped after one intro beat saves: ${stopped.ok ? "" : stopped.error}`);
  const row = storedRow(LESSON_TURN_ID, 0, question, stopped.value, "lesson", true);
  const commands = (segments: readonly Parameters<typeof getSegmentCommands>[0][]) => JSON.stringify(segments.flatMap(getSegmentCommands));
  assert(commands(storedFigurePresentation(row).introSegments) === commands(live.introSegments),
    "what replay returns at the resume (the stopped lesson's stored intro) is the whole intro live returns from the stash");
}

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
    // Off at save time (turned off mid doubt, or a forged client): never a
    // figure, and never a lost doubt either.
    savedAsText(await canonicalizeTurnSceneMetadata(metadata, { kind: "doubt", doubtFiguresEnabled: false, checkDoubtFigurePage: fixture.pageCheck }),
      "the flag off at save time");
    savedAsText(await canonicalizeTurnSceneMetadata(metadata, { kind: "doubt", checkDoubtFigurePage: fixture.pageCheck }),
      "the flag read from the environment, off by default");
    const lessonKind = await canonicalizeTurnSceneMetadata(metadata, { kind: "lesson", doubtFiguresEnabled: true });
    assert(!lessonKind.ok && lessonKind.code === "scene_doubt_figure_invalid", "only a doubt may carry a doubt figure");
    const noKind = await canonicalizeTurnSceneMetadata(metadata, { doubtFiguresEnabled: true });
    assert(!noKind.ok && noKind.code === "scene_doubt_figure_invalid", "a save that does not name its kind cannot carry a doubt figure");
    const offPage = structuredClone(metadata);
    delete (offPage.sceneArtifacts as Record<string, unknown>).boardContinuation;
    const unpaged = await canonicalizeTurnSceneMetadata(offPage, { kind: "doubt", doubtFiguresEnabled: true });
    assert(!unpaged.ok && unpaged.code === "scene_doubt_figure_invalid", "a doubt figure needs the lesson's page");
    const forged = fixture.doubtMetadata(fixture.doubtSegments, boardContinuationArtifacts("Some other lesson."));
    const wrongPage = await canonicalizeTurnSceneMetadata({ ...forged, question: DOUBT_TITLE }, { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: fixture.pageCheck });
    savedAsText(wrongPage, "a doubt figure naming another lesson than its stored page's");
  }
  {
    // DIAGRAM_DOUBT_POINTING off: a doubt figure's rows keep plain FOCUS only.
    const extra = teachingRow(fixture.doubtSegments.length, "Keep that ring and name the start.", [
      { type: "FOCUS", params: [], text: "sum_value|keep", charPosition: 0, narrationBefore: "" },
      { type: "ANNOTATE", params: [], text: "start_value", charPosition: 0, narrationBefore: "" },
    ]);
    const metadata = { ...fixture.doubtMetadata([...fixture.doubtSegments, extra]), question: DOUBT_TITLE };
    const pointingOf = async (doubtPointingEnabled: boolean | undefined) => {
      const saved = await canonicalizeTurnSceneMetadata(structuredClone(metadata), {
        kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: fixture.pageCheck,
        ...(doubtPointingEnabled === undefined ? {} : { doubtPointingEnabled }),
      });
      assert(saved.ok && saved.value.visualStatus === "validated", `the doubt figure with pointing saves: ${saved.ok ? "" : saved.error}`);
      return saved.value.segments.flatMap((segment) => isStoredCommandTrustedGeometry(segment.command) ? [] : parseStoredSegmentCommands(segment.command))
        .filter((command) => command.type === "FOCUS" || command.type === "ANNOTATE")
        .map((command) => `${command.type}:${command.semanticRef?.entityId ?? command.text}`);
    };
    const on = await pointingOf(true);
    assert(on.includes("FOCUS:sum_value|keep") && on.some((entry) => entry.startsWith("ANNOTATE:")),
      `with the pointing flag on the kept ring and ANNOTATE are saved (${on.join()})`);
    for (const flag of [false, undefined]) {
      const off = await pointingOf(flag);
      assert(!off.some((entry) => entry.startsWith("ANNOTATE:")) && !off.some((entry) => /\|\s*keep/i.test(entry)) && off.includes("FOCUS:sum_value"),
        `with the pointing flag ${flag === false ? "off" : "unset"} only plain FOCUS is saved (${off.join()})`);
    }
  }
  {
    // S4: the doubt figure must belong to the stored page of its lesson.
    const metadata = { ...fixture.doubtMetadata(fixture.doubtSegments), question: DOUBT_TITLE };
    const admit = (check: Parameters<typeof canonicalizeTurnSceneMetadata>[1]) =>
      canonicalizeTurnSceneMetadata(structuredClone(metadata), { kind: "doubt", doubtFiguresEnabled: true, ...check });
    const lessonRow = lessonTurn;
    const otherOpener = stored("55555555-5555-4555-8555-555555555555", 1, "A different lesson.", {
      sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
      segments: [teachingRow(0, "Something else.", [])],
    }, { opensOnClear: true, kind: "lesson" });
    const validOn = (saved: Awaited<ReturnType<typeof admit>>, message: string) =>
      assert(saved.ok && saved.value.visualStatus === "validated" && doubtFigureOf(saved.value.sceneArtifacts) !== null, message);
    validOn(await admit({ checkDoubtFigurePage: fixture.pageCheck }), "the lesson's own page admits its doubt figure");
    savedAsText(await admit({}), "a save route that binds no page check");
    savedAsText(await admit({ checkDoubtFigurePage: bindDoubtFigurePageCheck({ boardId: "b1", userId: "u1", turnId: null },
      { store: memoryPageFigureStore(pageRowsOf([lessonRow], "u2")) }) }), "a page owned by another user");
    savedAsText(await admit({ checkDoubtFigurePage: bindDoubtFigurePageCheck({ boardId: "b2", userId: "u1", turnId: null },
      { store: memoryPageFigureStore(pageRowsOf([lessonRow])) }) }), "a lesson on another board");
    savedAsText(await admit({ checkDoubtFigurePage: doubtPageCheck([lessonRow, otherOpener]) }),
      "a lesson behind a later page opener");
    validOn(await admit({ checkDoubtFigurePage: doubtPageCheck([lessonRow], "66666666-6666-4666-8666-666666666666") }),
      "a doubt whose row is not written yet is compared with the end of the board");
    const foreignRow = { ...pageRowsOf([{ ...lessonRow, id: "77777777-7777-4777-8777-777777777777", orderIndex: 5 }])[0]!, boardId: "b9" };
    savedAsText(await admit({ checkDoubtFigurePage: bindDoubtFigurePageCheck({ boardId: "b1", userId: "u1", turnId: foreignRow.id },
      { store: memoryPageFigureStore([...pageRowsOf([lessonRow]), foreignRow]) }) }), "a doubt row id from another board");
    const marked = (replacedTurnId: string | null) => ({
      ...fixture.doubtMetadata(fixture.doubtSegments, doubtFigureArtifacts(replacedTurnId)), question: DOUBT_TITLE,
    });
    const withMarker = (replacedTurnId: string | null, turns: StoredTurn[]) =>
      canonicalizeTurnSceneMetadata(marked(replacedTurnId), { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck(turns) });
    validOn(await withMarker(null, [lessonRow]), "an empty replaced figure on the lesson's page is admitted");
    savedAsText(await withMarker("88888888-8888-4888-8888-888888888888", [lessonRow]), "a replaced figure that is not on the board");
    savedAsText(await canonicalizeTurnSceneMetadata(marked(null), { kind: "doubt", doubtFiguresEnabled: true,
      checkDoubtFigurePage: bindDoubtFigurePageCheck({ boardId: "b1", userId: "u1", turnId: null },
        { store: memoryPageFigureStore(pageRowsOf([lessonRow], "u2")) }) }), "an empty replaced figure on a page another user opened");
    const earlierPage = { ...lessonRow, id: "99999999-9999-4999-8999-999999999999", orderIndex: 0 };
    const laterLesson = { ...lessonRow, orderIndex: 1 };
    savedAsText(await withMarker(earlierPage.id, [earlierPage, laterLesson]), "a replaced figure on an earlier page");
    savedAsText(await withMarker(DOUBT_FIGURE_TURN_ID, [lessonRow, { ...doubtFigureTurn, orderIndex: 1 }]),
      "a replaced figure that is itself a doubt figure");
    savedAsText(await withMarker(plainDoubt.id, [lessonRow, { ...plainDoubt, orderIndex: 1 }]),
      "a replaced turn on the page with no figure of its own");
    validOn(await withMarker(LESSON_TURN_ID, [lessonRow, { ...doubtFigureTurn, orderIndex: 1 }, { ...plainDoubt, orderIndex: 2 }]),
      "a second doubt figure on the page names the lesson's figure, still the stash");
  }
  {
    // (b) A doubt figure is new on the page: its intro rows are inserted when missing.
    const words = [teachingRow(0, "Three more lands on five.", [])];
    const saved = await canonicalizeTurnSceneMetadata(
      { ...fixture.doubtMetadata(words), question: DOUBT_TITLE }, { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: fixture.pageCheck });
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
  await storedDoubtFigureMatchesLive();
  await stoppedIntroReturnMatchesReplay();
  {
    const { wb, events, drawn, executeCommand } = board();
    const swap = await syncStoredPageFigure({ turns, turnIndex: 1, whiteboard: wb, executeCommand, shouldCancel: () => false });
    assert(swap.changed && !swap.cancelled && swap.diagram !== null && events.includes("eraseSceneInk:0") && drawn.length === 0,
      "at the doubt figure the zone clears and its own figure is installed (its stored intro draws it)");
    // The replayed doubt figure is the one live drew, not one rebuilt on the title.
    assert(pointable(swap.diagram) === pointable(livePresentation(doubtFigureTurn.sceneDocument, doubtFigureTurn.sceneArtifacts, composed)),
      "replay installs the doubt figure with the live anchors and the live withheld set");
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
