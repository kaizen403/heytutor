import assert from "node:assert/strict";
import * as engine from "@heytutor/scene-engine";
import {parseTurnPlanV3Content as parseSourcePlan} from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import * as built from "@heytutor/tutor-core";
import {planProblemAuthorityV1 as sourceProblem} from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import {measurementPlanningGuidance} from "../../../../packages/tutor-core/src/planners/measurementGuidance";
let checks=0;
function equal(value:unknown,expected:unknown,label:string){assert.deepEqual(value,expected,label);checks++;}
for(const [diameter,error,expected] of [[2.675,-.02,31],[2.695,0,39],[2.98,.01,98],[3,0,0]] as const){
 const question=`Least count corresponding to the main scale and circular scale of a screw gauge are 0.5 mm and 0.005 mm, respectively. A wire of diameter ${diameter} mm is measured with the screw gauge. What would be the reading of divisions on circular scale of the screw gauge, if the zero error of the screw gauge is ${error<0?error:`+${error}`} mm?`;
 const source=engine.readScrewGaugeQuestion(question);assert(source.status==="ok");
 equal(source.values.circular_reading.value,expected,"independent signed integer count oracle");
 const roles=["pitch","least_count","true_reading","zero_error","circular_reading"] as const;
 const ids=["p","LC","d","e0","ask"];
 const statements=["pitch","least count","wire diameter","zero error","circular scale divisions"];
 const facts:engine.ProblemIR["facts"]=roles.map((role,index)=>({id:ids[index]!,kind:index<4?"given":"requested",statement:statements[index]!,evidence:source.evidence[role][0]!}));
 const n=(value:number):engine.ExpressionNodeIR=>({kind:"number",value});
 const root:engine.ExpressionNodeIR={kind:"binary",operator:"/",left:{kind:"binary",operator:"-",left:{kind:"binary",operator:"+",left:n(diameter),right:n(error)},right:n(error===0&&diameter===3?3:2.5)},right:n(.005)};
 const problem:engine.ProblemIR={schemaVersion:"problem-ir/v1",id:"actualCount",question,facts,entities:[{id:"wire",kind:"body",label:"wire",evidenceFactIds:["d"]},{id:"gauge",kind:"component",label:"screw gauge",evidenceFactIds:["p","LC","e0"]}],expressions:[{id:"count",valueType:"scalar",root,evidenceFactIds:ids}],constraints:[],representationIntents:[],solveRequests:[{id:"solveCount",kind:"evaluate",expressionId:"count",resultBinding:{turnPlanQuantityId:"circular_reading",symbol:"circular_reading",unit:"division",evidenceFactIds:ids}}]};
 const plan:engine.TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:[.5,.005,diameter,error].map((value,index)=>({id:ids[index]!,symbol:ids[index]!,unit:"mm",value,sourceText:facts[index]!.evidence.quote,provenance:"given"})),unknowns:[{id:"circular_reading",symbol:"circular_reading",unit:"division"}],derived:[{id:"circular_reading",symbol:"circular_reading",unit:"division",value:expected,sourceText:facts.map(f=>f.evidence.quote).join(" | "),provenance:"derived",dependsOn:ids.slice(0,4)}],qualitativeClaims:[],lawIds:["micrometer_reading"],assumptions:[],visualRequirement:"none"};
 const mutations:[string,(value:Record<string, unknown>)=>void][]=[
 ["root",p=>p.hiddenClaim="count is 999"],
 ["fact",p=>(p.facts as Record<string,unknown>[])[0]!.hiddenClaim="count is 999"],
 ["evidence",p=>((p.facts as Record<string,unknown>[])[0]!.evidence as Record<string,unknown>).hiddenClaim="count is 999"],
 ["entity",p=>(p.entities as Record<string,unknown>[])[0]!.hiddenClaim="count is 999"],
 ["expression",p=>(p.expressions as Record<string,unknown>[])[0]!.hiddenClaim="count is 999"],
 ["AST",p=>((p.expressions as Record<string,unknown>[])[0]!.root as Record<string,unknown>).hiddenClaim="count is 999"],
 ["request",p=>(p.solveRequests as Record<string,unknown>[])[0]!.hiddenClaim="count is 999"],
 ["binding",p=>((p.solveRequests as Record<string,unknown>[])[0]!.resultBinding as Record<string,unknown>).hiddenClaim="count is 999"],
 ];
 for(const [name,mutate] of mutations){
  const bad=structuredClone(problem);mutate(bad as unknown as Record<string,unknown>);
  equal(engine.verifyMeasurementSourceAuthority(bad,plan,question).status,"declined",`${name}: whole source IR rejects unproved hidden proposition`);
  for(const [mode,api] of [["source",sourceProblem],["built",built.planProblemAuthorityV1]] as const){
   const outcome=await api(question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(bad)}}]}),{status:200})});
   assert(outcome);
   if("status" in outcome){equal(outcome.rawProblemIR,bad,`${mode}: decline retains entire raw record`);}
   else {equal(outcome.problemIR,bad,`${mode}: syntax lifting retains unknown fields for full source refusal`);equal(engine.verifyMeasurementSourceAuthority(outcome.problemIR,plan,question).status,"declined",`${mode}: no source authority after lifting`);}
  }
 }
 for(const location of ["root","given","derived","unknown","claim"]){
  const bad=structuredClone(plan) as unknown as Record<string,unknown>;
  if(location==="root")bad.hiddenClaim="count is 999";
  else if(location==="claim")bad.qualitativeClaims=[{id:"extra",claim:"circular_divisions",expected,relatedQuantityIds:["circular_reading"],hiddenClaim:"count is 999"}];
  else (bad[location==="given"?"givens":location==="derived"?"derived":"unknowns"] as Record<string,unknown>[])[0]!.hiddenClaim="count is 999";
  for(const [mode,parse] of [["source",parseSourcePlan],["built",built.parseTurnPlanV3Content]] as const){
    equal(parse(JSON.stringify(bad),question),bad,`${mode}: original count Plan fields retained before source refusal`);
  }
  equal(engine.verifyMeasurementSourceAuthority(problem,bad,question).status,"declined",`${location}: complete raw Plan rejects hidden proposition`);
 }
 let reads=0;
 const accessor=structuredClone(problem);Object.defineProperty(accessor,"hiddenClaim",{enumerable:true,get(){reads++;return "count is 999";}});
 equal(engine.verifyMeasurementSourceAuthority(accessor,plan,question).status,"declined","accessor source refused without execution");equal(reads,0,"caller accessor never executed");
 const inherited=Object.assign(Object.create({hiddenClaim:"count is 999"}),problem);
 equal(engine.verifyMeasurementSourceAuthority(inherited,plan,question).status,"declined","inherited obligations refused");
 equal(engine.verifyMeasurementSourceAuthority(problem,plan,question).status,"verified","unchanged independently computed full count source stays verified");
 const guide=measurementPlanningGuidance(question);
 equal(guide.includes('"quantityId":"circular_reading"')&&guide.includes('"least_count":"least count"')&&guide.includes("omit compact expr"),true,"both protocol identities/meaning and typed signed root supplied");
 equal(measurementPlanningGuidance(question+" Draw the screw gauge."),"","guidance requires entire scalar-only source");
}
console.log(`PASS ${checks} whole count IR/Plan fields and lossless normal API source/public controls`);
