/**
 * Adaptive reasoning tier for a tutor turn.
 *
 * The live teaching loop trades latency for correctness: simple conceptual
 * questions start speaking almost instantly with no hidden thinking, while
 * genuinely multi-step problems get a reasoning budget so the model plans the
 * solution before it emits the lesson. The reasoning is hidden — it never
 * reaches TTS or the drawing parser.
 */
export type ReasoningEffort = "none" | "low" | "medium";

/** Global override read from TUTOR_REASONING_MODE. `auto` uses the classifier. */
export type ReasoningMode = "auto" | "off" | "low" | "medium";

export function parseReasoningMode(raw: string | undefined | null): ReasoningMode {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "off":
    case "none":
      return "off";
    case "low":
      return "low";
    case "medium":
    case "high":
      return "medium";
    default:
      return "auto";
  }
}

/**
 * Verbs that ask for a piece of mathematics rather than a physics lookup.
 * Two copies on purpose: a `/g` regex carries `lastIndex` across `.test()`
 * calls, so counting and testing must not share one object.
 */
const MATH_VERB_SOURCE =
  "\\b(?:solve|simplify|expand|factori[sz]e|integrate|differentiate|sketch|prove|show\\s+that|hence|express|rationali[sz]e)\\b";
const MATH_VERBS_GLOBAL = new RegExp(MATH_VERB_SOURCE, "gi");
const MATH_VERBS = new RegExp(MATH_VERB_SOURCE, "i");

/** Distinct numeric givens like "12 V", "4 Ω", "0.2 m", "30°", "2 kg".
 *  Only scans the problem statement (before "find/calculate/determine") so a
 *  value re-mentioned in the ask ("power in the 8 Ω resistor") doesn't inflate
 *  the count — same class of bug as the phantom-R3 resistor extraction. */
function countGivens(question: string): number {
  const statement =
    question.split(/\b(?:find|calculate|determine|compute|evaluate|how much|what is)\b/i)[0] ??
    question;
  const matches = statement.match(
    /\d+(?:\.\d+)?\s*(?:V\b|volts?|Ω|ohms?|A\b|amp\w*|kg|g\b|m\/s|m\b|cm|mm|km|s\b|kg\b|N\b|Hz|°|deg\w*|rad|J\b|W\b|Pa|T\b|C\b|F\b|eV|nm|μC|uC|mol)/gi,
  );
  if (!matches) return 0;
  return new Set(matches.map((m) => m.replace(/\s+/g, "").toLowerCase())).size;
}

/**
 * Distinct numeric literals in a mathematics question.
 *
 * `countGivens` only sees numbers carrying an SI unit, so a pure maths stem
 * ("solve 2x + 3y = 12, 3x - y = 5") scored zero givens and always fell to the
 * cheapest reasoning tier. Only counted when the stem actually looks like
 * mathematics, meaning an equation, an unknown, or a maths verb, so "how much is 2
 * plus 2" does not buy a reasoning budget.
 */
