import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { evaluateMathExpression } from "@heytutor/scene-engine";
import { tutorDebug } from "./tutorDebug";
import { inferSceneCapabilities, sceneFamiliesForceVisualRequirement } from "./sceneCapabilities";
import { reconcileTurnPlanWithOpticsLaws } from "./opticsPlanAudit";

export interface TurnPlannerV3Options {
  proxyUrl: string;
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  conversationContext?: string;
}

export interface TurnPlanV3Response {
  turnPlan: TurnPlanV3;
  peerTurnPlans?: TurnPlanV3[];
  rawContent: string;
  elapsedMs: number;
  traceId?: string;
}

const TURN_PLAN_MODEL = "accounts/fireworks/routers/kimi-k2p6-turbo";
const TURN_PLAN_PEER_GRACE_MS = 3_000;

export async function planTurnV3(
  question: string,
  options: TurnPlannerV3Options,
): Promise<TurnPlanV3Response | null> {
  const startedAt = Date.now();
  const conversation = options.conversationContext?.trim()
    ? `\nRECENT CONTEXT\n${options.conversationContext.trim()}\n`
    : "";
  const lanes = [
    {
      lane: "primary" as const,
      systemPrompt: TURN_PLAN_V3_PROMPT,
      userContent: `${conversation}QUESTION\n${question}`,
    },
    {
      lane: "alternate" as const,
      systemPrompt: TURN_PLAN_V3_RETRY_PROMPT,
      userContent: `${conversation}QUESTION\n${question}\n\nIndependently solve every requested unknown and return one complete checked plan.`,
    },
  ];
  const controllers = lanes.map(() => new AbortController());
  const pending = new Map(lanes.map((lane, index) => {
    const controller = controllers[index]!;
    const signal = options.signal
      ? mergeAbortSignals(options.signal, controller.signal)
      : controller.signal;
    const promise = requestTurnPlanV3(
      question,
      { ...options, signal },
      lane.systemPrompt,
      lane.userContent,
      "plan",
      lane.lane,
    ).then((result) => ({ index, result }));
    return [index, promise] as const;
  }));
  const completed: TurnPlanV3Response[] = [];
  let firstValidAt: number | null = null;

  while (pending.size > 0 && !options.signal?.aborted) {
    const remainingGrace = firstValidAt === null
      ? null
      : Math.max(0, TURN_PLAN_PEER_GRACE_MS - (Date.now() - firstValidAt));
    if (remainingGrace === 0) break;
    const graceTimeout = remainingGrace === null
      ? null
      : new Promise<null>((resolve) => setTimeout(() => resolve(null), remainingGrace));
    const settled = await Promise.race([
      ...pending.values(),
      ...(graceTimeout ? [graceTimeout] : []),
    ]);
    if (!settled) break;
    pending.delete(settled.index);
    if (!settled.result) continue;
    completed.push(settled.result);
    if (firstValidAt === null) firstValidAt = Date.now();
  }
  for (const index of pending.keys()) controllers[index]?.abort();
  if (completed.length === 0) {
    const remainingMs = Math.max(0, options.timeoutMs - (Date.now() - startedAt));
    if (remainingMs < 500) return null;
    return requestTurnPlanV3(
      question,
      { ...options, timeoutMs: remainingMs },
      TURN_PLAN_V3_RETRY_PROMPT,
      `${conversation}QUESTION\n${question}\n\nReturn a complete corrected plan. Missing requested numeric answers are fatal.`,
      "plan",
      "alternate",
    );
  }
  const selectedPlan = selectTurnPlanV3Consensus(
    null,
    completed[0]!.turnPlan,
    completed.slice(1).map((response) => response.turnPlan),
  ) ?? completed[0]!.turnPlan;
  const selected = completed.find((response) => response.turnPlan === selectedPlan) ?? completed[0]!;
  return {
    ...selected,
    peerTurnPlans: completed
      .filter((response) => response !== selected)
      .map((response) => response.turnPlan),
  };
}

/**
 * Re-solve and audit a candidate plan before it becomes authoritative. The
 * audit is intentionally independent of scene synthesis and remains free of
 * pixels, templates, and domain-specific rendering rules.
 */
export async function auditTurnPlanV3(
  question: string,
  candidate: TurnPlanV3,
  options: TurnPlannerV3Options,
): Promise<TurnPlanV3Response | null> {
  return requestTurnPlanV3(
    question,
    options,
    TURN_PLAN_V3_AUDIT_PROMPT,
    `QUESTION\n${question}\n\nCANDIDATE TURN PLAN\n${JSON.stringify(candidate)}`,
    "audit",
    "alternate",
  );
}

