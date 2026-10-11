import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import { parseProviderUsage } from "../../lib/obs/providerUsage";
import type { FigureSource } from "@heytutor/scene-engine";
import {
  diagramStrategyAllowsFigureSource,
  evaluationDiagramStrategyDecision,
  type DiagramStrategyContext,
} from "../../features/tutor-session/lib/scene/diagramStrategy";
import { resolveCheapFireworksModel, resolveFireworksModel } from "../../lib/llm/fireworksModels";
import { hasPricedUsage, type LabSpendMode, type LabUsageObservation, type LabUnresolvedCall } from "./labSpend";

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
  | "planner_declined"
  | "candidates_invalid"
  | "declined_unreadable"
  | "fallback_suppressed"
  | "presentation_refused"
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
  knownUsageUsd?: number;
}

export interface PlannerModelCall {
  model: string;
  pricingModel?: string;
  status: number;
  ok: boolean;
  usageKnown: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  estimatedCostUsd: number;
  /** null means unknown, including partial token reports that cannot be priced. */
  measuredCostUsd?: number | null;
  unresolvedAttempts?: number;
  unresolvedAllowanceUsd?: number;
}

export function classifyDiagramEmptyCause(input: {
  committed: boolean;
  visualRequirement: "required" | "optional" | "none";
  declinedUnreadable: boolean;
  primitiveCount: number;
  plannerCalls: number | undefined;
  deadlineRemainingMs: number;
  candidateCount: number;
  candidateErrorCodes: readonly string[];
  fallbackSuppressed?: boolean;
  /** The selected, validated planner document explicitly chose text_only. */
  plannerDeclined?: boolean;
}): DiagramEmptyCause | null {
  if (input.committed) return null;
  if (input.visualRequirement === "none") return "not_needed";
  if (input.fallbackSuppressed) return "fallback_suppressed";
  if (input.deadlineRemainingMs <= 1_000) return "deadline";
  if (input.plannerCalls === 0) return "not_attempted";
  const errors = input.candidateErrorCodes.filter((code) => code !== "planner_declined_required_scene");
  if (input.plannerDeclined) return "planner_declined";
  // The old synthetic marker also covered dropped unlabelled scenes. Without
  // a validated outcome it proves neither a decline nor a validator failure.
  if (input.candidateCount === 0 && errors.length === 0) {
    return "planner_no_output";
  }
  if (errors.length > 0) return "candidates_invalid";
  if (input.declinedUnreadable && input.primitiveCount > 0) return "declined_unreadable";
  return "planner_no_output";
}

/** Preserve real diagnostics, removing the historical synthetic refusal-as-error marker. */
export function supplementCandidateErrorCodes(input: {
  committed: boolean;
  visualRequirement: "required" | "optional" | "none";
  primitiveCount: number;
  candidateCount: number;
  candidateErrorCodes: readonly string[];
}): string[] {
  return [...new Set(input.candidateErrorCodes)].filter((code) => code !== "planner_declined_required_scene");
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
  assertUniqueArtifactIds(rows);
  return rows;
}

export function labArtifactSlug(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, "_");
}

/** macOS filenames are case-insensitive; reject aliases before any paid work. */
export function assertUniqueArtifactIds(rows: readonly { id: string }[]): void {
  const slugs = new Map<string, string>();
  for (const { id } of rows) {
    const slug = labArtifactSlug(id).toLowerCase();
    if (slugs.has(slug)) throw new Error(`artifact filename collision: ${slugs.get(slug)} and ${id}`);
    slugs.set(slug, id);
  }
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
  assertUniqueArtifactIds(combined);
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
    knownUsageUsd: 0,
  };
}

/** Concurrent-safe accounting keyed by the trace id already carried by every planner request. */
export class PlannerUsageTracker {
  private readonly finishedTraces = new Set<string>();
  private readonly byTrace = new Map<string, PlannerUsageSummary>();
  private readonly pendingWorstCaseByTrace = new Map<
    string,
    { usd: number; kind: "planner" | "teaching"; maxAttempts: number }[]
  >();
  private readonly pendingResponsesByTrace = new Map<string, Promise<void>[]>();

  constructor(
    private readonly onCost?: (
      usd: number,
      reservedUsd: number,
      observation: LabUsageObservation,
      context: Pick<LabUnresolvedCall, "traceId" | "kind">,
    ) => void,
    private readonly spendMode: LabSpendMode = "conservative",
  ) {}

  assertTraceOpen(traceId: string): void {
    if (this.finishedTraces.has(traceId))
      throw new Error("cannot reuse a finished lab trace");
  }

  recordRequest(
    traceId: string,
    worstCaseUsd = 0,
    kind: "planner" | "teaching" = "planner",
    maxAttempts = 1,
  ): void {
    this.assertTraceOpen(traceId);
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    summary.calls += 1;
    this.byTrace.set(traceId, summary);
    const pending = this.pendingWorstCaseByTrace.get(traceId) ?? [];
    pending.push({ usd: Math.max(0, worstCaseUsd), kind, maxAttempts });
    this.pendingWorstCaseByTrace.set(traceId, pending);
  }

