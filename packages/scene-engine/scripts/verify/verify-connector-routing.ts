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


// F1: these circuits overlap only in planner coordinates; final view slots do not.
function twoPanels(shunt=false): SceneDocument {
  const nodes:Record<string,[number,number]> = {};
  const parts:string[][]=[],edges:string[][]=[],groups:string[][]=[];
  for(let index=0;index<2;index++) {
    const prefix=`p${index}_`,dx=index;
    const local:Record<string,[number,number]>={a:[dx,3+dx],b:[4+dx,3+dx],c:[4+dx,dx],d:[dx,dx]};
    for(const [id,value] of Object.entries(local)) nodes[prefix+id]=value;
    const ps=[['cell','cell','d','a'],['load','resistor','a','b'],['meter','galvanometer','b','c']];
    if(shunt&&index===1) ps.push(['shunt','resistor','b','c']);
    parts.push(...ps.map(([id,s,a,b])=>[prefix+id!,s!,prefix+a!,prefix+b!]));
    edges.push([prefix+'return',prefix+'c',prefix+'d']);
    groups.push([...Object.keys(local).map(id=>prefix+id),...ps.map(p=>prefix+p[0]),prefix+'return']);
  }
  const doc=scene(nodes,parts,edges);
  doc.revealGroups=groups.map((entityIds,i)=>({id:`panel${i}`,entityIds,dependsOn:[],narrationCue:'Independent circuit'}));
  return doc;
}
for(const shunt of [false,true]) {
  const result=compileSceneDocument(twoPanels(shunt));
  assert.ok(result.ok,JSON.stringify(result.report.issues));checks++;
  const returns=result.renderScene!.primitives.filter(p=>p.entityId.endsWith('_return'));
  assert.equal(returns.length,2);checks++;
}
// The same two components do share ink if panel packing is disabled.
for(const disabled of ['same-group','dsa']) {
  const doc=twoPanels();
  if(disabled==='same-group') doc.revealGroups=[{id:'shared',entityIds:doc.requiredEntityIds,dependsOn:[],narrationCue:'Shared figure'}];
  else doc.source.synthesizedDsa=true;
  const result=compileSceneDocument(doc);
  // The offset source passes through the first resistor: it cannot be repaired
  // by pretending the separately authored components are separate view slots.
  if(result.ok) {
    const first=result.renderScene!.primitives.find(p=>p.entityId==='p0_a')!.points[0]!;
    const second=result.renderScene!.primitives.find(p=>p.entityId==='p1_a')!.points[0]!;
    assert.ok(second.x>first.x&&second.y<first.y,'Shared slot retains the common coordinate transform');
  }
  checks++;
}
// F3: dimension baselines are source measurements, not visible wire obstacles.
for(const count of [1,2]) {
  const doc=scene({a:[0,0],tap:[1.6,0],b:[4,0],top:[1.6,1.5]},
    [['left','resistor','a','top'],['right','resistor','top','b'],['meter','galvanometer','top','tap']],
    [['leftWire','a','tap'],['rightWire','tap','b']]);
  for(let i=0;i<count;i++) {
    const id=`measure${i}`;
    doc.entities.push({id,kind:'dimension',role:'measured length'});
    doc.constructions.push({id:`make_${id}`,operator:'dimension',inputs:{start:'a',end:i?'b':'tap',label:'length'},outputs:[id]});
    doc.requiredEntityIds.push(id);doc.revealGroups[0]!.entityIds.push(id);
  }
  const result=compileSceneDocument(doc);
  assert.ok(result.ok,JSON.stringify(result.report.issues));
  assert.ok(result.renderScene!.primitives.filter(p=>p.entityId.endsWith('Wire')).every(p=>p.points.length===2),'Offset dimensions keep the bridge wires straight');
  assert.ok(result.renderScene!.primitives.filter(p=>p.provenance?.measurementRole==='witness').every(p=>p.provenance?.dashed===true),'Nonconductive measurement witnesses retain their dashed rendering');checks+=3;
}
// Relocating a measurement bar must not feed its pixel offset back into
// symmetric figure padding. A straight wire and the same explicit line have
// identical apparatus geometry; routing cannot shrink all of its symbols.
for (const scale of [0.8, 1, 1.5]) {
const measured=scene({a:[0,0],j:[3,0],b:[8,0],r:[8,-3],s:[3,-3],u:[1,3],v:[1,5],w:[4,4]},
  [['leftLoad','resistor','a','j'],['rightLoad','resistor','j','b'],['lowerLoad','resistor','r','s'],['source','battery','s','a'],['cellLow','battery','a','u'],['cellHigh','battery','a','v'],['selectorLow','switch','u','w'],['selectorHigh','switch','v','w'],['meter','galvanometer','w','j']],
  [['lead','b','r']]);
measured.entities.find(e=>e.id==='leftLoad')!.label='R';
measured.entities.push({id:'span',kind:'dimension',role:'measured span',label:'length'});
measured.constructions.push({id:'spanMake',operator:'dimension',inputs:{start:'a',end:'j'},outputs:['span']});
measured.requiredEntityIds.push('span');measured.revealGroups[0]!.entityIds.push('span');
const control=structuredClone(measured);control.constructions.find(c=>c.id==='make_lead')!.operator='line';

for (const doc of [measured, control]) for (const c of doc.constructions) if (c.operator === 'point') {
  c.inputs.x = Number(c.inputs.x) * scale;
  c.inputs.y = Number(c.inputs.y) * scale;
}
const routed = compileSceneDocument(measured), fixed = compileSceneDocument(control);
assert.ok(routed.ok && routed.renderScene, JSON.stringify(routed.report.issues));
assert.ok(fixed.ok && fixed.renderScene, JSON.stringify(fixed.report.issues));
const apparatus = (result: typeof routed) => result.renderScene!.primitives
  .filter(p => measured.entities.some(e => e.id === p.entityId && e.kind === 'component') && p.kind !== 'label');
assert.deepEqual(apparatus(routed), apparatus(fixed), 'Dimension relocation must preserve the initial apparatus fit');
const dimensionInk = routed.renderScene.primitives.filter(p => p.entityId === 'span' && p.kind !== 'label');
assert.ok(dimensionInk.some(p => p.kind === 'dimension'), 'Relocated measurement bar remains present');
assert.ok(dimensionInk.every(p => p.points.every(v => v.x >= 400 && v.x <= 1160 && v.y >= 0 && v.y <= 700)), 'Relocated bar and witnesses remain in the diagram viewport');
assert.ok(dimensionInk.filter(p => p.provenance?.measurementRole === 'witness').every(p => p.provenance?.dashed === true));
checks += 6;
}
// The complete closing edge is essential: an enclosed terminal cannot escape.
const enclosure=scene({a:[0,0],b:[-4,0],c:[-5,0]},[['load','resistor','b','c']],[['lead','a','b']]);
enclosure.entities.push({id:'outline',kind:'polygon',role:'closed boundary'});
enclosure.constructions.push({id:'draw_outline',operator:'polygon',inputs:{points:[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}],coordinateSpace:'layout'},outputs:['outline']});
enclosure.requiredEntityIds.push('outline');enclosure.revealGroups[0]!.entityIds.push('outline');
const enclosed=compileSceneDocument(enclosure);
assert.equal(enclosed.ok,false);assert.ok(enclosed.report.issues.some(i=>i.code==='construction_failed'));checks+=2;
// Invisible normal helpers are not ink even when explicitly declared.
const hidden=scene({a:[0,0],b:[4,0],c:[5,0],u:[1,-0.5],v:[3,-0.5],contact:[2,-0.5]},[['load','resistor','b','c']],[['lead','a','b']]);
hidden.entities.push({id:'surface',kind:'segment',role:'surface'},{id:'normal',kind:'vector',role:'construction normal'});
hidden.constructions.push({id:'surface_make',operator:'segment',inputs:{start:'u',end:'v'},outputs:['surface']},{id:'normal_make',operator:'normal_at',inputs:{point:'contact',surface:'surface'},outputs:['normal']});
hidden.requiredEntityIds.push('surface','normal');hidden.revealGroups[0]!.entityIds.push('surface','normal');
const hiddenResult=compileSceneDocument(hidden);
assert.ok(hiddenResult.ok,JSON.stringify(hiddenResult.report.issues));
assert.ok(hiddenResult.renderScene!.primitives.every(p=>p.entityId!=='normal'));checks+=2;
// An axis is two reference strokes, never a fictitious bounding-box diagonal.
const withAxes=scene({a:[0,0],b:[4,0],c:[5,0]},[['load','resistor','b','c']],[['lead','a','b']]);
withAxes.entities.push({id:'reference',kind:'axes',role:'reference axes'});
withAxes.constructions.push({id:'axes_make',operator:'axes',inputs:{xMin:-1,xMax:6,yMin:-2,yMax:2},outputs:['reference']});
withAxes.requiredEntityIds.push('reference');withAxes.revealGroups[0]!.entityIds.push('reference');
assert.ok(compileSceneDocument(withAxes).ok);checks++;
// A line spans the whole displayed viewport, not merely its defining segment.
// Its ray counterpart can be routed around the finite origin.
for(const operator of ['line','ray']) {
  const doc=scene({a:[0,0],b:[4,0],c:[5,0],u:[2,1],v:[2,0.5]},[['load','resistor','b','c']],[['lead','a','b']]);
  doc.entities.push({id:'boundary',kind:operator==='line'?'line':'ray',role:'visible boundary'});
  doc.constructions.push({id:'boundary_make',operator,inputs:{start:'u',end:'v'},outputs:['boundary']});
  doc.requiredEntityIds.push('boundary');doc.revealGroups[0]!.entityIds.push('boundary');
  const result=compileSceneDocument(doc);
  if(operator==='line') {
    assert.equal(result.ok,false,'A viewport-spanning visible line cannot be crossed');
    assert.ok(result.report.issues.some(i=>i.code==='construction_failed'));
  } else {
    assert.ok(result.ok,JSON.stringify(result.report.issues));
    const lead=result.renderScene!.primitives.find(p=>p.entityId==='lead')!.points;
    const boundary=result.renderScene!.primitives.find(p=>p.entityId==='boundary')!.points;
    for(let i=1;i<lead.length;i++) assert.equal(proper(lead[i-1]!,lead[i]!,boundary[0]!,boundary.at(-1)!),false);
  }
  checks+=2;
}
// F4: a safe existing return keeps its clearance and exact shape; an unsafe
// preferred path that skims a capacitor plate is rerouted instead.
const kept=[{x:0,y:0},{x:0,y:20},{x:100,y:20},{x:100,y:0}];
const plate={points:[{x:40,y:-10},{x:40,y:10}],contacts:[]};
assert.deepEqual(routeConnector({x:0,y:0},{x:100,y:0},[plate],{preferred:[kept],clearance:6,margin:14}),kept);
const skim=[{x:0,y:0},{x:0,y:11},{x:100,y:11},{x:100,y:0}];
assert.notDeepEqual(routeConnector({x:0,y:0},{x:100,y:0},[plate],{preferred:[skim],clearance:6,margin:14}),skim);checks+=2;
// The wire net explicitly declares a terminal tap on a straight component
// lead. A coincident but unjoined branch at that same pixel must still reject.
for(const joined of [false,true]) {
  const doc=scene({a:[0,0],b:[6,0],tap:[1,0],c:[1,-3],d:[3,-3]},[['cap','capacitor','a','b'],['load','resistor','c','d']],
    [['branch','tap','c'],...(joined?[['join','a','tap']]:[])]);
  const result=compileSceneDocument(doc);
  assert.equal(result.ok,joined,JSON.stringify(result.report.issues));checks++;
}
// Terminal fan-out: both axial directions are occupied by explicit shared
// contacts, yet a diagonal escape is legal and needs several route segments.
const junction={x:0,y:0},destination={x:174,y:145};
const terminalObstacles=[
  {points:[{x:0,y:-34},{x:0,y:34}],contacts:[junction]},
  {points:[junction,{x:435,y:0}],contacts:[junction]},
  {points:[junction,{x:-14,y:0},{x:-14,y:-145}],contacts:[junction]},
  {points:[{x:0,y:28},{x:435,y:28}],contacts:[]},
];
const escaping=routeConnector(junction,destination,terminalObstacles,{clearance:6,margin:14});
assert.ok(escaping.length>3);checks++;
console.log(`Connector routing verification passed (${checks} checks).`);
