/**
 * The DSA board follows the voice.
 *
 * Measured on 10 Sep 2026 (binary search, playback 1.5x): the pen was parked
 * for 82% of spoken time. Each TYPE block was typed in the first 22 to 29% of
 * a 19 to 20 s sentence and then nothing moved for 15 s; each FRAME advance
 * drew for 6 s against a 20 s budget and then parked for 10 s. The narration
 * of those same sentences names the lines and the cells it is about ("set lo
 * to the first index", "the value there, which is 12"), so the board has a
 * word to move on. This module finds those words and their moments.
 *
 * Time base is the segment's audio clock in media ms: exact when the sentence
 * was prefetched (every sentence but the first) and the alignment is in hand,
 * otherwise estimated at the session's measured rate, 86 ms per spoken
 * character.
 */
import { mathToSpeech, type AudioTimings } from "@heytutor/tutor-core";

/** Measured pooled speech rate, media ms per spoken character (10 Sep 2026). */
const CODE_SPOKEN_MS_PER_CHAR = 86;

/**
 * What the segment runner hands a code-lesson command so it can follow the
 * sentence it sits under. Structural: the runner passes its own closures.
 */
export interface SpokenSegmentClock {
  /** The sentence as written; mathToSpeech is applied here. */
  narration: string;
  /** The alignment for this sentence, once it exists. Read again after typing: the first sentence's arrives late. */
  getTimings: () => AudioTimings | null;
  /** The runner's estimate of the sentence, media ms, used until the alignment exists. */
  estimatedTotalMs: number;
  /** Media ms since the segment's audio started. */
  getAudioPositionMs: () => number;
  /** Media ms per wall ms. Live lectures run at 1.5. */
  getPlaybackRate: () => number;
  /** The session's measured speech rate when the runner has one. */
  msPerChar?: number;
}

export interface SpokenWord {
  /** Lowercase, digits kept, number words folded to digits. */
  text: string;
  /** Media ms from audio start. */
  startMs: number;
  endMs: number;
  /** Clause index; clauses split at punctuation and at joining words. */
  clause: number;
  /** Offset of the word in the spoken text. */
  offset: number;
}

