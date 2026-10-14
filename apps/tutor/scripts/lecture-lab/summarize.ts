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
  lessonGradingApplicable: boolean;
  figureOnlyRows: number;
  findingCounts: Record<string, number>;
  duplicateFigures: { signature: string; probeIds: string[] }[];
  /** The completeness round over the round's runs (`diagram.completeness`). */
  completeness: CompletenessRoundsSummary;
  grades: LectureGrade[];
}

/**
 * What the completeness round did across a lab round. A row counts once its
 * run recorded a round (`diagram.completeness`); runs with no planner figure
 * record none. Items are summed over those rows: missing before the round,
 * named in a request, and still missing in the figure that was kept. Extra
 * time is over the rounds that sent a call (nearest rank), since a round that
 * did not call adds nothing.
 */
export interface CompletenessRoundsSummary {
  /** Runs that recorded a round, whether or not it called. */
  rounds: number;
  attempted: number;
  accepted: number;
  /** Rounds skipped because less than the floor of the figure deadline was left. */
  skippedForTime: number;
  outcomes: Record<string, number>;
  itemsMissingBefore: number;
  itemsRequested: number;
  itemsStillMissing: number;
  extraMs: { median: number | null; p90: number | null };
}

function nearestRank(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
}

export function summarizeCompleteness(runs: readonly Pick<LectureRun, "diagram">[]): CompletenessRoundsSummary {
  const records = runs.flatMap((run) => run.diagram.completeness ? [run.diagram.completeness] : []);
  const outcomes: Record<string, number> = {};
  for (const record of records) outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
  const extra = records.filter((record) => record.attempted).map((record) => record.extraMs).sort((left, right) => left - right);
  const sum = (count: (record: (typeof records)[number]) => number) => records.reduce((total, record) => total + count(record), 0);
  return {
    rounds: records.length,
    attempted: records.filter((record) => record.attempted).length,
    accepted: records.filter((record) => record.accepted).length,
    skippedForTime: records.filter((record) => record.outcome === "skipped_deadline").length,
    outcomes: Object.fromEntries(Object.entries(outcomes).sort((left, right) => right[1] - left[1])),
    itemsMissingBefore: sum((record) => record.itemsMissingBefore.length),
    itemsRequested: sum((record) => record.itemsRequested.length),
    itemsStillMissing: sum((record) => record.itemsStillMissing.length),
    extraMs: { median: nearestRank(extra, 0.5), p90: nearestRank(extra, 0.9) },
  };
}

/** One report line for the completeness round. */
export function formatCompletenessSummary(summary: CompletenessRoundsSummary): string {
  if (summary.rounds === 0) return "completeness rounds: none recorded";
  const ms = (value: number | null) => value === null ? "n/a" : `${Math.round(value)} ms`;
  return `completeness rounds: ${summary.attempted}/${summary.rounds} attempted, ${summary.accepted} accepted, ` +
    `${summary.skippedForTime} skipped for time; items ${summary.itemsRequested} requested, ` +
    `${summary.itemsStillMissing} still missing (${summary.itemsMissingBefore} before); ` +
    `extra median ${ms(summary.extraMs.median)}, p90 ${ms(summary.extraMs.p90)}`;
}

export function summarize(
  grades: readonly LectureGrade[],
  runs: readonly LectureRun[],
): RoundSummary {
  const graded = grades.filter((grade) => !grade.transportFailure && grade.lessonGradingApplicable !== false);
  const byCode = new Map<string, number>();
  for (const grade of grades) {
    for (const finding of grade.findings) {
      byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
    }
  }
  return {
    total: grades.length,
    graded: graded.length,
    lessonGradingApplicable: graded.length > 0,
    figureOnlyRows: grades.filter((grade) => grade.lessonGradingApplicable === false).length,
    transportFailures: grades.filter((grade) => grade.transportFailure).length,
    passed: graded.filter((grade) => grade.passed).length,
    meanScore:
      graded.length > 0
        ? Math.round(graded.reduce((total, grade) => total + grade.score, 0) / graded.length)
        : 0,
    findingCounts: Object.fromEntries(
      [...byCode.entries()].sort((left, right) => right[1] - left[1]),
    ),
    duplicateFigures: duplicateFigureSignatures(runs),
    completeness: summarizeCompleteness(runs),
    grades: [...grades].sort((left, right) => left.score - right.score),
  };
}

export function printSummary(summary: RoundSummary): void {
  console.log(formatCompletenessSummary(summary.completeness));
  if (summary.figureOnlyRows > 0 && summary.graded === 0) {
    console.log(`figure-only ${summary.figureOnlyRows} rows; lesson score and pass rate are not applicable`);
    return;
  }
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
