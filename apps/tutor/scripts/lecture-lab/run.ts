/**
 * Lecture lab batch runner.
 *
 * Usage (dev server must be up, AUTH_DISABLED=1, LECTURE_LAB_TOKEN set on
 * both the server and this process):
 *   pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/run.ts \
 *     --difficulty hard --per-unit 1 --concurrency 3 --max-usd 5 --out .lecture-lab/run-01
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseProbeFile, type ProbeQuestion } from "@/features/admin/lib/probes";
import { unitIdFromTopicId } from "@/features/admin/lib/probes";
import { gradeLecture, type LectureGrade } from "./grade";
import { printSummary, summarize } from "./summarize";
import { runLecture, type LectureRun } from "./lecturePipeline";
import { applyLectureLabHeaders } from "./labAuth";
import {
  LECTURE_LAB_STANDARD_MODEL_HEADER,
  LECTURE_LAB_ZERO_RETENTION_HEADER,
} from "../../lib/billing/flags";
import { parseDiagramSubject, type SubjectFamiliarity } from "@heytutor/tutor-core";
import {
  assertEvaluationCostAllowed,
  assertUniqueArtifactIds,
  labArtifactSlug,
  assertRoundPlannerStarted,
  combineDiagramEvalRows,
  evaluationRunFastMode,
  estimateEvaluationCostUsd,
  evaluationUsesExamples,
  evaluationUsesStandardModelHeader,
  estimateLabCallWorstCaseUsd,
  parseDiagramEvalJsonl,
  PlannerUsageTracker,
  sampleDiagramEvalRows,
  summarizeDiagramFailures,
  type DiagramEvalArm,
  type DiagramEvalModel,
  type DiagramEvalRow,
} from "./diagramEval";
import { writeRoundGallery } from "./gallery";
import { readRoundJudgments } from "./judging";
import {
  buildDiagramExampleCatalogue,
  loadDiagramExemplarLibrary,
} from "./diagramExamples";
import {
  resolveFireworksModel,
  resolveTeachingFireworksModel,
} from "../../lib/llm/fireworksModels";
import { completionTokenCap, providerChatBody, resolveLlmEndpoint } from "../../lib/llm/llmProvider";
import { parseProviderUsage } from "../../lib/obs/providerUsage";
import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import type { SceneDeclinePolicy } from "./sceneDeclineExperiment";

export interface Options {
  difficulty: string;
  units: number[] | null;
  subjects: string[];
  perUnit: number | null;
  limit: number | null;
  concurrency: number;
  out: string;
  origin: string;
  familiarity: SubjectFamiliarity;
  narrationLanguage: "english" | "hinglish";
  only: string[] | null;
  seed: number;
  /**
   * A file of ad-hoc questions, one per line, replayed instead of the probe
   * bank. The bank is written by us; the lessons that go wrong are the ones a
   * student typed, and until this existed there was no way to put one of those
   * through the lab.
   */
  ask: string | null;
  evalFiles: string[];
  sample: number | null;
  topics: string[] | null;
  arm: DiagramEvalArm;
  model: DiagramEvalModel;
  /** Evaluation-only end-to-end scene planning budget. */
  scenePlannerLimitMs: 60_000 | 120_000;
  figureOnly: boolean;
  yes: boolean;
  maxUsd: number;
  resume: boolean;
  /** Conservative allowance for an interrupted pre-checkpoint run. */
  resumeExtraUsd: number;
  sceneDeclinePolicy: SceneDeclinePolicy;
  exampleExclusions: string | null;
}

export interface LabSpendSummary {
  maxUsd: number;
  chargedUsd: number;
  reservedUsd: number;
  stoppedForBudget: boolean;
  rowsDone: number;
  rowsPlanned: number;
}

/** Reserve each paid request before sending; unknown usage consumes its reservation. */
export class LabSpendCap {
  private chargedUsd = 0;
  private reservedUsd = 0;
  private stoppedForBudget = false;

  constructor(readonly maxUsd: number) {
    if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
      throw new Error("--max-usd must be a positive number");
    }
  }

  recordCost(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.chargedUsd += usd;
    if (this.chargedUsd >= this.maxUsd) this.stoppedForBudget = true;
  }

  reserveCall(worstCaseUsd: number): boolean {
    if (!Number.isFinite(worstCaseUsd) || worstCaseUsd <= 0) {
      throw new Error("paid lab calls require a positive cost ceiling");
    }
    if (this.stoppedForBudget || this.chargedUsd + this.reservedUsd + worstCaseUsd > this.maxUsd + 1e-9) {
      this.stoppedForBudget = true;
      return false;
    }
    this.reservedUsd += worstCaseUsd;
    return true;
  }

  settleCall(reservedUsd: number, chargedUsd: number): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedUsd);
    this.recordCost(chargedUsd);
  }

  canStartRow(): boolean {
    return !this.stoppedForBudget;
  }

  summary(rowsDone: number, rowsPlanned: number): LabSpendSummary {
    return {
      maxUsd: this.maxUsd,
      chargedUsd: Math.round(this.chargedUsd * 1_000_000) / 1_000_000,
      reservedUsd: Math.round(this.reservedUsd * 1_000_000) / 1_000_000,
      stoppedForBudget: this.stoppedForBudget,
      rowsDone,
      rowsPlanned,
    };
  }
}

