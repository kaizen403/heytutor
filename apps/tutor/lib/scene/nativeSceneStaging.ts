import { compileSceneDocument, type GeneratedSceneGuide, type RenderScene, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionNativeSourceRepresentation } from "@/features/tutor-session/lib/scene/productionSceneSelection";
import { deepEqual } from "@/features/tutor-session/lib/scene/diagramGeneration";

/** Timing is reconstructed from the complete original-source proof, never
 * from a client's optional list of answer ids. This does not admit a scene:
 * callers still run every structural, numeric, source and save guard. */
export function deriveNativeSceneStaging(document: SceneDocument, question: string, turnPlan: TurnPlanV3 | null,
  problemIR?: unknown, rendered?: RenderScene): { matched: boolean; document: SceneDocument; caption?: NonNullable<GeneratedSceneGuide["caption"]> } {
  const mismatch = { matched: false, document };
  if (!turnPlan) return mismatch;
  const native = selectProductionNativeSourceRepresentation(question, turnPlan, problemIR);
  if (!native) return mismatch;
  const timingFields = ["answerLabelPrimitiveIds", "answerLabelEntityIds", "answerLabelAnnotationIds"] as const;
  // Incidental source metadata cannot make an answer earlier. Compare the
  // whole scientific document body and its freshly compiled geometry/labels;
  // numeric/source authority still comes from the independent original replay.
  const scientificBody = (value: SceneDocument) => ({ ...value, source: { question: value.source.question } });
  if (!deepEqual(scientificBody(document), scientificBody(native.sceneDocument))) return mismatch;
  const compiled = compileSceneDocument(document, { figureConsistency: true });
  if (!compiled.ok || !compiled.renderScene || !deepEqual(compiled.renderScene, native.renderScene)) return mismatch;
  if (rendered && !deepEqual(rendered, native.renderScene)) return mismatch;
  const source = { ...document.source };
  for (const key of timingFields) {
    delete source[key];
    const values = native.sceneDocument.source[key];
    if (Array.isArray(values)) source[key] = [...new Set(values.filter((value): value is string => typeof value === "string"))];
  }
  return { matched: true, document: { ...document, source }, ...(native.nativeCaption ? { caption: native.nativeCaption } : {}) };
}

export function withNativeSceneStaging(document: SceneDocument, question: string, turnPlan: TurnPlanV3 | null,
  problemIR?: unknown): SceneDocument {
  return deriveNativeSceneStaging(document, question, turnPlan, problemIR).document;
}
