import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import { parseProviderUsage } from "../../lib/obs/providerUsage";
import type { FigureSource } from "@heytutor/scene-engine";
import {
  diagramStrategyAllowsFigureSource,
  evaluationDiagramStrategyDecision,
  type DiagramStrategyContext,
} from "../../features/tutor-session/lib/scene/diagramStrategy";
import { resolveCheapFireworksModel, resolveFireworksModel } from "../../lib/llm/fireworksModels";

export type DiagramEvalArm =
  | "current"
  | "planner_first"
  | "planner_examples"
  | "planner_examples_strict";
export type DiagramEvalModel = "configured" | "standard" | "fast";
export type DiagramEmptyCause =
  | "not_needed"
  | "not_attempted"
  | "planner_no_output"
  | "candidates_invalid"
  | "declined_unreadable"
  | "fallback_suppressed"
  | "deadline";

export interface DiagramEvalRow {
  id: string;
  topic_id: string;
  subject: string;
  difficulty: "easy" | "medium" | "hard";
  question: string;
  source: { kind: "bank" | "probe" | "authored"; ref: string | null };
  figure_need: "required" | "optional" | "none";
  figure_kind: string;
  must_show: string[];
  must_label: string[];
  must_not_show: string[];
  trap: "figure_absent" | "no_figure_needed" | "near_miss_topic" | null;
  notes: string;
  /** Present on the private, real-student evaluation slice. */
  kind?: string;
  /** Present on the private, real-student evaluation slice. */
  ask_style?: string;
}

export interface PlannerUsageSummary {
  calls: number;
  usageCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  estimatedCostUsd: number;
  modelCalls: PlannerModelCall[];
}

export interface PlannerModelCall {
  model: string;
  status: number;
  ok: boolean;
  usageKnown: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  estimatedCostUsd: number;
}

export function classifyDiagramEmptyCause(input: {
  committed: boolean;
  visualRequirement: "required" | "optional" | "none";
  declinedUnreadable: boolean;
  primitiveCount: number;
  plannerCalls: number;
  deadlineRemainingMs: number;
  candidateCount: number;
  candidateErrorCodes: readonly string[];
  fallbackSuppressed?: boolean;
}): DiagramEmptyCause | null {
  if (input.committed) return null;
  if (input.visualRequirement === "none") return "not_needed";
  if (input.fallbackSuppressed) return "fallback_suppressed";
  if (input.deadlineRemainingMs <= 1_000) return "deadline";
  if (input.plannerCalls === 0) return "not_attempted";
  if (input.candidateCount === 0 && input.candidateErrorCodes.length === 0) {
    return "planner_no_output";
  }
  if (input.candidateErrorCodes.length > 0) return "candidates_invalid";
  if (input.declinedUnreadable && input.primitiveCount > 0) return "declined_unreadable";
  return "planner_no_output";
}

/** Adds the deterministic refusal code missing from otherwise-valid text_only candidates. */
export function supplementCandidateErrorCodes(input: {
  committed: boolean;
  visualRequirement: "required" | "optional" | "none";
  primitiveCount: number;
  candidateCount: number;
  candidateErrorCodes: readonly string[];
}): string[] {
  const codes = [...new Set(input.candidateErrorCodes)];
  if (
    !input.committed &&
    input.visualRequirement !== "none" &&
    input.primitiveCount === 0 &&
    input.candidateCount > 0 &&
    codes.length === 0
  ) {
    codes.push("planner_declined_required_scene");
  }
  return codes;
}

function descendingCounts(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    ),
  );
}

export function summarizeDiagramFailures(
  diagrams: readonly {
    emptyCause?: DiagramEmptyCause | null;
    candidateErrorCodes?: readonly string[];
  }[],
): {
  emptyCauseCounts: Record<string, number>;
  candidateErrorCodeCounts: Record<string, number>;
} {
  return {
    emptyCauseCounts: descendingCounts(
      diagrams.flatMap((diagram) => diagram.emptyCause ? [diagram.emptyCause] : []),
    ),
    candidateErrorCodeCounts: descendingCounts(
      diagrams.flatMap((diagram) => diagram.candidateErrorCodes ?? []),
    ),
  };
}

