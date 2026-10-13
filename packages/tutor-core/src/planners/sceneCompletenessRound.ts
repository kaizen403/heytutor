/**
 * One completeness round on the chosen valid planner figure.
 *
 * After the search has chosen a valid candidate (and the authority
 * revalidation has run), the checklist may still find items the figure does
 * not show. If there is time and request budget left, one planner call sends
 * the whole valid document plus a numbered list of at most six missing items
 * and asks for exactly those additions. The reply is validated by the same
 * production validator as every candidate. It replaces the figure only if it
 * is valid, shows a scene, misses strictly fewer items, and keeps every old
 * entity id and every old visible label text. Anything else (no reply, a
 * timeout, an invalid or less complete reply, a lost id or label) keeps the
 * original figure. The round never drops a figure and never runs past the
 * figure deadline.
 *
 * Both the live hook and the lecture lab reach this through
 * runScenePlanningOverlap, so the lab measures what students get.
 */
import {
  sceneEntityIds,
  sceneVisibleTexts,
  type CompletenessCompiledScene,
  type CompletenessItem,
  type CompletenessSceneDocument,
  type SceneCompletenessResult,
} from "./sceneCompleteness";
import {
  completeSceneDocument,
  sceneCandidateValidationScore,
  type SceneCandidateValidation,
  type SceneCandidateValidator,
  type ScenePlannerOptions,
  type ScenePlannerResponse,
  type ScenePlanWithRepairResult,
} from "./scenePlannerV2";

/** The round starts only with at least this much of the figure deadline left. */
export const SCENE_COMPLETENESS_MIN_REMAINING_MS = 20_000;
/** Kept free at the end of the deadline for validating the reply. */
export const SCENE_COMPLETENESS_DEADLINE_MARGIN_MS = 3_000;
/** The one completeness call never waits longer than this. */
export const SCENE_COMPLETENESS_CALL_MAX_MS = 20_000;

/** What a validated candidate must expose for the round to read it. */
export interface CompletableSceneValue {
  document: CompletenessSceneDocument & { visualDecision?: { mode?: string } };
  renderScene?: CompletenessCompiledScene | null;
  completeness?: SceneCompletenessResult | null;
}

export type SceneCompletenessRoundOutcome =
  /** The checklist finds nothing missing. */
  | "complete"
  /** The chosen candidate is a text-only decline: there is no figure to complete. */
  | "not_scene"
  /** Less than SCENE_COMPLETENESS_MIN_REMAINING_MS of the deadline left. */
  | "skipped_deadline"
  /** The turn's shared planner request budget is spent. */
  | "skipped_budget"
  /** The turn was cancelled before the round started. */
  | "skipped_aborted"
  /** The reply replaced the figure. */
  | "replaced"
  /** No parseable reply: failure, timeout or abort. The original is kept. */
  | "timeout"
  /** The reply failed production validation or is not a scene. */
  | "invalid"
  /** The reply misses as many items as the original, or more. */
  | "not_more_complete"
  /** The reply dropped an old entity id or an old label text. */
  | "lost_content";

export interface SceneCompletenessRoundRecord {
  /** A completeness call was sent. */
  attempted: boolean;
  /** The reply replaced the figure. */
  accepted: boolean;
  outcome: SceneCompletenessRoundOutcome;
  /** Items the chosen figure missed before the round, in priority order. */
  itemsMissingBefore: string[];
  /** Items named in the request (at most six). */
  itemsRequested: string[];
  /** Items the kept figure still misses. */
  itemsStillMissing: string[];
  /** Missing count of a valid reply; null without one. */
  replyMissingCount: number | null;
  /** Old entity ids and label texts the reply dropped. */
  lostIds: string[];
  lostLabels: string[];
  /** Fatal codes of an invalid reply. */
  replyErrorCodes: string[];
  /** Deadline left when the round was considered. */
  remainingMsAtStart: number;
  /** Time the round added, including validation of the reply. */
  extraMs: number;
}

export interface SceneCompletionDecision {
  accept: boolean;
  outcome: Extract<SceneCompletenessRoundOutcome, "replaced" | "timeout" | "invalid" | "not_more_complete" | "lost_content">;
  replyMissingCount: number | null;
  lostIds: string[];
  lostLabels: string[];
}

const missingCount = (value: CompletableSceneValue | undefined): number | null =>
  value?.completeness ? value.completeness.missing.length : null;

/**
 * The replacement rule. The reply wins only if it is valid, is a scene,
 * misses strictly fewer checklist items, and keeps every old entity id and
 * every old visible label text. Every other case keeps the original.
 */
export function decideSceneCompletion<T extends CompletableSceneValue>(
  original: SceneCandidateValidation<T>,
  reply: SceneCandidateValidation<T> | null,
): SceneCompletionDecision {
  const keep = (
    outcome: SceneCompletionDecision["outcome"],
    extra: Partial<SceneCompletionDecision> = {},
  ): SceneCompletionDecision => ({ accept: false, outcome, replyMissingCount: null, lostIds: [], lostLabels: [], ...extra });
  if (!reply) return keep("timeout");
  const before = original.value;
  const after = reply.value;
  if (!reply.valid || !after || after.document.visualDecision?.mode !== "scene") return keep("invalid");
  const oldMissing = missingCount(before);
  const newMissing = missingCount(after);
  const newIds = new Set(sceneEntityIds(after.document));
  const lostIds = before ? sceneEntityIds(before.document).filter((id) => !newIds.has(id)) : [];
  const newLabels = new Set(sceneVisibleTexts(after.document, after.renderScene).map(normalizeLabel));
  const lostLabels = before
    ? [...new Set(sceneVisibleTexts(before.document, before.renderScene))].filter((text) => !newLabels.has(normalizeLabel(text)))
    : [];
  const detail = { replyMissingCount: newMissing, lostIds, lostLabels };
  if (oldMissing === null || newMissing === null || newMissing >= oldMissing) return keep("not_more_complete", detail);
  if (lostIds.length > 0 || lostLabels.length > 0) return keep("lost_content", detail);
  return { accept: true, outcome: "replaced", ...detail };
}

