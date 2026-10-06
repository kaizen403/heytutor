import assert from "node:assert/strict";
import * as engine from "@heytutor/scene-engine";
import * as built from "@heytutor/tutor-core";
import {inferSceneCapabilities as sourceCapabilities} from "../../../../packages/tutor-core/src/planners/sceneCapabilities";
import {questionRequiresVisual as sourceRequiresVisual} from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
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
 for(const [mode,capabilities,requires,api] of [["source",sourceCapabilities,sourceRequiresVisual,sourceProblem],["built",built.inferSceneCapabilities,built.questionRequiresVisual,built.planProblemAuthorityV1]] as const){
  equal([capabilities(question,{turnPlan:plan}).families,capabilities(question,{turnPlan:plan}).hasSourceProgram,requires(question)],[[],false,false],`${mode}: complete scalar profile does not invent apparatus geometry`);
  equal(capabilities(question,{turnPlan:{...plan,visualRequirement:"required"}}).visualRequired,true,`${mode}: explicitly requested model visual still unsupported, not silently overridden`);
  equal(requires(question+" Draw the screw gauge."),true,`${mode}: extra figure ask not consumed by scalar profile`);
  const outcome=await api(question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(problem)}}]}),{status:200})});
  assert(outcome&&!("status" in outcome));
  equal(outcome.problemIR,problem,`${mode}: normal typed full caller IR unchanged`);
  const sourceAuthority=engine.applySourceQuantityAuthority(plan,outcome.problemIR,question);
  equal(sourceAuthority.plan.derived[0]?.value,expected,`${mode}: complete source proof accepts signed count`);
  equal(sourceAuthority.outcomes.find(row=>row.topic==="measurement-source")?.declineFigure,false,`${mode}: numeric count accepted without apparatus permission`);
  const bad=structuredClone(plan);bad.derived[0]!.sourceText+=" | observed = 999 mm";
  equal(engine.verifyMeasurementSourceAuthority(problem,bad,question).status,"declined",`${mode}: appended unsupported text stays rejected`);
 }
 const guide=measurementPlanningGuidance(question);
 equal(guide.includes('"quantityId":"circular_reading"')&&guide.includes('"least_count":"least count"')&&guide.includes("omit compact expr"),true,"both protocol identities/meaning and typed signed root supplied");
 equal(measurementPlanningGuidance(question+" Draw the screw gauge."),"","guidance requires entire scalar-only source");
}
console.log(`PASS ${checks} complete scalar count visual classification, signed whole-IR/Plan and source/public ESM controls; apparatus unsupported`);