export function formatDiagramFailureCounts(counts: Record<string, number> | undefined): string {
  if (!counts || Object.keys(counts).length === 0) return "none";
  return Object.entries(counts).map(([name, count]) => `${name}=${count}`).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function normalizeRealStudentRow(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.kind !== "string" || typeof value.ask_style !== "string") return value;
  const subject = typeof value.subject === "string" && value.subject.trim()
    ? value.subject
    : "unknown";
  return {
    ...value,
    topic_id: typeof value.topic_id === "string" && value.topic_id.trim()
      ? value.topic_id
      : `${subject}|eval|real-student`,
    difficulty: ["easy", "medium", "hard"].includes(String(value.difficulty))
      ? value.difficulty
      : "medium",
    source: isRecord(value.source)
      ? value.source
      : { kind: "authored", ref: "private-real-student-eval" },
    notes: typeof value.notes === "string" ? value.notes : "",
  };
}

function parseRow(value: unknown, line: number): DiagramEvalRow {
  if (!isRecord(value)) {
    throw new Error(`diagram eval line ${line}: row and source must be objects`);
  }
  const normalized = normalizeRealStudentRow(value);
  if (!isRecord(normalized.source)) {
    throw new Error(`diagram eval line ${line}: row and source must be objects`);
  }
  const scalarStrings = ["id", "topic_id", "subject", "question", "figure_kind"] as const;
  if (scalarStrings.some((key) => typeof normalized[key] !== "string" || !normalized[key].trim())) {
    throw new Error(`diagram eval line ${line}: missing required string field`);
  }
  if (typeof normalized.notes !== "string") {
    throw new Error(`diagram eval line ${line}: notes must be a string`);
  }
  if (!["easy", "medium", "hard"].includes(String(normalized.difficulty))) {
    throw new Error(`diagram eval line ${line}: invalid difficulty`);
  }
  if (!["required", "optional", "none"].includes(String(normalized.figure_need))) {
    throw new Error(`diagram eval line ${line}: invalid figure_need`);
  }
  if (!["bank", "probe", "authored"].includes(String(normalized.source.kind)) ||
      !(normalized.source.ref === null || typeof normalized.source.ref === "string")) {
    throw new Error(`diagram eval line ${line}: invalid source`);
  }
  if (![null, "figure_absent", "no_figure_needed", "near_miss_topic"].includes(normalized.trap as never)) {
    throw new Error(`diagram eval line ${line}: invalid trap`);
  }
  if (!stringArray(normalized.must_show) || !stringArray(normalized.must_label) || !stringArray(normalized.must_not_show)) {
    throw new Error(`diagram eval line ${line}: expectation fields must be string arrays`);
  }
  return normalized as unknown as DiagramEvalRow;
}

export function parseDiagramEvalJsonl(source: string): DiagramEvalRow[] {
  const rows: DiagramEvalRow[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const text = raw.trim();
    if (!text || text.startsWith("#")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`diagram eval line ${index + 1}: invalid JSON`);
    }
    const row = parseRow(parsed, index + 1);
    if (ids.has(row.id)) throw new Error(`diagram eval line ${index + 1}: duplicate id ${row.id}`);
    ids.add(row.id);
    rows.push(row);
  }
  return rows;
}

export function combineDiagramEvalRows(
  groups: readonly (readonly DiagramEvalRow[])[],
): DiagramEvalRow[] {
  const combined: DiagramEvalRow[] = [];
  const ids = new Set<string>();
  for (const group of groups) {
    for (const row of group) {
      if (ids.has(row.id)) throw new Error(`diagram eval inputs contain duplicate id ${row.id}`);
      ids.add(row.id);
      combined.push(row);
    }
  }
  return combined;
}

/** Deterministic Fisher-Yates sample used by `--sample N --seed S`. */
export function sampleDiagramEvalRows(
  rows: readonly DiagramEvalRow[],
  count: number,
  seed: number,
): DiagramEvalRow[] {
  if (count >= rows.length) return [...rows];
  const permanent = rows.filter((row) => row.kind !== undefined && row.ask_style !== undefined);
  if (permanent.length > count) {
    throw new Error(`--sample ${count} is smaller than the ${permanent.length} permanent real-student rows`);
  }
  const sampled = rows.filter((row) => row.kind === undefined || row.ask_style === undefined);
  let state = seed * 2654435761;
  for (let index = sampled.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const swap = state % (index + 1);
    [sampled[index], sampled[swap]] = [sampled[swap]!, sampled[index]!];
  }
  return [...permanent, ...sampled.slice(0, Math.max(0, count - permanent.length))];
}

