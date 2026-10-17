import { strict as assert } from "node:assert";
import { compileSceneDocument as compileWithPolicy } from "../../src/compile/compiler";
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
import type { SceneDocument } from "../../src/types";
function scene(degrees: number, wrong: boolean, quantityOnly = false): SceneDocument {
    const theta = degrees * Math.PI / 180;
    return { schemaVersion: "scene-document/v2", source: { question: "Show the declared angle." }, visualDecision: { mode: "scene", reason: "Angle." },
        quantities: [{ id: "theta", symbol: "θ", value: degrees, unit: "degrees" }],
        entities: [{ id: "o", kind: "point", role: "vertex" }, { id: "a", kind: "vector", role: "reference" }, { id: "b", kind: "vector", role: "direction" }, { id: "angle", kind: "angle_mark", role: "angle", label: quantityOnly ? "θ" : "angle" }],
        constructions: [{ id: "o_c", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] }, { id: "a_c", operator: "vector", inputs: { start: "o", direction: [wrong ? -1 : 1, 0], length: 3 }, outputs: ["a"] }, { id: "b_c", operator: "vector", inputs: { start: "o", direction: [Math.cos(theta), Math.sin(theta)], length: 3 }, outputs: ["b"] }, { id: "angle_c", operator: "angle_mark", inputs: { vertex: "o", a: "a", b: "b" }, outputs: ["angle"] }],
        relations: [], assertions: quantityOnly ? [] : [{ id: "measure", predicate: "angle_between", entities: ["a", "b"], expected: { value: degrees, unit: "degrees" }, severity: "fatal" }], annotations: [], requiredEntityIds: ["a", "b", "angle"], revealGroups: [{ id: "setup", entityIds: ["a", "b", "angle"], dependsOn: [], narrationCue: "Angle." }], teachingTimeline: [] };
}
for (const angle of [25, 45, 65])
    for (const quantityOnly of [false, true]) {
        assert(compileSceneDocument(scene(angle, false, quantityOnly)).ok, "correct directed wedge remains drawable");
        const bad = compileSceneDocument(scene(angle, true, quantityOnly));
        assert(!bad.ok && bad.report.issues.some(i => i.code === "marked_angle_contradicts_measure"), "an acute line proof cannot certify an obtuse angle mark");
    }
console.log("launch: angle marks must agree with asserted and quantity-bound measures");
