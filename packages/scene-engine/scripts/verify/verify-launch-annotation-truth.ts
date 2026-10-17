import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
for (const text of ["+-", "-+", "+ toward upper terminal"]) {
    const document: SceneDocument = { schemaVersion: "scene-document/v2", source: { question: "Show terminal polarity." }, visualDecision: { mode: "scene", reason: "Polarity." }, quantities: [], entities: [{ id: "a", kind: "point", role: "terminal" }, { id: "b", kind: "point", role: "terminal" }, { id: "component", kind: "segment", role: "component" }], constructions: [{ id: "a_c", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["a"] }, { id: "b_c", operator: "point", inputs: { x: 0, y: 4, coordinateSpace: "world" }, outputs: ["b"] }, { id: "wire", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["component"] }], relations: [], assertions: [], annotations: [{ id: "polarity", kind: "polarity", targetIds: ["component"], text }], requiredEntityIds: ["component"], revealGroups: [{ id: "setup", entityIds: ["component"], dependsOn: [], narrationCue: "Polarity." }], teachingTimeline: [] };
    const result = compileSceneDocument(document);
    if (text.length === 2)
        assert(result.ok, JSON.stringify(result.report.issues));
    else
        assert(!result.ok && result.report.issues.some(i => i.code === "polarity_binding_ambiguous"), "polarity prose cannot be truncated into a false terminal sign");
}
console.log("launch: polarity requires explicit ordered terminal marks");
