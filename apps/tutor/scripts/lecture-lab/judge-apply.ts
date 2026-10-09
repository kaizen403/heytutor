import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeRoundGallery } from "./gallery";
import {
  buildJudgeSummary,
  readJudgeQueue,
  readRoundJudgments,
  resolveRoundDir,
} from "./judging";

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function applyJudgments(roundArgument: string) {
  const roundDir = resolveRoundDir(roundArgument);
  const judgments = readRoundJudgments(roundDir);
  const queue = readJudgeQueue(roundDir);
  const ids = new Set<string>();
  const runIds = new Set(readdirSync(join(roundDir, "runs")).filter((file) => file.endsWith(".json")).map((file) => {
    const run = JSON.parse(readFileSync(join(roundDir, "runs", file), "utf8"));
    return String(run.evaluation?.id ?? run.probeId ?? file.replace(/\.json$/, ""));
  }));
  for (const judgment of judgments) {
    if (ids.has(judgment.id)) throw new Error(`duplicate judgment: ${judgment.id}`);
    if (!runIds.has(judgment.id)) throw new Error(`foreign judgment not in round: ${judgment.id}`);
    ids.add(judgment.id);
  }
  for (const row of queue) if (!runIds.has(row.id)) throw new Error(`foreign queue row: ${row.id}`);
  const missing = [...runIds].filter((id) => !ids.has(id));
  if (missing.length > 0) throw new Error(`missing round judgments: ${missing.join(", ")}`);

  const missingLabelsById = new Map(queue.map((row) => [row.id, row.missing_labels]));
  const judge = buildJudgeSummary(judgments, missingLabelsById);
  const verdictRows = [
    ["row id", "verdict", "comment"],
    ...judgments.map((judgment) => [judgment.id, judgment.verdict, judgment.reason]),
  ];
  writeFileSync(
    join(roundDir, "verdicts.csv"),
    `${verdictRows.map((row) => row.map(csv).join(",")).join("\n")}\n`,
  );

  const summaryPath = join(roundDir, "summary.json");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, unknown>;
  summary.judge = judge;
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 1)}\n`);
  const gallery = writeRoundGallery(roundDir);
  return { roundDir, gallery, ...judge };
}

if (process.argv[1]?.endsWith("judge-apply.ts")) {
  const round = process.argv[2];
  if (!round) throw new Error("Usage: judge-apply.ts <round>");
  console.log(JSON.stringify(applyJudgments(round), null, 2));
}