async function requestTurnPlanV3(
  question: string,
  options: TurnPlannerV3Options,
  systemPrompt: string,
  userContent: string,
  phase: "plan" | "audit",
  lane: "primary" | "alternate",
): Promise<TurnPlanV3Response | null> {
  const startedAt = Date.now();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), Math.max(1, options.timeoutMs));
  const signal = options.signal
    ? mergeAbortSignals(options.signal, timeoutController.signal)
    : timeoutController.signal;

  tutorDebug("planner", `starting turn plan v3 ${phase}`, {
    timeout_ms: options.timeoutMs,
    phase,
    schema_version: "turn-plan/v3",
  });

  try {
    const response = await fetch(options.proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-planner": "1",
        "x-turn-planner-version": "3",
        "x-turn-plan-phase": phase,
        "x-turn-planner-lane": lane,
        "x-planner-deadline-ms": String(options.timeoutMs),
        ...(options.sessionId ? { "x-session-id": options.sessionId } : {}),
      },
      signal,
      body: JSON.stringify({
        model: TURN_PLAN_MODEL,
        max_tokens: 2600,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = parseTurnPlan(content, question);
    if (!parsed) return null;

    return {
      turnPlan: enforceMinimumVisualRequirement(parsed, question),
      rawContent: content,
      elapsedMs: Date.now() - startedAt,
      traceId: response.headers.get("x-heytutor-trace-id") ?? undefined,
    };
  } catch (error) {
    tutorDebug("planner", `turn plan v3 ${phase} failed`, {
      reason: error instanceof Error ? error.message : String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createFallbackTurnPlanV3(question: string): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens: [],
    unknowns: [],
    derived: [],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: ["Turn-plan model was unavailable; visual requirement was classified conservatively."],
    visualRequirement: questionRequiresVisual(question) ? "required" : "optional",
  };
}

export function explicitDiagramRequest(question: string): boolean {
  return /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show\s+(?:the\s+)?(?:ray|circuit|figure|geometry|position|image))\b/i.test(question);
}

/** References an accompanying figure without an explicit draw verb ("as shown in the figure", "the figure shows"). */
export function referencesFigure(question: string): boolean {
  return /\b(?:as\s+shown\s+in\s+(?:the\s+)?(?:figure|diagram)|in\s+the\s+(?:figure|diagram)|the\s+(?:figure|diagram)\s+shows|shown\s+in\s+the\s+(?:figure|diagram)|figure\s+below|diagram\s+below|see\s+(?:the\s+)?figure)\b/i.test(question);
}

/** Pure-concept markers where an honest text-only answer is expected, even if hardware words appear. */
function isQualitativeConceptQuestion(question: string): boolean {
  return /\b(?:assertion|reason\s*\(?r?|which\s+of\s+the\s+following|which\s+of\s+these|correct\s+statement|statement(?:s)?\s+(?:is|are)|not\s+true|does\s+not\s+occur|true\s+about)\b/i.test(question);
}

export function questionRequiresVisual(question: string): boolean {
  // A qualitative assertion/reason or multiple-choice concept check teaches
  // text-only; a figure keyword inside it must not force a scene render.
  if (isQualitativeConceptQuestion(question)) return explicitDiagramRequest(question);
  return explicitDiagramRequest(question) ||
    referencesFigure(question) ||
    sceneFamiliesForceVisualRequirement(inferSceneCapabilities(question).families) ||
    /\b(?:mirror|lens|prism|ray\s+optics|circuit|free[- ]body|force\s+diagram|field\s+line|vector\s+diagram|geometry\s+construction|apparatus|ray\s+diagram|parabola|ellipse|hyperbola|directrix|eccentricity|foci|latus\s+rectum|tangent\s+to\s+the\s+(?:curve|circle|parabola|ellipse|hyperbola)|normal\s+to\s+the\s+(?:curve|circle))\b/i.test(question);
}

export function selectTurnPlanV3Consensus(
  audited: TurnPlanV3 | null | undefined,
  planned: TurnPlanV3 | null | undefined,
  peers: readonly TurnPlanV3[] = [],
): TurnPlanV3 | null {
  const candidates = [audited, planned, ...peers]
    .filter((candidate): candidate is TurnPlanV3 => Boolean(candidate));
  if (candidates.length === 0) return null;
  const maximumCoverage = Math.max(...candidates.map(requestedUnknownCoverage));
  const complete = candidates.filter((candidate) =>
    requestedUnknownCoverage(candidate) === maximumCoverage);
  if (complete.length === 1) return complete[0]!;

  const groups = new Map<string, TurnPlanV3[]>();
  for (const candidate of complete) {
    const fingerprint = requestedResultFingerprint(candidate);
    groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), candidate]);
  }
  const consensus = [...groups.values()]
    .sort((first, second) => second.length - first.length)[0];
  if (consensus && consensus.length >= 2) {
    return [audited, planned, ...peers].find((candidate) =>
      candidate && consensus.includes(candidate)) ?? consensus[0]!;
  }
  return complete.find((candidate) => candidate === audited) ??
    complete.find((candidate) => candidate === planned) ??
    complete[0]!;
}

