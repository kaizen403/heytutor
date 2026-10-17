/** Verify explicit source relations against the solid's established base anchor contract. */
import type { SceneDocument, SceneIssue } from '../types';
interface Point {
    x: number;
    y: number;
}
interface GeometryLike {
    kind: string;
}
interface SolidGeometry extends GeometryLike {
    kind: 'compound';
    terminals: [
        Point,
        Point
    ];
    solidProjection?: {
        kind: string;
    };
}
interface PathGeometry extends GeometryLike {
    kind: 'path';
    points: Point[];
}
export function validateSolidSourceTruth(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    const source = typeof document.source?.question === 'string' ? document.source.question : '';
    // The source must assert this relationship, not merely mention a solid or sheet.
    const oppositeEnds = /\bone\s+(?:end|end face)\s+on\s+each\s+side\b|\b(?:ends|end faces)\s+(?:are\s+|lie\s+|lying\s+|on\s+){0,2}opposite\s+sides\b/i.test(source);
    if (!oppositeEnds)
        return;
    const solids = document.entities.filter(e => document.requiredEntityIds.includes(e.id)).flatMap(e => {
        const g = geometry.get(e.id) as SolidGeometry | undefined;
        return g?.kind === 'compound' && g.solidProjection?.kind === 'cylinder' ? [{ id: e.id, g }] : [];
    });
    const planes = document.entities.filter(e => document.requiredEntityIds.includes(e.id) && ['line', 'segment'].includes(e.kind) && /\b(?:sheet|plane)\b/i.test(e.role)).flatMap(e => {
        const g = geometry.get(e.id) as PathGeometry | undefined;
        return g?.kind === 'path' && g.points.length === 2 ? [{ id: e.id, g }] : [];
    });
    // No authority to assign an unlinked plane to one of several solids or vice versa.
    if (solids.length !== 1 || planes.length !== 1)
        return;
    const solid = solids[0]!, plane = planes[0]!, a = plane.g.points[0]!, b = plane.g.points[1]!;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!(length > 0))
        return;
    const signed = solid.g.terminals.map(p => ((p.x - a.x) * dy - (p.y - a.y) * dx) / length);
    const height = Math.hypot(solid.g.terminals[1].x - solid.g.terminals[0].x, solid.g.terminals[1].y - solid.g.terminals[0].y);
    const tolerance = 1e-7 * Math.max(1, height);
    if (!((signed[0]! > tolerance && signed[1]! < -tolerance) || (signed[0]! < -tolerance && signed[1]! > tolerance))) {
        issues.push({ code: 'invalid_solid_source_relation', failureKind: 'truth', severity: 'fatal', entityIds: [solid.id, plane.id], message: 'The source requires the solid end faces on opposite sides of the plane, but their centers do not straddle it', expected: 'opposite nonzero signed distances', actual: signed });
    }
}