function countMathLiterals(question: string): number {
  const statement =
    question.split(/\b(?:find|calculate|determine|compute|evaluate|how much|what is)\b/i)[0] ??
    question;
  const looksMathematical =
    /=/.test(statement) ||
    /\b[a-z]\s*(?:\^|²|³|\(|_)/i.test(statement) ||
    MATH_VERBS.test(statement) ||
    /\b(?:x|y|z|n|f\(x\)|dy\/dx)\b/.test(statement);
  if (!looksMathematical) return 0;
  const literals = statement.match(/-?\d+(?:\.\d+)?/g);
  if (!literals) return 0;
  return Math.min(new Set(literals).size, 6);
}

/** How many things the question explicitly asks to find. */
function countAsks(question: string): number {
  const matches = question.match(/\b(?:find|calculate|determine|compute|evaluate|how much|what is)\b/gi);
  const commaListBoost = /,\s*(?:the|its|and)\b/gi.test(question) ? 1 : 0;
  // Lettered sub-questions like "(a) ... (b) ... (c)" or "part (a)/(b)" are
  // strong evidence of a multi-part problem — count each as a distinct ask.
  const letteredParts = question.match(/\([a-c]\)|part\s*\([a-c]\)/gi);
  const letteredCount = letteredParts ? Math.min(letteredParts.length, 4) : 0;
  // Mathematics asks for work with its own verbs; "find/calculate" never
  // appears in "solve x^2 - 5x + 6 = 0 and hence sketch the curve".
  const mathVerbs = question.match(MATH_VERBS_GLOBAL);
  const mathVerbCount = mathVerbs ? Math.min(mathVerbs.length, 4) : 0;
  return (matches ? matches.length : 0) + commaListBoost + letteredCount + mathVerbCount;
}

/**
 * Mathematics that carries a method choice, a setup, and a check: the same
 * "needs a plan before the first spoken word" bar the physics list uses.
 */
const MATH_MEDIUM_KEYWORDS =
  /\b(?:integra(?:l|te|ted|tes|tion|ting)\w*|by\s+parts|partial\s+fractions?|u-?substitution|differential\s+equation|implicit\s+differentiation|related\s+rates?|l'?h(?:o|ô)pital|taylor|maclaurin|induction|eigen\w+|determinant|cramer|gauss\w*\s+elimination|binomial\s+(?:theorem|expansion)|conditional\s+probability|bayes|permutations?\s+and\s+combinations?|locus|conic|hyperbola|de\s+moivre|volume\s+of\s+revolution|area\s+(?:under|between|bounded)|simultaneous\s+equations?|system\s+of\s+equations?)\b/i;

const MEDIUM_KEYWORDS =
  /\b(?:prove|proof|derive|derivation|kirchhoff|wheatstone|meter bridge|rolls?\s+without\s+slipping|rolling|moment of inertia|torque|coefficient of friction|minimum coefficient|banked|escape velocity|carnot|efficiency|superposition|interference|diffraction|combination|series\s+and\s+parallel|cube|equipotential|symmetry|network of wires|skeleton)\b/i;

const CONCEPTUAL_LEAD = /^\s*(?:explain|what\s+is|what\s+are|describe|why|how\s+does|walk me through|tell me about|introduce|overview of)\b/i;
const CONCEPT_LESSON = /(?:explain|what\s+is|what\s+are|describe|walk me through|tell me about|introduce|overview of|basics of)\b/i;
const DIAGRAM_SETUP = /^(?:draw|sketch|show|illustrate)\b/i;

/**
 * Every verb that asks for work to be done rather than an idea to be taught.
 * Wider than the reasoning-tier ask list on purpose: this one decides whether
 * a stem is a request to solve at all.
 */
const ANY_ASK_VERB =
  /\b(?:find|calculate|determine|compute|evaluate|solve|prove|derive|show\s+that|verify|simplify|expand|factori[sz]e|integrate|differentiate|estimate|convert|how\s+much|how\s+many|what\s+is\s+the\s+value)\b/i;

/** True when the user asked to learn an idea, not to solve a numbered problem. */
export function isConceptLessonQuestion(question: string): boolean {
  const q = question.trim();
  if (q.length === 0) return false;
  if (/\b(?:find|calculate|determine|compute|evaluate)\b/i.test(q) && /\d/.test(q)) return false;
  if (CONCEPTUAL_LEAD.test(q) || CONCEPT_LESSON.test(q)) return true;
  if (DIAGRAM_SETUP.test(q)) return true;
  // Dictation drops the leading verb: "explain the first law of physics with
  // an example" reaches us as "Me the first law of physics with an example".
  // Neither lead pattern matches, so a pure concept request was taught as a
  // numbered problem and the planner invented givens to solve. A stem with no
  // ask verb, no digits, and no equation has nothing to compute, so teaching
  // the idea is the only sensible reading.
  return !ANY_ASK_VERB.test(q) && !/\d/.test(q) && !/=/.test(q) && /[a-z]{3}/i.test(q);
}

/** True for combination circuits (both series and parallel with 3+ resistors). */
function isCombinationCircuit(question: string): boolean {
  const hasParallel = /parallel/i.test(question);
  const hasSeries = /series/i.test(question);
  const resistorCount = (question.match(/\d+(?:\.\d+)?\s*(?:Ω|ohms?)/gi) ?? []).length;
  return hasParallel && hasSeries && resistorCount >= 3;
}

/**
 * Classify how much hidden reasoning a question deserves.
 * Deterministic and ~0ms — safe to call on every turn.
 */
export function classifyReasoningEffort(question: string): ReasoningEffort {
  const q = question.trim();
  if (q.length === 0) {
    return "none";
  }

  const givens = Math.max(countGivens(q), countMathLiterals(q));
  const asks = countAsks(q);

  // Hardest tier: proofs, combination networks, rotational dynamics, or
  // genuinely multi-part numeric problems. The thresholds are deliberately
  // high because kimi-k2p6 at "medium" produces 15k-22k reasoning chars
  // (55-70s of silence) — only worth it for problems that truly need a plan.
  // A series circuit with 3 numbers and 2-3 sub-questions is still one formula
  // chain (Ohm's law), so it stays "low".
  if (
    MEDIUM_KEYWORDS.test(q) ||
    MATH_MEDIUM_KEYWORDS.test(q) ||
    isCombinationCircuit(q) ||
    asks >= 3 ||
    givens >= 4
  ) {
    return "medium";
  }

  // Purely conceptual explanations with no numbers start instantly. Checked
  // before the numeric tier because leads like "what is" also count as an ask.
  if (givens === 0 && isConceptLessonQuestion(q)) {
    return "none";
  }

  // Single-step numeric problems: a couple of givens and one thing to find.
  if (givens >= 1 || asks >= 1) {
    return "low";
  }

  // Default: a light nudge of reasoning is cheap and safer than none.
  return "low";
}

/** Resolve the effort for a turn, honouring the TUTOR_REASONING_MODE override. */
export function resolveReasoningEffort(
  question: string,
  mode: ReasoningMode = "auto",
): ReasoningEffort {
  switch (mode) {
    case "off":
      return "none";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "auto":
    default:
      return classifyReasoningEffort(question);
  }
}
