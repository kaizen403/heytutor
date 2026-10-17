import type { SceneDocument, SceneIssue } from "../types";
type Point = {
    x: number;
    y: number;
};
type Shape = {
    kind: string;
    point?: Point;
    points?: Point[];
    closed?: boolean;
    sampledCurve?: {
        curveKind: string;
        parameterMin: number;
        parameterMax: number;
        evaluate: (parameter: number) => Point;
    };
};
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
/** Refine only a declared semicircle produced by an analytic function operator.
 * Every inserted point is evaluated from the original function, never fitted to
 * a circle. Preserve existing points/order and the 0.5% radius sagitta bound;
 * x-uniform sampling is angularly sparse at vertical circle endpoints.
 * Compiler assertions and all label/layout guards still run after this helper.
 */
function refineAnalyticSemicircleSamples(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): void {
    for (const entity of document.entities) {
        if (!/\bsemicircular\b/i.test(entity.role ?? "") ||
            !document.constructions.some(c => c.operator === "function_curve" && c.outputs.includes(entity.id))) continue;
        const value = geometry.get(entity.id) as Shape | undefined;
        const curve = value?.sampledCurve, points = value?.points;
        if (value?.kind !== "path" || curve?.curveKind !== "function" || !points || points.length < 2 || points.length > 2049) continue;
        const center = { x: (points[0]!.x + points.at(-1)!.x) / 2, y: (points[0]!.y + points.at(-1)!.y) / 2 };
        const radius = Math.hypot(points[0]!.x - center.x, points[0]!.y - center.y);
        const onCircle = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y) &&
            Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius) <= radius * 0.005;
        if (!(radius > 0) || !points.every(onCircle) || points.some((p, i) =>
            p.x < curve.parameterMin || p.x > curve.parameterMax || (i > 0 && p.x <= points[i - 1]!.x))) continue;
        const refined: Point[] = [points[0]!];
        const append = (a: Point, b: Point, depth: number): boolean => {
            if (Math.hypot(b.x - a.x, b.y - a.y) <= radius * 0.19975) {
                if (refined.length >= 2049) return false;
                refined.push(b);
                return true;
            }
            if (depth >= 12) return false;
            const parameter = (a.x + b.x) / 2;
            if (!(parameter > a.x && parameter < b.x)) return false;
            const midpoint = curve.evaluate(parameter);
            if (Math.abs(midpoint.x - parameter) > 1e-9 * Math.max(1, Math.abs(parameter)) || !onCircle(midpoint)) return false;
            return append(a, midpoint, depth + 1) && append(midpoint, b, depth + 1);
        };
        try {
            if (points.slice(1).every((point, i) => append(points[i]!, point, 0))) value.points = refined;
        } catch {
            // An unevaluable interval retains its original samples and fails the
            // same geometric guard; no analytic evaluation failure is waived.
        }
    }
}
/** Validate mathematical claims carried by entity roles/labels. These checks
 * never infer a construction from a chapter name or a question identifier. */
