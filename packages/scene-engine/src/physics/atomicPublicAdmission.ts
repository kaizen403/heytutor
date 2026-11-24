import { isKernelOnlyAtomicOperator } from "../capability/capabilityManifest";
import type { SceneDocument, SceneIssue } from "../types";
import { validateNumericDecayPlotAdmission } from "./sourceDecayPlotAdmission";

/** Student figures require an original-source proof in addition to a
 * successful compile. This check also runs on stored and cached figures. */
export function validatePublicAtomicSceneAdmission(document: SceneDocument, question?: unknown): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const withheld = document.constructions.filter(construction => isKernelOnlyAtomicOperator(construction.operator));
  if (withheld.length) return withheld.map(construction => ({
    code: "atomic_operator_source_unproved",
    severity: "fatal",
    failureKind: "truth",
    constructionId: construction.id,
    message: `${construction.operator} needs a complete authorizing proof from the original question before it can draw in a lesson.`,
  }));
  return typeof question === "string" ? validateNumericDecayPlotAdmission(document, question) : [];
}
