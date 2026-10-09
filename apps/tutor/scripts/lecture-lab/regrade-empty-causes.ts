import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SCENE_PLANNER_DEADLINE_MS } from "@/features/tutor-session/lib/scene/diagramGeneration";
import {
  classifyDiagramEmptyCause,
  supplementCandidateErrorCodes,
  summarizeDiagramFailures,
  type DiagramEmptyCause,
} from "./diagramEval";
import { writeRoundGallery } from "./gallery";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Reclassifies old and new run records without issuing any model request. */
export function correctedEmptyCauseForStoredRun(value: unknown): DiagramEmptyCause | null {
  const run = record(value);
  const diagram = record(run.diagram);
  const plan = record(run.plan);
  const timings = record(run.timings);
  const stages = record(timings.stages);
  const visualRequirement = ["required", "optional", "none"].includes(String(plan.visualRequirement))
    ? plan.visualRequirement as "required" | "optional" | "none"
    : "required";
  const candidateErrorCodes = strings(diagram.candidateErrorCodes);
  const deadlineRemainingMs = typeof stages.deadlineRemainingMs === "number"
    ? stages.deadlineRemainingMs
    : Math.max(0, SCENE_PLANNER_DEADLINE_MS - number(timings.planMs));

  const candidateCount = typeof diagram.candidateCount === "number"
    ? diagram.candidateCount
    : candidateErrorCodes.length > 0 ? 1 : 0;
  const supplementedCodes = supplementCandidateErrorCodes({
    committed: diagram.committed === true,
    visualRequirement,
    primitiveCount: number(diagram.primitiveCount),
    candidateCount,
    candidateErrorCodes,
  });
  diagram.candidateErrorCodes = supplementedCodes;
  return classifyDiagramEmptyCause({
    committed: diagram.committed === true,
    visualRequirement,
    declinedUnreadable: diagram.declinedUnreadable === true,
    primitiveCount: number(diagram.primitiveCount),
    plannerCalls: number(stages.plannerCalls),
    deadlineRemainingMs,
    candidateCount,
    candidateErrorCodes: supplementedCodes,
    fallbackSuppressed: Object.keys(record(diagram.suppressedFallback)).length > 0,
  });
}

export function regradeEmptyCauses(roundDir: string): {
  roundDir: string;
  emptyCauseCounts: Record<string, number>;
  candidateErrorCodeCounts: Record<string, number>;
} {
  const absolute = resolve(roundDir);
  const runsDir = join(absolute, "runs");
  const diagrams: Array<{ emptyCause: DiagramEmptyCause | null; candidateErrorCodes: string[] }> = [];

  for (const file of readdirSync(runsDir).filter((name) => name.endsWith(".json")).sort()) {
    const path = join(runsDir, file);
    const run = record(JSON.parse(readFileSync(path, "utf8")));
    const diagram = record(run.diagram);
    const emptyCause = correctedEmptyCauseForStoredRun(run);
    diagram.emptyCause = emptyCause;
    run.diagram = diagram;
    diagrams.push({ emptyCause, candidateErrorCodes: strings(diagram.candidateErrorCodes) });
    writeFileSync(path, `${JSON.stringify(run, null, 1)}\n`);
  }

  const counts = summarizeDiagramFailures(diagrams);
  const summaryPath = join(absolute, "summary.json");
  const summary = record(JSON.parse(readFileSync(summaryPath, "utf8")));
  summary.evaluation = {
    ...record(summary.evaluation),
    ...counts,
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 1)}\n`);
  writeRoundGallery(absolute);
  return { roundDir: absolute, ...counts };
}

if (process.argv[1]?.endsWith("regrade-empty-causes.ts")) {
  const rounds = process.argv.slice(2);
  if (rounds.length === 0) throw new Error("Usage: regrade-empty-causes.ts <round dir> [...round dirs]");
  for (const round of rounds) console.log(JSON.stringify(regradeEmptyCauses(round), null, 2));
}
