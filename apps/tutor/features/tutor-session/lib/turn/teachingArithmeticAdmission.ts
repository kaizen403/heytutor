import { admitTeachingArithmetic, TEACHING_ARITHMETIC_LIMITS, type TeachingArithmeticRow } from "@heytutor/tutor-core";
import { getSegmentCommands, normalizeBoardText, type TutorSegment } from "@heytutor/drawing";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

/** One admission boundary for a turn's buffered speech and WRITE beats. */
export function createTeachingArithmeticAdmission(options: {verifiedPlan?: TurnPlanV3 | null} = {}) {
  const givens = options.verifiedPlan?.givens ?? [];
  const unit = givens[0]?.unit;
  const displayUnit = unit && /^[A-Za-zµμΩ]{1,32}$/.test(unit) &&
    givens.every(given => given.provenance === "given" && given.unit === unit) ? unit : undefined;
  const priorRows: TeachingArithmeticRow[] = [];
  const narration: string[] = [];
  let blocked = false;
  let proof: string | null = null;
  let filtered = false;
  // Keep spelling/typography normalization, but do not unwrap LaTeX fractions:
  // their juxtaposition with a whole number is ambiguous mixed notation.
  const rowsOf = (segment: TutorSegment): TeachingArithmeticRow[] => getSegmentCommands(segment).flatMap((command) => {
    if (command.type !== "WRITE" || typeof command.text !== "string") return [];
    const text = command.sourceText === undefined ? command.text : normalizeBoardText(command.sourceText);
    return [displayUnit ? {text, displayUnit} : text];
  });
  const commitReleased = (segment: TutorSegment) => {
    priorRows.push(...rowsOf(segment));
    if (priorRows.length > TEACHING_ARITHMETIC_LIMITS.priorRows)
      priorRows.splice(0, priorRows.length - TEACHING_ARITHMETIC_LIMITS.priorRows);
    narration.push(segment.narration);
  };
  return {
    blocked: () => blocked,
    filtered: () => filtered,
    admittedNarration: () => narration.filter(Boolean).join(" "),
    startAttempt() { const retry = proof; proof = null; blocked = false; return retry; },
    /** Deferred callers commit only segments actually released by downstream gates. */
    commitReleased,
    offer(segment: TutorSegment, options: { deferCommit?: boolean } = {}): boolean {
      if (blocked) return false;
      const admission = admitTeachingArithmetic(rowsOf(segment), priorRows);
      if (!admission.admitted) {
        blocked = true;
        filtered = true;
        proof = admission.retryProof ?? "The buffered step exceeds the arithmetic admission budget. Split it into shorter steps.";
        return false;
      }
      if (!options.deferCommit) commitReleased(segment);
      return true;
    },
  };
}
