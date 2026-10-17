import { strict as assert } from "node:assert";
import { compileSceneDocument as compileWithPolicy } from "../../src/compile/compiler";
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
import type { SceneDocument } from "../../src/types";
for (const side of ["above", "below"] as const) {
    const d: SceneDocument = { schemaVersion: "scene-document/v2", source: { question: "Show a ray passing from medium A to B." }, visualDecision: { mode: "scene", reason: "Refraction." }, quantities: [{ id: "nA", symbol: "n_A", value: 1.5 }],
        entities: [{ id: "o", kind: "point", role: "contact" }, { id: "s", kind: "line", role: "interface" }, { id: "i", kind: "ray", role: "incoming" }, { id: "n", kind: "vector", role: "normal" }, { id: "r", kind: "ray", role: "outgoing" }],
        constructions: [{ id: "o_c", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] }, { id: "s_c", operator: "line", inputs: { start: "o", direction: [1, 0] }, outputs: ["s"] }, { id: "r_c", operator: "refract_at", inputs: { point: "o", surface: "s", n1: "nA", n2: 1, incidentAngleDeg: 20 }, outputs: ["i", "n", "r"] }], relations: [], assertions: [], annotations: [{ id: "medium", kind: "label", targetIds: ["s"], text: "medium A n_A=1.5", placementIntent: side }], requiredEntityIds: ["s", "i", "n", "r"], revealGroups: [{ id: "all", entityIds: ["s", "i", "n", "r"], dependsOn: [], narrationCue: "Refraction." }], teachingTimeline: [] };
    const result = compileSceneDocument(d);
    if (side === "above")
        assert(result.ok, JSON.stringify(result.report.issues));
    else
        assert(!result.ok && result.report.issues.some(i => i.code === "optical_medium_side_contradiction"), "medium A cannot label the opposite halfspace from its ray");
}
console.log("launch: medium declarations agree with ray halfspaces");
