import type { TurnPlanV3 } from "../contracts/contractsV3";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SynthesizedFamilyScene } from "../synthesize/familyScene";
import type { SceneDocument } from "../types";

export type IndependentSourceReplay = SynthesizedFamilyScene & { independentlyGrounded: boolean };
type SourceReplayer = (question: string, familyHint: unknown) => readonly IndependentSourceReplay[];
let sourceReplayer: SourceReplayer | undefined;
/** Installed once by the engine composition root; never supplied by a document. */
export function installIndependentSourceReplayer(replayer: SourceReplayer): void {
  if (sourceReplayer) throw new Error("independent source replayer is already installed");
  sourceReplayer = replayer;
}

const SOURCE_METADATA = new Set([
  "mechanicsProblemIR", "mechanicsVerified", "mechanicsBindings", "mechanicsBoundaryBindings", "mechanicsPlotBindings",
  "representationTier", "nonMetric", "figureSource", "authority", "verified", "proof",
]);
const TIER_RANK: Record<string, number> = { question_representation: 0, qualitative_verified: 1, exact_verified: 2 };
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Copy only bounded JSON data; never invoke input getters or discard extra ink. */
function boundedCopy(value: unknown, depth = 0, budget = { nodes: 30_000, text: 262_144 }, active = new Set<object>()): unknown {
  if (--budget.nodes < 0 || depth > 24) throw new Error("independent source data exceeds its structural bound");
  if (typeof value === "string") { if (value.length > 16_384 || (budget.text -= value.length) < 0) throw new Error("independent source text exceeds its bound"); return value; }
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("independent source numbers must be finite"); return value; }
  if (value === null || typeof value === "boolean" || value === undefined) return value;
  if (typeof value !== "object" || active.has(value)) throw new Error("independent source data must be acyclic JSON");
  active.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype) && prototype !== null || Object.getOwnPropertySymbols(value).length) throw new Error("independent source data requires plain JSON objects");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const count = descriptors.length?.value as unknown;
      if (typeof count !== "number" || !Number.isInteger(count) || count > 2_048) throw new Error("independent source array exceeds its bound");
      if (Object.keys(descriptors).some(key => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) throw new Error("independent source arrays cannot carry extra properties");
      const result: unknown[] = [];
      for (let index = 0; index < count; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("independent source arrays require data entries");
        result.push(boundedCopy(descriptor.value, depth + 1, budget, active));
      }
      return result;
    }
    const keys = Object.keys(descriptors).sort();
    if (keys.length > 256) throw new Error("independent source object exceeds its bound");
    const entries: Array<[string, unknown]> = [];
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) throw new Error("independent source objects require data properties");
      if (descriptor.value !== undefined) entries.push([key, boundedCopy(descriptor.value, depth + 1, budget, active)]);
    }
    return Object.fromEntries(entries);
  } finally { active.delete(value); }
}

function comparable(document: SceneDocument): string {
  const core = { ...document } as Record<string, unknown>;
  // The envelope ID and diagnostic reason do not alter any diagram mark.
  delete core.id;
  core.visualDecision = { mode: document.visualDecision.mode };
  core.source = Object.fromEntries(Object.entries(document.source).filter(([key]) => !SOURCE_METADATA.has(key)));
  return JSON.stringify(boundedCopy(core));
}

/** A low-level guard can compare a complete, freshly rebuilt source program
 * without recursively compiling it. Callers own the original-source builder;
 * candidate stamps, subsets and label/quantity mutations cannot match. */
export function sourceDocumentMatchesRebuiltSource(document: SceneDocument, question: string, rebuilt: SceneDocument | null): boolean {
  try {
    if (!rebuilt || document.source.question !== question || rebuilt.source.question !== question ||
        document.source.nonMetric === false || document.source.representationTier === "exact_verified") return false;
    const supplied = boundedCopy(document) as SceneDocument;
    const actual = validateSceneDocument(supplied).document;
    if (!actual || actual.visualDecision.mode !== "scene" || comparable(supplied) !== comparable(actual)) return false;
    // Family lowering removes only dead helper entities from its own source
    // program. Compare both legitimate forms of the freshly rebuilt program;
    // never prune submitted ink to manufacture an equality.
    const expectedForms = [rebuilt, pruneDeadSceneEntities(rebuilt as unknown as Record<string, unknown>)];
    return expectedForms.some(form => {
      const expected = validateSceneDocument(form).document;
      return expected?.visualDecision.mode === "scene" && comparable(actual) === comparable(expected);
    });
  } catch { return false; }
}

function preservesTier(document: SceneDocument, replayed: SynthesizedFamilyScene): boolean {
  const claimed = document.source.representationTier;
  return (claimed === undefined || typeof claimed === "string" && Object.hasOwn(TIER_RANK, claimed) &&
    TIER_RANK[claimed]! <= TIER_RANK[replayed.tier]!) &&
    (document.source.nonMetric !== false || !replayed.nonMetric);
}

/**
 * Prove the complete legacy document by existing deterministic source replay.
 * Every normalized entity, input, quantity, relation, assertion, annotation,
 * required part, reveal and timeline action must match; provenance must match
 * too. Family hints select at most one extra replay and establish no authority.
 *
 * The accepted plan may constrain the question identity, but cannot introduce
 * physical operands or answer labels. Plan-only or unreproducible variants
 * return false, as do source metadata stamps without matching source geometry.
 */
export function independentlyReplayedSourceDocument(
  document: SceneDocument,
  question: string,
  acceptedPlan?: TurnPlanV3 | null,
): boolean {
  try {
    if (typeof question !== "string" || !question.trim() || question.length > 16_384) return false;
    const stem = question.trim();
    const input = boundedCopy(document) as SceneDocument;
    if (!record(input.source) || typeof input.source.question !== "string" || input.source.question.trim() !== stem) return false;
    if (acceptedPlan != null) {
      const plan = boundedCopy(acceptedPlan);
      if (!record(plan) || plan.schemaVersion !== "turn-plan/v3" || typeof plan.question !== "string" || plan.question.trim() !== stem) return false;
    }
    const validated = validateSceneDocument(input);
    if (!validated.document || validated.document.visualDecision.mode !== "scene") return false;
    // Normalization must not silently remove an extra assertion, label or mark.
    if (comparable(input) !== comparable(validated.document)) return false;
    const wanted = comparable(validated.document);
    if (!sourceReplayer) return false;
    for (const replayed of sourceReplayer(stem, input.source.family)) {
      if (!replayed.validationReport.valid || !replayed.independentlyGrounded || !preservesTier(input, replayed)) continue;
      const expected = validateSceneDocument(replayed.document);
      if (expected.document && comparable(expected.document) === wanted) return true;
    }
    return false;
  } catch { return false; }
}