export async function runBudgetedLabRows<T>(
  rows: readonly T[],
  concurrency: number,
  spendCap: LabSpendCap,
  runRow: (row: T, index: number) => Promise<void>,
): Promise<number> {
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (!spendCap.canStartRow()) return;
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) return;
      await runRow(rows[index]!, index);
      done += 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );
  return done;
}

export function parseOptions(argv: string[]): Options {
  const flags = new Map<string, string>();
  const evalFiles: string[] = [];
  const booleans = new Set(["figure-only", "yes", "resume"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      const name = token.slice(2, eq);
      const value = token.slice(eq + 1);
      if (name === "eval") evalFiles.push(value);
      else flags.set(name, value);
    } else {
      const name = token.slice(2);
      const next = argv[index + 1];
      if (name === "eval") {
        if (!next || next.startsWith("--")) throw new Error("--eval needs a JSONL file");
        evalFiles.push(next);
        index += 1;
        continue;
      }
      if (booleans.has(name) || !next || next.startsWith("--")) {
        flags.set(name, "true");
      } else {
        flags.set(name, next);
        index += 1;
      }
    }
  }
  const list = (name: string): string[] | null => {
    const raw = flags.get(name);
    return raw ? raw.split(",").map((entry) => entry.trim()).filter(Boolean) : null;
  };
  const number = (name: string, fallback: number | null): number | null => {
    const raw = flags.get(name);
    if (raw === undefined || raw === "") return fallback;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
  };
  const arm = flags.get("arm") ?? "current";
  if (
    arm !== "current" &&
    arm !== "planner_first" &&
    arm !== "planner_examples" &&
    arm !== "planner_examples_strict"
  ) {
    throw new Error(
      `--arm must be current, planner_first, planner_examples or planner_examples_strict, received ${arm}`,
    );
  }
  const model = flags.get("model") ?? "configured";
  if (model !== "configured" && model !== "standard" && model !== "fast") {
    throw new Error(`--model must be configured, standard or fast, received ${model}`);
  }
  if (evalFiles.length > 0 && model === "fast") {
    throw new Error("evaluation rounds require the configured provider (--model configured)");
  }
  const scenePlannerLimitRaw = flags.get("scene-planner-limit-ms");
  if (scenePlannerLimitRaw !== undefined && evalFiles.length === 0) {
    throw new Error("--scene-planner-limit-ms is evaluation-only");
  }
  const parsedScenePlannerLimit = scenePlannerLimitRaw === undefined
    ? 60_000
    : Number(scenePlannerLimitRaw);
  if (parsedScenePlannerLimit !== 60_000 && parsedScenePlannerLimit !== 120_000) {
    throw new Error("--scene-planner-limit-ms must be 60000 or 120000");
  }
  const maxUsdRaw = flags.get("max-usd");
  const sceneDeclinePolicy = flags.get("scene-decline-policy") ?? "unchanged";
  if (sceneDeclinePolicy !== "unchanged" && sceneDeclinePolicy !== "qualitative_setup_v1") {
    throw new Error("--scene-decline-policy must be unchanged or qualitative_setup_v1");
  }
  if (flags.has("scene-decline-policy") && evalFiles.length === 0) throw new Error("--scene-decline-policy is evaluation-only");
  if (flags.has("example-exclusions") && evalFiles.length === 0) throw new Error("--example-exclusions is evaluation-only");
  if (maxUsdRaw === undefined) {
    throw new Error("paid lecture-lab runs require --max-usd <positive dollars>");
  }
  const maxUsd = Number.parseFloat(maxUsdRaw);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("--max-usd must be a positive number");
  }
  const resume = flags.get("resume") === "true";
  const resumeExtraUsd = Number(flags.get("resume-extra-usd") ?? 0);
  if (!Number.isFinite(resumeExtraUsd) || resumeExtraUsd < 0) throw new Error("--resume-extra-usd must be nonnegative");
  if (flags.has("resume-extra-usd") && !resume) throw new Error("--resume-extra-usd requires --resume");
  return {
    difficulty: flags.get("difficulty") ?? "hard",
    units: list("units")?.map((entry) => Number.parseInt(entry, 10)) ?? null,
    subjects: list("subjects") ?? ["physics"],
    perUnit: number("per-unit", null),
    limit: number("limit", null),
    concurrency: number("concurrency", 3) ?? 3,
    out: flags.get("out") ?? `.lecture-lab/run-${Date.now()}`,
    origin: flags.get("origin") ?? "http://127.0.0.1:3000",
    familiarity: (flags.get("familiarity") as SubjectFamiliarity) ?? "normal",
    narrationLanguage: flags.get("narration") === "hinglish" ? "hinglish" : "english",
    only: list("only"),
    seed: number("seed", 1) ?? 1,
    ask: flags.get("ask") ?? null,
    evalFiles,
    sample: number("sample", null),
    topics: list("topics"),
    arm,
    model,
    scenePlannerLimitMs: parsedScenePlannerLimit,
    figureOnly: flags.has("figure-only") ? flags.get("figure-only") !== "false" : evalFiles.length > 0,
    yes: flags.get("yes") === "true",
    maxUsd,
    resume,
    resumeExtraUsd,
    sceneDeclinePolicy,
    exampleExclusions: flags.get("example-exclusions") ?? null,
  };
}

