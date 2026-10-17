import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
const base: SceneDocument = { schemaVersion: "scene-document/v2", source: { question: "Show the named mathematical points." }, visualDecision: { mode: "scene", reason: "Relations." }, quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
for (const at of [-1, 0]) {
    const d: SceneDocument = { ...base, quantities: [{ id: "a", symbol: "a", value: -1 }], entities: [{ id: "curve", kind: "curve", role: "function" }, { id: "point", kind: "point", role: "parameter", label: "a" }], constructions: [{ id: "curve_c", operator: "function_curve", inputs: { expression: "x^2", xMin: -2, xMax: 2, variable: "x" }, outputs: ["curve"] }, { id: "point_c", operator: "curve_anchor", inputs: { curve: "curve", at }, outputs: ["point"] }], requiredEntityIds: ["curve", "point"], revealGroups: [{ id: "setup", entityIds: ["curve", "point"], dependsOn: [], narrationCue: "Parameter." }] };
    const result = compileSceneDocument(d);
    assert.equal(result.ok, at === -1, "function parameter symbol must bind to its declared value");
}
for (const [real, imaginary] of [[2, -7], [-3, 4], [5, 2]])
    for (const conjugate of [true, false]) {
        const d: SceneDocument = { ...base, entities: [{ id: "p", kind: "point", role: "z", label: "P" }, { id: "q", kind: "point", role: "conjugate of z", label: "Q" }], constructions: [{ id: "p_c", operator: "complex_point", inputs: { real, imaginary, displayScale: 1 }, outputs: ["p"] }, { id: "q_c", operator: "complex_transform", inputs: { source: "p", displayScale: 1, multiplier: { real: 1, imaginary: 0 }, addend: { real: 0, imaginary: conjugate ? -2 * imaginary! : 0 } }, outputs: ["q"] }], requiredEntityIds: ["p", "q"], revealGroups: [{ id: "setup", entityIds: ["p", "q"], dependsOn: [], narrationCue: "Conjugate." }] };
        const result = compileSceneDocument(d);
        assert.equal(result.ok, conjugate, "identity is not conjugation for a nonreal point: " + JSON.stringify(result.report.issues));
    }
console.log("launch: named parameters and conjugate roles retain mathematical truth");
