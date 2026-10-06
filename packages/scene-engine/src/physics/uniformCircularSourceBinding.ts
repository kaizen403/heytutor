import { validateSceneDocument } from "../document/validation";
import { sameSceneValue } from "../document/valueEquality";
import type { SceneDocument, SceneIssue } from "../types";
import { readUniformCircularSource } from "./uniformCircularSource";
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
    entities: scene.entities.map((entity) => [entity.id, entity.kind, entity.label ?? null]),
  });
  const actual = shape(document);
  const wanted = shape(expected);
  return (Object.keys(wanted) as Array<keyof typeof wanted>).flatMap((key): SceneIssue[] =>
    sameSceneValue(actual[key], wanted[key]) ? [] : [{
      code: "ucm_source_mismatch", severity: "fatal", path: key,
      message: "Circular motion geometry and values must match the state recomputed from the actual source, including its stated position and sense.",
    }]);
}
