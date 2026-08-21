import {
  normalizeBoardText,
  normalizeNarration,
  parseDrawingTag,
  parseDrawCommandFromTag,
  parseDrawingCommands,
  parsedResponseToSegments,
  scanDrawingTags,
  getSegmentCommands,
  type DrawCommand,
  type DrawCommandType,
  type TutorSegment,
} from '../protocol/drawingProtocol';
import { BOARD_CANVAS, DIAGRAM_ZONE, WORK_ZONE } from './boardZones';
import { measureTextWidth } from '../handwriting/handwriting';

const STEP_BLOCK_PATTERN = /\[STEP\]\s*([\s\S]*?)\s*\[\/STEP\]/gi;

const RUNTIME_MANAGED_COMMAND_TYPES = new Set<DrawCommandType>(['CLEAR', 'ERASE']);
const WORK_TEXT_BOTTOM_Y = WORK_ZONE.topY + WORK_ZONE.lineHeight * 9;
const WORK_TEXT_RIGHT_GAP = 28;
const WORK_TEXT_MAX_WIDTH = DIAGRAM_ZONE.x - WORK_TEXT_RIGHT_GAP - WORK_ZONE.marginX;
const DEFAULT_WORK_FONT_SIZE = 32;
const MIN_WORK_FONT_SIZE = 12;

interface StructuredBoardAction {
  command: DrawCommand;
  tagStart: number;
  tagEnd: number;
  syncAnchor: string;
}

function extractActionsFromBlock(block: string, blockStartIndex: number): StructuredBoardAction[] {
  const actions: StructuredBoardAction[] = [];
  let narrationCursor = 0;

  for (const match of scanDrawingTags(block)) {
    const { fullTag } = match;
    const parsedTag = parseDrawingTag(fullTag);
    if (!parsedTag) {
      continue;
    }

    const tagIndex = match.index;
    const syncAnchor = normalizeNarration(stripDrawingTags(block.slice(narrationCursor, tagIndex)));
    const command = parseDrawCommandFromTag(
      parsedTag.type,
      parsedTag.rawParams,
      blockStartIndex + tagIndex,
      syncAnchor,
    );

    actions.push({
      command,
      tagStart: tagIndex,
      tagEnd: tagIndex + fullTag.length,
      syncAnchor,
    });
    narrationCursor = tagIndex + fullTag.length;
  }

  return actions;
}

function stripDrawingTags(text: string): string {
  let stripped = '';
  let cursor = 0;

  for (const { index, fullTag } of scanDrawingTags(text)) {
    if (!parseDrawingTag(fullTag)) {
      continue;
    }
    stripped += text.slice(cursor, index);
    cursor = index + fullTag.length;
  }

  return `${stripped}${text.slice(cursor)}`.trim();
}

function withSyncMetadata(narration: string, command: DrawCommand | null): DrawCommand | null {
  if (!command) {
    return null;
  }

  if (command.type !== 'WRITE' && command.type !== 'LABEL' && command.type !== 'DIMENSION') {
    return command;
  }

  const hasAnchor = narration.trim().length > 0 || command.narrationBefore.trim().length > 0;
  return {
    ...command,
    syncable: hasAnchor,
    syncReason: hasAnchor ? 'cue-anchor-present' : 'missing-spoken-cue',
  };
}

function createSegment(narration: string, command: DrawCommand | null): TutorSegment | null {
  const cleanedNarration = normalizeNarration(narration);
  const syncedCommand = withSyncMetadata(cleanedNarration, command);

  if (!cleanedNarration && !syncedCommand) {
    return null;
  }

  return {
    narration: cleanedNarration,
    command: syncedCommand,
    commands: syncedCommand ? [syncedCommand] : undefined,
  };
}

/**
 * Parse [STEP]...[/STEP] blocks as universal teaching micro-steps.
 * Every command keeps the narration immediately before it as its sync anchor.
 */
export function parseStructuredLessonSteps(responseText: string): TutorSegment[] {
  const segments: TutorSegment[] = [];
  const blocks = [...responseText.matchAll(STEP_BLOCK_PATTERN)];

  if (blocks.length === 0) {
    return [];
  }

  for (const match of blocks) {
    const block = match[1];
    const blockStart = match.index ?? 0;
    const actions = extractActionsFromBlock(block, blockStart);

    if (actions.length === 0) {
      const segment = createSegment(stripDrawingTags(block), null);
      if (segment) {
        segments.push(segment);
      }
      continue;
    }

    let cursor = 0;
    let lastCommandSegment: TutorSegment | null = null;

    for (const action of actions) {
      const narration = stripDrawingTags(block.slice(cursor, action.tagStart));
      const hasNarration = narration.trim().length > 0;

      if (!hasNarration && lastCommandSegment) {
        const merged = [...getSegmentCommands(lastCommandSegment), action.command];
        lastCommandSegment.commands = merged;
        lastCommandSegment.command = merged[0] ?? lastCommandSegment.command;
      } else {
        const segment = createSegment(narration, action.command);
        if (segment) {
          segments.push(segment);
          lastCommandSegment = segment.command ? segment : lastCommandSegment;
        }
      }

      cursor = action.tagEnd;
    }

    const trailingNarration = stripDrawingTags(block.slice(cursor));
    const trailingSegment = createSegment(trailingNarration, null);
    if (trailingSegment) {
      segments.push(trailingSegment);
    }
  }

  return segments;
}