function requestedUnknownCoverage(plan: TurnPlanV3): number {
  const derivedKeys = finiteDerivedQuantityKeys(plan);
  return plan.unknowns.filter((unknown) =>
    [unknown.id, unknown.symbol]
      .map(normalizeQuantityKey)
      .filter(Boolean)
      .some((key) => derivedKeys.has(key))
  ).length;
}

function requestedResultFingerprint(plan: TurnPlanV3): string {
  const derived = plan.derived.filter((quantity) =>
    typeof quantity.value === "number" && Number.isFinite(quantity.value));
  return plan.unknowns.map((unknown) => {
    const keys = [unknown.id, unknown.symbol].map(normalizeQuantityKey).filter(Boolean);
    const result = derived.find((quantity) =>
      [quantity.id, quantity.symbol]
        .map(normalizeQuantityKey)
        .filter(Boolean)
        .some((key) => keys.includes(key)));
    return result
      ? `${keys.sort().join("|")}:${Number(result.value.toPrecision(12))}:${normalizeUnit(result.unit)}`
      : `${keys.sort().join("|")}:missing`;
  }).sort().join(";");
}

function finiteDerivedQuantityKeys(plan: TurnPlanV3): Set<string> {
  return new Set(plan.derived.flatMap((quantity) =>
    typeof quantity.value === "number" && Number.isFinite(quantity.value)
      ? [quantity.id, quantity.symbol].map(normalizeQuantityKey)
          .filter(Boolean)
      : [],
  ));
}

function normalizeQuantityKey(value: string): string {
  return value.toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(?:computed|calculated|calculation|calc|result|answer|value|val)$/, "");
}

function normalizeUnit(value: string | undefined): string {
  return String(value ?? "1").toLowerCase()
    .replace(/µ|μ/g, "u")
    .replace(/⁻/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\s+/g, "");
}

function enforceMinimumVisualRequirement(plan: TurnPlanV3, question: string): TurnPlanV3 {
  if (!questionRequiresVisual(question) || plan.visualRequirement === "required") return plan;
  return {
    ...plan,
    visualRequirement: "required",
    assumptions: [
      ...plan.assumptions,
      "A verified illustration is required by the question's spatial or explicit visual request.",
    ],
  };
}

function parseTurnPlan(content: string, question: string): TurnPlanV3 | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  try {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as unknown;
    const normalized = normalizePlannerTurnPlan(parsed, question);
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(normalized);
    if (reconciled.reconciliations.length > 0) {
      tutorDebug("planner", "turn plan v3 reconciled explicit arithmetic", {
        quantity_ids: reconciled.reconciliations.map((item) => item.quantityId),
        corrections: reconciled.reconciliations.map((item) => ({
          from: item.previousValue,
          to: item.reconciledValue,
        })),
      });
    }
    let result = validateTurnPlanV3(reconciled.plan, question);
    if (result.plan) {
      const opticsAudit = reconcileTurnPlanWithOpticsLaws(result.plan);
      if (opticsAudit.corrections.length > 0) {
        tutorDebug("planner", "turn plan v3 reconciled optics laws", {
          law_ids: opticsAudit.checkedLawIds,
          corrections: opticsAudit.corrections.map((item) => ({
            quantity_id: item.quantityId,
            from: item.previousValue,
            to: item.correctedValue,
          })),
        });
        result = validateTurnPlanV3(opticsAudit.plan, question);
      }
    }
    if (!result.valid) {
      tutorDebug("planner", "turn plan v3 validation failed", {
        issue_codes: result.issues.map((issue) => issue.code),
        unknown_ids: Array.isArray((reconciled.plan as Record<string, unknown>).unknowns)
          ? ((reconciled.plan as Record<string, unknown>).unknowns as Array<Record<string, unknown>>)
              .map((quantity) => String(quantity.id ?? quantity.symbol ?? ""))
          : [],
        derived_ids: Array.isArray((reconciled.plan as Record<string, unknown>).derived)
          ? ((reconciled.plan as Record<string, unknown>).derived as Array<Record<string, unknown>>)
              .map((quantity) => String(quantity.id ?? quantity.symbol ?? ""))
          : [],
      });
    }
    return result.plan;
  } catch (error) {
    tutorDebug("planner", "turn plan v3 parse failed", {
      reason: error instanceof Error ? error.message : String(error),
      content_chars: content.length,
    });
    return null;
  }
}

