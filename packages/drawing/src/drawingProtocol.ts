export type DrawCommandType =
  | 'DRAW_CUBOID'
  | 'DRAW_CUBE'
  | 'DRAW_RECT'
  | 'DRAW_CIRCLE'
  | 'DRAW_LINE'
  | 'WRITE'
  | 'LABEL'
  | 'PAUSE'
  | 'CLEAR'
  | 'ERASE';

export interface DrawCommand {
  type: DrawCommandType;
  params: number[];
  text?: string;
  charPosition: number;
  narrationBefore: string;
  syncable?: boolean;
  syncReason?: string;
}

export interface ParsedResponse {
  narration: string;
  commands: DrawCommand[];
  segments: { text: string; commandIndex: number }[];
}

const DRAWING_TAG_PATTERN =
  /\[(DRAW_CUBOID|DRAW_CUBE|DRAW_RECT|DRAW_CIRCLE|DRAW_LINE|WRITE|LABEL|PAUSE|CLEAR|ERASE)(?::([^\]]*))?\]/g;

export function parseNumericParams(rawParams: string): number[] {
  if (rawParams.trim() === '') {
    return [];
  }

  return rawParams
    .split(',')
    .map((param) => Number(param.trim()))
    .filter((param) => Number.isFinite(param));
}

export function parseTextCommandParams(rawParams: string): { text: string; params: number[] } {
  const parts = rawParams.split(',');

  if (parts.length < 3) {
    return { text: rawParams.trim(), params: [] };
  }

  const y = Number(parts.at(-1)?.trim());
  const x = Number(parts.at(-2)?.trim());
  const text = normalizeBoardText(parts.slice(0, -2).join(',').trim());

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { text: rawParams.trim(), params: [] };
  }

  return { text, params: [x, y] };
}

export function normalizeBoardText(text: string): string {
  return text
    .replace(/\bdistance\s+squared\b/gi, 'd^2')
    .replace(/\bradius\s+squared\b/gi, 'r^2')
    .replace(/\br\s+squared\b/gi, 'r^2')
    .replace(/\bx\s+squared\b/gi, 'x^2')
    .replace(/\by\s+squared\b/gi, 'y^2')
    .replace(/\b([a-z0-9)])\s+squared\b/gi, '$1^2')
    .replace(/\bsquare\s+root\s+of\s+([a-z0-9()+\-\s]+)\b/gi, 'sqrt($1)')
    .replace(/\bminus\b/gi, '-')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bequals\b/gi, '=')
    .replace(/\btimes\b/gi, '*')
    .replace(/\s+([=+\-*])\s+/g, ' $1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normalizeNarration(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function parseDrawCommandFromTag(
  type: DrawCommandType,
  rawParams: string,
  charPosition: number,
  narrationBefore: string,
): DrawCommand {
  const parsed =
    type === 'WRITE' || type === 'LABEL'
      ? parseTextCommandParams(rawParams)
      : { params: parseNumericParams(rawParams), text: undefined };

  return {
    type,
    params: parsed.params,
    text: parsed.text,
    charPosition,
    narrationBefore: normalizeNarration(narrationBefore),
  };
}

export interface TutorSegment {
  narration: string;
  command: DrawCommand | null;
  commands?: DrawCommand[];
}

export function getSegmentCommands(segment: TutorSegment): DrawCommand[] {
  if (segment.commands && segment.commands.length > 0) {
    return segment.commands;
  }

  return segment.command ? [segment.command] : [];
}

function coalesceSegments(segments: TutorSegment[]): TutorSegment[] {
  return segments.map((segment) => ({
    narration: segment.narration,
    command: segment.command,
    commands: segment.command ? [segment.command] : [],
  }));
}

export function parsedResponseToSegments(parsed: ParsedResponse): TutorSegment[] {
  const segments: TutorSegment[] = [];

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    const narration = seg.text.trim();
    const command =
      seg.commandIndex < parsed.commands.length ? parsed.commands[seg.commandIndex] : null;

    if (!narration && !command) {
      continue;
    }

    segments.push({ narration, command });
  }

  return coalesceSegments(segments);
}

export function parseDrawingCommands(responseText: string): ParsedResponse {
  const commands: DrawCommand[] = [];
  const segments: { text: string; commandIndex: number }[] = [];
  let narration = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  DRAWING_TAG_PATTERN.lastIndex = 0;

  while ((match = DRAWING_TAG_PATTERN.exec(responseText)) !== null) {
    const [fullTag, rawType, rawParams = ''] = match;
    const commandIndex = commands.length;
    const textBeforeTag = responseText.slice(lastIndex, match.index);

    narration += textBeforeTag;
    segments.push({ text: textBeforeTag, commandIndex });

    const type = rawType as DrawCommandType;

    commands.push(
      parseDrawCommandFromTag(type, rawParams, match.index, narration),
    );

    lastIndex = match.index + fullTag.length;
  }

  const trailingText = responseText.slice(lastIndex);
  narration += trailingText;

  if (trailingText.length > 0 || segments.length === 0) {
    segments.push({ text: trailingText, commandIndex: commands.length });
  }

  return {
    narration: normalizeNarration(narration),
    commands,
    segments,
  };
}
