/** Object/image claims must describe the same optical construction as its rays. */
import type { SceneDocument, SceneEntity, SceneIssue } from "../types";
interface Point {
    x: number;
    y: number;
}
interface GeometryLike {
    kind: string;
}
interface PathGeometry extends GeometryLike {
    kind: "path";
    points: Point[];
    closed?: boolean;
    directed?: boolean;
    infinite?: boolean;
    elementClip?: Point;
}
interface PointGeometry extends GeometryLike {
    kind: "point";
    point: Point;
}
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const norm = (a: Point) => Math.hypot(a.x, a.y);
const distance = (a: Point, b: Point) => norm(subtract(a, b));
const path = (g: GeometryLike | undefined): PathGeometry | undefined => g?.kind === 'path' && (g as PathGeometry).points.length >= 2 ? g as PathGeometry : undefined;
const point = (g: GeometryLike | undefined): Point | undefined => g?.kind === 'point' ? (g as PointGeometry).point : undefined;
const role = (e: SceneEntity) => e.role.toLowerCase().replace(/[_-]/g, ' ');
function intersection(a: Point, b: Point, c: Point, d: Point): Point | undefined {
    const ab = subtract(b, a), cd = subtract(d, c), den = cross(ab, cd);
    if (Math.abs(den) <= 1e-9 * norm(ab) * norm(cd))
        return;
    const t = cross(subtract(c, a), cd) / den;
    return { x: a.x + t * ab.x, y: a.y + t * ab.y };
}
function validateTrainBindings(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    const trains = document.constructions.filter(c => c.operator === 'optical_train');
    // Unlinked diagrams may intentionally depict several different optical trains.
    // Without an explicit owner, cross-bind only the unique train in this scene.
    if (trains.length !== 1)
        return;
    const train = trains[0]!;
    const inputs = train.inputs;
    const axis = path(geometry.get(String(inputs.axis)));
    if (!axis)
        return;
    const along = subtract(axis.points[1]!, axis.points[0]!);
    const scale = norm(along);
    if (!(scale > 0))
        return;
    const unit = { x: along.x / scale, y: along.y / scale };
    const tolerance = 1e-5 * Math.max(1, scale);
    const drawn = new Set(document.requiredEntityIds);
    const trainIds = new Set(train.outputs);
    const objects = document.entities.filter(e => drawn.has(e.id) && !trainIds.has(e.id) && /^(?:(?:upright|inverted|finite|small) )?(?:object|specimen)(?: arrow| point)?$/.test(role(e)));
    const images = document.entities.filter(e => drawn.has(e.id) && !trainIds.has(e.id) && /\bimage\b/.test(role(e)) && !/\b(?:ray|plane|focus|distance|base|tip|position)\b/.test(role(e)));
    const fail = (message: string, entityIds: string[], expected: unknown, actual: unknown) => issues.push({ code: 'invalid_optical_path_binding', failureKind: 'truth', severity: 'fatal', path: `constructions.${train.id}`, entityIds, message, expected, actual });
    const object = point(geometry.get(String(inputs.object)));
    if (object && objects.length === 1) {
        const entity = objects[0]!;
        const value = geometry.get(entity.id);
        const arrow = path(value);
        const declared = point(value) ?? arrow?.points.at(-1);
        if (declared && distance(object, declared) > tolerance)
            fail('Optical rays use a different object point from the declared object', [entity.id, ...train.outputs.slice(0, 2)], declared, object);
    }
    const inside = train.outputs.slice(2, 4).map(id => path(geometry.get(id)));
    const outgoing = train.outputs.slice(4, 6).map(id => path(geometry.get(id)));
    const intermediate = inside[0] && inside[1] ? intersection(inside[0].points[0]!, inside[0].points[1]!, inside[1].points[0]!, inside[1].points[1]!) : undefined;
    const final = outgoing[0] && outgoing[1] ? intersection(outgoing[0].points[0]!, outgoing[0].points[1]!, outgoing[1].points[0]!, outgoing[1].points[1]!) : undefined;
    for (const image of images) {
        const arrow = path(geometry.get(image.id));
        if (!arrow || arrow.closed)
            continue;
        const foot = arrow.points[0]!, tip = arrow.points.at(-1)!;
        const delta = subtract(tip, foot);
        const footOnAxis = Math.abs(cross(subtract(foot, axis.points[0]!), unit)) <= tolerance;
        if (footOnAxis && Math.abs(dot(delta, unit)) > tolerance) {
            fail('An image arrow must stand across its optical axis, not join two different axial positions', [image.id], 'transverse image extent', { foot, tip });
        }
        const expected = /\bintermediate\b/.test(role(image)) ? intermediate : /\bfinal\b/.test(role(image)) ? final : undefined;
        if (expected && distance(tip, expected) > tolerance)
            fail('The declared image tip is not the intersection of its optical rays', [image.id], expected, tip);
    }
    const question = typeof document.source?.question === 'string' ? document.source.question : '';
    const explicitFinalInfinity = /\bfinal\s+(?:virtual\s+)?image\s+(?:(?:is|lies|appears)\s+|(?:is\s+)?(?:formed|located)\s+)?at\s+infinity\b/i.test(question);
    if (explicitFinalInfinity && (inputs.finalImage !== undefined || inputs.virtualImage !== undefined)) {
        fail('A source-declared final image at infinity cannot be replaced by a finite image point', train.outputs.slice(4, 6), 'parallel outgoing rays / image at infinity', inputs.finalImage ?? inputs.virtualImage);
    }
}
/** A train may bend rays at a schematic plane, but a drawn lens on that
 * plane limits its aperture. Missing bodies establish no aperture claim. */
