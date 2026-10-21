import type { SceneDocument } from "../types";

/** Admission stamps the rollout policy so persistence rebuilds the same scene.
 * This marker enables additional checks; it never waives an authority guard.
 */
export function isVerifiedPartsEnabled(document: SceneDocument): boolean {
  return document.source.diagramYieldPolicy === "verified_parts";
}

export function withDiagramYieldPolicy(
  document: SceneDocument,
  policy: "off" | "verified_parts",
): SceneDocument {
  if (policy === "off" && document.source.diagramYieldPolicy === undefined) return document;
  if (policy === "verified_parts" && isVerifiedPartsEnabled(document)) return document;
  const source = { ...document.source };
  delete source.diagramYieldPolicy;
  if (policy === "verified_parts") source.diagramYieldPolicy = policy;
  return { ...document, source };
}
