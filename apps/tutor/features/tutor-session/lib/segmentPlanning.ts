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
    activeDiagramId: null,
    activeDiagramName: null,
    plannedSegmentCount: 0,
    introSegmentCount: 0,
    llmSegmentCount: 0,
    blockedUnverifiedDrawCommands: 0,
    droppedMarkerOnlySegments: 0,
  };
}

export function summarizeSegmentsForTrace(segments: TutorSegment[]): Array<{
  index: number;
  verifiedDiagramIntro: boolean;
  narration: string;
  commands: Array<{ type: DrawCommand["type"]; params: number[]; text?: string }>;
}> {
  return segments.slice(0, 24).map((segment, index) => ({
    index,
    verifiedDiagramIntro: segment.verifiedDiagramIntro === true,
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

  const openSteps = (trimmed.match(/\[STEP\]/gi) ?? []).length;
  const closeSteps = (trimmed.match(/\[\/STEP\]/gi) ?? []).length;
  // Open [STEP] blocks must be closed — a trailing ] from [FOCUS:...] is not enough.
  if (openSteps > closeSteps) {
    return true;
  }

  const endsCleanly =
    /[.!?]\s*$/.test(trimmed) ||
    /\[\/STEP\]\s*$/.test(trimmed) ||
    (openSteps === 0 && /\]\s*$/.test(trimmed));

  if (endsCleanly && trimmed.length < 6000) {
    return false;
  }

  return true;
}

export function normalizeSegmentForAlignment(segment: TutorSegment): TutorSegment {
  if (segment.verifiedDiagramIntro) {
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
