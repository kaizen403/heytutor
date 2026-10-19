import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import { chapterRemainderOutputLabels, evaluateChapterRemainderConstruction } from "../../src/compile/chapterRemainderGeometry";
import type { SceneDocument } from "../../src/types";
const context = { number: Number, point: () => ({x:0,y:0}), geometry: () => undefined };
const inputs = {speed:20, gravity:10, launchAngleDeg:30, displayScale:1};
const outputs = evaluateChapterRemainderConstruction("projectile_trajectory",inputs,context);
function document(label:string): SceneDocument {
 return {schemaVersion:"scene-document/v2",source:{question:"Draw the projectile and its initial velocity."},visualDecision:{mode:"scene",reason:"Trajectory."},quantities:[],entities:[{id:"path",kind:"polyline",role:"trajectory"},{id:"velocity",kind:"vector",role:"initial velocity",label}],constructions:[{id:"flight",operator:"projectile_trajectory",inputs,outputs:["path","velocity"]}],relations:[],assertions:[],annotations:[],requiredEntityIds:["path","velocity"],revealGroups:[{id:"flight_group",entityIds:["path","velocity"],dependsOn:[],narrationCue:"Launch."}],teachingTimeline:[]};
}
for (const symbol of ["u","v₀","v0","u_A","v_rel","α"]) {
 const compiled=compileSceneDocument(document(symbol),{yieldPolicy:"verified_parts"});
 assert(compiled.ok && compiled.renderScene?.primitives.some(p=>p.entityId==="velocity"&&p.text===symbol),`plain symbol ${symbol} must survive compilation: ${JSON.stringify(compiled.report.issues)}`);
 assert(!compileSceneDocument(document(symbol),{yieldPolicy:"off"}).ok,"new aliases remain opt-in");
}
for(const text of ["20","20 m/s","u=20","u=999","u²","u+v","u/v","u = ?","2u"]){
 assert(!compileSceneDocument(document(text),{yieldPolicy:"verified_parts"}).ok,`${text} is not a bare quantity symbol`);
}
const relative=evaluateChapterRemainderConstruction("relative_velocity",{velocityA:[3,4],velocityB:[1,0],units:{velocity:"m/s"},displayScale:3},context);
assert.deepEqual(chapterRemainderOutputLabels("relative_velocity",relative,["u_A","u_B","v_rel"],true),["u_A","u_B","v_rel"]);
assert.throws(()=>chapterRemainderOutputLabels("relative_velocity",relative,["u_A","u_B","v_rel"]));
assert.throws(()=>chapterRemainderOutputLabels("relative_velocity",relative,["vA=999","vB","vRel"],true));
assert.deepEqual(chapterRemainderOutputLabels("relative_velocity",relative,["vA=5","vB","vRel"],true),["vA=5","vB","vRel"]);
assert.deepEqual(chapterRemainderOutputLabels("projectile_trajectory",outputs),chapterRemainderOutputLabels("projectile_trajectory",outputs,undefined,true));
console.log("quantity symbols: opt-in aliases survive; numeric/expression claims retain their proof boundary");
