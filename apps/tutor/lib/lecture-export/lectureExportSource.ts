/**
 * What a download covers: the whole board from its first lesson to now.
 *
 * Saved turns come from the board. The lesson on the board right now (live, or
 * just stopped and not yet saved) comes from `getLiveTurn()` with its finished
 * steps and their clips still in memory. The source is a snapshot taken at the
 * click: nothing the live lesson does afterwards changes a running export.
 */
import { parseStoredSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import type { StoredSegment, StoredTurn } from "@/lib/boards/boardsClient";
import { boardContinuationOf } from "@/lib/boards/boardContinuation";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import type { LectureContainer } from "./lectureExportProfile";

/** A finished step of the live turn, with its clip in memory when it has one. */
export type LiveExportSegment = StoredSegment & { audioBytes?: Uint8Array | null };

/** The live or just stopped turn, shaped like a saved one. */
export type LiveExportTurn = Omit<StoredTurn, "segments"> & {
  segments: LiveExportSegment[];
  status?: string | null;
};

export type LectureExportSource = {
  /** Every turn on the board, oldest first, the live turn last. */
  turns: StoredTurn[];
  /** Clips held in memory, by segment id. Copies, owned by the source. */
  audioBytes: Map<string, Uint8Array>;
  /** The lesson is live or stopped, so the file ends at the current point. */
  partial: boolean;
  /** Id of the live turn when it is part of the source. */
  liveTurnId: string | null;
};

const PARTIAL_STATUSES = new Set(["live", "stopped"]);

/** Stored turns gain a status with progressive saves; older rows have none. */
export function storedTurnIsPartial(turn: unknown): boolean {
  if (typeof turn !== "object" || turn === null) return false;
  const status = (turn as { status?: unknown }).status;
  return typeof status === "string" && PARTIAL_STATUSES.has(status);
}

function segmentHasContent(segment: Pick<StoredSegment, "narration" | "command">): boolean {
  return segment.narration.trim().length > 0 || parseStoredSegmentCommands(segment.command).length > 0;
}

/** True when the source would draw or say anything at all. */
export function lectureExportHasContent(source: Pick<LectureExportSource, "turns">): boolean {
  return source.turns.some((turn) => turn.segments.some(segmentHasContent));
}

function opensOnBoardClear(segments: readonly StoredSegment[]): boolean {
  let first: StoredSegment | null = null;
  for (const segment of segments) {
    if (!first || segment.orderIndex < first.orderIndex) first = segment;
  }
  if (!first) return false;
  const commands = parseStoredSegmentCommands(first.command);
  return commands.length === 1 && commands[0]?.type === "CLEAR";
}

const BOARD_EPOCH_CLEAR: DrawCommand = {
  type: "CLEAR",
  params: [],
  charPosition: 0,
  narrationBefore: "",
};

export function liveExportSegmentId(turnId: string, orderIndex: number): string {
  return `live:${turnId}:${orderIndex}`;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/**
 * The live turn as the save would store it: a question opens its own page
 * with the runtime's CLEAR (as `withBoardEpochSegment` persists it), a doubt
 * carries the continuation marker and continues the page. A live turn that
 * already has either is taken as it is.
 */
function liveTurnAsStored(
  live: LiveExportTurn,
  audioBytes: Map<string, Uint8Array>,
): StoredTurn {
  const ordered = [...live.segments].sort((a, b) => a.orderIndex - b.orderIndex);
  const needsEpoch =
    boardContinuationOf(live.sceneArtifacts) === null && !opensOnBoardClear(ordered);
  const epoch: LiveExportSegment[] = needsEpoch
    ? [
        {
          id: "",
          orderIndex: 0,
          narration: "",
          spokenText: "",
          command: BOARD_EPOCH_CLEAR,
          audioUrl: null,
          durationMs: 50,
          timings: null,
        },
      ]
    : [];
  const segments = [...epoch, ...ordered].map((segment, index): StoredSegment => {
    const orderIndex = needsEpoch ? index : segment.orderIndex;
    const id = liveExportSegmentId(live.id, orderIndex);
    if (segment.audioBytes && segment.audioBytes.length > 0) {
      audioBytes.set(id, copyBytes(segment.audioBytes));
    }
    return {
      id,
      orderIndex,
      narration: segment.narration,
      spokenText: segment.spokenText,
      command: segment.command,
      audioUrl: segment.audioUrl,
      durationMs: segment.durationMs,
      timings: segment.timings,
    };
  });
  const stored: StoredTurn & { status?: unknown } = { ...live, segments };
  delete stored.status;
  return stored;
}

/**
 * Snapshot of the board from its start to now. The live turn replaces a saved
 * row with the same id (a checkpointed lesson), since it holds the newest
 * steps and their clips.
 */
export function buildLectureExportSource(input: {
  storedTurns: readonly StoredTurn[];
  liveTurn?: LiveExportTurn | null;
}): LectureExportSource {
  const live = input.liveTurn && input.liveTurn.segments.some(segmentHasContent)
    ? input.liveTurn
    : null;
  const stored = [...input.storedTurns]
    .filter((turn) => !live || turn.id !== live.id)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((turn) => ({ ...turn, segments: [...turn.segments] }));
  const audioBytes = new Map<string, Uint8Array>();
  const turns: StoredTurn[] = [...stored];
  if (live) {
    turns.push(liveTurnAsStored(live, audioBytes));
  }
  const last = turns[turns.length - 1];
  const partial =
    (live !== null && live.status !== "complete") ||
    (last !== undefined && storedTurnIsPartial(last));
  return { turns, audioBytes, partial, liveTurnId: live?.id ?? null };
}

/** Reads one in-tab clip. Started at once, so a URL revoked later is already being read. */
async function readLocalClip(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Copies the bytes of the snapshot's in-tab clips (`blob:` URLs) into the
 * snapshot. A save answer can swap a turn's URLs and the next lesson revokes
 * the old ones, while a running export reads its cues one at a time: without
 * the copy, later cues would turn silent. Call it at the click, before any
 * await: every read starts synchronously. A clip that cannot be read stays a
 * URL (and exports as silence if that fails too). Server clips are untouched.
 */
export function captureLocalClips(
  source: Pick<LectureExportSource, "turns" | "audioBytes">,
  read: (url: string) => Promise<Uint8Array | null> = readLocalClip,
): Promise<void> {
  const reads: Array<Promise<void>> = [];
  for (const turn of source.turns) {
    for (const segment of turn.segments) {
      const url = segment.audioUrl;
      if (!url || !url.startsWith("blob:") || source.audioBytes.has(segment.id)) continue;
      const id = segment.id;
      let pending: Promise<Uint8Array | null>;
      try {
        pending = read(url);
      } catch {
        continue;
      }
      reads.push(pending.then(
        (bytes) => {
          if (bytes && bytes.length > 0 && !source.audioBytes.has(id)) source.audioBytes.set(id, bytes);
        },
        () => undefined,
      ));
    }
  }
  return Promise.all(reads).then(() => undefined);
}

/** Clip lookup for `buildLectureAudioTrack`: in-memory bytes before any URL. */
export function lectureExportCueBytes(
  source: Pick<LectureExportSource, "audioBytes">,
): (cue: Pick<ReplayCue, "segment">) => Uint8Array | null {
  return (cue) => {
    const bytes = source.audioBytes.get(cue.segment.id);
    return bytes && bytes.length > 0 ? bytes : null;
  };
}

/**
 * The file name a student sees: the lesson title, plus "(so far)" when the
 * file ends at the current point of a live or stopped lesson.
 */
export function lessonDownloadFilename(
  title: string,
  extension: LectureContainer | "pdf",
  partial: boolean,
): string {
  const cleaned = title
    // Characters no file system accepts, and control characters.
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  const base = cleaned || "Lesson";
  return partial ? `${base} (so far).${extension}` : `${base}.${extension}`;
}
