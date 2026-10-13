/**
 * One completeness round on the chosen valid planner figure.
 *
 * After the search has chosen a valid candidate (and the authority
 * revalidation has run), the checklist may still find items the figure does
 * not show. If there is time and request budget left, one planner call sends
 * the whole valid document plus a numbered list of at most six missing items
 * and asks for exactly those additions. The reply is validated by the same
 * production validator as every candidate. It replaces the figure only if it
 * is valid, shows a scene, misses strictly fewer items, keeps every old
 * entity id and every old visible label text, and changes nothing it had:
 * every old construction keeps its operator, inputs and outputs, every old
 * label or mark keeps its targets and text, every old entity its kind and
 * label, every old quantity its value and unit. The reply may only add.
 * Anything else (no reply, a timeout, an invalid or less complete reply, a
 * lost id or label, changed geometry or a moved label) keeps the original
 * figure. The round never drops a figure and never runs past the figure
 * deadline.
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
  | "lost_content"
  /** The reply changed an old construction, label target, entity kind or quantity. */
  | "changed_content";

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
  /** What the reply changed in the old document ("construction pC: inputs", "annotation l1: targetIds"). */
  changedContent: string[];
  /** Fatal codes of an invalid reply. */
  replyErrorCodes: string[];
  /** Deadline left when the round was considered. */
  remainingMsAtStart: number;
  /** Time the round added, including validation of the reply. */
  extraMs: number;
}

export interface SceneCompletionDecision {
  accept: boolean;
  outcome: Extract<SceneCompletenessRoundOutcome, "replaced" | "timeout" | "invalid" | "not_more_complete" | "lost_content" | "changed_content">;
  replyMissingCount: number | null;
  lostIds: string[];
  lostLabels: string[];
  changedContent: string[];
}

const missingCount = (value: CompletableSceneValue | undefined): number | null =>
  value?.completeness ? value.completeness.missing.length : null;

/** Numbers this close are the same input: a model that rounds a long float when it copies the document has not moved anything. */
const SAME_NUMBER_TOLERANCE = 1e-3;

function sameNumber(first: number, second: number): boolean {
  return Math.abs(first - second) <= SAME_NUMBER_TOLERANCE * Math.max(1, Math.abs(first), Math.abs(second));
}

const numeric = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value
    : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

/** Structural equality: same keys, same order in arrays, strings after label normalisation, numbers within the tolerance. */
function sameValue(first: unknown, second: unknown): boolean {
  const a = numeric(first);
  const b = numeric(second);
  if (a !== null || b !== null) return a !== null && b !== null && sameNumber(a, b);
  if (typeof first === "string" && typeof second === "string") return normalizeLabel(first) === normalizeLabel(second);
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length &&
      first.every((item, index) => sameValue(item, second[index]));
  }
  if (first && second && typeof first === "object" && typeof second === "object") {
    const keys = (value: object) => Object.entries(value).filter(([, item]) => item !== undefined && item !== null).map(([key]) => key).sort();
    const firstKeys = keys(first);
    const secondKeys = keys(second);
    return firstKeys.length === secondKeys.length && firstKeys.every((key, index) => key === secondKeys[index] &&
      sameValue((first as Record<string, unknown>)[key], (second as Record<string, unknown>)[key]));
  }
  return (first ?? null) === (second ?? null);
}

/**
 * What a reply changed in the original document, as "construction pC: inputs"
 * style entries; empty when the reply only adds. Compared by id: every old
 * construction keeps its operator, inputs and outputs; every old annotation
 * other than narration keeps its kind, targets, text and bound quantity; every
 * old entity keeps its kind and its label; every old quantity keeps its value
 * and unit. Removed constructions and annotations count as changes (removed
 * entity ids and label texts are reported as lost content).
 */
export function sceneDocumentChanges(before: CompletenessSceneDocument, after: CompletenessSceneDocument): string[] {
  const changes: string[] = [];
  const byId = <V extends { id?: unknown }>(items: readonly V[] | undefined) =>
    new Map((items ?? []).map((item) => [String(item.id ?? ""), item] as const));
  const afterConstructions = byId(after.constructions);
  for (const construction of before.constructions ?? []) {
    const id = String(construction.id ?? "");
    const reply = afterConstructions.get(id);
    if (!reply) {
      changes.push(`construction ${id}: removed`);
      continue;
    }
    for (const field of ["operator", "inputs", "outputs"] as const) {
      if (!sameValue(construction[field], reply[field])) changes.push(`construction ${id}: ${field}`);
    }
  }
  const afterAnnotations = byId(after.annotations);
  for (const annotation of before.annotations ?? []) {
    if (annotation.kind === "narration") continue;
    const id = String(annotation.id ?? "");
    const reply = afterAnnotations.get(id);
    if (!reply) {
      changes.push(`annotation ${id}: removed`);
      continue;
    }
    for (const field of ["kind", "targetIds", "text", "quantityId"] as const) {
      if (!sameValue(annotation[field], reply[field])) changes.push(`annotation ${id}: ${field}`);
    }
  }
  const afterEntities = byId(after.entities);
  for (const entity of before.entities ?? []) {
    const reply = afterEntities.get(String(entity.id ?? ""));
    if (!reply) continue;
    if (!sameValue(entity.kind, reply.kind)) changes.push(`entity ${entity.id}: kind`);
    if (entity.label && !sameValue(entity.label, reply.label)) changes.push(`entity ${entity.id}: label`);
  }
  const afterQuantities = byId(after.quantities);
  for (const quantity of before.quantities ?? []) {
    const reply = afterQuantities.get(String(quantity.id ?? ""));
    if (!reply) {
      changes.push(`quantity ${quantity.id}: removed`);
      continue;
    }
    for (const field of ["value", "unit"] as const) {
      if (!sameValue(quantity[field], reply[field])) changes.push(`quantity ${quantity.id}: ${field}`);
    }
  }
  return changes;
}

/**
 * The replacement rule. The reply wins only if it is valid, is a scene,
 * misses strictly fewer checklist items, keeps every old entity id and every
 * old visible label text, and changes nothing the original had (see
 * sceneDocumentChanges). Every other case keeps the original.
 */
export function decideSceneCompletion<T extends CompletableSceneValue>(
  original: SceneCandidateValidation<T>,
  reply: SceneCandidateValidation<T> | null,
): SceneCompletionDecision {
  const keep = (
    outcome: SceneCompletionDecision["outcome"],
    extra: Partial<SceneCompletionDecision> = {},
  ): SceneCompletionDecision => ({ accept: false, outcome, replyMissingCount: null, lostIds: [], lostLabels: [], changedContent: [], ...extra });
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
  const changedContent = before ? sceneDocumentChanges(before.document, after.document) : [];
  const detail = { replyMissingCount: newMissing, lostIds, lostLabels, changedContent };
  if (oldMissing === null || newMissing === null || newMissing >= oldMissing) return keep("not_more_complete", detail);
  if (lostIds.length > 0 || lostLabels.length > 0) return keep("lost_content", detail);
  if (changedContent.length > 0) return keep("changed_content", detail);
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
    changedContent: [],
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
  record.changedContent = decision.changedContent;
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
