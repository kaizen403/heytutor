import { tutorDebug } from "../tutorDebug";
import {
  buildSceneDocumentPlannerPrompt,
  SCENE_DOCUMENT_VERSION,
  type ScenePlannerPromptContext,
} from "./scenePlannerV2Prompt";

export type SceneDocumentCandidate = Record<string, unknown>;
export type ScenePlannerLane = "primary" | "alternate";

export interface SceneRepairError {
  code: string;
  message: string;
  severity: "fatal" | "warning";
  path?: string;
  entityIds?: string[];
  expected?: unknown;
  actual?: unknown;
  residual?: number;
  details?: Record<string, unknown>;
}

export interface SceneCandidateValidation<T = unknown> {
  valid: boolean;
  errors: SceneRepairError[];
  value?: T;
  /** Deterministic visual/minimality cost for valid candidates; lower wins. */
  qualityScore?: number;
}

export interface ScenePlannerResponse {
  document: SceneDocumentCandidate;
  rawContent: string;
  phase: "plan" | "repair";
  lane: ScenePlannerLane;
  elapsedMs: number;
  traceId?: string;
  strategy?: string;
}

export interface ScenePlannerOptions extends ScenePlannerPromptContext {
  proxyUrl: string;
  sessionId?: string;
  signal?: AbortSignal;
  /** Total plan/repair hard deadline. Defaults to sixty seconds. */
  timeoutMs?: number;
}

export interface ScenePlanWithRepairResult<T> {
  response: ScenePlannerResponse;
  validation: SceneCandidateValidation<T>;
  repaired: boolean;
  candidates: ScenePlanCandidateResult<T>[];
}

export interface ScenePlanCandidateResult<T> {
  candidateId: string;
  response: ScenePlannerResponse;
  validation: SceneCandidateValidation<T>;
  score: number;
  selected: boolean;
}

export type SceneCandidateValidator<T> = (
  document: SceneDocumentCandidate,
) => SceneCandidateValidation<T> | Promise<SceneCandidateValidation<T>>;

export const SCENE_PLANNER_TIMEOUT_MS = 60_000;
const PLANNER_MODEL = "accounts/fireworks/routers/kimi-k2p6-turbo";
const MAX_SCENE_REPAIR_ROUNDS = 2;
const REPAIR_CANDIDATES_PER_ROUND = 2;
const INITIAL_SCENE_CANDIDATES = 2;
const INITIAL_CANDIDATE_TIMEOUT_MS = 30_000;
const VALID_CANDIDATE_GRACE_MS = 750;

/** Plan a coordinate-free scene. Semantic validation belongs to scene-engine. */
export async function planSceneDocument(
  question: string,
  options: ScenePlannerOptions,
  strategy?: string,
  lane: ScenePlannerLane = "primary",
): Promise<ScenePlannerResponse | null> {
  const prompt = buildSceneDocumentPlannerPrompt(question, options);
  const response = await requestSceneDocument(
    "plan",
    strategy ? `${prompt}\n\nSYNTHESIS STRATEGY\n${strategy}` : prompt,
    options,
    lane,
  );
  return response
    ? {
        ...response,
        document: normalizeSceneDocumentModelOutput(response.document, question),
        strategy,
      }
    : null;
}

/**
 * Ask the planner for one complete replacement document using deterministic
 * validation failures. This never patches or trusts the invalid candidate.
 */