function normalizePlannerTurnPlan(value: unknown, question: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const plan = value as Record<string, unknown>;
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
  const fieldEntries = (field: unknown): unknown[] => {
    if (Array.isArray(field)) return field;
    if (!isRecord(field)) return [];
    return Object.entries(field).map(([id, raw]) => {
      if (isRecord(raw)) return { ...raw, id: typeof raw.id === "string" ? raw.id : id, symbol: typeof raw.symbol === "string" ? raw.symbol : id };
      return { id, symbol: id, value: raw };
    });
  };
  const unknownEntries = fieldEntries(plan.unknowns).map((unknown) => {
    if (!isRecord(unknown)) return unknown;
    const id = typeof unknown.id === "string" ? unknown.id : "unknown";
    const rawValue = (unknown as Record<string, unknown>).value;
    const unit = typeof unknown.unit === "string"
      ? unknown.unit
      : typeof rawValue === "string"
        ? inferTrailingUnit(rawValue, id)
        : undefined;
    const normalized = { ...unknown, id, symbol: typeof unknown.symbol === "string" ? unknown.symbol : id } as Record<string, unknown>;
    delete normalized.value;
    return unit ? { ...normalized, unit } : normalized;
  });
  const unknownKeys = unknownEntries.flatMap((unknown) => {
    if (!isRecord(unknown)) return [];
    return [unknown.id, unknown.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityKey);
  });
  const normalizedModelNumber = (key: string, raw: unknown): number | null => {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (isRecord(raw) && typeof raw.value === "number" && Number.isFinite(raw.value)) return raw.value;
    if (typeof raw !== "string") return null;
    const resultLike = /(?:final|answer|result|value|computed|calculated|area|volume|length|time|speed|force|current|power|energy|distance|position|image)/i.test(key);
    if (!resultLike) return null;
    const text = raw.replace(/[−–]/g, "-").replace(/π/g, "pi");
    const rhs = text.includes("=") ? text.slice(text.lastIndexOf("=") + 1) : text;
    for (const candidate of resultExpressionCandidates(rhs)) {
      if (/(^|[^a-z0-9_])[xy]([^a-z0-9_]|$)/i.test(candidate)) continue;
      try {
        const numeric = evaluateMathExpression(candidate, 0);
        if (Number.isFinite(numeric)) return numeric;
      } catch {
        // Try the next whole-expression candidate.
      }
    }
    return null;
  };
  const modelQuantityEntries = (field: unknown, provenance: "given" | "derived"): unknown[] => {
    if (Array.isArray(field)) {
      return field.flatMap((raw) => {
        if (!isRecord(raw)) return [];
        const id = typeof raw.id === "string" ? raw.id : typeof raw.symbol === "string" ? raw.symbol : "quantity";
        const value = normalizedModelNumber(id, raw.value);
        if (value === null) return [];
        const normalized = { ...raw, id, symbol: typeof raw.symbol === "string" ? raw.symbol : id, value, provenance } as Record<string, unknown>;
        if (normalized.unit !== undefined && typeof normalized.unit !== "string") delete normalized.unit;
        if (typeof normalized.sourceText !== "string") normalized.sourceText = `${id} = ${value}`;
        return [normalized];
      });
    }
    if (!isRecord(field)) return [];
    return Object.entries(field).flatMap(([id, raw]) => {
      const record = isRecord(raw) ? { ...raw } : {};
      const value = normalizedModelNumber(id, raw);
      if (value === null) return [];
      const unit = typeof record.unit === "string"
        ? record.unit
        : typeof raw === "string"
          ? inferTrailingUnit(raw, id)
          : undefined;
      return [{
        ...record,
        id: typeof record.id === "string" ? record.id : id,
        symbol: typeof record.symbol === "string" ? record.symbol : id,
        value,
        ...(unit ? { unit } : {}),
        provenance,
        sourceText: typeof record.sourceText === "string" ? record.sourceText : `${id} = ${value}`,
      }];
    });
  };
  const normalizedRawGivens = modelQuantityEntries(plan.givens, "given");
  const normalizedRawDerived = modelQuantityEntries(plan.derived, "derived").filter((quantity) => {
        if (!isRecord(quantity)) return false;
        const keys = [quantity.id, quantity.symbol]
          .filter((key): key is string => typeof key === "string")
          .map(normalizeQuantityKey);
        return keys.some((key) => unknownKeys.some((unknownKey) => semanticQuantityKeysMatch(key, unknownKey)));
      });
  const derivedFromUnknownMap = !Array.isArray(plan.unknowns)
    ? modelQuantityEntries(plan.unknowns, "derived").filter((quantity) => {
        if (!isRecord(quantity)) return false;
        const keys = [quantity.id, quantity.symbol]
          .filter((key): key is string => typeof key === "string")
          .map(normalizeQuantityKey);
        return keys.some((key) => unknownKeys.some((unknownKey) => semanticQuantityKeysMatch(key, unknownKey)));
      })
    : [];
  const rawDerived = [...normalizedRawDerived, ...derivedFromUnknownMap];
  const {
    derived: canonicalDerived,
    idMap: canonicalDerivedIdMap,
  } = canonicalizeDerivedUnknownIds(rawDerived, unknownEntries, normalizedRawGivens);
  const quantities = [
    ...normalizedRawGivens,
    ...canonicalDerived,
  ];
  const knownQuantityIds = new Set(quantities.flatMap((quantity) =>
    typeof quantity === "object" && quantity !== null && !Array.isArray(quantity) &&
    typeof (quantity as Record<string, unknown>).id === "string"
      ? [(quantity as Record<string, unknown>).id as string]
      : [],
  ));
  const unknownIds = new Set(
    unknownEntries.flatMap((unknown) =>
      typeof unknown === "object" && unknown !== null && !Array.isArray(unknown) &&
      typeof (unknown as Record<string, unknown>).id === "string"
        ? [(unknown as Record<string, unknown>).id as string]
        : [],
    ),
  );
  const claimQuantityIds = new Set([...knownQuantityIds, ...unknownIds]);
  let removedDependencyCount = 0;
  let removedSignCount = 0;
  const normalizeQuantity = (quantity: unknown): unknown => {
    if (typeof quantity !== "object" || quantity === null || Array.isArray(quantity)) return quantity;
    const record = quantity as Record<string, unknown>;
    const normalized = { ...record };
    if (normalized.unit !== undefined && typeof normalized.unit !== "string") {
      delete normalized.unit;
    }
    if (!["positive", "negative", "zero", "unsigned"].includes(String(record.sign))) {
      delete normalized.sign;
    } else if (
      typeof record.value === "number" &&
      Number.isFinite(record.value) &&
      record.sign !== "unsigned"
    ) {
      const numericSign =
        record.value > 0 ? "positive" : record.value < 0 ? "negative" : "zero";
      if (record.sign !== numericSign) {
        // Direction belongs in qualitative claims. A positive field magnitude
        // must not become an invalid scalar merely because it points along a
        // coordinate system's negative axis.
        delete normalized.sign;
        removedSignCount += 1;
      }
    }
    if (!Array.isArray(record.dependsOn)) return normalized;
    const dependsOn = record.dependsOn.filter((id) => {
      const keep = typeof id === "string" && id !== record.id && knownQuantityIds.has(id);
      if (!keep) removedDependencyCount += 1;
      return keep;
    });
    return { ...normalized, dependsOn };
  };
  const normalizedGivens = normalizedRawGivens.map((quantity) => {
        const normalized = normalizeQuantity(quantity);
        return typeof normalized === "object" && normalized !== null && !Array.isArray(normalized)
          ? { ...normalized, provenance: "given" }
          : normalized;
      });
  const normalizedDerived = canonicalDerived.map((quantity) => {
        const remappedQuantity = typeof quantity === "object" && quantity !== null && !Array.isArray(quantity) &&
          Array.isArray((quantity as Record<string, unknown>).dependsOn)
          ? {
              ...(quantity as Record<string, unknown>),
              dependsOn: ((quantity as Record<string, unknown>).dependsOn as unknown[]).map((id) =>
                typeof id === "string" ? canonicalDerivedIdMap.get(id) ?? id : id),
            }
          : quantity;
        const normalized = normalizeQuantity(remappedQuantity);
        return typeof normalized === "object" && normalized !== null && !Array.isArray(normalized)
          ? { ...normalized, provenance: "derived" }
          : normalized;
      });
  const rawClaims = Array.isArray(plan.qualitativeClaims)
    ? plan.qualitativeClaims
    : isRecord(plan.qualitativeClaims)
      ? Object.entries(plan.qualitativeClaims).map(([id, claim]) => ({ id, claim: typeof claim === "string" ? claim : id, expected: true }))
      : [];
  const normalizedClaims = rawClaims.flatMap((claim) => {
        if (typeof claim === "string") claim = { id: claim, claim, expected: true };
        if (typeof claim !== "object" || claim === null || Array.isArray(claim)) return [];
        const record = claim as Record<string, unknown>;
        if (
          typeof record.id !== "string" ||
          typeof record.claim !== "string" ||
          !["boolean", "string", "number"].includes(typeof record.expected) ||
          (typeof record.expected === "number" && !Number.isFinite(record.expected))
        ) return [];
        const relatedQuantityIds = (
          typeof record.relatedQuantityIds === "string"
            ? [record.relatedQuantityIds]
            : Array.isArray(record.relatedQuantityIds)
              ? record.relatedQuantityIds
              : []
        ).map((id) => typeof id === "string" ? canonicalDerivedIdMap.get(id) ?? id : id)
          .filter((id): id is string => typeof id === "string" && claimQuantityIds.has(id));
        const relatedEntityHints = (
          typeof record.relatedEntityHints === "string"
            ? [record.relatedEntityHints]
            : Array.isArray(record.relatedEntityHints)
              ? record.relatedEntityHints
              : []
        ).filter((hint): hint is string => typeof hint === "string");
        return [{
          ...record,
          ...(record.relatedQuantityIds !== undefined ? { relatedQuantityIds } : {}),
          ...(record.relatedEntityHints !== undefined ? { relatedEntityHints } : {}),
        }];
      });
  const assumptions = (Array.isArray(plan.assumptions)
    ? plan.assumptions
    : isRecord(plan.assumptions)
      ? Object.entries(plan.assumptions).map(([id, assumption]) => typeof assumption === "string" ? assumption : isRecord(assumption) && typeof assumption.text === "string" ? assumption.text : id)
      : []).map((assumption) => {
        if (typeof assumption === "string") return assumption;
        if (typeof assumption === "object" && assumption !== null &&
            typeof (assumption as Record<string, unknown>).text === "string") {
          return (assumption as Record<string, unknown>).text;
        }
        return assumption;
      });
  const lawIds = Array.isArray(plan.lawIds)
    ? plan.lawIds.filter((law): law is string => typeof law === "string" && law.trim() !== "")
    : isRecord(plan.lawIds)
      ? Object.entries(plan.lawIds).map(([id, law]) => typeof law === "string" ? law : id)
      : [];
  const visualRequirement = isRecord(plan.visualRequirement)
    ? "required"
    : ["required", "optional", "none"].includes(String(plan.visualRequirement))
      ? plan.visualRequirement
      : questionRequiresVisual(question) ? "required" : "optional";
  return {
    ...plan,
    schemaVersion: "turn-plan/v3",
    question,
    givens: normalizedGivens,
    unknowns: unknownEntries,
    derived: normalizedDerived,
    qualitativeClaims: normalizedClaims,
    lawIds,
    visualRequirement,
    assumptions: [
      ...assumptions,
      ...(removedDependencyCount > 0
        ? [`Removed ${removedDependencyCount} invalid planner dependency reference${removedDependencyCount === 1 ? "" : "s"}.`]
        : []),
      ...(removedSignCount > 0
        ? [`Removed ${removedSignCount} directional sign${removedSignCount === 1 ? "" : "s"} that contradicted positive scalar magnitude${removedSignCount === 1 ? "" : "s"}.`]
        : []),
    ],
  };
}

