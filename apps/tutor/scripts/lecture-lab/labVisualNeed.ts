/** Live-matching visual-need evidence, replay identity and pre-dispatch accounting. */
import { createHash } from "node:crypto";
import { inferSceneCapabilities, normalizeTutorQuestion, questionRequiresVisual } from "@heytutor/tutor-core";
import type { VisualRequirement } from "@heytutor/scene-engine";
import { VISUAL_NEED_SERVER_TIMEOUT_MS } from "../../lib/llm/visualNeedPolicy";
import { EVALUATION_POLICY_VERSION, JEV_GATEWAY_MODEL } from "../../lib/llm/evaluation/types";
import { rubricVersionForJob } from "../../lib/llm/evaluation/rubrics";
import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import { VISUAL_NEED_CLIENT_TIMEOUT_MS, VISUAL_NEED_EVIDENCE_VERSION, visualNeedAssessmentFromResponse,
  type VisualNeedAssessment } from "../../features/tutor-session/lib/scene/visualNeedClient";
import { resolveVisualRequirement } from "../../features/tutor-session/lib/scene/visualRequirement";

export const LAB_VISUAL_NEED_POLICY = {
  evidenceVersion: VISUAL_NEED_EVIDENCE_VERSION,
  model: JEV_GATEWAY_MODEL,
  rubricVersion: rubricVersionForJob("visual_need"),
  policyVersion: EVALUATION_POLICY_VERSION,
  clientTimeoutMs: VISUAL_NEED_CLIENT_TIMEOUT_MS,
  serverTimeoutMs: VISUAL_NEED_SERVER_TIMEOUT_MS,
} as const;

export interface LabVisualNeedEvidence {
  plannerRequirement: VisualRequirement | null;
  assessment: VisualNeedAssessment;
  mergedRequirement: VisualRequirement | null;
  origin: "live_service" | "frozen_replay";
  questionHash: string;
  policy: typeof LAB_VISUAL_NEED_POLICY;
  /** Only for a new live-service call; replay never charges the old answer twice. */
  accounting?: VisualNeedCallAccounting;
}

export interface VisualNeedReplayRow {
  id: string;
  questionHash: string;
  evidenceVersion: string;
  model: string;
  rubricVersion: string;
  policyVersion: string;
  clientTimeoutMs: number;
  serverTimeoutMs: number;
  assessment: VisualNeedAssessment;
}

