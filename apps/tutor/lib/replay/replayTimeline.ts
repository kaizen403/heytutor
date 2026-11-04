import { sourceCheckedStoredTurn } from "@/lib/scene/storedSceneSource";
import type { DrawCommand } from "@heytutor/drawing";
import {
  isStoredCommandTrustedGeometry,
} from "@heytutor/drawing";
import type { StoredSegment, StoredTurn } from "@/lib/boards/boardsClient";
import { storedPageTurnAt } from "@/lib/boards/boardContinuation";
import { storedCodeLessonSegmentCommands } from "@/lib/code-lesson/persistedCodeLesson";

export interface ReplayCue {
  id: string;
  turnIndex: number;
  segmentIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  narration: string;
  commands: DrawCommand[];
  trustedDiagramGeometry: boolean;
  audioUrl: string | null;
  durationMsStored: number | null;
  timings: StoredSegment["timings"];
  segment: StoredSegment;
}

export interface ReplayTimeline {
  cues: ReplayCue[];
  totalMs: number;
}

function estimateSegmentDurationMs(
  narration: string,
  durationMs: number | null | undefined,
): number {
  if (durationMs != null && durationMs > 0) {
    return durationMs;
  }
  const trimmed = narration.trim();
  if (trimmed.length > 0) {
    return Math.max(trimmed.length * 85, 700);
  }
  return 700;
}

export function buildReplayTimeline(turns: StoredTurn[]): ReplayTimeline {
  const cues: ReplayCue[] = [];
  let cursorMs = 0;

  turns.forEach((turn, turnIndex) => {
    const checked = sourceCheckedStoredTurn(turn);
    const turnCuesFrom = cues.length;
    checked.segments.forEach((segment, segmentIndex) => {
      const narration = segment.narration.trim();
      const commands = storedCodeLessonSegmentCommands(checked, segment);
      if (commands.length === 0 && !narration) {
        return;
      }

      const durationMs = estimateSegmentDurationMs(narration, segment.durationMs);
      const startMs = cursorMs;
      const endMs = startMs + durationMs;

      cues.push({
        id: `${turnIndex}-${segmentIndex}-${segment.orderIndex}`,
        turnIndex,
        segmentIndex,
        startMs,
        endMs,
        durationMs,
        narration,
        commands,
        trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command),
        audioUrl: segment.audioUrl,
        durationMsStored: segment.durationMs,
        timings: segment.timings,
        segment,
      });

      cursorMs = endMs;
    });
    // A doubt that turned a fresh page (DIAGRAM_DOUBT_FIGURES) and was stopped
    // before any row is saved with no segments. Every surface turns pages at a
    // cue's turn, so it gets one silent, inkless cue: replay, seek, the lecture
    // player and export hold the lesson page there, as live and restore do.
    // Only a saved `freshPage` marker makes a page turn, so with the flag off
    // no cue is added.
    if (cues.length === turnCuesFrom && storedPageTurnAt(turns, turnIndex) !== null) {
      const durationMs = estimateSegmentDurationMs("", null);
      const segment: StoredSegment = {
        id: `${turn.id}:page-turn`,
        orderIndex: 0,
        narration: "",
        spokenText: "",
        command: null,
        audioUrl: null,
        durationMs: null,
        timings: null,
      };
      cues.push({
        id: `${turnIndex}-page-turn`,
        turnIndex,
        segmentIndex: 0,
        startMs: cursorMs,
        endMs: cursorMs + durationMs,
        durationMs,
        narration: "",
        commands: [],
        trustedDiagramGeometry: false,
        audioUrl: null,
        durationMsStored: null,
        timings: null,
        segment,
      });
      cursorMs += durationMs;
    }
  });

  return { cues, totalMs: cursorMs };
}

export function formatReplayTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function findCueAtTime(cues: ReplayCue[], timeMs: number): {
  cue: ReplayCue;
  index: number;
  offsetMs: number;
} | null {
  if (cues.length === 0) {
    return null;
  }

  const clamped = Math.max(0, Math.min(timeMs, cues[cues.length - 1]!.endMs - 1));
  const index = cues.findIndex(
    (cue) => clamped >= cue.startMs && clamped < cue.endMs,
  );

  if (index === -1) {
    const lastIndex = cues.length - 1;
    const last = cues[lastIndex]!;
    return { cue: last, index: lastIndex, offsetMs: last.durationMs };
  }

  const cue = cues[index]!;
  return { cue, index, offsetMs: clamped - cue.startMs };
}

export function getPartialCommandCount(cue: ReplayCue, offsetMs: number): number {
  if (cue.commands.length === 0) {
    return 0;
  }
  if (offsetMs <= 0) {
    return 0;
  }
  if (offsetMs >= cue.durationMs) {
    return cue.commands.length;
  }
  const progress = offsetMs / cue.durationMs;
  return Math.min(
    cue.commands.length,
    Math.max(0, Math.ceil(cue.commands.length * progress)),
  );
}
