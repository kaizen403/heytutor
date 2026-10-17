import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
function train(): SceneDocument {
    const points: Array<[
        string,
        number,
        number
    ]> = [["oc", 0, 0], ["ec", 6, 0], ["obj", -2, 1], ["ob", -2, 0], ["ib", 3, 0], ["it", 3, -1.5], ["final", -5, 0]];
    return { schemaVersion: "scene-document/v2", source: { question: "Show a finite object and its intermediate image." }, visualDecision: { mode: "scene", reason: "Optical train." }, quantities: [],
        entities: [...points.map(([id]) => ({ id, kind: "point", role: "helper" })), { id: "axis", kind: "line", role: "optical axis" }, { id: "objective", kind: "line", role: "objective" }, { id: "eyepiece", kind: "line", role: "eyepiece" }, { id: "object", kind: "vector", role: "object" }, { id: "image", kind: "vector", role: "intermediate image" }, ...['in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'].map(id => ({ id, kind: "ray", role: "ray" }))],
        constructions: [...points.map(([id, x, y]) => ({ id: `p_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] })),
            { id: "a", operator: "line", inputs: { start: "oc", end: "ec" }, outputs: ["axis"] },
            { id: "o", operator: "perpendicular_through", inputs: { through: "oc", line: "axis" }, outputs: ["objective"] },
            { id: "e", operator: "perpendicular_through", inputs: { through: "ec", line: "axis" }, outputs: ["eyepiece"] },
            { id: "obj_arrow", operator: "vector", inputs: { start: "ob", end: "obj" }, outputs: ["object"] },
            { id: "im_arrow", operator: "vector", inputs: { start: "ib", end: "it" }, outputs: ["image"] },
            { id: "train", operator: "optical_train", inputs: { axis: "axis", objective: "objective", eyepiece: "eyepiece", object: "obj", focus: "ib", beamHalfHeight: 1 }, outputs: ['in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'] }],
        relations: [], assertions: [], annotations: [], requiredEntityIds: ["final", "axis", "objective", "eyepiece", "object", "image", 'in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'], revealGroups: [{ id: "setup", entityIds: ["final", "axis", "objective", "eyepiece", "object", "image", 'in1', 'in2', 'mid1', 'mid2', 'out1', 'out2'], dependsOn: [], narrationCue: "Train." }], teachingTimeline: [] };
}
function reject(d: SceneDocument, message: string, detail?: string) { const r = compileSceneDocument(d); assert(!r.ok && r.report.issues.some(i => i.code === 'invalid_optical_path_binding' && i.failureKind === 'truth' && (!detail || i.message.includes(detail))), `${message}: ${JSON.stringify(r.report.issues)}`); }
function admit(d: SceneDocument, message: string) { const r = compileSceneDocument(d); assert(r.ok, `${message}: ${JSON.stringify(r.report.issues)}`); }
const wrongObject = train();
wrongObject.constructions.push({ id: "unbound", operator: "point", inputs: { x: -4, y: 1, coordinateSpace: "world" }, outputs: ["otherObject"] });
wrongObject.entities.push({ id: "otherObject", kind: "point", role: "helper" });
wrongObject.constructions.find(c => c.id === 'train')!.inputs.object = 'otherObject';
reject(wrongObject, 'Rays must originate at the declared object', 'different object point');
const tilted = train();
tilted.constructions.find(c => c.id === 'p_ib')!.inputs.x = 4;
reject(tilted, 'An image arrow cannot slant along its axis');
const infinity = train();
infinity.source = { question: 'The final image is at infinity.' };
infinity.constructions.find(c => c.id === 'train')!.inputs.finalImage = 'final';
reject(infinity, 'An infinite final image cannot be replaced by a finite point');
for (const shift of [-7, 0, 11]) {
    const d = train();
    for (const c of d.constructions)
        if (c.operator === 'point' && typeof c.inputs.x === 'number')
            c.inputs.x += shift;
    admit(d, `Consistent object/image geometry at translation ${shift}`);
}
const finite = train();
finite.source = { question: 'The object is not at infinity. The final image is finite.' };
finite.constructions.find(c => c.id === 'train')!.inputs.finalImage = 'final';
admit(finite, 'Source mentioning object infinity does not require final infinity');
console.log('launch optical-path truth: object/image frame, transverse arrows, and final-image infinity passed');
function boundaryDocument(reverse = false): SceneDocument {
    const d: SceneDocument = { schemaVersion: 'scene-document/v2', source: { question: 'A ray enters a glass block of index 1.5.' }, visualDecision: { mode: 'scene', reason: 'Bound medium.' }, quantities: [{ id: 'n', symbol: 'n', value: 1.5 }], entities: [], constructions: [], relations: [], assertions: [], annotations: [{ id: 'medium', kind: 'label', targetIds: ['body'], text: 'n = 1.5', quantityId: 'n' }], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
    for (const [id, x, y] of [['a', 0, -2], ['b', 4, -2], ['c', 4, 2], ['d', 0, 2], ['contact', 0, 0]] as const) {
        d.entities.push({ id, kind: 'point', role: 'helper' });
        d.constructions.push({ id: `p_${id}`, operator: 'point', inputs: { x, y, coordinateSpace: 'world' }, outputs: [id] });
    }
    d.entities.push({ id: 'body', kind: 'polygon', role: 'refracting body' }, { id: 'face', kind: 'segment', role: 'boundary' }, ...['incoming', 'normal', 'outgoing'].map(id => ({ id, kind: 'ray', role: 'ray' })));
    d.constructions.push({ id: 'body_c', operator: 'polygon', inputs: { points: ['a', 'b', 'c', 'd'] }, outputs: ['body'] }, { id: 'face_c', operator: 'segment', inputs: { start: reverse ? 'd' : 'a', end: reverse ? 'a' : 'd' }, outputs: ['face'] }, { id: 'event', operator: 'refract_at', inputs: { point: 'contact', surface: 'face', incidentAngleDeg: 30, n1: 1, n2: 'n', span: 1 }, outputs: ['incoming', 'normal', 'outgoing'] });
    d.requiredEntityIds = ['body', 'face', 'incoming', 'normal', 'outgoing'];
    d.revealGroups = [{ id: 'setup', entityIds: [...d.requiredEntityIds], dependsOn: [], narrationCue: 'Boundary.' }];
    return d;
}
const badBoundary = compileSceneDocument(boundaryDocument(true));
assert(!badBoundary.ok && badBoundary.report.issues.some(i => i.code === 'invalid_optical_medium_binding'), 'A ray entering index n must arrive from outside the n-labelled body');
admit(boundaryDocument(), 'Correctly oriented incident and transmitted media remain valid');
const exiting = boundaryDocument(true);
exiting.constructions.find(c => c.id === 'event')!.inputs.n1 = 'n';
exiting.constructions.find(c => c.id === 'event')!.inputs.n2 = 1;
admit(exiting, 'Reversed interface orientation allows a physically correct exit');
function objectPointDocument(mismatch: boolean): SceneDocument {
    const d: SceneDocument = { schemaVersion: 'scene-document/v2', source: { question: 'A point object sends a ray to the surface.' }, visualDecision: { mode: 'scene', reason: 'Point source.' }, quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
    for (const [id, x, y] of [['O', -3, 0], ['S', -3, mismatch ? 2 : 0], ['T', -1, 1], ['V', 0, 0]] as const) {
        d.entities.push({ id, kind: 'point', role: id === 'O' ? 'object' : 'helper' });
        d.constructions.push({ id: `p_${id}`, operator: 'point', inputs: { x, y, coordinateSpace: 'world' }, outputs: [id] });
    }
    d.entities.push({ id: 'surface', kind: 'line', role: 'surface' }, { id: 'P', kind: 'point', role: 'contact' }, { id: 'incident', kind: 'ray', role: 'incident ray' });
    d.constructions.push({ id: 'surface_c', operator: 'line', inputs: { start: 'V', direction: [0, 1] }, outputs: ['surface'] }, { id: 'contact_c', operator: 'surface_contact', inputs: { origin: 'S', through: 'T', surface: 'surface' }, outputs: ['P', 'incident'] });
    d.requiredEntityIds = ['O', 'surface', 'P', 'incident'];
    d.revealGroups = [{ id: 'setup', entityIds: [...d.requiredEntityIds], dependsOn: [], narrationCue: 'Point source.' }];
    return d;
}
const badOrigin = compileSceneDocument(objectPointDocument(true));
assert(!badOrigin.ok && badOrigin.report.issues.some(i => i.code === 'invalid_optical_object_origin'), 'An unrelated ray cannot illustrate a declared point object');
admit(objectPointDocument(false), 'Ray from the declared object remains valid');
console.log('launch optical-path truth: closed-body medium binding and point-object ray origin passed');
function rawIncomingDocument(oblique = true, optical = true): SceneDocument {
    const d = boundaryDocument();
    d.constructions = d.constructions.filter(c => c.id !== 'event');
    d.entities = d.entities.filter(e => !['normal', 'outgoing'].includes(e.id));
    d.entities.find(e => e.id === 'incoming')!.role = optical ? 'ray entering' : 'mathematical ray';
    d.entities.find(e => e.id === 'face')!.role = 'refracting face';
    d.entities.push({ id: 'source', kind: 'point', role: 'helper' });
    d.constructions.push({ id: 'source_c', operator: 'point', inputs: { x: -2, y: oblique ? 0.5 : 0, coordinateSpace: 'world' }, outputs: ['source'] }, { id: 'incoming_c', operator: 'ray', inputs: { start: 'source', end: 'contact' }, outputs: ['incoming'] });
    d.requiredEntityIds = ['body', 'face', 'incoming'];
    d.revealGroups[0]!.entityIds = [...d.requiredEntityIds];
    return d;
}
for (const [oblique, optical, shouldClip] of [[true, true, true], [false, true, false], [true, false, false]]) {
    const result = compileSceneDocument(rawIncomingDocument(oblique, optical));
    assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
    const body = result.renderScene.primitives.find(p => p.entityId === 'body' && p.kind !== 'label' && p.points.length >= 3)!;
    const ray = result.renderScene.primitives.find(p => p.entityId === 'incoming' && p.kind === 'ray')!;
    const left = Math.min(...body.points.map(p => p.x));
    assert(shouldClip ? Math.abs(ray.points.at(-1)!.x - left) < 0.04 : ray.points.at(-1)!.x > left + 0.04, 'Only an unsupported oblique optical extension must stop at the first declared face');
}
console.log('launch optical-path truth: declared optical entry clips at boundary, normal and mathematical rays preserved');