function clampCommandParams(command: DrawCommand): DrawCommand {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

  if (command.type === "DRAW_LINE" && command.params.length >= 4) {
    const [x1, y1, x2, y2] = command.params;
    return {
      ...command,
      params: [
        clamp(x1, BOARD_CANVAS.width),
        clamp(y1, BOARD_CANVAS.height),
        clamp(x2, BOARD_CANVAS.width),
        clamp(y2, BOARD_CANVAS.height),
      ],
    };
  }

  if (command.params.length >= 2) {
    const next = [...command.params];
    next[0] = clamp(next[0], BOARD_CANVAS.width);
    next[1] = clamp(next[1], BOARD_CANVAS.height);
    return { ...command, params: next };
  }

  return command;
}

function fittedWorkFontSize(text: string, preferred: number): number {
  for (let fontSize = preferred; fontSize >= MIN_WORK_FONT_SIZE; fontSize -= 1) {
    if (measureTextWidth(text, fontSize) <= WORK_TEXT_MAX_WIDTH) {
      return fontSize;
    }
  }
  return MIN_WORK_FONT_SIZE;
}

function splitWorkText(text: string, fontSize: number): string[] {
  if (measureTextWidth(text, fontSize) <= WORK_TEXT_MAX_WIDTH) return [text];
  const lines: string[] = [];
  let remaining = text.trim();
  while (remaining && measureTextWidth(remaining, fontSize) > WORK_TEXT_MAX_WIDTH) {
    let fit = 1;
    for (let index = 2; index <= remaining.length; index += 1) {
      if (measureTextWidth(remaining.slice(0, index), fontSize) > WORK_TEXT_MAX_WIDTH) break;
      fit = index;
    }

    // Prefer a semantic boundary near the available edge. The hard split is a
    // last resort for a single long symbolic token or chemical formula.
    let splitAt = fit;
    const searchFloor = Math.max(1, Math.floor(fit * 0.55));
    for (let index = fit; index >= searchFloor; index -= 1) {
      if (/\s|[=+−\-×÷→≈≤≥,;]/u.test(remaining[index - 1] ?? "")) {
        splitAt = index;
        break;
      }
    }
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

export function fitWorkTextCommand(command: DrawCommand): DrawCommand[] {
  if (command.type !== 'WRITE' || command.params.length < 2) {
    return [command];
  }

  const [, y, requestedFontSize] = command.params;
  const text = command.text ?? '';
  const preferredFontSize =
    Number.isFinite(requestedFontSize) && requestedFontSize >= MIN_WORK_FONT_SIZE
      ? Math.min(requestedFontSize, DEFAULT_WORK_FONT_SIZE)
      : DEFAULT_WORK_FONT_SIZE;
  const fittedFontSize = fittedWorkFontSize(text, preferredFontSize);
  const lines = splitWorkText(text, fittedFontSize);
  const startY = Math.min(Math.max(y, WORK_ZONE.topY), WORK_TEXT_BOTTOM_Y);

  return lines.map((line, index) => ({
    ...command,
    text: line,
    params: [
      WORK_ZONE.marginX,
      Math.min(startY + index * WORK_ZONE.lineHeight, WORK_TEXT_BOTTOM_Y),
      fittedWorkFontSize(line, preferredFontSize),
    ],
  }));
}

function sanitizeCommand(command: DrawCommand | null): DrawCommand | DrawCommand[] | null {
  if (!command) {
    return null;
  }

  if (RUNTIME_MANAGED_COMMAND_TYPES.has(command.type)) {
    return null;
  }

  const clamped = clampCommandParams(command);

  if (clamped.type === 'WRITE' || clamped.type === 'LABEL') {
    return fitWorkTextCommand(clamped).map((cmd) => ({
      ...cmd,
      text: normalizeBoardText(cmd.text ?? ""),
    }));
  }

  if (clamped.type === "DIMENSION") {
    return {
      ...clamped,
      text: normalizeBoardText(clamped.text ?? ""),
    };
  }

  if (clamped.type === "DRAW_LINE") {
    const [x1, y1, x2, y2] = clamped.params;
    if (Math.hypot(x2 - x1, y2 - y1) < 2) {
      return null;
    }
  }

  return clamped;
}

function sanitizeLessonSegments(segments: TutorSegment[]): TutorSegment[] {
  const result: TutorSegment[] = [];

  for (const segment of segments) {
    const narration = segment.narration.trim();
    const sanitizedCommands = getSegmentCommands(segment)
      .flatMap((command) => {
        const result = sanitizeCommand(command);
        if (result === null) return [];
        return Array.isArray(result) ? result : [result];
      });

    if (sanitizedCommands.some((command) => command.type === "CLEAR") && result.length === 0) {
      continue;
    }

    if (!narration && sanitizedCommands.length === 0) {
      continue;
    }

    const syncedCommands = sanitizedCommands
      .map((command, index) => (index === 0 ? withSyncMetadata(narration, command) : command))
      .filter((command): command is DrawCommand => command !== null);

    result.push({
      narration,
      command: syncedCommands[0] ?? null,
      commands: syncedCommands.length > 0 ? syncedCommands : undefined,
    });
  }

  return result;
}

/**
 * Build executable lesson segments from an LLM response.
 * Prefers structured [STEP] blocks; falls back to inline tag parsing.
 */
export function buildLessonSegments(responseText: string): TutorSegment[] {
  const structured = parseStructuredLessonSteps(responseText);
  if (structured.length > 0) {
    return sanitizeLessonSegments(structured);
  }

  const parsed = parseDrawingCommands(responseText);
  return sanitizeLessonSegments(parsedResponseToSegments(parsed));
}

/** Spoken narration only — strips [STEP] markers and drawing tags. */
export function lessonNarrationText(responseText: string): string {
  return buildLessonSegments(responseText)
    .map((segment) => segment.narration)
    .filter(Boolean)
    .join(' ');
}
