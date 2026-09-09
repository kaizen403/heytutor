/**
 * How long this particular lesson should be.
 *
 * The teaching prompt used to carry one fixed step count for every question,
 * so a one-line substitution and a three-part integration problem both got the
 * same six-to-ten steps and both stopped at the bottom of the first board page.
 * Length is a property of the question, not of the app: this classifier reads
 * the question and hands the teaching model a step budget for it.
 *
 * Deterministic and ~0ms, like `classifyReasoningEffort`, so it is safe on
 * every turn.
 * The student's familiarity with the subject is a shift on top of the
 * classified band, not a replacement for it, so a proof stays long even when
 * the student is only revising.
 */
import { isConceptLessonQuestion } from "./reasoningEffort";
import { BOARD_ROWS_PER_PAGE, type SubjectFamiliarity } from "./systemPrompt";

export type LessonScope = "compact" | "standard" | "extended" | "deep";

export const LESSON_SCOPE_ORDER: readonly LessonScope[] = [
  "compact",
  "standard",
  "extended",
  "deep",
];

export interface LessonBudget {
  scope: LessonScope;
  minSteps: number;
  maxSteps: number;
  /**
   * Board pages the lesson is expected to fill. Nine work rows fit on a page;
   * the runtime saves the full page to the student's notes and clears the work
   * column on its own, so more than one page is normal, not an overflow.
   */
  boardPages: number;
}

const SCOPE_STEPS: Record<LessonScope, { minSteps: number; maxSteps: number }> = {
  compact: { minSteps: 8, maxSteps: 12 },
  standard: { minSteps: 12, maxSteps: 18 },
  extended: { minSteps: 18, maxSteps: 24 },
  deep: { minSteps: 24, maxSteps: 32 },
};

/**
 * Pages the lesson is expected to fill, derived rather than stored: nearly
 * every step writes a row, so the page count follows the row capacity. It was
 * hardcoded once and silently went stale the moment the handwriting grew from
 * 32px to 40px and a page stopped holding nine rows.
 */
function boardPagesFor(maxSteps: number): number {
  return Math.max(1, Math.ceil(maxSteps / BOARD_ROWS_PER_PAGE));
}


/**
 * Machinery that cannot honestly be taught in one screen of work: each of
 * these carries a setup, a method choice, and a check the student needs to see
 * written out. Physics keywords live in `reasoningEffort`; these are the maths
 * ones, which that unit-driven classifier never sees.
 */
