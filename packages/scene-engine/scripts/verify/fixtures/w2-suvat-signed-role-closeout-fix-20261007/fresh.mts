import {readFileSync,writeFileSync} from 'node:fs';
import * as E from '@heytutor/scene-engine';import * as C from '@heytutor/tutor-core';
import {selectVerifiedRepresentation} from './tree/apps/tutor/features/tutor-session/lib/scene/representationFallback';
const {liftCompactProblemIR}=C;
const problem=JSON.parse(readFileSync('/Users/kaizen/heytutor-claude-coord/reviews/w2-suvat-parent-closeout-review-20261006/original-ir.json','utf8'));
type TurnPlanV3=E.TurnPlanV3;type ProblemIR=E.ProblemIR;
function interval(name:string,u:number,v:number,t:number,a:number,s:number,unit="m/s",uSI=u,vSI=v){
  const q=`A car accelerates uniformly from ${u} ${unit} to ${v} ${unit} in ${t} s. Find its acceleration and displacement.`;
  const givens=[{id:"u",symbol:"u",value:u,unit,provenance:"given",sourceText:`${u} ${unit}`},
    {id:"v",symbol:"v",value:v,unit,provenance:"given",sourceText:`${v} ${unit}`},
    {id:"t",symbol:"t",value:t,unit:"s",provenance:"given",sourceText:`${t} s`}];
  const plan={schemaVersion:"turn-plan/v3",question:q,givens,unknowns:[{id:"a",symbol:"a",unit:"m/s^2"},{id:"s",symbol:"s",unit:"m"}],
    derived:[{id:"a",symbol:"a",value:a,unit:"m/s^2",provenance:"derived",sourceText:`a=(v-u)/t=(${vSI}-${uSI})/${t}=${a}`,dependsOn:["u","v","t"]},
      {id:"s",symbol:"s",value:s,unit:"m",provenance:"derived",sourceText:`s=(u+v)t/2=(${uSI}+${vSI})*${t}/2=${s}`,dependsOn:["u","v","t"]}],
    qualitativeClaims:[],lawIds:["kinematics_uniform_acceleration","v=u+at","s=(u+v)t/2"],assumptions:["uniform (constant) acceleration","straight-line motion"],visualRequirement:"optional"} as TurnPlanV3;
  const compact={facts:[{id:"fU",kind:"given",statement:`initial velocity ${u} ${unit}`,quote:`from ${u} ${unit}`},
    {id:"fV",kind:"given",statement:`final velocity ${v} ${unit}`,quote:`to ${v} ${unit}`},
    {id:"fT",kind:"given",statement:`time ${t} s`,quote:`in ${t} s`},
    {id:"fUniform",kind:"given",statement:"uniform acceleration",quote:"accelerates uniformly"},
    {id:"fReqA",kind:"requested",statement:"find acceleration",quote:"Find its acceleration"},
    {id:"fReqS",kind:"requested",statement:"find displacement",quote:"displacement"}],
    entities:[{id:"car",kind:"body",label:"car",evidenceFactIds:["fU","fV","fT"]}],
    expressions:[{id:"eA",valueType:"scalar",expr:`(${vSI}-${uSI})/${t}`,evidenceFactIds:["fU","fV","fT"]},
      {id:"eS",valueType:"scalar",expr:`(${uSI}+${vSI})*${t}/2`,evidenceFactIds:["fU","fV","fT"]}],constraints:[],
    representationIntents:[{id:"iMotion",kind:"conceptual",entityIds:["car"],evidenceFactIds:["fU","fV","fT","fUniform"]}],
    solveRequests:problem.solveRequests};
  return {name,q,plan,ir:liftCompactProblemIR(compact,q) as ProblemIR,content:JSON.stringify(compact),expected:{u:uSI,v:vSI,a,t,s}};
}

const original=interval('negative-axis',-8,-2,3,2,-15);
const cases=[{name:'original',c:structuredClone(original)}];
const assumption=structuredClone(original);assumption.plan.assumptions.push('initial direction taken as positive');cases.push({name:'contradictory-initial-direction',c:assumption});
const distance=structuredClone(original);distance.ir.facts.find(f=>f.id==='fReqS')!.statement='find distance';cases.push({name:'negative-distance-requested-fact',c:distance});
const labels=structuredClone(original);labels.plan.unknowns.find(r=>r.id==='s')!.symbol='distance';labels.plan.derived.find(r=>r.id==='s')!.symbol='distance';labels.ir.solveRequests.find(r=>r.resultBinding?.turnPlanQuantityId==='s')!.resultBinding!.symbol='distance';cases.push({name:'negative-distance-plan-role',c:labels});
const records=[];for(const {name,c} of cases){const before=JSON.stringify(c);const admitted=E.admitSuvatCaller(c.q,c.ir,c.plan);const selected=selectVerifiedRepresentation({question:c.q,turnPlan:c.plan,problemIR:c.ir});const doc=E.suvatCallerDocument(c.q,c.ir,c.plan);const compiled=doc?E.compileSceneDocument(doc,{sourceAuthority:{question:c.q,problemIR:c.ir,turnPlan:c.plan}}):null;const api=await C.planProblemAuthorityV1(c.q,c.plan,{proxyUrl:'http://offline.invalid',timeoutMs:5000,fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(c.ir)}}]})});writeFileSync('/Users/kaizen/heytutor-claude-coord/reviews/w2-suvat-parent-closeout-review-20261006/'+name+'.json',JSON.stringify(c,null,2));records.push({name,admitted:admitted.status,reason:'reason'in admitted?admitted.reason:null,compile:compiled?.ok,selected:selected.tier,marks:selected.renderScene.primitives.length,apiStatus:api&&('status'in api?api.status:api.audit.status),bindings:api&&!('status'in api)?api.audit.bindings.map(r=>({id:r.quantityId,symbol:r.symbol,value:r.approximate})):null,unchanged:JSON.stringify(c)===before});}
writeFileSync('/Users/kaizen/heytutor-claude-coord/reviews/w2-suvat-parent-closeout-review-20261006/fresh-results-'+process.argv[2]+'.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records,null,2));
