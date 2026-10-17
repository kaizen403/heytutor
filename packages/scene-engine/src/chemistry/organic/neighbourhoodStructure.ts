import { pruneDeadSceneEntities, validateSceneDocument } from "../../document/validation";
import type { SceneDocument } from "../../types";
import { carbonSiteRequest } from "./neighbourhood";
import { buildNeighbourhoodFigure, type OrganicNeighbourhoodFigure } from "./neighbourhoodPanel";

/**
 * Recompute the complete closed request from external question text. Submitted
 * family, membership, roles and captions cannot certify any structural label.
 * This changes reveal timing only, never numeric or ProblemIR admission.
 */
export function verifiedOrganicNeighbourhoodStructure(document: SceneDocument, originalQuestion?: string): OrganicNeighbourhoodFigure | null {
  if (!originalQuestion?.trim() || document.source.question !== originalQuestion.trim()) return null;
  const kind = carbonSiteRequest(originalQuestion);
  if (!kind) return null;
  const fresh = buildNeighbourhoodFigure(originalQuestion, kind);
  if (!fresh?.structures.length) return null;
  const labels = new Map(fresh.document.entities.map(entity => [entity.id, entity.label]));
  if (document.entities.some(entity => entity.label !== labels.get(entity.id))) return null;
  const normalize = (input: SceneDocument) => validateSceneDocument(pruneDeadSceneEntities(input as unknown as Record<string, unknown>));
  const expected = normalize(fresh.document);
  const actual = normalize(document);
  if (!expected.document || !actual.document) return null;
  // Validation can fill an unassigned entity back into a reveal group. That
  // repair must not certify a submitted partial structural membership list.
  if (stableValue(document.revealGroups) !== stableValue(expected.document.revealGroups)) return null;
  const content = (input: SceneDocument) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== "source"));
  if (stableValue(content(actual.document)) !== stableValue(content(expected.document))) return null;
  return { ...fresh, document: expected.document };
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([first], [second]) => first.localeCompare(second)));
  });
}