/**
 * Preflight estimate, not a billing promise. Per-row profiles are rounded up
 * from Part 11's standard-K3 usage: roughly four planner calls at 1,000-1,600
 * input and 330-360 output tokens per call. Example arms retain the measured
 * larger prompt allowance. The run record stores actual provider usage.
 */
export function estimateEvaluationCostUsd(
  rowCount: number,
  arm: DiagramEvalArm,
  model: DiagramEvalModel = "configured",
  env: Record<string, string | undefined> = process.env,
): number {
  if (model === "fast") {
    throw new Error("evaluation cost estimates require the configured provider");
  }
  const standardProfile = arm === "current"
    ? { input: 5_300, output: 1_500 }
    : arm === "planner_first"
      ? { input: 5_800, output: 1_450 }
      : { input: 11_500, output: 2_000 };
  const planner = calculateLlmCostDetails(
    { input: rowCount * standardProfile.input, output: rowCount * standardProfile.output },
    { model: resolveFireworksModel({ fastMode: false, env }) },
  ).total ?? 0;
  const picker = evaluationUsesExamples(arm)
    ? calculateLlmCostDetails(
        { input: rowCount * 6_000, output: rowCount * 60 },
        { model: resolveCheapFireworksModel({ env }) },
      ).total ?? 0
    : 0;
  return Math.round((planner + picker) * 1_000_000) / 1_000_000;
}

/** Conservative charge when a lab model call returns no provider usage. */
export function estimateLabCallWorstCaseUsd(input: {
  messages: unknown;
  maxTokens: number;
  model: string;
}): number {
  const promptBytes = new TextEncoder().encode(JSON.stringify(input.messages)).length + 2_048;
  return calculateLlmCostDetails(
    { input: promptBytes, output: Math.max(0, input.maxTokens) },
    { model: input.model },
  ).total ?? 0;
}

/** Evaluation turns use the configured provider without a Fast lane override. */
export function evaluationRunFastMode(
  isEvaluation: boolean,
  model: DiagramEvalModel = "configured",
): boolean | undefined {
  if (isEvaluation && model === "fast") {
    throw new Error("evaluation rounds require the configured provider");
  }
  return isEvaluation ? false : undefined;
}

export function evaluationUsesStandardModelHeader(
  isEvaluation: boolean,
  model: DiagramEvalModel,
): boolean {
  return isEvaluation && model !== "fast";
}

export function evaluationSelectionOrder(arm: DiagramEvalArm): "current" | "planner_first" {
  return evaluationDiagramStrategyDecision(arm, EVALUATION_DEFAULT_CONTEXT).selectionOrder;
}

export function evaluationUsesExamples(arm: DiagramEvalArm): boolean {
  return evaluationDiagramStrategyDecision(arm, EVALUATION_DEFAULT_CONTEXT).usePickedExamples;
}

const EVALUATION_DEFAULT_CONTEXT: DiagramStrategyContext = {
  chemistryLane: false,
  codeLesson: false,
  dsa: false,
  doubt: false,
};

export function evaluationDecision(
  arm: DiagramEvalArm,
  context: DiagramStrategyContext = EVALUATION_DEFAULT_CONTEXT,
) {
  return evaluationDiagramStrategyDecision(arm, context);
}

/** Chemistry is exempt from strict and always keeps the production lane. */
export function evaluationPlansChemistry(
  arm: DiagramEvalArm,
  context: DiagramStrategyContext = EVALUATION_DEFAULT_CONTEXT,
): boolean {
  return evaluationDiagramStrategyDecision(arm, context).strategy === "strict" && !context.chemistryLane;
}

/** The strict arm keeps only the engine's deterministic chemistry fallback. */
export function evaluationAllowsFallback(
  arm: DiagramEvalArm,
  figureSource: FigureSource,
  context: DiagramStrategyContext = EVALUATION_DEFAULT_CONTEXT,
): boolean {
  return diagramStrategyAllowsFigureSource(
    evaluationDiagramStrategyDecision(arm, context),
    figureSource,
  );
}

