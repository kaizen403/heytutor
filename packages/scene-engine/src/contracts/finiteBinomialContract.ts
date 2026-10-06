import { FINITE_BINOMIAL_OPERATORS, type FiniteBinomialAuthority } from "../compile/binomialExpansionGeometry";
import { readFiniteBinomialProgram, validateFiniteBinomialSourceDocument } from "../ir/finiteBinomialProgram";
import type { SceneDocument, SceneIssue } from "../types";

export const FINITE_BINOMIAL_ENTITY_KINDS = ["finite_polynomial_source", "finite_polynomial_term"] as const;

/** A claim is a reason to demand proof, never a source of authority. */
export function claimsFiniteBinomialDocument(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const document = raw as Record<string, unknown>;
  return ["constructions", "entities"].some(key => Array.isArray(document[key]) && document[key].some((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const entry = item as Record<string, unknown>;
    return FINITE_BINOMIAL_OPERATORS.some(operator => entry.operator === operator)
      || FINITE_BINOMIAL_ENTITY_KINDS.some(kind => entry.kind === kind);
  }));
}

/** Re-derive the entire document from the actual caller at every engine boundary. */
export function finiteBinomialDocumentIssues(raw: unknown, authority?: FiniteBinomialAuthority): SceneIssue[] {
  const claimed = claimsFiniteBinomialDocument(raw);
  if (!authority) return claimed ? [{ code: "finite_binomial_missing_authority", severity: "fatal",
    message: "Finite polynomial expansion requires caller-owned sourceAuthority.question and full ProblemIR.", path: "sourceAuthority" }] : [];
  if (!claimed && readFiniteBinomialProgram(authority.question).status !== "ok") return [];
  // The source proof compares all fields before inspecting quantities; malformed
  // and normalized-away payloads must fail as well as mathematically wrong ones.
  return validateFiniteBinomialSourceDocument(raw as SceneDocument, authority.question, authority.problemIR);
}
