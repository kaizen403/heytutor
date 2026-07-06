export type DrawCommandType =
  | 'DRAW_CUBOID'
  | 'DRAW_CUBE'
  | 'DRAW_RECT'
  | 'DRAW_CIRCLE'
  | 'DRAW_LINE'
  | 'WRITE'
  | 'LABEL'
  | 'UNDERLINE'
  | 'CIRCLE_AROUND'
  | 'ARROW'
  | 'HIGHLIGHT'
  | 'SCRIBBLE'
  | 'DIMENSION'
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

export const DRAW_COMMAND_TYPES = [
  'DRAW_CUBOID',
  'DRAW_CUBE',
  'DRAW_RECT',
  'DRAW_CIRCLE',
  'DRAW_LINE',
  'WRITE',
  'LABEL',
  'UNDERLINE',
  'CIRCLE_AROUND',
  'ARROW',
  'HIGHLIGHT',
  'SCRIBBLE',
  'DIMENSION',
  'PAUSE',
  'CLEAR',
  'ERASE',
] as const satisfies readonly DrawCommandType[];

const DRAW_COMMAND_TYPE_SET = new Set<string>(DRAW_COMMAND_TYPES);

export const DRAWING_TAG_SCAN_PATTERN = /\[[^\]\n]{1,256}\]/g;

export interface ParsedDrawingTag {
  type: DrawCommandType;
  rawParams: string;
}

const LEGACY_DRAW_TYPE_ALIASES: Record<string, DrawCommandType | 'DOT'> = {
  CUBOID: 'DRAW_CUBOID',
  CUBE: 'DRAW_CUBE',
  RECT: 'DRAW_RECT',
  RECTANGLE: 'DRAW_RECT',
  CIRCLE: 'DRAW_CIRCLE',
  LINE: 'DRAW_LINE',
  POINT: 'DOT',
  DOT: 'DOT',
};

function splitNameAndParams(inner: string): { name: string; rawParams: string } {
  const colonIndex = inner.indexOf(':');
  const commaIndex = inner.indexOf(',');
  const candidates = [colonIndex, commaIndex].filter((index) => index >= 0);
  const splitIndex = candidates.length > 0 ? Math.min(...candidates) : -1;

  if (splitIndex < 0) {
    return { name: inner.trim(), rawParams: '' };
  }

  return {
    name: inner.slice(0, splitIndex).trim(),
    rawParams: inner.slice(splitIndex + 1).trim(),
  };
}

function normalizeLegacyTextParams(rawParams: string): string {
  const match = /^\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/.exec(rawParams);
  if (!match) {
    return rawParams;
  }

  const [, rawX = '', rawY = '', doubleQuoted, singleQuoted, unquoted] = match;
  const text = (doubleQuoted ?? singleQuoted ?? unquoted ?? '').trim();
  return `${text},${rawX.trim()},${rawY.trim()}`;
}

function normalizeDotParams(rawParams: string): string {
  const params = parseNumericParams(rawParams);
  if (params.length >= 3) {
    return rawParams;
  }
  if (params.length >= 2) {
    return `${params[0]},${params[1]},8`;
  }
  return rawParams;
}

export function parseDrawingTag(rawTag: string): ParsedDrawingTag | null {
  if (!rawTag.startsWith('[') || !rawTag.endsWith(']')) {
    return null;
  }

  const inner = rawTag.slice(1, -1).trim();
  if (!inner || inner.startsWith('/')) {
    return null;
  }

  if (/^DRAW[:_,]/i.test(inner)) {
    const legacy = inner.replace(/^DRAW[:_,]/i, '');
    const { name, rawParams } = splitNameAndParams(legacy);
    const mappedType = LEGACY_DRAW_TYPE_ALIASES[name.trim().toUpperCase()];
    if (!mappedType) {
      return null;
    }

    if (mappedType === 'DOT') {
      return { type: 'DRAW_CIRCLE', rawParams: normalizeDotParams(rawParams) };
    }

    return { type: mappedType, rawParams };
  }

  const { name, rawParams } = splitNameAndParams(inner);
  const normalizedName = name.trim().toUpperCase();

  if (normalizedName === 'DRAW_DOT' || normalizedName === 'DRAW_POINT') {
    return { type: 'DRAW_CIRCLE', rawParams: normalizeDotParams(rawParams) };
  }

  if (normalizedName === 'LABEL' || normalizedName === 'WRITE') {
    return {
      type: normalizedName,
      rawParams: inner.includes(',') && !inner.includes(':')
        ? normalizeLegacyTextParams(rawParams)
        : rawParams,
    };
  }

  if (normalizedName === 'DIMENSION') {
    return { type: 'DIMENSION', rawParams };
  }

  if (!DRAW_COMMAND_TYPE_SET.has(normalizedName)) {
    return null;
  }

  return { type: normalizedName as DrawCommandType, rawParams };
}

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

