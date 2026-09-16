import type { AudioTimings } from "../tts/elevenLabsClient";
import { mathToSpeech } from "../tts/elevenLabsClient";
import {
  lastMeaningfulClause,
  normalizeForSpeechMatch,
  timingEndMs,
  timingStartMs,
  validateAudioTimingsForNarration,
} from "./audioSync";

/**
 * When the voice names each FOCUS target inside a segment.
 *
 * Measured on 10 Sep 2026: a [FOCUS:mirror,C,F] tag sat at the end of a 7.2 s
 * sentence that named M, C and F in turn, and the runtime traced all three at
 * t=0 inside one 900 ms gesture. Its window search used the tag's own text
 * ("O_base", a single letter dropped by the two-character candidate floor) and
 * the last clause of the sentence, so 0 of 21 lab FOCUS tags got a matched
 * window. This module finds the spoken name of every target (the letter on
 * the board, the entity label, the role words) as whole tokens, in spoken
 * order, and hands back one window per target: name start to clause end.
 */
export interface FocusTargetWindow {
  /** Diagram anchor id. */
  id: string;
  /** Media ms from segment audio start when the name begins. */
  startMs: number;
  /** Clause end; always >= startMs + MIN_FOCUS_WINDOW_MS. */
  endMs: number;
  /**
   * label: the board letter itself was spoken ("F", "R1").
   * role: a descriptive name was spoken ("focal point", "mirror").
   * clause: nothing matched; the window is the last clause before the tag.
   * proportional: no name and no clause; spread across the second half.
   */
  anchor: "label" | "role" | "clause" | "proportional";
}

export interface FocusTargetSchedule {
  /** Spoken order, monotonic startMs. */
  targets: FocusTargetWindow[];
  matchedCount: number;
  source: "tts" | "estimated";
}

/** A resolved FOCUS target: the verified diagram anchor's id and its names. */
export interface FocusScheduleTarget {
  id: string;
  /** [id, drawn label text, entity label, role] as the anchors carry them. */
  labels: string[];
}

/** The FOCUS command; a DrawCommand fits structurally. */
export interface FocusScheduleCommand {
  text?: string;
  narrationBefore: string;
  charPosition?: number;
}

export interface FocusScheduleInput {
  /** Raw segment narration, before mathToSpeech. */
  narration: string;
  command: FocusScheduleCommand;
  /** Resolved anchors in spec order. */
  targets: FocusScheduleTarget[];
  /** Character alignment for this segment, or null when only an estimate exists. */
  timings?: AudioTimings | null;
  /** Estimated speech rate; the measured pooled rate was 86.2 ms per spoken char. */
  msPerChar?: number;
}

export const DEFAULT_FOCUS_MS_PER_CHAR = 86;
export const MIN_FOCUS_WINDOW_MS = 600;

/**
 * Spoken forms of the conventional optics letters. Tier 2 only: the letter
 * itself wins when it is spoken, these carry the pen when the tutor says
 * "the focal point" without naming F.
 */
const LETTER_SPOKEN_FORMS: Record<string, string[]> = {
  O: ["object"],
  I: ["image"],
  F: ["focus", "focal point"],
  C: ["centre of curvature", "center of curvature", "centre", "center"],
  P: ["pole"],
  M: ["mirror"],
};

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

interface SpokenToken {
  raw: string;
  /** Char offset in the spoken (mathToSpeech) string; timings index this. */
  start: number;
  end: number;
}

interface NormalizedWord {
  text: string;
  token: number;
}

interface SpokenNarration {
  spoken: string;
  tokens: SpokenToken[];
  words: NormalizedWord[];
  /** Exclusive offsets just past each clause terminator, ending with the text end. */
  clauseEnds: number[];
}

type NameTier = 1 | 2;

interface Candidate {
  words: string[];
  tier: NameTier;
  anchor: "label" | "role";
  /** Raw spellings a short name must match case-sensitively; null for long names. */
  rawForms: string[] | null;
}

interface Occurrence {
  wordStart: number;
  wordEnd: number;
  tokenStart: number;
  tokenEnd: number;
  tier: NameTier;
  anchor: "label" | "role";
}

