import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type FigureNeed = "required" | "optional" | "none";
export type DiagramVerdict = "right" | "partial" | "wrong" | "empty_ok" | "empty_bad";

export interface DiagramJudgment {
  id: string;
  verdict: DiagramVerdict;
  missing: string[];
  wrong_items: string[];
  confidence: number;
  reason: string;
  by: string;
}

export interface JudgeQueueRow {
  id: string;
  cropped_png: string;
  question: string;
  figure_need: FigureNeed;
  must_show: string[];
  must_not_show: string[];
  missing_labels: string[];
}

export interface JudgeSummary {
  ruleDecided: number;
  subagentJudged: number;
  counts: Record<string, number>;
  needsHuman: number;
}

export function normalizeDiagramLabel(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[Ωω]/g, "ohm")
    .replace(/ohms?/gi, "ohm")
    .replace(/[×✕✖]/g, "x")
    .replace(/[−–—﹣－]/g, "-")
    .replaceAll("^", "")
    .replace(/\s+/g, "");
}

export function findMissingDiagramLabels(
  required: readonly string[],
  rendered: readonly string[],
): string[] {
  const available = new Set(rendered.map(normalizeDiagramLabel));
  return required.filter((label) => !available.has(normalizeDiagramLabel(label)));
}

export function ruleJudgmentForNoFigure(
  figureNeed: FigureNeed,
  id = "",
): DiagramJudgment {
  const acceptable = figureNeed !== "required";
  return {
    id,
    verdict: acceptable ? "empty_ok" : "empty_bad",
    missing: [],
    wrong_items: [],
    confidence: 1,
    reason: acceptable ? "No figure required." : "Required figure is absent.",
    by: "rule",
  };
}

export function needsHumanReview(
  judgment: DiagramJudgment,
  missingLabels: readonly string[],
): boolean {
  return judgment.confidence < 0.7 ||
    (judgment.verdict === "right" && missingLabels.length > 0);
}

export function buildJudgeSummary(
  judgments: readonly DiagramJudgment[],
  missingLabelsById: ReadonlyMap<string, readonly string[]>,
): JudgeSummary {
  const counts: Record<string, number> = {};
  let ruleDecided = 0;
  let subagentJudged = 0;
  let needsHuman = 0;
  for (const judgment of judgments) {
    counts[judgment.verdict] = (counts[judgment.verdict] ?? 0) + 1;
    if (judgment.by === "rule") ruleDecided += 1;
    else subagentJudged += 1;
    if (needsHumanReview(judgment, missingLabelsById.get(judgment.id) ?? [])) {
      needsHuman += 1;
    }
  }
  return { ruleDecided, subagentJudged, counts, needsHuman };
}

export function resolveRoundDir(argument: string, cwd = process.cwd()): string {
  const direct = resolve(cwd, argument);
  if (existsSync(direct)) return direct;
  const labRound = resolve(cwd, ".lecture-lab", argument);
  if (existsSync(labRound)) return labRound;
  throw new Error(`round not found: ${argument}`);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function readRoundJudgments(roundDir: string): DiagramJudgment[] {
  return readJsonl<unknown>(resolve(roundDir, "judgments.jsonl")).map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`judgment line ${index + 1} is not an object`);
    }
    const row = value as Record<string, unknown>;
    const verdicts = new Set<DiagramVerdict>(["right", "partial", "wrong", "empty_ok", "empty_bad"]);
    const textArray = (entry: unknown): entry is string[] =>
      Array.isArray(entry) && entry.every((item) => typeof item === "string");
    const wordCount = typeof row.reason === "string"
      ? row.reason.trim().split(/\s+/).filter(Boolean).length
      : Number.POSITIVE_INFINITY;
    if (
      typeof row.id !== "string" ||
      !verdicts.has(row.verdict as DiagramVerdict) ||
      !textArray(row.missing) ||
      !textArray(row.wrong_items) ||
      typeof row.confidence !== "number" ||
      row.confidence < 0 ||
      row.confidence > 1 ||
      typeof row.reason !== "string" ||
      wordCount > 20 ||
      typeof row.by !== "string"
    ) {
      throw new Error(`judgment line ${index + 1} has an invalid schema`);
    }
    return row as unknown as DiagramJudgment;
  });
}

export function readJudgeQueue(roundDir: string): JudgeQueueRow[] {
  return readJsonl<JudgeQueueRow>(resolve(roundDir, "judge-queue.jsonl"));
}

export function formatJudgeCounts(summary: JudgeSummary | undefined): string {
  if (!summary) return "not judged";
  const counts = Object.entries(summary.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([verdict, count]) => `${verdict}=${count}`)
    .join(" ");
  return `${counts || "none"}; human=${summary.needsHuman}`;
}