export async function repairSceneDocument(
  question: string,
  candidate: SceneDocumentCandidate,
  errors: readonly SceneRepairError[],
  options: ScenePlannerOptions,
  strategy = "Apply the smallest coherent correction that resolves every error.",
  lane: ScenePlannerLane = "primary",
): Promise<ScenePlannerResponse | null> {
  if (errors.length === 0) return null;

  const previousStructure = summarizeSceneCandidateForRepair(candidate);
  const prompt = `${buildSceneDocumentPlannerPrompt(question, options)}

REPAIR REQUEST
The previous candidate failed deterministic validation. Return a complete replacement document, not a patch. Rebuild the failing subgraph from the authoritative facts and supported operators.

PREVIOUS STRUCTURE
${JSON.stringify(previousStructure)}

STRUCTURED VALIDATION ERRORS
${JSON.stringify(errors)}

Resolve every fatal error. Preserve correct stable IDs when useful, but delete invalid, duplicate, or unnecessary entities. Keep consumed construction helpers out of visible ownership. Attach compact labels to their real target. Preserve authoritative claims and required proofs; repair geometry instead of weakening assertions. Return only the replacement JSON object.`;
  const connectivityGuidance = errors.some((error) =>
    (error.code === "assertion_failed" && /connect|path|terminal/i.test(error.message)) ||
    error.code === "turnplan_loop_member_not_proven",
  )
    ? "\nA failed connectivity or path assertion requires rebuilding the involved structural graph so adjacent paths/components share the exact same endpoint IDs. Visual proximity is not connectivity. Do not keep disconnected geometry and merely rewrite the assertion."
    : "";
  const closedRouteMembers = [...new Set(errors.flatMap((error) =>
    error.code === "turnplan_loop_member_not_proven" ? error.entityIds ?? [] : []))];
  const closedRouteGuidance = closedRouteMembers.length > 0
    ? `\nCLOSED-ROUTE REBUILD (mandatory): ${closedRouteMembers.join(", ")} must each be an edge of one non-degenerate closed route. Discard the old route geometry and rebuild it from one cyclic list of shared point IDs p0...pN. Adjacent members must reuse the exact same point ID; do not use duplicate coordinates, crossings, overlaps, on assertions, or a decorative polyline as connectivity. A component symbol replaces its side segment. Preserve the authoritative cardinal directions while choosing the route order.`
    : "";
  const bypassedMembers = [...new Set(errors.flatMap((error) =>
    error.code === "turnplan_loop_member_bypassed" ? error.entityIds ?? [] : []))];
  const bypassGuidance = bypassedMembers.length > 0
    ? `\nCOMPONENT BYPASS REMOVAL (mandatory): inspect ${bypassedMembers.join(", ")}. Keep each component symbol as the only edge between its two terminals and delete every ordinary segment/connect with the same terminal pair. Rebuild adjacent route members around the component's endpoints; do not redraw a wire through or behind the symbol.`
    : "";
  const orderedRouteGuidance = buildOrderedRouteRepairGuidance(errors, options.conversationContext);
  const pageNormalGuidance = errors.some((error) =>
    error.code === "physical_page_normal_rendered_in_plane" ||
    error.code === "physical_page_normal_direction_not_proven")
    ? "\nPAGE-NORMAL REBUILD (mandatory): retain the named field/vector entity and construct it with a point-id start plus direction [0,0,-1] for into-page or [0,0,1] for out-of-page. Give that construction exactly one output matching the entity ID. Do not substitute a 2D arrow or prose label."
    : "";
  const waveOpticsGuidance = buildWaveOpticsRepairGuidance(errors);
  const opticalInstrumentGuidance = buildOpticalInstrumentRepairGuidance(errors);

  const diversifiedPrompt = `${prompt}${connectivityGuidance}${closedRouteGuidance}${bypassGuidance}${orderedRouteGuidance}${pageNormalGuidance}${waveOpticsGuidance}${opticalInstrumentGuidance}\n\nREPAIR STRATEGY\n${strategy}`;

  const response = await requestSceneDocument("repair", diversifiedPrompt, options, lane);
  return response
    ? {
        ...response,
        document: normalizeSceneDocumentModelOutput(response.document, question),
        strategy,
      }
    : null;
}

/**
 * Canonicalize provenance that is already fixed by the request envelope. This
 * deliberately leaves all mathematical content untouched for scene-engine to
 * validate. An explicit source.question is never overwritten, so a conflicting
 * model claim still fails the server persistence boundary.
 */
export function normalizeSceneDocumentModelOutput(
  document: SceneDocumentCandidate,
  question: string,
): SceneDocumentCandidate {
  if (isPlainObject(document.source)) {
    return typeof document.source.question === "string"
      ? document
      : { ...document, source: { ...document.source, question } };
  }
  if (typeof document.source === "string") {
    return {
      ...document,
      source: {
        question,
        sourceLabel: document.source,
      },
    };
  }
  if (document.source === undefined) {
    return {
      ...document,
      source: { question },
    };
  }
  return document;
}

