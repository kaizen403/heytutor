import type { SceneDocument, SceneIssue } from "../types";
type AngularGeometry = {
    kind: "arc";
    startAngle: number;
    endAngle: number;
} | {
    kind: "path";
    markedAngleRadians?: number;
};
const symbolKey = (value: string) => value.normalize("NFKC").replace(/[\s_{}]/g, "");
function radians(value: unknown): number | null {
    if (!value || typeof value !== "object")
        return null;
    const quantity = value as {
        value?: unknown;
        unit?: unknown;
    };
    if (typeof quantity.value !== "number" || !Number.isFinite(quantity.value))
        return null;
    if (typeof quantity.unit !== "string")
        return null;
    const unit = quantity.unit.toLowerCase();
    if (["°", "deg", "degree", "degrees"].includes(unit))
        return quantity.value * Math.PI / 180;
    if (["rad", "radian", "radians"].includes(unit))
        return quantity.value;
    return null;
}
/** A proved angle between infinite lines cannot certify a different marked
 * half-ray angle. Compare the actual mark with its explicit assertion or
 * quantity binding. No topic/role guessing and no supplementary-angle repair.
 */
export function validateMarkedAngleTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
    const issues: SceneIssue[] = [];
    for (const construction of document.constructions) {
        if (!["angle_mark", "space_angle_mark"].includes(construction.operator))
            continue;
        const output = construction.outputs[0];
        if (!output)
            continue;
        const value = geometry.get(output) as AngularGeometry | undefined;
        const sweep = value?.kind === "arc" ? value.endAngle - value.startAngle : value?.kind === "path" ? value.markedAngleRadians : undefined;
        if (sweep === undefined)
            continue;
        const a = construction.inputs.a ?? construction.inputs.first;
        const b = construction.inputs.b ?? construction.inputs.second;
        const claims: Array<{
            expected: number;
            path: string;
        }> = [];
        document.assertions.forEach((assertion, index) => {
            if (assertion.predicate !== "angle_between")
                return;
            if (!(assertion.entities.length === 1 && assertion.entities[0] === output) &&
                !(assertion.entities.length === 2 && assertion.entities.includes(String(a)) && assertion.entities.includes(String(b))))
                return;
            // Preserve the existing assertion convention: bare values above 2π are degrees.
            const expected = typeof assertion.expected === "number"
                ? (Math.abs(assertion.expected) > 2 * Math.PI ? assertion.expected * Math.PI / 180 : assertion.expected)
                : radians(assertion.expected);
            if (expected !== null)
                claims.push({ expected, path: `assertions[${index}]` });
        });
        const entity = document.entities.find(e => e.id === output);
        const binding = document.quantities.filter(q => (q.id === output || (typeof q.symbol === "string" && entity?.label && symbolKey(q.symbol) === symbolKey(entity.label))));
        for (const annotation of document.annotations.filter(a => a.targetIds.includes(output) && a.quantityId)) {
            const quantity = document.quantities.find(q => q.id === annotation.quantityId);
            if (quantity)
                binding.push(quantity);
        }
        for (const quantity of binding) {
            const expected = radians(quantity);
            if (expected !== null)
                claims.push({ expected, path: `entities[${document.entities.findIndex(e => e.id === output)}]` });
        }
        if (claims.some(({ expected }) => Math.abs(Math.abs(sweep) - Math.abs(expected)) > Math.PI / 1800 ||
            (expected < 0 && sweep > 0)))
            issues.push({
                code: "marked_angle_contradicts_measure", severity: "fatal", failureKind: "truth",
                entityIds: [output], path: claims[0]?.path,
                message: "The drawn angle uses a different half-ray, sweep or orientation from its declared measure.",
            });
    }
    return issues;
}