export interface SpokenTimeline {
  words: SpokenWord[];
  /** Media ms the sentence runs. */
  totalMs: number;
  source: "tts" | "estimated";
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Words that start a new clause without punctuation: "set lo to 0 and hi to the end". */
const CLAUSE_JOINERS = new Set(["and", "then", "so", "because", "which", "while", "otherwise"]);

function timingsUsable(timings: AudioTimings | null | undefined): timings is AudioTimings {
  return Boolean(
    timings &&
      timings.charStartTimes.length > 0 &&
      Number.isFinite(timings.charStartTimes[0]),
  );
}

/**
 * Every spoken word with its moment.
 *
 * The alignment indexes the characters of the text that was sent to the
 * voice, which is the sentence through mathToSpeech, so word offsets are
 * taken in that text and read straight off the alignment. A partial alignment
 * (the first sentence, still streaming) covers its prefix exactly and the
 * rest is carried on from its last aligned character at the estimated rate.
 */
export function spokenTimeline(
  narration: string,
  timings: AudioTimings | null | undefined,
  options: { estimatedTotalMs?: number; msPerChar?: number } = {},
): SpokenTimeline {
  const spoken = mathToSpeech(narration.trim());
  const msPerChar = options.msPerChar && options.msPerChar > 0 ? options.msPerChar : CODE_SPOKEN_MS_PER_CHAR;
  const exact = timingsUsable(timings) ? timings : null;
  const alignedChars = exact ? exact.charStartTimes.length : 0;
  const lastAlignedMs = exact && alignedChars > 0
    ? Math.round((exact.charStartTimes[alignedChars - 1] ?? 0) * 1000)
    : 0;

  const timeAt = (offset: number): number => {
    if (exact && offset < alignedChars && Number.isFinite(exact.charStartTimes[offset])) {
      return Math.max(Math.round((exact.charStartTimes[offset] ?? 0) * 1000), 0);
    }
    if (exact && alignedChars > 0) {
      return lastAlignedMs + (offset - (alignedChars - 1)) * msPerChar;
    }
    return Math.round(offset * msPerChar);
  };

  const words: SpokenWord[] = [];
  let clause = 0;
  let lastEnd = 0;
  const pattern = /[A-Za-z0-9_']+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(spoken)) !== null) {
    const between = spoken.slice(lastEnd, match.index);
    if (words.length > 0 && /[.,;:!?]/.test(between)) clause += 1;
    const raw = match[0].toLowerCase();
    if (words.length > 0 && CLAUSE_JOINERS.has(raw) && !/[.,;:!?]/.test(between)) clause += 1;
    const number = NUMBER_WORDS[raw];
    let text = raw;
    if (number !== undefined) {
      // "twenty three" is one number to the ear.
      const previous = words[words.length - 1];
      if (previous && number < 10 && previous.text.length === 2 && /^[2-9]0$/.test(previous.text) && previous.clause === clause) {
        previous.text = String(Number(previous.text) + number);
        previous.endMs = timeAt(match.index + raw.length);
        lastEnd = match.index + raw.length;
        continue;
      }
      text = String(number);
    }
    words.push({
      text,
      startMs: timeAt(match.index),
      endMs: timeAt(match.index + raw.length),
      clause,
      offset: match.index,
    });
    lastEnd = match.index + raw.length;
  }

  const exactTotal = exact && exact.totalDuration > 0 ? Math.round(exact.totalDuration * 1000) : 0;
  const estimated = Math.max(options.estimatedTotalMs ?? 0, Math.round(spoken.length * msPerChar));
  const totalMs = exact && alignedChars >= spoken.length - 1 && exactTotal > 0
    ? exactTotal
    : Math.max(estimated, words.length > 0 ? words[words.length - 1]!.endMs : 0);
  return { words, totalMs, source: exact ? "tts" : "estimated" };
}

// ---------------------------------------------------------------------------
// Code: which line is the voice on
// ---------------------------------------------------------------------------

/** Spoken forms of the names a program uses, by the identifier as written. */
const IDENTIFIER_SPEECH: Record<string, readonly string[]> = {
  lo: ["lo", "low", "lower", "left"],
  low: ["low", "lo", "lower", "left"],
  l: ["left", "low"],
  left: ["left", "low"],
  start: ["start", "beginning"],
  hi: ["hi", "high", "upper", "right"],
  high: ["high", "hi", "upper", "right"],
  r: ["right", "high"],
  right: ["right", "high"],
  end: ["end", "last"],
  mid: ["mid", "middle", "midpoint", "centre", "center", "halfway"],
  middle: ["middle", "mid", "midpoint"],
  m: ["mid", "middle"],
  prev: ["prev", "previous"],
  curr: ["curr", "current"],
  cur: ["cur", "current"],
  current: ["current"],
  nxt: ["next"],
  next: ["next"],
  node: ["node"],
  head: ["head"],
  tail: ["tail"],
  root: ["root"],
  target: ["target"],
  key: ["key"],
  seen: ["seen"],
  count: ["count", "counter"],
  total: ["total"],
  sum: ["sum", "total"],
  result: ["result", "answer"],
  res: ["result", "answer"],
  ans: ["answer", "result"],
  out: ["output", "result"],
  stack: ["stack"],
  queue: ["queue"],
  visited: ["visited"],
  dp: ["table", "dp"],
  memo: ["memo", "cache"],
  window: ["window"],
  slow: ["slow"],
  fast: ["fast"],
  len: ["length"],
  length: ["length"],
  size: ["size"],
  append: ["append", "add", "push"],
  push: ["push", "add"],
  pop: ["pop", "remove"],
  print: ["print", "prints"],
  none: ["none", "nothing", "null"],
  null: ["null", "nothing"],
  true: ["true"],
  false: ["false"],
  floor: ["floor", "round"],
};

/** Names too common in English to anchor a line by themselves. */
const WEAK_IDENTIFIERS = new Set([
  "a", "arr", "nums", "array", "list", "items", "s", "n", "i", "j", "k", "x", "y", "self", "this",
  "int", "str", "range", "in", "of", "is", "not", "and", "or", "math", "console", "log", "var", "let", "const",
]);

interface SpokenName {
  weight: number;
}

/** A keyword the voice says as itself or as what it does. */
const KEYWORD_SPEECH: ReadonlyArray<{ pattern: RegExp; names: readonly string[]; weight: number }> = [
  { pattern: /\bwhile\b/, names: ["while", "loop", "loops", "looping", "repeat", "repeats", "keeps"], weight: 2 },
  { pattern: /\breturn\b/, names: ["return", "returns", "returning", "give", "gives", "hand", "hands"], weight: 2 },
  { pattern: /\b(?:else|elif)\b/, names: ["otherwise", "else"], weight: 2 },
  { pattern: /\b(?:def|function|fn|func)\b|\b[A-Za-z_]\w*\s*\([^)]*\)\s*(?:\{|:)\s*$/, names: ["define", "defines", "function", "signature", "method"], weight: 2 },
  { pattern: /\bbreak\b/, names: ["break", "stop", "stops"], weight: 2 },
  { pattern: /\bcontinue\b/, names: ["continue", "skip", "skips"], weight: 2 },
  { pattern: /\bif\b/, names: ["if", "check", "checks", "test", "tests", "compare", "compares", "when"], weight: 1 },
  { pattern: /\bfor\b/, names: ["for", "each", "every", "iterate", "walk", "walks"], weight: 1 },
  { pattern: /\/\/|Math\.floor|>>\s*1|\bfloor\b/, names: ["floor", "rounding", "round", "rounds", "halve", "half", "average", "averaging", "midpoint"], weight: 1 },
  { pattern: /===?/, names: ["equals", "equal", "matches", "match", "same"], weight: 1 },
  { pattern: /[^<]<[^<=]|<=/, names: ["less", "smaller", "below", "under"], weight: 1 },
  { pattern: /[^>]>[^>=]|>=/, names: ["greater", "bigger", "larger", "above", "more"], weight: 1 },
  { pattern: /\+\s*1\b/, names: ["plus"], weight: 1 },
  { pattern: /-\s*1\b/, names: ["minus", "negative"], weight: 1 },
];

function splitCompoundIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 1);
}

