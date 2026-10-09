/** Deterministic chapter, topic, and fix-group report for Part 14a. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDiagramEvalJsonl, type DiagramEmptyCause } from "./diagramEval";
import { readRoundJudgments, type DiagramVerdict } from "./judging";

export interface TopicCoverageRow {
  id: string;
  topicId: string;
  subject: string;
  chapter: string;
  figureNeed: "required" | "optional" | "none";
  figureKind: string;
  verdict: DiagramVerdict | "untested";
  emptyCause: DiagramEmptyCause | null;
  candidateErrorCodes: string[];
  suppressedSource: string | null;
}

interface ChapterSummary {
  chapter: string;
  topicsPlanned: number;
  topicsTested: number;
  untested: number;
  right: number;
  partial: number;
  wrong: number;
  empty: number;
  usefulShare: number;
}

interface FailureGroup {
  count: number;
  topics: string[];
}

interface PlannerFailureGroup extends FailureGroup {
  topErrorCodes: Record<string, number>;
  missingDrawingKinds: Record<string, number>;
}

export interface TopicCoverageReport {
  rows: TopicCoverageRow[];
  chapters: ChapterSummary[];
  failureGroups: {
    wrongStructureExample: FailureGroup;
    plannerDeclinedOrInvalid: PlannerFailureGroup;
    nothingHonestToDraw: FailureGroup;
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function sortedCounts(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(
    ([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
  ));
}

function isEmpty(verdict: TopicCoverageRow["verdict"]): boolean {
  return verdict === "empty_ok" || verdict === "empty_bad";
}

function isNothingHonest(row: TopicCoverageRow): boolean {
  return isEmpty(row.verdict) &&
    row.figureNeed === "optional" &&
    row.candidateErrorCodes.length === 0 &&
    (row.emptyCause === "planner_no_output" || row.emptyCause === "not_needed");
}

export function buildTopicCoverageReport(
  inputRows: readonly TopicCoverageRow[],
): TopicCoverageReport {
  const rows = [...inputRows].sort((left, right) => left.topicId.localeCompare(right.topicId));
  const chapters = new Map<string, ChapterSummary>();
  for (const row of rows) {
    const summary = chapters.get(row.chapter) ?? {
      chapter: row.chapter,
      topicsPlanned: 0,
      topicsTested: 0,
      untested: 0,
      right: 0,
      partial: 0,
      wrong: 0,
      empty: 0,
      usefulShare: 0,
    };
    summary.topicsPlanned += 1;
    if (row.verdict === "untested") {
      summary.untested += 1;
      chapters.set(row.chapter, summary);
      continue;
    }
    summary.topicsTested += 1;
    if (row.verdict === "right") summary.right += 1;
    else if (row.verdict === "partial") summary.partial += 1;
    else if (row.verdict === "wrong") summary.wrong += 1;
    else summary.empty += 1;
    chapters.set(row.chapter, summary);
  }
  const chapterRows = [...chapters.values()].sort((left, right) => left.chapter.localeCompare(right.chapter));
  for (const chapter of chapterRows) {
    chapter.usefulShare = chapter.topicsTested > 0
      ? (chapter.right + chapter.partial) / chapter.topicsTested
      : 0;
  }

  const wrongStructure = rows.filter((row) => row.verdict === "wrong" || row.verdict === "partial");
  const nothingHonest = rows.filter(isNothingHonest);
  const nothingIds = new Set(nothingHonest.map((row) => row.id));
  const plannerFailure = rows.filter((row) => isEmpty(row.verdict) && !nothingIds.has(row.id));
  return {
    rows,
    chapters: chapterRows,
    failureGroups: {
      wrongStructureExample: {
        count: wrongStructure.length,
        topics: wrongStructure.map((row) => row.topicId),
      },
      plannerDeclinedOrInvalid: {
        count: plannerFailure.length,
        topics: plannerFailure.map((row) => row.topicId),
        topErrorCodes: sortedCounts(plannerFailure.flatMap((row) => [...new Set(row.candidateErrorCodes)])),
        missingDrawingKinds: sortedCounts(plannerFailure.map((row) => row.figureKind)),
      },
      nothingHonestToDraw: {
        count: nothingHonest.length,
        topics: nothingHonest.map((row) => row.topicId),
      },
    },
  };
}

function chapterFromTopic(topicId: string, subject: string): string {
  const parts = topicId.split("|");
  return parts.length >= 2 ? `${parts[0]}|${parts[1]}` : subject;
}

function suppressedSource(value: unknown): string | null {
  const source = record(value);
  if (typeof source.figureSource !== "string") return null;
  const family = typeof source.family === "string" ? source.family : "none";
  return `${source.figureSource}/${family}`;
}

export function readTopicCoverageRows(roundDir: string): TopicCoverageRow[] {
  const judgments = new Map(readRoundJudgments(roundDir).map((row) => [row.id, row.verdict]));
  const rows: TopicCoverageRow[] = [];
  for (const file of readdirSync(join(roundDir, "runs")).filter((name) => name.endsWith(".json")).sort()) {
    const run = record(JSON.parse(readFileSync(join(roundDir, "runs", file), "utf8")));
    const evaluation = record(run.evaluation);
    const diagram = record(run.diagram);
    const id = typeof evaluation.id === "string" ? evaluation.id : "";
    const verdict = judgments.get(id);
    if (!verdict) throw new Error(`missing judgment for topic row: ${id || file}`);
    const topicId = typeof evaluation.topic_id === "string" ? evaluation.topic_id : id.replace(/\|q\d+$/, "");
    const subject = typeof evaluation.subject === "string" ? evaluation.subject : topicId.split("|")[0] ?? "unknown";
    const emptyCause = typeof diagram.emptyCause === "string" ? diagram.emptyCause as DiagramEmptyCause : null;
    rows.push({
      id,
      topicId,
      subject,
      chapter: chapterFromTopic(topicId, subject),
      figureNeed: evaluation.figure_need === "required" || evaluation.figure_need === "optional"
        ? evaluation.figure_need
        : "none",
      figureKind: typeof evaluation.figure_kind === "string" ? evaluation.figure_kind : "unknown",
      verdict,
      emptyCause,
      candidateErrorCodes: strings(diagram.candidateErrorCodes),
      suppressedSource: suppressedSource(diagram.suppressedFallback),
    });
  }
  return rows;
}

function csv(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function writeTopicCoverageReport(roundArgument: string, sampleArgument?: string): TopicCoverageReport {
  const roundDir = resolve(roundArgument);
  const rows = readTopicCoverageRows(roundDir);
  if (sampleArgument) {
    const planned = parseDiagramEvalJsonl(readFileSync(resolve(sampleArgument), "utf8"));
    const tested = new Set(rows.map((row) => row.id));
    const plannedIds = new Set(planned.map((row) => row.id));
    if (rows.some((row) => !plannedIds.has(row.id))) throw new Error("tested row absent from original sample");
    rows.push(...planned.filter((row) => !tested.has(row.id)).map((row): TopicCoverageRow => ({
      id: row.id, topicId: row.topic_id, subject: row.subject,
      chapter: chapterFromTopic(row.topic_id, row.subject), figureNeed: row.figure_need,
      figureKind: row.figure_kind, verdict: "untested", emptyCause: null,
      candidateErrorCodes: [], suppressedSource: null,
    })));
  }
  const report = buildTopicCoverageReport(rows);
  const csvRows: Array<Array<string | number | null>> = [
    ["topic", "chapter", "verdict", "emptyCause", "candidate error codes", "suppressed source"],
    ...report.rows.map((row) => [
      row.topicId,
      row.chapter,
      row.verdict,
      row.emptyCause,
      row.candidateErrorCodes.join(" "),
      row.suppressedSource,
    ]),
  ];
  writeFileSync(join(roundDir, "topic-coverage.csv"), `${csvRows.map((row) => row.map(csv).join(",")).join("\n")}\n`);
  writeFileSync(join(roundDir, "chapter-summary.json"), `${JSON.stringify(report.chapters, null, 2)}\n`);
  writeFileSync(join(roundDir, "failure-groups.json"), `${JSON.stringify(report.failureGroups, null, 2)}\n`);
  return report;
}

if (process.argv[1]?.endsWith("topicCoverageReport.ts")) {
  const round = process.argv[2];
  if (!round) throw new Error("Usage: topicCoverageReport.ts <round>");
  const report = writeTopicCoverageReport(round, process.argv[3]);
  console.log(JSON.stringify({
    topics: report.rows.length,
    chapters: report.chapters.length,
    failureGroups: Object.fromEntries(
      Object.entries(report.failureGroups).map(([name, group]) => [name, group.count]),
    ),
  }, null, 2));
}