interface SegmentClock {
  startAt(offset: number): number;
  endAt(exclusiveOffset: number): number;
  totalMs: number;
}

function splitWords(text: string): string[] {
  return normalizeForSpeechMatch(text).split(" ").filter(Boolean);
}

function parseSpokenNarration(narration: string): SpokenNarration {
  const spoken = mathToSpeech(narration.trim());
  const tokens: SpokenToken[] = [];
  const words: NormalizedWord[] = [];
  const tokenPattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(spoken)) !== null) {
    const index = tokens.length;
    tokens.push({ raw: match[0], start: match.index, end: match.index + match[0].length });
    for (const word of splitWords(match[0])) {
      words.push({ text: word, token: index });
    }
  }

  const clauseEnds: number[] = [];
  const terminatorPattern = /[,.;:!?]+(?=\s|$)/g;
  while ((match = terminatorPattern.exec(spoken)) !== null) {
    clauseEnds.push(match.index + match[0].length);
  }
  if (clauseEnds.at(-1) !== spoken.length) {
    clauseEnds.push(spoken.length);
  }

  return { spoken, tokens, words, clauseEnds };
}

function clauseEndAfter(parsed: SpokenNarration, offset: number): number {
  return parsed.clauseEnds.find((end) => end > offset) ?? parsed.spoken.length;
}

function stripTokenEdges(raw: string): string {
  return raw
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/'s$/, "");
}

function isAsciiShortName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]{0,2}$/.test(name);
}

function isShortName(name: string): boolean {
  return [...name].length <= 3;
}

/** Raw spellings the voice text may carry for a short name: "R1", "R 1", "R one". */
function rawCaseForms(name: string): string[] {
  const forms = new Set<string>([name]);
  const lettered = /^([A-Za-z]+)(\d)$/.exec(name);
  if (lettered) {
    const [, letters, digit] = lettered;
    forms.add(`${letters} ${digit}`);
    forms.add(`${letters} ${DIGIT_WORDS[Number(digit)]}`);
  }
  return [...forms];
}

function pushCandidate(
  list: Candidate[],
  seen: Map<string, number>,
  candidate: Candidate,
): void {
  if (candidate.words.length === 0) return;
  const key = candidate.words.join(" ");
  const existing = seen.get(key);
  if (existing !== undefined && list[existing]!.tier <= candidate.tier) return;
  if (existing !== undefined) {
    list[existing] = candidate;
    return;
  }
  seen.set(key, list.length);
  list.push(candidate);
}

/**
 * Every way the voice may name one target. The letter on the board is tier 1
 * and must match the raw token case-sensitively when it is three characters
 * or fewer: "f is the focal length" must not anchor the point F, "the focus
 * F" must. Descriptive names are tier 2 and case-blind.
 */
function candidatesForTarget(target: FocusScheduleTarget): Candidate[] {
  const list: Candidate[] = [];
  const seen = new Map<string, number>();
  const names = [target.id, ...target.labels]
    .map((name) => (name ?? "").trim())
    .filter(Boolean);

  for (const name of names) {
    if (isShortName(name)) {
      const caseSensitive = isAsciiShortName(name);
      pushCandidate(list, seen, {
        words: splitWords(name),
        tier: 1,
        anchor: "label",
        rawForms: caseSensitive ? rawCaseForms(name) : null,
      });
      const subscript = /^([A-Za-z])(\d)$/.exec(name);
      if (subscript) {
        const [, letter, digit] = subscript;
        pushCandidate(list, seen, {
          words: splitWords(`${letter} sub ${digit}`),
          tier: 1,
          anchor: "label",
          rawForms: [`${letter} sub ${digit}`, `${letter} sub ${DIGIT_WORDS[Number(digit)]}`],
        });
      }
      for (const form of LETTER_SPOKEN_FORMS[name] ?? []) {
        pushCandidate(list, seen, { words: splitWords(form), tier: 2, anchor: "role", rawForms: null });
      }
      continue;
    }
    // Role ids arrive with underscores ("focal_point"); the voice says the phrase.
    // Only the whole phrase counts: "focal" alone would anchor "focal length".
    pushCandidate(list, seen, {
      words: splitWords(name.replace(/_/g, " ")),
      tier: 2,
      anchor: "role",
      rawForms: null,
    });
  }

  return list;
}