/** Strict evaluation renders the selected scene only when it is planner-owned or the chemistry fallback. */
export function evaluationSuppressesSelectedSource(
  arm: DiagramEvalArm,
  figureSource: FigureSource,
  context: DiagramStrategyContext = EVALUATION_DEFAULT_CONTEXT,
): boolean {
  return !evaluationAllowsFallback(arm, figureSource, context);
}

export function assertEvaluationCostAllowed(estimatedUsd: number, confirmed: boolean): void {
  if (estimatedUsd > 5 && !confirmed) {
    throw new Error(`estimated planner cost is $${estimatedUsd.toFixed(2)}; rerun with --yes to allow a round above US$5`);
  }
}

/**
 * Fail closed when a paid round is accidentally running on deterministic
 * fallbacks. A 200 response alone is insufficient because mock responses do
 * not carry provider usage; measured tokens prove the planner reached the
 * configured model.
 */
export function assertRoundPlannerStarted(
  completed: readonly (PlannerUsageSummary | undefined)[],
  checkAfterRows = 5,
): void {
  if (completed.length < checkAfterRows) return;
  const started = completed.slice(0, checkAfterRows).some((usage) =>
    usage?.modelCalls.some((call) =>
      call.ok && call.usageKnown && call.totalTokens > 0 && call.estimatedCostUsd > 0,
    ) ?? false,
  );
  if (!started) {
    throw new Error(
      `diagram evaluation aborted: no successful planner call with measured token usage after the first ${checkAfterRows} rows`,
    );
  }
}

function emptyUsage(): PlannerUsageSummary {
  return {
    calls: 0,
    usageCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    estimatedCostUsd: 0,
    modelCalls: [],
  };
}

/** Concurrent-safe accounting keyed by the trace id already carried by every planner request. */
export class PlannerUsageTracker {
  private readonly byTrace = new Map<string, PlannerUsageSummary>();
  private readonly pendingWorstCaseByTrace = new Map<string, number[]>();
  private readonly pendingResponsesByTrace = new Map<string, Promise<void>[]>();

  constructor(private readonly onCost?: (usd: number, reservedUsd: number) => void) {}

  recordRequest(traceId: string, worstCaseUsd = 0): void {
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    summary.calls += 1;
    this.byTrace.set(traceId, summary);
    const pending = this.pendingWorstCaseByTrace.get(traceId) ?? [];
    pending.push(Math.max(0, worstCaseUsd));
    this.pendingWorstCaseByTrace.set(traceId, pending);
  }

  async recordResponse(traceId: string, response: Response, reservedUsd?: number, maxAttempts = 1): Promise<void> {
    let usage: ReturnType<typeof parseProviderUsage> | null = null;
    try {
      const payload = await response.clone().json() as { usage?: unknown };
      usage = parseProviderUsage(payload.usage);
    } catch {
      // A planner call still counts when its provider omitted or malformed usage.
    }
    this.recordParsedResponse(
      traceId,
      response.status,
      response.ok,
      response.headers.get("x-heytutor-planner-model") ?? "unknown",
      usage,
      reservedUsd,
      this.retryAllowance(response, reservedUsd, maxAttempts),
    );
  }

  /** Observe a cloned SSE body without delaying the lesson consuming the original stream. */
  recordStreamingResponse(traceId: string, response: Response, reservedUsd?: number, maxAttempts = 1): void {
    const operation = (async () => {
      let usage: ReturnType<typeof parseProviderUsage> | null = null;
      try {
        const text = await response.clone().text();
        for (const line of text.split(/\r?\n/)) {
          if (!line.startsWith("data: ") || line.slice(6).trim() === "[DONE]") continue;
          const payload = JSON.parse(line.slice(6)) as { usage?: unknown };
          const candidate = parseProviderUsage(payload.usage);
          if (candidate.known) usage = candidate;
        }
      } catch {
        // Missing, cancelled, or malformed streams are charged at request worst case.
      }
      this.recordParsedResponse(
        traceId,
        response.status,
        response.ok,
        response.headers.get("x-heytutor-model") ?? "unknown",
        usage,
        reservedUsd,
        this.retryAllowance(response, reservedUsd, maxAttempts),
      );
    })();
    const pending = this.pendingResponsesByTrace.get(traceId) ?? [];
    pending.push(operation);
    this.pendingResponsesByTrace.set(traceId, pending);
  }

