/** Narrow source-variable identity proof. This is not a cached molecular authority flag. */
import type { SceneDocument, SceneEntity } from "../../types";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../document/validation";
import { findMentions } from "./namedMentions";
import { readOrganicReactionSource } from "./reactionSource";
import { buildOrganicReactionFigure } from "./reactionFigure";

function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sorted(child)]));
    return item;
  };
  return JSON.stringify(sorted(value));
}

/** Recover every actual construction dependency of the product and answer
 * groups. Coordinates, bond strokes, atom glyphs, labels and paint survive
 * this comparison; ids merely identify references in those actual graphs. */
function fragment(document: SceneDocument, expectedGroupIds: readonly string[]): unknown | null {
  const actualGroupIds = document.revealGroups.filter(group => group.id === "computed_product" || group.id === "reaction_answer").map(group => group.id).sort();
  if (canonical(actualGroupIds) !== canonical([...expectedGroupIds].sort())) return null;
  const groups = expectedGroupIds.map(id => document.revealGroups.find(group => group.id === id));
  if (groups.some(group => !group)) return null;
  const allIds = new Set(document.entities.map(entity => entity.id));
  const reached = new Set<string>();
  const constructions = new Set<SceneDocument["constructions"][number]>();
  const references = (value: unknown): void => {
    if (typeof value === "string" && allIds.has(value)) visit(value);
    else if (Array.isArray(value)) value.forEach(references);
    else if (value && typeof value === "object") Object.values(value).forEach(references);
  };
  const visit = (id: string): void => {
    if (reached.has(id)) return;
    reached.add(id);
    const producers = document.constructions.filter(construction => construction.outputs.includes(id));
    if (producers.length !== 1) return;
    const construction = producers[0]!;
    constructions.add(construction);
    construction.outputs.forEach(output => { reached.add(output); });
    references(construction.inputs);
  };
  for (const group of groups) {
    if (!group || group.entityIds.some(id => !document.requiredEntityIds.includes(id))) return null;
    group.entityIds.forEach(visit);
  }
  return {
    groups: groups.map(group => ({ id: group!.id, entityIds: [...group!.entityIds].sort(), dependsOn: group!.dependsOn })),
    entities: document.entities.filter(entity => reached.has(entity.id)).sort((a, b) => a.id.localeCompare(b.id)),
    constructions: [...constructions].sort((a, b) => a.id.localeCompare(b.id)),
    quantities: document.quantities.filter(quantity => quantity.id === "reaction_stereoisomers" || quantity.symbol === "N"),
  };
}

/** A compact Product X can denote source addition product X only with an
 * external original question and the complete fresh source-derived fragment.
 * Ordinary compilation and all other numeric/IR obligations remain separate. */
export function sourceAdditionProductEntityHolds(
  originalQuestion: string,
  document: SceneDocument,
  entity: SceneEntity,
  problemLabel: string,
): boolean {
  if (document.source.question !== originalQuestion) return false;
  const role = /^addition product ([A-Z])$/.exec(problemLabel.trim());
  if (!role || entity.label !== `Product ${role[1]}`) return false;
  const read = readOrganicReactionSource(originalQuestion, findMentions(originalQuestion));
  if (read.status !== "source" || read.model.kind !== "radical_hbr" || read.model.productRole !== problemLabel.trim()) return false;
  const expectedRaw = buildOrganicReactionFigure(originalQuestion, read.model);
  if (!expectedRaw) return false;
  const expected = validateSceneDocument(pruneDeadSceneEntities(expectedRaw as unknown as Record<string, unknown>)).document;
  if (!expected) return false;
  // The name is anchored by the same construction dependency graph as the
  // complete computed molecule. A free caption or matching id alone cannot pass.
  const expectedName = expected.entities.find(candidate => candidate.id === entity.id);
  const group = document.revealGroups.find(candidate => candidate.id === "computed_product");
  if (!expectedName || canonical(expectedName) !== canonical(entity) || !group?.entityIds.includes(entity.id)) return false;
  const expectedGroupIds = ["computed_product", ...(expected.revealGroups.some(group => group.id === "reaction_answer") ? ["reaction_answer"] : [])];
  const actualFragment = fragment(document, expectedGroupIds), expectedFragment = fragment(expected, expectedGroupIds);
  return actualFragment !== null && expectedFragment !== null && canonical(actualFragment) === canonical(expectedFragment);
}
