import { snapToBoardTypeScale } from "@heytutor/drawing";
import type { ReplayCue } from "./replayTimeline";
import type { BoardLayoutState } from "@/features/tutor-session/types";
import { TEXT_LAYOUT } from "@/features/tutor-session/constants";
import {
  estimateBoardTextWidthAtSize,
  recordedWorkWriteNeedsPageTurn,
} from "@/features/tutor-session/lib/board/boardLayout";

/** A recorded work frame, never an inferred answer or generated summary. */
export interface LectureWorkPage {
  index: number;
  startMs: number;
  endMs: number;
  endCueIndex: number;
  endCommandCount: number;
}

/** Use the replay layout's own overlap rule to find stored work-page erases. */
export function recordedLectureWorkPages(
  cues: readonly ReplayCue[],
  pageStartTurnIndex: readonly number[],
): LectureWorkPage[] {
  const pages: LectureWorkPage[] = [];
  let layout: BoardLayoutState = { rects: [], nextY: TEXT_LAYOUT.topY };
  let openingTurn = -1;
  let startMs = 0;
  let hasWork = false;
  let previous = { endMs: 0, endCueIndex: 0, endCommandCount: 0 };
  const finish = () => {
    if (hasWork) pages.push({ index: pages.length, startMs, ...previous });
    hasWork = false;
  };
  cues.forEach((cue, cueIndex) => {
    const opening = pageStartTurnIndex[cue.turnIndex] ?? cue.turnIndex;
    if (opening !== openingTurn) {
      finish();
      layout = { rects: [], nextY: TEXT_LAYOUT.topY };
      openingTurn = opening;
      startMs = cue.startMs;
    }
    cue.commands.forEach((command, commandIndex) => {
      if (command.type === "CLEAR") {
        finish();
        layout = { rects: [], nextY: TEXT_LAYOUT.topY };
        startMs = cue.startMs;
      } else if (
        command.type === "WRITE" &&
        command.text &&
        Number.isFinite(command.params[0]) &&
        Number.isFinite(command.params[1])
      ) {
        const rect = {
          x: command.params[0]!,
          y: command.params[1]!,
          text: command.text,
          width: estimateBoardTextWidthAtSize(
            command.text,
            snapToBoardTypeScale(command.params[2] || 32),
          ),
          height: TEXT_LAYOUT.textHeight,
        };
        if (recordedWorkWriteNeedsPageTurn(layout, rect, false)) {
          // The previous page ends before this erase/WRITE, including earlier
          // commands in this same cue. The renderer uses the command boundary,
          // not an invented time window in which all ink supposedly finished.
          finish();
          layout.rects = layout.rects.filter(
            (row) => row.y < TEXT_LAYOUT.headingBottomY,
          );
          startMs = cue.startMs;
        }
        layout.rects.push(rect);
        if (rect.x < 400) hasWork = true;
      }
      previous = {
        endMs: cue.endMs,
        endCueIndex: cueIndex,
        endCommandCount: commandIndex + 1,
      };
    });
    if (!cue.commands.length)
      previous = {
        endMs: cue.endMs,
        endCueIndex: cueIndex,
        endCommandCount: 0,
      };
  });
  finish();
  return pages;
}