/**
 * A requested quantity and its finite result are one semantic quantity. Model
 * output frequently gives them unrelated local ids (for example `u1` and
 * `d2`) while keeping the same symbol and unit. Canonicalize only a unique
 * one-to-one match; ambiguous symbols are deliberately left untouched.
 */
function canonicalizeDerivedUnknownIds(
  derived: unknown[],
  unknowns: unknown[],
  givens: unknown[],
): { derived: unknown[]; idMap: Map<string, string> } {
  const records = derived.map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: Record<string, unknown>; index: number } =>
      typeof entry.value === "object" && entry.value !== null && !Array.isArray(entry.value));
  const unknownRecords = unknowns.filter((value): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).symbol === "string");
  const reservedIds = new Set(givens.flatMap((value) =>
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).id === "string"
      ? [(value as Record<string, unknown>).id as string]
      : []));
  const matches = new Map<number, Record<string, unknown>[]>();
  const reverseCount = new Map<string, number>();

  for (const entry of records) {
    const derivedKeys = [entry.value.id, entry.value.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityKey);
    const derivedUnit = normalizeUnit(
      typeof entry.value.unit === "string" ? entry.value.unit : undefined,
    );
    const candidates = unknownRecords.filter((unknown) => {
      const unknownKeys = [unknown.id, unknown.symbol]
        .filter((key): key is string => typeof key === "string")
        .map(normalizeQuantityKey);
      const unknownUnit = normalizeUnit(
        typeof unknown.unit === "string" ? unknown.unit : undefined,
      );
      return derivedUnit === unknownUnit && derivedKeys.some((derivedKey) =>
        unknownKeys.some((unknownKey) => semanticQuantityKeysMatch(derivedKey, unknownKey)));
    });
    matches.set(entry.index, candidates);
    for (const candidate of candidates) {
      const id = candidate.id as string;
      reverseCount.set(id, (reverseCount.get(id) ?? 0) + 1);
    }
  }

  const idMap = new Map<string, string>();
  const normalized = derived.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    const candidates = matches.get(index) ?? [];
    if (candidates.length !== 1) return value;
    const targetId = candidates[0]!.id as string;
    if (reverseCount.get(targetId) !== 1 || reservedIds.has(targetId)) return value;
    const sourceId = typeof record.id === "string" ? record.id : "";
    if (sourceId && sourceId !== targetId) idMap.set(sourceId, targetId);
    return { ...record, id: targetId };
  });
  return { derived: normalized, idMap };
}