export function parseDimensionCommandParams(rawParams: string): { text: string; params: number[] } {
  const parts = rawParams.split(',');

  if (parts.length < 6) {
    return { text: rawParams.trim(), params: [] };
  }

  const offset = Number(parts.at(-1)?.trim());
  const y2 = Number(parts.at(-2)?.trim());
  const x2 = Number(parts.at(-3)?.trim());
  const y1 = Number(parts.at(-4)?.trim());
  const x1 = Number(parts.at(-5)?.trim());
  const text = normalizeBoardText(parts.slice(0, -5).join(',').trim());

  if (![x1, y1, x2, y2, offset].every(Number.isFinite)) {
    return { text: rawParams.trim(), params: [] };
  }

  return { text, params: [x1, y1, x2, y2, offset] };
}

const GREEK_WORD_TO_SYMBOL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bomicron\b/gi, 'ο'],
  [/\bepsilon\b/gi, 'ε'],
  [/\bupsilon\b/gi, 'υ'],
  [/\blambda\b/gi, 'λ'],
  [/\bomega\b/gi, 'ω'],
  [/\btheta\b/gi, 'θ'],
  [/\bphi\b/gi, 'φ'],
  [/\balpha\b/gi, 'α'],
  [/\bbeta\b/gi, 'β'],
  [/\bgamma\b/gi, 'γ'],
  [/\bdelta\b/gi, 'δ'],
  [/\bDelta\b/g, 'Δ'],
  [/\bmu\b/gi, 'μ'],
  [/\bpi\b/gi, 'π'],
  [/\brho\b/gi, 'ρ'],
  [/\bsigma\b/gi, 'σ'],
  [/\btau\b/gi, 'τ'],
  [/\bpsi\b/gi, 'ψ'],
  [/\bchi\b/gi, 'χ'],
  [/\bnu\b/gi, 'ν'],
  [/\bxi\b/gi, 'ξ'],
  [/\bkappa\b/gi, 'κ'],
  [/\beta\b/gi, 'η'],
  [/\bzeta\b/gi, 'ζ'],
  [/\biota\b/gi, 'ι'],
];

function normalizeGreekBoardSymbols(text: string): string {
  let normalized = text;
  for (const [pattern, symbol] of GREEK_WORD_TO_SYMBOL) {
    normalized = normalized.replace(pattern, symbol);
  }
  return normalized;
}

export function normalizeBoardText(text: string): string {
  return normalizeGreekBoardSymbols(text)
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
      : type === 'DIMENSION'
        ? parseDimensionCommandParams(rawParams)
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
  /** Runtime template intro — must not be blocked by duplicate-template filtering. */
  templateIntro?: boolean;
}

export function getSegmentCommands(segment: TutorSegment): DrawCommand[] {
  if (segment.commands && segment.commands.length > 0) {
    return segment.commands;
  }

  return segment.command ? [segment.command] : [];
}

export function parseStoredSegmentCommands(stored: unknown): DrawCommand[] {
  if (!stored || typeof stored !== "object") {
    return [];
  }

  if ("commands" in stored && Array.isArray((stored as { commands: unknown }).commands)) {
    return (stored as { commands: DrawCommand[] }).commands.filter(Boolean);
  }

  return [stored as DrawCommand];
}

export function serializeSegmentCommands(commands: DrawCommand[]): DrawCommand | { commands: DrawCommand[] } | null {
  if (commands.length === 0) {
    return null;
  }

  if (commands.length === 1) {
    return commands[0]!;
  }

  return { commands };
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

  DRAWING_TAG_SCAN_PATTERN.lastIndex = 0;

  while ((match = DRAWING_TAG_SCAN_PATTERN.exec(responseText)) !== null) {
    const [fullTag] = match;
    const parsedTag = parseDrawingTag(fullTag);
    if (!parsedTag) {
      narration += responseText.slice(lastIndex, match.index + fullTag.length);
      lastIndex = match.index + fullTag.length;
      continue;
    }

    const commandIndex = commands.length;
    const textBeforeTag = responseText.slice(lastIndex, match.index);

    narration += textBeforeTag;
    segments.push({ text: textBeforeTag, commandIndex });

    commands.push(
      parseDrawCommandFromTag(parsedTag.type, parsedTag.rawParams, match.index, narration),
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