  async recordResponse(
    traceId: string,
    response: Response,
    reservedUsd?: number,
    maxAttempts = 1,
    fallbackModel = "unknown",
  ): Promise<void> {
    let usage: ReturnType<typeof parseProviderUsage> | null = null;
    let payloadModel: string | null = null;
    try {
      const payload = (await response.clone().json()) as {
        usage?: unknown;
        model?: unknown;
      };
      usage = parseProviderUsage(payload.usage);
      payloadModel =
        typeof payload.model === "string" && payload.model.trim()
          ? payload.model.trim()
          : null;
    } catch {
      // A planner call still counts when its provider omitted or malformed usage.
    }
    const model =
      response.headers.get("x-heytutor-planner-model") ??
      response.headers.get("x-heytutor-model") ??
      payloadModel ??
      fallbackModel;
    this.recordParsedResponse(
      traceId,
      response.status,
      response.ok,
      model,
      usage,
      reservedUsd,
      this.upstreamAttempts(response, maxAttempts),
      maxAttempts,
      this.pricingModel(model, fallbackModel),
    );
  }

  /** Observe a cloned SSE body without delaying the lesson consuming the original stream. */
  recordStreamingResponse(
    traceId: string,
    response: Response,
    reservedUsd?: number,
    maxAttempts = 1,
    fallbackModel = "unknown",
  ): void {
    const operation = (async () => {
      let usage: ReturnType<typeof parseProviderUsage> | null = null;
      let payloadModel: string | null = null;
      try {
        const reader = response.clone().body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const readLine = (line: string) => {
          if (!line.startsWith("data:")) return;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") return;
          try {
            const payload = JSON.parse(data) as {
              usage?: unknown;
              model?: unknown;
            };
            if (typeof payload.model === "string" && payload.model.trim())
              payloadModel = payload.model.trim();
            const candidate = parseProviderUsage(payload.usage);
            if (hasPricedUsage(candidate)) usage = candidate;
          } catch {
            /* A malformed content chunk must not hide the final usage chunk. */
          }
        };
        if (reader)
          for (;;) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            lines.forEach(readLine);
            if (chunk.done) {
              readLine(buffer);
              break;
            }
          }
      } catch {
        // Retain any usage already received; otherwise record an unresolved stream.
      }
      const model =
        response.headers.get("x-heytutor-model") ??
        response.headers.get("x-heytutor-planner-model") ??
        payloadModel ??
        fallbackModel;
      this.recordParsedResponse(
        traceId,
        response.status,
        response.ok,
        model,
        usage,
        reservedUsd,
        this.upstreamAttempts(response, maxAttempts),
        maxAttempts,
        this.pricingModel(model, fallbackModel),
      );
    })();
    const pending = this.pendingResponsesByTrace.get(traceId) ?? [];
    pending.push(operation);
    this.pendingResponsesByTrace.set(traceId, pending);
  }

  async finishAsync(traceId: string): Promise<PlannerUsageSummary> {
    // A request can add a cloned stream observer as its headers arrive.
    // Drain those additions as well as the initial HTTP operations.
    let drained = 0;
    let rejected: PromiseRejectedResult | undefined;
    for (;;) {
      const operations = this.pendingResponsesByTrace.get(traceId) ?? [];
      if (drained === operations.length) break;
      const next = operations.slice(drained);
      drained = operations.length;
      const outcomes = await Promise.allSettled(next);
      rejected ??= outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    }
    this.pendingResponsesByTrace.delete(traceId);
    const summary = this.finish(traceId);
    if (rejected) throw rejected.reason;
    return summary;
  }

  trackOperation(traceId: string, operation: Promise<unknown>): void {
    this.assertTraceOpen(traceId);
    const pending = this.pendingResponsesByTrace.get(traceId) ?? [];
    // The caller receives transport failures; accounting still waits for them.
    pending.push(
      operation.then(
        () => {},
        () => {},
      ),
    );
    this.pendingResponsesByTrace.set(traceId, pending);
  }

  private recordParsedResponse(
    traceId: string,
    status: number,
    ok: boolean,
    model: string,
    usage: ReturnType<typeof parseProviderUsage> | null,
    reservedUsd?: number,
    attempts = 1,
    maxAttempts = 1,
    pricingModel = model,
  ): void {
    if (this.finishedTraces.has(traceId)) return;
    const pending = this.takePendingWorstCase(traceId, reservedUsd);
    // An aborted parallel lane may report after finish() released its reservation.
    // Every dispatch settles once; an orphan callback must not release another row.
    if (!pending) return;
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    const worstCaseUsd = pending.usd;
    const usageKnown = hasPricedUsage(usage) && pricingModel !== "unknown";
    const measuredUsd = usageKnown
      ? (calculateLlmCostDetails(usage!, { model: pricingModel }).total ?? 0)
      : null;
    const unresolvedAttempts = usageKnown ? attempts - 1 : attempts;
    const unresolvedAllowanceUsd =
      (worstCaseUsd / maxAttempts) * unresolvedAttempts;
    const call: PlannerModelCall = {
      model,
      pricingModel,
      status,
      ok,
      usageKnown: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      estimatedCostUsd: 0,
      measuredCostUsd: measuredUsd,
      unresolvedAttempts,
      unresolvedAllowanceUsd,
    };
    if (usageKnown && usage) {
      call.usageKnown = true;
      call.inputTokens = usage.input ?? 0;
      call.outputTokens = usage.output ?? 0;
      call.totalTokens = usage.total ?? call.inputTokens + call.outputTokens;
      call.cachedInputTokens = usage.cachedInput ?? 0;
      summary.usageCalls += 1;
      summary.inputTokens += call.inputTokens;
      summary.outputTokens += call.outputTokens;
      summary.totalTokens += call.totalTokens;
      summary.cachedInputTokens += call.cachedInputTokens;
    }
    call.estimatedCostUsd =
      (measuredUsd ?? 0) +
      (this.spendMode === "conservative"
        ? usageKnown
          ? unresolvedAllowanceUsd
          : worstCaseUsd
        : 0);
    call.estimatedCostUsd =
      Math.round(call.estimatedCostUsd * 1_000_000) / 1_000_000;
    summary.estimatedCostUsd += call.estimatedCostUsd;
    summary.knownUsageUsd = (summary.knownUsageUsd ?? 0) + (measuredUsd ?? 0);
    summary.modelCalls.push(call);
    this.byTrace.set(traceId, summary);
    this.onCost?.(
      call.estimatedCostUsd,
      worstCaseUsd,
      {
        model,
        measuredUsd,
        unresolvedAttempts,
        unresolvedAllowanceUsd,
        reason:
          attempts > maxAttempts ? "upstream_attempts_exceed_dispatch_ceiling" : pricingModel === "unknown"
            ? "response_model_unreported_and_route_ambiguous"
            : unresolvedAttempts > 0
              ? usageKnown
                ? "upstream_retry_usage_unmetered_or_attempt_count_unknown"
                : "response_usage_missing_or_incomplete"
              : null,
      },
      { traceId, kind: pending.kind },
    );
  }

  private pricingModel(model: string, fallbackModel: string): string {
    // Azure payload `model` may name the base model rather than the deployment.
    // That endpoint routes every lane to the configured, priced alias.
    return process.env.LLM_PROVIDER?.trim().toLowerCase() === "azure" &&
      fallbackModel !== "unknown" &&
      fallbackModel === process.env.AZURE_OPENAI_DEPLOYMENT?.trim()
      ? fallbackModel
      : model;
  }

  private upstreamAttempts(response: Response, maxAttempts: number): number {
    const raw = response.headers.get("x-heytutor-upstream-attempts");
    const attempts = raw === null ? maxAttempts : Number(raw);
    return Number.isSafeInteger(attempts) && attempts >= 1
      ? attempts
      : maxAttempts;
  }

  recordFailure(
    traceId: string,
    model = "unknown",
    reservedUsd?: number,
  ): void {
    const pending = this.pendingWorstCaseByTrace
      .get(traceId)
      ?.find((call) => reservedUsd === undefined || call.usd === reservedUsd);
    this.recordParsedResponse(
      traceId,
      0,
      false,
      model,
      null,
      reservedUsd,
      pending?.maxAttempts ?? 1,
      pending?.maxAttempts ?? 1,
    );
  }

  finish(traceId: string): PlannerUsageSummary {
    for (const pending of [
      ...(this.pendingWorstCaseByTrace.get(traceId) ?? []),
    ])
      this.recordFailure(traceId, "unknown", pending.usd);
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    this.byTrace.delete(traceId);
    this.pendingWorstCaseByTrace.delete(traceId);
    this.pendingResponsesByTrace.delete(traceId);
    this.finishedTraces.add(traceId);
    return {
      ...summary,
      estimatedCostUsd:
        Math.round(summary.estimatedCostUsd * 1_000_000) / 1_000_000,
      modelCalls: summary.modelCalls.map((call) => ({ ...call })),
    };
  }

  private takePendingWorstCase(
    traceId: string,
    reservedUsd?: number,
  ):
    | { usd: number; kind: "planner" | "teaching"; maxAttempts: number }
    | undefined {
    const pending = this.pendingWorstCaseByTrace.get(traceId);
    const index =
      reservedUsd === undefined
        ? 0
        : (pending?.findIndex((call) => call.usd === reservedUsd) ?? -1);
    const value = index >= 0 ? pending?.splice(index, 1)[0] : undefined;
    if (!pending || pending.length === 0)
      this.pendingWorstCaseByTrace.delete(traceId);
    return value;
  }
}
