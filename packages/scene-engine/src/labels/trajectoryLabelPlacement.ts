import type { RenderPrimitive, SceneDocument } from "../types";
import type { LabelOwner } from "./labelEngine";

/** A flight-path name belongs above the flight, with a connector to its apex.
 * The owner's full ink box would also offer slots below the landing surface. */
export function bindTrajectoryLabelPlacement(
  document: SceneDocument,
  primitives: RenderPrimitive[],
  owners: LabelOwner[],
  summaryLabelIds: ReadonlySet<string>,
): LabelOwner[] {
  const trajectories = new Set(document.entities.filter(entity => /\btrajectory\b/i.test(entity.role ?? "")).map(entity => entity.id));
  for (const construction of document.constructions) {
    if (construction.operator === "projectile_trajectory" && construction.outputs[0]) trajectories.add(construction.outputs[0]);
  }
  return owners.map(owner => {
    if (!trajectories.has(owner.entityId) || (owner.labelId && summaryLabelIds.has(owner.labelId))) return owner;
    const points = primitives.filter(primitive => primitive.entityId === owner.entityId && primitive.kind === "polyline").flatMap(primitive => primitive.points);
    if (points.length < 2 || !owner.viewBounds) return owner;
    const apex = points.reduce((best, point) => point.y < best.y ? point : best);
    const view = owner.viewBounds;
    return { ...owner, anchor: apex, preferredSlot: "north", useOwnerBounds: false,
      // The whole glyph box must remain above every point of the path.
      placementBounds: { ...view, height: Math.max(0, Math.min(view.height, apex.y - view.y)) },
      allowLeader: true, requireLeader: true, leaderGeometrySafe: true };
  });
}
