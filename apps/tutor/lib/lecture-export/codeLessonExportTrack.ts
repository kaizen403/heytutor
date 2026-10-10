import {
  codeLessonBlockById,
  codeLessonSectionCode,
  type CodeLessonPlan,
} from "@heytutor/tutor-core";
import { codeTypingCharOffsetsMs } from "@/features/tutor-session/lib/code-lesson/codeLessonController";
import { storedCodeLessonPlan } from "@/lib/code-lesson/persistedCodeLesson";
import type { CodePanelFrameSpec } from "@/lib/code-render/renderCodeToCanvas";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";

/**
 * Frame-accurate typing timeline for MP4 export. Character offsets come from
 * `codeTypingCharOffsetsMs`, the same pure pacing the live panel runs, so a
 * recording types at the recorded speed while every frame stays deterministic
 * in frame time rather than waiting on a wall clock.
 */

export interface CodeLessonBlockTiming {
  blockId: string;
  sectionIndex: number;
  code: string;
  /** Absolute timeline ms at which each character of `code` appears. */
  charAppearMs: number[];
}

export interface CodeLessonExportTrack {
  plan: CodeLessonPlan;
  /** Blocks in reveal order. */
  blocks: CodeLessonBlockTiming[];
}

export function buildCodeLessonExportTrack(
  turn: StoredTurn,
  cues: ReplayCue[],
): CodeLessonExportTrack | null {
  const plan = storedCodeLessonPlan(turn.sceneArtifacts);
  if (!plan) return null;

  const blocks: CodeLessonBlockTiming[] = [];
  for (const cue of cues) {
    for (const command of cue.commands) {
      if (command.type !== "TYPE") continue;
      const blockId = command.semanticRef?.entityId?.trim() ?? "";
      const located = blockId ? codeLessonBlockById(plan, blockId) : null;
      if (!located) continue;
      const code = located.block.code;
      const shownChars = command.shownChars === undefined ? code.length
        : Number.isSafeInteger(command.shownChars) ? Math.min(code.length, Math.max(0, command.shownChars)) : 0;
      const charAppearMs = codeTypingCharOffsetsMs(code, cue.durationMs).slice(0, shownChars).map((offset) =>
        cue.startMs + offset,
      );
      blocks.push({
        blockId,
        sectionIndex: plan.sections.indexOf(located.section),
        code,
        charAppearMs,
      });
    }
  }

  return { plan, blocks };
}

/** A board page's code panel, shown from the page's first cue to the next page. */
export interface CodeLessonExportSpan {
  startMs: number;
  endMs: number;
  track: CodeLessonExportTrack;
}

/**
 * One code track per board page. A page's panel is the plan its opening turn
 * (or the first of its doubts that has one) committed; a page without a plan
 * shows no panel, so a later page's code never paints over an earlier lesson.
 */
export function buildCodeLessonExportSpans(
  turns: readonly StoredTurn[],
  cues: ReplayCue[],
): CodeLessonExportSpan[] {
  const pages: number[][] = [];
  turns.forEach((turn, index) => {
    if (index === 0 || !storedTurnContinuesBoard(turn)) {
      pages.push([index]);
    } else {
      pages[pages.length - 1]!.push(index);
    }
  });
  const pageStarts = pages.map((page) => {
    const first = cues.find((cue) => page.includes(cue.turnIndex));
    return first?.startMs ?? null;
  });
  const spans: CodeLessonExportSpan[] = [];
  pages.forEach((page, pageIndex) => {
    const startMs = pageStarts[pageIndex];
    if (startMs == null) return;
    const pageCues = cues.filter((cue) => page.includes(cue.turnIndex));
    let track: CodeLessonExportTrack | null = null;
    for (const turnIndex of page) {
      track = buildCodeLessonExportTrack(turns[turnIndex]!, pageCues);
      if (track) break;
    }
    if (!track) return;
    const nextStart = pageStarts.slice(pageIndex + 1).find((ms) => ms != null);
    spans.push({ startMs, endMs: nextStart ?? Number.POSITIVE_INFINITY, track });
  });
  return spans;
}

export function codeLessonSpanAt(
  spans: readonly CodeLessonExportSpan[],
  timeMs: number,
): CodeLessonExportTrack | null {
  for (const span of spans) {
    if (timeMs >= span.startMs && timeMs < span.endMs) return span.track;
  }
  return null;
}

function revealedCharsAt(block: CodeLessonBlockTiming, timeMs: number): number {
  let revealed = 0;
  while (revealed < block.charAppearMs.length && block.charAppearMs[revealed]! <= timeMs) {
    revealed += 1;
  }
  return revealed;
}

/** Panel state for one export frame: active section, revealed chars, caret. */
export function codeLessonFrameSpec(
  track: CodeLessonExportTrack,
  timeMs: number,
): CodePanelFrameSpec {
  const { plan, blocks } = track;

  let activeBlockIndex = -1;
  for (let index = 0; index < blocks.length; index += 1) {
    if (revealedCharsAt(blocks[index]!, timeMs) > 0) activeBlockIndex = index;
  }

  const sectionIndex = activeBlockIndex >= 0 ? blocks[activeBlockIndex]!.sectionIndex : 0;
  const section = plan.sections[sectionIndex]!;
  const sectionCode = codeLessonSectionCode(section);

  // Mirror revealedSectionText: full blocks joined with newlines, then the
  // partial tail of the block currently being typed.
  const parts: string[] = [];
  let typing = false;
  for (const block of section.blocks) {
    const timings = blocks.filter(
      (candidate) => candidate.blockId === block.id && candidate.sectionIndex === sectionIndex,
    );
    const revealed = Math.max(0, ...timings.map((timing) => revealedCharsAt(timing, timeMs)));
    if (revealed <= 0) break;
    parts.push(block.code.slice(0, revealed));
    if (revealed < block.code.length) {
      typing = true;
      break;
    }
  }
  const revealedText = parts.join("\n");

  return {
    chrome: {
      title: plan.title,
      language: plan.language,
      sectionTitle: section.title,
      sectionIndex,
      sectionCount: plan.sections.length,
    },
    code: sectionCode,
    revealedChars: revealedText.length,
    showCaret: typing,
    caretClockMs: timeMs,
  };
}
