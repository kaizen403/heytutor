import type { SceneDocument } from "../types";
import { partitionTransformViews } from "../compile/transformViewOwnership";
import { implicitSolverEntityIds } from "./validation";
import { readSourcePlanarGeometry } from "./sourcePlanarGeometry";

/** The source reader can reuse the real compiler partition only when every
 * output has a proved ordinary planar producer. These points/paths/circles have
 * no plot calibration, logical reroute, viewport-native ink or planar region
 * packing fallback. Every compiler transform is then a positive scale plus
 * translation (page y is flipped). Unknown outputs/views remain unproved.
 * Circles disable the compiler's independent axis scaling and are not planar
 * rings eligible for its packing fallback. Native geometry must first be
 * independently evaluated by its caller. */
export function readSourcePlanarViews(document: SceneDocument, nativeKinds: ReadonlyMap<string, { kind: string }>) {
  const reader = readSourcePlanarGeometry(document);
  const geometry = new Map(nativeKinds);
  for (const construction of document.constructions) {
    if (construction.outputs.length > 0 && construction.outputs.every(id => nativeKinds.has(id))) continue;
    if (construction.outputs.length !== 1) return null;
    const id = construction.outputs[0]!;
    if (["point", "midpoint"].includes(construction.operator)) {
      if (construction.operator === "point" && construction.inputs.axes !== undefined || !reader.point(id)) return null;
      geometry.set(id, { kind: "point" });
    } else if (["segment", "line", "ray", "polyline", "vector"].includes(construction.operator)) {
      // Multi-vertex paths can become planar rings in the compiler, enabling
      // axis scaling or a packing fallback to a common transform. This reader
      // does not prove that alternate partition from source coordinates.
      if (reader.path(id)?.points.length !== 2) return null;
      geometry.set(id, { kind: "path" });
    } else if (construction.operator === "circle") {
      if (!reader.circle(id)) return null;
      geometry.set(id, { kind: "circle" });
    } else if (construction.operator === "dimension" || construction.operator === "axes") {
      if (!(construction.operator === "dimension" ? reader.dimension(id) : reader.axes(id))) return null;
      geometry.set(id, { kind: construction.operator });
    } else if (construction.operator === "label") {
      const target = construction.inputs.target ?? construction.inputs.at ?? construction.inputs.point;
      if (typeof target !== "string" || !document.entities.some(entity => entity.id === target)) return null;
      geometry.set(id, { kind: "point" });
    } else return null;
  }
  if (document.entities.some(entity => !geometry.has(entity.id))) return null;
  const provedAnchor = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id) || seen.size >= 32) return false;
    const construction = reader.producers.get(id);
    if (construction?.operator !== "label") return nativeKinds.has(id) || Boolean(reader.point(id) || reader.path(id) || reader.circle(id) || reader.dimension(id) || reader.axes(id));
    const target = construction.inputs.target ?? construction.inputs.at ?? construction.inputs.point;
    return typeof target === "string" && provedAnchor(target, new Set([...seen, id]));
  };
  if (document.constructions.some(construction => construction.operator === "label" && !provedAnchor(construction.outputs[0]!))) return null;
  const entityToGroup = new Map(document.revealGroups.flatMap(group => group.entityIds.map(id => [id, group.id] as const)));
  const partition = partitionTransformViews(document, geometry, implicitSolverEntityIds(document), entityToGroup);
  const owners = new Map<string, number>();
  partition.components.forEach((component, index) => component.ids.forEach(id => owners.set(id, partition.canPack ? index : 0)));
  return {
    owner: (id: string) => owners.get(id),
    members: (id: string) => [...owners].filter(([, owner]) => owner === owners.get(id)).map(([member]) => member),
  };
}
