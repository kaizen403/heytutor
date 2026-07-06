import type { DrawCommand, ParsedResponse } from "@heytutor/drawing";
import { mathToSpeech, type AudioTimings } from "./elevenLabsClient";

const CHARS_PER_SECOND = 15;
const MS_PER_CHAR = 1000 / CHARS_PER_SECOND;
const INTER_COMMAND_GAP_MS = 300;

export interface SegmentTiming {
  narrationText: string;
  startMs: number;
  estimatedDurationMs: number;
  command: DrawCommand | null;
  commandIndex: number;
}

export interface SyncPlan {
  segments: SegmentTiming[];
  totalEstimatedDurationMs: number;
}

export interface CommandSpeechWindow {
  startMs: number;
  durationMs: number;
  matched: boolean;
}

export interface AudioTimingValidation {
  valid: boolean;
  reason?: string;
  totalDurationMs: number;
  expectedMaxMs: number;
}

export function buildSyncPlan(parsed: ParsedResponse): SyncPlan {
  const segments: SegmentTiming[] = [];
  let elapsedMs = 0;

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    const narrationText = seg.text.trim();
    const estimatedDurationMs = Math.max(narrationText.length * MS_PER_CHAR, 500);
    const command = seg.commandIndex < parsed.commands.length ? parsed.commands[seg.commandIndex] : null;

    segments.push({
      narrationText,
      startMs: elapsedMs,
      estimatedDurationMs,
      command,
      commandIndex: seg.commandIndex,
    });

    elapsedMs += estimatedDurationMs;

    if (command && command.type !== "CLEAR" && command.type !== "PAUSE") {
      elapsedMs += INTER_COMMAND_GAP_MS;
    }

    if (command && command.type === "PAUSE") {
      elapsedMs += command.params[0] ?? 500;
    }
  }

  return {
    segments,
    totalEstimatedDurationMs: elapsedMs,
  };
}

export function buildSyncPlanFromTimings(
  parsed: ParsedResponse,
  timings: AudioTimings,
): SyncPlan {
  const segments: SegmentTiming[] = [];
  let charOffset = 0;
  let elapsedMs = 0;

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    const narrationText = seg.text.trim();
    const narrationCharCount = narrationText.length;
    const command = seg.commandIndex < parsed.commands.length ? parsed.commands[seg.commandIndex] : null;

    let segmentStartSec = 0;
    let segmentEndSec = 0;

    if (charOffset < timings.charStartTimes.length) {
      segmentStartSec = timings.charStartTimes[charOffset] ?? elapsedMs / 1000;
      const endIdx = Math.min(charOffset + narrationCharCount, timings.charStartTimes.length) - 1;
      segmentEndSec = (timings.charStartTimes[endIdx] ?? segmentStartSec) + (timings.charDurations[endIdx] ?? 0.06);
    } else {
      segmentStartSec = elapsedMs / 1000;
      segmentEndSec = segmentStartSec + Math.max(narrationCharCount * MS_PER_CHAR / 1000, 0.5);
    }

    const segmentDurationMs = Math.max((segmentEndSec - segmentStartSec) * 1000, 300);

    segments.push({
      narrationText,
      startMs: segmentStartSec * 1000,
      estimatedDurationMs: segmentDurationMs,
      command,
      commandIndex: seg.commandIndex,
    });

    elapsedMs = segmentStartSec * 1000 + segmentDurationMs;
    charOffset += narrationCharCount;

    if (command && command.type !== "CLEAR" && command.type !== "PAUSE") {
      elapsedMs += INTER_COMMAND_GAP_MS;
    }

    if (command && command.type === "PAUSE") {
      elapsedMs += command.params[0] ?? 500;
    }
  }

  return {
    segments,
    totalEstimatedDurationMs: elapsedMs,
  };
}