  async finishAsync(traceId: string): Promise<PlannerUsageSummary> {
    await Promise.all(this.pendingResponsesByTrace.get(traceId) ?? []);
    this.pendingResponsesByTrace.delete(traceId);
    return this.finish(traceId);
  }

  private recordParsedResponse(
    traceId: string,
    status: number,
    ok: boolean,
    model: string,
    usage: ReturnType<typeof parseProviderUsage> | null,
    reservedUsd?: number,
    retryAllowanceUsd = 0,
  ): void {
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    const worstCaseUsd = this.takePendingWorstCase(traceId, reservedUsd);
    const call: PlannerModelCall = {
      model,
      status,
      ok,
      usageKnown: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      estimatedCostUsd: 0,
    };
    if (usage?.known) {
        call.usageKnown = true;
        call.inputTokens = usage.input ?? 0;
        call.outputTokens = usage.output ?? 0;
        call.totalTokens = usage.total ?? call.inputTokens + call.outputTokens;
        call.cachedInputTokens = usage.cachedInput ?? 0;
        call.estimatedCostUsd = (calculateLlmCostDetails(usage, { model }).total ?? 0) + retryAllowanceUsd;
        summary.usageCalls += 1;
        summary.inputTokens += call.inputTokens;
        summary.outputTokens += call.outputTokens;
        summary.totalTokens += call.totalTokens;
        summary.cachedInputTokens += call.cachedInputTokens;
    }
    if (!call.usageKnown) call.estimatedCostUsd = worstCaseUsd;
    call.estimatedCostUsd = Math.round(call.estimatedCostUsd * 1_000_000) / 1_000_000;
    summary.estimatedCostUsd += call.estimatedCostUsd;
    summary.modelCalls.push(call);
    this.byTrace.set(traceId, summary);
    this.onCost?.(call.estimatedCostUsd, worstCaseUsd);
  }

  private retryAllowance(response: Response, reservedUsd: number | undefined, maxAttempts: number): number {
    if (maxAttempts <= 1 || !reservedUsd) return 0;
    const attempts = Number(response.headers.get("x-heytutor-upstream-attempts") ?? maxAttempts);
    const boundedAttempts = Number.isFinite(attempts) ? Math.min(maxAttempts, Math.max(1, attempts)) : maxAttempts;
    return (reservedUsd / maxAttempts) * (boundedAttempts - 1);
  }

  recordFailure(traceId: string, model = "unknown", reservedUsd?: number): void {
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    const worstCaseUsd = this.takePendingWorstCase(traceId, reservedUsd);
    const estimatedCostUsd = Math.round(worstCaseUsd * 1_000_000) / 1_000_000;
    summary.estimatedCostUsd += estimatedCostUsd;
    summary.modelCalls.push({
      model,
      status: 0,
      ok: false,
      usageKnown: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      estimatedCostUsd,
    });
    this.byTrace.set(traceId, summary);
    this.onCost?.(estimatedCostUsd, worstCaseUsd);
  }

  finish(traceId: string): PlannerUsageSummary {
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    for (const worstCaseUsd of this.pendingWorstCaseByTrace.get(traceId) ?? []) {
      const estimatedCostUsd = Math.round(worstCaseUsd * 1_000_000) / 1_000_000;
      summary.estimatedCostUsd += estimatedCostUsd;
      summary.modelCalls.push({
        model: "unknown",
        status: 0,
        ok: false,
        usageKnown: false,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        estimatedCostUsd,
      });
      this.onCost?.(estimatedCostUsd, worstCaseUsd);
    }
    this.byTrace.delete(traceId);
    this.pendingWorstCaseByTrace.delete(traceId);
    this.pendingResponsesByTrace.delete(traceId);
    return {
      ...summary,
      estimatedCostUsd: Math.round(summary.estimatedCostUsd * 1_000_000) / 1_000_000,
      modelCalls: summary.modelCalls.map((call) => ({ ...call })),
    };
  }

  private takePendingWorstCase(traceId: string, reservedUsd?: number): number {
    const pending = this.pendingWorstCaseByTrace.get(traceId);
    const index = reservedUsd === undefined ? 0 : pending?.indexOf(reservedUsd) ?? -1;
    const value = index >= 0 ? pending?.splice(index, 1)[0] ?? 0 : 0;
    if (!pending || pending.length === 0) this.pendingWorstCaseByTrace.delete(traceId);
    return value;
  }
}
