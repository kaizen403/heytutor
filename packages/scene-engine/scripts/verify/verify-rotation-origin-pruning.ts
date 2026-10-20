import assert from 'node:assert/strict';
import {compileSceneDocument,pruneDeadSceneEntities,synthesizeUniformCircularScene,validateSceneDocument,type SceneDocument} from '../../src/index';
import {validateUniformCircularSourceInputs} from '../../src/physics/uniformCircularSourceBinding';
import {circularPlannerCases} from './fixtures/rotation-origin-source-cases';
let checks=0;
const questions=[
 'A car moves clockwise with a constant speed of 12 m/s on a circular track of radius 24 m. Find its centripetal acceleration.',
 'A stone is whirled clockwise in a horizontal circle of radius 0.6 m with a period of 3 s. Find its speed and acceleration.',
 'A particle moves anticlockwise in a circle of radius 2 m with angular speed 3 rad/s. Find its speed and centripetal acceleration.',
];
const plan={schemaVersion:'turn-plan/v3',givens:[],unknowns:[],derived:[],qualitativeClaims:[],lawIds:['uniform circular motion'],assumptions:[],visualRequirement:'required'};
for(const question of questions){
 const generated=synthesizeUniformCircularScene(question,{turnPlan:plan});
 assert.ok(generated?.status==='drawn','the engine must first create its own circular scene');
 for(const origin of [[0,0]]){
  const document=structuredClone(generated.scene.document);
  const motion=document.constructions.find(c=>c.operator==='rotational_motion');assert.ok(motion,JSON.stringify(document.constructions.map(c=>c.operator)));
  motion.inputs.origin=origin;
  const before=validateSceneDocument(document);assert.ok(before.document);
  const normalized=pruneDeadSceneEntities(document as unknown as Record<string,unknown>);
  const after=validateSceneDocument(normalized);
  assert.ok(after.document,`production pruning must preserve the engine's valid rotational origin: ${JSON.stringify(after.report.issues.map(i=>i.code))}`);
  assert.deepEqual(after.document.constructions.find(c=>c.operator==='rotational_motion')?.inputs.origin,origin,'literal coordinate origin remains a value');
  const compiled=compileSceneDocument(after.document);assert.ok(compiled.ok,JSON.stringify(compiled.report.issues));
  assert.deepEqual(pruneDeadSceneEntities(structuredClone(normalized)),normalized,'normalization remains idempotent');checks+=5;
  assert.deepEqual(validateUniformCircularSourceInputs(after.document,question),[]);
  const wrongRadius=structuredClone(after.document);wrongRadius.quantities.find(q=>q.id==='r')!.value=999;
  const wrongSense=structuredClone(after.document);const state=wrongSense.constructions.find(c=>c.operator==='rotational_motion')!;state.inputs.angularVelocity=-Number(state.inputs.angularVelocity);
  const extraInk=structuredClone(after.document);extraInk.entities.push({id:'extra',kind:'point',role:'unrequested mark'});extraInk.constructions.push({id:'make_extra',operator:'point',inputs:{x:20,y:20,coordinateSpace:'layout'},outputs:['extra']});extraInk.requiredEntityIds.push('extra');
  for(const tampered of [wrongRadius,wrongSense,extraInk])assert.ok(validateUniformCircularSourceInputs(tampered,question).some(i=>i.code==='ucm_source_mismatch'),'pruned-form acceptance must preserve the full source program, not hide wrong physics or extra ink');checks+=4;
 }
}
const torque=(origin:unknown):SceneDocument=>({schemaVersion:'scene-document/v2',visualDecision:{mode:'scene',reason:'Synthetic torque with explicit physical vectors'},source:{},quantities:[],entities:[{id:'tau',kind:'polyline',role:'signed torque'}],constructions:[{id:'make_tau',operator:'planar_torque',inputs:{origin,leverArm:[2,0],force:[0,3],lengthUnit:'m',forceUnit:'N',displayLength:2},outputs:['tau']}],relations:[],assertions:[],annotations:[],requiredEntityIds:['tau'],revealGroups:[{id:'all',entityIds:['tau']}],teachingTimeline:[]});
for(const origin of [[-3,4],{x:-3,y:4}]){
 const raw=torque(origin);const before=validateSceneDocument(raw);assert.ok(before.document);
 const normalized=pruneDeadSceneEntities(raw as unknown as Record<string,unknown>);const after=validateSceneDocument(normalized);
 assert.ok(after.document,'the rotation family torque origin obeys the same inline-value contract');
 assert.deepEqual(after.document.constructions[0]?.inputs.origin,origin);assert.ok(compileSceneDocument(after.document).ok);checks+=4;
}
for(const origin of ['point_id',[0,0,1],[Infinity,0],{x:0,y:0,coordinateSpace:'world'}]){
 assert.equal(validateSceneDocument(pruneDeadSceneEntities(torque(origin) as unknown as Record<string,unknown>)).document,null,'unsupported or malformed origins still reject');checks++;
}
const generic=torque([0,0]);generic.entities=[{id:'arrow',kind:'vector',role:'explicit geometric arrow'}];generic.constructions=[{id:'make_arrow',operator:'vector',inputs:{start:[0,0],end:[1,1]},outputs:['arrow']}];generic.requiredEntityIds=['arrow'];generic.revealGroups=[{id:'all',entityIds:['arrow']}];
const normalized=pruneDeadSceneEntities(generic as unknown as Record<string,unknown>);const cs=normalized.constructions as SceneDocument['constructions'];
assert.equal(typeof cs.find(c=>c.operator==='vector')?.inputs.start,'string','generic geometry retains point-reference normalization');checks++;
console.log(`Rotation origin pruning verification passed (${checks} checks).`);

