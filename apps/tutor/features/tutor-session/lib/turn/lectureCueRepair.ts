import {
  parseDrawingCommands,
  parseDrawingTag,
  scanDrawingTags,
  type DrawCommand,
} from "@heytutor/drawing";

/**
 * The pen schedules a row from the words in front of its tag. Two misses from
 * the rough-incline lectures are repaired here, after the model speaks and
 * before the board runs:
 *
 * - a relation row whose step never says "equals" (it said "has magnitude")
 * - a lesson of relations that never boxes the result
 *
 * Code lessons are left alone: a [TYPE] step is a program, not a notebook row.
 */

const RELATION = /[=<>]|\b(?:sqrt|sum|int)\b/;
const OPEN_UNKNOWN = /=\s*\?\s*$/;
const SAYS_EQUALS = /\bequals\b|\bequal to\b/i;
/** "is" used as a copula, not "is the", "is no", "is stuck". */
const COPULA_IS =
  /\bis\b(?!\s+(?:the|a|an|no|not|its|stuck|there|this|that|what|still|only|now)\b)/gi;

function isRelationWrite(command: DrawCommand): boolean {
  if (command.type !== "WRITE") return false;
  const row = (command.text ?? "").trim();
  return RELATION.test(row) && !OPEN_UNKNOWN.test(row);
}

function narrationOutsideTags(text: string): string {
  return parseDrawingCommands(text).narration;
}

/**
 * One closed step, or a tail that never opened one. Relation rows that were
 * spoken without "equals" pick up the word. Everything else is unchanged.
 */
export function repairLectureStep(step: string): string {
  if (/\[TYPE[:\]]/i.test(step)) return step;
  const parsed = parseDrawingCommands(step);
  if (!parsed.commands.some(isRelationWrite)) return step;
  if (SAYS_EQUALS.test(narrationOutsideTags(step))) return step;

  if (/\bhas magnitude\b/i.test(step)) {
    return step.replace(/\bhas magnitude\b/i, "equals");
  }

  const tags = scanDrawingTags(step);
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  for (const tag of tags) {
    if (tag.index > cursor) ranges.push([cursor, tag.index]);
    cursor = tag.index + tag.fullTag.length;
  }
  if (cursor < step.length) ranges.push([cursor, step.length]);

  let last: { start: number; end: number } | null = null;
  for (const [from, to] of ranges) {
    const slice = step.slice(from, to);
    COPULA_IS.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COPULA_IS.exec(slice))) {
      last = { start: from + match.index, end: from + match.index + match[0].length };
    }
  }
  if (!last) return step;
  return `${step.slice(0, last.start)}equals${step.slice(last.end)}`;
}

function ensureResultEmphasis(raw: string): string {
  if (/\[EMPHASIZE[:\]]/i.test(raw)) return raw;
  const parsed = parseDrawingCommands(raw);
  const relations = parsed.commands.filter(isRelationWrite);
  if (relations.length < 3) return raw;

  const tags = scanDrawingTags(raw);
  let commandIndex = 0;
  let lastWrite: { index: number; length: number } | null = null;
  for (const tag of tags) {
    const parsedTag = parseDrawingTag(tag.fullTag);
    if (!parsedTag) continue;
    const command = parsed.commands[commandIndex];
    commandIndex += 1;
    if (command && isRelationWrite(command)) {
      lastWrite = { index: tag.index, length: tag.fullTag.length };
    }
  }
  if (!lastWrite) return raw;
  const insertAt = lastWrite.index + lastWrite.length;
  return `${raw.slice(0, insertAt)}[EMPHASIZE:last]${raw.slice(insertAt)}`;
}

/** Repair every step, then box the closing relation when the model boxed nothing. */
export function repairLectureMarkup(raw: string): string {
  const pattern = /\[STEP\][\s\S]*?\[\/STEP\]/gi;
  let last = 0;
  let out = "";
  for (const match of raw.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += raw.slice(last, index);
    out += repairLectureStep(match[0]);
    last = index + match[0].length;
  }
  out += repairLectureStep(raw.slice(last));
  return ensureResultEmphasis(out);
}

function findTag(text: string, tag: string): number {
  return text.toUpperCase().indexOf(tag);
}

/** How many characters at the end might still grow into `[STEP]` or `[/STEP]`. */
function partialBracketTail(text: string): number {
  const bracket = text.lastIndexOf("[");
  if (bracket < 0) return 0;
  const tail = text.slice(bracket).toUpperCase();
  const heads = ["[STEP]", "[/STEP]"];
  if (heads.some((head) => head.startsWith(tail) && tail.length < head.length)) {
    return text.length - bracket;
  }
  return 0;
}

/**
 * Streaming companion of `repairLectureMarkup`. `push` returns text the parser
 * can speak now. `finish` returns whatever was still held, including a result
 * box when the lesson wrote relations and never boxed one.
 */
export class LectureMarkupBuffer {
  private pending = "";
  private pushed = "";

  push(delta: string): string {
    this.pending += delta;
    let ready = "";
    while (this.pending.length > 0) {
      const start = findTag(this.pending, "[STEP]");
      if (start > 0) {
        ready += this.pending.slice(0, start);
        this.pending = this.pending.slice(start);
        continue;
      }
      if (start < 0) {
        const keep = partialBracketTail(this.pending);
        ready += this.pending.slice(0, this.pending.length - keep);
        this.pending = this.pending.slice(this.pending.length - keep);
        break;
      }
      const end = findTag(this.pending, "[/STEP]");
      if (end < 0) break;
      const close = end + "[/STEP]".length;
      const step = this.pending.slice(0, close);
      this.pending = this.pending.slice(close);
      ready += repairLectureStep(step);
    }
    this.pushed += ready;
    return ready;
  }

  /**
   * Text still owed to the parser. The saved lesson is `text()`, which keeps
   * the box inside the step that wrote the result. When that step was already
   * spoken, the parser instead receives a trailing `[EMPHASIZE:last]`, which
   * boxes the same row.
   */
  finish(): string {
    const tail = this.pending.length > 0 ? repairLectureStep(this.pending) : "";
    this.pending = "";
    const full = ensureResultEmphasis(this.pushed + tail);
    const extra = full.startsWith(this.pushed)
      ? full.slice(this.pushed.length)
      : `${tail}[EMPHASIZE:last]`;
    this.pushed = full;
    return extra;
  }

  /** The lesson to save and replay, after speech repair and the result box. */
  text(): string {
    return this.pushed;
  }
}
