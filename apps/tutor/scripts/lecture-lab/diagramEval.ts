import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import { parseProviderUsage } from "../../lib/obs/providerUsage";

export type DiagramEvalArm = "current" | "planner_first" | "planner_examples";
export type DiagramEmptyCause =
  | "not_needed"
  | "not_attempted"
  | "planner_no_output"
  | "candidates_invalid"
  | "declined_unreadable"
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
}): DiagramEmptyCause | null {
  if (input.committed) return null;
  if (input.visualRequirement === "none") return "not_needed";
  if (input.deadlineRemainingMs <= 1_000) return "deadline";
  if (input.plannerCalls === 0) return "not_attempted";
  if (input.candidateCount === 0 && input.candidateErrorCodes.length === 0) {
    return "planner_no_output";
  }
  if (input.candidateErrorCodes.length > 0) return "candidates_invalid";
  if (input.declinedUnreadable && input.primitiveCount > 0) return "declined_unreadable";
  // A planner candidate existed but did not become a verified compiled figure.
  // Validation normally supplies the specific error code; keep the cause honest
  // even if an older record did not retain that diagnostic.
  return "candidates_invalid";
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
 * Preflight estimate, not a billing promise: current assumes three planner
 * calls per row, planner-first five, at representative prompt/output sizes.
 * The run record stores measured provider usage once the calls finish.
 */
export function estimateEvaluationCostUsd(rowCount: number, arm: DiagramEvalArm): number {
  const calls = rowCount * (arm === "current" ? 3 : 5);
  return calculateLlmCostDetails(
    { input: calls * 3_500, output: calls * 1_800 },
    { model: "accounts/fireworks/models/kimi-k3" },
  ).total ?? 0;
}

/** Evaluation turns explicitly leave the production/default Fast behavior alone. */
export function evaluationRunFastMode(isEvaluation: boolean): false | undefined {
  return isEvaluation ? false : undefined;
}

export function evaluationSelectionOrder(arm: DiagramEvalArm): "current" | "planner_first" {
  return arm === "current" ? "current" : "planner_first";
}

export function assertEvaluationCostAllowed(estimatedUsd: number, confirmed: boolean): void {
  if (estimatedUsd > 5 && !confirmed) {
    throw new Error(`estimated planner cost is $${estimatedUsd.toFixed(2)}; rerun with --yes to allow a round above US$5`);
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

  recordRequest(traceId: string): void {
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    summary.calls += 1;
    this.byTrace.set(traceId, summary);
  }

  async recordResponse(traceId: string, response: Response): Promise<void> {
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    const model = response.headers.get("x-heytutor-planner-model") ?? "unknown";
    const call: PlannerModelCall = {
      model,
      status: response.status,
      ok: response.ok,
      usageKnown: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      estimatedCostUsd: 0,
    };
    try {
      const payload = await response.clone().json() as { usage?: unknown };
      const usage = parseProviderUsage(payload.usage);
      if (usage.known) {
        call.usageKnown = true;
        call.inputTokens = usage.input ?? 0;
        call.outputTokens = usage.output ?? 0;
        call.totalTokens = usage.total ?? call.inputTokens + call.outputTokens;
        call.cachedInputTokens = usage.cachedInput ?? 0;
        call.estimatedCostUsd = calculateLlmCostDetails(usage, { model }).total ?? 0;
        summary.usageCalls += 1;
        summary.inputTokens += call.inputTokens;
        summary.outputTokens += call.outputTokens;
        summary.totalTokens += call.totalTokens;
        summary.cachedInputTokens += call.cachedInputTokens;
        summary.estimatedCostUsd += call.estimatedCostUsd;
      }
    } catch {
      // A planner call still counts when its provider omitted or malformed usage.
    }
    call.estimatedCostUsd = Math.round(call.estimatedCostUsd * 1_000_000) / 1_000_000;
    summary.modelCalls.push(call);
    this.byTrace.set(traceId, summary);
  }

  finish(traceId: string): PlannerUsageSummary {
    const summary = this.byTrace.get(traceId) ?? emptyUsage();
    this.byTrace.delete(traceId);
    return {
      ...summary,
      estimatedCostUsd: Math.round(summary.estimatedCostUsd * 1_000_000) / 1_000_000,
      modelCalls: summary.modelCalls.map((call) => ({ ...call })),
    };
  }
}
