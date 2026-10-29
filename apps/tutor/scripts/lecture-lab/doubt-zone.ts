/**
 * The doubt lab's zone sequence check ($0, in process, no server, no model).
 *
 * "Saved equals live" for the figure in the diagram zone. A page such as
 * [lesson text only, doubt draws, resume, plain doubt] is played twice:
 *
 * - live: the zone the live hook holds, through its own pure functions
 *   (`doubtFigureNeedSkip` with the board's ink, the zone stash, the resume's
 *   `returnZoneStash` on a fake whiteboard);
 * - stored: each turn saved through the real server canonicalizer
 *   (`canonicalizeTurnSceneMetadata` with the real doubt figure page check),
 *   then `pageFigureAt` per turn (what replay, restore and export read) and
 *   `syncStoredPageFigure` turn by turn on a fake whiteboard (what they do).
 *
 * Per turn the zone figure's `figureFingerprint` must agree across all three.
 * The figures are the precheck's: engine output on recorded plans, never
 * written by hand.
 */
import { getSegmentCommands, serializeSegmentCommands, type DrawCommand, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { ProblemAuthorityV1Response } from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { pageFigureAt } from "../../lib/boards/pageFigure";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import type { BoardLayoutState } from "../../features/tutor-session/types";
import { EMPTY_ZONE_STASH, returnZoneStash, type ZoneStash } from "../../features/tutor-session/lib/scene/figureSwap";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { storedLessonFigurePresentation, syncStoredPageFigure } from "../../features/tutor-session/lib/replay/pageFigureSync";
import {
  doubtFigureNeedSkip,
  doubtFigurePlannedScene,
  figureFingerprint,
  zoneInkOccupied,
  type DoubtFigureDrawn,
} from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { doubtFigureTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";
import { lessonFiguresArtifact, type PlannedLessonFigure } from "../../features/tutor-session/lib/turn/lessonFigurePlan";
import { doubtPageCheck, stored, teachingRow } from "../verify/fixtures/doubtFigureScene";
import type { ZoneEvidence, ZoneSide } from "./doubtGrade";
import { boardLayoutFor } from "./doubt-precheck";

/** A verified figure as the lab planned it: what the client saves and what the zone shows. */
export interface ZoneFigure {
  question: string;
  turnPlan: TurnPlanV3;
  authority: ProblemAuthorityV1Response | null;
  representation: SelectedRepresentation;
  presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] };
}

export type ZoneSequenceKind = "empty_zone" | "swap" | "resume_drawn" | "lesson_advance";

export const ZONE_SEQUENCES: Record<ZoneSequenceKind, string> = {
  empty_zone: "L text, D fig, R, D plain",
  swap: "L fig, D fig, R, D plain",
  resume_drawn: "L text, R1 draws, D fig, R2, D plain",
  lesson_advance: "L fig + advance figure_2, D plain, R, D plain",
};

