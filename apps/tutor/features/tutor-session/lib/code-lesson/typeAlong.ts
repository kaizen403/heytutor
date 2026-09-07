/**
 * Type-along practice: a pure, unit-verifiable state machine.
 *
 * The section's full source stays in the editor the whole time; progress
 * never edits text. Confirmed characters render normally, unconfirmed
 * practice characters render as Copilot-style ghost text, and the caret sits
 * on the first unconfirmed character. Scaffold lines (outside every
 * typeAlongRange) are locked and pre-confirmed; the student types only the
 * algorithm core:
 *
 * - the exact next character advances (wrong keys are rejected, never
 *   inserted, and bump a flash counter);
 * - Enter is required at the end of each practice line and auto-indents —
 *   leading whitespace of the next line is confirmed automatically;
 * - Tab accepts through the end of the next word (pending whitespace plus
 *   one run of non-whitespace).
 */
import type { CodeLessonLineRange } from "@heytutor/tutor-core";

export interface TypeAlongLine {
  text: string;
  /** Inside a typeAlongRange: the student types it. */
  practice: boolean;
  /** Columns confirmed so far. Scaffold lines are always fully confirmed. */
  confirmed: number;
}

export interface TypeAlongState {
  lines: TypeAlongLine[];
  /** Line the caret is on. Equals lines.length when the section is done. */
  lineIndex: number;
  /** Wrong keys so far (never inserted). */
  rejectCount: number;
  /** Bumps on every rejection; the UI flashes when it changes. */
  rejectFlash: number;
  complete: boolean;
}

export type TypeAlongKey =
  | { kind: "char"; char: string }
  | { kind: "enter" }
  | { kind: "tab" };

function lineIsInRanges(lineNumber: number, ranges: CodeLessonLineRange[]): boolean {
  return ranges.some((range) => lineNumber >= range.startLine && lineNumber <= range.endLine);
}

function leadingWhitespaceLength(text: string): number {
  return text.length - text.trimStart().length;
}

/**
 * Move the caret forward to the first line with unconfirmed characters,
 * auto-confirming scaffold lines, blank practice lines, and practice-line
 * leading indentation on the way.
 */
function settle(state: TypeAlongState): TypeAlongState {
  const lines = [...state.lines];
  let lineIndex = state.lineIndex;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!;
    if (!line.practice) {
      if (line.confirmed < line.text.length) {
        lines[lineIndex] = { ...line, confirmed: line.text.length };
      }
      lineIndex += 1;
      continue;
    }
    const indent = leadingWhitespaceLength(line.text);
    if (line.confirmed < indent) {
      lines[lineIndex] = { ...line, confirmed: indent };
    }
    if (line.text.trim() === "") {
      lines[lineIndex] = { ...line, confirmed: line.text.length };
      lineIndex += 1;
      continue;
    }
    break;
  }
  // Once every character is confirmed the section is done — no trailing
  // Enter is demanded after the last practice line.
  const allConfirmed = lines.every((line) => line.confirmed >= line.text.length);
  return {
    ...state,
    lines,
    lineIndex: allConfirmed ? lines.length : lineIndex,
    complete: allConfirmed || lineIndex >= lines.length,
  };
}

/** Build the state for one section. Zero practice ranges completes instantly. */
export function createTypeAlongSection(
  sectionCode: string,
  typeAlongRanges: CodeLessonLineRange[],
): TypeAlongState {
  const lines: TypeAlongLine[] = sectionCode.split("\n").map((text, index) => {
    const practice = lineIsInRanges(index + 1, typeAlongRanges);
    return { text, practice, confirmed: practice ? 0 : text.length };
  });
  return settle({
    lines,
    lineIndex: 0,
    rejectCount: 0,
    rejectFlash: 0,
    complete: false,
  });
}

function reject(state: TypeAlongState): TypeAlongState {
  return {
    ...state,
    rejectCount: state.rejectCount + 1,
    rejectFlash: state.rejectFlash + 1,
  };
}

function confirmThrough(state: TypeAlongState, confirmed: number): TypeAlongState {
  const lines = [...state.lines];
  const line = lines[state.lineIndex]!;
  lines[state.lineIndex] = { ...line, confirmed };
  return { ...state, lines };
}

/** Feed one key through the machine. Wrong keys never change the text. */
export function typeAlongKey(state: TypeAlongState, key: TypeAlongKey): TypeAlongState {
  if (state.complete) return state;
  const line = state.lines[state.lineIndex]!;
  const atLineEnd = line.confirmed >= line.text.length;

  if (key.kind === "enter") {
    if (!atLineEnd) return reject(state);
    return settle({ ...state, lineIndex: state.lineIndex + 1 });
  }

  if (key.kind === "tab") {
    if (atLineEnd) return reject(state);
    const rest = line.text.slice(line.confirmed);
    const match = rest.match(/^\s*\S+/);
    if (!match) return reject(state);
    return settle(confirmThrough(state, line.confirmed + match[0].length));
  }

  // A pasted or IME-composed multi-char string only advances if it matches
  // exactly; otherwise it is one rejection, not one per character.
  if (key.char.length === 0) return state;
  if (key.char === "\n") return typeAlongKey(state, { kind: "enter" });
  if (atLineEnd) return reject(state);
  if (!line.text.startsWith(key.char, line.confirmed)) return reject(state);
  return settle(confirmThrough(state, line.confirmed + key.char.length));
}

/** Absolute caret offset in the section source (newlines count 1). */
export function typeAlongCaretOffset(state: TypeAlongState): number {
  let offset = 0;
  for (let index = 0; index < state.lines.length; index += 1) {
    const line = state.lines[index]!;
    if (index === state.lineIndex) return offset + line.confirmed;
    offset += line.text.length + 1;
  }
  return Math.max(0, offset - 1);
}

/** Unconfirmed spans, in absolute offsets — the ghost-text decorations. */
export function typeAlongGhostRanges(
  state: TypeAlongState,
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let offset = 0;
  for (const line of state.lines) {
    if (line.confirmed < line.text.length) {
      ranges.push({ from: offset + line.confirmed, to: offset + line.text.length });
    }
    offset += line.text.length + 1;
  }
  return ranges;
}

/** Locked scaffold lines, in absolute offsets (including their newlines). */
export function typeAlongLockedRanges(
  state: TypeAlongState,
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let offset = 0;
  for (const line of state.lines) {
    if (!line.practice) {
      const to = offset + line.text.length + 1;
      const previous = ranges.at(-1);
      if (previous && previous.to === offset) previous.to = to;
      else ranges.push({ from: offset, to });
    }
    offset += line.text.length + 1;
  }
  return ranges;
}

export function typeAlongProgress(state: TypeAlongState): {
  typedChars: number;
  totalChars: number;
} {
  let typedChars = 0;
  let totalChars = 0;
  for (const line of state.lines) {
    if (!line.practice) continue;
    const indent = leadingWhitespaceLength(line.text);
    const practiceChars = Math.max(0, line.text.length - indent);
    totalChars += practiceChars;
    typedChars += Math.min(practiceChars, Math.max(0, line.confirmed - indent));
  }
  return { typedChars, totalChars };
}
