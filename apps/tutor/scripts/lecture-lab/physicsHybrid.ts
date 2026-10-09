/** Part 15b: read-only counterfactual over already judged physics figures. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LectureRun } from "./lecturePipeline";
import type { DiagramEvalRow } from "./diagramEval";
import type { DiagramJudgment, DiagramVerdict } from "./judging";

export interface HybridRow {
  id: string;
  question: string;
  chapter: string;
  source: string;
  family: string | null;
  archetype: string | null;
  drawn: boolean;
  required: boolean;
  verdict: DiagramVerdict;
}

export function hybridBuilderKey(row: HybridRow): string | null {
  const family = row.source === "archetype" ? row.archetype : row.family;
  return family && ["fast_family", "family", "archetype", "last_resort"].includes(row.source)
    ? `${row.source}:${family}` : null;
}

export function buildHybridAllowlist(rows: readonly HybridRow[], threshold: number) {
  const groups = new Map<string, { cases: number; wrong: number; useful: number; uniqueQuestions: Set<string> }>();
  for (const row of rows) {
    const key = hybridBuilderKey(row);
    if (!row.drawn || !key) continue;
    const group = groups.get(key) ?? { cases: 0, wrong: 0, useful: 0, uniqueQuestions: new Set<string>() };
    group.cases++;
    group.wrong += Number(row.verdict === "wrong");
    group.useful += Number(row.verdict === "right" || row.verdict === "partial");
    group.uniqueQuestions.add(row.question);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({
    key, cases: group.cases, useful: group.useful, wrong: group.wrong,
    uniqueQuestions: group.uniqueQuestions.size,
    wrongRate: group.wrong / group.cases,
    qualifies: group.cases >= 5 && group.wrong / group.cases <= threshold,
  }));
}

export function simulatePhysicsHybrid(current: HybridRow, strict: HybridRow, allowlist: ReadonlySet<string>): HybridRow {
  if (current.id !== strict.id || current.question !== strict.question || current.required !== strict.required) {
    throw new Error("hybrid requires identical matched question and rubric");
  }
  if (strict.drawn) return strict;
  const key = hybridBuilderKey(current);
  return current.drawn && key && allowlist.has(key) ? current : strict;
}

export function hybridMetrics(rows: readonly HybridRow[]) {
  return {
    tested: rows.length,
    useful: rows.filter((row) => row.verdict === "right" || row.verdict === "partial").length,
    wrong: rows.filter((row) => row.verdict === "wrong").length,
    requiredEmpty: rows.filter((row) => row.required && !row.drawn).length,
  };
}

function readRound(directory: string): HybridRow[] {
  const verdicts = new Map(readFileSync(`${directory}/judgments.jsonl`, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as DiagramJudgment).map((row) => [row.id, row.verdict]));
  return readdirSync(`${directory}/runs`).filter((file) => file.endsWith(".json")).sort().flatMap((file) => {
    const run = JSON.parse(readFileSync(`${directory}/runs/${file}`, "utf8")) as LectureRun & { evaluation: DiagramEvalRow };
    if (run.evaluation?.subject !== "physics") return [];
    const verdict = verdicts.get(run.probeId);
    if (!verdict) throw new Error(`missing verdict: ${directory}/${run.probeId}`);
    return [{
      id: run.probeId, question: run.question, chapter: run.unitId,
      source: run.diagram.figureSource ?? "unrecorded", family: run.diagram.family, archetype: run.diagram.archetypeId,
      drawn: run.diagram.committed, required: run.evaluation.figure_need === "required", verdict,
    }];
  });
}

export function analyzePhysicsHybrid(labRoot: string) {
  const rounds = [
    ["part11", "diagram-eval-300-20261009/current"],
    ["part11", "diagram-eval-300-20261009/planner_first"],
    ["part11", "diagram-eval-300-20261009/planner_examples"],
    ["part12", "diagram-eval-300-fast-20261009/current"],
    ["part12", "diagram-eval-300-fast-20261009/planner_examples_strict"],
    ["part14", "diagram-topic-coverage-azure-20261009/current"],
    ["part14", "diagram-topic-coverage-azure-20261009/planner_examples_strict"],
  ].map(([part, path]) => ({ part, path, rows: readRound(resolve(labRoot, path!)) }));
  const allRows = rounds.flatMap((round) => round.rows);
  const current = new Map(rounds[5]!.rows.map((row) => [row.id, row]));
  const strict = rounds[6]!.rows;
  const matchedCurrent = strict.map((row) => {
    const match = current.get(row.id);
    if (!match) throw new Error(`missing matched current: ${row.id}`);
    return match;
  });
  const thresholds = [0.10, 0.15].map((threshold) => {
    const families = buildHybridAllowlist(allRows, threshold);
    const allowlist = new Set(families.filter((group) => group.qualifies).map((group) => group.key));
    const hybrid = strict.map((row, index) => simulatePhysicsHybrid(matchedCurrent[index]!, row, allowlist));
    const chapters = [...new Set(strict.map((row) => row.chapter))].sort().map((chapter) => ({
      chapter,
      current: hybridMetrics(matchedCurrent.filter((row) => row.chapter === chapter)),
      strict: hybridMetrics(strict.filter((row) => row.chapter === chapter)),
      hybrid: hybridMetrics(hybrid.filter((row) => row.chapter === chapter)),
    }));
    const baseline = hybridMetrics(matchedCurrent);
    const result = hybridMetrics(hybrid);
    return {
      threshold, allowlist: [...allowlist], families, chapters,
      current: baseline, strict: hybridMetrics(strict), hybrid: result,
      qualifiesForLive: result.wrong < baseline.wrong && result.useful >= baseline.useful * 0.9,
      selectedRows: hybrid.map((row, index) => ({ id: row.id, source: row.source, verdict: row.verdict, addedFallback: row !== strict[index] })),
    };
  });
  // Repeated arms/models are not independent examples: worst verdict per question/key.
  const unique = new Map<string, HybridRow>();
  for (const row of allRows) {
    const key = `${hybridBuilderKey(row)}\0${row.question}`;
    if (!unique.has(key) || row.verdict === "wrong") unique.set(key, row);
  }
  return {
    schemaVersion: "physics-hybrid-analysis/v1", modelCalls: 0,
    observationUnit: "one judged figure per arm/run; repeated questions visible separately",
    rounds: rounds.map(({ part, path, rows }) => ({ part, path, physicsRows: rows.length })),
    familiesByPart: rounds.map(({ part, path, rows }) => ({ part, path, families: buildHybridAllowlist(rows, .1) })),
    thresholds,
    uniqueQuestionSensitivity: [.1, .15].map((threshold) => ({ threshold, families: buildHybridAllowlist([...unique.values()], threshold) })),
  };
}

if (process.argv[1]?.endsWith("physicsHybrid.ts")) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: physicsHybrid.ts <output.json> (no model calls)");
  const report = analyzePhysicsHybrid(resolve(".lecture-lab"));
  writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.thresholds.map(({ threshold, current, strict, hybrid, allowlist, qualifiesForLive }) =>
    ({ threshold, current, strict, hybrid, allowlist, qualifiesForLive })), null, 2));
}
