/**
 * Type-along state machine gate: exact-char advance, Enter auto-indent,
 * Tab word-accept, rejection without insertion, scaffold locking, and
 * completion — all against a realistic mixed scaffold/practice section.
 */
import {
  createTypeAlongSection,
  typeAlongCaretOffset,
  typeAlongGhostRanges,
  typeAlongKey,
  typeAlongLockedRanges,
  typeAlongProgress,
  type TypeAlongState,
} from "../../features/tutor-session/lib/code-lesson/typeAlong";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function typeString(state: TypeAlongState, text: string): TypeAlongState {
  let next = state;
  for (const char of text) {
    next = typeAlongKey(next, char === "\n" ? { kind: "enter" } : { kind: "char", char });
  }
  return next;
}

const SECTION = [
  "def binary_search(items, target):",
  "    lo = 0",
  "    hi = len(items) - 1",
  "    while lo <= hi:",
  "        mid = (lo + hi) // 2",
  "        if items[mid] == target:",
  "            return mid",
  "    return -1",
].join("\n");

// Practice lines 2-5; signature and the tail stay scaffold.
const RANGES = [{ startLine: 2, endLine: 5 }];

// --- initial state ---
let state = createTypeAlongSection(SECTION, RANGES);
assert(!state.complete, "section with practice ranges must not start complete");
assert(state.lineIndex === 1, "caret must start on the first practice line");
// Leading indent is auto-confirmed (auto-indent on entry).
assert(state.lines[1]!.confirmed === 4, "practice-line indent is auto-confirmed");
assert(
  typeAlongCaretOffset(state) === SECTION.indexOf("lo = 0"),
  "caret offset must sit on the first practice character",
);
const locked = typeAlongLockedRanges(state);
assert(
  locked.length === 2 && locked[0]!.from === 0,
  "scaffold must be locked above and below the practice block",
);
const ghostBefore = typeAlongGhostRanges(state);
assert(
  ghostBefore.length === 4 && ghostBefore[0]!.to - ghostBefore[0]!.from === "lo = 0".length,
  "every unconfirmed practice span is ghost text",
);

// --- exact-char advance and rejection ---
const wrong = typeAlongKey(state, { kind: "char", char: "x" });
assert(wrong.rejectCount === 1 && wrong.rejectFlash === 1, "wrong key must be rejected");
assert(
  wrong.lines[1]!.confirmed === state.lines[1]!.confirmed,
  "wrong key must never be inserted",
);
state = typeAlongKey(wrong, { kind: "char", char: "l" });
const confirmedAfterExactKey: number = state.lines[1]!.confirmed;
assert(confirmedAfterExactKey === 5, "exact key advances one character");

// --- Enter required at line end; premature Enter rejected ---
const early = typeAlongKey(state, { kind: "enter" });
assert(early.rejectCount === 2, "Enter before line end is rejected");
state = typeString(state, "o = 0");
assert(state.lines[1]!.confirmed === state.lines[1]!.text.length, "line 2 fully confirmed");
state = typeAlongKey(state, { kind: "enter" });
assert(state.lineIndex === 2, "Enter advances to the next practice line");
assert(state.lines[2]!.confirmed === 4, "Enter auto-indents the next line");

// --- Tab accepts through the next word boundary ---
state = typeAlongKey(state, { kind: "tab" });
assert(
  state.lines[2]!.text.slice(0, state.lines[2]!.confirmed) === "    hi",
  `Tab accepts exactly one word, got "${state.lines[2]!.text.slice(0, state.lines[2]!.confirmed)}"`,
);
state = typeAlongKey(state, { kind: "tab" });
assert(
  state.lines[2]!.text.slice(0, state.lines[2]!.confirmed) === "    hi =",
  "Tab consumes pending whitespace plus the next word",
);

// --- finish the section ---
while (!state.complete) {
  const line = state.lines[state.lineIndex]!;
  state = line.confirmed >= line.text.length
    ? typeAlongKey(state, { kind: "enter" })
    : typeAlongKey(state, { kind: "char", char: line.text[line.confirmed]! });
}
assert(state.complete, "typing every practice character completes the section");
assert(typeAlongGhostRanges(state).length === 0, "no ghost text remains when complete");
const progress = typeAlongProgress(state);
assert(
  progress.typedChars === progress.totalChars && progress.totalChars > 0,
  "progress must reach total",
);

// --- keys after completion are ignored ---
const after = typeAlongKey(state, { kind: "char", char: "x" });
assert(after.rejectCount === state.rejectCount, "completed sections ignore input");

// --- scaffold-only section completes instantly ---
const scaffoldOnly = createTypeAlongSection("print('hi')", []);
assert(scaffoldOnly.complete, "sections without practice ranges complete instantly");

// --- blank practice lines are skipped ---
const withBlank = createTypeAlongSection("a = 1\n\nb = 2", [{ startLine: 1, endLine: 3 }]);
const done = typeString(typeString(withBlank, "a = 1\n"), "b = 2");
assert(done.complete, "blank practice lines auto-confirm and never trap the caret");

// --- multi-char input must match exactly (paste guard) ---
const pasted = createTypeAlongSection("total = 0", [{ startLine: 1, endLine: 1 }]);
const goodPaste = typeAlongKey(pasted, { kind: "char", char: "total" });
assert(goodPaste.lines[0]!.confirmed === 5, "matching paste advances as one unit");
const badPaste = typeAlongKey(goodPaste, { kind: "char", char: "xx" });
assert(badPaste.rejectCount === 1, "non-matching paste is one rejection, never inserted");

console.log("verify-type-along: all checks passed");
