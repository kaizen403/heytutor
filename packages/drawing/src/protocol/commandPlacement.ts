import { getSegmentCommands, type DrawCommand, type TutorSegment } from "./drawingProtocol";
import { fitWorkTextCommand } from "../layout/lessonPlanner";
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
export function spokenFocusTarget(
  narration: string,
  diagram: VerifiedDiagram | null,
): VerifiedDiagramAnchor | null {
  if (!diagram || diagram.anchors.length === 0) return null;
  const text = narration.trim();
  if (!text) return null;

  for (const anchor of diagram.anchors) {
    const names = uniqueNames([anchor.id, ...anchor.labels]).filter((name) => name.length <= 3);
    for (const name of names) {
      if (!isExplicitSpokenName(text, name)) continue;
      return anchor;
    }
  }

  for (const rule of SPOKEN_ROLE_CUES) {
    if (!rule.cue.test(text)) continue;
    const matches = diagram.anchors.filter((anchor) =>
      uniqueNames([anchor.id, ...anchor.labels]).some((name) => rule.name.test(name)));
    matches.sort((first, second) => anchorArea(first) - anchorArea(second));
    if (matches[0]) return matches[0];
  }

  return null;
}

export function prepareVerifiedLessonSegments(
  segments: TutorSegment[],
  diagram: VerifiedDiagram | null,
): PreparedVerifiedSegments {
  let blockedCommandCount = 0;
  let droppedSegmentCount = 0;
  const prepared: TutorSegment[] = [];

  for (const segment of segments) {
    const narration = cleanMarkerActionNarration(segment.narration);
    const commands = getSegmentCommands(segment);
    const withSpokenFocus = attachSpokenFocusCommand(commands, narration, diagram);
    if (withSpokenFocus.length === 0) {
      if (!narration) {
        droppedSegmentCount += 1;
        continue;
      }
      prepared.push({ ...segment, narration, command: null, commands: undefined });
      continue;
    }

    const keptCommands = withSpokenFocus.flatMap((command) => {
      const candidates = command.type === "WRITE" ? fitWorkTextCommand(command) : [command];
      return candidates.filter((candidate) => {
        if (!isBlockedVerifiedDiagramCommand(candidate, diagram)) return true;
        blockedCommandCount += 1;
        return false;
      });
    });

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

function attachSpokenFocusCommand(
  commands: DrawCommand[],
  narration: string,
  diagram: VerifiedDiagram | null,
): DrawCommand[] {
  if (commands.some((command) => command.type === "FOCUS")) return commands;
  const anchor = spokenFocusTarget(narration, diagram);
  if (!anchor) return commands;
  const focusCommand: DrawCommand = {
    type: "FOCUS",
    params: [],
    text: anchor.id,
    charPosition: 0,
    narrationBefore: narration,
    semanticRef: { entityId: anchor.id },
  };
  return [...commands, focusCommand];
}

const SPOKEN_ROLE_CUES: ReadonlyArray<{ cue: RegExp; name: RegExp }> = [
  { cue: /\b(?:the |this )?(?:image point|paraxial image|image)\b/i, name: /^(?:I|image(?:[_\s-]?base)?)$/i },
  { cue: /\b(?:the |this )?(?:object point|point object|object)\b/i, name: /^(?:O|object(?:[_\s-]?base)?)$/i },
  { cue: /\b(?:the )?(?:focal point|focus)\b/i, name: /^(?:F|focus)$/i },
  { cue: /\b(?:centre|center) of curvature\b/i, name: /^(?:C|center|centre)$/i },
  { cue: /\b(?:the )?(?:pole|vertex)\b/i, name: /^(?:P|V|pole|vertex)$/i },
];

function isExplicitSpokenName(narration: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (trimmed.length <= 3) {
    return new RegExp(
      `(?:\\b(?:point|label|called)\\s+${escaped}\\b|\\bthis is\\s+${escaped}\\b|\\b${escaped}\\s+is\\b)`,
      "i",
    ).test(narration);
  }
  return new RegExp(`\\b${escaped}\\b`, "i").test(narration);
}

function uniqueNames(values: readonly (string | undefined)[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

function anchorArea(anchor: VerifiedDiagramAnchor): number {
  return Math.max(anchor.width, 1) * Math.max(anchor.height, 1);
}
