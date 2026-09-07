/**
 * Diff two graded rounds.
 *
 * A round is only useful against the round before it, and reading two
 * summary.json files side by side is how a regression hides. Both rounds must
 * be regraded with the current rubric first, or the diff measures the rubric.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/compare.ts .lecture-lab/round-01 .lecture-lab/round-02
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Summary {
  total: number;
  /** Rounds recorded before transport failures were separated have no `graded`. */
  graded?: number;
  transportFailures?: number;
  passed: number;
  meanScore: number;
  findingCounts: Record<string, number>;
  grades: { probeId: string; score: number; transportFailure?: boolean }[];
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  throw new Error("Usage: compare.ts <before round dir> <after round dir>");
}

const read = (path: string): Summary =>
  JSON.parse(readFileSync(resolve(process.cwd(), path, "summary.json"), "utf8")) as Summary;
const before = read(beforePath);
const after = read(afterPath);

const delta = (value: number) => (value > 0 ? `+${value}` : String(value));

console.log(`           ${beforePath}  ->  ${afterPath}`);
console.log(
  `mean score ${before.meanScore} -> ${after.meanScore}  (${delta(after.meanScore - before.meanScore)})`,
);
const graded = (summary: Summary) => summary.graded ?? summary.total;
console.log(
  `passed     ${before.passed}/${graded(before)} -> ${after.passed}/${graded(after)}`,
);
if (before.transportFailures || after.transportFailures) {
  console.log(
    `transport  ${before.transportFailures ?? 0} -> ${after.transportFailures ?? 0} turns died before the tutor spoke`,
  );
}
console.log("");

const codes = new Set([
  ...Object.keys(before.findingCounts),
  ...Object.keys(after.findingCounts),
]);
const rows = [...codes]
  .map((code) => ({
    code,
    before: before.findingCounts[code] ?? 0,
    after: after.findingCounts[code] ?? 0,
  }))
  .sort((left, right) => left.after - left.before - (right.after - right.before));
for (const row of rows) {
  const change = row.after - row.before;
  const mark = change < 0 ? "fixed  " : change > 0 ? "WORSE  " : "same   ";
  console.log(`  ${mark} ${String(row.before).padStart(3)} -> ${String(row.after).padStart(3)}  ${row.code}`);
}

console.log("");
const scoreBefore = new Map(before.grades.map((grade) => [grade.probeId, grade.score]));
const transportFailed = new Set(
  [...before.grades, ...after.grades]
    .filter((grade) => grade.transportFailure)
    .map((grade) => grade.probeId),
);
const moved = after.grades
  .map((grade) => ({
    probeId: grade.probeId,
    before: scoreBefore.get(grade.probeId),
    after: grade.score,
  }))
  .filter((row) => row.before !== undefined && row.before !== row.after)
  .filter((row) => !transportFailed.has(row.probeId))
  .sort((left, right) => (left.after - (left.before ?? 0)) - (right.after - (right.before ?? 0)));
for (const row of moved) {
  console.log(
    `  ${String(row.before).padStart(3)} -> ${String(row.after).padStart(3)}  ${delta(row.after - (row.before ?? 0)).padStart(4)}  ${row.probeId}`,
  );
}
