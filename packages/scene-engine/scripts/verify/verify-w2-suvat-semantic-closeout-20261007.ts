/** Existing full SUVAT callers: semantic role identity and physical predicate proof. */
import {readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as E from '@heytutor/scene-engine';
import * as C from '@heytutor/tutor-core';
import {selectVerifiedRepresentation,selectFastVerifiedRepresentation} from '../../../../apps/tutor/features/tutor-session/lib/scene/representationFallback';
import {sceneSaveAdmissionFailure} from '../../../../apps/tutor/lib/scene/sceneSaveAdmission';
const bytes=readFileSync(new URL('./fixtures/w2-suvat-semantic-closeout-20261007/full-callers.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'824b52bd92a478786f2f4bc57dd753b1f640f374810c6db3ec642778bcf907af');
const predicateBytes=readFileSync(new URL('./fixtures/w2-suvat-semantic-closeout-20261007/predicate-callers.json',import.meta.url));
assert.equal(createHash('sha256').update(predicateBytes).digest('hex'),'c339c6d292a3286b745d6e5e5eaf5795595eeec61ea9830b216d786887b04ab3');
const finalBytes=readFileSync(new URL('./fixtures/w2-suvat-semantic-closeout-20261007/final-review-callers.json',import.meta.url));
assert.equal(createHash('sha256').update(finalBytes).digest('hex'),'8f0ad717e7206001eece65ff7f3659e54e9c41fdc86347791d8c40df6c6ab3a0');
const tests=[...JSON.parse(bytes.toString()).cases,...JSON.parse(predicateBytes.toString()).cases,...JSON.parse(finalBytes.toString())];
const original=tests[0].c;
const doc=E.suvatCallerDocument(original.q,original.ir,original.plan)!;
let checks=0;const failed:string[]=[];const records=[];
for(const t of tests){
 const c=t.c,before=JSON.stringify(c),content=JSON.stringify(c.ir),failureStart=failed.length;
 const admitted=E.admitSuvatCaller(c.q,c.ir,c.plan);
 const source=E.suvatCallerDocument(c.q,c.ir,c.plan);
 const api=await C.planProblemAuthorityV1(c.q,c.plan,{proxyUrl:'https://offline.invalid',timeoutMs:3000,fetchImpl:async()=>Response.json({choices:[{message:{content}}]})});
 const selected=selectVerifiedRepresentation({question:c.q,turnPlan:c.plan,problemIR:c.ir});
 const fast=selectFastVerifiedRepresentation({question:c.q,turnPlan:c.plan,problemIR:c.ir});
 const compiled=E.compileSceneDocument(source??doc,{sourceAuthority:{question:c.q,problemIR:c.ir,turnPlan:c.plan}});
 const save=sceneSaveAdmissionFailure({document:source??doc,question:c.q,turnPlan:c.plan,problemIR:c.ir,tier:'exact_verified'});
 const check=(ok:any,message:string)=>{checks++;if(!ok)failed.push(t.name+': '+message);};
 check(admitted.status===(t.accept?'ok':'declined'),'whole admission');
 check(t.accept?Boolean(api&&!('status'in api)&&api.audit.status==='verified'):Boolean(api&&'status'in api&&api.status==='source_declined'),'API status');
 check(compiled.ok===t.accept&& (t.accept||!compiled.renderScene),'atomic strict compile');
 check(t.accept?selected.tier==='exact_verified'&&selected.renderScene.primitives.length>0:selected.renderScene.primitives.length===0,'normal selection');
 check(Boolean(fast)===t.accept,'fast selection');check(t.accept?save===null:Boolean(save),'pure save guard');
 check(before===JSON.stringify(c),'input unchanged');
 if(api){check(api.rawContent===content,'raw transport retained');check(isDeepStrictEqual('status'in api?api.rawProblemIR:api.problemIR,c.ir),'complete IR retained');}
 if(t.accept&&admitted.status==='ok')check(isDeepStrictEqual(admitted.source.state,c.expected),'independent state oracle');
 records.push({name:t.name,expected:t.accept?'accept':'decline',admitted:admitted.status,reason:'reason'in admitted?admitted.reason:null,apiStatus:api&&('status'in api?api.status:api.audit.status),bindings:api&&!('status'in api)?api.audit.bindings.map((r:any)=>({id:r.quantityId,symbol:r.symbol,value:r.approximate})):null,compile:compiled.ok,compileIssues:compiled.report.issues,selected:selected.tier,marks:selected.renderScene.primitives.length,fast:Boolean(fast),save,failures:failed.slice(failureStart),input:c});
}
const result={checks,cases:tests.length,failed,records};
const output=process.argv[2];if(output)writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({checks,cases:tests.length,failed,records:records.map(({input,...r})=>r)},null,2));
if(failed.length)process.exitCode=1;