const DIGIT_WORDS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "10": "ten",
  "11": "eleven",
  "12": "twelve",
  "13": "thirteen",
  "14": "fourteen",
  "15": "fifteen",
  "16": "sixteen",
  "17": "seventeen",
  "18": "eighteen",
  "19": "nineteen",
  "20": "twenty",
  "30": "thirty",
  "40": "forty",
  "50": "fifty",
  "60": "sixty",
  "70": "seventy",
  "80": "eighty",
  "90": "ninety",
  "100": "one hundred",
  "200": "two hundred",
  "500": "five hundred",
  "1000": "one thousand",
};

const GREEK_SYMBOLS: Record<string, string> = {
  "θ": "theta",
  "μ": "mu",
  "ω": "omega",
  "π": "pi",
  "λ": "lambda",
  "Δ": "delta",
  "α": "alpha",
  "β": "beta",
  "γ": "gamma",
  "φ": "phi",
  "ψ": "psi",
  "ρ": "rho",
  "σ": "sigma",
  "τ": "tau",
  "ε": "epsilon",
  "η": "eta",
  "ν": "nu",
  "ξ": "xi",
  "κ": "kappa",
  "χ": "chi",
  "ζ": "zeta",
  "Θ": "capital theta",
  "Ω": "omega",
  "Σ": "sigma",
  "Φ": "phi",
  "Ψ": "psi",
  "Λ": "lambda",
};

function expandGreekSymbols(text: string): string {
  return text.replace(/[θμωπλΔαβγφψρστξηνκχζΘΩΣΦΨΛ]/g, (match) => GREEK_SYMBOLS[match] ?? match);
}

function expandDecimalNumber(numStr: string): string {
  const parts = numStr.split(".");
  const intPart = DIGIT_WORDS[parts[0]!] ?? parts[0]!;
  if (parts.length === 1) {
    return intPart;
  }
  const decimalPart = parts[1]!
    .split("")
    .map((digit) => DIGIT_WORDS[digit] ?? digit)
    .join(" ");
  return `${intPart} point ${decimalPart}`;
}

function expandPowersOfTen(text: string): string {
  return text.replace(/(\d+)\s*\^\s*(\d+)/g, (_match, base, exp) => {
    const baseWord = DIGIT_WORDS[base!] ?? base;
    const expNum = Number(exp);
    if (expNum === 2) return `${baseWord} squared`;
    if (expNum === 3) return `${baseWord} cubed`;
    return `${baseWord} to the power ${exp}`;
  });
}

function expandSmallIntegers(text: string): string {
  const withPowers = expandPowersOfTen(text);
  return withPowers.replace(/\b\d+(?:\.\d+)?\b/g, (match) => {
    if (DIGIT_WORDS[match]) {
      return DIGIT_WORDS[match];
    }
    if (match.includes(".")) {
      return expandDecimalNumber(match);
    }
    return match;
  });
}

