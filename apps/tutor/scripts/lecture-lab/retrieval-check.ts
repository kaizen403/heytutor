import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  compactSceneExampleDocument,
  createFallbackTurnPlanV3,
  inferSceneCapabilities,
} from "@heytutor/tutor-core";
import { detectArchetype, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  parseDiagramEvalJsonl,
  type DiagramEvalRow,
} from "./diagramEval";
import {
  diagramQuestionTokens,
  diagramQuestionsNearDuplicate,
  figureKindForDiagramGroup,
  loadDiagramExemplarLibrary,
  retrieveDiagramExemplars,
  type DiagramExemplar,
} from "./diagramExamples";

interface RetrievalInput {
  row: DiagramEvalRow;
  plan: TurnPlanV3;
  planSource: "stored_r3" | "deterministic_fallback";
}

interface LegacyDiagramExemplar {
  id: string;
  question: string;
  family: string | null;
  archetype: string | null;
  figureKind: string | null;
  document: Record<string, unknown>;
}

interface RankedExample {
  id: string;
  figureKind: string | null;
}

interface RetrievalRowResult {
  id: string;
  subject: string;
  chapter: string;
  question: string;
  figureNeed: DiagramEvalRow["figure_need"];
  expectedFigureKind: string;
  planSource: RetrievalInput["planSource"];
  beforeTop3: RankedExample[];
  afterTop3: RankedExample[];
  beforeHit: boolean;
  afterHit: boolean;
  beforeRelevantRank: number | null;
  afterRelevantRank: number | null;
}

interface RetrievalCheckOptions {
  roundDir: string;
  beforeRef: string;
  sample: number;
  seed: number;
  output: string | null;
}

const EVAL_SOURCES = [
  { ref: "eval/diagram-eval-v1-physics-maths", file: "data/diagram-eval/v1/physics.jsonl" },
  { ref: "eval/diagram-eval-v1-maths", file: "data/diagram-eval/v1/maths.jsonl" },
  { ref: "eval/diagram-eval-v1-chemistry", file: "data/diagram-eval/v1/chemistry.jsonl" },
] as const;

function stableRank(seed: number, id: string): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

function chapterKey(row: DiagramEvalRow): string {
  return `${row.subject}|${row.topic_id.split("|")[1] ?? "unknown"}`;
}

/** Deterministic round-robin sampling keeps every available subject chapter represented first. */
export function sampleDiagramRowsAcrossChapters(
  rows: readonly DiagramEvalRow[],
  count: number,
  seed: number,
  excludedIds: ReadonlySet<string> = new Set(),
): DiagramEvalRow[] {
  const groups = new Map<string, DiagramEvalRow[]>();
  for (const row of rows) {
    if (row.figure_need === "none" || excludedIds.has(row.id)) continue;
    const key = chapterKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const orderedGroups = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      rows: group.sort((left, right) =>
        stableRank(seed, left.id).localeCompare(stableRank(seed, right.id)) || left.id.localeCompare(right.id)),
    }));
  const selected: DiagramEvalRow[] = [];
  for (let offset = 0; selected.length < count; offset += 1) {
    let added = false;
    for (const group of orderedGroups) {
      const row = group.rows[offset];
      if (!row) continue;
      selected.push(row);
      added = true;
      if (selected.length === count) break;
    }
    if (!added) break;
  }
  return selected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function storedTurnPlan(value: unknown, question: string): TurnPlanV3 {
  if (!isRecord(value)) return createFallbackTurnPlanV3(question);
  const visualRequirement = ["required", "optional", "none"].includes(String(value.visualRequirement))
    ? value.visualRequirement as TurnPlanV3["visualRequirement"]
    : createFallbackTurnPlanV3(question).visualRequirement;
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens: records(value.givens) as unknown as TurnPlanV3["givens"],
    unknowns: records(value.unknowns) as unknown as TurnPlanV3["unknowns"],
    derived: records(value.derived) as unknown as TurnPlanV3["derived"],
    qualitativeClaims: records(value.qualitativeClaims).map((claim, index) => ({
      id: typeof claim.id === "string" ? claim.id : `claim-${index + 1}`,
      claim: typeof claim.claim === "string" ? claim.claim : String(claim.expected ?? "claim"),
      expected: typeof claim.expected === "boolean" || typeof claim.expected === "number" || typeof claim.expected === "string"
        ? claim.expected
        : true,
      relatedQuantityIds: Array.isArray(claim.relatedQuantityIds)
        ? claim.relatedQuantityIds.filter((item): item is string => typeof item === "string")
        : undefined,
      relatedEntityHints: Array.isArray(claim.relatedEntityHints)
        ? claim.relatedEntityHints.filter((item): item is string => typeof item === "string")
        : undefined,
    })),
    lawIds: Array.isArray(value.lawIds)
      ? value.lawIds.filter((item): item is string => typeof item === "string")
      : [],
    assumptions: Array.isArray(value.assumptions)
      ? value.assumptions.filter((item): item is string => typeof item === "string")
      : [],
    visualRequirement,
  };
}

