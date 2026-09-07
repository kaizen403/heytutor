/**
 * One summary shape for a round, shared by the runner and the regrader.
 *
 * It lived in both files and had already started to drift. It also has one
 * judgement in it that has to be made the same way every time: a turn that died
 * in transport is not a bad lesson, so it is counted and reported but kept out
 * of the pass rate and the mean.
 */
import type { LectureGrade } from "./grade";
import type { LectureRun } from "./lecturePipeline";

export interface RoundSummary {
  total: number;
  graded: number;
  transportFailures: number;
  passed: number;
  meanScore: number;
  findingCounts: Record<string, number>;
  duplicateFigures: { signature: string; probeIds: string[] }[];
  grades: LectureGrade[];
}

export function summarize(
  grades: readonly LectureGrade[],
  runs: readonly LectureRun[],
): RoundSummary {
  const graded = grades.filter((grade) => !grade.transportFailure);
  const byCode = new Map<string, number>();
  for (const grade of grades) {
    for (const finding of grade.findings) {
      byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
    }
  }
  return {
    total: grades.length,
    graded: graded.length,
    transportFailures: grades.length - graded.length,
    passed: graded.filter((grade) => grade.passed).length,
    meanScore:
      graded.length > 0
        ? Math.round(graded.reduce((total, grade) => total + grade.score, 0) / graded.length)
        : 0,
    findingCounts: Object.fromEntries(
      [...byCode.entries()].sort((left, right) => right[1] - left[1]),
    ),
    duplicateFigures: duplicateFigureSignatures(runs),
    grades: [...grades].sort((left, right) => left.score - right.score),
  };
}

export function printSummary(summary: RoundSummary): void {
  console.log(
    `passed ${summary.passed}/${summary.graded}  mean score ${summary.meanScore}` +
      (summary.transportFailures > 0
        ? `  (${summary.transportFailures} turns died in transport and are not graded)`
        : ""),
  );
  for (const [code, count] of Object.entries(summary.findingCounts)) {
    console.log(`  ${String(count).padStart(4)}  ${code}`);
  }
  for (const group of summary.duplicateFigures) {
    console.log(`  same figure across units: ${group.probeIds.join("  ")}  [${group.signature}]`);
  }
}

/**
 * Two different topics that compile to the same figure.
 *
 * The keyword family layer picks a picture from stem words, so unrelated
 * questions land on the same generic construction: a double slit rig served
 * both an interference question and a capillary rise question in one round.
 * An identical entity id list across units is the cheapest proof of it, and it
 * only exists at the level of a round, not a single lecture.
 */
function duplicateFigureSignatures(
  records: readonly LectureRun[],
): { signature: string; probeIds: string[] }[] {
  const bySignature = new Map<string, LectureRun[]>();
  for (const record of records) {
    if (!record.diagram.committed || record.diagram.entityIds.length === 0) continue;
    const signature = [...record.diagram.entityIds].sort().join(",");
    const bucket = bySignature.get(signature);
    if (bucket) bucket.push(record);
    else bySignature.set(signature, [record]);
  }
  const groups: { signature: string; probeIds: string[] }[] = [];
  for (const [signature, bucket] of bySignature) {
    const units = new Set(bucket.map((record) => record.unitId));
    if (units.size < 2) continue;
    groups.push({
      signature: signature.length > 90 ? `${signature.slice(0, 90)}...` : signature,
      probeIds: bucket.map((record) => record.probeId),
    });
  }
  return groups;
}