export function visualNeedQuestionHash(question: string): string {
  return createHash("sha256").update(normalizeTutorQuestion(question)).digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Require a frozen answer for every requested question; no silent live-call fallback. */
export function parseVisualNeedReplay(jsonl: string, requested: readonly { id: string; question: string }[]): Map<string, VisualNeedAssessment> {
  const replay = new Map<string, { questionHash: string; assessment: VisualNeedAssessment }>();
  for (const line of jsonl.split(/\r?\n/).filter((line) => line.trim())) {
    const value: unknown = JSON.parse(line);
    if (!record(value) || typeof value.id !== "string" || typeof value.questionHash !== "string" || !record(value.assessment)) {
      throw new Error("invalid visual-need replay record");
    }
    if (replay.has(value.id)) throw new Error(`duplicate visual-need replay id: ${value.id}`);
    for (const [key, expected] of Object.entries(LAB_VISUAL_NEED_POLICY)) {
      if (value[key] !== expected) throw new Error(`visual-need replay policy/model mismatch: ${key}`);
    }
    const assessment = visualNeedAssessmentFromResponse(value.assessment);
    if (assessment.source !== value.assessment.source || assessment.decision !== value.assessment.decision ||
      assessment.unavailableReason !== value.assessment.unavailableReason ||
      (assessment.source === "jev" && (!assessment.provenance || assessment.provenance.model !== JEV_GATEWAY_MODEL ||
        assessment.provenance.rubricVersion !== LAB_VISUAL_NEED_POLICY.rubricVersion ||
        assessment.provenance.policyVersion !== LAB_VISUAL_NEED_POLICY.policyVersion))) {
      throw new Error(`invalid visual-need replay assessment: ${value.id}`);
    }
    replay.set(value.id, { questionHash: value.questionHash, assessment });
  }
  const output = new Map<string, VisualNeedAssessment>();
  for (const row of requested) {
    const saved = replay.get(row.id);
    if (!saved || saved.questionHash !== visualNeedQuestionHash(row.question)) {
      throw new Error(`visual-need replay missing or changed question: ${row.id}`);
    }
    output.set(row.id, saved.assessment);
  }
  return output;
}

export function visualNeedActionChange(prior: VisualRequirement | null, merged: VisualRequirement, drawn: boolean):
  "allow_previously_skipped" | "skip_previously_drawn" | null {
  if (prior === null) return null;
  if (prior === "none" && merged !== "none" && !drawn) return "allow_previously_skipped";
  if (prior !== "none" && merged === "none" && drawn) return "skip_previously_drawn";
  return null;
}

export interface HistoricalVisualNeedRow {
  question: string;
  requirement: VisualRequirement | null;
  committed: boolean;
}

function emptyComparisonCounts() {
  return { rows: 0, missingHistorical: 0, missingHistoricalVote: 0, jevUntested: 0,
    jevUnavailable: 0, compared: 0, requirementChanged: 0, allowPreviouslySkipped: 0, skipPreviouslyDrawn: 0 };
}

/** Historical final votes are explicitly proxies: old runs did not retain the pre-Jev raw vote. */
export function compareVisualNeedAudit<T extends { id: string; question: string; subject: string; figure_need: VisualRequirement }>(
  rows: readonly T[], assessments: ReadonlyMap<string, VisualNeedAssessment>,
  historical: Record<string, ReadonlyMap<string, HistoricalVisualNeedRow>>,
) {
  const byArm: Record<string, ReturnType<typeof emptyComparisonCounts> & {
    bySubject: Record<string, ReturnType<typeof emptyComparisonCounts>>;
    byFigureNeed: Record<string, ReturnType<typeof emptyComparisonCounts>>;
  }> = {};
  const changedIds = new Set<string>();
  const records: Array<{ id: string; arm: string; historicalRequirement: VisualRequirement | null;
    mergedRequirement: VisualRequirement | null; historicalDrawn: boolean | null;
    actionChange: ReturnType<typeof visualNeedActionChange>; historicalVoteIsProxy: true }> = [];
  for (const [arm, stored] of Object.entries(historical)) {
    const totals: (typeof byArm)[string] = { ...emptyComparisonCounts(), bySubject: {}, byFigureNeed: {} };
    byArm[arm] = totals;
    for (const row of rows) {
      const prior = stored.get(row.id);
      if (prior && normalizeTutorQuestion(prior.question) !== normalizeTutorQuestion(row.question)) {
        throw new Error(`historical question changed: ${arm}/${row.id}`);
      }
      const assessment = assessments.get(row.id);
      const counts = [totals, totals.bySubject[row.subject] ??= emptyComparisonCounts(),
        totals.byFigureNeed[row.figure_need] ??= emptyComparisonCounts()];
      let merged: VisualRequirement | null = null;
      let action: ReturnType<typeof visualNeedActionChange> = null;
      for (const count of counts) {
        count.rows += 1;
        if (!prior) count.missingHistorical += 1;
        else if (prior.requirement === null) count.missingHistoricalVote += 1;
        if (!assessment) count.jevUntested += 1;
        else if (assessment.source === "unavailable") count.jevUnavailable += 1;
      }
      if (prior?.requirement && assessment) {
        const question = normalizeTutorQuestion(row.question);
        merged = resolveVisualRequirement(prior.requirement, assessment.decision,
          questionRequiresVisual(question), inferSceneCapabilities(question).hasSourceProgram === true);
        action = visualNeedActionChange(prior.requirement, merged, prior.committed);
        for (const count of counts) {
          count.compared += 1;
          if (merged !== prior.requirement) count.requirementChanged += 1;
          if (action === "allow_previously_skipped") count.allowPreviouslySkipped += 1;
          if (action === "skip_previously_drawn") count.skipPreviouslyDrawn += 1;
        }
        if (action) changedIds.add(row.id);
      }
      records.push({ id: row.id, arm, historicalRequirement: prior?.requirement ?? null,
        mergedRequirement: merged, historicalDrawn: prior?.committed ?? null, actionChange: action, historicalVoteIsProxy: true });
    }
  }
  return { records, changedRows: rows.filter((row) => changedIds.has(row.id)),
    summary: { historicalVoteBasis: "saved final requirement proxy; pre-service raw planner vote unavailable", byArm,
      actionChangedUnion: changedIds.size } };
}

/** Same Jev reservation as the server; one dispatch, no retry, zero output price. */
export function visualNeedRequestWorstCaseUsd(init?: RequestInit): number {
  if (typeof init?.body !== "string") throw new Error("visual-need budgeting requires the exact JSON request body");
  const inputTokens = new TextEncoder().encode(init.body).length + 2_048;
  return (calculateLlmCostDetails({ input: inputTokens, output: 0 }, { model: JEV_GATEWAY_MODEL }).total ?? 0) + 0.002;
}

export interface VisualNeedCallAccounting {
  /** Distinguish a local HTTP denial from an upstream unavailable reason in a 200 reply. */
  httpStatus: number | null;
  chargedUsd: number;
  reservedUsd: number;
  knownUsage: boolean;
  inputTokens: number;
  outputTokens: number;
  unavailableReason: string | null;
}

export interface VisualNeedBudgetHooks {
  reserve: (usd: number) => boolean;
  beforeDispatch: () => void;
  settle: (reservedUsd: number, chargedUsd: number) => void;
  onAccounting: (record: VisualNeedCallAccounting) => void;
  onDenied: () => void;
}

export async function budgetedVisualNeedFetch(input: RequestInfo | URL, init: RequestInit | undefined,
  fetchImpl: typeof fetch, hooks: VisualNeedBudgetHooks): Promise<Response> {
  const reservedUsd = visualNeedRequestWorstCaseUsd(init);
  if (!hooks.reserve(reservedUsd)) {
    hooks.onDenied();
    throw new Error("visual-need denied before sending: --max-usd reservation exhausted");
  }
  let settled = false;
  const account = (entry: Omit<VisualNeedCallAccounting, "reservedUsd">) => {
    hooks.settle(reservedUsd, entry.chargedUsd);
    settled = true;
    hooks.onAccounting({ ...entry, reservedUsd });
  };
  try {
    hooks.beforeDispatch();
    const response = await fetchImpl(input, init);
    let assessment: VisualNeedAssessment | null = null;
    try { assessment = visualNeedAssessmentFromResponse(await response.clone().json()); } catch { /* unknown usage */ }
    const knownUsage = assessment?.usage?.knownUsage === true && assessment.provenance?.model === JEV_GATEWAY_MODEL;
    const provedNoDispatch = response.ok && assessment?.source === "unavailable" &&
      (assessment.unavailableReason === "missing_key" || assessment.unavailableReason === "circuit_open");
    const chargedUsd = knownUsage && assessment?.usage
      ? Math.max(calculateLlmCostDetails({ input: assessment.usage.inputTokens, output: assessment.usage.outputTokens },
        { model: JEV_GATEWAY_MODEL }).total ?? reservedUsd, assessment.usage.reportedCostUsd ?? 0)
      : provedNoDispatch ? 0 : reservedUsd;
    account({ chargedUsd, knownUsage, httpStatus: response.status, inputTokens: knownUsage ? assessment!.usage!.inputTokens : 0,
      outputTokens: knownUsage ? assessment!.usage!.outputTokens : 0,
      unavailableReason: response.ok ? assessment?.unavailableReason ?? null : `http_${response.status}` });
    return response;
  } catch (error) {
    if (!settled) account({ chargedUsd: reservedUsd, knownUsage: false, httpStatus: null, inputTokens: 0, outputTokens: 0, unavailableReason: "transport" });
    throw error;
  }
}

export function summarizeVisualNeedCalls(calls: readonly VisualNeedCallAccounting[]) {
  const unavailableCounts: Record<string, number> = {};
  for (const call of calls) if (call.unavailableReason) unavailableCounts[call.unavailableReason] = (unavailableCounts[call.unavailableReason] ?? 0) + 1;
  return { provider: "vercel_ai_gateway", ...LAB_VISUAL_NEED_POLICY, calls: calls.length,
    knownUsageCalls: calls.filter((call) => call.knownUsage).length,
    unknownUsageCalls: calls.filter((call) => !call.knownUsage && call.chargedUsd > 0).length,
    chargedUsd: calls.reduce((sum, call) => sum + call.chargedUsd, 0),
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0), unavailableCounts };
}