for(const request of [
 'Explain simple harmonic motion using a reference circle.',
 'Relate SHM to circular motion on a diameter.',
 'Draw the perpendicular projection onto a diameter.',
 'Explain projections onto the x axis.',
 'Explain projecting onto a diameter.',
 'Project the point onto the x axis.',
 'Show the point projected onto a diameter.',
]){
 const question=`A particle moves anticlockwise in a circle of radius 2 m with angular speed 3 rad/s. ${request}`;
 assert.equal(synthesizeUniformCircularScene(question,{turnPlan:plan}),null,'complete circular inputs cannot turn an unsupported projection law into a plain circular figure');checks++;
}
console.log(`Source-domain controls passed; total ${checks} checks.`);

for(const {question,variant,document} of circularPlannerCases()){
 assert.equal(synthesizeUniformCircularScene(question,{turnPlan:plan}),null,'the producer must continue declining unsupported circular laws');
 assert.ok(validateUniformCircularSourceInputs(document,question).some(i=>i.code==='ucm_source_unsupported'&&i.severity==='fatal'),`${variant}: omitted archetype markers cannot release numeric source authority`);
 const compiled=compileSceneDocument(document);
 assert.equal(compiled.ok,false,`${variant}: a numeric circular state with an unsupported law must fail closed`);
 assert.ok(compiled.report.issues.some(i=>i.code==='ucm_source_unsupported'&&i.severity==='fatal'),`${variant}: the compile boundary reports the unsupported law`);checks+=4;
}
for(const {question,variant,document} of circularPlannerCases([''])){
 const compiled=compileSceneDocument(document);
 assert.equal(compiled.ok,variant==='plain program','plain numeric circular source behavior remains unchanged without source markers');
 if(variant!=='plain program')assert.ok(validateUniformCircularSourceInputs(document,question).some(i=>i.code==='ucm_source_mismatch'));
 checks+=variant==='plain program'?1:2;
}
console.log(`Numeric circular source-veto verification passed; total ${checks} checks.`);