/**
 * The words that, spoken, put the voice on this line, with how strongly.
 *
 * An identifier the line assigns or declares weighs 3, one it only uses 2,
 * a keyword 1 or 2, a part of a compound name 1 (the whole compound, spoken
 * as consecutive words, is handled by the caller as a phrase). Anything
 * under 2 cannot fire a line on its own, so "if" in "if you look at the
 * figure" moves nothing.
 */
function codeLineSpokenNames(line: string): Map<string, SpokenName> {
  const names = new Map<string, SpokenName>();
  const add = (name: string, weight: number): void => {
    const key = name.toLowerCase();
    const existing = names.get(key);
    if (!existing || existing.weight < weight) names.set(key, { weight });
  };
  const code = line.replace(/#.*$|\/\/.*$/, "");
  const assigned = new Set<string>();
  for (const match of code.matchAll(/\b(?:let|const|var|int|float|double|long|auto)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=(?!=)|\+=|-=|:=)/g)) {
    assigned.add(match[1]!);
  }
  for (const match of code.matchAll(/\bfor\s*\(?\s*(?:let|const|var|int)?\s*([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    assigned.add(match[1]!);
  }
  const signature = /\b(?:def|function)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(code);
  if (signature) {
    assigned.add(signature[1]!);
    for (const param of signature[2]!.split(",")) {
      const name = param.trim().split(/[\s:=]/)[0];
      if (name) assigned.add(name);
    }
  }
  for (const match of code.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const identifier = match[0];
    const lower = identifier.toLowerCase();
    const weight = assigned.has(identifier) ? 3 : 2;
    const speech = IDENTIFIER_SPEECH[lower];
    if (speech) {
      for (const form of speech) add(form, weight);
    }
    if (WEAK_IDENTIFIERS.has(lower)) continue;
    if (identifier.length >= 2 && !/^(?:def|function|while|return|if|else|elif|for|in|break|continue|let|const|var|class|new)$/.test(lower)) {
      const parts = splitCompoundIdentifier(identifier);
      if (parts.length > 1) {
        for (const part of parts) add(part, 1);
        add(parts.join(" "), weight);
      } else if (!speech) {
        add(lower, weight);
      }
    }
  }
  for (const keyword of KEYWORD_SPEECH) {
    if (!keyword.pattern.test(code)) continue;
    for (const name of keyword.names) add(name, keyword.weight);
  }
  return names;
}

export interface CodeLineAnchor {
  /** Line within the block, 0-based. */
  lineIndex: number;
  /** The spoken word that put the voice on this line. */
  token: string;
  /** Media ms when that word starts. */
  startMs: number;
  /** The next anchor's start, or the end of the sentence. */
  endMs: number;
}

/** Below this a clause does not speak about a line strongly enough to move. */
const FIRE_WEIGHT = 2;

/**
 * Where the voice is in the block, word by word.
 *
 * Each clause of the sentence is scored against every line (sum of the
 * weights of the line's names it speaks). A spoken word then anchors the
 * line among those containing it that the clause scores highest, so "lo"
 * in "compute mid by averaging lo and hi" stays on the mid line rather than
 * jumping back to the while line. Consecutive anchors on one line merge.
 */
export function codeLineAnchors(code: string, timeline: SpokenTimeline): CodeLineAnchor[] {
  const lines = code.split("\n");
  const lineNames = lines.map((line) => (line.trim().length > 0 ? codeLineSpokenNames(line) : new Map<string, SpokenName>()));
  const anchors: CodeLineAnchor[] = [];
  const anchored = new Set<number>();
  let current = -1;

  const clauses = new Map<number, SpokenWord[]>();
  for (const word of timeline.words) {
    const list = clauses.get(word.clause) ?? [];
    list.push(word);
    clauses.set(word.clause, list);
  }

  for (const words of clauses.values()) {
    // Clause score per line: each name counted once per clause.
    const scores = lines.map(() => 0);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const names = lineNames[lineIndex]!;
      const seen = new Set<string>();
      for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
        const word = words[wordIndex]!;
        const phrase = wordIndex + 1 < words.length ? `${word.text} ${words[wordIndex + 1]!.text}` : null;
        const hit = (phrase && names.get(phrase)) || names.get(word.text);
        const key = phrase && names.has(phrase) ? phrase : word.text;
        if (!hit || seen.has(key)) continue;
        seen.add(key);
        scores[lineIndex]! += hit.weight;
      }
    }

    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
      const word = words[wordIndex]!;
      const phrase = wordIndex + 1 < words.length ? `${word.text} ${words[wordIndex + 1]!.text}` : null;
      let best = -1;
      let bestScore = -1;
      let bestWeight = 0;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const names = lineNames[lineIndex]!;
        const hit = (phrase && names.get(phrase)) || names.get(word.text);
        if (!hit) continue;
        const score = scores[lineIndex]!;
        const better =
          score > bestScore ||
          (score === bestScore && lineIndex === current) ||
          (score === bestScore && best !== current && !anchored.has(lineIndex) && anchored.has(best));
        if (better) {
          best = lineIndex;
          bestScore = score;
          bestWeight = hit.weight;
        }
      }
      if (best < 0 || best === current) continue;
      // A weak word (if, for, an operator) only moves the caret when the
      // clause as a whole is about that line.
      if (bestWeight < FIRE_WEIGHT && bestScore < FIRE_WEIGHT) continue;
      if (bestWeight < FIRE_WEIGHT && current >= 0 && scores[current]! >= bestScore) continue;
      anchors.push({ lineIndex: best, token: word.text, startMs: word.startMs, endMs: timeline.totalMs });
      anchored.add(best);
      current = best;
    }
  }

  for (let index = 0; index + 1 < anchors.length; index += 1) {
    anchors[index]!.endMs = anchors[index + 1]!.startMs;
  }
  return anchors;
}

