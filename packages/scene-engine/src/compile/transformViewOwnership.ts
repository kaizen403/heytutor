import type { SceneDocument } from "../types";
import { isVerifiedPartsEnabled } from "./yieldPolicy";

interface TransformViewGeometry { kind: string }

/** The compiler and source proof share the current main transform partition.
 * View identity follows actual connectivity, rollout policy and reveal owners;
 * candidate view tags supply no geometry or physics authority. */
export function partitionTransformViews(document: SceneDocument, geometry: ReadonlyMap<string, TransformViewGeometry>,
  constructionOnlyIds: ReadonlySet<string>, entityToGroup: ReadonlyMap<string, string>) {
  const renderGeometry = [...geometry.entries()].filter(([id]) => !constructionOnlyIds.has(id));
  const components = constructionComponents(document, geometry)
    .map((ids) => ({
      ids,
      renderIds: ids.filter((id) => geometry.has(id) && !constructionOnlyIds.has(id) && entityToGroup.has(id)),
    }))
    .filter((component) => component.renderIds.length > 0);
  const componentGroups = components.map((component) =>
    [...new Set(component.renderIds.map((id) => entityToGroup.get(id)!).filter(Boolean))],
  );
  const distinctGroups = new Set(componentGroups.flat());
  const componentByEntity = new Map(components.flatMap((component, index) =>
    component.ids.map((id) => [id, index] as const),
  ));
  // Connected geometry is one physical figure even when its parts were
  // constructed independently. Separate transforms would break the proven
  // join and scale its measurements against different coordinate systems.
  const connectsComponents = document.assertions.some((assertion) =>
    // A common transform preserves every proved geometric relation, including
    // incidence, midpoint and relative distance, not just circuit connections.
    (isVerifiedPartsEnabled(document) || (assertion.predicate === "connected" && assertion.expected !== false)) &&
    new Set(assertion.entities.flatMap((id) => {
      const component = componentByEntity.get(id);
      return component === undefined ? [] : [component];
    })).size > 1,
  );
  // DSA example frames must keep the full diagram-zone width. Packing them
  // into a 2-column grid shrinks each cell until the handwritten value
  // fills the box and sits on the stroke.
  const canPack = document.source.synthesizedDsa !== true &&
    // Cartesian axes and all planar geometry share the document world frame.
    // Reveal order cannot turn that frame into independently fitted panels.
    (!isVerifiedPartsEnabled(document) || !renderGeometry.some(([, value]) => value.kind === "axes")) &&
    !connectsComponents &&
    components.length > 1 &&
    componentGroups.every((groups) => groups.length === 1) &&
    distinctGroups.size === components.length;
  return { components, componentGroups, canPack };
}

function constructionComponents(document: SceneDocument, geometry: ReadonlyMap<string, TransformViewGeometry>): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  geometry.forEach((_, id) => parent.set(id, id));
  for (const construction of document.constructions) {
    const ids = construction.outputs.filter((id) => geometry.has(id));
    collectStrings(construction.inputs, (id) => {
      if (geometry.has(id)) ids.push(id);
    });
    const firstId = ids[0];
    if (firstId) ids.slice(1).forEach((id) => union(firstId, id));
  }
  const byRoot = new Map<string, string[]>();
  geometry.forEach((_, id) => byRoot.set(find(id), [...(byRoot.get(find(id)) ?? []), id]));
  return [...byRoot.values()];
}

function collectStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, visit);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, visit);
}

