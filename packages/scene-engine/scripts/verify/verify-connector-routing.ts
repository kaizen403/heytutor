import assert from 'node:assert/strict';
import { compileSceneDocument, type SceneDocument } from '../../src/index';
import { routeConnector } from '../../src/compile/connectorRouting';

// Synthetic topology; no production question, identifiers, or saved geometry.
const positions: Record<string, [number, number]> = {
  sourceTop: [0, 0], sourceBottom: [0, -4], keyIn: [2, 0], keyOut: [3, 0],
  meterIn: [5, 0], meterOut: [6, 0], r1In: [8, 0], r1Out: [9, 0],
  r2In: [11, 0], r2Out: [12, 0], r3In: [14, 0], r3Out: [15, 0],
  voltIn: [14, -2], voltOut: [15, -2],
};
const components = [
  ['source', 'battery', 'sourceBottom', 'sourceTop'],
  ['key', 'switch', 'keyIn', 'keyOut'], ['amp', 'ammeter', 'meterIn', 'meterOut'],
  ['r1', 'resistor', 'r1In', 'r1Out'], ['r2', 'resistor', 'r2In', 'r2Out'],
  ['r3', 'resistor', 'r3In', 'r3Out'], ['volt', 'voltmeter', 'voltIn', 'voltOut'],
];
const wires = [
  ['feed', 'sourceTop', 'keyIn'], ['keyLead', 'keyOut', 'meterIn'],
  ['ampLead', 'meterOut', 'r1In'], ['between1', 'r1Out', 'r2In'],
  ['between2', 'r2Out', 'r3In'], ['voltLeft', 'r3In', 'voltIn'],
  ['voltRight', 'r3Out', 'voltOut'], ['return', 'sourceBottom', 'r3Out'],
];
function scene(positions: Record<string, [number,number]>, components: string[][], wires:string[][]):SceneDocument {
const ids = [...Object.keys(positions), ...components.map(c => c[0]), ...wires.map(w => w[0])];
return {
  schemaVersion: 'scene-document/v2', visualDecision: {mode: 'scene', reason: 'Synthetic series circuit with branch measurement'}, source: {}, quantities: [],
  entities: [...Object.keys(positions).map(id => ({id, kind: 'point' as const, role: 'terminal'})),
    ...components.map(([id, symbol]) => ({id: id!, kind: 'component' as const, role: symbol!})),
    ...wires.map(([id]) => ({id: id!, kind: 'connector' as const, role: 'wire'}))],
  constructions: [...Object.entries(positions).map(([id, [x,y]]) => ({id: `place_${id}`, operator: 'point', inputs: {x,y,coordinateSpace:'layout'}, outputs:[id]})),
    ...components.map(([id,symbol,start,end]) => ({id:`make_${id}`, operator:'symbol',inputs:{symbol,start,end,...(symbol==='switch'?{state:'closed'}:{})},outputs:[id!]})),
    ...wires.map(([id,start,end]) => ({id:`make_${id}`,operator:'connect',inputs:{start,end},outputs:[id!]}))],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ids as string[],
  revealGroups: [{id:'all', entityIds:ids as string[],dependsOn:[],narrationCue:'Circuit'}], teachingTimeline: [],
};
}
type P = {x:number;y:number};
const orient = (a:P,b:P,c:P) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const proper = (a:P,b:P,c:P,d:P) => orient(a,b,c)*orient(a,b,d)<-1e-7 && orient(c,d,a)*orient(c,d,b)<-1e-7;
let checks = 0;
const scenarios = [{positions,components,wires}];
for (const nested of [false,true]) {
  const nodes:Record<string,[number,number]> = {a:[0,0],b:[0,-6],c:[3,0],d:[5,0],j:[7,0],k:[14,0],u:[9,3],v:[12,3],l:[9,-3],m:[12,-3]};
  const parts = [['s','battery','b','a'],['series','resistor','c','d'],['upper','resistor','u','v'],['lower','resistor','l','m']];
  const edges = [['w1','a','c'],['w2','d','j'],['w3','j','u'],['w4','v','k'],['w5','j','l'],['w6','m','k'],['return','k','b']];
  if(nested) {
    nodes.ll=[9,-5];nodes.mm=[12,-5];parts.push(['nested','resistor','ll','mm']);edges.push(['w7','l','ll'],['w8','mm','m']);
  }
  scenarios.push({positions:nodes,components:parts,wires:edges});
}
for (const scenario of scenarios) for (const state of ['open','closed']) for (const reverse of [false,true]) for (const mirror of [false,true]) for (const rotate of [false,true]) {
  const candidate = scene(scenario.positions,scenario.components,scenario.wires);
  const wires = scenario.wires;
  for(const c of candidate.constructions) if(c.inputs.symbol === 'switch') c.inputs.state=state;
  for (const construction of candidate.constructions) if (construction.operator === 'point') {
    const x = Number(construction.inputs.x) * (mirror ? -1 : 1);
    const y = Number(construction.inputs.y);
    construction.inputs.x = (rotate ? -y : x) + 3;
    construction.inputs.y = (rotate ? x : y) - 7;
  }
  if (reverse) candidate.constructions.reverse();
  const original = JSON.stringify(candidate);
  const result = compileSceneDocument(candidate);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.equal(JSON.stringify(candidate),original,'Routing must not mutate the logical netlist');
  const paths = (id:string) => result.renderScene!.primitives.filter(p=>p.entityId===id&&p.kind!=='label').map(p=>p.points);
  for (let w=0;w<wires.length;w++) for(let z=w+1;z<wires.length;z++) {
    for(const a of paths(wires[w]![0]!)) for(const b of paths(wires[z]![0]!))
      for(let i=1;i<a.length;i++) for(let j=1;j<b.length;j++) {
        assert.equal(proper(a[i-1]!,a[i]!,b[j-1]!,b[j]!),false,'Unrelated wire interiors must not cross');
        checks++;
      }
  }
  for (const [id,start,end] of wires) {
    const path = paths(id!)[0]!;
    const terminal = (name:string) => result.renderScene!.primitives.find(p=>p.entityId===name&&p.kind==='point')!.points[0]!;
    assert.deepEqual(path[0],terminal(start!),'Start terminal remains exact');
    assert.deepEqual(path.at(-1),terminal(end!),'End terminal remains exact');
    checks+=2;
  }
}
// Independent segment-interior oracle: no obstacle vertex lies on the direct line.
const start = {x:0,y:0}, end = {x:8,y:0};
const wall = [{x:4,y:-2},{x:4,y:2}];
const around = routeConnector(start,end,[{points:wall,contacts:[]}]);
assert.ok(around.length>2);
for(let i=1;i<around.length;i++) assert.equal(proper(around[i-1]!,around[i]!,wall[0]!,wall[1]!),false);
assert.deepEqual(routeConnector(start,end,[{points:[{x:-2,y:0},start],contacts:[start]}]),[start,end],'Shared terminal is legal');
assert.ok(routeConnector(start,end,[{points:[{x:2,y:0},{x:6,y:0}],contacts:[]}]).length>2,'Overlapping unrelated lead must be avoided');
assert.throws(()=>routeConnector({x:0,y:0},{x:4,y:0},[{points:[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1},{x:-1,y:-1}],contacts:[]}]),/No connector route/,'An enclosed endpoint cannot silently cross an obstacle');
checks+=5;
// A distinct node at the same pixel is not permission to join that net.
const aliased = scene(positions,components,wires);
aliased.entities.push({id:'separatePort',kind:'point',role:'independent terminal'});
aliased.constructions.push({id:'separate',operator:'point',inputs:{x:15,y:0,coordinateSpace:'layout'},outputs:['separatePort']});
aliased.constructions.find(c=>c.id==='make_return')!.inputs.end='separatePort';
aliased.requiredEntityIds.push('separatePort');aliased.revealGroups[0]!.entityIds.push('separatePort');
const separateResult = compileSceneDocument(aliased);
assert.equal(separateResult.ok,false,'Coincident coordinates must not silently join separate logical ports');
assert.ok(separateResult.report.issues.some(i=>i.code==='construction_failed'));
// Open arc is not a closed circular obstacle; both an interior exit through its
// open side and an explicit endpoint contact remain possible.
for(const endpoint of [false,true]) {
  const arcScene=scene({a:endpoint?[1,0]:[0,0],b:[2,-2],c:[3,-2],center:[0,0]},[['load','resistor','b','c']],[['arcLead','a','b']]);
  arcScene.entities.push({id:'arc',kind:'arc',role:'open boundary'});
  arcScene.constructions.push({id:'draw_arc',operator:'arc',inputs:{center:'center',radius:1,startAngle:0,endAngle:180,angleUnit:'degrees'},outputs:['arc']});
  arcScene.requiredEntityIds.push('arc');arcScene.revealGroups[0]!.entityIds.push('arc');
  const compiled=compileSceneDocument(arcScene);
  assert.ok(compiled.ok,JSON.stringify(compiled.report.issues));
}
const dense = Array.from({length:100},(_,i)=>({points:[{x:i/2,y:-1},{x:i/2,y:1}],contacts:[]}));
const denseRoute=routeConnector({x:-1,y:0},{x:51,y:0},dense);
assert.ok(denseRoute.length>2);
for(const obstacle of dense) for(let i=1;i<denseRoute.length;i++) assert.equal(proper(denseRoute[i-1]!,denseRoute[i]!,obstacle.points[0]!,obstacle.points[1]!),false);
checks+=105;
// A derived geometric anchor stays available when a later connector reads it.
const derived=scene({a:[0,0],b:[4,0],u:[2,-2],v:[2,2],c:[3,2]},[],[['base','a','b']]);
derived.entities.push({id:'axis',kind:'line',role:'construction line'},{id:'tap',kind:'point',role:'intersection'},{id:'tapLead',kind:'connector',role:'connection'});
derived.constructions.push({id:'axis_make',operator:'line',inputs:{start:'u',end:'v'},outputs:['axis']},
  {id:'tap_make',operator:'intersection',inputs:{first:'base',second:'axis'},outputs:['tap']},
  {id:'tap_lead',operator:'connect',inputs:{start:'tap',end:'c'},outputs:['tapLead']});
derived.requiredEntityIds.push('axis','tap','tapLead');derived.revealGroups[0]!.entityIds.push('axis','tap','tapLead');
const derivedResult=compileSceneDocument(derived);
assert.ok(derivedResult.ok,JSON.stringify(derivedResult.report.issues));
checks++;
console.log(`Connector routing verification passed (${checks} checks).`);
