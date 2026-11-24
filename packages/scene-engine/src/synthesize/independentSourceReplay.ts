import { ARCHETYPES } from "../archetypes/catalog";
import { installIndependentSourceReplayer, type IndependentSourceReplay } from "../physics/independentSourceScene";
import { isSceneVisualFamily, type SceneVisualFamily } from "./familyClassification";
import { synthesizeFamilyScene, type SynthesizedFamilyScene } from "./familyScene";
import { CLOSED_FUNCTION_SOURCE_SCHEMA, proveClosedFunctionSource } from "./closedFunctionSource";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** Read grounding from a fresh compiler result, never submitted source flags. */
function hasIndependentOperands(replayed: SynthesizedFamilyScene, question: string): boolean {
  const source = replayed.document.source;
  const bareFunctionProgram = source.synthesizedFamily === true && typeof source.sourceModel !== "string" &&
    replayed.document.constructions.some(step => step.operator === "function_curve") &&
    replayed.document.constructions.every(step => step.operator === "axes" || step.operator === "function_curve");
  if (source.sourceModel === CLOSED_FUNCTION_SOURCE_SCHEMA || source.archetype === "function_graph" || bareFunctionProgram) {
    return proveClosedFunctionSource(question, replayed.document) !== null;
  }
  const sources = record(source.slotSources) ? source.slotSources : {};
  const archetype = typeof source.archetype === "string" && Object.hasOwn(ARCHETYPES, source.archetype)
    ? ARCHETYPES[source.archetype as keyof typeof ARCHETYPES] : undefined;
  if (archetype) {
    const metric = Object.entries(archetype.slots).filter(([, slot]) => slot.metric).map(([key]) => key);
    return metric.length > 0
      ? source.exactGrounding === "stem" && metric.every(key => sources[key] === "stem")
      : replayed.document.quantities.length === 0;
  }
  return typeof source.sourceModel === "string" && Object.keys(sources).length > 0 &&
    Object.values(sources).every(value => value === "stem") &&
    replayed.document.quantities.every(quantity => sources[quantity.id] === "stem");
}

// The composition root owns this dependency on the full family compiler.
// Low-level source validation does not import that compiler back into itself.
installIndependentSourceReplayer((question, hint) => {
  const requests: Array<readonly SceneVisualFamily[] | undefined> = [undefined];
  if (typeof hint === "string" && hint.length <= 64 && isSceneVisualFamily(hint)) requests.push([hint]);
  const results: IndependentSourceReplay[] = [];
  for (const families of requests) {
    const replayed = synthesizeFamilyScene({ question, turnPlan: null, problemIR: null, families });
    if (replayed) results.push({ ...replayed, independentlyGrounded: hasIndependentOperands(replayed, question) });
  }
  return results;
});