function validateTrainApertures(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    const drawn = new Set(document.requiredEntityIds);
    for (const train of document.constructions.filter(c => c.operator === 'optical_train')) {
        const axis = path(geometry.get(String(train.inputs.axis)));
        if (!axis) continue;
        const direction = subtract(axis.points[1]!, axis.points[0]!);
        const scale = norm(direction);
        if (!(scale > 0)) continue;
        const across = { x: -direction.y / scale, y: direction.x / scale };
        const tolerance = 1e-5 * Math.max(1, scale);
        for (const [role, outputIndices] of [['objective', [2, 3]], ['eyepiece', [4, 5]]] as const) {
            const plane = path(geometry.get(String(train.inputs[role])));
            if (!plane) continue;
            const bodies = document.constructions.filter(c => c.operator === 'lens_section' && c.inputs.axis === train.inputs.axis).flatMap(c => {
                const id = c.outputs[0];
                // Resolve the same centre aliases as the validator and compiler.
                const centre = point(geometry.get(String(c.inputs.center ?? c.inputs.opticalCentre ?? c.inputs.optical_center)));
                const body = id && drawn.has(id) ? path(geometry.get(id)) : undefined;
                const planeDirection = subtract(plane.points[1]!, plane.points[0]!);
                return id && centre && body?.closed && Math.abs(cross(subtract(centre, plane.points[0]!), planeDirection)) <= tolerance * norm(planeDirection)
                    ? [{ id, body, centre }] : [];
            });
            if (bodies.length !== 1) continue; // No unique aperture binding.
            const { id, body, centre } = bodies[0]!;
            const transverse = body.points.map(p => dot(subtract(p, centre), across));
            const low = Math.min(...transverse), high = Math.max(...transverse);
            for (const outputIndex of outputIndices) {
                const rayId = train.outputs[outputIndex];
                const ray = rayId ? path(geometry.get(rayId)) : undefined;
                if (!ray) continue;
                const contact = dot(subtract(ray.points[0]!, centre), across);
                if (contact < low - tolerance || contact > high + tolerance) issues.push({
                    code: 'invalid_optical_aperture_binding', severity: 'fatal', failureKind: 'truth',
                    path: `constructions.${train.id}`, entityIds: [id, rayId!],
                    message: 'A ray bends outside the aperture of the lens drawn on its optical plane.',
                    expected: { min: low, max: high }, actual: contact,
                });
            }
        }
    }
}
function nearSegment(p: Point, a: Point, b: Point, tolerance: number): boolean {
    const ab = subtract(b, a), ap = subtract(p, a), length = norm(ab);
    return length > 0 && Math.abs(cross(ap, ab)) / length <= tolerance && dot(ap, ab) >= -tolerance * length && dot(subtract(p, b), ab) <= tolerance * length;
}
function insidePolygon(p: Point, vertices: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[i]!, b = vertices[j]!;
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
            inside = !inside;
    }
    return inside;
}
function validateBodyMedia(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    const events = document.constructions.filter(c => c.operator === 'refract_at' || c.operator === 'refract_direction');
    const refs = new Set(events.flatMap(c => [c.inputs.n1, c.inputs.n2]).filter((v): v is string => typeof v === 'string'));
    if (!refs.size)
        return;
    const quantities = new Map(document.quantities.map(q => [q.id, q]));
    const scalar = (v: unknown): number | undefined => {
        if (typeof v === 'number')
            return v;
        if (typeof v === 'string') {
            const q = quantities.get(v);
            return typeof q?.value === 'number' ? q.value : undefined;
        }
        return;
    };
    for (const body of document.entities) {
        const polygon = path(geometry.get(body.id));
        if (!polygon?.closed || polygon.points.length < 3)
            continue;
        const indices = new Set<string>();
        for (const annotation of document.annotations.filter(a => a.targetIds.includes(body.id))) {
            // An explicit quantityId wins over symbol matching, as in mediumBindings:
            // two media may share the printed symbol "n".
            if (annotation.quantityId) {
                if (refs.has(annotation.quantityId))
                    indices.add(annotation.quantityId);
                continue;
            }
            const symbol = annotation.text?.split('=')[0]?.trim();
            if (symbol)
                for (const ref of refs)
                    if (quantities.get(ref)?.symbol === symbol)
                        indices.add(ref);
        }
        if (!indices.size)
            continue;
        const values = [...indices].map(scalar).filter((v): v is number => v !== undefined);
        const span = Math.max(...polygon.points.map(p => distance(p, polygon.points[0]!)));
        const tolerance = Math.max(1, span) * 1e-6;
        const matches = (v: unknown) => indices.has(String(v)) || values.some(value => { const number = scalar(v); return number !== undefined && Math.abs(number - value) <= 1e-9 * Math.max(1, value); });
        for (const event of events) {
            const n1Inside = matches(event.inputs.n1), n2Inside = matches(event.inputs.n2);
            if (n1Inside === n2Inside)
                continue;
            const incidentId = event.operator === 'refract_at' ? event.outputs[0] : event.inputs.incoming;
            const outgoingId = event.operator === 'refract_at' ? event.outputs[2] : event.outputs[0];
            const incident = typeof incidentId === 'string' ? path(geometry.get(incidentId)) : undefined;
            const outgoing = typeof outgoingId === 'string' ? path(geometry.get(outgoingId)) : undefined;
            if (!incident || !outgoing)
                continue;
            const contact = outgoing.points[0]!;
            if (!polygon.points.some((p, i) => nearSegment(contact, p, polygon.points[(i + 1) % polygon.points.length]!, tolerance)))
                continue;
            const before = subtract(incident.points[0]!, contact), after = subtract(outgoing.points[1]!, contact);
            if (norm(before) <= tolerance || norm(after) <= tolerance)
                continue;
            const step = Math.max(tolerance * 10, span * 1e-4);
            const incidentInside = insidePolygon({ x: contact.x + before.x / norm(before) * step, y: contact.y + before.y / norm(before) * step }, polygon.points);
            const outgoingInside = insidePolygon({ x: contact.x + after.x / norm(after) * step, y: contact.y + after.y / norm(after) * step }, polygon.points);
            if (incidentInside !== n1Inside || outgoingInside !== n2Inside) {
                issues.push({ code: 'invalid_optical_medium_binding', failureKind: 'truth', severity: 'fatal', entityIds: [body.id, String(incidentId), String(outgoingId)], path: `constructions.${event.id}`, message: 'Ray sides contradict the refractive index explicitly assigned to this closed body', expected: { incidentInside: n1Inside, outgoingInside: n2Inside }, actual: { incidentInside, outgoingInside } });
            }
        }
    }
}
function validatePointObjectOrigins(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    const objects = document.entities.filter(e => document.requiredEntityIds.includes(e.id) && /^(?:(?:finite|small) )?object(?: point)?$/.test(role(e)));
    if (objects.length !== 1 || objects[0]!.kind !== 'point')
        return;
    const source = point(geometry.get(objects[0]!.id));
    if (!source)
        return;
    const contacts = new Set(document.constructions.filter(c => c.operator === 'surface_contact' || c.operator === 'surface_intersection').map(c => c.outputs[0]));
    for (const c of document.constructions) {
        if (c.operator !== 'surface_contact' || contacts.has(String(c.inputs.origin)))
            continue;
        const incident = path(geometry.get(c.outputs[1]!));
        if (!incident)
            continue;
        const a = incident.points[0]!, b = incident.points.at(-1)!, ab = subtract(b, a), length = norm(ab);
        const tolerance = 1e-5 * Math.max(1, length, distance(source, a));
        if (length > 0 && Math.abs(cross(subtract(source, a), ab)) / length > tolerance) {
            issues.push({ code: 'invalid_optical_object_origin', failureKind: 'truth', severity: 'fatal', entityIds: [objects[0]!.id, c.outputs[1]!], path: `constructions.${c.id}`, message: 'The incident ray does not pass through the uniquely declared object point', expected: source, actual: { start: a, end: b } });
        }
    }
}
function validateRefractingAngleBindings(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    const drawn = new Set(document.requiredEntityIds);
    const angles = document.entities.filter(e => drawn.has(e.id) && e.kind === 'angle_mark' && /\brefracting angle\b/.test(role(e)));
    if (angles.length !== 1)
        return;
    const angle = angles[0]!, construction = document.constructions.find(c => c.operator === 'angle_mark' && c.outputs.includes(angle.id));
    if (!construction)
        return;
    const vertex = point(geometry.get(String(construction.inputs.vertex))), a = point(geometry.get(String(construction.inputs.a))), b = point(geometry.get(String(construction.inputs.b)));
    if (!vertex || !a || !b)
        return;
    const bodies = document.entities.filter(e => drawn.has(e.id)).flatMap(e => { const g = path(geometry.get(e.id)); return g?.closed && g.points.length >= 3 ? [{ id: e.id, g }] : []; });
    const edges = (body: typeof bodies[number]) => body.g.points.map((p, i) => [p, body.g.points[(i + 1) % body.g.points.length]!] as const);
    const tolerance = (body: typeof bodies[number]) => 1e-7 * Math.max(1, ...body.g.points.map(p => distance(p, vertex)));
    const owners = bodies.filter(body => {
        const epsilon = tolerance(body), incident = edges(body).filter(([p, q]) => distance(vertex, p) <= epsilon || distance(vertex, q) <= epsilon);
        return incident.some(([p, q]) => nearSegment(a, p, q, epsilon)) && incident.some(([p, q]) => nearSegment(b, p, q, epsilon));
    });
    if (owners.length !== 1)
        return;
    const owner = owners[0]!, epsilon = tolerance(owner);
    for (const face of document.entities.filter(e => drawn.has(e.id) && /\brefracting face\b/.test(role(e)))) {
        const g = path(geometry.get(face.id));
        if (!g || g.points.length !== 2)
            continue;
        const faceOwners = bodies.filter(body => edges(body).some(([p, q]) => g.points.every(v => nearSegment(v, p, q, tolerance(body)))));
        if (faceOwners.length !== 1 || faceOwners[0]!.id !== owner.id)
            continue;
        const edge = edges(owner).find(([p, q]) => g.points.every(v => nearSegment(v, p, q, epsilon)));
        if (edge && !nearSegment(vertex, edge[0], edge[1], epsilon)) {
            issues.push({ code: 'invalid_refracting_angle_binding', failureKind: 'truth', severity: 'fatal', entityIds: [angle.id, face.id, owner.id], path: `constructions.${construction.id}`, message: 'The declared refracting angle must join the explicitly declared refracting faces of the same closed body', expected: 'angle vertex on the refracting face edge', actual: vertex });
        }
    }
}
export function validateOpticalPathTruth(document: SceneDocument, geometry: ReadonlyMap<string, GeometryLike>, issues: SceneIssue[]): void {
    validateTrainBindings(document, geometry, issues);
    validateTrainApertures(document, geometry, issues);
    validateBodyMedia(document, geometry, issues);
    validatePointObjectOrigins(document, geometry, issues);
    validateRefractingAngleBindings(document, geometry, issues);
}
/**
 * A bare incident ray has no authority to continue obliquely through a declared
 * refracting face. Bind only an explicitly optical incoming ray to an actual
 * edge of a drawn closed body; stop at the first unresolved oblique crossing.
 * Normal incidence is unchanged, as are unrelated mathematical rays. The clip
 * uses the same geometry metadata as the engine's operator-bound light paths.
 */