export interface CodeBlockSpokenSchedule {
  anchors: CodeLineAnchor[];
  totalMs: number;
  source: "tts" | "estimated";
  /** Lines of the block the voice never named. */
  unspokenLines: number[];
}

/** The whole plan for one typed block under its sentence. */
export function codeBlockSpokenSchedule(
  code: string,
  narration: string,
  timings: AudioTimings | null | undefined,
  options: { estimatedTotalMs?: number; msPerChar?: number } = {},
): CodeBlockSpokenSchedule {
  const timeline = spokenTimeline(narration, timings, options);
  const anchors = codeLineAnchors(code, timeline);
  const named = new Set(anchors.map((anchor) => anchor.lineIndex));
  const unspokenLines = code
    .split("\n")
    .map((line, index) => (line.trim().length > 0 && !named.has(index) ? index : -1))
    .filter((index) => index >= 0);
  return { anchors, totalMs: timeline.totalMs, source: timeline.source, unspokenLines };
}

// ---------------------------------------------------------------------------
// Figure: which cell is the voice on
// ---------------------------------------------------------------------------

/** A verified diagram anchor, as the frame carries it. */
export interface FrameAnchor {
  id: string;
  /** [id, drawn text, role] as compileTraceScenes writes them. */
  labels: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameWalkStop {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The spoken word that sent the pen here. */
  token: string;
  startMs: number;
  endMs: number;
}

const INDEX_CUES = new Set(["index", "indices", "position", "positions", "slot", "slots", "place"]);
const REGION_WORDS = new Set(["range", "region", "window", "remaining", "candidates", "half", "bracket", "span"]);
const EXCLUDED_WORDS = new Set(["dropped", "drop", "excluded", "exclude", "discarded", "discard", "eliminated", "eliminate", "crossed", "thrown", "throw", "ruled", "gone"]);
const ROLE_NOISE = new Set(["marker", "direction", "array", "cell", "mark", "active", "pointer", "region", "still", "possible", "the", "of", "a"]);

interface FrameNameIndex {
  /** Spoken name -> anchor ids, strongest first. */
  byName: Map<string, string[]>;
  /** Value text -> cell id. */
  cellByValue: Map<string, string>;
  /** Index text -> index marker id. */
  indexByText: Map<string, string>;
  /** Value text -> the note that restates it ("target = 16"). */
  noteByValue: Map<string, string>;
  excludedCellIds: string[];
  regionIds: string[];
  rects: Map<string, FrameAnchor>;
}

function pointerNames(label: string): string[] {
  const names = new Set<string>();
  for (const part of label.replace(/^pointer\s+/i, "").split(/[=,/\s]+/)) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    names.add(key);
    for (const form of IDENTIFIER_SPEECH[key] ?? []) names.add(form);
  }
  return [...names];
}

