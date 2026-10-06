import { validateSceneDocument } from "../document/validation";
import { sameSceneValue } from "../document/valueEquality";
import type { SceneDocument, SceneIssue } from "../types";
import { readUniformCircularSource, type UniformCircularNumeric } from "./uniformCircularSource";
import { UNIFORM_CIRCULAR_ARCHETYPE, uniformCircularNumericDocument, uniformCircularSymbolicDocument } from "./uniformCircularScene";

/** Recompute a claimed source program from the actual question at every trust boundary. */
export function validateUniformCircularSourceInputs(document: SceneDocument, question: unknown): SceneIssue[] {
  if (document.visualDecision.mode === "text_only") return [];
  const claimedSource = document.source.archetype === UNIFORM_CIRCULAR_ARCHETYPE;
  const source = typeof question === "string"
    ? readUniformCircularSource(question, claimedSource ? { planNamesCircularMotion: true } : {})
    : null;
  // A numeric state bound by the actual question remains authoritative when
  // submitted source markers are removed. Metadata cannot opt out of proof.
  if (!claimedSource && source?.status !== "numeric") return [];
  if (typeof question === "string" && document.source.question !== question) {
    return [{ code: "ucm_source_mismatch", severity: "fatal", path: "source.question", message: "Circular source literals must bind to the actual submitted question exactly." }];
  }
  if (!source || source.status === "reject") {
    return [{ code: "ucm_source_unsupported", severity: "fatal", path: "source.question", message: "A circular source program needs a complete supported radius, rate and stated position." }];
  }
  const generated = source.status === "numeric"
    ? uniformCircularNumericDocument(question as string, source)
    : uniformCircularSymbolicDocument(question as string, source);
  const expected = validateSceneDocument(generated).document ?? generated;
  const shape = (scene: SceneDocument) => ({
    quantities: scene.quantities,
    constructions: scene.constructions,
    assertions: scene.assertions,
    annotations: scene.annotations ?? [],
    requiredEntityIds: scene.requiredEntityIds,
    revealGroups: scene.revealGroups,
    teachingTimeline: scene.teachingTimeline,
    entities: scene.entities.map((entity) => [entity.id, entity.kind, entity.role ?? null, entity.label ?? null]),
  });
  const actual = shape(document);
  const wanted = shape(expected);
  // First bind every construction, assertion, identity/label and annotation
  // exactly. None of those channels may borrow a numeric error allowance.
  const structureBound = sameSceneValue({ ...actual, quantities: null }, { ...wanted, quantities: null });
  if (structureBound && source.status === "numeric" && derivedQuantityRoundoff(document, expected, source)) {
    actual.quantities = wanted.quantities;
  }
  return (Object.keys(wanted) as Array<keyof typeof wanted>).flatMap((key): SceneIssue[] =>
    sameSceneValue(actual[key], wanted[key]) ? [] : [{
      code: "ucm_source_mismatch", severity: "fatal", path: key,
      message: "Circular motion geometry and values must match the state recomputed from the actual source, including its stated position and sense.",
    }]);
}

/**
 * A binary64 forward-error proof for this short, positive arithmetic chain.
 * pi, unit conversion, multiply/divide, and v²/r have at most 8 roundings;
 * gamma(8) = 8u/(1-8u), u = EPSILON/2. There is no cancellation here.
 * Only independently regenerated derived scalar quantities may use it.
 * Source inputs, row identities/order/symbols/units and all structure are exact.
 * Subnormal or overflow-prone computations are outside this proof.
 */
function derivedQuantityRoundoff(actual: SceneDocument, expected: SceneDocument, source: UniformCircularNumeric): boolean {
  const derived = new Set(["v", "omega", "a_c"]);
  if (source.rateSource === "speed") derived.delete("v");
  if (source.rateSource === "angular_speed") derived.delete("omega");
  if (source.rateSource === "centripetal_acceleration") derived.delete("a_c");
  if (actual.quantities.length !== expected.quantities.length) return false;
  const u = Number.EPSILON / 2;
  const gamma = 8 * u / (1 - 8 * u);
  return actual.quantities.every((row, i) => {
    const canonical = expected.quantities[i]!;
    if (sameSceneValue(row, canonical)) return true;
    if (!derived.has(canonical.id) || !sameSceneValue({ ...row, value: null }, { ...canonical, value: null })) return false;
    const value = row.value; const wanted = canonical.value;
    return typeof value === "number" && typeof wanted === "number" && Number.isFinite(value)
      && wanted >= 1e-100 && wanted <= 1e100 && Math.abs(value - wanted) <= gamma * wanted;
  });
}

/** Parent save/read glue: validate first, then persist/recompile canonical scalars. */
export function canonicalizeUniformCircularSourceDocument(document: SceneDocument, question: string): SceneDocument | null {
  if (validateUniformCircularSourceInputs(document, question).length) return null;
  const source = readUniformCircularSource(question);
  if (source?.status !== "numeric") return null;
  const canonical = uniformCircularNumericDocument(question, source);
  return { ...document, quantities: canonical.quantities };
}
