/**
 * Archetype layer entry point.
 *
 *   question (+ turn plan, problem IR)
 *     -> detectArchetype        scored decision, typed slots with provenance
 *     -> generator              geometry computed from the slots
 *     -> validate + compile     the same engine every document goes through
 *     -> picture contract       completeness for this archetype
 *     -> demand rejection       the stem-level contradiction gate
 *     -> tier                   exact only with grounded metric proof
 *
 * Returns null whenever any step declines, so the caller can fall back to
 * the legacy family builders or teach text-only. Never returns a partial
 * document.
 */
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { demandRejection, sceneDemand } from "../synthesize/sceneDemand";
import type { RenderScene, SceneDocument, SceneIssue, ValidationReport } from "../types";
import { ARCHETYPES, type ArchetypeId } from "./catalog";
import { checkPictureContract } from "./contract";
import { detectArchetype, type ArchetypeMatch, type DetectionHints } from "./detect";
import { generatorFor } from "./generators";
import { collectPlanQuantities } from "./slots";
import { resolveTier, type RepresentationTier } from "./tier";

export * from "./catalog";
export { checkPictureContract, metricAssertions, METRIC_PROOF_PREDICATES } from "./contract";
export { detectArchetype, rankArchetypes, type ArchetypeMatch, type DetectionHints } from "./detect";
export { resolveTier, tierForForeignDocument, type RepresentationTier, type TierDecision } from "./tier";
export { collectPlanQuantities, type PlanQuantity, type SlotSource } from "./slots";

export interface ArchetypeSceneInput {
  question: string;
  turnPlan?: unknown;
  problemIR?: DetectionHints["problemIR"];
  plannerArchetype?: string | null;
  /** Last-resort mode: the figure is still computed, the tier is a schematic. */
  schematic?: boolean;
}

export interface ArchetypeScene {
  archetype: ArchetypeId;
  family: string;
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  tier: RepresentationTier;
  nonMetric: boolean;
  reason: string;
  match: ArchetypeMatch;
}

export interface ArchetypeAttempt {
  match: ArchetypeMatch | null;
  scene: ArchetypeScene | null;
  /** Why no scene was produced, for gates and telemetry. */
  declined?: string;
  issues?: SceneIssue[];
}