/** Every way the voice can name a part of this frame. */
function indexFrameNames(anchors: readonly FrameAnchor[]): FrameNameIndex {
  const byName = new Map<string, string[]>();
  const cellByValue = new Map<string, string>();
  const indexByText = new Map<string, string>();
  const noteByValue = new Map<string, string>();
  const excludedCellIds: string[] = [];
  const regionIds: string[] = [];
  const rects = new Map<string, FrameAnchor>();
  const add = (name: string, id: string): void => {
    const key = name.toLowerCase();
    const list = byName.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    byName.set(key, list);
  };
  for (const anchor of anchors) {
    rects.set(anchor.id, anchor);
    const [, text = "", role = ""] = anchor.labels;
    const id = anchor.id;
    if (/_lbl$/.test(id)) continue;
    if (/_mk$/.test(id)) {
      const mark = /^mark\s+(\w+)\s+(\S+)/.exec(text) ?? /^mark\s+(\w+)\s+(\S+)/.exec(role);
      if (mark && /excluded|done|dropped/.test(mark[1]!)) excludedCellIds.push(mark[2]!);
      continue;
    }
    if (/^idx\d+$/.test(id)) {
      if (text) indexByText.set(text.trim(), id);
      continue;
    }
    if (/^cell\d+$/.test(id)) {
      const value = text.trim();
      if (value && !cellByValue.has(value)) cellByValue.set(value, id);
      const cell = /array cell (\d+)/.exec(role);
      if (cell) add(`cell ${cell[1]}`, id);
      continue;
    }
    if (/^ptr\d+$/.test(id) || /^pointer\b/.test(text)) {
      for (const name of pointerNames(text || role)) add(name, id);
      continue;
    }
    if (/^brk\d+$/.test(id) || /region/.test(text)) {
      regionIds.push(id);
      continue;
    }
    // Everything else (a note, a list node, a tree node, a grid cell): its
    // own words, and its role words weakly.
    for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length === 0) continue;
      if (/^\d+$/.test(token)) {
        // A note ("target = 16") restates a value. Said as the target, the
        // number belongs to the note; said as a value, to the cell holding it.
        if (/^note/.test(id)) noteByValue.set(token, id);
        else if (!cellByValue.has(token)) cellByValue.set(token, id);
        continue;
      }
      add(token, id);
    }
    for (const token of role.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 2 && !ROLE_NOISE.has(token)) add(token, id);
    }
  }
  return { byName, cellByValue, indexByText, noteByValue, excludedCellIds, regionIds, rects };
}

