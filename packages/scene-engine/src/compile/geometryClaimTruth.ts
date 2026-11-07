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
/** The a in a label "f(a)" or "f(a) = b" with a plain number a; otherwise null. */
function statedAbscissa(label: string | undefined): { value: number; decimals: number } | null {
    const match = /^\s*[A-Za-z][A-Za-z0-9_′']*\s*\(\s*([-−]?\d+(?:\.(\d+))?)\s*\)\s*(?:=.*)?$/.exec(label ?? "");
    return match ? { value: Number(match[1]!.replace("−", "-")), decimals: match[2]?.length ?? 0 } : null;
}

/**
 * Does the drawn abscissa agree with the printed one? An integer or one
 * decimal is read as exact, so f(0) on a dot at 0.5 is false. Two or more
 * decimals are a rounding: f(1.41) on a dot at √2 is true.
 */
function abscissaDisagrees(stated: { value: number; decimals: number }, drawn: number): boolean {
    if (stated.decimals < 2) return Math.abs(stated.value - drawn) > 1e-7 * Math.max(1, Math.abs(stated.value));
    return Math.abs(stated.value - drawn) > 0.5 * 10 ** -stated.decimals * (1 + 1e-9);
}

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
        if (c.operator === "curve_anchor" && value?.calculusAnchor) {
            const curve = geometry.get(value.calculusAnchor.curveId) as Value | undefined;
            if (curve?.sampledCurve?.curveKind === "function") {
                const labels = [entity?.label, ...document.annotations
                    .filter(a => (a.kind === "label" || a.kind === "callout") && a.targetIds.length === 1 && a.targetIds[0] === id)
                    .map(a => a.text)];
                for (const label of labels) {
                    const stated = statedAbscissa(label);
                    if (stated !== null && abscissaDisagrees(stated, value.calculusAnchor.parameter))
                        fail("A label f(a) on a function-curve point names a different abscissa from where the point is drawn.");
                }
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