function normalizeForSpeechMatch(text: string): string {
  return expandSmallIntegers(
    expandGreekSymbols(
      mathToSpeech(text)
        .replace(/([0-9])([a-z])/gi, "$1 $2")
        .replace(/([a-z])([0-9])/gi, "$1 $2")
        .replace(/\bis\s+equal\s+to\b/gi, " equals ")
        .replace(/\bequal\s+to\b/gi, " equals ")
        .replace(/=/g, " equals ")
        .replace(/\+/g, " plus ")
        .replace(/-/g, " minus ")
        .replace(/\*/g, " times ")
        .replace(/\//g, " divided by ")
        .replace(/\bint\b/gi, " integral ")
        .replace(/\bpi\b/gi, " pi "),
    ),
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSegmentTimings(narration: string, timings: AudioTimings): AudioTimings {
  const spokenNarration = mathToSpeech(narration.trim());
  const limit = Math.min(spokenNarration.length, timings.charStartTimes.length);
  if (limit <= 0) {
    return timings;
  }

  const charStartTimes = timings.charStartTimes.slice(0, limit);
  const charDurations = timings.charDurations.slice(0, limit);
  const lastIndex = limit - 1;
  const totalDuration =
    (charStartTimes[lastIndex] ?? 0) + (charDurations[lastIndex] ?? 0.06);

  return {
    charStartTimes,
    charDurations,
    totalDuration,
  };
}

export function validateAudioTimingsForNarration(
  narration: string,
  timings?: AudioTimings | null,
): AudioTimingValidation {
  const spokenNarration = mathToSpeech(narration.trim());
  if (!timings || timings.charStartTimes.length === 0 || timings.totalDuration <= 0) {
    return {
      valid: false,
      reason: "missing-timings",
      totalDurationMs: 0,
      expectedMaxMs: Math.max(spokenNarration.length * 220, 2500),
    };
  }

  const normalized = normalizeSegmentTimings(narration, timings);
  const lastIndex = normalized.charStartTimes.length - 1;
  const measuredEndMs = Math.round(
    ((normalized.charStartTimes[lastIndex] ?? 0) +
      (normalized.charDurations[lastIndex] ?? 0.06)) *
      1000,
  );
  const expectedMaxMs = Math.max(spokenNarration.length * 220, 2500);

  if (measuredEndMs > expectedMaxMs * 1.35) {
    return {
      valid: false,
      reason: "duration-too-large",
      totalDurationMs: measuredEndMs,
      expectedMaxMs,
    };
  }

  for (let i = 1; i < normalized.charStartTimes.length; i++) {
    const previous = normalized.charStartTimes[i - 1] ?? 0;
    const current = normalized.charStartTimes[i] ?? 0;
    if (current + 0.05 < previous) {
      return {
        valid: false,
        reason: "non-monotonic",
        totalDurationMs: measuredEndMs,
        expectedMaxMs,
      };
    }
  }

  const lastStartMs = Math.round((normalized.charStartTimes[lastIndex] ?? 0) * 1000);
  if (lastStartMs > expectedMaxMs * 1.2) {
    return {
      valid: false,
      reason: "offset-too-large",
      totalDurationMs: measuredEndMs,
      expectedMaxMs,
    };
  }

  return {
    valid: true,
    totalDurationMs: measuredEndMs,
    expectedMaxMs,
  };
}

function timingIndexForNormalizedOffset(
  normalizedOffset: number,
  normalizedLength: number,
  spokenLength: number,
): number {
  if (spokenLength <= 1 || normalizedLength <= 0) {
    return 0;
  }

  const ratio = Math.min(Math.max(normalizedOffset / normalizedLength, 0), 1);
  return Math.min(Math.round(ratio * (spokenLength - 1)), spokenLength - 1);
}

function hasTimingAt(timings: AudioTimings, index: number): boolean {
  return Number.isFinite(timings.charStartTimes[index]);
}

function timingStartMs(timings: AudioTimings, index: number): number | null {
  if (!hasTimingAt(timings, index)) {
    return null;
  }
  return Math.max(Math.round((timings.charStartTimes[index] ?? 0) * 1000), 0);
}

function timingEndMs(timings: AudioTimings, index: number): number | null {
  if (!hasTimingAt(timings, index)) {
    return null;
  }
  const sec =
    (timings.charStartTimes[index] ?? timings.totalDuration) +
    (timings.charDurations[index] ?? 0.06);
  return Math.max(Math.round(sec * 1000), 0);
}

type SpeechCandidateKind = "text" | "anchor";

interface SpeechCandidate {
  text: string;
  kind: SpeechCandidateKind;
}

function nthIndexOf(str: string, substr: string, n: number): number {
  let idx = str.indexOf(substr);
  for (let i = 0; i < n && idx >= 0; i++) {
    idx = str.indexOf(substr, idx + 1);
  }
  return idx;
}

function uniqueCandidates(candidates: Array<{ text?: string; kind: SpeechCandidateKind }>): SpeechCandidate[] {
  const seen = new Set<string>();
  const result: SpeechCandidate[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeForSpeechMatch(candidate.text ?? "");
    if (normalized.length < 2 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push({ text: normalized, kind: candidate.kind });
  }

  return result;
}

function lastMeaningfulClause(text: string): string {
  const clauses = text
    .split(/(?<=[.!?,;:])\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.at(-1) ?? text;
}

function expandCompactFormulaTokens(text: string): string {
  if (!/[=+\-*/^]|\bint\b/i.test(text)) {
    return text;
  }

  return text.replace(/\b[a-z]{2,3}\b/gi, (token) => {
    const lower = token.toLowerCase();
    if (['int', 'sin', 'cos', 'tan', 'log', 'sqrt', 'pi'].includes(lower)) {
      return token;
    }
    return token.split('').join(' ');
  });
}

function fallbackSpeechWindow(narration: string, command: DrawCommand): CommandSpeechWindow {
  const estimatedTotalMs = Math.max(narration.length * MS_PER_CHAR, 500);
  const naturalDrawMs = getCommandDrawDurationMs(command);
  const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
  const startMs = isTextCommand ? Math.round(estimatedTotalMs * 0.45) : 0;
  const durationMs = isTextCommand
    ? Math.max(naturalDrawMs, Math.round(estimatedTotalMs * 0.35))
    : Math.min(naturalDrawMs, estimatedTotalMs);

  return {
    startMs,
    durationMs,
    matched: false,
  };
}

export function getCommandSpeechWindow(
  narration: string,
  command: DrawCommand,
  timings?: AudioTimings | null,
  textCommandIndex = 0,
): CommandSpeechWindow {
  if (!timings || timings.charStartTimes.length === 0 || timings.totalDuration <= 0) {
    return fallbackSpeechWindow(narration, command);
  }

  const spokenNarration = mathToSpeech(narration.trim());
  const normalizedNarration = normalizeForSpeechMatch(spokenNarration);
  const totalMs = Math.round(timings.totalDuration * 1000);

  if (normalizedNarration.length === 0) {
    return fallbackSpeechWindow(narration, command);
  }

  const candidates = uniqueCandidates([
    { text: command.text, kind: "text" },
    { text: command.text ? expandCompactFormulaTokens(command.text) : undefined, kind: "text" },
    { text: command.text ? mathToSpeech(command.text) : undefined, kind: "text" },
    {
      text: command.text ? mathToSpeech(expandCompactFormulaTokens(command.text)) : undefined,
      kind: "text",
    },
    { text: lastMeaningfulClause(command.narrationBefore), kind: "anchor" },
    { text: command.narrationBefore, kind: "anchor" },
  ]);

  for (const candidate of candidates) {
    const matchIndex = nthIndexOf(normalizedNarration, candidate.text, textCommandIndex);
    if (matchIndex < 0) {
      continue;
    }

    const startTimingIndex = timingIndexForNormalizedOffset(
      matchIndex,
      normalizedNarration.length,
      spokenNarration.length,
    );
    const endTimingIndex = timingIndexForNormalizedOffset(
      matchIndex + candidate.text.length,
      normalizedNarration.length,
      spokenNarration.length,
    );

    const startMs = timingStartMs(timings, startTimingIndex);
    const endMs = timingEndMs(timings, endTimingIndex);
    if (startMs === null || endMs === null) {
      continue;
    }

    const phraseDurationMs = Math.max(endMs - startMs, 250);
    const naturalDrawMs = getCommandDrawDurationMs(command);
    const durationMs =
      command.type === "WRITE" || command.type === "LABEL"
        ? candidate.kind === "text"
          ? Math.max(phraseDurationMs, naturalDrawMs)
          : naturalDrawMs
        : Math.min(Math.max(phraseDurationMs, naturalDrawMs), Math.max(totalMs - startMs, 250));

    return {
      startMs,
      durationMs,
      matched: true,
    };
  }

  return fallbackSpeechWindow(narration, command);
}

export interface WriteCharSchedule {
  /** Start time (ms from audio start) for each non-space character of command.text, in order. */
  offsetsMs: number[];
  /** Spoken duration budget (ms) for each character — drives elastic pen speed. */
  charDurationsMs: number[];
  matched: boolean;
  source: "tts" | "estimated";
  validTiming: boolean;
  reason?: string;
}

/**
 * Rejects TTS-derived schedules that pass validation but map board text to the
 * wrong part of the narration (e.g. first char at 10s in an 11s segment).
 */
export function isWriteScheduleUsable(
  schedule: WriteCharSchedule,
  narration: string,
  segmentDurationMs?: number,
): boolean {
  if (!schedule.matched || schedule.offsetsMs.length === 0) {
    return false;
  }

  const spoken = mathToSpeech(narration.trim());
  const durationMs = Math.max(
    segmentDurationMs && segmentDurationMs > 0
      ? segmentDurationMs
      : spoken.length * MS_PER_CHAR,
    700,
  );

  const firstOffsetMs = schedule.offsetsMs[0] ?? 0;
  const lastOffsetMs = schedule.offsetsMs[schedule.offsetsMs.length - 1] ?? firstOffsetMs;
  const maxFirstOffsetMs = Math.max(Math.round(durationMs * 0.60), 1500);

  if (firstOffsetMs > maxFirstOffsetMs) {
    return false;
  }

  if (lastOffsetMs > durationMs * 1.12) {
    return false;
  }

  return true;
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Builds a per-character writing schedule so each token of a WRITE/LABEL command
 * is drawn exactly when the narrator speaks it. Returns one start offset (ms from
 * audio start) per non-space character of `command.text`, in document order — which
 * matches the order `textToStrokePaths` emits characters (it skips spaces).
 *
 * Each board token (whitespace-separated) is matched against the spoken narration so
 * "5x" is written while "five x" is said, "+" while "plus" is said, and so on. Tokens
 * that cannot be located are interpolated between their matched neighbours so the pen
 * never dumps the whole expression at once.
 */
export function getWriteCharScheduleMs(
  narration: string,
  command: DrawCommand,
  timings?: AudioTimings | null,
  textCommandIndex = 0,
): WriteCharSchedule | null {
  const text = command.text ?? "";
  const nonSpaceCount = text.replace(/\s/g, "").length;
  if (nonSpaceCount === 0) {
    return null;
  }

  if (!timings || timings.charStartTimes.length === 0 || timings.totalDuration <= 0) {
    return null;
  }

  const normalizedTimings = normalizeSegmentTimings(narration, timings);
  const timingValidation = validateAudioTimingsForNarration(narration, normalizedTimings);
  if (!timingValidation.valid) {
    return null;
  }

  const spokenNarration = mathToSpeech(narration.trim());
  const normalizedNarration = normalizeForSpeechMatch(spokenNarration);
  if (normalizedNarration.length === 0) {
    return null;
  }

  const totalMs = timingValidation.totalDurationMs;

  const startMsForOffset = (offset: number): number | null => {
    const idx = timingIndexForNormalizedOffset(offset, normalizedNarration.length, spokenNarration.length);
    return timingStartMs(normalizedTimings, idx);
  };
  const endMsForOffset = (offset: number): number | null => {
    const idx = timingIndexForNormalizedOffset(offset, normalizedNarration.length, spokenNarration.length);
    return timingEndMs(normalizedTimings, idx);
  };

  const tokens = text.split(/\s+/).filter((token) => token.length > 0);

  let cursor = 0;
  if (textCommandIndex > 0 && tokens.length > 0) {
    const firstTokenPhrases = uniqueNormalized([
      normalizeForSpeechMatch(tokens[0]),
      normalizeForSpeechMatch(expandCompactFormulaTokens(tokens[0])),
    ]);
    for (const phrase of firstTokenPhrases) {
      const idx = nthIndexOf(normalizedNarration, phrase, textCommandIndex);
      if (idx >= 0) {
        cursor = idx;
        break;
      }
    }
  }
  let matchedCount = 0;
  const windows: Array<{ startMs: number | null; endMs: number | null; count: number }> = [];

  for (const token of tokens) {
    const count = token.replace(/\s/g, "").length;
    const phrases = uniqueNormalized([
      normalizeForSpeechMatch(token),
      normalizeForSpeechMatch(expandCompactFormulaTokens(token)),
    ]);

    let foundIdx = -1;
    let foundLen = 0;
    for (const phrase of phrases) {
      const idx = normalizedNarration.indexOf(phrase, cursor);
      if (idx >= 0) {
        foundIdx = idx;
        foundLen = phrase.length;
        break;
      }
    }

    if (foundIdx >= 0) {
      const startMs = startMsForOffset(foundIdx);
      const endMs = endMsForOffset(foundIdx + foundLen);
      if (startMs === null || endMs === null) {
        return null;
      }
      matchedCount++;
      windows.push({
        startMs,
        endMs,
        count,
      });
      cursor = foundIdx + foundLen;
    } else {
      windows.push({ startMs: null, endMs: null, count });
    }
  }

  if (matchedCount === 0) {
    return null;
  }

  {
    let prevEnd = 0;
    let i = 0;
    while (i < windows.length) {
      if (windows[i].startMs !== null) {
        prevEnd = windows[i].endMs ?? windows[i].startMs ?? prevEnd;
        i++;
        continue;
      }

      let j = i;
      while (j < windows.length && windows[j].startMs === null) {
        j++;
      }

      const nextStart = j < windows.length ? (windows[j].startMs as number) : totalMs;
      const gapCount = j - i;
      const span = Math.max(nextStart - prevEnd, gapCount * 140);
      for (let k = 0; k < gapCount; k++) {
        windows[i + k].startMs = Math.round(prevEnd + (span * k) / gapCount);
        windows[i + k].endMs = Math.round(prevEnd + (span * (k + 1)) / gapCount);
      }
      prevEnd = windows[j - 1].endMs as number;
      i = j;
    }
  }

  const offsetsMs: number[] = [];
  const charDurationsMs: number[] = [];
  let last = 0;
  for (const window of windows) {
    const start = Math.max(window.startMs ?? 0, 0);
    const end = Math.max(window.endMs ?? start, start);
    const count = Math.max(window.count, 1);
    for (let c = 0; c < window.count; c++) {
      let offset = Math.round(start + ((end - start) * c) / count);
      if (offset < last) {
        offset = last;
      }
      const nextOffset =
        c + 1 < window.count
          ? Math.round(start + ((end - start) * (c + 1)) / count)
          : end;
      offsetsMs.push(offset);
      charDurationsMs.push(Math.max(nextOffset - offset, 24));
      last = offset;
    }
  }

  return {
    offsetsMs,
    charDurationsMs,
    matched: true,
    source: "tts",
    validTiming: true,
  };
}

export function getEstimatedWriteCharScheduleMs(
  narration: string,
  command: DrawCommand,
  textCommandIndex = 0,
): WriteCharSchedule | null {
  const spokenNarration = mathToSpeech(narration.trim());
  if (spokenNarration.length === 0) {
    return null;
  }

  const n = spokenNarration.length;
  const charStartTimes: number[] = [];
  const charDurations: number[] = [];
  let cumulativeMs = 0;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const velocityFactor = 1 + 0.3 * Math.sin(Math.PI * t);
    const durationMs = MS_PER_CHAR / velocityFactor;
    charStartTimes.push(cumulativeMs / 1000);
    charDurations.push(durationMs / 1000);
    cumulativeMs += durationMs;
  }

  const schedule = getWriteCharScheduleMs(narration, command, {
    charStartTimes,
    charDurations,
    totalDuration: cumulativeMs / 1000,
  }, textCommandIndex);

  if (!schedule?.matched) {
    return null;
  }

  return {
    ...schedule,
    source: "estimated",
    validTiming: false,
    reason: "estimated-from-script",
  };
}

export interface DrawingDurations {
  DRAW_CUBOID: number;
  DRAW_CUBE: number;
  DRAW_RECT: number;
  DRAW_CIRCLE: number;
  DRAW_LINE: number;
  WRITE: number;
  LABEL: number;
  UNDERLINE: number;
  CIRCLE_AROUND: number;
  ARROW: number;
  HIGHLIGHT: number;
  SCRIBBLE: number;
  DIMENSION: number;
  CLEAR: number;
  PAUSE: number;
  ERASE: number;
}

const WRITE_MS_PER_CHAR = 38;
const MIN_WRITE_MS = 420;
const MAX_WRITE_MS = 3200;

const DEFAULT_DRAWING_DURATIONS: DrawingDurations = {
  DRAW_CUBOID: 1800,
  DRAW_CUBE: 1400,
  DRAW_RECT: 1200,
  DRAW_CIRCLE: 1200,
  DRAW_LINE: 600,
  WRITE: 0,
  LABEL: 0,
  UNDERLINE: 350,
  CIRCLE_AROUND: 700,
  ARROW: 500,
  HIGHLIGHT: 250,
  SCRIBBLE: 400,
  DIMENSION: 900,
  CLEAR: 200,
  PAUSE: 500,
  ERASE: 1500,
};

export function getDrawingDuration(command: DrawCommand): number {
  switch (command.type) {
    case "WRITE":
    case "LABEL":
    case "DIMENSION": {
      const charCount = command.text?.length ?? 1;
      return Math.min(
        Math.max(charCount * WRITE_MS_PER_CHAR, MIN_WRITE_MS),
        MAX_WRITE_MS,
      );
    }
    case "PAUSE":
      return command.params[0] ?? 500;
    case "ERASE": {
      const [, , eraseWidth, eraseHeight] = command.params;
      const area = Math.abs((eraseWidth ?? 0) * (eraseHeight ?? 0));
      return Math.max(Math.min(Math.round(area / 50), 3000), 800);
    }
    default:
      return DEFAULT_DRAWING_DURATIONS[command.type] ?? 1500;
  }
}

export function getFlightDuration(command: DrawCommand): number {
  if (command.type === "CLEAR") return 0;
  if (command.type === "PAUSE") return 0;
  if (command.type === "WRITE" || command.type === "LABEL") return 50;
  if (command.type === "DIMENSION") return 120;
  if (command.type === "ERASE") return 500;
  if (
    command.type === "UNDERLINE" ||
    command.type === "CIRCLE_AROUND" ||
    command.type === "ARROW" ||
    command.type === "HIGHLIGHT" ||
    command.type === "SCRIBBLE"
  ) {
    return 200;
  }
  return 300;
}

export function getCommandDrawDurationMs(command: DrawCommand | null): number {
  if (!command) {
    return 0;
  }

  if (command.type === "PAUSE") {
    return command.params[0] ?? 500;
  }

  if (command.type === "CLEAR") {
    return getDrawingDuration(command);
  }

  return getFlightDuration(command) + getDrawingDuration(command);
}

export function getSegmentDuration(
  command: DrawCommand | null,
  audioTimings?: AudioTimings | null,
): number {
  const audioMs = audioTimings?.totalDuration
    ? Math.round(audioTimings.totalDuration * 1000)
    : 0;
  const drawMs = getCommandDrawDurationMs(command);

  return Math.max(audioMs, drawMs, 300);
}
