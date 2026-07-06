import {
  DRAWING_TAG_SCAN_PATTERN,
  normalizeBoardText,
  normalizeNarration,
  parseDrawingTag,
  parseDrawCommandFromTag,
  parseDrawingCommands,
  parsedResponseToSegments,
  getSegmentCommands,
  type DrawCommand,
  type DrawCommandType,
  type TutorSegment,
} from './drawingProtocol';
import { BOARD_CANVAS, DIAGRAM_ZONE, WORK_ZONE, SECOND_WORK_ZONE } from './boardZones';
import { measureTextWidth } from './handwriting';

const STEP_BLOCK_PATTERN = /\[STEP\]\s*([\s\S]*?)\s*\[\/STEP\]/gi;

const RUNTIME_MANAGED_COMMAND_TYPES = new Set<DrawCommandType>(['CLEAR', 'ERASE']);
const WORK_TEXT_BOTTOM_Y = WORK_ZONE.topY + WORK_ZONE.lineHeight * 9;
const SECOND_WORK_BOTTOM_Y = SECOND_WORK_ZONE.topY + SECOND_WORK_ZONE.lineHeight * 9;

interface StructuredBoardAction {
  command: DrawCommand;
  tagStart: number;
  tagEnd: number;
  syncAnchor: string;
}

function extractActionsFromBlock(block: string, blockStartIndex: number): StructuredBoardAction[] {
  const actions: StructuredBoardAction[] = [];
  let narrationCursor = 0;

  DRAWING_TAG_SCAN_PATTERN.lastIndex = 0;
  for (const match of block.matchAll(DRAWING_TAG_SCAN_PATTERN)) {
    const fullTag = match[0];
    const parsedTag = parseDrawingTag(fullTag);
    if (!parsedTag) {
      continue;
    }

    const tagIndex = match.index ?? 0;
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
  DRAWING_TAG_SCAN_PATTERN.lastIndex = 0;
  return text
    .replace(DRAWING_TAG_SCAN_PATTERN, (tag) => (parseDrawingTag(tag) ? '' : tag))
    .trim();
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

function findBestSplitPoint(text: string): number {
  const operators = ['=', '→', '≈', '≤', '≥', '+', '−', '-'];
  let bestIdx = -1;
  let bestScore = 0;

  for (const op of operators) {
    const idx = text.indexOf(op);
    if (idx > 0 && idx < text.length - 1) {
      const score = idx > text.length * 0.3 && idx < text.length * 0.7 ? 2 : 1;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx + 1;
      }
    }
  }

  if (bestIdx < 0) {
    for (let i = Math.floor(text.length * 0.6); i < text.length; i++) {
      if (text[i] === ' ') {
        bestIdx = i;
        break;
      }
    }
  }

  return bestIdx;
}

function clampWorkTextCommand(command: DrawCommand): DrawCommand | DrawCommand[] {
  if (command.type !== 'WRITE' || command.params.length < 2) {
    return command;
  }

  const [x, y] = command.params;
  const text = command.text ?? '';
  const textWidth = measureTextWidth(text, 32);
  const rightBoundary = DIAGRAM_ZONE.x - 20;

  if (x >= SECOND_WORK_ZONE.marginX && x <= SECOND_WORK_ZONE.marginX + SECOND_WORK_ZONE.maxWidth) {
    const next = [...command.params];
    next[1] = Math.min(Math.max(y, SECOND_WORK_ZONE.topY), SECOND_WORK_BOTTOM_Y);
    return { ...command, params: next };
  }

  if (x >= DIAGRAM_ZONE.x) {
    return command;
  }

  if (x + textWidth > rightBoundary && x < DIAGRAM_ZONE.x) {
    const splitIdx = findBestSplitPoint(text);
    if (splitIdx > 0) {
      const part1 = text.slice(0, splitIdx).trim();
      const part2 = text.slice(splitIdx).trim();
      const part1Width = measureTextWidth(part1, 32);

      if (x + part1Width <= rightBoundary && part2.length > 0) {
        const clampedY1 = Math.min(Math.max(y, WORK_ZONE.topY), WORK_TEXT_BOTTOM_Y);
        const clampedY2 = Math.min(Math.max(y + WORK_ZONE.lineHeight, WORK_ZONE.topY), WORK_TEXT_BOTTOM_Y);
        return [
          { ...command, text: part1, params: [x, clampedY1] },
          { ...command, text: part2, params: [x, clampedY2] },
        ];
      }
    }

    const maxX = rightBoundary - textWidth;
    if (maxX >= WORK_ZONE.marginX) {
      const clampedY = Math.min(Math.max(y, WORK_ZONE.topY), WORK_TEXT_BOTTOM_Y);
      return { ...command, params: [maxX, clampedY] };
    }
  }

  if (y > WORK_TEXT_BOTTOM_Y) {
    return {
      ...command,
      params: [SECOND_WORK_ZONE.marginX, Math.min(Math.max(y, SECOND_WORK_ZONE.topY), SECOND_WORK_BOTTOM_Y)],
    };
  }

  const next = [...command.params];
  next[0] = Math.min(Math.max(x, WORK_ZONE.marginX), WORK_ZONE.x + WORK_ZONE.width);
  next[1] = Math.min(Math.max(y, WORK_ZONE.topY), WORK_TEXT_BOTTOM_Y);
  return { ...command, params: next };
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
    const textResult = clampWorkTextCommand(clamped);
    if (Array.isArray(textResult)) {
      return textResult.map((cmd) => ({
        ...cmd,
        text: normalizeBoardText(cmd.text ?? ""),
      }));
    }
    return {
      ...textResult,
      text: normalizeBoardText(textResult.text ?? ""),
    };
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