function summarizeSceneCandidateForRepair(
  candidate: SceneDocumentCandidate,
): Record<string, unknown> {
  const shortMetadata = Object.fromEntries(Object.entries(candidate).flatMap(([key, value]) =>
    (typeof value === "string" && value.length <= 120) || typeof value === "number" || typeof value === "boolean"
      ? [[key, value]]
      : []));
  const ids = (field: string): string[] => Array.isArray(candidate[field])
    ? candidate[field].flatMap((item) =>
        isPlainObject(item) && typeof item.id === "string" ? [item.id] : [])
    : [];
  const constructions = Array.isArray(candidate.constructions)
    ? candidate.constructions.flatMap((item) => isPlainObject(item)
      ? [{
          id: typeof item.id === "string" ? item.id : undefined,
          operator: typeof item.operator === "string" ? item.operator : undefined,
          outputs: Array.isArray(item.outputs)
            ? item.outputs.filter((output): output is string => typeof output === "string")
            : [],
        }]
      : [])
    : [];
  return {
    ...shortMetadata,
    quantityIds: ids("quantities"),
    entityIds: ids("entities"),
    constructions,
    assertionIds: ids("assertions"),
    requiredEntityIds: Array.isArray(candidate.requiredEntityIds)
      ? candidate.requiredEntityIds.filter((id): id is string => typeof id === "string")
      : [],
    revealGroupIds: ids("revealGroups"),
  };
}

/**
 * Plan, validate, and conditionally replace twice within one shared time budget.
 * The caller supplies scene-engine validation to keep this package transport-only.
 */
