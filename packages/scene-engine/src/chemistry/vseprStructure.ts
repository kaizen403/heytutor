import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SceneDocument } from "../types";
import { buildVseprFigure, type VseprFigure } from "./vsepr";

/**
 * Recompute the complete molecule from external source text. A title, role,
 * family flag or submitted membership list cannot certify structural ink.
 * This grants no exemption for numeric quantities or angle labels.
 */
export function verifiedVseprStructure(document: SceneDocument, originalQuestion?: string): VseprFigure | null {
  if (!originalQuestion?.trim() || document.source.question !== originalQuestion.trim()) return null;
  const fresh = buildVseprFigure(originalQuestion, [], false);
  if (!fresh?.structures.length) return null;
  // Validation reconciles labels with their constructions. A contradictory
  // redundant label is not a membership certificate before that repair.
  const labels = new Map(fresh.document.entities.map((entity) => [entity.id, entity.label]));
  if (document.entities.some((entity) => entity.label !== labels.get(entity.id))) return null;
  const normalize = (input: SceneDocument) => validateSceneDocument(pruneDeadSceneEntities(input as unknown as Record<string, unknown>));
  const expected = normalize(fresh.document);
  const actual = normalize(document);
  if (!expected.document || !actual.document) return null;
  // Source metadata declares tiers and provenance; the complete actual ink,
  // facts, topology, obligations and reveal schedule must be recomputed.
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