export function clipDeclaredOpticalIncidentPaths(document: SceneDocument, geometry: Map<string, GeometryLike>, drawn: (id: string) => boolean = (id) => document.requiredEntityIds.includes(id)): void {
    const bodies = document.entities.filter(e => drawn(e.id)).flatMap(e => { const g = path(geometry.get(e.id)); return g?.closed && g.points.length >= 3 ? [g] : []; });
    if (!bodies.length)
        return;
    const faces = document.entities.filter(e => drawn(e.id) && /\b(?:refracting face|entrance surface|entrance face)\b/.test(role(e))).flatMap(e => {
        const g = path(geometry.get(e.id));
        if (!g || g.points.length !== 2)
            return [];
        const a = g.points[0]!, b = g.points[1]!, span = distance(a, b), tolerance = Math.max(1, span) * 1e-7;
        const owners = bodies.filter(body => body.points.some((p, i) => nearSegment(a, p, body.points[(i + 1) % body.points.length]!, tolerance) && nearSegment(b, p, body.points[(i + 1) % body.points.length]!, tolerance)));
        return owners.length === 1 ? [{ a, b, body: owners[0]!, span }] : [];
    });
    if (!faces.length)
        return;
    for (const construction of document.constructions) {
        if (construction.operator !== 'ray')
            continue;
        const id = construction.outputs[0];
        if (!id || !drawn(id))
            continue;
        const entity = document.entities.find(e => e.id === id);
        if (!entity || !/\b(?:incident(?:\s+light)?\s+ray|incoming\s+(?:light|ray)|ray\s+entering|ray\s+launched)\b/.test(role(entity)))
            continue;
        const ray = path(geometry.get(id));
        if (!ray?.infinite || !ray.directed || ray.points.length !== 2)
            continue;
        const origin = ray.points[0]!, direction = subtract(ray.points[1]!, origin), length = norm(direction);
        if (!(length > 0))
            continue;
        let best: Point | undefined;
        for (const face of faces) {
            if (insidePolygon(origin, face.body.points))
                continue;
            const edge = subtract(face.b, face.a), den = cross(direction, edge);
            if (Math.abs(den) <= 1e-10 * length * face.span)
                continue;
            // An exact normal crossing through a transparent face does not bend light.
            if (Math.abs(dot(direction, edge)) <= 1e-9 * length * face.span)
                continue;
            const offset = subtract(face.a, origin), t = cross(offset, edge) / den, u = cross(offset, direction) / den;
            if (t <= 1e-8 || u < 0 || u > 1)
                continue;
            const hit = { x: origin.x + t * direction.x, y: origin.y + t * direction.y };
            const step = Math.max(1, face.span) * 1e-6;
            const before = { x: hit.x - direction.x / length * step, y: hit.y - direction.y / length * step };
            const after = { x: hit.x + direction.x / length * step, y: hit.y + direction.y / length * step };
            if (insidePolygon(before, face.body.points) === insidePolygon(after, face.body.points))
                continue;
            if (!best || distance(origin, hit) < distance(origin, best))
                best = hit;
        }
        if (best && (!ray.elementClip || distance(origin, best) < distance(origin, ray.elementClip))) {
            const clipped: PathGeometry = { ...ray, elementClip: best };
            geometry.set(id, clipped);
        }
    }
}