export async function planSceneDocumentWithRepair<T>(
  question: string,
  validate: SceneCandidateValidator<T>,
  options: ScenePlannerOptions,
): Promise<ScenePlanWithRepairResult<T> | null> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? SCENE_PLANNER_TIMEOUT_MS;
  const initialStrategies = [
    "Build the smallest sufficient scene. Derive every result, and add only assertions required to prove the question's stated relationships.",
    "Start from the exact quantities and invariants, then synthesize a minimal construction graph whose outputs satisfy them without duplicate geometry.",
    "Construct the proof obligations first, then add only the geometry needed to satisfy them; add compact annotations last.",
    "Use the fewest deterministic operators possible, audit every reference and sign, and omit all optional helpers or decorative ink.",
  ].slice(0, INITIAL_SCENE_CANDIDATES);
  const evaluatedPlans: Array<{
    response: ScenePlannerResponse;
    validation: SceneCandidateValidation<T>;
  }> = [];
  const allEvaluated: Array<{
    response: ScenePlannerResponse;
    validation: SceneCandidateValidation<T>;
  }> = [];
  const evaluateCandidate = async (
    candidate: ScenePlannerResponse | null,
  ): Promise<SceneCandidateValidation<T> | null> => {
    if (!candidate) return null;
    const candidateValidation = await validate(candidate.document);
    tutorDebug("planner", "semantic scene candidate validation", {
      phase: candidate.phase,
      valid: candidateValidation.valid,
      error_codes: candidateValidation.errors.map((error) => error.code),
      fatal_count: candidateValidation.errors.filter((error) => error.severity === "fatal").length,
    });
    evaluatedPlans.push({
      response: candidate,
      validation: candidateValidation,
    });
    allEvaluated.push({ response: candidate, validation: candidateValidation });
    return candidateValidation;
  };

  const candidateTimeoutMs = Math.min(timeoutMs, INITIAL_CANDIDATE_TIMEOUT_MS);
  const candidateControllers = initialStrategies.map(() => new AbortController());
  const pendingCandidates = new Map(initialStrategies.map((strategy, index) => {
    const controller = candidateControllers[index]!;
    const signal = options.signal
      ? mergeAbortSignals(options.signal, controller.signal)
      : controller.signal;
    const promise = planSceneDocument(
      question,
      { ...options, signal, timeoutMs: candidateTimeoutMs },
      strategy,
      index === 0 ? "primary" : "alternate",
    ).then((candidate) => ({ candidate, index }));
    return [index, promise] as const;
  }));

  let firstValidAt: number | null = null;
  while (pendingCandidates.size > 0) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    const validGraceRemainingMs = firstValidAt === null
      ? remainingMs
      : Math.min(
          remainingMs,
          VALID_CANDIDATE_GRACE_MS - (Date.now() - firstValidAt),
        );
    if (validGraceRemainingMs <= 0 || options.signal?.aborted) break;

    const timeoutMarker = Symbol("candidate-wait-timeout");
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      ...pendingCandidates.values(),
      new Promise<typeof timeoutMarker>((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutMarker), validGraceRemainingMs);
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (settled === timeoutMarker) break;

    pendingCandidates.delete(settled.index);
    const candidateValidation = await evaluateCandidate(settled.candidate);
    if (candidateValidation?.valid && firstValidAt === null) firstValidAt = Date.now();
  }
  for (const index of pendingCandidates.keys()) {
    candidateControllers[index]?.abort();
  }

  if (evaluatedPlans.length === 0 && !options.signal?.aborted) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs > 0) {
      await evaluateCandidate(await planSceneDocument(
        question,
        { ...options, timeoutMs: remainingMs },
      ));
    }
  }
  if (evaluatedPlans.length === 0) return null;
  evaluatedPlans.sort((a, b) => compareValidations(a.validation, b.validation));

  let response = evaluatedPlans[0]!.response;
  let validation = evaluatedPlans[0]!.validation;
  let repairCount = 0;

  const logValidation = () => {
    tutorDebug("planner", "semantic scene validation", {
      phase: response.phase,
      valid: validation.valid,
      error_codes: validation.errors.map((error) => error.code),
      fatal_count: validation.errors.filter((error) => error.severity === "fatal").length,
    });
  };
  logValidation();

  while (!validation.valid && validation.errors.length > 0 && repairCount < MAX_SCENE_REPAIR_ROUNDS) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0 || options.signal?.aborted) break;

    const strategies = [
      "Apply the smallest coherent correction that resolves every error while preserving valid geometry.",
      "Rebuild the failing construction subgraph from first principles; reuse valid entities but remove duplicate or weakly justified geometry.",
    ].slice(0, REPAIR_CANDIDATES_PER_ROUND);
    const repairSources = strategies.map(() => ({ response, validation }));
    const repairControllers = strategies.map(() => new AbortController());
    const pendingRepairs = new Map(strategies.map((strategy, index) => {
      const controller = repairControllers[index]!;
      const signal = options.signal
        ? mergeAbortSignals(options.signal, controller.signal)
        : controller.signal;
      const promise = repairSceneDocument(
        question,
        repairSources[index]?.response.document ?? response.document,
        repairSources[index]?.validation.errors ?? validation.errors,
        { ...options, signal, timeoutMs: remainingMs },
        strategy,
        index === 0 ? "primary" : "alternate",
      ).then((candidate) => ({ candidate, index }));
      return [index, promise] as const;
    }));
    const evaluated: Array<{
      response: ScenePlannerResponse;
      validation: SceneCandidateValidation<T>;
    }> = [];

    let firstValidRepairAt: number | null = null;
    while (pendingRepairs.size > 0) {
      const hardRemainingMs = timeoutMs - (Date.now() - startedAt);
      const waitMs = firstValidRepairAt === null
        ? hardRemainingMs
        : Math.min(
            hardRemainingMs,
            VALID_CANDIDATE_GRACE_MS - (Date.now() - firstValidRepairAt),
          );
      if (waitMs <= 0 || options.signal?.aborted) break;

      const timeoutMarker = Symbol("repair-wait-timeout");
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        ...pendingRepairs.values(),
        new Promise<typeof timeoutMarker>((resolve) => {
          timeoutId = setTimeout(() => resolve(timeoutMarker), waitMs);
        }),
      ]);
      if (timeoutId) clearTimeout(timeoutId);
      if (settled === timeoutMarker) break;
      pendingRepairs.delete(settled.index);
      if (!settled.candidate) continue;
      const candidateValidation = await validate(settled.candidate.document);
      evaluated.push({
        response: settled.candidate,
        validation: candidateValidation,
      });
      if (candidateValidation.valid && firstValidRepairAt === null) {
        firstValidRepairAt = Date.now();
      }
    }
    for (const index of pendingRepairs.keys()) {
      repairControllers[index]?.abort();
    }
    if (evaluated.length === 0) break;
    allEvaluated.push(...evaluated);
    evaluated.sort((a, b) => compareValidations(a.validation, b.validation));
    response = evaluated[0]!.response;
    validation = evaluated[0]!.validation;
    repairCount += 1;
    logValidation();
  }

  const selectedResponse = response;
  return {
    response,
    validation,
    repaired: repairCount > 0,
    candidates: allEvaluated.map((candidate, index) => ({
      candidateId: `candidate-${index + 1}`,
      response: candidate.response,
      validation: candidate.validation,
      score: validationScore(candidate.validation),
      selected: candidate.response === selectedResponse,
    })),
  };
}

