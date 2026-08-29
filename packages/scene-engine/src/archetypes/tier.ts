/**
 * One tier rule for every path.
 *
 *   exact_verified        every metric slot the archetype declares is grounded
 *                         (plan or stem) and the document carries a fatal
 *                         metric assertion with an expected value
 *   qualitative_verified  the figure is the right figure but some length,
 *                         angle or value is display-scaled
 *   question_representation  a schematic requested by the last-resort path
 *
 * `exists`, `label_attached` and topology predicates are not metric; a
 * document proving only those is at best qualitative.
 */
import type { SceneDocument } from "../types";
import { ARCHETYPES, type ArchetypeId } from "./catalog";
import { metricAssertions } from "./contract";
import type { SlotSource } from "./slots";

export type RepresentationTier = "exact_verified" | "qualitative_verified" | "question_representation";

export interface TierDecision {
  tier: RepresentationTier;
  nonMetric: boolean;
  reason: string;
}

export function resolveTier(options: {
  document: SceneDocument;
  archetype: ArchetypeId;
  sources: Readonly<Record<string, SlotSource>>;
  schematic: boolean;
}): TierDecision {
  const { document, archetype, sources, schematic } = options;
  const spec = ARCHETYPES[archetype];
  if (schematic) {
    return { tier: "question_representation", nonMetric: true, reason: `${archetype} schematic requested after the exact program was unavailable` };
  }
  const metricSlots = Object.entries(spec.slots).filter(([, slot]) => slot.metric).map(([key]) => key);
  const ungrounded = metricSlots.filter((key) => sources[key] !== "plan" && sources[key] !== "stem");
  const proofs = metricAssertions(document, archetype);
  if (metricSlots.length > 0 && ungrounded.length === 0 && proofs.length > 0) {
    return {
      tier: "exact_verified",
      nonMetric: false,
      reason: `${archetype} computed from ${metricSlots.map((key) => `${key}(${sources[key]})`).join(", ")} and proved by ${[...new Set(proofs)].join("/")}`,
    };
  }
  const why = metricSlots.length === 0
    ? "the archetype has no metric slots"
    : ungrounded.length > 0
      ? `slots ${ungrounded.join(", ")} are display-scaled`
      : "no metric assertion carries the values";
  return { tier: "qualitative_verified", nonMetric: true, reason: `${archetype} drawn from the question; ${why}` };
}

/**
 * Tier for a document the archetype layer did not generate (an LLM
 * candidate or a legacy family builder): exact only with a real metric
 * proof; never from existence or topology alone.
 */
export function tierForForeignDocument(document: SceneDocument, options: { schematic?: boolean } = {}): TierDecision {
  if (options.schematic) {
    return { tier: "question_representation", nonMetric: true, reason: "schematic representation" };
  }
  const proofs = metricAssertions(document);
  if (proofs.length > 0) {
    return { tier: "exact_verified", nonMetric: false, reason: `metric proof ${[...new Set(proofs)].join("/")}` };
  }
  return { tier: "qualitative_verified", nonMetric: true, reason: "no metric assertion; structure only" };
}
