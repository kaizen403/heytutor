import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
function train(focusHeight = 0): SceneDocument {
    const points: Record<string, number[]> = { A: [-4, 0], B: [8, 0], Co: [0, 0], Ce: [5, 0], F: [3, focusHeight] };
    return { schemaVersion: "scene-document/v2", source: { question: "Show a centred optical train with an axis-parallel incoming beam." }, visualDecision: { mode: "scene", reason: "Train." }, quantities: [],
        entities: [...Object.keys(points).map(id => ({ id, kind: "point" as const, role: "point", ...(id === "F" ? { label: "F" } : {}) })), ...['axis', 'objective', 'eyepiece'].map(id => ({ id, kind: "line" as const, role: id })), ...['in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'].map(id => ({ id, kind: "ray" as const, role: "ray" }))],
        constructions: [...Object.entries(points).map(([id, [x, y]]) => ({ id: id + "_c", operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] })), { id: "axis_c", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["axis"] }, ...['objective', 'eyepiece'].map((id, i) => ({ id: id + "_c", operator: "perpendicular_through", inputs: { through: i ? 'Ce' : 'Co', line: "axis" }, outputs: [id] })), { id: "train_c", operator: "optical_train", inputs: { axis: "axis", objective: "objective", eyepiece: "eyepiece", focus: "F", beamHalfHeight: 0.8, raySpan: 2 }, outputs: ['in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'] }],
        relations: [], assertions: [], annotations: [], requiredEntityIds: ['F', 'axis', 'objective', 'eyepiece', 'in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'], revealGroups: [{ id: "all", entityIds: ['F', 'axis', 'objective', 'eyepiece', 'in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'], dependsOn: [], narrationCue: "Train." }], teachingTimeline: [] };
}
const result = compileSceneDocument(train());
assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
for (const id of ['mid1', 'mid2']) {
    const points = result.renderScene.primitives.find(p => p.entityId === id && p.points.length > 2)!.points;
    const [a, b, c] = points;
    const cross = (b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x);
    assert(Math.abs(cross) < 5, "light cannot bend at an empty focus between lenses");
}
const bad = compileSceneDocument(train(-0.7));
assert(!bad.ok, "an axis-parallel beam cannot focus off-axis in a centred objective");
console.log("launch: empty focus does not bend light; axis-parallel focus is on axis");
