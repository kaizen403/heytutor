import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isChemistrySceneFamily, isChemistryQuestion, type FigureSource } from "@heytutor/scene-engine";
import { parseDiagramSubject } from "@heytutor/tutor-core";
import type { LectureRun } from "./lecturePipeline";
import { evaluationSuppressesSelectedSource } from "./diagramEval";
import { writeRoundGallery } from "./gallery";
import { summarizeEvaluation } from "./run";
import { gradeLecture } from "./grade";
import { summarize } from "./summarize";
import { readRoundJudgments, readJudgeQueue, ruleJudgmentForNoFigure, type FigureNeed } from "./judging";
import { applyJudgments } from "./judge-apply";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

/**
 * Applies the strict selection policy to a stored run without making a model
 * request. This is used when the deterministic presentation policy changes but
 * the paid planner evidence is already complete and immutable.
 */
export function suppressStoredStrictSelection(value: unknown): boolean {
  const run = record(value);
  const diagram = record(run.diagram);
  const source = diagram.figureSource;
  const subject = parseDiagramSubject(record(run.evaluation).subject);
  const context = {
    subject,
    chemistryLane: subject === "chemistry" ||
      isChemistryQuestion(typeof run.question === "string" ? run.question : "") ||
      (typeof diagram.family === "string" && isChemistrySceneFamily(diagram.family)),
    codeLesson: run.isDsa === true,
    dsa: run.isDsa === true,
    doubt: false,
  };
  if (
    run.arm !== "planner_examples_strict" ||
    diagram.committed !== true ||
    typeof source !== "string" ||
    !evaluationSuppressesSelectedSource("planner_examples_strict", source as FigureSource, context)
  ) {
    return false;
  }

  const family = typeof diagram.family === "string" ? diagram.family : null;
  diagram.committed = false;
  diagram.emptyCause = "fallback_suppressed";
  diagram.tier = null;
  diagram.nonMetric = false;
  diagram.figureSource = "text_only";
  diagram.reason = `strict evaluation suppressed ${source} fallback`;
  diagram.family = null;
  diagram.entityIds = [];
  diagram.focusableIds = [];
  diagram.labels = [];
  diagram.annotations = [];
  diagram.renderedLabels = [];
  diagram.labelByEntity = {};
  diagram.assertionCount = 0;
  diagram.primitiveCount = 0;
  diagram.validationIssues = [];
  diagram.suppressedFallback = { figureSource: source, family };
  diagram.svg = null;
  diagram.png = null;
  run.diagram = diagram;

  const timings = record(run.timings);
  timings.figureCommitMs = null;
  run.timings = timings;
  return true;
}

export function regradeStrictSuppression(roundDir: string): {
  roundDir: string;
  suppressed: number;
} {
  const absolute = resolve(roundDir);
  const runsDir = join(absolute, "runs");
  const runs: LectureRun[] = [];
  let suppressed = 0;
  const replacements = new Map<string, ReturnType<typeof ruleJudgmentForNoFigure>>();

  for (const file of readdirSync(runsDir).filter((name) => name.endsWith(".json")).sort()) {
    const path = join(runsDir, file);
    const run = JSON.parse(readFileSync(path, "utf8")) as LectureRun;
    if (suppressStoredStrictSelection(run)) {
      suppressed += 1;
      const evaluation = record(record(run).evaluation);
      const id = String(evaluation.id ?? run.probeId);
      replacements.set(id, ruleJudgmentForNoFigure(evaluation.figure_need as FigureNeed, id));
      writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
    }
    runs.push(run);
  }

  const summaryPath = join(absolute, "summary.json");
  const summary = record(JSON.parse(readFileSync(summaryPath, "utf8")));
  Object.assign(summary, summarize(runs.map(gradeLecture), runs));
  summary.evaluation = summarizeEvaluation(runs);
  summary.strictSuppressionRegrade = {
    appliedAt: new Date().toISOString(),
    suppressed,
    modelRequests: 0,
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 1)}\n`);
  const judgments = readRoundJudgments(absolute);
  if (judgments.length > 0) {
    const updated = new Map(judgments.map((row) => [row.id, row]));
    for (const [id, row] of replacements) updated.set(id, row);
    writeFileSync(join(absolute, "judgments.jsonl"), [...updated.values()].map((row) => JSON.stringify(row)).join("\n") + "\n");
    writeFileSync(join(absolute, "judge-queue.jsonl"), readJudgeQueue(absolute).filter((row) => !replacements.has(row.id)).map((row) => JSON.stringify(row)).join("\n") + "\n");
    // Incomplete reviews stay incomplete; never retain a stale aggregate.
    delete summary.judge;
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 1)}\n`);
    if (updated.size === runs.length) applyJudgments(absolute);
  }
  writeRoundGallery(absolute);
  return { roundDir: absolute, suppressed };
}

if (process.argv[1]?.endsWith("regrade-strict-suppression.ts")) {
  const round = process.argv[2];
  if (!round) throw new Error("Usage: regrade-strict-suppression.ts <strict round dir>");
  console.log(JSON.stringify(regradeStrictSuppression(round), null, 2));
}