/** Full attempt with diagnostics; `synthesizeArchetypeScene` is the terse form. */
export function attemptArchetypeScene(input: ArchetypeSceneInput): ArchetypeAttempt {
  const question = input.question.trim();
  if (!question) return { match: null, scene: null, declined: "empty question" };
  const match = detectArchetype(question, {
    turnPlan: input.turnPlan,
    problemIR: input.problemIR,
    plannerArchetype: input.plannerArchetype,
  });
  if (!match) return { match: null, scene: null, declined: "no archetype cleared the evidence bar" };

  const generate = generatorFor(match.id);
  if (!generate) return { match, scene: null, declined: `no generator for ${match.id}` };

  let document: SceneDocument | null;
  try {
    document = generate({
      question,
      slots: match.slots,
      sources: match.sources,
      quantities: collectPlanQuantities(input.turnPlan),
      schematic: input.schematic ?? false,
    });
  } catch (error) {
    return { match, scene: null, declined: `generator threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!document) return { match, scene: null, declined: `${match.id} generator declined the slots` };

  // Record provenance on the document itself so downstream trust boundaries
  // (persistence, replay) can tell a plan-backed exact figure from one whose
  // numbers were read straight from the question.
  document.source = {
    ...document.source,
    archetype: match.id,
    slotSources: { ...match.sources },
    exactGrounding: exactGrounding(match.id, match.sources),
  };

  const contractIssues = checkPictureContract(document, match.id);
  if (contractIssues.length > 0) return { match, scene: null, declined: "picture contract", issues: contractIssues };

  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  if (!validated.document) return { match, scene: null, declined: "validation", issues: validated.report.issues };
  const compiled = compileSceneDocument(validated.document);
  const fatal = compiled.report.issues.filter((issue) => issue.severity === "fatal");
  if (!compiled.ok || !compiled.renderScene || compiled.renderScene.primitives.length === 0 || fatal.length > 0) {
    return { match, scene: null, declined: "compile", issues: fatal.length ? fatal : compiled.report.issues };
  }

  const rejection = demandRejection(validated.document, sceneDemand(question, input.problemIR ?? null));
  if (rejection) return { match, scene: null, declined: `demand: ${rejection}` };

  const tier = resolveTier({ document: validated.document, archetype: match.id, sources: match.sources, schematic: input.schematic ?? false });
  return {
    match,
    scene: {
      archetype: match.id,
      family: ARCHETYPES[match.id].family,
      document: validated.document,
      renderScene: compiled.renderScene,
      validationReport: compiled.report,
      tier: tier.tier,
      nonMetric: tier.nonMetric,
      reason: tier.reason,
      match,
    },
  };
}

export function synthesizeArchetypeScene(input: ArchetypeSceneInput): ArchetypeScene | null {
  return attemptArchetypeScene(input).scene;
}

/**
 * How the archetype's metric slots were grounded: `plan` when every metric
 * slot came from the turn plan, `stem` when every one was read from the
 * question, `mixed` for both, `null` when the archetype has no metric slots
 * or some are display defaults (never exact). Written to
 * `document.source.exactGrounding`; `document.source.slotSources` carries the
 * per-slot detail.
 */
export type ExactGrounding = "plan" | "stem" | "mixed" | null;

export function exactGrounding(archetype: ArchetypeId, sources: Readonly<Record<string, string>>): ExactGrounding {
  const metricSlots = Object.entries(ARCHETYPES[archetype].slots).filter(([, slot]) => slot.metric).map(([key]) => key);
  if (metricSlots.length === 0) return null;
  const values = metricSlots.map((key) => sources[key] ?? "default");
  if (values.some((value) => value !== "plan" && value !== "stem")) return null;
  const kinds = new Set(values);
  if (kinds.size === 1) return kinds.has("plan") ? "plan" : "stem";
  return "mixed";
}

/** Read the provenance an archetype wrote on a document, if any. */
export function archetypeProvenance(document: SceneDocument): {
  archetype: ArchetypeId | null;
  slotSources: Record<string, string>;
  exactGrounding: ExactGrounding;
} {
  const source = document.source ?? {};
  const archetype = typeof source.archetype === "string" && source.archetype in ARCHETYPES ? source.archetype as ArchetypeId : null;
  const slotSources = typeof source.slotSources === "object" && source.slotSources !== null
    ? Object.fromEntries(Object.entries(source.slotSources as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string>
    : {};
  const grounding = source.exactGrounding;
  return {
    archetype,
    slotSources,
    exactGrounding: grounding === "plan" || grounding === "stem" || grounding === "mixed" ? grounding : null,
  };
}

/**
 * Turn stem-extracted slots into plan-shaped givens so builders that only
 * read the turn plan (the optics programs) become exact from the question
 * alone. Existing plan quantities always win.
 */
export function augmentTurnPlanWithArchetypeSlots(question: string, turnPlan: unknown): unknown {
  const match = detectArchetype(question, { turnPlan });
  if (!match) return turnPlan;
  const existing = collectPlanQuantities(turnPlan);
  const taken = new Set(existing.flatMap((quantity) => [quantity.id.toLowerCase(), quantity.symbol.toLowerCase()]));
  const givens: Array<Record<string, unknown>> = [];
  for (const [key, value] of Object.entries(match.slots)) {
    if (typeof value !== "number" || match.sources[key] !== "stem" || taken.has(key.toLowerCase())) continue;
    const unit = ARCHETYPES[match.id].slots[key]?.unit ?? "";
    givens.push({ id: key, symbol: key, value, unit, provenance: "given", sourceText: "stated in the question" });
  }
  if (givens.length === 0) return turnPlan;
  const base = typeof turnPlan === "object" && turnPlan !== null ? turnPlan as Record<string, unknown> : {};
  return { ...base, givens: [...(Array.isArray(base.givens) ? base.givens : []), ...givens] };
}
