/**
 * A doubt answered on the lesson's page stays on that page everywhere the board
 * is rebuilt.
 *
 * A doubt turn is saved without the runtime CLEAR and carries a board
 * continuation marker. If the server drops the marker, or a surface ignores it,
 * the doubt becomes a page of its own on replay and restore: the figure it
 * pointed at vanishes under it, the notes split in two, and the video export
 * records a few rows on a blank board.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import {
  BOARD_CONTINUATION_VERSION,
  boardContinuationArtifacts,
  boardContinuationOf,
  pageTurnsEndingAt,
  storedTurnContinuesBoard,
  storedTurnPageQuestion,
} from "../../lib/boards/boardContinuation";
import type {
  RecordedSegmentPayload,
  StoredSegment,
  StoredTurn,
} from "../../lib/boards/boardsClient";
import { buildLectureTimeline, buildLiveTurnSegments } from "../../lib/replay/liveTimeline";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import {
  latestLecturePage,
  lecturePageCacheKey,
  pageHasExportableAudio,
} from "../../lib/lecture-export/canExportLectureMp4";
import { lectureExportCacheKey } from "../../lib/lecture-export/lectureExportFrames";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const LESSON = "A block slides down a 30 degree incline with mu = 0.2. Find the acceleration.";

const CLEAR: DrawCommand = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };

const write = (text: string): DrawCommand => ({
  type: "WRITE",
  text,
  params: [90, 142],
  charPosition: 0,
  narrationBefore: "",
});

function epochSegment(): StoredSegment {
  return {
    id: "seg-epoch",
    orderIndex: 0,
    narration: "",
    spokenText: "",
    command: CLEAR,
    audioUrl: null,
    durationMs: 50,
    timings: null,
  };
}

function rowSegment(orderIndex: number, row: string, audioUrl: string | null): StoredSegment {
  return {
    id: `seg-${orderIndex}`,
    orderIndex,
    narration: `so ${row}`,
    spokenText: `so ${row}`,
    command: serializeSegmentCommands([write(row)], { trustedDiagramGeometry: false }),
    audioUrl,
    durationMs: 900,
    timings: null,
  };
}

function turn(input: {
  orderIndex: number;
  question: string;
  rows: string[];
  opensOnClear: boolean;
  sceneArtifacts?: unknown;
  audio?: boolean;
}): StoredTurn {
  const lead = input.opensOnClear ? [epochSegment()] : [];
  return {
    id: `turn-${input.orderIndex}`,
    orderIndex: input.orderIndex,
    question: input.question,
    rawResponse: input.rows.join(" "),
    speedMultiplier: 1,
    traceId: null,
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "text_only",
    sceneArtifacts: input.sceneArtifacts ?? null,
    segments: [
      ...lead,
      ...input.rows.map((row, index) =>
        rowSegment(lead.length + index, row, input.audio === false ? null : `blob:${input.orderIndex}-${index}`),
      ),
    ],
  };
}

const lessonTurn = (orderIndex: number, question: string, rows: string[], audio = true) =>
  turn({ orderIndex, question, rows, opensOnClear: true, audio });

const doubtTurn = (orderIndex: number, lessonQuestion: string, rows: string[], audio = true) =>
  turn({
    orderIndex,
    question: `Doubt: row ${orderIndex}`,
    rows,
    opensOnClear: false,
    sceneArtifacts: boardContinuationArtifacts(lessonQuestion),
    audio,
  });

async function main(): Promise<void> {
  // --- the marker ----------------------------------------------------------
  {
    const marker = boardContinuationOf(boardContinuationArtifacts(`  ${LESSON}  `));
    assert(
      marker?.schemaVersion === BOARD_CONTINUATION_VERSION && marker.lessonQuestion === LESSON,
      "the continuation marker must round trip with the lesson question trimmed",
    );
    assert(
      boardContinuationOf({
        schemaVersion: "scene-artifacts/v3",
        turnPlan: null,
        ...boardContinuationArtifacts(LESSON),
      })?.lessonQuestion === LESSON,
      "the marker must survive beside other scene artifacts",
    );
    for (const forged of [
      null,
      "board-continuation/v1",
      { boardContinuation: { schemaVersion: "board-continuation/v0", lessonQuestion: LESSON } },
      { boardContinuation: { schemaVersion: BOARD_CONTINUATION_VERSION, lessonQuestion: 7 } },
      { boardContinuation: [BOARD_CONTINUATION_VERSION, LESSON] },
    ]) {
      assert(
        boardContinuationOf(forged) === null,
        `a malformed marker must read as none: ${JSON.stringify(forged)}`,
      );
    }
  }

  // --- which turns continue a page ----------------------------------------
  const lesson = lessonTurn(0, LESSON, ["N = mg cos 30", "a = g sin 30 - mu g cos 30"]);
  const doubt = doubtTurn(1, LESSON, ["sin 30 = 0.5"]);
  {
    assert(!storedTurnContinuesBoard(lesson), "a lesson opens its own page");
    assert(storedTurnContinuesBoard(doubt), "a doubt with the marker and no CLEAR continues the page");
    assert(
      storedTurnPageQuestion(doubt) === LESSON,
      "a doubt's page belongs to the lesson it was asked about, not to its own title",
    );
    assert(storedTurnPageQuestion(lesson) === LESSON, "a lesson's page is its own question");

    const clearedDoubt = turn({
      orderIndex: 2,
      question: "Doubt: fresh",
      rows: ["x = 1"],
      opensOnClear: true,
      sceneArtifacts: boardContinuationArtifacts(LESSON),
    });
    assert(
      !storedTurnContinuesBoard(clearedDoubt),
      "a turn that opens on the CLEAR starts a page whatever its artifacts say",
    );
    assert(
      storedTurnPageQuestion(clearedDoubt) === "Doubt: fresh",
      "a turn on a page of its own keeps its own question",
    );

    // The CLEAR is identified by order, not by array position.
    const shuffled: StoredTurn = { ...clearedDoubt, segments: [...clearedDoubt.segments].reverse() };
    assert(
      !storedTurnContinuesBoard(shuffled),
      "the page opening CLEAR is the lowest orderIndex, wherever it sits in the array",
    );

    const unmarked = turn({ orderIndex: 3, question: "legacy", rows: ["y = 2"], opensOnClear: false });
    assert(
      !storedTurnContinuesBoard(unmarked),
      "a turn without the marker is never read as a continuation, CLEAR or not",
    );
  }

  // --- pages ---------------------------------------------------------------
  const secondLesson = lessonTurn(2, "Find the range of a projectile at 20 m/s and 30 degrees.", ["R = u^2 sin 2θ / g"]);
  const secondDoubt = doubtTurn(3, secondLesson.question, ["sin 60 = 0.866"]);
  const thirdDoubt = doubtTurn(4, secondLesson.question, ["R = 35.3 m"], false);
  const board = [lesson, doubt, secondLesson, secondDoubt, thirdDoubt];
  {
    const ids = (turns: StoredTurn[]) => turns.map((entry) => entry.id).join(",");
    assert(
      ids(pageTurnsEndingAt(board)) === "turn-2,turn-3,turn-4",
      `the last page is the second lesson and both doubts under it, got ${ids(pageTurnsEndingAt(board))}`,
    );
    assert(ids(pageTurnsEndingAt(board, 1)) === "turn-0,turn-1", "an earlier page chains back to its lesson");
    assert(ids(pageTurnsEndingAt(board, 2)) === "turn-2", "a lesson is a page of its own");
    assert(ids(pageTurnsEndingAt(board, 0)) === "turn-0", "the first turn is a page of its own");
    assert(pageTurnsEndingAt(board, 9).length === 0, "an index past the board has no page");
    assert(pageTurnsEndingAt([]).length === 0, "an empty board has no page");

    // Export takes the page the student last watched, in board order.
    const exportPage = latestLecturePage([thirdDoubt, lesson, secondDoubt, doubt, secondLesson]);
    assert(
      ids(exportPage) === "turn-2,turn-3,turn-4",
      `the video export records the whole last page, got ${ids(exportPage)}`,
    );
    assert(
      pageHasExportableAudio([thirdDoubt]) === false && pageHasExportableAudio(exportPage),
      "a page with any recorded audio is exportable; a silent one is not",
    );
    assert(
      lecturePageCacheKey([secondLesson]) === lectureExportCacheKey(secondLesson),
      "a page of one turn must keep that turn's cache key, or every cached lesson video is lost",
    );
    assert(
      lecturePageCacheKey([secondLesson, secondDoubt]) !==
        lecturePageCacheKey([secondLesson, secondDoubt, thirdDoubt]),
      "a doubt added to the page must change the cache key, or the old video is served",
    );
  }

  // --- the server keeps the marker ----------------------------------------
  {
    const segments = [
      {
        orderIndex: 0,
        narration: "sin 30 is one half",
        spokenText: "sin 30 is one half",
        command: serializeSegmentCommands([write("sin 30 = 0.5")], { trustedDiagramGeometry: false }),
      },
    ];
    const saved = await canonicalizeTurnSceneMetadata({
      question: "Doubt: why is sin 30 one half",
      visualStatus: "text_only",
      sceneArtifacts: { ...boardContinuationArtifacts(LESSON), forged: { trusted: true } },
      segments,
    });
    assert(saved.ok, `a text-only doubt turn must persist: ${saved.ok ? "" : saved.error}`);
    const artifacts = saved.value.sceneArtifacts as Record<string, unknown> | null;
    assert(
      boardContinuationOf(artifacts)?.lessonQuestion === LESSON,
      "the server must keep the continuation marker on a text-only doubt turn",
    );
    assert(
      artifacts !== null && !("forged" in artifacts),
      "arbitrary artifacts beside the marker must still be dropped",
    );
    assert(
      saved.value.visualStatus === "text_only" && saved.value.sceneDocument === null,
      "a doubt turn is saved text-only",
    );
    const persisted: Pick<StoredTurn, "sceneArtifacts" | "segments"> = {
      sceneArtifacts: saved.value.sceneArtifacts,
      segments: saved.value.segments.map((segment) => ({
        id: `saved-${segment.orderIndex}`,
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command as StoredSegment["command"],
        audioUrl: null,
        durationMs: null,
        timings: null,
      })),
    };
    assert(
      storedTurnContinuesBoard(persisted),
      "the turn the server saves must still read as a continuation",
    );

    const unmarked = await canonicalizeTurnSceneMetadata({
      question: "What is a free body diagram?",
      visualStatus: "text_only",
      sceneArtifacts: { forged: { trusted: true } },
      segments,
    });
    assert(
      unmarked.ok && unmarked.value.sceneArtifacts === null,
      "a text-only turn with no marker, failure or code lesson must still save no artifacts",
    );

    const forgedMarker = await canonicalizeTurnSceneMetadata({
      question: "Doubt: forged",
      visualStatus: "text_only",
      sceneArtifacts: { boardContinuation: { schemaVersion: "board-continuation/v0", lessonQuestion: LESSON } },
      segments,
    });
    assert(
      forgedMarker.ok && forgedMarker.value.sceneArtifacts === null,
      "a marker the client cannot prove is well formed must be dropped",
    );
  }

  // --- the live turn in a rewind ------------------------------------------
  {
    const recorded: RecordedSegmentPayload[] = [0, 1].map((index) => ({
      orderIndex: index + 3,
      narration: `step ${index}`,
      spokenText: `step ${index}`,
      command: serializeSegmentCommands([write(`row ${index}`)], { trustedDiagramGeometry: false }),
      audioBytes: null,
      durationMs: 700,
      timings: null,
    }));
    const opening = buildLiveTurnSegments(recorded, () => null);
    assert(
      parseStoredSegmentCommands(opening[0]!.command)[0]?.type === "CLEAR" && opening.length === 3,
      "a live lesson still rewinds from a fresh page",
    );
    const continuing = buildLiveTurnSegments(recorded, () => null, { continuesBoard: true });
    assert(
      continuing.length === recorded.length &&
        continuing.every((segment, index) => segment.orderIndex === index) &&
        continuing.every((segment) =>
          parseStoredSegmentCommands(segment.command).every((command) => command.type !== "CLEAR"),
        ),
      "a live doubt rewinds with no CLEAR and dense order indexes",
    );

    const live = buildLectureTimeline({
      storedTurns: [lesson],
      liveSegments: recorded,
      liveQuestion: LESSON,
      audioUrlFor: () => null,
      liveContinuesBoard: true,
    });
    const liveTurn = live.turns[live.turns.length - 1]!;
    const liveIndex = live.turns.length - 1;
    assert(
      liveTurn.id === "live-turn" && storedTurnContinuesBoard(liveTurn),
      "a live doubt must read as a continuation to the replay engine",
    );
    assert(
      storedTurnPageQuestion(liveTurn) === LESSON,
      "a live doubt's page is the lesson's page",
    );
    assert(
      live.timeline.cues
        .filter((cue) => cue.turnIndex === liveIndex)
        .every((cue) => cue.commands.every((command) => command.type !== "CLEAR")),
      "rewinding into a live doubt must never wipe the lesson's page",
    );
    assert(
      pageTurnsEndingAt(live.turns).map((entry) => entry.id).join(",") === "turn-0,live-turn",
      "a live doubt shares the page of the lesson it continues",
    );

    const fresh = buildLectureTimeline({
      storedTurns: [lesson],
      liveSegments: recorded,
      liveQuestion: LESSON,
      audioUrlFor: () => null,
    });
    const freshTurn = fresh.turns[fresh.turns.length - 1]!;
    assert(
      !storedTurnContinuesBoard(freshTurn) && freshTurn.sceneArtifacts === null,
      "a live lesson is a page of its own, exactly as before",
    );
  }

  // --- the surfaces that rebuild the board consult the marker --------------
  const root = resolve(import.meta.dirname, "../..");
  const read = (path: string) => readFileSync(resolve(root, path), "utf8");
  // Both anchors are checked before slicing. A missing start makes `slice(-1)`
  // hand back the file's last character; a missing end silently widens the
  // slice to the rest of the file, where a later function can satisfy the
  // assertion and the gate passes on code it was never meant to read.
  const between = (path: string, start: string, end: string): string => {
    const source = read(path);
    const from = source.indexOf(start);
    assert(from >= 0, `${path}: start anchor "${start}" is gone; repoint this gate, do not relax it`);
    const to = source.indexOf(end, from + start.length);
    assert(to > from, `${path}: end anchor "${end}" is gone; repoint this gate, do not relax it`);
    return source.slice(from, to);
  };

  {
    const sync = between(
      "features/tutor-session/hooks/useReplay.ts",
      "const syncReplayTurn = useCallback(",
      "const runReplaySegmentDraw = useCallback(",
    );
    const guard = sync.indexOf("storedTurnContinuesBoard(turn)");
    assert(guard >= 0, "replay must keep the page's figure and code panel through a doubt");
    assert(
      guard < sync.indexOf("restoreVerifiedDiagramFromTurn(turn)") &&
        guard < sync.indexOf("controller.commit(plan)"),
      "replay must check for a continuing turn before it rebuilds the figure or the code panel",
    );
  }

  {
    const restore = between(
      "features/tutor-session/hooks/useBoardSession.ts",
      "const restoreBoardFromApi = useCallback(",
      "const restoreBoardFromApiRef = useRef(restoreBoardFromApi);",
    );
    assert(
      restore.includes("storedTurnContinuesBoard(turn)"),
      "restore must recognise a doubt answered on the lesson's page",
    );
    assert(
      restore.includes("if (restoredInk && !continuesPage)"),
      "restore must not split a lesson and its doubts into two notes pages",
    );
    assert(
      restore.includes("liveQuestionRef.current = storedTurnPageQuestion(turn)"),
      "a restored doubt's page must keep the lesson's question",
    );
    const keep = restore.indexOf("if (!continuesPage) {");
    assert(
      keep >= 0 && keep < restore.indexOf("restoreVerifiedDiagramFromTurn(turn)"),
      "restore must keep the page's figure and code panel through a doubt",
    );
  }

  {
    const edge = between(
      "features/tutor-session/hooks/useLectureRewind.ts",
      "const measureLiveEdge = useCallback(",
      "// --- rewind runtime",
    );
    assert(
      edge.includes("liveContinuesBoard:"),
      "rewinding a live doubt must keep the lesson's page",
    );
  }

  {
    const exporter = between(
      "features/tutor-session/hooks/useLectureExport.ts",
      "const downloadLectureMp4 = useCallback(",
      "return {",
    );
    assert(
      exporter.includes("latestLecturePage(") && !exporter.includes("latestCompletedTurn("),
      "the video export must record the last page, not the last turn",
    );
    assert(exporter.includes("pageTurns,"), "the export must hand the whole page to the encoder");
    assert(
      read("lib/lecture-export/exportLectureMp4.ts").includes("buildReplayTimeline(pageTurns)"),
      "the encoder must draw every turn of the page",
    );
  }

  console.log("verify-board-continuation: ok");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