const DEEP_METHOD_KEYWORDS =
  /\b(?:integra(?:l|te|ted|tes|tion|ting)\w*|antiderivative|by\s+parts|partial\s+fractions?|substitution\s+rule|u-?substitution|differential\s+equation|separable|first\s+order|second\s+order|implicit\s+differentiation|related\s+rates?|l'?h(?:o|ô)pital|taylor|maclaurin|mathematical\s+induction|by\s+induction|eigen\w+|matrix\s+inverse|inverse\s+of\s+(?:the\s+)?matrix|determinant|cramer|gauss\w*\s+elimination|row\s+reduc\w+|binomial\s+(?:theorem|expansion)|conditional\s+probability|bayes|probability\s+distribution|permutations?\s+and\s+combinations?|locus|conic|hyperbola|ellipse|parabola|complex\s+(?:number|plane)|argand|de\s+moivre|volume\s+of\s+revolution|solid\s+of\s+revolution|area\s+(?:under|between|bounded))\b/i;

/**
 * Multi-stage but self-contained: a setup, a method, and an interpretation.
 * More than a substitution, less than a full derivation with a check.
 */
const MULTI_STAGE_KEYWORDS =
  /\b(?:derivative|differentiate|limit\s+of|maxima|minima|maximum\s+and\s+minimum|stationary\s+points?|turning\s+points?|optimi[sz]\w+|quadratic|discriminant|factori[sz]\w+|roots?\s+of|simultaneous\s+equations?|system\s+of\s+equations?|arithmetic\s+progression|geometric\s+progression|\bAP\b|\bGP\b|sum\s+to\s+n|nth\s+term|matrices|matrix|vectors?|dot\s+product|cross\s+product|scalar\s+product|trigonometric\s+identit\w+|prove\s+the\s+identity|logarithm\w*|surds?|inequalit\w+|probabilit\w+|mean\s+and\s+(?:median|variance)|standard\s+deviation|regression|sets?\s+and\s+relations?|functions?\s+and\s+relations?|domain\s+and\s+range|inverse\s+function|composite\s+function|graph\s+of)\b/i;

/** A question that must be argued, not evaluated. Always the longest band. */
const PROOF_LEAD =
  /\b(?:prove|proof|show\s+that|derive|derivation|justify|verify\s+that|hence\s+show|establish\s+that|deduce)\b/i;

/** Verbs that mean "do a piece of mathematics", beyond the physics ask list. */
const MATH_ASK_VERBS =
  /\b(?:solve|simplify|expand|factori[sz]e|integrate|differentiate|sketch|plot|prove|show\s+that|hence|express|convert|rationali[sz]e|verify)\b/gi;

/** Explicit sub-parts: "(a) ... (b)", "part (ii)", "i) ... ii)". */
const SUB_PART_MARKERS = /\((?:[a-e]|i{1,3}|iv|v)\)/gi;

function countMatches(question: string, pattern: RegExp): number {
  const matches = question.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Equations in the stem. Two or more is a system: it has to be solved by
 * elimination or substitution and then checked, which no keyword announces:
 * "Solve 2x + 3y = 12 and 3x - y = 5" never says "simultaneous".
 */
function countEquations(question: string): number {
  return countMatches(question, /[^<>=!]=[^=]/g);
}

/**
 * A power of two or more anywhere in the stem: a quadratic, a cubic, or a
 * curve. Solving one is a factorise-or-formula choice plus a root check, and
 * the stem rarely uses the word "quadratic".
 */
function hasPolynomialPower(question: string): boolean {
  return /\^\s*[2-9]|[²³⁴]/.test(question);
}

/**
 * A single arithmetic evaluation with no idea behind it ("what is 12 times
 * 8?"). `isConceptLessonQuestion` answers true for these because they open
 * with "what is", so they have to be caught before the concept branch.
 */
function isBareArithmetic(question: string): boolean {
  const q = question.trim();
  if (q.length > 60 || !/\d/.test(q)) return false;
  if (/\^|²|³|=|\bd[a-z]\/d[a-z]\b/i.test(q)) return false;
  // Any word outside this list means there is a subject to teach, not just a
  // sum to evaluate. "expand (1 + 2x)^5 using the binomial theorem" opens
  // with an arithmetic-looking "1 + 2" but is a whole method.
  const ARITHMETIC_WORDS = new Set([
    "what", "whats", "is", "the", "of", "how", "much", "many", "calculate",
    "find", "evaluate", "compute", "work", "out", "value", "answer", "to",
    "times", "plus", "minus", "divided", "multiplied", "by", "percent", "and",
    "sum", "product", "difference", "quotient", "square", "root", "cube",
  ]);
  for (const word of q.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (!ARITHMETIC_WORDS.has(word)) return false;
  }
  return /\d\s*(?:[+\-*/×÷]|times|plus|minus|divided\s+by|multiplied\s+by|percent|%)\s*\d?/i.test(q);
}

/** Distinct things the question wants produced. */
function countMathAsks(question: string): number {
  const subParts = new Set(
    (question.match(SUB_PART_MARKERS) ?? []).map((part) => part.toLowerCase()),
  ).size;
  const verbs = countMatches(question, MATH_ASK_VERBS);
  const alsoFind = countMatches(question, /\b(?:also|then|and\s+hence|furthermore)\s+\w*\s*(?:find|show|prove|solve|calculate|determine|state)\b/gi);
  return subParts + verbs + alsoFind;
}

function shiftScope(scope: LessonScope, steps: number): LessonScope {
  const index = LESSON_SCOPE_ORDER.indexOf(scope);
  const shifted = Math.min(
    Math.max(index + steps, 0),
    LESSON_SCOPE_ORDER.length - 1,
  );
  return LESSON_SCOPE_ORDER[shifted]!;
}

/**
 * Classify how much teaching the question itself deserves, before the user's
 * depth preference is applied.
 */
export function classifyLessonScope(question: string): LessonScope {
  const q = question.trim();
  if (q.length === 0) {
    return "standard";
  }

  const asks = countMathAsks(q);

  if (isBareArithmetic(q)) {
    return "compact";
  }

  // A proof or derivation is the whole lesson: the statement, why the method
  // applies, every algebraic move, and the conclusion tied back to the claim.
  if (PROOF_LEAD.test(q)) {
    return asks >= 3 ? "deep" : "extended";
  }

  if (DEEP_METHOD_KEYWORDS.test(q)) {
    return asks >= 3 ? "deep" : "extended";
  }

  if (asks >= 4) {
    return "deep";
  }

  if (
    MULTI_STAGE_KEYWORDS.test(q) ||
    countEquations(q) >= 2 ||
    (hasPolynomialPower(q) && countEquations(q) >= 1) ||
    asks >= 2
  ) {
    return "extended";
  }

  // Teaching an idea from scratch is never a two-line answer: the meaning, the
  // names, how to read the figure, and one worked example is a full page-plus.
  if (isConceptLessonQuestion(q)) {
    return "extended";
  }

  // A single short ask with no machinery behind it: one substitution chain.
  if (asks <= 1 && q.length <= 120) {
    return "standard";
  }

  return "standard";
}

/**
 * The step budget for this turn. `familiarity` is how well the student says
 * they know the topic, and moves the classified band by one tier in either
 * direction; it can never collapse a proof into a wrap-up.
 */
export function resolveLessonBudget(
  question: string,
  familiarity: SubjectFamiliarity = "normal",
): LessonBudget {
  const classified = classifyLessonScope(question);
  const scope =
    familiarity === "revision"
      ? shiftScope(classified, -1)
      : familiarity === "new"
        ? shiftScope(classified, 1)
        : classified;
  const steps = SCOPE_STEPS[scope];
  return { scope, ...steps, boardPages: boardPagesFor(steps.maxSteps) };
}

/**
 * The runtime block that tells the teaching model how long this lesson is.
 * It is the last word on step count, so it is appended after every other
 * teaching addon.
 */
export function lessonScopePromptAddon(budget: LessonBudget): string {
  return `LESSON LENGTH FOR THIS QUESTION
This overrides every earlier step count. Teach this question in ${budget.minSteps}-${budget.maxSteps} steps, and [WRITE] a board line in each of them. A step that only moves the marker over the figure writes nothing and does not count toward that range, so spend the range on the working and not on a figure tour.
This question needs about ${budget.boardPages} board ${budget.boardPages === 1 ? "page" : "pages"} of work (${BOARD_ROWS_PER_PAGE} rows fit on a page). Keep writing past the bottom of the first page. The board turns to a fresh page by itself and the finished page is saved to the student's notes. Never compress a derivation, drop a rung of the ladder, or skip the interpretation so the work fits on one page.
One tag is not optional: the row that carries the answer to this question ends with [EMPHASIZE:last] in that same step, so the student can find it on a full page.
${scopeGuidance(budget.scope)}`;
}

function scopeGuidance(scope: LessonScope): string {
  switch (scope) {
    case "compact":
      return "This is a single-step question. Still keep the whole ladder: what the symbols mean, the relation in symbols, the rearranged form, the substitution with units, the result, and what the result means. Give each one its own row.";
    case "standard":
      return "Give each algebraic move its own step and its own board row instead of collapsing two moves into one line. Say why each move follows from the one before it.";
    case "extended":
      return "This question has several stages. Name the stage before you start it, write every intermediate line rather than jumping to the simplified form, and after each stage say in one sentence what you now know. Finish with a check of the result: units, sign, a limiting case, or substituting back.";
    case "deep":
      return "This question has several parts or a full derivation. Announce each part before you start it and finish it before moving on. Write every intermediate line, including the algebra you would normally do in your head, and state the reason for each move. After each part, write one line recording the result of that part so the later parts can use it. Finish with a check of the result: units, sign, a limiting case, or substituting back.";
  }
}
