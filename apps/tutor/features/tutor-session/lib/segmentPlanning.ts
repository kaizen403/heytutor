import {
  checkSegmentAlignment,
  getSegmentCommands,
  type DrawCommand,
  type TutorSegment,
} from "@heytutor/drawing";
import { tutorDebug } from "@heytutor/tutor-core";
import type { SegmentPlanStats } from "../types";

export function createEmptySegmentPlanStats(): SegmentPlanStats {
  return {
    activeTemplateId: null,
    activeTemplateName: null,
    plannedSegmentCount: 0,
    introSegmentCount: 0,
    llmSegmentCount: 0,
    blockedTemplateDrawCommands: 0,
    droppedTemplateRedrawSegments: 0,
  };
}

export function summarizeSegmentsForTrace(segments: TutorSegment[]): Array<{
  index: number;
  templateIntro: boolean;
  narration: string;
  commands: Array<{ type: DrawCommand["type"]; params: number[]; text?: string }>;
}> {
  return segments.slice(0, 24).map((segment, index) => ({
    index,
    templateIntro: segment.templateIntro === true,
    narration: segment.narration.slice(0, 140),
    commands: getSegmentCommands(segment).map((command) => ({
      type: command.type,
      params: command.params,
      ...(command.text ? { text: command.text } : {}),
    })),
  }));
}

export function isTeachingResponseIncomplete(
  chunk: string,
  fullResponse: string,
  previousChunk?: string,
): boolean {
  if (fullResponse.length >= 28000) {
    return false;
  }

  if (previousChunk !== undefined && chunk === previousChunk) {
    return false;
  }

  const trimmed = chunk.trim();
  if (!trimmed) {
    return false;
  }

  const endsCleanly =
    /[.!?]\s*$/.test(trimmed) ||
    /\[\/STEP\]\s*$/.test(trimmed) ||
    /\]\s*$/.test(trimmed);

  if (endsCleanly && trimmed.length < 6000) {
    return false;
  }

  return true;
}

export function normalizeSegmentForAlignment(segment: TutorSegment): TutorSegment {
  if (segment.templateIntro) {
    return segment;
  }

  const commands = getSegmentCommands(segment);
  if (commands.length === 0) {
    return segment;
  }

  const alignedCommands = commands.filter((command) => {
    const alignment = checkSegmentAlignment({ ...segment, command });
    if (!alignment.aligned) {
      tutorDebug("alignment", "skipping misaligned draw command", {
        reason: alignment.reason,
        narration_preview: segment.narration.slice(0, 80),
        command_type: command.type,
      });
      return false;
    }
    return true;
  });

  if (alignedCommands.length === commands.length) {
    return segment;
  }

  return {
    ...segment,
    command: alignedCommands[0] ?? null,
    commands: alignedCommands,
  };
}
