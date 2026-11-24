import type { RenderPrimitive, SceneIssue } from "../types";
import { placeLabels, type LabelEngineOptions, type LabelObstacle, type LabelOwner } from "./labelEngine";

export interface AtomicPropertyLabelSource { primitive: RenderPrimitive; owner: LabelOwner }
export interface AtomicPropertyLabelPlacement { labels: RenderPrimitive[]; leaders: RenderPrimitive[]; issues: SceneIssue[] }
const round = (value: number): number => Math.round(value * 100) / 100;

/** Only the compiler's freshly regenerated atomic facts enter this pass.
 * They retain complete values, units, identity and answer-stage bindings. The
 * public document label ceiling and the label work budgets stay unchanged. */
export function placeAtomicPropertyLabels(sources: readonly AtomicPropertyLabelSource[], obstacles: LabelObstacle[],
  options: LabelEngineOptions): AtomicPropertyLabelPlacement {
  if (!sources.length) return { labels: [], leaders: [], issues: [] };
  const placed = placeLabels(sources.map(source => source.owner), obstacles, { ...options, maxLabelChars: 80 });
  const issues: SceneIssue[] = placed.issues.map(issue => ({ code: issue.code, message: issue.message, severity: "fatal", failureKind: "proof",
    entityIds: sources.filter(source => source.owner.entityId === issue.entityId || source.primitive.id === issue.entityId).map(source => source.primitive.entityId) }));
  if (!placed.ok) return { labels: sources.map(source => source.primitive), leaders: [], issues };
  const labels: RenderPrimitive[] = [], leaders: RenderPrimitive[] = [];
  for (const placement of placed.placements) {
    const source = sources.find(value => value.primitive.id === placement.labelId);
    if (!source) continue;
    const primitive: RenderPrimitive = { ...source.primitive, entityId: source.owner.entityId,
      points: [{ x: round(placement.bounds.x + placement.bounds.width / 2), y: round(placement.bounds.y + placement.bounds.height / 2) }],
      labelPlacement: "absolute", provenance: { ...source.primitive.provenance, fontPx: options.fontHeightPx ?? 24, labelPad: 0,
        labelAnchor: source.owner.anchor, labelBounds: placement.bounds, labelCollisionBounds: placement.collisionBounds ?? placement.bounds,
        usesLeader: placement.usesLeader } };
    labels.push(primitive);
    if (placement.usesLeader && placement.leaderFrom && placement.leaderTo) leaders.push({
      id: `${primitive.id}_leader`, entityId: primitive.entityId, groupId: primitive.groupId, kind: placement.leaderPath ? "polyline" : "line",
      points: (placement.leaderPath ?? [placement.leaderFrom, placement.leaderTo]).map(point => ({ x: round(point.x), y: round(point.y) })),
      provenance: { ...source.primitive.provenance, atomicLabelLeader: true, labelLeader: true, strokeRole: "construction", dashed: true },
    });
  }
  if (labels.length !== sources.length) issues.push({ code: "label_unattached", message: "Every regenerated atomic fact must retain a measured placement",
    severity: "fatal", failureKind: "proof", entityIds: sources.map(source => source.primitive.entityId) });
  return { labels, leaders, issues };
}
