import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  findMissingDiagramLabels,
  resolveRoundDir,
  ruleJudgmentForNoFigure,
  type DiagramJudgment,
  type FigureNeed,
  type JudgeQueueRow,
} from "./judging";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function clearJsonlFiles(directory: string): void {
  mkdirSync(directory, { recursive: true });
  for (const file of readdirSync(directory)) {
    if (file.endsWith(".jsonl")) unlinkSync(join(directory, file));
  }
}

function clearPngFiles(directory: string): void {
  mkdirSync(directory, { recursive: true });
  for (const file of readdirSync(directory)) {
    if (file.endsWith(".png")) unlinkSync(join(directory, file));
  }
}

function writeJsonl(path: string, rows: readonly unknown[]): void {
  writeFileSync(path, rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "");
}

function cropDiagramZone(source: string, destination: string): void {
  execFileSync("/usr/bin/sips", [
    "--cropToHeightWidth", "700", "760",
    "--cropOffset", "0", "400",
    source,
    "--out", destination,
  ], { stdio: "ignore" });
  execFileSync("/usr/bin/sips", ["--resampleWidth", "700", destination], { stdio: "ignore" });
}

export function prepareJudgingRound(roundArgument: string): {
  roundDir: string;
  ruleDecided: number;
  queued: number;
  batches: number;
} {
  const roundDir = resolveRoundDir(roundArgument);
  const runsDir = join(roundDir, "runs");
  const cropDir = join(roundDir, "judge-crops");
  const batchDir = join(roundDir, "judge-batches");
  clearPngFiles(cropDir);
  clearJsonlFiles(batchDir);

  const judgments: DiagramJudgment[] = [];
  const queue: JudgeQueueRow[] = [];
  for (const file of readdirSync(runsDir).filter((name) => name.endsWith(".json")).sort()) {
    const run = record(JSON.parse(readFileSync(join(runsDir, file), "utf8")));
    const evaluation = record(run.evaluation);
    const diagram = record(run.diagram);
    const id = typeof evaluation.id === "string" ? evaluation.id : file.replace(/\.json$/, "");
    const figureNeed = evaluation.figure_need as FigureNeed;
    const png = typeof diagram.png === "string" ? diagram.png : null;
    const drawn = diagram.committed === true && png !== null;
    if (!drawn) {
      judgments.push(ruleJudgmentForNoFigure(figureNeed, id));
      continue;
    }

    const source = resolve(roundDir, png);
    const destination = join(cropDir, basename(png));
    cropDiagramZone(source, destination);
    queue.push({
      id,
      cropped_png: destination,
      question: typeof evaluation.question === "string" ? evaluation.question : "",
      figure_need: figureNeed,
      must_show: strings(evaluation.must_show),
      must_not_show: strings(evaluation.must_not_show),
      missing_labels: findMissingDiagramLabels(
        strings(evaluation.must_label),
        strings(diagram.renderedLabels),
      ),
    });
  }

  writeJsonl(join(roundDir, "judgments.jsonl"), judgments);
  writeJsonl(join(roundDir, "judge-queue.jsonl"), queue);
  for (let index = 0; index < queue.length; index += 10) {
    const batchNumber = Math.floor(index / 10) + 1;
    writeJsonl(
      join(batchDir, `batch-${String(batchNumber).padStart(3, "0")}.jsonl`),
      queue.slice(index, index + 10),
    );
  }
  return {
    roundDir,
    ruleDecided: judgments.length,
    queued: queue.length,
    batches: Math.ceil(queue.length / 10),
  };
}

if (process.argv[1]?.endsWith("judge-prep.ts")) {
  const round = process.argv[2];
  if (!round) throw new Error("Usage: judge-prep.ts <round>");
  console.log(JSON.stringify(prepareJudgingRound(round), null, 2));
}
