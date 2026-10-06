import { INDEXED_PROGRESSION_OPERATORS } from "../compile/indexedProgressionGeometry";
import { snapshotMathSourceData } from "../compile/mathSourceData";
import { validateFiniteProgressionSourceDocument } from "../ir/finiteProgressionSourceProgram";
import { readFiniteProgressionSource } from "../math/finiteProgressionSource";
import type { CompileOptions, SceneDocument, SceneIssue } from "../types";

// Inspect claims without invoking accessors. Claims demand independent proof;
// neither persisted quantities nor the document's Plan/IR supply authority.
function data(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}
function claimsProgression(raw: unknown): boolean {
  const source = data(raw, "source");
  if (data(source, "progressionSourceVersion") !== undefined) return true;
  for (const key of ["constructions", "entities"]) {
    const list = data(raw, key);
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const item = data(list, String(i));
      if (data(item, "kind") === "indexed_progression" || (INDEXED_PROGRESSION_OPERATORS as readonly unknown[]).includes(data(item, "operator"))) return true;
    }
  }
  return false;
}

/** Generic explicit operator graphs remain usable; source-bound claims need a caller. */
export function isSourceBoundFiniteProgressionDocument(raw: unknown): boolean {
  if (!claimsProgression(raw)) return false;
  const sourceDescriptor = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "source") : undefined;
  if (sourceDescriptor && !Object.hasOwn(sourceDescriptor, "value")) return true;
  const source = data(raw, "source");
  return ["question", "problemIR", "turnPlan", "progressionSourceVersion"].some(key =>
    source && typeof source === "object" && Object.hasOwn(source, key));
}

export function finiteProgressionDocumentIssues(raw: unknown, authority?: CompileOptions["sourceAuthority"]): SceneIssue[] {
  const claimed = isSourceBoundFiniteProgressionDocument(raw);
  try {
    if (authority && claimsProgression(raw)) authority = snapshotMathSourceData(authority);
  } catch (error) {
    return [{code: "invalid_finite_progression_source", severity: "fatal", path: "sourceAuthority",
      message: error instanceof Error ? error.message : "Cannot capture caller source authority"}];
  }
  const externalQuestion = data(authority, "question");
  const reading = typeof externalQuestion === "string" ? readFiniteProgressionSource(externalQuestion) : null;
  if (!claimed && reading?.status !== "ok") return [];
  if (!authority || authority.turnPlan === undefined || authority.problemIR === undefined) return [{
    code: "finite_progression_missing_authority", severity: "fatal", path: "sourceAuthority",
    message: "Source-bound progression requires the caller's actual question, full ProblemIR and TurnPlanV3.",
  }];
  try {
    const captured = snapshotMathSourceData({document: raw, authority});
    return validateFiniteProgressionSourceDocument(captured.document as SceneDocument, captured.authority.question,
      captured.authority.problemIR, captured.authority.turnPlan);
  } catch (error) {
    return [{code: "invalid_finite_progression_source", severity: "fatal", path: "sourceAuthority",
      message: error instanceof Error ? error.message : "Cannot capture caller source authority"}];
  }
}
