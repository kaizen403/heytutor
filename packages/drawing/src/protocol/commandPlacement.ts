import { getSegmentCommands, type DrawCommand, type TutorSegment } from "./drawingProtocol";
import { fitWorkTextCommand } from "../layout/lessonPlanner";
import type { VerifiedDiagram, VerifiedDiagramAnchor } from "./verifiedDiagram";
import { resolveVerifiedDiagramFocusTargets } from "./semanticGesture";

export { resolveVerifiedDiagramFocusTarget } from "./semanticGesture";

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
    // On a code lesson a FOCUS names a frame of the worked example, not an
    // entity of the figure currently drawn. The conductor advances the
    // walk-through to that frame and retargets the spotlight onto whatever the
    // new frame actually contains, so there is nothing to validate here.
    //
    // Validating it anyway is what froze the board: every figure beat the
    // model narrated was dropped as an unverified marker before the conductor
    // ever saw it, so the figure never advanced and the tutor talked over a
    // still picture for the rest of the lesson.
    if (diagram?.layout === "code_lesson") return false;
    return resolveVerifiedDiagramFocusTargets(command, diagram).length === 0;
  }
  if (command.type === "POINT") {
    // A POINT is a FOCUS that draws nothing: the marker stands at the named
    // entities while the step is spoken. It had no case here and fell through
    // to "blocked", so every pointing beat the code-lesson conductor issued
    // was dropped before the pen saw it: 81.8 s of DSA speech with no ink,
    // measured on the coupling audit. Same rule as FOCUS: a code lesson's
    // beats pass, elsewhere it must name something on the figure.
    if (diagram?.layout === "code_lesson") return false;
    return resolveVerifiedDiagramFocusTargets({ ...command, type: "FOCUS" }, diagram).length === 0;
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
  // TYPE reveals one pre-committed code-lesson block; the code panel resolves
  // the id against the committed plan and ignores unknown blocks.
  if (command.type === "TYPE") return false;
  // FRAME advances the worked example to its next pre-compiled figure. The
  // runtime inserts it, not the model, so there is nothing here to validate.
  if (command.type === "FRAME") return false;
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
  return spokenFocusTargets(narration, diagram)[0] ?? null;
}

/**
 * Every figure part the narration names explicitly, in the order it names
 * them. One sentence often introduces several: "M is the mirror, C is the
 * centre" names two, and each gets its own gesture when its name is spoken.
 * The first name found wins ties for an anchor named twice.
 */
function spokenFocusTargets(
  narration: string,
  diagram: VerifiedDiagram | null,
): VerifiedDiagramAnchor[] {
  if (!diagram || diagram.anchors.length === 0) return [];
  const text = narration.trim();
  if (!text) return [];

  const found = new Map<string, { anchor: VerifiedDiagramAnchor; at: number }>();
  const note = (anchor: VerifiedDiagramAnchor, at: number) => {
    const existing = found.get(anchor.id);
    if (!existing || at < existing.at) found.set(anchor.id, { anchor, at });
  };

  for (const anchor of diagram.anchors) {
    const names = uniqueNames([anchor.id, ...anchor.labels]).filter((name) => name.length <= 3);
    for (const name of names) {
      const at = spokenNameIndex(text, name);
      if (at >= 0) note(anchor, at);
    }
  }

  for (const rule of SPOKEN_ROLE_CUES) {
    const cue = rule.cue.exec(text);
    if (!cue) continue;
    const matches = diagram.anchors.filter((anchor) =>
      uniqueNames([anchor.id, ...anchor.labels]).some((name) => rule.name.test(name)));
    matches.sort((first, second) => anchorArea(first) - anchorArea(second));
    if (matches[0]) note(matches[0], cue.index);
  }

  const labeled = diagram.anchors
    .map((anchor) => {
      const positions = spokenDisplayLabels(anchor)
        .map((name) => spokenNameIndex(text, name))
        .filter((at) => at >= 0);
      return positions.length > 0 ? { anchor, at: Math.min(...positions) } : null;
    })
    .filter((entry): entry is { anchor: VerifiedDiagramAnchor; at: number } => entry !== null);
  // A display label can name a whole apparatus and one of its parts alike;
  // the smaller part is the one a teacher points at.
  labeled.sort((first, second) => anchorArea(first.anchor) - anchorArea(second.anchor));
  for (const entry of labeled) note(entry.anchor, entry.at);

  return [...found.values()]
    .sort((first, second) => first.at - second.at)
    .map((entry) => entry.anchor);
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

/**
 * Infer a FOCUS for each figure part the step names aloud when the model
 * tagged none. The inference only fills a gap: a step that carries its own
 * FOCUS, or still has one in its narration text, is the model's call and
 * gets nothing added. Before that rule 4 of the 7 gestures on the mirror
 * lesson were inferred, two of them wrong, and the point I was traced three
 * times because the tag and the inference both fired.
 */
function attachSpokenFocusCommand(
  commands: DrawCommand[],
  narration: string,
  diagram: VerifiedDiagram | null,
): DrawCommand[] {
  if (commands.some((command) => command.type === "FOCUS")) return commands;
  if (/\[FOCUS\b/i.test(narration)) return commands;
  // Never on a code lesson. There a FOCUS is a beat in the worked example, not
  // a gesture, so one inferred from a number in the narration would advance
  // the figure behind the tutor's back, and a step about a line of code would
  // move the picture the previous step was still explaining.
  if (diagram?.layout === "code_lesson") return commands;
  const anchors = spokenFocusTargets(narration, diagram);
  if (anchors.length === 0) return commands;
  const inferred = anchors.map((anchor): DrawCommand => {
    const emphasis = spokenFocusEmphasis(narration, anchor);
    return {
      type: "FOCUS",
      params: [],
      text: emphasis === "trace" ? anchor.id : `${anchor.id}|${emphasis}`,
      charPosition: 0,
      narrationBefore: narration,
      semanticRef: { entityId: anchor.id },
    };
  });
  return [...commands, ...inferred];
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

/**
 * Where the narration names a figure part explicitly, or -1.
 *
 * Names of three characters or fewer must match the drawn case. The cue words
 * around them stay case-blind, but "f is the focal length" is the quantity f,
 * not the point F, and "m is positive" is the magnification, not the mirror M:
 * both were traced on the mirror lesson when the letter alone decided.
 */
function spokenNameIndex(narration: string, name: string): number {
  const trimmed = name.trim();
  if (!trimmed) return -1;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const short = trimmed.length <= 3;
  const cues = trimmed.length === 1
    ? "point|label|called"
    : short
      ? "point|label|called|notice|follow|look at"
      : "called|notice|follow|look at";
  const pattern = short
    ? `(?:\\b(?:${cues})\\s+(${escaped})\\b|\\bthis is\\s+(${escaped})\\b|\\b(${escaped})\\s+is\\b)`
    : `(?:\\b(?:${cues})\\s+(?:the\\s+)?(${escaped})\\b|\\b(?:the|this|that)\\s+(${escaped})\\b(?!\\s+[A-Za-z]{3,})|\\b(${escaped})\\s+is\\b)`;
  const matcher = new RegExp(pattern, "gi");
  for (let match = matcher.exec(narration); match; match = matcher.exec(narration)) {
    const spoken = match[1] ?? match[2] ?? match[3] ?? "";
    if (short && spoken !== trimmed) continue;
    return match.index + match[0].indexOf(spoken);
  }
  return -1;
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