/**
 * The cells the voice names, in the order it names them.
 *
 * A number is a value first ("the value there, which is 12" sends the pen to
 * the cell holding 12) and an index when the words before it say so ("index
 * 3", "position 3"). Pointer names take their spoken forms (lo, low, left).
 * "dropped" and its kin sweep every excluded cell. Consecutive stops on one
 * part merge; each stop lasts until the next one starts.
 */
export function frameSpokenWalk(
  anchors: readonly FrameAnchor[],
  timeline: SpokenTimeline,
  options: { fromMs?: number } = {},
): FrameWalkStop[] {
  const index = indexFrameNames(anchors);
  const stops: FrameWalkStop[] = [];
  const fromMs = options.fromMs ?? 0;
  let last: string | null = null;
  const push = (id: string, word: SpokenWord): void => {
    const rect = index.rects.get(id);
    if (!rect || last === id) return;
    if (word.startMs < fromMs) return;
    stops.push({
      id,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      token: word.text,
      startMs: word.startMs,
      endMs: timeline.totalMs,
    });
    last = id;
  };
  const words = timeline.words;
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex]!;
    const previous = words[wordIndex - 1];
    const text = word.text;
    if (/^\d+$/.test(text)) {
      const wantsIndex = previous ? INDEX_CUES.has(previous.text) : false;
      const nearby = words.slice(Math.max(wordIndex - 3, 0), wordIndex + 4).map((near) => near.text);
      const asNote = index.noteByValue.get(text);
      const asIndex = index.indexByText.get(text);
      const asValue = index.cellByValue.get(text);
      if (wantsIndex && asIndex) push(asIndex, word);
      else if (asNote && nearby.some((near) => index.byName.get(near)?.includes(asNote))) push(asNote, word);
      else if (asValue) push(asValue, word);
      else if (asIndex) push(asIndex, word);
      continue;
    }
    if (EXCLUDED_WORDS.has(text) && index.excludedCellIds.length > 0) {
      for (const id of index.excludedCellIds) push(id, word);
      continue;
    }
    if (REGION_WORDS.has(text) && index.regionIds.length > 0) {
      push(index.regionIds[0]!, word);
      continue;
    }
    const named = index.byName.get(text);
    if (named && named.length > 0) push(named[0]!, word);
  }
  // A sweep ("dropped" over four excluded cells) lands every stop on one
  // word, so the run shares the time until the next spoken part evenly.
  let runStart = 0;
  while (runStart < stops.length) {
    let runEnd = runStart + 1;
    while (runEnd < stops.length && stops[runEnd]!.startMs === stops[runStart]!.startMs) runEnd += 1;
    const windowEnd = runEnd < stops.length ? stops[runEnd]!.startMs : timeline.totalMs;
    const windowStart = stops[runStart]!.startMs;
    const share = Math.max(windowEnd - windowStart, 0) / (runEnd - runStart);
    for (let stop = runStart; stop < runEnd; stop += 1) {
      stops[stop]!.startMs = Math.round(windowStart + share * (stop - runStart));
      stops[stop]!.endMs = Math.round(windowStart + share * (stop - runStart + 1));
    }
    runStart = runEnd;
  }
  return stops;
}

/**
 * Which of a frame's drawn texts the narration names, for the offline rubric.
 * The lab records the figure as its label texts (values, indices, pointer
 * names) without geometry, so each becomes an anchor of its own kind: a
 * number is a value, a word is a pointer with its spoken forms.
 */
export function namedFrameLabels(renderedLabels: readonly string[], narration: string): string[] {
  const anchors: FrameAnchor[] = renderedLabels.map((text, index) => {
    const trimmed = text.trim();
    const isWord = /^[A-Za-z_][A-Za-z0-9_=]*$/.test(trimmed);
    return {
      id: isWord ? `ptr${index}` : `lbl${index}`,
      labels: [isWord ? `ptr${index}` : `lbl${index}`, isWord ? `pointer ${trimmed}` : trimmed, ""],
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
  });
  const walk = frameSpokenWalk(anchors, spokenTimeline(narration, null));
  const named = new Set<string>();
  for (const stop of walk) {
    const index = Number(stop.id.replace(/^\D+/, ""));
    const label = renderedLabels[index];
    if (label !== undefined) named.add(label.trim());
  }
  return [...named];
}
