import { strict as assert } from 'node:assert';
import { compileSceneDocument } from '../../src/compile/compiler';
import type { SceneDocument } from '../../src/types';
function scene(wrong = false, rotation = 0, optical = true, otherBody = false): SceneDocument {
    const points: Array<[
        string,
        number,
        number
    ]> = [['apex', 0, 2], ['left', -1, 0], ['right', 1, 0]];
    if (otherBody)
        points.push(['d', 5, 0], ['e', 7, 0], ['f', 6, 2]);
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const d: SceneDocument = { schemaVersion: 'scene-document/v2', source: { question: 'A closed transparent body has a declared refracting angle and faces.' }, visualDecision: { mode: 'scene', reason: 'Angle and face binding.' }, quantities: [], entities: [...points.map(([id]) => ({ id, kind: 'point', role: 'helper' })), { id: 'body', kind: 'polygon', role: 'closed body' }, { id: 'face', kind: 'segment', role: 'refracting face' }, { id: 'angle', kind: 'angle_mark', role: optical ? 'refracting angle' : 'triangle angle' }], constructions: [...points.map(([id, x, y]) => ({ id: `p_${id}`, operator: 'point', inputs: { x: 4 + x * cos - y * sin, y: -3 + x * sin + y * cos, coordinateSpace: 'world' }, outputs: [id] })), { id: 'body_c', operator: 'polygon', inputs: { points: ['apex', 'left', 'right'] }, outputs: ['body'] }, { id: 'face_c', operator: 'segment', inputs: { start: wrong ? 'left' : 'apex', end: 'right' }, outputs: ['face'] }, { id: 'angle_c', operator: 'angle_mark', inputs: { vertex: 'apex', a: 'left', b: 'right' }, outputs: ['angle'] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ['body', 'face', 'angle'], revealGroups: [{ id: 'setup', entityIds: ['body', 'face', 'angle'], dependsOn: [], narrationCue: 'Body.' }], teachingTimeline: [] };
    if (otherBody) {
        d.entities.push({ id: 'other', kind: 'polygon', role: 'closed body' }, { id: 'otherFace', kind: 'segment', role: 'refracting face' });
        d.constructions.push({ id: 'other_c', operator: 'polygon', inputs: { points: ['d', 'e', 'f'] }, outputs: ['other'] }, { id: 'other_face_c', operator: 'segment', inputs: { start: 'd', end: 'e' }, outputs: ['otherFace'] });
        d.requiredEntityIds.push('other', 'otherFace');
        d.revealGroups[0]!.entityIds.push('other', 'otherFace');
    }
    return d;
}
for (const rotation of [0, .4, 1.7]) {
    const bad = compileSceneDocument(scene(true, rotation));
    assert(!bad.ok && bad.report.issues.some(i => i.code === 'invalid_refracting_angle_binding' && i.failureKind === 'truth'), 'Refracting angle vertex must belong to its explicitly declared refracting face');
    for (const d of [scene(false, rotation), scene(true, rotation, false), scene(false, rotation, true, true)]) {
        const good = compileSceneDocument(d);
        assert(good.ok, JSON.stringify(good.report.issues));
    }
}
console.log('refracting-angle truth: wrong face rejected, rotated positives, nonoptical angle and unrelated body preserved');
