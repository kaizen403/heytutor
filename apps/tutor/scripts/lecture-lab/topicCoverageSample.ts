import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDiagramEvalJsonl, type DiagramEvalRow } from "./diagramEval";
import { diagramQuestionsNearDuplicate } from "./diagramExamples";

const TOPIC_SOURCES = [
  {
    subject: "physics",
    ref: "origin/eval/diagram-eval-v1-physics-maths",
    file: "data/diagram-eval/v1/physics.jsonl",
    expectedTopics: 324,
  },
  {
    subject: "maths",
    ref: "origin/eval/diagram-eval-v1-maths",
    file: "data/diagram-eval/v1/maths.jsonl",
    expectedTopics: 95,
  },
] as const;

export interface TopicCoverageManifest {
  schemaVersion: "diagram-topic-coverage/v1";
  seed: number;
  totalRows: number;
  subjectTopics: Record<string, number>;
  leakExcludedRows: number;
  ids: string[];
  sourceRefs?: Record<string, string>;
}

function stableRank(seed: number, id: string): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

function studentStyle(row: DiagramEvalRow): boolean {
  return row.ask_style === "topic_ask" || row.ask_style?.includes("vague") === true;
}

function preferredRows(left: DiagramEvalRow, right: DiagramEvalRow, seed: number): number {
  return Number(right.figure_need === "required") - Number(left.figure_need === "required") ||
    Number(studentStyle(right)) - Number(studentStyle(left)) ||
    Number(right.ask_style === "exam_stem") - Number(left.ask_style === "exam_stem") ||
    stableRank(seed, left.id).localeCompare(stableRank(seed, right.id)) ||
    left.id.localeCompare(right.id);
}

/** One leak-free visual row per physics/maths topic, with fixed preference order. */
export function sampleDiagramTopicCoverageRows(
  sourceRows: readonly DiagramEvalRow[],
  exemplarQuestions: readonly string[],
  seed: number,
): { rows: DiagramEvalRow[]; manifest: TopicCoverageManifest } {
  const eligible = sourceRows.filter((row) =>
    (row.subject === "physics" || row.subject === "maths") && row.figure_need !== "none");
  const leakIds = new Set(eligible.filter((row) =>
    exemplarQuestions.some((question) => diagramQuestionsNearDuplicate(row.question, question)))
    .map((row) => row.id));
  const groups = new Map<string, DiagramEvalRow[]>();
  for (const row of eligible) {
    if (leakIds.has(row.id)) continue;
    const group = groups.get(row.topic_id) ?? [];
    group.push(row);
    groups.set(row.topic_id, group);
  }
  const allTopics = new Set(eligible.map((row) => row.topic_id));
  const missingTopics = [...allTopics].filter((topic) => !groups.has(topic));
  if (missingTopics.length > 0) {
    throw new Error(`${missingTopics.length} topics have no row after the example-library leak guard`);
  }
  const rows = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, candidates]) => [...candidates].sort((left, right) => preferredRows(left, right, seed))[0]!);
  const subjectTopics = Object.fromEntries(
    ["maths", "physics"].flatMap((subject) => {
      const count = rows.filter((row) => row.subject === subject).length;
      return count > 0 ? [[subject, count] as const] : [];
    }),
  );
  return {
    rows,
    manifest: {
      schemaVersion: "diagram-topic-coverage/v1",
      seed,
      totalRows: rows.length,
      subjectTopics,
      leakExcludedRows: leakIds.size,
      ids: rows.map((row) => row.id),
    },
  };
}

function gitFile(repoRoot: string, ref: string, file: string): string {
  return execFileSync("git", ["show", `${ref}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function cliValue(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

if (process.argv[1]?.endsWith("topicCoverageSample.ts")) {
  const argv = process.argv.slice(2);
  const outputPath = cliValue(argv, "--out");
  if (!outputPath) throw new Error("usage: topicCoverageSample.ts --out <round-dir> [--seed 20261009]");
  const seed = Number(cliValue(argv, "--seed") ?? 20261009);
  if (!Number.isSafeInteger(seed)) throw new Error("--seed must be an integer");
  const repoRoot = resolve(process.cwd(), "../..");
  const sourceRows = TOPIC_SOURCES.flatMap(({ ref, file }) =>
    parseDiagramEvalJsonl(gitFile(repoRoot, ref, file)));
  const libraryPath = resolve(repoRoot, "data/diagram-eval/v1/exemplars/_library.jsonl");
  const exemplarQuestions = readFileSync(libraryPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line) => {
      const value = JSON.parse(line) as { question?: unknown };
      return typeof value.question === "string" ? [value.question] : [];
    });
  const sample = sampleDiagramTopicCoverageRows(sourceRows, exemplarQuestions, seed);
  const sourceRefs = Object.fromEntries(TOPIC_SOURCES.map(({ subject, ref }) => [
    subject,
    execFileSync("git", ["rev-parse", ref], { cwd: repoRoot, encoding: "utf8" }).trim(),
  ]));
  for (const source of TOPIC_SOURCES) {
    if (sample.manifest.subjectTopics[source.subject] !== source.expectedTopics) {
      throw new Error(
        `${source.subject} topic count is ${sample.manifest.subjectTopics[source.subject] ?? 0}; expected ${source.expectedTopics}`,
      );
    }
  }
  const out = resolve(outputPath);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "sample.jsonl"), `${sample.rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  writeFileSync(resolve(out, "sample-ids.txt"), `${sample.manifest.ids.join("\n")}\n`);
  writeFileSync(resolve(out, "sample-manifest.json"), `${JSON.stringify({
    ...sample.manifest,
    sourceRefs,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ ...sample.manifest, sourceRefs }, null, 2));
}
