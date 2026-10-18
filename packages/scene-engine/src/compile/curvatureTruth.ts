/** Keep declared curvature centres and signed surface shape tied to actual ink. */
import type { SceneDocument, SceneEntity, SceneIssue } from "../types";
interface Point {
    x: number;
    y: number;
}
interface GeometryLike {
    kind: string;
}
interface PointGeometry extends GeometryLike {
    kind: "point";
    point: Point;
}
interface ArcGeometry extends GeometryLike {
    kind: "arc";
    center: Point;
    radius: number;
}
interface PathGeometry extends GeometryLike {
    kind: "path";
    points: Point[];
}
const point = (value: GeometryLike | undefined): Point | undefined => value?.kind === "point" ? (value as PointGeometry).point : undefined;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const role = (entity: SceneEntity | undefined) => (entity?.role ?? "").toLowerCase().replace(/[-–—]/g, " ");
const ordinal = (text: string) => text.match(/\b(first|second|third|fourth)\b/)?.[1];
const shape = (text: string) => text.match(/\b(concave|convex|plano)\b/)?.[1];
/**
 * This checks claims, not topics. A role calling a point a surface's centre of
 * curvature is a geometric claim even in a nonmetric representative. Ordinals
 * bind only when both roles declare the same ordinal and the pairing is unique;
 * an explicit semantic.surfaceId is also supported. Ambiguous roles are not
 * guessed. Unnamed spherical schematics retain their existing default shape.
 */
export function validateSphericalCurvatureTruth(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    const surfaces = document.constructions.filter(c => c.operator === "spherical_surface");
    const entities = new Map(document.entities.map(entity => [entity.id, entity]));
    const centres = document.entities.filter(entity => entity.kind === "point" && /\bcent(?:re|er) of curvature\b/.test(role(entity)));
    for (const surface of surfaces) {
        const id = surface.outputs[0];
        if (!id)
            continue;
        const inputs = surface.inputs;
        const entity = entities.get(id);
        const actual = geometry.get(id);
        const vertex = typeof (inputs.vertex ?? inputs.pole) === "string" ? point(geometry.get(String(inputs.vertex ?? inputs.pole))) : undefined;
        const arc = actual?.kind === "arc" ? actual as ArcGeometry : undefined;
        const fail = (message: string, expected: unknown, value: unknown, related: string[] = []) => {
            issues.push({ code: "invalid_spherical_curvature", failureKind: "truth", severity: "fatal", entityIds: [id, ...related], path: `constructions.${surface.id}`, message, expected, actual: value });
        };
        const candidates = centres.filter(centre => {
            if (centre.semantic?.surfaceId !== undefined)
                return centre.semantic.surfaceId === id;
            const order = ordinal(role(centre));
            if (order)
                return order === ordinal(role(entity)) && surfaces.filter(other => ordinal(role(entities.get(other.outputs[0]!))) === order).length === 1;
            return surfaces.length === 1;
        });
        if (candidates.length === 1) {
            const centre = candidates[0]!;
            const declared = point(geometry.get(centre.id));
            if (declared && (!arc || distance(arc.center, declared) > 1e-6 * Math.max(1, arc.radius))) {
                fail("The declared centre of curvature does not coincide with the constructed surface centre", declared, arc?.center ?? actual?.kind, [centre.id]);
            }
        }
        const inputShape = shape(String(inputs.kind ?? inputs.facing ?? ""));
        const roleShape = shape(role(entity));
        if (inputShape && roleShape && inputShape !== roleShape) {
            fail("Surface inputs contradict its declared shape", roleShape, inputShape);
        }
        const declaredShape = inputShape ?? roleShape;
        if (!declaredShape)
            continue;
        if (declaredShape === "plano") {
            if (actual?.kind !== "path")
                fail("A declared plane surface cannot have curved ink", "plane", actual?.kind);
            continue;
        }
        const axis = typeof inputs.axis === "string" ? geometry.get(inputs.axis) : undefined;
        if (!arc || !vertex || axis?.kind !== "path")
            continue;
        const ends = (axis as PathGeometry).points;
        if (ends.length < 2)
            continue;
        let dx = ends[1]!.x - ends[0]!.x;
        let dy = ends[1]!.y - ends[0]!.y;
        // Match the signed-Cartesian axis convention of sphericalSurfaceGeometry.
        if (dx < 0) {
            dx = -dx;
            dy = -dy;
        }
        // Shape is relative to the side the face bounds. A lens's far face
        // looks back toward its body, unlike a standalone incident-facing mirror.
        // Resolve orientation from declared facing or a unique body on this axis;
        // do not manufacture a contradiction when multiple free surfaces leave
        // their facing unspecified.
        const declaredFacing = entity?.semantic?.facing;
        let inward = declaredFacing === "left" ? 1 : declaredFacing === "right" ? -1 : undefined;
        if (inward === undefined) {
            const bodies = document.constructions.filter(c => c.operator === "lens_section" &&
                c.inputs.axis === inputs.axis &&
                (entity?.semantic?.bodyId === undefined || c.outputs.includes(String(entity.semantic.bodyId))));
            if (/\bmirror\b/.test(role(entity))) inward = 1;
            else if (bodies.length === 1) {
                const body = bodies[0]!;
                const centreRef = body.inputs.center ?? body.inputs.opticalCentre ?? body.inputs.optical_center;
                const centre = typeof centreRef === "string" ? point(geometry.get(centreRef)) : undefined;
                if (centre) {
                    const towardBody = (centre.x - vertex.x) * dx + (centre.y - vertex.y) * dy;
                    if (Math.abs(towardBody) > 1e-9) inward = Math.sign(towardBody);
                    else {
                        // Coincident vertices are a valid thin-surface schematic;
                        // only explicit face ordinals resolve their opposite sides.
                        const order = ordinal(role(entity));
                        if (order === "first") inward = 1;
                        if (order === "second") inward = -1;
                    }
                }
            }
            else if (surfaces.length === 1) inward = 1;
        }
        if (inward === undefined) continue;
        const sign = ((arc.center.x - vertex.x) * dx + (arc.center.y - vertex.y) * dy) * inward;
        if ((declaredShape === "concave" && sign >= 0) || (declaredShape === "convex" && sign <= 0)) {
            fail("Constructed signed curvature contradicts the declared surface shape", declaredShape, sign > 0 ? "convex" : sign < 0 ? "concave" : "degenerate");
        }
    }
}
