import { getSegmentCommands, type DrawCommand, type TutorSegment } from "./drawingProtocol";
import { fitWorkTextCommand } from "../layout/lessonPlanner";
import type { VerifiedDiagram, VerifiedDiagramAnchor } from "./verifiedDiagram";
import { resolveVerifiedDiagramFocusTargets } from "./semanticGesture";

export { resolveVerifiedDiagramFocusTarget, resolveVerifiedDiagramFocusTargets } from "./semanticGesture";

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

/**
 * The teaching model never owns structural ink. A verified scene may coexist
 * only with equation writing in the work area, timing pauses, and semantic
 * gestures that resolve to compiler-owned entities or work-area rows.
 */
export function isBlockedVerifiedDiagramCommand(
  command: DrawCommand,
  diagram: VerifiedDiagram | null,
): boolean {
  if (command.type === "PAUSE") return false;
  if (command.type === "SUPERSEDE") return true;
  if (command.type === "EMPHASIZE") return false;
  if (command.type === "FOCUS") {
    return resolveVerifiedDiagramFocusTargets(command, diagram).length === 0;
  }
  if (command.type === "ANNOTATE") {
    const requested = (command.text ?? command.semanticRef?.entityId ?? "").trim().toLowerCase();
    if (!requested || !diagram) return true;
    return resolveVerifiedDiagramFocusTargets({ ...command, type: "FOCUS" }, diagram).length === 0 &&
      !diagram.deferredAnnotations?.some((entry) => entry.entityId.toLowerCase() === requested);
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

  const labeled = diagram.anchors.filter((anchor) =>
    spokenDisplayLabels(anchor).some((name) => isExplicitSpokenName(text, name)),
  );
  labeled.sort((first, second) => anchorArea(first) - anchorArea(second));
  return labeled[0] ?? null;
}

export function prepareVerifiedLessonSegments(
  segments: TutorSegment[],
  diagram: VerifiedDiagram | null,
): PreparedVerifiedSegments {
  let blockedCommandCount = 0;
  let droppedSegmentCount = 0;
  const prepared: TutorSegment[] = [];

  for (const segment of segments) {
    const commands = getSegmentCommands(segment);
    const withSpokenFocus = attachSpokenFocusCommand(commands, segment.narration, diagram);
    const narration = spokenFocusNarration(
      cleanMarkerActionNarration(segment.narration),
      withSpokenFocus,
      diagram,
    );
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
  const emphasis = spokenFocusEmphasis(narration, anchor);
  const focusCommand: DrawCommand = {
    type: "FOCUS",
    params: [],
    text: emphasis === "trace" ? anchor.id : `${anchor.id}|${emphasis}`,
    charPosition: 0,
    narrationBefore: narration,
    semanticRef: { entityId: anchor.id },
  };
  return [...commands, focusCommand];
}

function spokenFocusEmphasis(
  narration: string,
  anchor: VerifiedDiagramAnchor,
): "trace" | "spotlight" | "pulse" {
  if (/\b(?:circle|encircle|ring)\b/i.test(narration) || isCompactAnchor(anchor)) return "pulse";
  if (/\b(?:only this|just this|spotlight)\b/i.test(narration)) return "spotlight";
  return "trace";
}

function isCompactAnchor(anchor: VerifiedDiagramAnchor): boolean {
  return Math.max(anchor.width, anchor.height) <= 28;
}

function spokenFocusNarration(
  cleaned: string,
  commands: DrawCommand[],
  diagram: VerifiedDiagram | null,
): string {
  if (cleaned) return cleaned;
  const focus = commands.find((command) => command.type === "FOCUS");
  if (!focus || !diagram) return cleaned;
  const anchor = resolveVerifiedDiagramFocusTargets(focus, diagram)[0];
  const name = anchor?.labels.find((label) => label.length <= 12 && label !== anchor.id) ?? anchor?.id;
  return name ? `notice ${name}.` : cleaned;
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
  if (trimmed.length === 1) {
    return new RegExp(
      `(?:\\b(?:point|label|called)\\s+${escaped}\\b|\\bthis is\\s+${escaped}\\b|\\b${escaped}\\s+is\\b)`,
      "i",
    ).test(narration);
  }
  if (trimmed.length <= 3) {
    return new RegExp(
      `(?:\\b(?:point|label|called|notice|follow|look at)\\s+${escaped}\\b|\\bthis is\\s+${escaped}\\b|\\b${escaped}\\s+is\\b)`,
      "i",
    ).test(narration);
  }
  return new RegExp(
    `(?:\\b(?:called|notice|follow|look at)\\s+(?:the\\s+)?${escaped}\\b|\\b(?:the|this|that)\\s+${escaped}\\b(?!\\s+[A-Za-z]{3,})|\\b${escaped}\\s+is\\b)`,
    "i",
  ).test(narration);
}

function uniqueNames(values: readonly (string | undefined)[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

const DISPLAY_LABEL_STOP = new Set([
  "the", "and", "or", "of", "to", "a", "an", "is", "at", "on", "for", "from", "this", "that",
]);

function spokenDisplayLabels(anchor: VerifiedDiagramAnchor): string[] {
  return uniqueNames([anchor.id, ...anchor.labels]).filter((name) => {
    if (name.length < 4 || name.length > 24) return false;
    if (/_/.test(name)) return false;
    if (DISPLAY_LABEL_STOP.has(name.toLowerCase())) return false;
    return true;
  });
}

function anchorArea(anchor: VerifiedDiagramAnchor): number {
  return Math.max(anchor.width, 1) * Math.max(anchor.height, 1);
}
