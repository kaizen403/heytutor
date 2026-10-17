import { strict as assert } from 'node:assert';
import { compileSceneDocument as compileWithPolicy } from '../../src/compile/compiler';
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
import type { SceneDocument } from '../../src/types';
function scene(base: number, horizontal = false, shift = 0): SceneDocument {
    const coords: Array<[
        string,
        number,
        number
    ]> = [['base', horizontal ? base + shift : shift, horizontal ? shift : base + shift], ['left', horizontal ? shift : -3 + shift, horizontal ? -3 + shift : shift], ['right', horizontal ? shift : 3 + shift, horizontal ? 3 + shift : shift]];
    return { schemaVersion: 'scene-document/v2', source: { question: 'A cylindrical surface crosses a plane with one end on each side.' }, visualDecision: { mode: 'scene', reason: 'Explicit geometry relationship.' }, quantities: [], entities: [...coords.map(([id]) => ({ id, kind: 'point', role: 'helper' })), { id: 'solid', kind: 'polyline', role: 'cylindrical surface' }, { id: 'plane', kind: 'segment', role: 'reference plane' }], constructions: [...coords.map(([id, x, y]) => ({ id: `p_${id}`, operator: 'point', inputs: { x, y, coordinateSpace: 'world' }, outputs: [id] })), { id: 'solid_c', operator: 'solid_projection', inputs: { kind: 'cylinder', center: 'base', radius: 1, height: 4, axis: horizontal ? 'horizontal' : 'vertical' }, outputs: ['solid'] }, { id: 'plane_c', operator: 'segment', inputs: { start: 'left', end: 'right' }, outputs: ['plane'] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ['solid', 'plane'], revealGroups: [{ id: 'setup', entityIds: ['solid', 'plane'], dependsOn: [], narrationCue: 'Geometry.' }], teachingTimeline: [] };
}
const withField = scene(0);
withField.entities.push({ id: 'field', kind: 'vector', role: 'electric field toward sheet' });
withField.constructions.push({ id: 'field_c', operator: 'vector', inputs: { start: 'base', direction: [0, 1], length: 1 }, outputs: ['field'] });
withField.requiredEntityIds.push('field');
withField.revealGroups[0]!.entityIds.push('field');
assert(compileSceneDocument(withField).report.issues.some(i => i.code === 'invalid_solid_source_relation'), 'Field role references do not masquerade as a second sheet');
for (const base of [0, 1, -4, -5]) {
    const r = compileSceneDocument(scene(base));
    assert(!r.ok && r.report.issues.some(i => i.code === 'invalid_solid_source_relation' && i.failureKind === 'truth'), `End faces must straddle the plane at base ${base}`);
}
for (const horizontal of [false, true])
    for (const shift of [-8, 0, 7]) {
        const r = compileSceneDocument(scene(-2, horizontal, shift));
        assert(r.ok, JSON.stringify(r.report.issues));
    }
const unclaimed = scene(0);
unclaimed.source = { question: 'Draw a cylinder beside a reference plane.' };
assert(compileSceneDocument(unclaimed).ok, 'A source that does not claim straddling keeps the established base anchor');
console.log('launch solid-source truth: cap/same-side rejection, translated/rotated straddling, unclaimed base anchor passed');
