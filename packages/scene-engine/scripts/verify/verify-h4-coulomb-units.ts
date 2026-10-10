import assert from 'node:assert/strict';
import { compileSceneDocument } from '../../src/compile/compiler';
import { evaluateDipoleFieldConstruction, dipoleConstructionOutputLabels } from '../../src/compile/dipoleFieldGeometry';
import type { SceneDocument } from '../../src/types';
let checks=0; const failures:string[]=[];
const check=(ok:unknown,message:string)=>{checks++;if(!ok)failures.push(message);};
const baseInputs={charges:[{position:[0,0],charge:2},{position:[0.5,0],charge:3}],k:9e9,displayLength:0.2};
function document(inputs:Record<string,unknown>, quantities:SceneDocument['quantities']=[], label?:string):SceneDocument{return {schemaVersion:'scene-document/v2',visualDecision:{mode:'scene',reason:'Coulomb unit conversion'},source:{},quantities,entities:[{id:'f1',kind:'vector',...(label?{label}:{})},{id:'f2',kind:'vector'}],constructions:[{id:'force',operator:'coulomb_pair',inputs,outputs:['f1','f2']}],relations:[],assertions:[],annotations:[],requiredEntityIds:['f1','f2'],revealGroups:[{id:'show',entityIds:['f1','f2'],dependsOn:[]}],teachingTimeline:[]};}
const ctx={number:(v:unknown)=>Number(v),point:(v:unknown)=>{const a=v as number[];return {x:a[0]!,y:a[1]!};},geometry:()=>undefined};
const micro={...baseInputs,units:{charge:'µC',length:'m'}};
const rendered=compileSceneDocument(document(micro));
check(rendered.ok,`explicit microC compile: ${JSON.stringify(rendered.report.issues)}`);
check(rendered.renderScene?.primitives.some(p=>p.kind==='label'&&p.text==='F=0.216 N'),'SI derived force label with N');
const cm={...baseInputs,charges:[{position:[0,0],charge:2},{position:[50,0],charge:3}],units:{charge:'uC',length:'cm'}};
const cmRendered=compileSceneDocument(document(cm));
check(cmRendered.ok&&cmRendered.renderScene?.primitives.some(p=>p.kind==='label'&&p.text==='F=0.216 N'),'length prefix converts once and preserves physical force');
for(const [name,units] of [['wrong charge',{charge:'m',length:'m'}],['wrong length',{charge:'C',length:'C'}],['unsupported prefix',{charge:'pC',length:'m'}],['extra key',{charge:'C',length:'m',force:'N'}]])check(!compileSceneDocument(document({...baseInputs,units})).ok,`${name} refused`);
for(const [name,unit] of [['wrong source dimension','m'],['mixed charge prefix','nC'],['mixed declared prefix','C']]){
 const inputs={...micro,charges:[{position:[0,0],charge:'q1'},{position:[0.5,0],charge:3}]};
 check(!compileSceneDocument(document(inputs,[{id:'q1',value:2,unit}])).ok,`${name} quantity refused`);
}
const qs=[{id:'q1',value:2,unit:'μC'},{id:'r',value:0.5,unit:'m'}];
const sourced={...micro,charges:[{position:[0,0],charge:'q1'},{position:['r',0],charge:3}]};
const qr=compileSceneDocument(document(sourced,qs));check(qr.ok&&qr.renderScene?.primitives.some(p=>p.kind==='label'&&p.text==='F=0.216 N'),'source quantity unit aliases converted');
check(!compileSceneDocument(document(sourced,[qs[0]!,{id:'r',value:0.5,unit:'cm'}])).ok,'mixed length reference refused');
const wrapped={...micro,charges:[{position:[0,0],charge:{value:2,unit:'µC'}},{position:[{value:0.5,unit:'m'},0],charge:{value:3,unit:'uC'}}]};
check(compileSceneDocument(document(wrapped)).ok,'explicit compatible inline scalar units accepted');
check(!compileSceneDocument(document({...wrapped,k:{value:9e9,unit:'N*m^2/C^2'}})).ok,'legacy k wrapper still refuses');
check(!compileSceneDocument(document(micro,[],'F=999 N')).ok,'wrong SI numeric force cannot be hidden');
check(compileSceneDocument(document(micro,[],'F=0.216 N')).ok,'source-backed N scalar claim accepted');
check(!compileSceneDocument(document(micro,[],'F=0.216 C')).ok,'wrong force unit refused');
const legacy=compileSceneDocument(document(baseInputs));check(legacy.ok,'bare legacy inputs unchanged');
check(!compileSceneDocument(document({...baseInputs,charges:[{position:[0,0],charge:'q1'},baseInputs.charges[1]!] },[{id:'q1',value:2,unit:'µC'}])).ok,'legacy cannot silently discard source microC prefix');
const tiny=evaluateDipoleFieldConstruction('coulomb_pair',{charges:[{position:[0,0],charge:1e-12},{position:[1,0],charge:1e-12}],k:9e9,displayLength:1},ctx);
check(dipoleConstructionOutputLabels('coulomb_pair',tiny)[0]==='F=9e-15 N','tiny nonzero force keeps significant digits and N');
const symbolic=document(micro,[],'F1');symbolic.source={nonMetric:true,representationTier:'qualitative_verified'};symbolic.entities[1]!.label='F2';
check(compileSceneDocument(symbolic).ok&&compileSceneDocument(symbolic).renderScene?.primitives.some(p=>p.kind==='label'&&p.text==='F1'),'symbol suppression after numeric unit validation');
const badSymbolic=structuredClone(symbolic);badSymbolic.entities[0]!.label='F=999 N';check(!compileSceneDocument(badSymbolic).ok,'symbolic mode cannot bypass false numeric N claim');
// Other operators remain bare SI; source dimension or prefix must not be discarded.
const torque=document({},[{id:'p',value:2,unit:'C'}]);torque.entities=[{id:'f1',kind:'vector'}];torque.constructions=[{id:'torque',operator:'dipole_torque',inputs:{p:['p',0],E:[0,1],at:[0,0],displayLength:0.2},outputs:['f1']}];torque.requiredEntityIds=['f1'];torque.revealGroups[0]!.entityIds=['f1'];
check(!compileSceneDocument(torque).ok,'dipole moment wrong source dimension refused');

