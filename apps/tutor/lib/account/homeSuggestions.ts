import type { CanvasLandingSuggestion } from "@/features/tutor-session/components/CanvasLanding";
import { LANDING_SUGGESTIONS } from "@/features/tutor-session/constants";
import type { SubjectId } from "./types";

const SUBJECT_SUGGESTIONS: Record<SubjectId, CanvasLandingSuggestion[]> = {
  physics: LANDING_SUGGESTIONS,
  maths: [
    {
      topic: "Quadratics",
      question: "Solve x² − 5x + 6 = 0 and sketch how the roots sit on the graph.",
    },
    {
      topic: "Differentiation",
      question: "Find dy/dx if y = x³ − 4x, then say what the derivative means at x = 2.",
    },
    {
      topic: "Trigonometry",
      question: "In a right triangle, opposite = 5 and hypotenuse = 13. Find sin θ and the other acute angle.",
    },
    {
      topic: "Sequences",
      question: "An AP has first term 3 and common difference 5. Find the 12th term and the sum of the first 12.",
    },
  ],
  dsa: [
    {
      topic: "Two pointers",
      question: "Two Sum II: sorted array [2, 7, 11, 15], target 9. Walk the two-pointer solution.",
    },
    {
      topic: "Binary search",
      question: "Search for 7 in [1, 3, 5, 7, 9]. Show the mid updates.",
    },
    {
      topic: "Stacks",
      question: "Valid Parentheses for \"()[]{}\". Trace the stack.",
    },
    {
      topic: "Sliding window",
      question: "Longest substring without repeating characters in \"abcabcbb\".",
    },
  ],
  chemistry: [
    {
      topic: "Molecular shape",
      question: "Predict the hybridisation and shape of SF4 and XeF4. Which one is square planar?",
    },
    {
      topic: "Electrochemistry",
      question: "For the Daniell cell Zn|Zn2+(1 M)||Cu2+(1 M)|Cu, find E°cell and ΔG° given E°(Zn2+/Zn) = -0.76 V and E°(Cu2+/Cu) = 0.34 V.",
    },
    {
      topic: "Kinetics",
      question: "A first order reaction is 50% complete in 120 minutes. How long does 90% decomposition take?",
    },
    {
      topic: "Coordination",
      question: "Find the spin only magnetic moment of [Fe(CN)6]3- and [CoF6]3- and say which is high spin.",
    },
    {
      topic: "Organic",
      question: "Draw 3-methylbut-1-ene and give the major product when it reacts with HBr.",
    },
  ],
};

export function suggestionsForSubjects(subjects: SubjectId[]): CanvasLandingSuggestion[] {
  const picked: CanvasLandingSuggestion[] = [];
  const seen = new Set<string>();
  const order: SubjectId[] = subjects.length > 0 ? subjects : ["physics"];
  for (const subject of order) {
    for (const suggestion of SUBJECT_SUGGESTIONS[subject] ?? []) {
      if (seen.has(suggestion.question)) continue;
      seen.add(suggestion.question);
      picked.push(suggestion);
      if (picked.length >= 5) return picked;
    }
  }
  for (const suggestion of LANDING_SUGGESTIONS) {
    if (picked.length >= 5) break;
    if (seen.has(suggestion.question)) continue;
    picked.push(suggestion);
  }
  return picked.slice(0, 5);
}
