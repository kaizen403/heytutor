import { getSegmentCommands, type DrawCommand, type TutorSegment } from "./drawingProtocol";
import { fitWorkTextCommand } from "./lessonPlanner";
import type { VerifiedDiagram, VerifiedDiagramAnchor } from "./verifiedDiagram";

const MARKER_ACTION_PATTERN =
  /\b(?:let me draw|i(?:'|’)ll draw|i will draw|let(?:'|’)s draw|i will mark|let me mark|i will label|let me label|i(?:'|’)ll label|let(?:'|’)s label|let(?:'|’)s circle|i will circle|let me circle|now circle)\b/i;

export interface BoardTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

export interface PreparedVerifiedSegments {
  segments: TutorSegment[];
  blockedCommandCount: number;
  droppedSegmentCount: number;
}

function cleanMarkerActionNarration(narration: string): string {
  if (!MARKER_ACTION_PATTERN.test(narration)) return narration;

  const sentences = narration.match(/[^.!?]+[.!?]?/g) ?? [narration];
  const kept = sentences
    .filter((sentence) => !MARKER_ACTION_PATTERN.test(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return kept;
}

export function anchorToTextRect(anchor: VerifiedDiagramAnchor): BoardTextRect {
  return {
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
    text: anchor.labels[0],
  };
}

export function resolveVerifiedDiagramFocusTarget(
  command: DrawCommand,
  diagram: VerifiedDiagram | null,
): VerifiedDiagramAnchor | null {
  if (!diagram || command.type !== "FOCUS") return null;
  const requested = (command.semanticRef?.entityId ?? command.text ?? "").trim().toLowerCase();
  if (!requested) return null;

  return diagram.anchors.find((anchor) =>
    anchor.id.toLowerCase() === requested ||
    anchor.labels.some((label) => label.trim().toLowerCase() === requested)
  ) ?? null;
}

/**
 * The teaching model never owns structural ink. A verified scene may coexist
 * only with equation writing in the work area, timing pauses, and semantic
 * focus gestures that resolve to compiler-owned entities.
 */
export function isBlockedVerifiedDiagramCommand(
  command: DrawCommand,
  diagram: VerifiedDiagram | null,
): boolean {
  if (command.type === "PAUSE") return false;
  if (command.type === "FOCUS") {
    return resolveVerifiedDiagramFocusTarget(command, diagram) === null;
  }
  // WRITE coordinates are only suggestions. The runtime fits and allocates
  // symbolic work in the left column before execution.
  if (command.type === "WRITE") return false;
  return true;
}

/**
 * Remove unverified marker commands before they reach the animation queue.
 * Useful narration is retained even when its associated marker gesture is
 * rejected, preventing diagram validation from interrupting speech.
 */
export function prepareVerifiedLessonSegments(
  segments: TutorSegment[],
  diagram: VerifiedDiagram | null,
): PreparedVerifiedSegments {
  let blockedCommandCount = 0;
  let droppedSegmentCount = 0;
  const prepared: TutorSegment[] = [];

  for (const segment of segments) {
    const commands = getSegmentCommands(segment);
    if (commands.length === 0) {
      prepared.push(segment);
      continue;
    }

    const keptCommands = commands.flatMap((command) => {
      const candidates = command.type === "WRITE" ? fitWorkTextCommand(command) : [command];
      return candidates.filter((candidate) => {
        if (!isBlockedVerifiedDiagramCommand(candidate, diagram)) return true;
        blockedCommandCount += 1;
        return false;
      });
    });
    const narration = cleanMarkerActionNarration(segment.narration);

    if (keptCommands.length === 0 && !narration) {
      droppedSegmentCount += 1;
      continue;
    }

    prepared.push({
      ...segment,
      narration,
      command: keptCommands[0] ?? null,
      commands: keptCommands.length > 0 ? keptCommands : undefined,
    });
  }

  return { segments: prepared, blockedCommandCount, droppedSegmentCount };
}
