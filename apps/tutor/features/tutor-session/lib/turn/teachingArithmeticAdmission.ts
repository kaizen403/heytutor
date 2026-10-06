import { admitTeachingArithmetic, TEACHING_ARITHMETIC_LIMITS } from "@heytutor/tutor-core";
import { getSegmentCommands, type TutorSegment } from "@heytutor/drawing";

/** One admission boundary for a turn's buffered speech and WRITE beats. */
export function createTeachingArithmeticAdmission() {
  const priorRows: string[] = [];
  const narration: string[] = [];
  let blocked = false;
  let proof: string | null = null;
  let filtered = false;
  return {
    blocked: () => blocked,
    filtered: () => filtered,
    admittedNarration: () => narration.filter(Boolean).join(" "),
    startAttempt() { const retry = proof; proof = null; blocked = false; return retry; },
    offer(segment: TutorSegment): boolean {
      if (blocked) return false;
      const rows = getSegmentCommands(segment).flatMap((command) =>
        command.type === "WRITE" && typeof command.text === "string" ? [command.text] : []);
      const admission = admitTeachingArithmetic(rows, priorRows);
      if (!admission.admitted) {
        blocked = true;
        filtered = true;
        proof = admission.retryProof ?? "The buffered step exceeds the arithmetic admission budget. Split it into shorter steps.";
        return false;
      }
      priorRows.push(...rows);
      if (priorRows.length > TEACHING_ARITHMETIC_LIMITS.priorRows)
        priorRows.splice(0, priorRows.length - TEACHING_ARITHMETIC_LIMITS.priorRows);
      narration.push(segment.narration);
      return true;
    },
  };
}