const pointSource=document({...micro,charges:[{position:'qpos',charge:2},micro.charges[1]!] },[{id:'x',value:0,unit:'cm'}]);pointSource.entities.push({id:'qpos',kind:'point',role:'source charge position'});pointSource.requiredEntityIds.push('qpos');pointSource.revealGroups[0]!.entityIds.push('qpos');pointSource.constructions.unshift({id:'qpos_make',operator:'point',inputs:{x:'x',y:0},outputs:['qpos']});
check(!compileSceneDocument(pointSource).ok,'constructed point source unit mismatch refused even at zero');
pointSource.quantities[0]!.unit='m';check(compileSceneDocument(pointSource).ok,`constructed source point uses declared length scale: ${JSON.stringify(compileSceneDocument(pointSource).report.issues)}`);
check(!compileSceneDocument(document({...wrapped,charges:[{position:[0,0],charge:{value:2,unit:'µC',guess:2}},wrapped.charges[1]!] })).ok,'extra scalar wrapper keys refused');
check(!compileSceneDocument(document({...baseInputs,charges:[{position:[0,0],charge:1e-300},{position:[1,0],charge:1e-300}]})).ok,'nonzero force underflow refuses certification');
const validTorque=structuredClone(torque);validTorque.quantities[0]!.unit='C m';check(compileSceneDocument(validTorque).ok,'canonical SI dipole moment reference accepted');
validTorque.quantities[0]!.unit='µC m';check(!compileSceneDocument(validTorque).ok,'unsupported dipole moment prefix refuses instead of dropping units');
const badField=structuredClone(torque);badField.quantities=[{id:'field',value:1,unit:'T'}];badField.constructions[0]!.inputs.p=[1,0];badField.constructions[0]!.inputs.E=[0,'field'];check(!compileSceneDocument(badField).ok,'electric field source cannot use magnetic units');
console.log(`H4 Coulomb units: ${checks-failures.length}/${checks} passed`);assert.equal(failures.length,0,failures.join('\n'));