function loadRoundInputs(roundDir: string): RetrievalInput[] {
  const runsDir = resolve(roundDir, "runs");
  return readdirSync(runsDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) => {
      const value = JSON.parse(readFileSync(resolve(runsDir, file), "utf8")) as unknown;
      if (!isRecord(value) || !isRecord(value.evaluation) || typeof value.question !== "string") return [];
      const row = parseDiagramEvalJsonl(JSON.stringify(value.evaluation))[0];
      if (!row) return [];
      return [{ row, plan: storedTurnPlan(value.plan, value.question), planSource: "stored_r3" as const }];
    });
}

function gitFile(repoRoot: string, ref: string, file: string): string {
  return execFileSync("git", ["show", `${ref}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function loadEvaluationBranches(repoRoot: string): DiagramEvalRow[] {
  return EVAL_SOURCES.flatMap(({ ref, file }) => parseDiagramEvalJsonl(gitFile(repoRoot, ref, file)));
}

function loadLegacyLibrary(source: string, evaluationQuestions: readonly string[]): LegacyDiagramExemplar[] {
  return source.split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return [];
    const value = JSON.parse(line) as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.question !== "string" || !isRecord(value.document)) return [];
    if (evaluationQuestions.some((question) => diagramQuestionsNearDuplicate(value.question as string, question))) return [];
    const family = typeof value.family === "string" ? value.family : null;
    const archetype = typeof value.archetype === "string" ? value.archetype : null;
    return [{
      id: value.id,
      question: value.question,
      family,
      archetype,
      figureKind: figureKindForDiagramGroup(family, archetype),
      document: value.document,
    }];
  });
}

function retrieveLegacyDiagramExemplars(
  exemplars: readonly LegacyDiagramExemplar[],
  question: string,
  families: readonly string[],
  archetypeId: string | null,
): LegacyDiagramExemplar[] {
  const queryTokens = new Set(diagramQuestionTokens(question));
  const familyHints = new Set(families);
  const scored = exemplars.map((exemplar) => {
    const tokens = new Set(diagramQuestionTokens(exemplar.question));
    const intersection = [...tokens].filter((token) => queryTokens.has(token)).length;
    const union = new Set([...tokens, ...queryTokens]).size;
    const lexical = intersection * 20 + (union > 0 ? intersection / union * 100 : 0);
    const family = exemplar.family && familyHints.has(exemplar.family) ? 50 : 0;
    const archetype = exemplar.archetype && exemplar.archetype === archetypeId ? 40 : 0;
    const promptChars = JSON.stringify(compactSceneExampleDocument(exemplar.document)).length;
    return { exemplar, score: lexical + family + archetype, promptChars };
  });
  const ordered = scored.sort((left, right) =>
    right.score - left.score || left.promptChars - right.promptChars || left.exemplar.id.localeCompare(right.exemplar.id));
  return [
    ...ordered.filter((entry) => entry.promptChars <= 4_000),
    ...ordered.filter((entry) => entry.promptChars > 4_000),
  ].map(({ exemplar }) => exemplar);
}

function rankedExamples(exemplars: readonly { id: string; figureKind: string | null }[]): RankedExample[] {
  return exemplars.slice(0, 3).map(({ id, figureKind }) => ({ id, figureKind }));
}

function relevantRank(exemplars: readonly { figureKind: string | null }[], expected: string): number | null {
  const index = exemplars.findIndex((example) => example.figureKind === expected);
  return index >= 0 ? index + 1 : null;
}

function retrievalHints(input: RetrievalInput): { families: readonly string[]; archetypeId: string | null } {
  const capabilities = inferSceneCapabilities(input.row.question, {
    lawIds: input.plan.lawIds,
    problemIR: null,
    turnPlan: input.plan,
  });
  const archetype = detectArchetype(input.row.question, { turnPlan: input.plan, problemIR: null });
  return { families: capabilities.families, archetypeId: archetype?.id ?? null };
}

function scoreInput(
  input: RetrievalInput,
  beforeLibrary: readonly LegacyDiagramExemplar[],
  afterLibrary: readonly DiagramExemplar[],
): RetrievalRowResult {
  const hints = retrievalHints(input);
  const before = retrieveLegacyDiagramExemplars(
    beforeLibrary,
    input.row.question,
    hints.families,
    hints.archetypeId,
  );
  const after = retrieveDiagramExemplars(afterLibrary, {
    question: input.row.question,
    families: hints.families,
    archetypeId: hints.archetypeId,
    plan: input.plan,
    limit: afterLibrary.length,
  });
  const beforeTop3 = rankedExamples(before);
  const afterTop3 = rankedExamples(after);
  return {
    id: input.row.id,
    subject: input.row.subject,
    chapter: chapterKey(input.row),
    question: input.row.question,
    figureNeed: input.row.figure_need,
    expectedFigureKind: input.row.figure_kind,
    planSource: input.planSource,
    beforeTop3,
    afterTop3,
    beforeHit: beforeTop3.some((example) => example.figureKind === input.row.figure_kind),
    afterHit: afterTop3.some((example) => example.figureKind === input.row.figure_kind),
    beforeRelevantRank: relevantRank(before, input.row.figure_kind),
    afterRelevantRank: relevantRank(after, input.row.figure_kind),
  };
}

function rate(rows: readonly RetrievalRowResult[], field: "beforeHit" | "afterHit") {
  const hits = rows.filter((row) => row[field]).length;
  return { hits, denominator: rows.length, hitRate: rows.length > 0 ? hits / rows.length : 0 };
}

function parseOptions(argv: readonly string[]): RetrievalCheckOptions {
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] ?? null : null;
  };
  const roundDir = value("--round");
  const beforeRef = value("--before-ref");
  if (!roundDir || !beforeRef) {
    throw new Error("usage: retrieval-check.ts --round <r3-round> --before-ref <commit> [--sample 100] [--seed 20261009] [--out report.json]");
  }
  return {
    roundDir: resolve(roundDir),
    beforeRef,
    sample: Number(value("--sample") ?? 100),
    seed: Number(value("--seed") ?? 20261009),
    output: value("--out") ? resolve(value("--out")!) : null,
  };
}

export function runRetrievalCheck(repoRoot: string, options: RetrievalCheckOptions) {
  const roundInputs = loadRoundInputs(options.roundDir);
  const roundIds = new Set(roundInputs.map((input) => input.row.id));
  const sampledRows = sampleDiagramRowsAcrossChapters(
    loadEvaluationBranches(repoRoot),
    options.sample,
    options.seed,
    roundIds,
  );
  const inputs: RetrievalInput[] = [
    ...roundInputs,
    ...sampledRows.map((row) => ({
      row,
      plan: createFallbackTurnPlanV3(row.question),
      planSource: "deterministic_fallback" as const,
    })),
  ].filter((input) => input.row.figure_need !== "none");
  const evaluationQuestions = inputs.map((input) => input.row.question);
  const beforeLibrary = loadLegacyLibrary(
    gitFile(repoRoot, options.beforeRef, "data/diagram-eval/v1/exemplars/_library.jsonl"),
    evaluationQuestions,
  );
  const afterLibrary = loadDiagramExemplarLibrary(
    resolve(repoRoot, "data/diagram-eval/v1/exemplars/_library.jsonl"),
    evaluationQuestions,
  );
  const rows = inputs.map((input) => scoreInput(input, beforeLibrary, afterLibrary));
  const before = rate(rows, "beforeHit");
  const after = rate(rows, "afterHit");
  const worstMisses = rows.filter((row) => !row.afterHit).sort((left, right) => {
    const leftRank = left.afterRelevantRank ?? Number.POSITIVE_INFINITY;
    const rightRank = right.afterRelevantRank ?? Number.POSITIVE_INFINITY;
    return rightRank - leftRank || left.id.localeCompare(right.id);
  }).slice(0, 10);
  const report = {
    schemaVersion: "diagram-example-retrieval-check/v1",
    beforeRef: options.beforeRef,
    seed: options.seed,
    targetHitRate: 0.7,
    targetMet: after.hitRate >= 0.7,
    sample: {
      roundRows: roundInputs.length,
      branchRows: sampledRows.length,
      scoredFigureRows: rows.length,
      chapters: new Set(sampledRows.map(chapterKey)).size,
    },
    libraries: { before: beforeLibrary.length, after: afterLibrary.length },
    before,
    after,
    worstMisses,
    rows,
  };
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1]?.endsWith("retrieval-check.ts")) {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = resolve(process.cwd(), "../..");
  const report = runRetrievalCheck(repoRoot, options);
  console.log(JSON.stringify({
    before: report.before,
    after: report.after,
    targetMet: report.targetMet,
    sample: report.sample,
    worstMisses: report.worstMisses,
    output: options.output,
  }, null, 2));
}
