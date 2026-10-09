import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anchorAgreement, type DiagramAnchor } from "./anchors";
import type { DiagramJudgment } from "./judging";

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function checkJudgeSession(
  judgmentPath: string,
  anchorPath = resolve(process.cwd(), "../../data/diagram-eval/v1/anchors.jsonl"),
) {
  if (!existsSync(anchorPath)) throw new Error(`owner anchor file not found: ${anchorPath}`);
  const result = anchorAgreement(readJsonl<DiagramAnchor>(anchorPath), readJsonl<DiagramJudgment>(judgmentPath));
  return result;
}

if (process.argv[1]?.endsWith("judge-check.ts")) {
  const judgmentPath = process.argv[2];
  if (!judgmentPath) {
    throw new Error("Usage: judge-check.ts <session-judgments.jsonl> [anchors.jsonl]");
  }
  const result = checkJudgeSession(resolve(judgmentPath), process.argv[3] ? resolve(process.argv[3]) : undefined);
  console.log(`anchor agreement: ${result.agreed}/${result.compared} (${result.agreement === null ? "n/a" : `${(result.agreement * 100).toFixed(1)}%`})`);
  console.log(`anchors: ${result.total}; missing: ${result.missing.length}`);
  console.log(`confusion: ${Object.entries(result.confusion).sort().map(([key, count]) => `${key}=${count}`).join(" ") || "none"}`);
  if (result.missing.length > 0) process.exitCode = 2;
}
