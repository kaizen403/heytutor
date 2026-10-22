/** Compact deposited-element names require a fresh physical source proof. */
import type { SceneDocument, SceneEntity } from "../types";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { elementByName } from "./elements";
import { buildElectrochemScene, electrolysisProducts } from "./electrochemistry";
import { readDepositionMassSource } from "./electrolysisSource";

function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sorted(child)]));
    return item;
  };
  return JSON.stringify(sorted(value));
}

/** Source metadata and ids alone cannot rename a body. The external question
 * must independently yield this metal and the same complete physical graph.
 * This lowering does not invoke synthesis or visual-obligation checking. */
export function sourceDepositedMetalEntityHolds(originalQuestion: string, document: SceneDocument, entity: SceneEntity, problemLabel: string): boolean {
  if (document.source.question !== originalQuestion || entity.id !== "deposit" || entity.kind !== "segment") return false;
  const name = /^deposited ([a-z]+)$/.exec(problemLabel.trim());
  const metal = name ? elementByName(name[1]!) : null;
  if (!metal || entity.label !== `deposited ${metal.symbol}`) return false;
  const products = electrolysisProducts(originalQuestion);
  if (!products?.deposit || products.deposit.symbol !== metal.symbol || !readDepositionMassSource(originalQuestion, products.deposit)) return false;
  const raw = buildElectrochemScene(originalQuestion, [], false);
  if (!raw) return false;
  const expected = validateSceneDocument(pruneDeadSceneEntities(raw as unknown as Record<string, unknown>)).document;
  if (!expected) return false;
  const physical = (scene: SceneDocument): unknown => ({
    entities: scene.entities, constructions: scene.constructions, quantities: scene.quantities,
    requiredEntityIds: scene.requiredEntityIds, revealGroups: scene.revealGroups,
  });
  return canonical(physical(document)) === canonical(physical(expected));
}
