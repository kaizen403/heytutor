import { strict as assert } from "node:assert";
import { compileSceneDocument as compileWithPolicy } from "../../src/compile/compiler";
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
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

function withLensApertures(objectiveHeight: number, eyepieceHeight: number) {
    const d = train();
    for (const [id, centre, halfHeight] of [['objectiveBody', 'Co', objectiveHeight], ['eyepieceBody', 'Ce', eyepieceHeight]] as const) {
        d.entities.push({ id, kind: 'polygon', role: 'converging lens' });
        d.constructions.push({ id: `${id}_c`, operator: 'lens_section', inputs: { center: centre, axis: 'axis', radius1: 5, radius2: -5, halfHeight }, outputs: [id] });
        d.requiredEntityIds.push(id); d.revealGroups[0]!.entityIds.push(id);
    }
    return d;
}
const inAperture = compileSceneDocument(withLensApertures(1, 1));
assert(inAperture.ok, JSON.stringify(inAperture.report.issues));
for (const dimensions of [[0.4, 1], [1, 0.2]] as const) {
    const rejected = compileSceneDocument(withLensApertures(...dimensions));
    assert(!rejected.ok && rejected.report.issues.some(i => i.code === 'invalid_optical_aperture_binding' && i.failureKind === 'truth'), 'ray bends outside a drawn lens aperture must fail');
    assert(compileWithPolicy(withLensApertures(...dimensions), {yieldPolicy:'off'}).ok, 'aperture hardening stays default off');
}
console.log('launch: optical-train contacts stay inside the uniquely bound drawn lens apertures');

const rotatedAperture = withLensApertures(0.4, 1);
for (const c of rotatedAperture.constructions.filter(c => c.operator === 'point')) {
    const x = c.inputs.x; c.inputs.x = -Number(c.inputs.y); c.inputs.y = x;
}
assert(compileSceneDocument(rotatedAperture).report.issues.some(i => i.code === 'invalid_optical_aperture_binding'), 'aperture checks follow the optical axis under rotation');