const IDS = ["a", "b", "c", "d", "e", "f"].map((digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`);
const write = (text: string): DrawCommand => ({ type: "WRITE", params: [90, 142], text, charPosition: 0, narrationBefore: "" });
const focus = (id: string): DrawCommand => ({ type: "FOCUS", params: [], text: id, charPosition: 0, narrationBefore: "" });

function introRows(segments: readonly TutorSegment[]): SubmittedTurnSceneMetadata["segments"] {
  return segments.map((segment, orderIndex) => ({
    orderIndex, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
  }));
}

function sceneMetadata(figure: ZoneFigure, question: string, extraArtifacts: Record<string, unknown>, rows: SubmittedTurnSceneMetadata["segments"]): SubmittedTurnSceneMetadata {
  const drawn: DoubtFigureDrawn = { status: "drawn", question: figure.question, turnPlan: figure.turnPlan, authority: figure.authority,
    representation: figure.representation, presentation: figure.presentation, elapsedMs: 0 };
  const scene = doubtFigurePlannedScene(drawn);
  const intro = introRows(figure.presentation.introSegments);
  return {
    question, ...scene, sceneArtifacts: { ...(scene.sceneArtifacts as Record<string, unknown>), ...extraArtifacts },
    segments: [...intro, ...rows.map((row, at) => ({ ...row, orderIndex: intro.length + at }))],
  };
}

const textMetadata = (question: string, artifacts: Record<string, unknown> | null, rows: SubmittedTurnSceneMetadata["segments"]): SubmittedTurnSceneMetadata => ({
  question, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
  sceneArtifacts: artifacts, segments: rows,
});

async function save(metadata: SubmittedTurnSceneMetadata, options: Parameters<typeof canonicalizeTurnSceneMetadata>[1], where: string) {
  const saved = await canonicalizeTurnSceneMetadata(metadata, options);
  if (!saved.ok) throw new Error(`${where} did not save: ${saved.error}`);
  return saved.value;
}

function fakeBoard(): { wb: WhiteboardHandle; executeCommand: () => Promise<void> } {
  const wb = { eraseSceneInk: async () => {}, erasePinnedInk: () => {} } as unknown as WhiteboardHandle;
  return { wb, executeCommand: async () => {} };
}

const fingerprint = (diagram: VerifiedDiagram | null | undefined) => diagram ? figureFingerprint(diagram) : "";

/**
 * Play one page sequence live and stored. `doubt` null makes the doubt a
 * plain one (it points, draws nothing); `extra` is figure_2 for lesson_advance.
 */
export async function zoneSequence(input: {
  kind: ZoneSequenceKind;
  lessonQuestion: string;
  doubtTitle: string;
  /** The lesson's figure; for empty_zone and resume_drawn the opener is saved text only regardless. */
  lesson: ZoneFigure | null;
  doubt: DoubtFigureDrawn | null;
  extra?: PlannedLessonFigure | null;
  /** The lesson's work rows (the live occupancy check reads them). */
  rows: readonly string[];
}): Promise<ZoneEvidence> {
  const { kind, lessonQuestion, doubtTitle, lesson, doubt } = input;
  const evidence: ZoneEvidence = { sequence: ZONE_SEQUENCES[kind], live: [], stored: [], storedEqualsLive: false,
    afterResume: { live: "other", stored: "other" }, drawnOverInk: false, error: null };
  try {
    const lessonOpensWithFigure = kind === "swap" || kind === "lesson_advance";
    if ((lessonOpensWithFigure || kind === "resume_drawn") && !lesson) throw new Error(`${kind} needs a lesson figure`);
    if (kind === "lesson_advance" && !input.extra) throw new Error("lesson_advance needs figure_2");
    if (kind === "empty_zone" && !doubt) throw new Error("empty_zone needs a doubt figure");
    const continuation = boardContinuationArtifacts(lessonQuestion);
    const turns: StoredTurn[] = [];
    const push = (id: string, question: string, saved: Awaited<ReturnType<typeof save>>, opts: { opensOnClear: boolean; kind: StoredTurn["kind"] }) => {
      turns.push(stored(id, turns.length, question, saved, opts));
    };

    // Live: the zone and its stash, turn by turn.
    const liveZones: Array<VerifiedDiagram | null> = [];
    let liveZone: VerifiedDiagram | null = null;
    let liveZoneTurnId: string | null = null;
    let stash: ZoneStash | null = null;
    const layout: BoardLayoutState = boardLayoutFor({ rows: input.rows, diagram: lessonOpensWithFigure ? lesson!.presentation.diagram : null, kind: "scene" });
    const freshLesson = () => structuredClone(lesson!.presentation);

    // The opener.
    if (lessonOpensWithFigure) {
      const artifacts: Record<string, unknown> = {};
      const rows = [teachingRow(0, "Look at the figure.", [write("given")])];
      if (kind === "lesson_advance") {
        artifacts.lessonFigures = lessonFiguresArtifact([input.extra!]);
        rows.push(teachingRow(1, "Now the next view.", [focus("figure_2")]));
      }
      push(IDS[0]!, lessonQuestion, await save(sceneMetadata(lesson!, lessonQuestion, artifacts, rows), { lessonFiguresEnabled: kind === "lesson_advance" }, "the lesson"), { opensOnClear: true, kind: "lesson" });
      liveZone = freshLesson().diagram;
      liveZoneTurnId = IDS[0]!;
    } else {
      push(IDS[0]!, lessonQuestion, await save(textMetadata(lessonQuestion, null, [teachingRow(0, "Start here.", input.rows.slice(0, 3).map(write))]), {}, "the text only lesson"), { opensOnClear: true, kind: "lesson" });
    }
    liveZones.push(liveZone);
    // The advance takes the zone to figure 2 for every later turn.
    if (kind === "lesson_advance") liveZone = structuredClone(input.extra!.presentation.diagram);

    // resume_drawn: the opener was stopped before its figure; the first resume draws it from its own trusted rows.
    if (kind === "resume_drawn") {
      push(IDS[1]!, lessonQuestion, await save(sceneMetadata(lesson!, lessonQuestion, continuation, [teachingRow(0, "Here is the figure.", [write("so")])]), { kind: "resume" }, "the resume that draws"), { opensOnClear: false, kind: "resume" });
      liveZone = freshLesson().diagram;
      liveZoneTurnId = IDS[1]!;
      liveZones.push(liveZone);
    }

    // The doubt: the live skip rules on the board as it stands, then its own figure or none.
    const doubtId = IDS[turns.length]!;
    const skip = doubt ? doubtFigureNeedSkip({
      granted: true, codeBoard: false, markedFigureIds: [], zoneFigure: liveZone, zoneReturnable: Boolean(liveZone),
      zoneEmpty: !liveZone, zoneOccupied: !liveZone && zoneInkOccupied(layout),
    }) : "plain";
    if (doubt && !skip) {
      evidence.drawnOverInk = !liveZone && zoneInkOccupied(layout);
      stash = liveZone
        ? { diagram: liveZone, presentation: kind === "lesson_advance"
          ? structuredClone(input.extra!.presentation) : freshLesson(), turnId: liveZoneTurnId, ...(kind === "lesson_advance" ? { figureId: "figure_2" as const } : {}) }
        : { ...EMPTY_ZONE_STASH };
      const scene = doubtFigureTurnScene(doubtFigurePlannedScene(doubt), lessonQuestion, liveZoneTurnId);
      const doubtFigure: ZoneFigure = { question: doubt.question, turnPlan: doubt.turnPlan, authority: doubt.authority,
        representation: doubt.representation, presentation: doubt.presentation };
      const metadata = sceneMetadata(doubtFigure, doubtTitle, scene.sceneArtifacts as Record<string, unknown>, [teachingRow(0, "See this.", [write("note")])]);
      push(doubtId, doubtTitle, await save(metadata, { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck(turns) }, "the doubt figure"), { opensOnClear: false, kind: "doubt" });
      liveZone = structuredClone(doubt.presentation.diagram);
    } else {
      push(doubtId, doubtTitle, await save(textMetadata(doubtTitle, continuation, [teachingRow(0, "See this.", [write("note")])]), { kind: "doubt" }, "the plain doubt"), { opensOnClear: false, kind: "doubt" });
    }
    liveZones.push(liveZone);

    // The resume: the stash comes back (or the zone empties), as live returns it.
    const resumeMetadata = lesson && kind !== "empty_zone"
      ? sceneMetadata(lesson, lessonQuestion, continuation, [teachingRow(0, "Back to the lesson.", [write("then")])])
      : textMetadata(lessonQuestion, continuation, [teachingRow(0, "Back to the lesson.", [write("then")])]);
    // A resume after the figure was drawn carries the scene but not its trusted rows.
    if (resumeMetadata.visualStatus === "validated") resumeMetadata.segments = [teachingRow(0, "Back to the lesson.", [write("then")])];
    push(IDS[turns.length]!, lessonQuestion, await save(resumeMetadata, { kind: "resume" }, "the resume"), { opensOnClear: false, kind: "resume" });
    if (stash) {
      const board = fakeBoard();
      const back = await returnZoneStash(board.wb, { rects: [...layout.rects], nextY: layout.nextY }, stash, [], { shouldCancel: () => false, executeCommand: board.executeCommand });
      if (back.cancelled) throw new Error("the live return was cancelled");
      liveZone = back.diagram;
      stash = null;
    }
    liveZones.push(liveZone);

    // A plain doubt after the resume observes the zone the resume left.
    push(IDS[turns.length]!, "Doubt: and then?", await save(textMetadata("Doubt: and then?", continuation, [teachingRow(0, "Then.", [write("then")])]), { kind: "doubt" }, "the last doubt"), { opensOnClear: false, kind: "doubt" });
    liveZones.push(liveZone);

    // Stored: what every surface reads, and what syncStoredPageFigure does turn by turn.
    const storedZones = turns.map((_, index) => {
      const at = pageFigureAt(turns, index);
      return at.sourceIndex === null ? null : storedLessonFigurePresentation(turns[at.sourceIndex]!, at.figureId).diagram;
    });
    const replayZones: Array<VerifiedDiagram | null> = [];
    const board = fakeBoard();
    let replayZone: VerifiedDiagram | null = storedZones[0] ?? null;
    for (let index = 0; index < turns.length; index += 1) {
      if (index > 0) {
        const synced = await syncStoredPageFigure({ turns, turnIndex: index, whiteboard: board.wb, executeCommand: board.executeCommand, shouldCancel: () => false });
        if (synced.changed) replayZone = synced.diagram;
        // An advance is the executor's, at its FOCUS; the zone the turn starts on names it.
        const at = pageFigureAt(turns, index);
        if (!synced.changed && at.figureId !== "figure_1" && at.sourceIndex !== null) replayZone = storedLessonFigurePresentation(turns[at.sourceIndex]!, at.figureId).diagram;
      }
      replayZones.push(replayZone);
    }

    const sideOf = (diagram: VerifiedDiagram | null): ZoneSide => {
      if (!diagram) return "empty";
      const print = fingerprint(diagram);
      if (doubt && print === fingerprint(doubt.presentation.diagram)) return "doubt";
      if (lesson && print === fingerprint(lesson.presentation.diagram)) return "lesson";
      if (input.extra && print === fingerprint(input.extra.presentation.diagram)) return "lesson";
      return "other";
    };
    evidence.live = liveZones.map(sideOf);
    evidence.stored = storedZones.map(sideOf);
    const equal = liveZones.length === storedZones.length && liveZones.every((zone, index) =>
      fingerprint(zone) === fingerprint(storedZones[index]) && fingerprint(zone) === fingerprint(replayZones[index]));
    evidence.storedEqualsLive = equal;
    evidence.replay = replayZones.map(sideOf);
    const last = liveZones.length - 1;
    evidence.afterResume = { live: evidence.live[last]!, stored: evidence.stored[last]! };
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
  }
  return evidence;
}
