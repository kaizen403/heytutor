import assert from 'node:assert/strict';
import { compileSceneDocument, type SceneDocument } from '../../src/index';

// Equal-length decoration is engine ink, not part of the declared conductor.
// The nearby wire has room to avoid the mark without changing its endpoints.
function fixture(): SceneDocument {
  const positions: Record<string, [number, number]> = {
    a: [0, 0], b: [10, 0], c: [0, -2], d: [10, -2],
    wireStart: [2, 0.2], wireEnd: [8, 0.2], loadEnd: [10, 0.2],
  };
  const ids = [...Object.keys(positions), 'reference', 'equalReference', 'wire', 'load'];
  return {
    schemaVersion: 'scene-document/v2',
    visualDecision: { mode: 'scene', reason: 'Synthetic correspondence mark beside a circuit wire' },
    source: {}, quantities: [],
    entities: [
      ...Object.keys(positions).map(id => ({ id, kind: 'point' as const, role: 'terminal' })),
      { id: 'reference', kind: 'segment', role: 'reference length' },
      { id: 'equalReference', kind: 'segment', role: 'equal reference length' },
      { id: 'wire', kind: 'connector', role: 'wire' },
      { id: 'load', kind: 'component', role: 'resistor' },
    ],
    constructions: [
      ...Object.entries(positions).map(([id, [x, y]]) => ({ id: `place_${id}`, operator: 'point', inputs: { x, y, coordinateSpace: 'layout' }, outputs: [id] })),
      { id: 'reference_segment', operator: 'segment', inputs: { start: 'a', end: 'b' }, outputs: ['reference'] },
      { id: 'equal_segment', operator: 'segment', inputs: { start: 'c', end: 'd' }, outputs: ['equalReference'] },
      { id: 'make_wire', operator: 'connect', inputs: { start: 'wireStart', end: 'wireEnd' }, outputs: ['wire'] },
      { id: 'make_load', operator: 'symbol', inputs: { symbol: 'resistor', start: 'wireEnd', end: 'loadEnd' }, outputs: ['load'] },
    ],
    relations: [],
    assertions: [{ id: 'equal_lengths', predicate: 'equal_length', entities: ['reference', 'equalReference'], severity: 'fatal', expected: true }],
    annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: 'all', entityIds: ids, dependsOn: [], narrationCue: 'Synthetic mark and wire' }],
    teachingTimeline: [],
  };
}

type Point = { x: number; y: number };
function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const at = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - at * dx, p.y - a.y - at * dy);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

let checks = 0;
for (const scale of [0.5, 1, 2]) for (const mirror of [false, true]) for (const rotate of [false, true]) {
  const candidate = fixture();
  for (const construction of candidate.constructions) {
    if (construction.operator !== 'point') continue;
    const x = Number(construction.inputs.x) * scale * (mirror ? -1 : 1);
    const y = Number(construction.inputs.y) * scale;
    construction.inputs.x = (rotate ? -y : x) + 3;
    construction.inputs.y = (rotate ? x : y) - 7;
  }
  const withoutMarks = structuredClone(candidate);
  withoutMarks.assertions = [];
  assert.ok(compileSceneDocument(withoutMarks).ok, 'The underlying circuit has a valid direct route');
  const original = JSON.stringify(candidate);
  const result = compileSceneDocument(candidate);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.equal(JSON.stringify(candidate), original, 'Mark avoidance must not mutate the logical netlist');
  const wire = result.renderScene.primitives.find(p => p.entityId === 'wire' && p.kind !== 'label')!;
  const ticks = result.renderScene.primitives.filter(p => p.provenance?.correspondingFamily !== undefined);
  assert.equal(ticks.length, 2, 'Both equal-length marks remain visible');
  assert.ok(wire.points.length > 2, 'The wire must reroute around the tick');
  for (const [index, terminal] of ['wireStart', 'wireEnd'].entries()) {
    const anchor = result.renderScene.primitives.find(p => p.entityId === terminal && p.kind === 'point')!.points[0];
    assert.deepEqual(index === 0 ? wire.points[0] : wire.points.at(-1), anchor, 'The wire keeps its exact declared terminal');
  }
  const clearance = Math.min(...ticks.flatMap(tick => wire.points.slice(1).map((end, index) => segmentDistance(wire.points[index]!, end, tick.points[0]!, tick.points[1]!))));
  assert.ok(clearance >= 5.98, `Wire clears all correspondence ink by 6px (got ${clearance})`);
  checks += 8;
}
console.log(`Corresponding tick routing: ${checks} checks passed`);
