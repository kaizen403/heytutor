import {
  normalizeBoardText,
  normalizeNarration,
  parseDrawCommandFromTag,
  parseDrawingCommands,
  parsedResponseToSegments,
  getSegmentCommands,
  type DrawCommand,
  type DrawCommandType,
  type TutorSegment,
} from './drawingProtocol';

const STEP_BLOCK_PATTERN = /\[STEP\]\s*([\s\S]*?)\s*\[\/STEP\]/gi;

const DRAWING_TAG_PATTERN =
  /\[(DRAW_CUBOID|DRAW_CUBE|DRAW_RECT|DRAW_CIRCLE|DRAW_LINE|WRITE|LABEL|UNDERLINE|CIRCLE_AROUND|ARROW|HIGHLIGHT|SCRIBBLE|PAUSE|CLEAR|ERASE)(?::([^\]]*))?\]/g;

interface StructuredBoardAction {
  command: DrawCommand;
  tagStart: number;
  tagEnd: number;
  syncAnchor: string;
}

function extractActionsFromBlock(block: string, blockStartIndex: number): StructuredBoardAction[] {
  const actions: StructuredBoardAction[] = [];
  let narrationCursor = 0;

  for (const match of block.matchAll(DRAWING_TAG_PATTERN)) {
    const fullTag = match[0];
    const type = match[1] as DrawCommandType;
    const rawParams = match[2] ?? '';
    const tagIndex = match.index ?? 0;
    const syncAnchor = normalizeNarration(stripDrawingTags(block.slice(narrationCursor, tagIndex)));
    const command = parseDrawCommandFromTag(
      type,
      rawParams,
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
  return text.replace(DRAWING_TAG_PATTERN, '').trim();
}

function withSyncMetadata(narration: string, command: DrawCommand | null): DrawCommand | null {
  if (!command) {
    return null;
  }

  if (command.type !== 'WRITE' && command.type !== 'LABEL') {
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

function sanitizeCommand(command: DrawCommand | null): DrawCommand | null {
  if (!command) {
    return null;
  }

  if (command.type === "WRITE" || command.type === "LABEL") {
    return {
      ...command,
      text: normalizeBoardText(command.text ?? ""),
    };
  }

  if (command.type === "DRAW_LINE") {
    const [x1, y1, x2, y2] = command.params;
    if (Math.hypot(x2 - x1, y2 - y1) < 2) {
      return null;
    }
  }

  return command;
}

function sanitizeLessonSegments(segments: TutorSegment[]): TutorSegment[] {
  const result: TutorSegment[] = [];

  for (const segment of segments) {
    const narration = segment.narration.trim();
    const sanitizedCommands = getSegmentCommands(segment)
      .map((command) => sanitizeCommand(command))
      .filter((command): command is DrawCommand => command !== null);

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