export function validateDeclaredGeometryTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
    refineAnalyticSemicircleSamples(document, geometry);
    const issues: SceneIssue[] = [];
    const shape = (id: string) => geometry.get(id) as Shape | undefined;
    const fail = (ids: string[], message: string) => issues.push({ code: "declared_geometry_contradiction", severity: "fatal", failureKind: "truth", entityIds: ids, message });
    for (const entity of document.entities) {
        const value = shape(entity.id);
        if (value?.kind !== "path" || !value.points || value.points.length < 2)
            continue;
        const points = value.points;
        if (entity.kind === "vector" && entity.label) {
            const text = entity.label.normalize("NFKC").replace(/[\sˆ^{}]/g, "").replace(/−/g, "-");
            // A complete Cartesian basis expression, not an arbitrary vector name.
            if (/^[+-]?(?:\d+(?:\.\d+)?)?[ij](?:[+-](?:\d+(?:\.\d+)?)?[ij])*$/.test(text)) {
                const expected = { x: 0, y: 0 };
                for (const term of text.matchAll(/([+-]?)(\d+(?:\.\d+)?)?([ij])/g))
                    expected[term[3] === "i" ? "x" : "y"] += (term[1] === "-" ? -1 : 1) * Number(term[2] ?? 1);
                const actual = subtract(points.at(-1)!, points[0]!);
                if (Math.hypot(actual.x - expected.x, actual.y - expected.y) > 1e-7 * Math.max(1, Math.hypot(expected.x, expected.y)))
                    fail([entity.id], "A Cartesian vector label contradicts its computed components.");
            }
        }
        if (document.entities.some(e => /\borbital focus\b/i.test(e.role ?? "")) && /\borbit\b/i.test(entity.role ?? "") && points.length >= 4 && Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) < 1e-8) {
            const vertices = points.slice(0, -1);
            if (vertices.some((p, i) => { const a = subtract(p, vertices[(i + vertices.length - 1) % vertices.length]!), b = subtract(vertices[(i + 1) % vertices.length]!, p); return Math.abs(Math.atan2(cross(a, b), a.x * b.x + a.y * b.y)) > Math.PI / 12; }))
                fail([entity.id], "A declared smooth closed orbit cannot be represented by sharp polygon corners.");
        }
        // A polygonal approximation of an explicitly circular path must keep each
        // chord's sagitta below 0.5% of its radius. Coarse corners are false ink.
        if (/\bsemicircular\b/i.test(entity.role ?? "")) {
            const center = { x: (points[0]!.x + points.at(-1)!.x) / 2, y: (points[0]!.y + points.at(-1)!.y) / 2 };
            const radius = Math.hypot(points[0]!.x - center.x, points[0]!.y - center.y);
            const radial = points.map(p => subtract(p, center));
            const steps = radial.slice(1).map((p, i) => Math.atan2(cross(radial[i]!, p), radial[i]!.x * p.x + radial[i]!.y * p.y));
            const turn = steps.reduce((sum, step) => sum + step, 0);
            const orientation = Math.sign(turn);
            // Radius/chord checks alone also admit repeated revolutions and
            // backtracking. A semicircle traverses one half-plane monotonically.
            const invalidTraversal = Math.abs(Math.abs(turn) - Math.PI) > 1e-7
                || steps.some(step => orientation * step < -1e-7)
                || radial.some(p => orientation * cross(radial[0]!, p) < -1e-7 * radius * radius);
            if (invalidTraversal || !(radius > 0) || points.some(p => Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius) > radius * 0.005) || points.slice(1).some((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y) > radius * 0.19975))
                fail([entity.id], "A declared semicircular path must approximate a semicircle within geometric tolerance.");
        }
    }
    // Layout coordinates carry no numeric-axis meaning. A standalone layout
    // point inside a Cartesian plot would falsely assert a coordinate relation.
    const axes = document.constructions.filter(c => c.operator === "axes");
    for (const c of document.constructions.filter(c => c.operator === "point" && c.inputs.coordinateSpace === "layout")) {
        const id = c.outputs[0];
        if (!id)
            continue;
        const entity = document.entities.find(e => e.id === id), p = shape(id)?.point;
        if (!p || entity?.kind !== "point" || !entity.label)
            continue;
        const used = document.constructions.some(other => other !== c && Object.values(other.inputs).some(v => v === id || (Array.isArray(v) && v.includes(id))));
        if (used)
            continue;
        for (const axis of axes) {
            const v = axis.inputs;
            if ([v.xMin, v.xMax, v.yMin, v.yMax].every(x => typeof x === "number") && p.x >= Number(v.xMin) && p.x <= Number(v.xMax) && p.y >= Number(v.yMin) && p.y <= Number(v.yMax))
                fail([id, axis.outputs[0]!], "An independent layout point cannot assert a position in a numeric coordinate plot.");
        }
    }
    // Contact force directions have an unambiguous reference only when exactly
    // one straight supporting plane is declared. Never guess among surfaces.
    const supports = document.entities.filter(e => /^(?:inclined plane|supporting plane|support surface)$/i.test(e.role ?? "") && shape(e.id)?.kind === "path");
    if (supports.length === 1) {
        const support = supports[0]!, points = shape(support.id)!.points!;
        const tangent = subtract(points.at(-1)!, points[0]!);
        for (const entity of document.entities.filter(e => e.kind === "vector")) {
            const value = shape(entity.id);
            if (!value?.points || value.points.length < 2)
                continue;
            const direction = subtract(value.points.at(-1)!, value.points[0]!);
            const norm = Math.hypot(tangent.x, tangent.y) * Math.hypot(direction.x, direction.y);
            const role = entity.role ?? "";
            if (/^(?:normal|normal force|normal reaction)$/i.test(role) && Math.abs(tangent.x * direction.x + tangent.y * direction.y) > 1e-6 * norm)
                fail([entity.id, support.id], "A contact normal must be perpendicular to its unique supporting plane.");
            if (/^(?:(?:static|kinetic|limiting) )?friction(?: force)?$/i.test(role) && Math.abs(cross(tangent, direction)) > 1e-6 * norm)
                fail([entity.id, support.id], "Contact friction must lie along its unique supporting plane.");
        }
    }
    // A drawn physical trajectory stops at the first terrain intersection.
    // Both roles must be explicit and the terrain must be unique and straight.
    const terrain = document.entities.filter(e => /\b(?:ground|hillside|terrain)\b/i.test(e.role ?? "") && shape(e.id)?.kind === "path" && shape(e.id)?.points?.length === 2);
    if (terrain.length === 1) {
        const ground = terrain[0]!, edge = shape(ground.id)!.points!, a = edge[0]!, b = edge[1]!;
        const direction = subtract(b, a);
        for (const entity of document.entities.filter(e => /\bprojectile (?:path|trajectory)\b/i.test(e.role ?? ""))) {
            const points = shape(entity.id)?.points;
            if (!points || points.length < 3)
                continue;
            for (let i = 1; i < points.length; i++) {
                const p = points[i - 1]!, q = points[i]!, step = subtract(q, p), den = cross(step, direction);
                if (Math.abs(den) < 1e-12)
                    continue;
                const offset = subtract(a, p), t = cross(offset, direction) / den, u = cross(offset, step) / den;
                const isLaunch = i === 1 && t <= 1e-7;
                const continuesAfterHit = t < 1 - 1e-7 || i < points.length - 1;
                if (!isLaunch && continuesAfterHit && t >= -1e-7 && t <= 1 + 1e-7 && u >= 0 && u <= 1) {
                    fail([entity.id, ground.id], "A physical projectile path continues beyond its intersection with declared terrain.");
                    break;
                }
            }
        }
    }
    return issues;
}
