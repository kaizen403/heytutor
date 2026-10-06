/**
 * What a download covers: the whole board from its start to now.
 *
 * Saved turns plus the live (or just stopped) turn's finished steps, with
 * their clips still in memory. A question's live tail opens its own page the
 * way the save stores it; a doubt's tail continues the page. Steps without a
 * clip export as silence instead of refusing the file. The snapshot is a copy,
 * so the live lesson cannot change a running export.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import type { StoredSegment, StoredTurn } from "../../lib/boards/boardsClient";
import {
  boardContinuationArtifacts,
  storedTurnContinuesBoard,
} from "../../lib/boards/boardContinuation";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { buildLectureAudioTrack } from "../../lib/lecture-export/lectureAudioTrack";
import {
  buildLectureExportSource,
  lectureExportCueBytes,
  lectureExportHasContent,
  lessonDownloadFilename,
  type LiveExportSegment,
  type LiveExportTurn,
} from "../../lib/lecture-export/lectureExportSource";

const write = (text: string): DrawCommand => ({
  type: "WRITE",
  text,
  params: [90, 142],
  charPosition: 0,
  narrationBefore: "",
});
const clear: DrawCommand = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };

const segment = (
  orderIndex: number,
  narration: string,
  options: { audioUrl?: string | null; durationMs?: number | null; command?: DrawCommand } = {},
): StoredSegment => ({
  id: `seg-${orderIndex}`,
  orderIndex,
  narration,
  spokenText: narration,
  command: serializeSegmentCommands([options.command ?? write(narration || "x")], {
    trustedDiagramGeometry: false,
  }),
  audioUrl: options.audioUrl ?? null,
  durationMs: options.durationMs === undefined ? 1_000 : options.durationMs,
  timings: null,
});

const turn = (
  id: string,
  orderIndex: number,
  question: string,
  segments: StoredSegment[],
  extra: Partial<StoredTurn> & { status?: string } = {},
): StoredTurn => ({
  id,
  orderIndex,
  question,
  rawResponse: "",
  speedMultiplier: 1,
  traceId: null,
  sceneDocument: null,
  sceneEngineVersion: null,
  validationReport: null,
  visualStatus: null,
  sceneArtifacts: null,
  segments,
  ...extra,
});

const saved = [
  turn("t2", 2, "find a", [
    segment(0, "", { command: clear, durationMs: 50 }),
    segment(1, "the block slides", { audioUrl: "/api/media?key=a" }),
  ]),
  turn("t1", 1, "find v", [
    segment(0, "", { command: clear, durationMs: 50 }),
    segment(1, "so v equals sixty", { audioUrl: "/api/media?key=v" }),
  ]),
];

const liveSegment = (
  orderIndex: number,
  narration: string,
  audioBytes: Uint8Array | null,
  durationMs: number | null = 900,
): LiveExportSegment => ({ ...segment(orderIndex, narration, { durationMs }), audioBytes });

const firstFirstCommand = (t: StoredTurn): DrawCommand["type"] | undefined =>
  parseStoredSegmentCommands([...t.segments].sort((a, b) => a.orderIndex - b.orderIndex)[0]?.command ?? null)[0]
    ?.type;

async function main(): Promise<void> {
  {
    // A live question after two saved lessons: the whole board, oldest first,
    // the live tail last on its own page.
    const clip = new Uint8Array([1, 2, 3]);
    const live: LiveExportTurn = turn("live-1", 3, "find t", [], { status: "live" }) as LiveExportTurn;
    live.segments = [liveSegment(0, "time is distance over speed", clip), liveSegment(1, "so t is two", null)];

    const source = buildLectureExportSource({ storedTurns: saved, liveTurn: live });
    assert.deepEqual(
      source.turns.map((t) => t.id),
      ["t1", "t2", "live-1"],
      "every page so far, oldest first, the live lesson last",
    );
    assert.equal(source.partial, true, "a live lesson makes a partial file");
    assert.equal(source.liveTurnId, "live-1");
    const tail = source.turns[2]!;
    assert.equal(firstFirstCommand(tail), "CLEAR", "a live question opens its own page, as the save stores it");
    assert.equal(storedTurnContinuesBoard(tail), false);
    assert.equal(tail.segments.length, 3, "the epoch CLEAR plus both finished steps");
    assert.deepEqual(tail.segments.map((s) => s.orderIndex), [0, 1, 2]);
    assert.equal("status" in tail, false, "the export turn is a plain stored turn");

    // The clip is read from memory; a step with none is silence for its length.
    const timeline = buildReplayTimeline(source.turns);
    const cueBytes = lectureExportCueBytes(source);
    const liveCues = timeline.cues.filter((cue) => cue.turnIndex === 2);
    assert.equal(liveCues.length, 3);
    assert.deepEqual([...(cueBytes(liveCues[1]!) ?? [])], [1, 2, 3], "the live clip is found by its cue");
    assert.equal(cueBytes(liveCues[2]!), null, "a step without a clip has no bytes");
    const fetched: string[] = [];
    const track = await buildLectureAudioTrack({
      cues: liveCues,
      sampleRate: 1_000,
      cueBytes,
      fetchBytes: async (url) => {
        fetched.push(url);
        return null;
      },
      decodeBytes: async () => ({ channels: [new Float32Array([0.5])], sampleRate: 1_000 }),
    });
    assert.deepEqual(fetched, [], "live steps are never fetched");
    assert.equal(track.voicedCues, 1);
    assert.equal(track.missingAudioCues, 1, "the step without a clip is silence, not a refusal");
    assert.equal(track.channels[0]?.length, 50 + 900 + 900, "silence lasts the step's duration");

    // The snapshot is a copy: the live lesson moving on changes nothing.
    clip[0] = 99;
    live.segments.push(liveSegment(2, "and that is the answer", null));
    assert.deepEqual([...(cueBytes(liveCues[1]!) ?? [])], [1, 2, 3], "the clip bytes were copied");
    assert.equal(source.turns[2]!.segments.length, 3, "steps added after the click are not in this file");
  }

  {
    // A live doubt continues the lesson's page: no CLEAR, the marker kept.
    const doubt = turn("doubt-1", 3, "why sixty?", [], {
      sceneArtifacts: boardContinuationArtifacts("find a"),
    }) as LiveExportTurn;
    doubt.segments = [liveSegment(0, "because the lens formula says so", null)];
    const source = buildLectureExportSource({ storedTurns: saved, liveTurn: doubt });
    const tail = source.turns[2]!;
    assert.notEqual(firstFirstCommand(tail), "CLEAR", "a doubt never wipes the page it answers on");
    assert.equal(storedTurnContinuesBoard(tail), true, "the doubt continues the lesson's page");
  }

  {
    // A tail that already opens on its CLEAR is not given a second one.
    const live = turn("live-2", 3, "find t", [], {}) as LiveExportTurn;
    live.segments = [
      { ...segment(0, "", { command: clear, durationMs: 50 }), audioBytes: null },
      liveSegment(1, "time", null),
    ];
    const tail = buildLectureExportSource({ storedTurns: saved, liveTurn: live }).turns[2]!;
    assert.equal(tail.segments.length, 2);
    assert.equal(
      tail.segments.filter((s) => parseStoredSegmentCommands(s.command)[0]?.type === "CLEAR").length,
      1,
    );
  }

  {
    // A checkpointed lesson: the live turn replaces its own saved row.
    const checkpoint = turn("t2", 2, "find a", saved[0]!.segments.slice(0, 1), { status: "live" });
    const live = turn("t2", 2, "find a", [], { status: "stopped" }) as LiveExportTurn;
    live.segments = [
      { ...saved[0]!.segments[0]!, audioBytes: null },
      liveSegment(1, "the block slides", new Uint8Array([7])),
      liveSegment(2, "with friction", new Uint8Array([8])),
    ];
    const source = buildLectureExportSource({ storedTurns: [saved[1]!, checkpoint], liveTurn: live });
    assert.deepEqual(source.turns.map((t) => t.id), ["t1", "t2"], "no duplicate of the checkpointed lesson");
    assert.equal(source.turns[1]!.segments.length, 3, "the live copy, with its newest steps, wins");
    assert.equal(source.partial, true, "a stopped lesson makes a partial file");
  }

  {
    // Zero length clips are silence, never decoded.
    const live = turn("live-3", 3, "q", [], {}) as LiveExportTurn;
    live.segments = [liveSegment(0, "spoken", new Uint8Array(0))];
    const source = buildLectureExportSource({ storedTurns: [], liveTurn: live });
    assert.equal(source.audioBytes.size, 0, "an empty clip is not held");
    assert.equal(lectureExportHasContent(source), true, "the first lesson on a board downloads after Stop");
  }

  {
    // Saved turns only: partial only while the last one is live or stopped.
    const done = buildLectureExportSource({ storedTurns: saved, liveTurn: null });
    assert.equal(done.partial, false, "a finished board makes a whole file");
    assert.deepEqual(done.turns.map((t) => t.id), ["t1", "t2"]);
    const stopped = buildLectureExportSource({
      storedTurns: [saved[1]!, { ...saved[0]!, status: "stopped" } as StoredTurn],
    });
    assert.equal(stopped.partial, true, "a reopened stopped lesson makes a partial file");
    const complete = turn("live-4", 3, "q", [], { status: "complete" }) as LiveExportTurn;
    complete.segments = [liveSegment(0, "done", null)];
    assert.equal(buildLectureExportSource({ storedTurns: saved, liveTurn: complete }).partial, false);
  }

  {
    // An empty live turn is not a page.
    const empty = turn("live-5", 3, "q", [], { status: "live" }) as LiveExportTurn;
    empty.segments = [];
    const source = buildLectureExportSource({ storedTurns: [], liveTurn: empty });
    assert.equal(source.turns.length, 0);
    assert.equal(lectureExportHasContent(source), false, "nothing drawn or said means nothing to download");
  }

  assert.equal(lessonDownloadFilename("Find v for the lens", "mp4", false), "Find v for the lens.mp4");
  assert.equal(
    lessonDownloadFilename("Find v for the lens", "mp4", true),
    "Find v for the lens (so far).mp4",
    "a partial file says so in its name",
  );
  assert.equal(lessonDownloadFilename("Forces", "pdf", true), "Forces (so far).pdf");
  assert.equal(lessonDownloadFilename("a/b: c?", "webm", false), "a b c.webm");
  assert.equal(lessonDownloadFilename("   ", "pdf", false), "Lesson.pdf");

  {
    // The hook reads this source and refuses nothing for want of audio or an
    // idle phase. Both anchors are checked.
    const hook = readFileSync(
      resolve(import.meta.dirname, "../../features/tutor-session/hooks/useLectureExport.ts"),
      "utf8",
    );
    const between = (start: string, end: string): string => {
      const from = hook.indexOf(start);
      assert.ok(from >= 0, `useLectureExport.ts: start anchor "${start}" is gone; repoint this gate`);
      const to = hook.indexOf(end, from + start.length);
      assert.ok(to > from, `useLectureExport.ts: end anchor "${end}" is gone; repoint this gate`);
      return hook.slice(from, to);
    };
    const snapshot = between("const snapshotSource = useCallback(", "const fileTitle = useCallback(");
    assert.ok(snapshot.includes("buildLectureExportSource("), "downloads read the whole board source");
    assert.ok(snapshot.includes("getLiveTurn?.()"), "downloads include the live turn");
    const video = between("const downloadVideo = useCallback(", "const downloadNotesPdf = useCallback(");
    assert.ok(video.includes("lectureExportCueBytes(source)"), "live clips are read from memory");
    assert.equal(/phase\s*===\s*"idle"/.test(video), false, "a video downloads in any phase");
    assert.equal(/ExportableAudio|NO_AUDIO/.test(video), false, "a page without audio is not refused");
    const gating = between("const busy = downloadIsBusy(downloadState);", "const { raceWithCancel");
    assert.equal(/phase\s*===\s*"idle"/.test(gating), false, "the buttons are not gated on an idle lesson");
  }

  console.log("verify-lecture-export-source: whole board to now, live tail pages, silence for missing clips");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