/** Keep the full original evaluation for retrieval exclusions; skip only execution. */
export function selectResumeProbes<T extends { id: string; question: string }>(
  probes: readonly T[],
  saved: readonly { probeId: string; question: string; evaluation?: { question: string } | null; arm?: string; providerConfig?: { provider: string; deployment?: string }; executionConfig?: Record<string, unknown> }[],
  arm: string,
  provider: { provider: string; deployment?: string },
  executionConfig?: Record<string, unknown>,
): T[] {
  const byId = new Map(probes.map((probe) => [probe.id, probe]));
  const done = new Set<string>();
  for (const row of saved) {
    if (done.has(row.probeId) || byId.get(row.probeId)?.question !== (row.evaluation?.question ?? row.question) || row.arm !== arm ||
      row.providerConfig?.provider !== provider.provider || row.providerConfig?.deployment !== provider.deployment ||
      (executionConfig && JSON.stringify(row.executionConfig) !== JSON.stringify(executionConfig))) {
      throw new Error(`incompatible saved row for resume: ${row.probeId}`);
    }
    done.add(row.probeId);
  }
  return probes.filter((probe) => !done.has(probe.id));
}

export function labSampleFingerprint(rows: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function assertLabOutputReusable(checkpointExists: boolean, savedRows: number, resume: boolean): void {
  if (!resume && (checkpointExists || savedRows > 0)) throw new Error("output already has paid evidence; use --resume");
  if (resume && !checkpointExists) throw new Error("resume requires a spend checkpoint with proven execution identity");
}

export function restoredLabCharge(
  storedRowUsd: number,
  checkpoint: { chargedUsd: number; reservedUsd: number } | null,
  extraUsd: number,
): number {
  const values = [storedRowUsd, extraUsd, ...(checkpoint ? [checkpoint.chargedUsd, checkpoint.reservedUsd] : [])];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new Error("invalid spend checkpoint: charges must be finite nonnegative numbers");
  }
  return Math.max(storedRowUsd, checkpoint ? checkpoint.chargedUsd + checkpoint.reservedUsd : 0) + extraUsd;
}

export function plannerRequestWorstCaseUsd(
  init: RequestInit | undefined,
  model: string,
  serverOutputCap = 0,
): number {
  let messages: unknown = [];
  let maxTokens = 4_000;
  if (typeof init?.body === "string") {
    try {
      const body = providerChatBody(JSON.parse(init.body) as Record<string, unknown>, resolveLlmEndpoint());
      messages = body.messages ?? [];
      const cap = completionTokenCap(body);
      if (Number.isFinite(cap)) {
        maxTokens = cap;
      }
    } catch {
      // The output ceiling still provides a conservative charge for malformed bodies.
    }
  }
  return estimateLabCallWorstCaseUsd({ messages, maxTokens: Math.max(maxTokens, serverOutputCap), model });
}

/** Deterministic shuffle so a "sample one per unit" run is reproducible. */
function pick<T>(items: T[], count: number, seed: number): T[] {
  if (items.length <= count) return items;
  const ordered = [...items];
  let state = seed * 2654435761;
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const swap = state % (index + 1);
    [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
  }
  return ordered.slice(0, count);
}

/** Ad-hoc questions from `--ask`: one per line, `#` comments and blanks skipped. */
function loadAskFile(path: string): ProbeQuestion[] {
  if (!existsSync(path)) throw new Error(`--ask file not found: ${path}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((question, index) => ({
      id: `ask|${index + 1}|${question.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      topicId: "ask|0|ad-hoc",
      difficulty: "medium" as const,
      question,
    }));
}

