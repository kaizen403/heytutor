import type { CanvasLandingSuggestion } from "@/features/tutor-session/components/CanvasLanding";
import { LANDING_SUGGESTIONS } from "@/features/tutor-session/constants";
import { AVAILABLE_SUBJECTS, type SubjectId } from "./types";

const SUBJECT_SUGGESTIONS: Record<SubjectId, CanvasLandingSuggestion[]> = {
  physics: LANDING_SUGGESTIONS,
  maths: [
    {
      topic: "Quadratics",
      kind: "lecture",
      question:
        "Derive the quadratic formula from ax² + bx + c = 0 by completing the square.",
    },
    {
      topic: "Differentiation",
      kind: "lecture",
      question:
        "Explain what dy/dx means geometrically, then show how to differentiate y = x³ − 4x.",
    },
    {
      topic: "Trigonometry",
      kind: "problem",
      question:
        "In a right triangle, opposite = 5 and hypotenuse = 13. Find sin θ and the other acute angle.",
    },
    {
      topic: "Sequences",
      kind: "problem",
      question:
        "An AP has first term 3 and common difference 5. Find the 12th term and the sum of the first 12.",
    },
  ],
  dsa: [
    {
      topic: "Two pointers",
      kind: "lecture",
      question:
        "Explain the two-pointer approach, then walk Two Sum II on sorted [2, 7, 11, 15] with target 9.",
    },
    {
      topic: "Binary search",
      kind: "lecture",
      question: "Show how binary search updates mid while searching for 7 in [1, 3, 5, 7, 9].",
    },
    {
      topic: "Stacks",
      kind: "problem",
      question: "Valid Parentheses for \"()[]{}\". Trace the stack.",
    },
    {
      topic: "Sliding window",
      kind: "problem",
      question: "Longest substring without repeating characters in \"abcabcbb\".",
    },
  ],
  chemistry: [
    {
      topic: "Molecular shape",
      kind: "lecture",
      question:
        "Explain VSEPR theory and show how it predicts the shape of SF4 and XeF4.",
    },
    {
      topic: "Electrochemistry",
      kind: "lecture",
      question:
        "Derive the Nernst equation and show what Ecell does when the reaction quotient Q increases.",
    },
    {
      topic: "Kinetics",
      kind: "problem",
      question:
        "A first order reaction is 50% complete in 120 minutes. How long does 90% decomposition take?",
    },
    {
      topic: "Coordination",
      kind: "problem",
      question:
        "Find the spin only magnetic moment of [Fe(CN)6]3- and [CoF6]3- and say which is high spin.",
    },
    {
      topic: "Organic",
      kind: "problem",
      question:
        "Draw 3-methylbut-1-ene and give the major product when it reacts with HBr.",
    },
  ],
};

/** Topic lectures start as Derive / Explain / Show how, not as a numbered exam item. */
export function isLectureHomePrompt(question: string): boolean {
  return /^(?:derive|explain|show how)\b/i.test(question.trim());
}

/**
 * Interleave lectures and problems, lectures first, so the empty board is not
 * a problem set even if a subject's list is stored problems-first.
 */
export function mixHomeSuggestions(
  candidates: readonly CanvasLandingSuggestion[],
  limit = 5,
): CanvasLandingSuggestion[] {
  const lectures: CanvasLandingSuggestion[] = [];
  const problems: CanvasLandingSuggestion[] = [];
  const seen = new Set<string>();
  for (const suggestion of candidates) {
    if (seen.has(suggestion.question)) continue;
    seen.add(suggestion.question);
    if (suggestion.kind === "lecture") lectures.push(suggestion);
    else problems.push(suggestion);
  }
  const picked: CanvasLandingSuggestion[] = [];
  let lectureIndex = 0;
  let problemIndex = 0;
  while (
    picked.length < limit &&
    (lectureIndex < lectures.length || problemIndex < problems.length)
  ) {
    const wantLecture = picked.length % 2 === 0;
    const next = wantLecture
      ? (lectures[lectureIndex++] ?? problems[problemIndex++])
      : (problems[problemIndex++] ?? lectures[lectureIndex++]);
    if (next) picked.push(next);
  }
  return picked;
}

export function suggestionsForSubjects(subjects: SubjectId[]): CanvasLandingSuggestion[] {
  const candidates: CanvasLandingSuggestion[] = [];
  const seen = new Set<string>();
  const order: SubjectId[] = subjects.length > 0 ? subjects : ["physics"];
  for (const subject of order) {
    if (!AVAILABLE_SUBJECTS.includes(subject)) continue;
    for (const suggestion of SUBJECT_SUGGESTIONS[subject] ?? []) {
      if (seen.has(suggestion.question)) continue;
      seen.add(suggestion.question);
      candidates.push(suggestion);
    }
  }
  if (candidates.length === 0) {
    return mixHomeSuggestions(LANDING_SUGGESTIONS);
  }
  return mixHomeSuggestions(candidates);
}