/** Whether the round may send its one call, and why not. */
export function sceneCompletenessRoundGate(input: {
  missing: number;
  isScene: boolean;
  remainingMs: number;
  budgetLeft: number;
  aborted: boolean;
}): "run" | Extract<SceneCompletenessRoundOutcome, "complete" | "not_scene" | "skipped_deadline" | "skipped_budget" | "skipped_aborted"> {
  if (!input.isScene) return "not_scene";
  if (input.missing === 0) return "complete";
  if (input.aborted) return "skipped_aborted";
  if (input.remainingMs < SCENE_COMPLETENESS_MIN_REMAINING_MS) return "skipped_deadline";
  if (input.budgetLeft < 1) return "skipped_budget";
  return "run";
}

export interface SceneCompletenessRoundOptions extends ScenePlannerOptions {
  /** Milliseconds left on the turn's figure deadline. */
  remainingMs: number;
  /** Shared by every scene request of the turn; the call spends one. */
  requestBudget?: { remaining: number };
  now?: () => number;
}

/**
 * Run the round on a finished planner result. Returns the result unchanged
 * (record null) when it holds no valid figure with a checklist.
 */
export async function completeScenePlanWithRepairResult<T extends CompletableSceneValue>(
  question: string,
  result: ScenePlanWithRepairResult<T>,
  validate: SceneCandidateValidator<T>,
  options: SceneCompletenessRoundOptions,
): Promise<{ result: ScenePlanWithRepairResult<T>; record: SceneCompletenessRoundRecord | null }> {
  const { remainingMs, requestBudget, now = Date.now, ...plannerOptions } = options;
  const startedAt = now();
  const original = result.validation;
  const value = original.valid ? original.value : undefined;
  if (!value?.completeness) return { result, record: null };
  const missing = value.completeness.missing;
  const texts = (items: readonly CompletenessItem[]) => items.map((item) => item.text);
  const record: SceneCompletenessRoundRecord = {
    attempted: false,
    accepted: false,
    outcome: "complete",
    itemsMissingBefore: texts(missing),
    itemsRequested: [],
    itemsStillMissing: texts(missing),
    replyMissingCount: null,
    lostIds: [],
    lostLabels: [],
    replyErrorCodes: [],
    remainingMsAtStart: remainingMs,
    extraMs: 0,
  };
  const gate = sceneCompletenessRoundGate({
    missing: missing.length,
    isScene: value.document.visualDecision?.mode === "scene",
    remainingMs,
    budgetLeft: requestBudget?.remaining ?? Number.POSITIVE_INFINITY,
    aborted: plannerOptions.signal?.aborted ?? false,
  });
  if (gate !== "run") {
    record.outcome = gate;
    return { result, record };
  }

  const requested = value.completeness.request;
  record.attempted = true;
  record.itemsRequested = texts(requested);
  if (requestBudget) requestBudget.remaining -= 1;
  const timeoutMs = Math.max(1, Math.min(remainingMs - SCENE_COMPLETENESS_DEADLINE_MARGIN_MS, SCENE_COMPLETENESS_CALL_MAX_MS));
  let reply: ScenePlannerResponse | null = null;
  try {
    reply = await completeSceneDocument(question, result.response.document, requested, { ...plannerOptions, timeoutMs });
  } catch {
    reply = null;
  }
  let replyValidation: SceneCandidateValidation<T> | null = null;
  if (reply && !plannerOptions.signal?.aborted) {
    try {
      replyValidation = await validate(reply.document);
    } catch {
      replyValidation = { valid: false, errors: [{ code: "completeness_reply_validation_failed", message: "The completeness reply could not be validated.", severity: "fatal" }] };
    }
    const observed = reply;
    const validation = replyValidation;
    try { plannerOptions.onCandidateValidation?.(observed, validation); } catch { /* Diagnostics never change the round. */ }
  }
  const decision = decideSceneCompletion(original, replyValidation);
  // A reply that arrived but was not validated (the turn was cancelled) is a timeout.
  record.outcome = reply && !replyValidation ? "timeout" : decision.outcome;
  record.accepted = decision.accept;
  record.replyMissingCount = decision.replyMissingCount;
  record.lostIds = decision.lostIds;
  record.lostLabels = decision.lostLabels;
  record.replyErrorCodes = replyValidation && !replyValidation.valid
    ? [...new Set(replyValidation.errors.filter((error) => error.severity === "fatal").map((error) => error.code))]
    : [];
  record.itemsStillMissing = decision.accept
    ? texts(replyValidation?.value?.completeness?.missing ?? [])
    : texts(missing);
  record.extraMs = now() - startedAt;

  if (!reply || !replyValidation) return { result, record };
  const replyCandidate = {
    candidateId: `candidate-${result.candidates.length + 1}`,
    response: reply,
    validation: replyValidation,
    score: sceneCandidateValidationScore(replyValidation),
    selected: decision.accept,
  };
  const candidates = [
    ...result.candidates.map((candidate) => decision.accept ? { ...candidate, selected: false } : candidate),
    replyCandidate,
  ];
  if (!decision.accept) return { result: { ...result, candidates }, record };
  return {
    result: {
      ...result,
      response: reply,
      validation: replyValidation,
      selectedFromRepair: false,
      candidates,
    },
    record,
  };
}

function normalizeLabel(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}