function loadProbes(repoRoot: string, options: Options): ProbeQuestion[] {
  const probesDir = resolve(repoRoot, "data/syllabus-probes");
  const files = readdirSync(probesDir).filter((name) => name.endsWith(".json"));
  const selected: ProbeQuestion[] = [];
  for (const file of files.sort()) {
    const match = /^([a-z]+)-unit-(\d+)\.json$/.exec(file);
    if (!match) continue;
    const [, subject, unitNumber] = match;
    if (!options.subjects.includes(subject)) continue;
    if (options.units && !options.units.includes(Number.parseInt(unitNumber, 10))) continue;
    const questions = parseProbeFile(
      JSON.parse(readFileSync(resolve(probesDir, file), "utf8")),
    ).filter((probe) => options.difficulty === "all" || probe.difficulty === options.difficulty);
    selected.push(
      ...(options.perUnit ? pick(questions, options.perUnit, options.seed) : questions),
    );
  }
  const filtered = options.only
    ? selected.filter((probe) => options.only?.includes(probe.id))
    : selected;
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

function loadEvaluationRows(paths: readonly string[], options: Options): DiagramEvalRow[] {
  const groups = paths.map((path) => {
    if (!existsSync(path)) throw new Error(`--eval file not found: ${path}`);
    return parseDiagramEvalJsonl(readFileSync(path, "utf8"));
  });
  let rows = combineDiagramEvalRows(groups);
  if (options.topics) {
    const topics = new Set(options.topics);
    rows = rows.filter((row) => topics.has(row.topic_id));
  }
  return options.sample === null
    ? rows
    : sampleDiagramEvalRows(rows, options.sample, options.seed);
}

export function transcript(run: LectureRun, grade: LectureGrade): string {
  const lines: string[] = [];
  lines.push(`# ${run.probeId}`);
  lines.push("");
  lines.push(`**Question.** ${run.question}`);
  lines.push("");
  lines.push(
    `score ${grade.score} | ${grade.passed ? "passed" : "FAILED"} | steps ${grade.metrics.steps} (budget ${run.lessonBudget.minSteps}-${run.lessonBudget.maxSteps}, ${run.lessonBudget.scope}) | rows ${grade.metrics.writes} | figure ${grade.metrics.diagramTier} (${grade.metrics.diagramPrimitives} primitives) | plan ${Math.round(run.timings.planMs / 100) / 10}s | teach ${Math.round(run.timings.teachMs / 100) / 10}s`,
  );
  lines.push("");
  if (grade.findings.length > 0) {
    lines.push("## Findings");
    for (const finding of grade.findings) {
      lines.push(`- **${finding.severity}** \`${finding.code}\` ${finding.detail}`);
    }
    lines.push("");
  }
  lines.push("## Turn plan");
  const quantity = (item: { symbol?: string; id: string; value: unknown; unit?: string }) =>
    `${item.symbol ?? item.id} = ${String(item.value)}${item.unit ? " " + item.unit : ""}`;
  lines.push(
    `visualRequirement ${run.plan?.visualRequirement ?? "?"} | laws ${run.plan?.lawIds.join(", ") || "none"}`,
  );
  lines.push(
    `givens: ${(run.plan?.givens ?? []).map((given) => quantity(given as never)).join("; ") || "none"}`,
  );
  lines.push(
    `unknowns: ${(run.plan?.unknowns ?? []).map((unknown) => (unknown as { symbol?: string; id: string }).symbol ?? (unknown as { id: string }).id).join(", ") || "none"}`,
  );
  lines.push(`derived: ${run.plan?.derived.map(quantity).join("; ") || "none"}`);
  lines.push(
    `solver: ${run.solver ? `${run.solver.status}${run.solver.issueCodes.length ? " (" + run.solver.issueCodes.join(", ") + ")" : ""}` : "unavailable"}`,
  );
  lines.push("");
  lines.push("## Figure");
  lines.push(
    `source ${run.diagram.figureSource ?? "unrecorded"} | tier ${run.diagram.tier ?? "none"} | family ${run.diagram.family ?? "none"} | archetype ${run.diagram.archetypeId ?? "none"} | reason ${run.diagram.reason ?? "none"}`,
  );
  lines.push(`entities: ${run.diagram.entityIds.join(", ") || "none"}`);
  if (run.diagram.renderedLabels.length > 0) {
    lines.push(`text drawn on the figure: ${run.diagram.renderedLabels.join(" | ")}`);
  } else if (run.diagram.committed) {
    lines.push("text drawn on the figure: none");
  }
  if (run.diagram.focusableIds.length > 0) {
    lines.push(`focusable: ${run.diagram.focusableIds.join(", ")}`);
  }
  if (run.diagram.candidateErrorCodes.length > 0) {
    lines.push(`rejected candidates: ${run.diagram.candidateErrorCodes.join(", ")}`);
  }
  lines.push("");
  lines.push("## Lesson");
  if (run.givenRows.length > 0) {
    lines.push(`_runtime wrote:_ ${run.givenRows.join(" / ")}`);
    lines.push("");
  }
  for (const step of run.teaching.steps) {
    const tags = step.tags
      .map((tag) =>
        tag.text !== undefined
          ? `[${tag.type}:${tag.text}${tag.params.length ? "," + tag.params.join(",") : ""}]`
          : `[${tag.type}${tag.params.length ? ":" + tag.params.join(",") : ""}]`,
      )
      .join(" ");
    lines.push(`${step.index}. ${step.speech}`);
    if (tags) lines.push(`   ${tags}`);
  }
  if (run.error) {
    lines.push("");
    lines.push(`**Error.** ${run.error}`);
  }
  return lines.join("\n");
}

export function summarizeEvaluation(runs: readonly LectureRun[]) {
  const sourceCounts: Record<string, number> = {};
  const tierCounts: Record<string, number> = {};
  const familyCounts: Record<string, number> = {};
  let figureCommitMs = 0;
  let timedFigures = 0;
  let plannerCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  let pickerInputTokens = 0;
  let pickerOutputTokens = 0;
  let pickerCostUsd = 0;
  let pickerCriticalPathMs = 0;
  const pickerStatusCounts: Record<string, number> = {};
  let scenePromptChars = 0;
  let scenePromptCalls = 0;
  const modelCounts: Record<string, number> = {};
  const diagramFailures = summarizeDiagramFailures(runs.map((run) => run.diagram));
  for (const run of runs) {
    const source = run.diagram.figureSource ?? "unrecorded";
    const tier = run.diagram.tier ?? "none";
    const family = run.diagram.family ?? "none";
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    familyCounts[family] = (familyCounts[family] ?? 0) + 1;
    if (run.timings.figureCommitMs !== null && run.timings.figureCommitMs !== undefined) {
      figureCommitMs += run.timings.figureCommitMs;
      timedFigures += 1;
    }
    plannerCalls += run.planner?.calls ?? 0;
    inputTokens += run.planner?.inputTokens ?? 0;
    outputTokens += run.planner?.outputTokens ?? 0;
    totalTokens += run.planner?.totalTokens ?? 0;
    estimatedCostUsd += run.planner?.estimatedCostUsd ?? 0;
    if (run.examplePicker) {
      pickerInputTokens += run.examplePicker.inputTokens;
      pickerOutputTokens += run.examplePicker.outputTokens;
      pickerCostUsd += run.examplePicker.estimatedCostUsd;
      pickerCriticalPathMs += run.examplePicker.criticalPathMs;
      pickerStatusCounts[run.examplePicker.status] = (pickerStatusCounts[run.examplePicker.status] ?? 0) + 1;
    }
    for (const outcome of run.diagram.plannerCallOutcomes ?? []) {
      scenePromptChars += outcome.promptChars;
      scenePromptCalls += 1;
    }
    for (const call of run.planner?.modelCalls ?? []) {
      modelCounts[call.model] = (modelCounts[call.model] ?? 0) + 1;
    }
  }
  return {
    rows: runs.length,
    figuresCommitted: runs.filter((run) => run.diagram.committed).length,
    noFigure: runs.filter((run) => !run.diagram.committed).length,
    errors: runs.filter((run) => run.error !== null).length,
    sourceCounts,
    tierCounts,
    familyCounts,
    ...diagramFailures,
    meanFigureCommitMs: timedFigures > 0 ? Math.round(figureCommitMs / timedFigures) : null,
    planner: {
      calls: plannerCalls,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
      meanPromptChars: scenePromptCalls > 0 ? Math.round(scenePromptChars / scenePromptCalls) : null,
      modelCounts,
    },
    examplePicker: {
      calls: runs.filter((run) => run.examplePicker).length,
      inputTokens: pickerInputTokens,
      outputTokens: pickerOutputTokens,
      estimatedCostUsd: Math.round(pickerCostUsd * 1_000_000) / 1_000_000,
      criticalPathMs: pickerCriticalPathMs,
      statusCounts: pickerStatusCounts,
    },
  };
}

async function main(): Promise<void> {
  if (existsSync(resolve(process.cwd(), ".env.local"))) process.loadEnvFile(resolve(process.cwd(), ".env.local"));
  const endpoint = resolveLlmEndpoint();
  if (endpoint.provider !== "azure" || endpoint.fallbackReason || !endpoint.apiKey || !endpoint.deployment) {
    throw new Error("paid lecture-lab runs require a fully configured Azure provider; Fireworks calls are disabled");
  }
  const providerConfig = { provider: endpoint.provider, deployment: endpoint.deployment, model: endpoint.deployment };
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = resolve(process.cwd(), "../..");
  if (options.evalFiles.length > 0 && options.ask) throw new Error("--eval and --ask cannot be combined");
  const evaluationRows = options.evalFiles.length > 0
    ? loadEvaluationRows(options.evalFiles.map((path) => resolve(path)), options)
    : null;
  const evaluationById = new Map(evaluationRows?.map((row) => [row.id, row]) ?? []);
  const exclusionQuestions = options.exampleExclusions
    ? parseDiagramEvalJsonl(readFileSync(resolve(options.exampleExclusions), "utf8")).map((row) => row.question)
    : [];
  const exampleExclusionFingerprint = labSampleFingerprint(exclusionQuestions);
  const diagramExamples = evaluationRows && evaluationUsesExamples(options.arm)
    ? loadDiagramExemplarLibrary(
        resolve(repoRoot, "data/diagram-eval/v1/exemplars/_library.jsonl"),
        [...evaluationRows.map((row) => row.question), ...exclusionQuestions],
      )
    : [];
  const diagramExampleCatalogue = diagramExamples.length > 0
    ? buildDiagramExampleCatalogue(diagramExamples)
    : undefined;
  const probes = evaluationRows
    ? evaluationRows.map((row): ProbeQuestion => ({
        id: row.id,
        topicId: row.topic_id,
        difficulty: row.difficulty,
        question: row.question,
      }))
    : options.ask
      ? loadAskFile(resolve(options.ask))
      : loadProbes(repoRoot, options);
  const preflightEstimateUsd = evaluationRows
    ? estimateEvaluationCostUsd(probes.length, options.arm, options.model)
    : null;
  assertUniqueArtifactIds(probes);
  // Verify the server (not just this CLI's environment) before sending any model call.
  const configHeaders = new Headers();
  applyLectureLabHeaders(configHeaders);
  const configResponse = await fetch(`${options.origin}/api/lecture-lab/config`, { headers: configHeaders });
  if (!configResponse.ok) throw new Error("authenticated lab provider preflight failed");
  const serverConfig = await configResponse.json() as { provider: string; deployment: string; configured: boolean; plannerOutputCap: number; teachingOutputCap: number };
  if (!serverConfig.configured || serverConfig.provider !== providerConfig.provider || serverConfig.deployment !== providerConfig.deployment ||
    !Number.isFinite(serverConfig.plannerOutputCap) || !Number.isFinite(serverConfig.teachingOutputCap)) {
    throw new Error("server provider/deployment does not match the configured Azure lab");
  }
  execFileSync(process.execPath, [resolve(process.cwd(), "scripts/lecture-lab/svg2png.mjs"), "--check-browser"], { stdio: "pipe" });
  const executionConfig = {
    figureOnly: options.figureOnly, scenePlannerLimitMs: options.scenePlannerLimitMs,
    familiarity: options.familiarity, narrationLanguage: options.narrationLanguage,
    exampleLibraryFingerprint: labSampleFingerprint(diagramExamples),
    sceneDeclinePolicy: options.sceneDeclinePolicy, exampleExclusionFingerprint,
  };
  if (preflightEstimateUsd !== null) {
    console.log(
      `diagram eval: ${probes.length} rows, arm ${options.arm}, provider ${endpoint.provider}, deployment ${endpoint.deployment}, scene planner limit ${options.scenePlannerLimitMs}ms, figure-only ${options.figureOnly}, estimated cost $${preflightEstimateUsd.toFixed(2)}`,
    );
    if (evaluationUsesExamples(options.arm)) {
      console.log(`diagram eval: ${diagramExamples.length} leak-filtered examples available`);
      console.log(
        `diagram eval: ${diagramExampleCatalogue?.entries.length ?? 0} picker catalogue entries, ` +
        `~${diagramExampleCatalogue?.estimatedTokens ?? 0} tokens`,
      );
    }
    assertEvaluationCostAllowed(preflightEstimateUsd, options.yes);
  }

  const outDir = resolve(process.cwd(), options.out);
  const checkpointPath = `${outDir}/spend-checkpoint.json`;
  if (existsSync(checkpointPath) && !options.resume) throw new Error("output has a spend checkpoint; use --resume, never erase prior spend");
  mkdirSync(`${outDir}/runs`, { recursive: true });
  mkdirSync(`${outDir}/transcripts`, { recursive: true });
  const savedFiles = readdirSync(`${outDir}/runs`).filter((name) => name.endsWith(".json"));
  assertLabOutputReusable(existsSync(checkpointPath), savedFiles.length, options.resume);
  if (savedFiles.length > 0 && !options.resume) throw new Error("output has saved runs; use --resume to avoid overwriting and duplicate spend");
  const savedRuns: Array<LectureRun & { providerConfig: typeof providerConfig }> = options.resume
    ? savedFiles.map((name) => JSON.parse(readFileSync(`${outDir}/runs/${name}`, "utf8")))
    : [];
  const pendingProbes = selectResumeProbes(probes, savedRuns, options.arm, providerConfig, executionConfig);
  const runs: LectureRun[] = [...savedRuns];
  const grades: LectureGrade[] = runs.map(gradeLecture);
  const previousSummary = options.resume && existsSync(`${outDir}/summary.json`)
    ? JSON.parse(readFileSync(`${outDir}/summary.json`, "utf8")) as Record<string, unknown> : {};
  const reviewedIds = new Set(readRoundJudgments(outDir).map((row) => row.id));
  const sampleFingerprint = labSampleFingerprint(evaluationRows ?? probes);
  const oldCheckpoint = options.resume && existsSync(checkpointPath)
    ? JSON.parse(readFileSync(checkpointPath, "utf8")) as { chargedUsd: number; reservedUsd: number; arm: string; providerConfig: typeof providerConfig; scenePlannerLimitMs: number; probeIds: string[]; sampleFingerprint: string; sceneDeclinePolicy?: SceneDeclinePolicy; exampleExclusionFingerprint?: string; executionConfig?: Record<string, unknown> }
    : null;
  if (oldCheckpoint && !oldCheckpoint.sampleFingerprint) throw new Error("legacy spend checkpoint lacks a sample fingerprint; verify the original sample before migrating it");
  if (options.resume && !oldCheckpoint) throw new Error("resume requires a spend checkpoint with proven execution identity");
  if (oldCheckpoint && (oldCheckpoint.arm !== options.arm || oldCheckpoint.providerConfig.provider !== providerConfig.provider ||
    oldCheckpoint.providerConfig.deployment !== providerConfig.deployment || oldCheckpoint.scenePlannerLimitMs !== options.scenePlannerLimitMs ||
    JSON.stringify(oldCheckpoint.executionConfig) !== JSON.stringify(executionConfig) ||
    JSON.stringify(oldCheckpoint.probeIds) !== JSON.stringify(probes.map((probe) => probe.id)) || oldCheckpoint.sampleFingerprint !== sampleFingerprint)) {
    throw new Error("resume requires the identical provider, arm, scene limit and full original sample");
  }
  if (oldCheckpoint && ((oldCheckpoint.sceneDeclinePolicy ?? "unchanged") !== options.sceneDeclinePolicy ||
    (oldCheckpoint.exampleExclusionFingerprint ?? labSampleFingerprint([])) !== exampleExclusionFingerprint)) {
    throw new Error("resume requires the identical decline experiment and example exclusions");
  }
  const storedRowUsd = runs.reduce((sum, run) => sum + (run.planner?.estimatedCostUsd ?? 0) + (run.examplePicker?.estimatedCostUsd ?? 0), 0);
  const priorChargeUsd = restoredLabCharge(storedRowUsd, oldCheckpoint, options.resumeExtraUsd);
  console.log(`resume: ${runs.length} saved, ${pendingProbes.length} pending, prior conservative charge $${priorChargeUsd.toFixed(6)}`);

  const landing = await fetch(`${options.origin}/`, { redirect: "manual" });
  const cookie = (landing.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("dev server issued no anonymous session cookie");

  // Every planner in tutor-core builds its own request; the cookie is the one
  // thing they cannot know about. Adding it here keeps the call sites identical
  // to the browser's. Eval rounds also account every non-streaming planner
  // response by the trace id already carried on the request.
  const nativeFetch = globalThis.fetch;
  const spendCap = new LabSpendCap(options.maxUsd);
  spendCap.recordCost(priorChargeUsd);
  const checkpointSpend = () => writeFileSync(checkpointPath, `${JSON.stringify({
    ...spendCap.summary(runs.length, probes.length), arm: options.arm, providerConfig,
    scenePlannerLimitMs: options.scenePlannerLimitMs, probeIds: probes.map((probe) => probe.id),
    sampleFingerprint, executionConfig,
    sceneDeclinePolicy: options.sceneDeclinePolicy, exampleExclusionFingerprint,
  }, null, 1)}\n`);
  checkpointSpend();
  const budgetDeniedTraces = new Set<string>();
  const budgetTerminatedRows: string[] = [];
  const writeSummary = () => {
    const summary = {
      ...previousSummary, options, providerConfig, executionConfig,
      evaluationConfig: evaluationRows ? { ...providerConfig, scenePlannerLimitMs: options.scenePlannerLimitMs,
        sceneDeclinePolicy: options.sceneDeclinePolicy, exampleExclusionFingerprint } : null,
      preflightEstimateUsd,
      resumeAccounting: { savedRows: savedFiles.length, priorChargeUsd, interruptedAllowanceUsd: options.resumeExtraUsd },
      ...spendCap.summary(runs.length, probes.length), budgetTerminatedRows,
      evaluation: evaluationRows ? summarizeEvaluation(runs) : null,
      ...summarize(grades, runs),
      judgingStatus: { preservedJudgeSummary: Boolean(previousSummary.judge),
        reviewedRows: runs.filter((row) => reviewedIds.has(row.probeId)).length,
        unreviewedRows: runs.filter((row) => !reviewedIds.has(row.probeId)).length },
    };
    writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 1) + "\n");
    return summary;
  };
  writeSummary();
  const worstCasePlannerModel = resolveFireworksModel({ fastMode: options.model === "fast" });
  const settleSpend = (reservedUsd: number, usd: number) => { spendCap.settleCall(reservedUsd, usd); checkpointSpend(); };
  const usageTracker = new PlannerUsageTracker((usd, reservedUsd) => settleSpend(reservedUsd, usd));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (url.startsWith(options.origin)) {
      headers.set("cookie", cookie);
      applyLectureLabHeaders(headers);
      if (evaluationRows) {
        headers.set(LECTURE_LAB_ZERO_RETENTION_HEADER, "1");
        if (evaluationUsesStandardModelHeader(true, options.model)) {
          headers.set(LECTURE_LAB_STANDARD_MODEL_HEADER, "1");
        }
      }
    }
    const traceId = headers.get("x-heytutor-trace-id");
    const chatRequest = url === `${options.origin}/api/chat` && traceId;
    const plannerRequest = chatRequest && headers.get("x-planner") === "1";
    const directProviderRequest = url === endpoint.url;
    const requestModel = plannerRequest
      ? worstCasePlannerModel
      : resolveTeachingFireworksModel({ fastMode: options.model === "fast" });
    // The proxy dispatches up to two planner or three teaching attempts.
    const maxAttempts = chatRequest ? plannerRequest ? 2 : 3 : 1;
    const requestWorstCaseUsd = chatRequest || directProviderRequest
      ? plannerRequestWorstCaseUsd(init, requestModel, plannerRequest ? serverConfig.plannerOutputCap : serverConfig.teachingOutputCap) * maxAttempts
      : 0;
    if ((chatRequest || directProviderRequest) && !spendCap.reserveCall(requestWorstCaseUsd)) {
      if (traceId) budgetDeniedTraces.add(traceId);
      throw new Error("lab request denied before sending: --max-usd reservation exhausted");
    }
    if (chatRequest || directProviderRequest) checkpointSpend();
    if (chatRequest) {
      usageTracker.recordRequest(traceId, requestWorstCaseUsd);
    }
    let accounted = false;
    try {
      const response = await nativeFetch(input, { ...init, headers });
      if (plannerRequest) await usageTracker.recordResponse(traceId, response, requestWorstCaseUsd, maxAttempts);
      else if (chatRequest) usageTracker.recordStreamingResponse(traceId, response, requestWorstCaseUsd, maxAttempts);
      else if (directProviderRequest) {
        let chargedUsd = requestWorstCaseUsd;
        try {
          const payload = await response.clone().json() as { usage?: unknown };
          const usage = parseProviderUsage(payload.usage);
          if (usage.known) chargedUsd = calculateLlmCostDetails(usage, { model: requestModel }).total ?? requestWorstCaseUsd;
        } catch {
          // Cancelled or malformed responses retain their full reservation.
        }
        settleSpend(requestWorstCaseUsd, chargedUsd);
      }
      accounted = true;
      if (chatRequest && response.ok && response.headers.get(plannerRequest ? "x-heytutor-planner-model" : "x-heytutor-model") !== providerConfig.deployment) {
        throw new Error("lab received an unexpected or unrecorded server model; paid usage has been retained");
      }
      return response;
    } catch (error) {
      if (!accounted && chatRequest) usageTracker.recordFailure(traceId, requestModel, requestWorstCaseUsd);
      else if (!accounted && directProviderRequest) settleSpend(requestWorstCaseUsd, requestWorstCaseUsd);
      throw error;
    }
  }) as typeof fetch;

  console.log(
    `lecture lab: ${probes.length} ${evaluationRows ? "evaluation rows" : `${options.difficulty} probes`}, concurrency ${options.concurrency}, max $${options.maxUsd.toFixed(2)}, familiarity ${options.familiarity} -> ${options.out}`,
  );

  let done = runs.length;
  let newRowsDone = 0;
  await runBudgetedLabRows(
    pendingProbes,
    options.concurrency,
    spendCap,
    async (probe) => {
      const startedAt = Date.now();
      const traceId = crypto.randomUUID();
      const run = await runLecture(probe.question, {
        origin: options.origin,
        cookie,
        familiarity: options.familiarity,
        narrationLanguage: options.narrationLanguage,
        probeId: probe.id,
        topicId: probe.topicId,
        unitId: unitIdFromTopicId(probe.topicId),
        difficulty: probe.difficulty,
        arm: options.arm,
        figureOnly: options.figureOnly,
        fastMode: evaluationRunFastMode(Boolean(evaluationRows), options.model),
        scenePlannerDeadlineMs: evaluationRows ? options.scenePlannerLimitMs : undefined,
        subject: parseDiagramSubject(evaluationById.get(probe.id)?.subject),
        sceneDeclinePolicy: options.sceneDeclinePolicy,
        traceId,
        diagramExamples,
        diagramExampleCatalogue,
      });
      run.planner = await usageTracker.finishAsync(traceId);
      if (budgetDeniedTraces.has(traceId)) {
        budgetTerminatedRows.push(probe.id);
        mkdirSync(`${outDir}/interrupted`, { recursive: true });
        writeFileSync(`${outDir}/interrupted/${labArtifactSlug(probe.id)}-${traceId}.json`, JSON.stringify({
          ...run, providerConfig, executionConfig, evaluation: evaluationById.get(probe.id) ?? null,
          status: "untested_budget", traceId,
        }, null, 1) + "\n");
        console.log(`budget ended during ${probe.id}; untested, not an empty-figure verdict`);
        writeSummary();
        return;
      }
      const grade = gradeLecture(run);
      grades.push(grade);
      runs.push(run);
      const slug = labArtifactSlug(probe.id);
      const svgPath = run.diagram.svg ? `frames/${slug}.svg` : null;
      const pngPath = run.diagram.svg ? `frames/${slug}.png` : null;
      if (run.diagram.svg) {
        mkdirSync(`${outDir}/frames`, { recursive: true });
        writeFileSync(`${outDir}/frames/${slug}.svg`, run.diagram.svg);
      }
      run.diagram.png = pngPath;
      writeFileSync(`${outDir}/runs/${slug}.json`, `${JSON.stringify({
        ...run,
        providerConfig,
        executionConfig,
        evaluation: evaluationById.get(probe.id) ?? null,
        diagram: { ...run.diagram, svg: svgPath, png: pngPath },
      }, null, 1)}\n`);
      writeFileSync(`${outDir}/transcripts/${slug}.md`, `${transcript(run, grade)}\n`);
      done += 1;
      newRowsDone += 1;
      checkpointSpend();
      writeSummary();
      if (evaluationRows && newRowsDone === 5) {
        assertRoundPlannerStarted(runs.slice(-5).map((completedRun) => completedRun.planner), 5);
      }
      const state = evaluationRows
        ? run.error ? "dead" : run.diagram.committed ? "fig " : "none"
        : grade.transportFailure ? "dead" : grade.passed ? "ok  " : "FAIL";
      console.log(`[${done}/${probes.length}] ${state} ${Math.round((Date.now() - startedAt) / 1000)}s ${probe.id}`);
    },
  );

  // Paid records and summary exist before optional rendering can fail.
  const summary = writeSummary();
  const artifactErrors: string[] = [];
  try {
    if (existsSync(`${outDir}/frames`)) execFileSync(process.execPath, [resolve(process.cwd(), "scripts/lecture-lab/svg2png.mjs"), `${outDir}/frames`], { stdio: "inherit" });
  } catch (error) { artifactErrors.push(`rasterization failed: ${error instanceof Error ? error.message : String(error)}`); }
  for (const file of readdirSync(`${outDir}/runs`).filter((name) => name.endsWith(".json"))) {
    const path = `${outDir}/runs/${file}`;
    const row = JSON.parse(readFileSync(path, "utf8"));
    if (row.diagram.png && !existsSync(resolve(outDir, row.diagram.png))) {
      row.diagram.png = null;
      writeFileSync(path, JSON.stringify(row, null, 1) + "\n");
    }
  }
  let galleryPath: string | null = null;
  try { galleryPath = evaluationRows ? writeRoundGallery(outDir) : null; }
  catch (error) { artifactErrors.push(`gallery failed: ${error instanceof Error ? error.message : String(error)}`); }
  writeFileSync(`${outDir}/summary.json`, JSON.stringify({ ...summary, artifactErrors }, null, 1) + "\n");
  console.log("");
  if (evaluationRows) console.log(JSON.stringify(summary.evaluation, null, 2));
  else printSummary(summary);
  if (summary.stoppedForBudget) {
    console.log(
      `lecture lab stopped for budget after ${summary.rowsDone}/${summary.rowsPlanned} rows at $${summary.chargedUsd.toFixed(6)} / $${summary.maxUsd.toFixed(2)}`,
    );
  }
  if (galleryPath) console.log(`gallery: ${galleryPath}`);
}

if (process.argv[1]?.endsWith("run.ts")) {
  void main();
}
