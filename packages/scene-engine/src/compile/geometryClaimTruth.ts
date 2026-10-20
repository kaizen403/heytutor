import type { SceneDocument, SceneIssue } from "../types";
const key = (s: string) => s.normalize("NFKC").replace(/[\s_{}]/g, "");
interface Value {
    kind: string;
    calculusAnchor?: {
        curveId: string;
        parameter: number;
    };
    complexNumber?: {
        real: number;
        imaginary: number;
    };
    sampledCurve?: {
        curveKind: string;
    };
}
/** A symbol is a claim even without a printed numeral. Bind curve parameter
 * names and declared complex operations to evaluated mathematical metadata. */
export function validateGeometryClaimTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
    const issues: SceneIssue[] = [];
    for (const c of document.constructions) {
        const id = c.outputs[0];
        if (!id)
            continue;
        const entity = document.entities.find(e => e.id === id), value = geometry.get(id) as Value | undefined;
        const fail = (message: string) => issues.push({ code: "geometry_claim_contradiction", severity: "fatal", failureKind: "truth", entityIds: [id], message });
        if (c.operator === "curve_anchor" && value?.calculusAnchor && entity?.label) {
            const matches = document.quantities.filter(q => q.id === entity.label || (typeof q.symbol === "string" && key(q.symbol) === key(entity.label!)));
            const curve = geometry.get(value.calculusAnchor.curveId) as Value | undefined;
            // Only a function's named abscissa is unambiguously its parameter. A
            // parametric point label might instead name a coordinate or physical value.
            if (matches.length === 1 && curve?.sampledCurve?.curveKind === "function") {
                const q = matches[0]!;
                if (typeof q.value === "number" && Number.isFinite(q.value) && Math.abs(q.value - value.calculusAnchor.parameter) > 1e-7 * Math.max(1, Math.abs(q.value)))
                    fail("A named function-curve parameter is placed at a different abscissa from its declared quantity.");
            }
        }
        if (c.operator === "complex_transform" && /^conjugate(?:\s+of\b|$)/i.test(entity?.role ?? "")) {
            const source = geometry.get(String(c.inputs.source)) as Value | undefined;
            const a = source?.complexNumber, b = value?.complexNumber;
            if (!a || !b || Math.abs(a.real - b.real) > 1e-9 || Math.abs(a.imaginary + b.imaginary) > 1e-9)
                fail("A declared complex conjugate must preserve the real component and negate the imaginary component.");
        }
    }
    return issues;
}
