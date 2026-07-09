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

/** How many things the question explicitly asks to find. */
function countAsks(question: string): number {
  const matches = question.match(/\b(?:find|calculate|determine|compute|evaluate|how much|what is)\b/gi);
  const commaListBoost = /,\s*(?:the|its|and)\b/gi.test(question) ? 1 : 0;
  // Lettered sub-questions like "(a) ... (b) ... (c)" or "part (a)/(b)" are
  // strong evidence of a multi-part problem — count each as a distinct ask.
  const letteredParts = question.match(/\([a-c]\)|part\s*\([a-c]\)/gi);
  const letteredCount = letteredParts ? Math.min(letteredParts.length, 4) : 0;
  return (matches ? matches.length : 0) + commaListBoost + letteredCount;
}

const MEDIUM_KEYWORDS =
  /\b(?:prove|proof|derive|derivation|kirchhoff|wheatstone|meter bridge|rolls?\s+without\s+slipping|rolling|moment of inertia|torque|coefficient of friction|minimum coefficient|banked|escape velocity|carnot|efficiency|superposition|interference|diffraction|combination|series\s+and\s+parallel|cube|equipotential|symmetry|network of wires|skeleton)\b/i;

const CONCEPTUAL_LEAD = /^\s*(?:explain|what\s+is|what\s+are|describe|why|how\s+does|walk me through|tell me about|introduce|overview of)\b/i;

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

  const givens = countGivens(q);
  const asks = countAsks(q);

  // Hardest tier: proofs, combination networks, rotational dynamics, or
  // genuinely multi-part numeric problems. The thresholds are deliberately
  // high because kimi-k2p6 at "medium" produces 15k-22k reasoning chars
  // (55-70s of silence) — only worth it for problems that truly need a plan.
  // A series circuit with 3 numbers and 2-3 sub-questions is still one formula
  // chain (Ohm's law), so it stays "low".
  if (
    MEDIUM_KEYWORDS.test(q) ||
    isCombinationCircuit(q) ||
    asks >= 3 ||
    givens >= 4
  ) {
    return "medium";
  }

  // Purely conceptual explanations with no numbers start instantly. Checked
  // before the numeric tier because leads like "what is" also count as an ask.
  if (givens === 0 && CONCEPTUAL_LEAD.test(q)) {
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
