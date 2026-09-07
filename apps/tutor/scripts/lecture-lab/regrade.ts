/**
 * Re-scores a finished run directory from its stored `LectureRun` records.
 *
 * The rubric is the part of this lab that changes most, and every rubric edit
 * used to cost another hour of live lectures to see its effect. Grading is pure
 * over the run record, so it can be replayed: fix a false positive here, regrade
 * every past round, and the trend line stays comparable.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/regrade.ts .lecture-lab/round-01
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { gradeLecture, type LectureGrade } from "./grade";
import { printSummary, summarize } from "./summarize";
import { transcript } from "./run";
import type { LectureRun } from "./lecturePipeline";

const target = process.argv[2];
if (!target) throw new Error("Usage: regrade.ts <run directory>");
const outDir = resolve(process.cwd(), target);
mkdirSync(`${outDir}/transcripts`, { recursive: true });

const grades: LectureGrade[] = [];
const runs: LectureRun[] = [];
for (const file of readdirSync(`${outDir}/runs`).filter((name) => name.endsWith(".json")).sort()) {
  const run = JSON.parse(readFileSync(`${outDir}/runs/${file}`, "utf8")) as LectureRun;
  const grade = gradeLecture(run);
  runs.push(run);
  grades.push(grade);
  writeFileSync(
    `${outDir}/transcripts/${file.replace(/\.json$/, ".md")}`,
    `${transcript(run, grade)}\n`,
  );
}

const summary = { regradedAt: new Date().toISOString(), ...summarize(grades, runs) };
writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
console.log(`regraded ${summary.total}:`);
printSummary(summary);
