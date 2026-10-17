import type { SceneDocument, SceneIssue, RenderPrimitive } from "../types";
type Point = {
    x: number;
    y: number;
};
type Path = {
    kind: "path";
    points: Point[];
};
const key = (s: string) => s.normalize("NFKC").replace(/[{}_\s]/g, "").toLowerCase();
interface Binding {
    annotationId: string;
    surfaceId: string;
    rayId: string;
    contact: Point;
    far: Point;
    surface: Path;
}
export function mediumBindings(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): Binding[] {
    const bindings: Binding[] = [];
    for (const c of document.constructions) {
        if (c.operator !== "refract_at" && c.operator !== "reflect_at")
            continue;
        const surfaceId = String(c.inputs.surface), surface = geometry.get(surfaceId) as Path | undefined;
        const contact = geometry.get(String(c.inputs.point ?? c.inputs.contact)) as {
            kind: string;
            point: Point;
        } | undefined;
        if (surface?.kind !== "path" || surface.points.length < 2 || contact?.kind !== "point")
            continue;
        const annotations = document.annotations.filter(a => a.targetIds.includes(surfaceId) && ["label", "callout"].includes(a.kind));
        let reflectedMedium: string | undefined;
        if (c.operator === "reflect_at") {
            // Reflection alone does not identify the medium. A declared critical-angle
            // mark plus two explicit index assignments does: sin(theta_c)=n_low/n_high.
            const critical = document.constructions.some(mark => mark.operator === "angle_mark" && [mark.inputs.a, mark.inputs.b].includes(c.outputs[0]) && document.entities.some(e => mark.outputs.includes(e.id) && /^critical angle$/i.test(e.role ?? "")));
            const assignments = annotations.flatMap(a => { const match = (a.text ?? "").match(/\bn[^=]*=\s*(\d+(?:\.\d+)?)/i); return match ? [{ annotation: a, value: Number(match[1]) }] : []; });
            const input = c.inputs.incidentAngleDeg;
            const angle = typeof input === "number" ? input : document.quantities.find(q => q.id === input)?.value;
            if (critical && assignments.length === 2 && typeof angle === "number") {
                assignments.sort((a, b) => a.value - b.value);
                const [low, high] = assignments;
                if (low!.value > 0 && high!.value > low!.value && Math.abs(Math.sin(angle * Math.PI / 180) - low!.value / high!.value) < 1e-5)
                    reflectedMedium = high!.annotation.id;
            }
        }
        for (const [input, out] of [[c.inputs.n1, c.outputs[0]], [c.inputs.n2, c.outputs[2]]] as const) {
            if (!out)
                continue;
            const quantity = document.quantities.find(q => q.id === input);
            const symbols = [typeof input === "string" ? input : "", typeof quantity?.symbol === "string" ? quantity.symbol : ""].filter(Boolean).map(key);
            const path = geometry.get(out) as Path | undefined;
            if (path?.kind !== "path" || !path.points.length)
                continue;
            const far = path.points.reduce((p, q) => Math.hypot(q.x - contact.point.x, q.y - contact.point.y) > Math.hypot(p.x - contact.point.x, p.y - contact.point.y) ? q : p, path.points[0]!);
            const role = document.entities.find(e => e.id === out)?.role ?? "";
            const medium = role.match(/\b(?:in|into)\s+([a-z][a-z ]*)$/i)?.[1]?.trim().toLowerCase();
            for (const annotation of annotations) {
                const text = key(annotation.text ?? "");
                const namedMedium = (annotation.text ?? "").trim().toLowerCase();
                const bound = c.operator === "reflect_at" ? annotation.id === reflectedMedium || (!!medium && new RegExp(`^(?:n_)?${medium}(?:\\b|=)`, "i").test(namedMedium)) :
                    (typeof input === "string" && annotation.quantityId === input) || symbols.some(symbol => text.includes(symbol + "=") || text.includes(symbol + "≈")) ||
                        (!!medium && namedMedium === medium) || (input === 1 && namedMedium === "air");
                if (bound)
                    bindings.push({ annotationId: annotation.id, surfaceId, rayId: out, contact: contact.point, far, surface });
            }
        }
    }
    return bindings;
}
export function validateOpticalMediumTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
    const issues: SceneIssue[] = [];
    for (const binding of mediumBindings(document, geometry)) {
        const { surface, contact, far } = binding;
        const a = surface.points[0]!, b = surface.points.at(-1)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const horizontal = Math.abs(dy) < 1e-6 * Math.max(1, Math.abs(dx)), vertical = Math.abs(dx) < 1e-6 * Math.max(1, Math.abs(dy));
        if (!horizontal && !vertical)
            continue;
        const intent = document.annotations.find(a => a.id === binding.annotationId)?.placementIntent?.toLowerCase();
        const displacement = horizontal ? far.y - contact.y : far.x - contact.x;
        const sign = horizontal ? (intent === "above" ? 1 : intent === "below" ? -1 : 0) : (intent === "right" ? 1 : intent === "left" ? -1 : 0);
        if (sign && sign * displacement < -1e-6)
            issues.push({ code: "optical_medium_side_contradiction", severity: "fatal", failureKind: "truth", entityIds: [binding.rayId, binding.surfaceId], message: "The declared medium label and its ray occupy opposite sides of the interface." });
    }
    return issues;
}
/** Layout must preserve the same medium halfspace, including labels with an
 * ambiguous placement request such as 'glass side'. Fail closed if it doesn't. */
export function validateRenderedMediumTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>, primitives: RenderPrimitive[], transformFor: (id: string) => (p: Point) => Point): SceneIssue[] {
    const issues: SceneIssue[] = [];
    for (const binding of mediumBindings(document, geometry)) {
        const label = primitives.find(p => p.id === binding.annotationId && p.kind === "label");
        if (!label?.points[0])
            continue;
        const transform = transformFor(binding.surfaceId), a = transform(binding.contact), b = transform(binding.surface.points.find(p => Math.hypot(p.x - binding.contact.x, p.y - binding.contact.y) > 1e-6)!);
        const far = transform(binding.far);
        const side = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        if (side(far) * side(label.points[0]) < -1e-5)
            issues.push({ code: "optical_medium_label_misplaced", severity: "fatal", failureKind: "truth", entityIds: [binding.rayId, binding.surfaceId], message: "The rendered medium label lies across the interface from its bound ray." });
    }
    return issues;
}