function inferTrailingUnit(raw: string, key: string): string | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  const resultLike = /(?:area|volume|length|distance|time|speed|force|current|power|energy|position|image|answer|result|value)/i.test(key);
  if (!resultLike) return undefined;
  const match = text.match(/(?:^|[=:\s])[-+]?\d[\d\s./*^+-]*\s+(.+)$/);
  const unit = match?.[1]?.trim();
  return unit && !/[=]/.test(unit) ? unit : undefined;
}

function semanticQuantityKeysMatch(first: string, second: string): boolean {
  if (first === second) return true;
  if (first.length < 4 || second.length < 4) return false;
  return first.includes(second) || second.includes(first);
}

function resultExpressionCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const candidates = [trimmed];
  for (const match of trimmed.matchAll(/\s+/g)) {
    const splitIndex = match.index ?? -1;
    if (splitIndex <= 0) continue;
    const prefix = trimmed.slice(0, splitIndex).trim();
    const suffix = trimmed.slice(splitIndex).trim();
    if (!prefix || !suffix || !looksLikeUnitSuffix(suffix)) continue;
    candidates.push(prefix);
  }
  return [...new Set(candidates)];
}

function looksLikeUnitSuffix(raw: string): boolean {
  const normalized = raw.toLowerCase()
    .replace(/µ|μ/g, "u")
    .replace(/°/g, " degree ")
    .replace(/,/g, " ")
    .trim();
  if (normalized === "" || !/[a-z]/.test(normalized)) return false;
  if (!/^[a-z0-9\s/^*.-]+$/.test(normalized)) return false;
  const segments = normalized.split(/\s+/).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => {
    const unitParts = segment.split("/").flatMap((part) => part.split("*"));
    return unitParts.every((part) => {
      const base = part.replace(/^-+/, "").replace(/\^-?\d+$/g, "").replace(/\d+$/g, "");
      return base !== "" && RESULT_UNIT_TOKENS.has(base);
    });
  });
}

const RESULT_UNIT_TOKENS = new Set([
  "a",
  "amp",
  "ampere",
  "amperes",
  "amps",
  "c",
  "cal",
  "calorie",
  "calories",
  "cm",
  "coulomb",
  "coulombs",
  "cu",
  "cubic",
  "d",
  "deg",
  "degree",
  "degrees",
  "diopter",
  "diopters",
  "dioptre",
  "dioptres",
  "f",
  "farad",
  "farads",
  "g",
  "gram",
  "grams",
  "h",
  "henry",
  "henrys",
  "hour",
  "hours",
  "hz",
  "j",
  "joule",
  "joules",
  "k",
  "kg",
  "kilogram",
  "kilograms",
  "km",
  "l",
  "liter",
  "liters",
  "litre",
  "litres",
  "m",
  "meter",
  "meters",
  "metre",
  "metres",
  "min",
  "minute",
  "minutes",
  "mm",
  "mol",
  "n",
  "newton",
  "newtons",
  "nm",
  "ns",
  "ohm",
  "ohms",
  "pa",
  "pascal",
  "pascals",
  "per",
  "rad",
  "radian",
  "radians",
  "s",
  "second",
  "seconds",
  "sq",
  "square",
  "t",
  "tesla",
  "u",
  "um",
  "unit",
  "units",
  "v",
  "volt",
  "volts",
  "w",
  "watt",
  "watts",
  "weber",
  "webers",
]);

function mergeAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) abort();
  else {
    first.addEventListener("abort", abort, { once: true });
    second.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export const TURN_PLAN_V3_VISUAL_GROUNDING =
  "Set visualRequirement=required when quantities/entities must be located or related in space, even without a draw verb.";

/** Prompt length before the visualRequirement grounding line (chars). Growth must stay ≤ 150. */
export const TURN_PLAN_V3_PROMPT_BASELINE_CHARS = 2648;

export const TURN_PLAN_V3_PROMPT = `Return only one compact turn-plan/v3 JSON object. Do not emit prose, pixels, drawing commands, or scene geometry.

Required keys: schemaVersion, question, givens, unknowns, derived, qualitativeClaims, lawIds, assumptions, visualRequirement.

Quantity: {id,symbol,value,unit?,sign?,sourceText?,provenance:"given"|"derived"|"assumed",dependsOn?}.
Unknown: {id,symbol,unit?}. Claim: {id,claim,expected,relatedQuantityIds?,relatedEntityHints?}.
lawIds and assumptions are arrays of strings. Do not emit assumption objects. Claim-related quantity IDs may reference givens, derived quantities, or unknowns.

Set visualRequirement to:
- "required" when the user explicitly asks to draw, diagram, sketch, construct, plot, graph, illustrate, locate spatially, or when a faithful visual is necessary to answer the requested task.
- "optional" when a visual would help but the requested answer remains complete without one.
- "none" when a visual adds no instructional meaning.
${TURN_PLAN_V3_VISUAL_GROUNDING}

Copy numeric givens exactly. Derive only values you can justify using named lawIds. Every requested numerical unknown must have a corresponding finite numeric item in derived; solve simultaneous equations completely. Never put null, NaN, infinity, or a symbolic-only equation in a derived value. Put intermediate equations in sourceText or computation on a finite result instead. Every explicit arithmetic expression in sourceText or computation must evaluate to the item's declared value.
Keep the plan compact enough to finish as valid JSON: givens contains only independent values stated by the question; derived contains every requested numeric answer plus at most four indispensable intermediate scalars; qualitativeClaims contains at most eight claims; assumptions contains at most six strings; each sourceText is at most 180 characters. Do not expand coordinate labels, process endpoints, or repeated multiples into separate quantities when they can be expressed from an original given.
Before returning, independently recompute every derived scalar and check dimensional consistency. The optional quantity sign describes the numeric scalar value only and must agree with it; put spatial directions such as leftward, downward, or into the page in qualitativeClaims instead. For every directional claim, establish a coordinate convention, evaluate vector operations component by component, and check the result against conservation laws and the stated physical tendency. Claims within the plan must not contradict each other. Keep stable IDs compact. Never invent measurements, topology, directions, or assumptions. The question field must contain the user's exact question.`;

const TURN_PLAN_V3_RETRY_PROMPT = `${TURN_PLAN_V3_PROMPT}

This is a repair attempt after deterministic validation rejected the first result. Work the problem again from first principles. Pay particular attention to completing every requested unknown, eliminating null intermediate quantities, and making each declared value agree with every explicit arithmetic expression.`;

const TURN_PLAN_V3_AUDIT_PROMPT = `Return only one corrected compact turn-plan/v3 JSON object. Do not emit prose, pixels, drawing commands, or scene geometry.

Act as an independent mathematical and physical verifier. Re-solve the submitted question from its givens; do not trust or merely paraphrase the candidate plan. Preserve a candidate value or claim only after checking it from first principles.

Required checks:
- copy all givens exactly and reject invented data;
- recompute every derived scalar from named laws and verify units, scalar signs, and dependency IDs; keep coordinate directions in qualitativeClaims rather than assigning a contradictory sign to a positive magnitude;
- for directional claims, define a coordinate convention and evaluate vector or orientation operations component by component;
- check qualitative claims against conservation laws, boundary conditions, limiting cases, and each other;
- keep only assumptions necessary to make the question well-defined;
- retain visualRequirement=required whenever the question explicitly requests a visual, the candidate already set required for a spatial setup, or quantities/entities must be located or related in space.

Use the same required keys and shapes as turn-plan/v3. The question field must contain the submitted question. Return the complete corrected plan, even when the candidate was already correct.`;
