import { admitTeachingArithmetic, TEACHING_ARITHMETIC_LIMITS } from "@heytutor/tutor-core";
import { getSegmentCommands, normalizeBoardText, type TutorSegment } from "@heytutor/drawing";

/** One admission boundary for a turn's buffered speech and WRITE beats. */
export function createTeachingArithmeticAdmission() {
  const priorRows: string[] = [];
  const narration: string[] = [];
  let blocked = false;
  let proof: string | null = null;
  let filtered = false;
  // Keep spelling/typography normalization, but do not unwrap LaTeX fractions:
  // their juxtaposition with a whole number is ambiguous mixed notation.
  const rowsOf = (segment: TutorSegment) => getSegmentCommands(segment).flatMap((command) =>
    command.type === "WRITE" && typeof command.text === "string"
      ? [command.sourceText === undefined ? command.text : normalizeBoardText(command.sourceText)] : []);
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