/**
 * Re-run deterministic validation after an independent authority source has
 * reconciled the TurnPlan. Candidate generation may run concurrently with
 * that authority, but selection must always use the final facts.
 */
export async function revalidateScenePlanWithRepairResult<T>(
  result: ScenePlanWithRepairResult<T>,
  validate: SceneCandidateValidator<T>,
): Promise<ScenePlanWithRepairResult<T>> {
  const candidates = await Promise.all(result.candidates.map(async (candidate) => ({
    ...candidate,
    validation: await validate(candidate.response.document),
  })));
  const selected = [...candidates].sort((first, second) =>
    compareValidations(first.validation, second.validation))[0]!;
  return {
    response: selected.response,
    validation: selected.validation,
    repaired: result.repaired,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      score: validationScore(candidate.validation),
      selected: candidate.candidateId === selected.candidateId,
    })),
  };
}

function validationScore(validation: SceneCandidateValidation<unknown>): number {
  if (validation.valid) return Math.max(0, validation.qualityScore ?? 0);
  const fatalCount = validation.errors.filter((error) => error.severity === "fatal").length;
  return 1_000_000_000 + fatalCount * 100 + validation.errors.length;
}

function compareValidations(
  first: SceneCandidateValidation<unknown>,
  second: SceneCandidateValidation<unknown>,
): number {
  if (first.valid !== second.valid) return first.valid ? -1 : 1;
  return validationScore(first) - validationScore(second);
}

