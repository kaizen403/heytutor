/**
 * Scored routing from a question to one algorithm family.
 *
 * Modelled on the archetype detector: cues carry real weight, hints only
 * break ties, a veto zeroes a family outright, and a weak or contested
 * result declines. Declining is the useful behaviour — it sends the turn to a
 * structure-only figure instead of confidently drawing the wrong algorithm.
 *
 * The router also has to recognise a bare LeetCode problem statement. Those
 * carry no algorithm name at all — "Given an array nums and an integer
 * target, return indices of the two numbers such that they add up to target"
 * names no technique — so `looksLikeCodingProblem` matches the *shape* of a
 * problem statement rather than its vocabulary. That is what the old keyword
 * regex missed, and it is why most real LeetCode prompts never reached the
 * code lane at all.
 */
import { ALGORITHM_FAMILIES, type AlgorithmFamily, type FamilyRun } from "./algorithmCatalog";
import type { ExampleSource } from "./exampleSlots";

const CUE_POINTS = 4;
const HINT_POINTS = 1;
/** Below this nothing is confident enough to draw. */
const MIN_SCORE = 4;
/** A win this narrow is a coin flip between two families; decline instead. */
const MIN_MARGIN = 1;

export interface AlgorithmMatch {
  family: AlgorithmFamily;
  score: number;
  /** How far clear of the runner-up. */
  margin: number;
}

export interface DetectedAlgorithm extends AlgorithmMatch {
  trace: FamilyRun["trace"];
  exampleSource: ExampleSource;
}

export function rankAlgorithms(question: string): AlgorithmMatch[] {
  const scored: AlgorithmMatch[] = [];
  for (const family of ALGORITHM_FAMILIES) {
    if (family.vetoes?.some((pattern) => pattern.test(question))) continue;
    let score = 0;
    for (const cue of family.cues) {
      if (cue.test(question)) score += CUE_POINTS;
    }
    for (const hint of family.hints ?? []) {
      if (hint.test(question)) score += HINT_POINTS;
    }
    if (score > 0) scored.push({ family, score, margin: 0 });
  }
  scored.sort((a, b) => b.score - a.score || a.family.id.localeCompare(b.family.id));
  return scored.map((entry, index) => ({
    ...entry,
    margin: index === 0 ? entry.score - (scored[1]?.score ?? 0) : 0,
  }));
}

/**
 * Resolve a question to a family and its trace, or null. A family that wins
 * the scoring but whose simulator declines the example does not fall through
 * to second place: the winner naming the technique is the right answer, and
 * drawing a different algorithm's picture beside it would be worse than
 * drawing none.
 *
 * `exampleText` is a second place to look for the concrete example — the
 * committed program's own driver lines. A question that states no numbers used
 * to fall back to the family default, so the figure walked one example while
 * the code beside it ran another: the board traced target 26 while the panel
 * typed target 9. Same lesson, two different examples, in front of the
 * student. It is searched only for values, never for routing.
 */
export function detectAlgorithm(
  question: string,
  options: { exampleText?: string } = {},
): DetectedAlgorithm | null {
  const ranked = rankAlgorithms(question);
  const best = ranked[0];
  if (!best || best.score < MIN_SCORE || best.margin < MIN_MARGIN) return null;
  // Routing is decided by the question alone — extra text must never move a
  // question to a different family. It is only searched for the example the
  // simulator should run, and only when the question carries none of its own.
  const fromQuestion = best.family.run(question);
  if (fromQuestion?.exampleSource === "question") return { ...best, ...fromQuestion };
  const example = options.exampleText?.trim();
  if (example) {
    const grounded = best.family.run(`${question}\n${example}`);
    if (grounded?.exampleSource === "question") return { ...best, ...grounded };
  }
  // Neither the question nor the program stated an example the simulator
  // accepts, so the family's canonical one is used and says so.
  if (!fromQuestion) return null;
  return { ...best, ...fromQuestion };
}

/** Structural markers of a programming problem statement. */
const PROBLEM_SHAPE: readonly RegExp[] = [
  /\bgiven\s+(?:an?|the|two)\b/i,
  /\breturn\s+(?:the|an?|all|any|true|false|indices|index)\b/i,
  /\bexample\s*\d*\s*:/i,
  /\bconstraints?\s*:/i,
  /\binput\s*:.*\boutput\s*:/is,
  /\b(?:nums|arr|str|s1|s2|head|root|matrix|grid|target|node)\b/,
  /\bo\(\s*(?:n|1|log\s*n|n\s*log\s*n|n\^?2)\s*\)/i,
  /\btime\s+complexity\b/i,
  /\bin[- ]place\b/i,
  /\bleetcode\b/i,
];

/**
 * Does this read like a coding problem even though it names no algorithm?
 * Two independent structural markers is the bar — one alone ("given a
 * triangle...") is ordinary maths phrasing.
 */
export function looksLikeCodingProblem(question: string): boolean {
  let hits = 0;
  for (const pattern of PROBLEM_SHAPE) {
    if (pattern.test(question)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}
