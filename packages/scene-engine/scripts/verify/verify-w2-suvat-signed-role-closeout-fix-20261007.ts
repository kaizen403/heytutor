/** Finite signed-role repair; every call keeps the full question, Plan and IR. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import * as E from "@heytutor/scene-engine";
import * as C from "@heytutor/tutor-core";
import { selectVerifiedRepresentation, selectFastVerifiedRepresentation } from "../../../../apps/tutor/features/tutor-session/lib/scene/representationFallback";
import { sceneSaveAdmissionFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";

type Case = {name:string;q:string;plan:E.TurnPlanV3;ir:E.ProblemIR;content:string;expected:{u:number;v:number;a:number;t:number;s:number}};
const dir=new URL("./fixtures/w2-suvat-signed-role-closeout-fix-20261007/",import.meta.url);
const load=(name:string):Case=>JSON.parse(readFileSync(new URL(name,dir),"utf8"));
const original=load("original.json");
const cases:Array<{name:string;c:Case;accept:boolean}>=[{name:"negative-axis-original",c:structuredClone(original),accept:true}];
for(const name of ["negative-distance-requested-fact","negative-distance-plan-role","contradictory-initial-direction"]){
  cases.push({name,c:load(name+".json"),accept:false});
}
for(const role of ["u","v"] as const){
  const c=structuredClone(original);
  c.plan.givens.find(row=>row.id===role)!.symbol=role==="u"?"initialspeed":"finalspeed";
  cases.push({name:`negative-${role}-speed-plan-symbol`,c,accept:false});
  const fact=structuredClone(original);
  fact.ir.facts.find(row=>row.id===(role==="u"?"fU":"fV"))!.statement=role==="u"?"initial speed -8 m/s":"final speed -2 m/s";
  cases.push({name:`negative-${role}-speed-fact-statement`,c:fact,accept:false});
}

// Full independent callers in the existing u/v/t and u/a/t source grammar.
function full(name:string,q:string,known:Array<{id:string;value:number;unit:string;quote:string;statement:string}>,asks:Array<{id:string;value:number;unit:string;quote:string;statement:string;expr:string;working:string}>,expected:Case["expected"]):Case{
 const facts=[...known.map(row=>({id:"f"+row.id,kind:"given",statement:row.statement,quote:row.quote})),
  {id:"fUniform",kind:"given",statement:"uniform acceleration",quote:"accelerates uniformly"},
  ...asks.map(row=>({id:"fReq"+row.id,kind:"requested",statement:row.statement,quote:row.quote}))];
 const compact={facts,entities:[{id:"car",kind:"body",label:"car",evidenceFactIds:known.map(row=>"f"+row.id)}],
  expressions:asks.map(row=>({id:"e"+row.id,valueType:"scalar",expr:row.expr,evidenceFactIds:known.map(row=>"f"+row.id)})),constraints:[],
  representationIntents:[{id:"iMotion",kind:"conceptual",entityIds:["car"],evidenceFactIds:[...known.map(row=>"f"+row.id),"fUniform"]}],
  solveRequests:asks.map(row=>({id:"r"+row.id,kind:"evaluate",expressionId:"e"+row.id,resultBinding:{turnPlanQuantityId:row.id,symbol:row.id,unit:row.unit,evidenceFactIds:["fReq"+row.id]}}))};
 const plan={schemaVersion:"turn-plan/v3",question:q,givens:known.map(row=>({id:row.id,symbol:row.id,value:row.value,unit:row.unit,provenance:"given",sourceText:row.quote})),
  unknowns:asks.map(row=>({id:row.id,symbol:row.id,unit:row.unit})),derived:asks.map(row=>({id:row.id,symbol:row.id,value:row.value,unit:row.unit,provenance:"derived",sourceText:row.working,dependsOn:known.map(row=>row.id)})),
  qualitativeClaims:[],lawIds:["kinematics_uniform_acceleration","v=u+at","s=(u+v)t/2"],assumptions:["uniform (constant) acceleration","straight-line motion"],visualRequirement:"optional"} as E.TurnPlanV3;
 return {name,q,plan,ir:C.liftCompactProblemIR(compact,q) as E.ProblemIR,content:JSON.stringify(compact),expected};
}
const negativeSpeed=full("explicit-negative-speed-source","A car accelerates uniformly from an initial speed of -8 m/s to a final speed of -2 m/s in 3 s. Find its acceleration and displacement.",
 [{id:"u",value:-8,unit:"m/s",quote:"-8 m/s",statement:"initial velocity -8 m/s"},{id:"v",value:-2,unit:"m/s",quote:"-2 m/s",statement:"final velocity -2 m/s"},{id:"t",value:3,unit:"s",quote:"3 s",statement:"time 3 s"}],
 [{id:"a",value:2,unit:"m/s^2",quote:"acceleration",statement:"find acceleration",expr:"(-2--8)/3",working:"a=(v-u)/t=2"},{id:"s",value:-15,unit:"m",quote:"displacement",statement:"find displacement",expr:"(-8+-2)*3/2",working:"s=(u+v)t/2=-15"}],original.expected);
cases.push({name:negativeSpeed.name,c:negativeSpeed,accept:false});
const rest=full("source-rest-positive-convention","A car starts from rest and accelerates uniformly to 6 m/s in 3 s. Find its acceleration and displacement.",
 [{id:"u",value:0,unit:"m/s",quote:"starts from rest",statement:"initial velocity 0 m/s"},{id:"v",value:6,unit:"m/s",quote:"6 m/s",statement:"final velocity 6 m/s"},{id:"t",value:3,unit:"s",quote:"3 s",statement:"time 3 s"}],
 [{id:"a",value:2,unit:"m/s^2",quote:"acceleration",statement:"find acceleration",expr:"(6-0)/3",working:"a=(v-u)/t=2"},{id:"s",value:9,unit:"m",quote:"displacement",statement:"find displacement",expr:"(0+6)*3/2",working:"s=(u+v)t/2=9"}],{u:0,v:6,a:2,t:3,s:9});
rest.plan.assumptions.push("initial direction taken as positive");cases.push({name:rest.name,c:rest,accept:true});
const finalVelocity=full("negative-final-velocity-request","A car with an initial velocity of -8 m/s accelerates uniformly with 2 m/s^2 for 3 s. Find its final velocity and displacement.",
 [{id:"u",value:-8,unit:"m/s",quote:"-8 m/s",statement:"initial velocity -8 m/s"},{id:"a",value:2,unit:"m/s^2",quote:"2 m/s^2",statement:"acceleration 2 m/s^2"},{id:"t",value:3,unit:"s",quote:"3 s",statement:"time 3 s"}],
 [{id:"v",value:-2,unit:"m/s",quote:"final velocity",statement:"find final velocity",expr:"-8+2*3",working:"v=u+at=-2"},{id:"s",value:-15,unit:"m",quote:"displacement",statement:"find displacement",expr:"-8*3+2*3*3/2",working:"s=ut+at^2/2=-15"}],original.expected);
cases.push({name:finalVelocity.name,c:finalVelocity,accept:true});
const finalSpeed=structuredClone(finalVelocity);
finalSpeed.plan.unknowns.find(row=>row.id==="v")!.symbol="finalspeed";
finalSpeed.plan.derived.find(row=>row.id==="v")!.symbol="finalspeed";
finalSpeed.ir.solveRequests.find(row=>row.resultBinding?.turnPlanQuantityId==="v")!.resultBinding!.symbol="finalspeed";
cases.push({name:"negative-final-speed-request-alias",c:finalSpeed,accept:false});

let checks=0;const failed:string[]=[];
const check=(condition:unknown,label:string)=>{checks++;if(!condition)failed.push(label);};
const same=(a:unknown,b:unknown,label:string)=>check(isDeepStrictEqual(a,b),label);
const records:unknown[]=[];
async function main(){
 const out=process.argv[2];
 if(out)writeFileSync(out.replace(/\.json$/,"-inputs.json"),JSON.stringify(cases,null,2)+"\n");
 const goodDoc=E.suvatCallerDocument(original.q,original.ir,original.plan)!;
 check(goodDoc,"unchanged negative-axis source document exists");
 for(const {name,c,accept} of cases){
  const before=JSON.stringify(c),firstFailure=failed.length;
  const content=JSON.stringify(c.ir); // Entire mutated original IR is the transport; captured wire remains in c.content.
  const admitted=E.admitSuvatCaller(c.q,c.ir,c.plan);
  const source=E.suvatCallerDocument(c.q,c.ir,c.plan);
  const api=await C.planProblemAuthorityV1(c.q,c.plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>Response.json({choices:[{message:{content}}]})});
  const selected=selectVerifiedRepresentation({question:c.q,turnPlan:c.plan,problemIR:c.ir});
  const fast=selectFastVerifiedRepresentation({question:c.q,turnPlan:c.plan,problemIR:c.ir});
  const document=source??goodDoc;
  const compiled=E.compileSceneDocument(document,{sourceAuthority:{question:c.q,problemIR:c.ir,turnPlan:c.plan}});
  const save=sceneSaveAdmissionFailure({document,question:c.q,turnPlan:c.plan,problemIR:c.ir,tier:"exact_verified"});
  const apiVerified=api&&!('status' in api)&&api.audit.status==="verified";
  if(accept){
   check(admitted.status==="ok",`${name}: complete admission (${admitted.status==="declined"?admitted.reason:admitted.status})`);
   check(apiVerified,`${name}: API verifies whole caller`);check(compiled.ok,`${name}: strict compile succeeds`);
   check(selected.tier==="exact_verified"&&selected.renderScene.primitives.length>0,`${name}: normal selector`);check(fast,`${name}: fast selector`);same(save,null,`${name}: existing pure save guard`);
   if(api&&!('status' in api))same(api.problemIR,c.ir,`${name}: whole IR retained`);
   if(admitted.status==="ok")same(admitted.source.state,c.expected,`${name}: independent full state`);
  }else{
   check(admitted.status==="declined",`${name}: complete admission refuses`);same(source,null,`${name}: no source candidate`);
   check(api&&'status' in api&&api.status==="source_declined",`${name}: API atomic refusal`);
   if(api&&'status' in api){same(api.rawContent,content,`${name}: original transport retained`);same(api.rawProblemIR,c.ir,`${name}: whole IR obligations retained`);}
   check(!compiled.ok&&!compiled.renderScene,`${name}: strict compile atomic refusal`);
   same(selected.renderScene.primitives.length,0,`${name}: zero normal marks`);same(fast,null,`${name}: fast refusal`);check(save,`${name}: pure save guard refusal`);
  }
  same(JSON.stringify(c),before,`${name}: whole question/Plan/IR/captured wire unchanged`);
  records.push({name,expected:accept?"accept":"decline",admitted:admitted.status,reason:admitted.status==="declined"?admitted.reason:null,apiStatus:api&&('status'in api?api.status:api.audit.status),compile:compiled.ok,compileIssues:compiled.report.issues,selected:selected.tier,marks:selected.renderScene.primitives.length,fast:Boolean(fast),save,failures:failed.slice(firstFailure),capturedContentSHA256:createHash('sha256').update(c.content).digest('hex')});
 }
 // Explicit semantic names on request statements and source asks cannot borrow a signed final velocity.
 const speedFact=structuredClone(finalVelocity);speedFact.ir.facts.find(row=>row.kind==="requested"&&row.statement==="find final velocity")!.statement="find final speed";
 check(E.admitSuvatCaller(speedFact.q,speedFact.ir,speedFact.plan).status==="declined","negative final-speed requested fact refuses");
 const speedQuestion=finalVelocity.q.replace("final velocity","final speed");
 check(E.readSuvatSource(speedQuestion).status==="declined","typed negative final-speed source ask refuses");
 const negativeClaim=structuredClone(original);negativeClaim.plan.qualitativeClaims.push({id:"distanceClaim",claim:"Distance equals average velocity times time under uniform acceleration.",expected:"s=-15 m",relatedQuantityIds:["s"]});
 check(E.admitSuvatCaller(negativeClaim.q,negativeClaim.ir,negativeClaim.plan).status==="declined","negative distance qualitative claim refuses intact");
 const namedId=structuredClone(original);namedId.plan.givens[0]!.id="initialspeed";namedId.plan.derived.forEach(row=>{row.dependsOn=row.dependsOn!.map(id=>id==="u"?"initialspeed":id);});
 check(E.admitSuvatCaller(namedId.q,namedId.ir,namedId.plan).status==="declined","negative speed semantic ID refuses despite neutral symbol");
 // Repeat these supplemental semantic mutations through the existing seams.
 const speedSource=structuredClone(finalVelocity);speedSource.q=speedQuestion;
 speedSource.plan.question=speedQuestion;speedSource.ir.question=speedQuestion;
 for(const fact of speedSource.ir.facts){
  if(fact.statement==="find final velocity"){fact.statement="find final speed";fact.evidence.quote="final speed";}
  const start=speedQuestion.indexOf(fact.evidence.quote);fact.evidence.start=start;fact.evidence.end=start+fact.evidence.quote.length;
 }
 const supplemental:unknown[]=[];
 for(const [name,c] of [["final-speed-requested-fact",speedFact],["final-speed-source-ask",speedSource],["negative-distance-claim",negativeClaim],["negative-speed-role-id",namedId]] as const){
  const firstFailure=failed.length,before=JSON.stringify(c),content=JSON.stringify(c.ir);
  const outcome=await C.planProblemAuthorityV1(c.q,c.plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>Response.json({choices:[{message:{content}}]})});
  check(outcome&&'status' in outcome&&outcome.status==="source_declined",`${name}: supplemental API atomic refusal`);
  if(outcome&&'status' in outcome){same(outcome.rawContent,content,`${name}: supplemental wire retained`);same(outcome.rawProblemIR,c.ir,`${name}: supplemental whole IR retained`);}
  const candidate=E.suvatCallerDocument(c===speedFact||c===speedSource?finalVelocity.q:original.q,c===speedFact||c===speedSource?finalVelocity.ir:original.ir,c===speedFact||c===speedSource?finalVelocity.plan:original.plan)!;
  const compile=E.compileSceneDocument(candidate,{sourceAuthority:{question:c.q,problemIR:c.ir,turnPlan:c.plan}});
  check(!compile.ok&&!compile.renderScene,`${name}: supplemental compile atomic refusal`);
  same(selectVerifiedRepresentation({question:c.q,turnPlan:c.plan,problemIR:c.ir}).renderScene.primitives.length,0,`${name}: supplemental zero normal marks`);
  same(selectFastVerifiedRepresentation({question:c.q,turnPlan:c.plan,problemIR:c.ir}),null,`${name}: supplemental fast refusal`);
  check(sceneSaveAdmissionFailure({document:candidate,question:c.q,turnPlan:c.plan,problemIR:c.ir,tier:"exact_verified"}),`${name}: supplemental pure save guard`);
  same(JSON.stringify(c),before,`${name}: supplemental originals unchanged`);
  supplemental.push({name,input:c,apiStatus:outcome&&'status'in outcome?outcome.status:null,compileIssues:compile.report.issues,failures:failed.slice(firstFailure)});
 }
 const result={checks,cases:records.length,failed,records,supplemental};
 if(out)writeFileSync(out,JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify(result,null,2));if(failed.length)process.exitCode=1;
}
void main();