async function requestSceneDocument(
  phase: "plan" | "repair",
  prompt: string,
  options: ScenePlannerOptions,
  lane: ScenePlannerLane,
): Promise<ScenePlannerResponse | null> {
  const { proxyUrl, sessionId, signal, timeoutMs = SCENE_PLANNER_TIMEOUT_MS } = options;
  const startedAt = Date.now();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), Math.max(1, timeoutMs));
  const combinedSignal = signal
    ? mergeAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  tutorDebug("planner", `starting semantic scene ${phase}`, {
    timeout_ms: timeoutMs,
    prompt_chars: prompt.length,
    schema_version: SCENE_DOCUMENT_VERSION,
    lane,
  });

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-planner": "1",
        "x-scene-planner-version": "2",
        "x-scene-planner-phase": phase,
        "x-scene-planner-lane": lane,
        "x-planner-deadline-ms": String(timeoutMs),
        ...(sessionId ? { "x-session-id": sessionId } : {}),
      },
      signal: combinedSignal,
      body: JSON.stringify({
        model: PLANNER_MODEL,
        max_tokens: 4000,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: "system",
            content: `Synthesize one coordinate-free scene-document/v2 operator program. Follow the complete schema, capability contracts, authority rules, and safety constraints in the user message. Return only the JSON object. Never emit pixels, drawing commands, markdown, prose outside JSON, topic templates, or unverified geometry.`,
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      tutorDebug("planner", `semantic scene ${phase} request failed`, {
        status: response.status,
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      tutorDebug("planner", `semantic scene ${phase} returned empty content`, {
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    const document = parseJsonObject(content);
    if (!document) {
      tutorDebug("planner", `semantic scene ${phase} returned invalid JSON`, {
        content_preview: content.slice(0, 200),
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    const elapsedMs = Date.now() - startedAt;
    tutorDebug("planner", `semantic scene ${phase} candidate ready`, {
      schema_version: document.schemaVersion,
      entity_count: Array.isArray(document.entities) ? document.entities.length : undefined,
      elapsed_ms: elapsedMs,
    });

    return {
      document,
      rawContent: content,
      phase,
      lane,
      elapsedMs,
      traceId: response.headers.get("x-heytutor-trace-id") ?? undefined,
    };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    tutorDebug("planner", `semantic scene ${phase} failed`, {
      reason: isAbort ? "timeout_or_cancelled" : String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Parse only the JSON envelope; scene-engine owns all semantic validation. */
function parseJsonObject(content: string): SceneDocumentCandidate | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    const value: unknown = JSON.parse(text.slice(firstBrace, lastBrace + 1));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is SceneDocumentCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildOrderedRouteRepairGuidance(
  errors: readonly SceneRepairError[],
  context: string | undefined,
): string {
  const needsRouteRepair = errors.some((error) =>
    error.code === "turnplan_loop_member_not_proven" ||
    error.code === "turnplan_loop_member_bypassed" ||
    error.code === "turnplan_route_direction_not_proven");
  if (!needsRouteRepair || !context) return "";

  const pattern = /\b(up(?:ward)?|down(?:ward)?|left(?:ward)?|right(?:ward)?)\s+(?:through|along|across)\s+(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z0-9_-]+){0,2}?)(?=\s*(?:,|;|\(|\)|\band\b|\.|$))/gi;
  const seen = new Set<string>();
  const members = [...context.matchAll(pattern)].flatMap((match) => {
    const direction = match[1]?.toLowerCase();
    const hint = match[2]?.trim().toLowerCase();
    if (!direction || !hint || seen.has(hint)) return [];
    seen.add(hint);
    return [{ direction, hint }];
  });
  if (members.length < 3) return "";

  const edges = members.map((member, index) => {
    const end = index === members.length - 1 ? "p0" : `p${index + 1}`;
    return `${index + 1}. ${member.hint}: p${index} -> ${end} (${member.direction})`;
  }).join("\n");
  return `\nORDERED CYCLIC ROUTE (mandatory, derived from the authoritative claim):\n${edges}\nCreate exactly these shared cycle terminals and assign each named structural member to its listed terminal pair in this order. Choose point coordinates so every edge points in its stated cardinal direction. A symbol construction is the edge itself. Do not add a full-length segment behind a symbol, do not replace the cycle with a polygon, and do not use coincident duplicate point IDs.`;
}

function buildWaveOpticsRepairGuidance(
  errors: readonly SceneRepairError[],
): string {
  const needsWavefrontRepair = errors.some((error) =>
    error.code === "derived_role_operator_mismatch" && /wavefront|refract|reflect/i.test(error.message));
  const hasRefractionFailure = errors.some((error) =>
    /refract|total internal reflection|snell/i.test(`${error.code} ${error.message}`));
  if (!needsWavefrontRepair && !hasRefractionFailure) return "";
  return `
WAVE-OPTICS REBUILD (mandatory): choose one constructed contact point on the surface. For a stated incidence angle, use exactly one reflect_at or refract_at to produce [incident_ray, normal, outgoing_ray]; remove guessed duplicate rays and normals. Build every plane front with wavefront_family and set direction to the corresponding verified ray ID. Angle marks must use the same contact vertex. If the givens are wave speeds v1 and v2, refract_at needs the equivalent index ratio n1/n2 = v2/v1, so its numeric n1:n2 inputs must be v2:v1. Never swap this ratio or invent refractive indices.`;
}

function buildOpticalInstrumentRepairGuidance(
  errors: readonly SceneRepairError[],
): string {
  const codes = new Set(errors.map((error) => error.code));
  if (![
    "instrument_axis_not_unique",
    "instrument_element_orientation_not_proven",
    "instrument_ray_bundle_not_proven",
    "normal_adjustment_focal_plane_split",
    "instrument_intermediate_focus_not_proven",
  ].some((code) => codes.has(code))) return "";
  return `
OPTICAL-INSTRUMENT REBUILD (mandatory): use one optical-axis entity. Build objective and eyepiece elements transverse to it and include fatal perpendicular proofs. Use continuous ray entities through the elements, prove at least two objective rays converge at the intermediate image, and prove the requested incoming/emergent bundles parallel. For normal adjustment, the objective image and eyepiece focal point are the same physical location: represent them with one shared point ID between the two elements. Do not repair this by weakening or deleting the failed assertions.`;
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
