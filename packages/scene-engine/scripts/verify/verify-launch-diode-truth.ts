import { strict as assert } from 'node:assert';
import { compileSceneDocument } from '../../src/compile/compiler';
import type { SceneDocument } from '../../src/types';
for (const symbol of ['diode', 'zener'])
    for (const [dx, dy] of [[6, 2], [-4, 3], [0, -5], [2, 0]]) {
        const d: SceneDocument = { schemaVersion: 'scene-document/v2', source: { question: 'Show a two-terminal semiconductor component.' }, visualDecision: { mode: 'scene', reason: 'Component symbol.' }, quantities: [], entities: [{ id: 'a', kind: 'point', role: 'terminal' }, { id: 'b', kind: 'point', role: 'terminal' }, { id: 'component', kind: 'component', role: 'semiconductor' }], constructions: [{ id: 'a_c', operator: 'point', inputs: { x: 2, y: -1, coordinateSpace: 'world' }, outputs: ['a'] }, { id: 'b_c', operator: 'point', inputs: { x: 2 + dx!, y: -1 + dy!, coordinateSpace: 'world' }, outputs: ['b'] }, { id: 'symbol_c', operator: 'symbol', inputs: { symbol, start: 'a', end: 'b' }, outputs: ['component'] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ['component'], revealGroups: [{ id: 'setup', entityIds: ['component'], dependsOn: [], narrationCue: 'Component.' }], teachingTimeline: [] };
        const r = compileSceneDocument(d);
        assert(r.ok && r.renderScene, JSON.stringify(r.report.issues));
        const p = r.renderScene.primitives.filter(p => p.entityId === 'component' && p.kind !== 'label');
        const triangle = p[1]!.points, bar = p[2]!.points, tip = triangle[2]!;
        const a = bar[symbol === 'diode' ? 0 : 1]!, b = bar[symbol === 'diode' ? 1 : 2]!;
        const projection = ((tip.x - a.x) * (b.x - a.x) + (tip.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        const gap = Math.hypot(tip.x - a.x - projection * (b.x - a.x), tip.y - a.y - projection * (b.y - a.y));
        assert(gap < 0.03 && projection >= 0 && projection <= 1, `${symbol}: triangle tip must meet cathode bar, actual gap ${gap}`);
        const lead = p[0]!.points.at(-1)!, mid = { x: (triangle[0]!.x + triangle[1]!.x) / 2, y: (triangle[0]!.y + triangle[1]!.y) / 2 };
        assert(Math.hypot(lead.x - mid.x, lead.y - mid.y) < 0.03, 'Anode lead must meet triangle base midpoint');
    }
console.log('launch diode truth: diode/zener tip-bar contact and lead alignment under rotation/scale passed');