function findOccurrences(parsed: SpokenNarration, candidate: Candidate): Occurrence[] {
  const { words, tokens } = parsed;
  const span = candidate.words.length;
  const found: Occurrence[] = [];

  for (let position = 0; position + span <= words.length; position++) {
    let matches = true;
    for (let offset = 0; offset < span; offset++) {
      if (words[position + offset]!.text !== candidate.words[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    const tokenStart = words[position]!.token;
    const tokenEnd = words[position + span - 1]!.token;
    if (candidate.rawForms) {
      // A short name must be the whole raw token, not "i" inside "I'm" or
      // the "m" of "I'm", and it must keep its case.
      if (position > 0 && words[position - 1]!.token === tokenStart) continue;
      if (position + span < words.length && words[position + span]!.token === tokenEnd) continue;
      const raw = tokens
        .slice(tokenStart, tokenEnd + 1)
        .map((token) => stripTokenEdges(token.raw))
        .join(" ");
      if (!candidate.rawForms.includes(raw)) continue;
    }

    found.push({
      wordStart: position,
      wordEnd: position + span,
      tokenStart,
      tokenEnd,
      tier: candidate.tier,
      anchor: candidate.anchor,
    });
  }

  return found;
}

interface Assignment {
  matched: number;
  tierCost: number;
  positionCost: number;
  picks: Array<Occurrence | null>;
}

function betterAssignment(a: Assignment, b: Assignment): boolean {
  if (a.matched !== b.matched) return a.matched > b.matched;
  if (a.tierCost !== b.tierCost) return a.tierCost < b.tierCost;
  return a.positionCost < b.positionCost;
}

/**
 * One occurrence per target, monotonic in the narration. Most matched targets
 * first, then the board letter over a descriptive name, then the earliest
 * mention. A plain greedy pass anchored "I" late and lost F and C in
 * "the image forms between F and C, so I is real"; this keeps all three.
 */
function assignOccurrences(perTarget: Occurrence[][]): Array<Occurrence | null> {
  const memo = new Map<string, Assignment>();

  const best = (index: number, cursor: number): Assignment => {
    if (index === perTarget.length) {
      return { matched: 0, tierCost: 0, positionCost: 0, picks: [] };
    }
    const key = `${index}:${cursor}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const skipped = best(index + 1, cursor);
    let result: Assignment = { ...skipped, picks: [null, ...skipped.picks] };
    for (const occurrence of perTarget[index]!) {
      if (occurrence.wordStart < cursor) continue;
      const rest = best(index + 1, occurrence.wordEnd);
      const attempt: Assignment = {
        matched: rest.matched + 1,
        tierCost: rest.tierCost + occurrence.tier,
        positionCost: rest.positionCost + occurrence.wordStart,
        picks: [occurrence, ...rest.picks],
      };
      if (betterAssignment(attempt, result)) result = attempt;
    }

    memo.set(key, result);
    return result;
  };

  return best(0, 0).picks;
}

function findLastPhrase(parsed: SpokenNarration, phrase: string[]): { tokenStart: number; tokenEnd: number } | null {
  const { words } = parsed;
  const span = phrase.length;
  if (span === 0) return null;
  for (let position = words.length - span; position >= 0; position--) {
    let matches = true;
    for (let offset = 0; offset < span; offset++) {
      if (words[position + offset]!.text !== phrase[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { tokenStart: words[position]!.token, tokenEnd: words[position + span - 1]!.token };
    }
  }
  return null;
}

function estimatedClock(parsed: SpokenNarration, msPerChar: number): SegmentClock {
  const rate = Number.isFinite(msPerChar) && msPerChar > 0 ? msPerChar : DEFAULT_FOCUS_MS_PER_CHAR;
  return {
    startAt: (offset) => Math.round(offset * rate),
    endAt: (exclusiveOffset) => Math.round(exclusiveOffset * rate),
    totalMs: Math.round(parsed.spoken.length * rate),
  };
}

function timedClock(parsed: SpokenNarration, timings: AudioTimings): SegmentClock {
  const totalMs = Math.round(timings.totalDuration * 1000);
  const length = Math.max(parsed.spoken.length, 1);
  const scaled = (offset: number) => Math.round((Math.min(Math.max(offset, 0), length) / length) * totalMs);
  return {
    startAt: (offset) => timingStartMs(timings, offset) ?? scaled(offset),
    endAt: (exclusiveOffset) =>
      exclusiveOffset >= parsed.spoken.length
        ? totalMs
        : (timingEndMs(timings, exclusiveOffset - 1) ?? scaled(exclusiveOffset)),
    totalMs,
  };
}

function windowFromTokens(
  parsed: SpokenNarration,
  clock: SegmentClock,
  tokenStart: number,
  clauseFromToken: number,
): { startMs: number; endMs: number } {
  const first = parsed.tokens[tokenStart]!;
  const clauseAnchor = parsed.tokens[clauseFromToken]!;
  const startMs = clock.startAt(first.start);
  const clauseEnd = clauseEndAfter(parsed, clauseAnchor.start);
  const endMs = Math.max(clock.endAt(clauseEnd), startMs + MIN_FOCUS_WINDOW_MS);
  return { startMs, endMs };
}

export function getFocusTargetSchedule(input: FocusScheduleInput): FocusTargetSchedule {
  const targets = input.targets ?? [];
  const parsed = parseSpokenNarration(input.narration ?? "");
  const timingsValid =
    parsed.spoken.length > 0 &&
    validateAudioTimingsForNarration(input.narration ?? "", input.timings ?? null).valid;
  const source: FocusTargetSchedule["source"] = timingsValid ? "tts" : "estimated";
  const clock = timingsValid
    ? timedClock(parsed, input.timings!)
    : estimatedClock(parsed, input.msPerChar ?? DEFAULT_FOCUS_MS_PER_CHAR);

  const perTarget = targets.map((target) =>
    candidatesForTarget(target)
      .flatMap((candidate) => findOccurrences(parsed, candidate))
      .sort((a, b) => a.wordStart - b.wordStart),
  );
  const picks = assignOccurrences(perTarget);

  const windows: Array<{ window: FocusTargetWindow; order: number; spec: number }> = [];
  const unmatched: number[] = [];
  picks.forEach((pick, spec) => {
    if (!pick) {
      unmatched.push(spec);
      return;
    }
    const { startMs, endMs } = windowFromTokens(parsed, clock, pick.tokenStart, pick.tokenStart);
    windows.push({
      window: { id: targets[spec]!.id, startMs, endMs, anchor: pick.anchor },
      order: pick.wordStart,
      spec,
    });
  });

  // No name spoken: the words right before the tag are the best guess of
  // what the tutor was pointing at.
  let clauseWindow: { startMs: number; endMs: number } | null = null;
  if (unmatched.length > 0) {
    const clause = lastMeaningfulClause(input.command?.narrationBefore ?? "").trim();
    const located = clause ? findLastPhrase(parsed, splitWords(clause)) : null;
    if (located) {
      clauseWindow = windowFromTokens(parsed, clock, located.tokenStart, located.tokenEnd);
    }
  }

  const proportional: number[] = [];
  for (const spec of unmatched) {
    if (clauseWindow) {
      windows.push({
        window: { id: targets[spec]!.id, ...clauseWindow, anchor: "clause" },
        order: Number.MAX_SAFE_INTEGER,
        spec,
      });
    } else {
      proportional.push(spec);
    }
  }

  // Nothing to go on: spread the targets across the second half, where a
  // step's naming usually happens (label spoken in the tag's window 72.8%).
  const half = clock.totalMs / 2;
  proportional.forEach((spec, index) => {
    const slot = half / proportional.length;
    const startMs = Math.round(half + slot * index);
    const endMs = Math.max(Math.round(half + slot * (index + 1)), startMs + MIN_FOCUS_WINDOW_MS);
    windows.push({
      window: { id: targets[spec]!.id, startMs, endMs, anchor: "proportional" },
      order: Number.MAX_SAFE_INTEGER,
      spec,
    });
  });

  windows.sort((a, b) =>
    a.window.startMs - b.window.startMs || a.order - b.order || a.spec - b.spec,
  );

  return {
    targets: windows.map((entry) => entry.window),
    matchedCount: picks.filter(Boolean).length,
    source,
  };
}
