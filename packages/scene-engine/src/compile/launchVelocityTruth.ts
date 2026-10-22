import type { SceneDocument, SceneIssue } from "../types";

type Point = { x: number; y: number };
type Path = { kind: string; points?: Point[]; kinematicTrajectory?: unknown; sampledCurve?: {
  parameterMin: number; parameterMax: number;
  evaluate(at: number): Point; derivative?: (at: number) => Point;
} };
const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** A named launch velocity must start on its uniquely bound trajectory and follow its
 * analytic tangent into the drawn path. No chapter or source-text routing. */
export function validateLaunchVelocityTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
  const trajectories = document.entities.filter(e => /\btrajectory\b/i.test(e.role ?? "") &&
    (geometry.get(e.id) as Path | undefined)?.kind === "path");
  if (trajectories.length === 0) return [];
  const issues: SceneIssue[] = [];
  for (const entity of document.entities.filter(e => e.kind === "vector" && /\blaunch velocity\b/i.test(e.role ?? ""))) {
    // The atomic operator already derives its own velocity at the launch point.
    if (document.constructions.some(c => c.operator === "projectile_trajectory" && c.outputs[1] === entity.id &&
        trajectories.some(t => t.id === c.outputs[0]))) continue;
    const fail = (message: string) => issues.push({ code: "launch_velocity_contradiction", severity: "fatal" as const,
      failureKind: "truth" as const, entityIds: [...trajectories.map(t => t.id), entity.id], message });
    try {
      const vector = geometry.get(entity.id) as Path | undefined;
      const start = vector?.points?.[0], tip = vector?.points?.at(-1);
      if (!start || !tip || !finite(start) || !finite(tip)) {
        fail("A declared launch velocity needs a computable trajectory tangent; use the trajectory's derived velocity output.");
        continue;
      }
      const candidates = trajectories.flatMap(trajectory => {
        const path = geometry.get(trajectory.id) as Path, curve = path.sampledCurve;
        // A time trajectory has a forward direction. Its final state cannot
        // become a new launch by reversing time. Generic function plots may
        // be traversed from either endpoint.
        const ends = curve ? (path.kinematicTrajectory ? [curve.parameterMin] : [curve.parameterMin, curve.parameterMax]).map(at => ({ at, point: curve.evaluate(at) }))
          : [path.points?.[0], path.points?.at(-1)].filter((p): p is Point => !!p).map((point, at) => ({ at, point }));
        const anchor = ends[0]?.point;
        if (!anchor) return [];
        const span = Math.max(...(path.points ?? []).map(p => Math.hypot(p.x - anchor.x, p.y - anchor.y)), 1e-9);
        const endpoint = ends.find(end => finite(end.point) && Math.hypot(start.x - end.point.x, start.y - end.point.y) <= span * 1e-7);
        return endpoint ? [{ curve, endpoint }] : [];
      });
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      const curve = candidate?.curve, derivative = curve?.derivative;
      if (!candidate || !curve || !derivative) {
        fail("A declared launch velocity must bind to one computable trajectory endpoint; derive it from that trajectory.");
        continue;
      }
      const { endpoint } = candidate;
      const tangent = derivative(endpoint.at), direction = endpoint.at === curve.parameterMin ? 1 : -1;
      const dx = tip.x - start.x, dy = tip.y - start.y, norm = Math.hypot(dx, dy) * Math.hypot(tangent.x, tangent.y);
      if (!finite(tangent) || !(norm > 0) || Math.abs(dx * tangent.y - dy * tangent.x) > norm * 1e-7 ||
          direction * (dx * tangent.x + dy * tangent.y) <= 0) {
        fail("A declared launch velocity must be tangent to the trajectory and point into its drawn flight path.");
      }
    } catch {
      fail("The declared launch velocity's trajectory tangent could not be proved.");
    }
  }
  return issues;
}
