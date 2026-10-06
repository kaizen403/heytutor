import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {selectVerifiedRepresentation} from "../../../../apps/tutor/features/tutor-session/lib/scene/representationFallback";
import {buildTurnTeachingPrompt} from "../../../../apps/tutor/features/tutor-session/lib/turn/turnTeachingPrompt";
import {circleCallerIssues,circlePlanSourceIssues,applySourceQuantityAuthority,readCircleSourceProgram,bindCircleSourceProblem,validateProblemIR,validateTurnPlanV3,compileSceneDocument,type ExpressionNodeIR,type ProblemIR,type TurnPlanV3} from "@heytutor/scene-engine";
import {questionStatesPlanGiven,buildGivenValueSegments,parseTurnPlanV3Content,planProblemAuthorityV1} from "@heytutor/tutor-core";
let checks=0;function check(v:unknown,label:string):asserts v{checks++;assert.ok(v,label);}
const n=(value:number):ExpressionNodeIR=>({kind:"number",value});
const b=(operator:"+"|"-"|"*"|"/"|"^",left:ExpressionNodeIR,right:ExpressionNodeIR):ExpressionNodeIR=>({kind:"binary",operator,left,right});
const negative=(operand:ExpressionNodeIR):ExpressionNodeIR=>({kind:"unary",operator:"-",operand});
// Independent whole caller oracles; these constants are not obtained from planning data.
const cases=[
 {equation:"x^2+y^2-6x+4y-12=0",A:1,D:-6,E:4,F:-12,h:3,k:-2,r:5},
 {equation:"2x^2+2y^2+4x-8y-8=0",A:2,D:4,E:-8,F:-8,h:-1,k:2,r:3},
 {equation:"0.5x^2+0.5y^2-1.5x+2y-0.375=0",A:.5,D:-1.5,E:2,F:-.375,h:1.5,k:-2,r:Math.sqrt(7)},
 {equation:"(x-1)^2+(y+2)^2=25",A:1,D:-2,E:4,F:-20,h:1,k:-2,r:5},
];
for(const row of cases){
 const question=`For ${row.equation}, find the centre and radius.`;
 const request="find the centre and radius.";
 const span=(quote:string)=>({source:"question" as const,start:question.indexOf(quote),end:question.indexOf(quote)+quote.length,quote});
 const h=b("/",negative(n(row.D)),b("*",n(2),n(row.A))),k=b("/",negative(n(row.E)),b("*",n(2),n(row.A)));
 const radius:ExpressionNodeIR={kind:"call",function:"sqrt",argument:b("-",b("+",b("^",h,n(2)),b("^",k,n(2))),b("/",n(row.F),n(row.A)))};
 const roots={h,k,r:radius};const values={h:row.h,k:row.k,r:row.r};
 const problem:ProblemIR={schemaVersion:"problem-ir/v1",id:"circle",question,facts:[{id:"equation",kind:"given",statement:row.equation,evidence:span(row.equation)},{id:"ask",kind:"requested",statement:request,evidence:span(request)}],entities:[{id:"locus",kind:"curve",label:"circle",evidenceFactIds:["equation"]}],expressions:Object.entries(roots).map(([id,root])=>({id,valueType:"scalar",root,evidenceFactIds:["equation","ask"]})),constraints:[],representationIntents:[{id:"graph",kind:"graph",entityIds:["locus"],evidenceFactIds:["equation","ask"]}],solveRequests:Object.keys(roots).map(id=>({id:`solve_${id}`,kind:"evaluate",expressionId:id,resultBinding:{turnPlanQuantityId:id,symbol:id,unit:"1",evidenceFactIds:["equation","ask"]}}))};
 const statements={A:"coefficient of x^2 and y^2",D:"coefficient of x",E:"coefficient of y",F:"constant term"};
 const plan:TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:Object.entries(statements).map(([id,sourceText])=>({id,symbol:id,unit:"1",value:row[id as keyof typeof statements],provenance:"given",sourceText})),unknowns:Object.keys(roots).map(id=>({id,symbol:id,unit:"1"})),derived:Object.entries(values).map(([id,value])=>({id,symbol:id,unit:"1",value,provenance:"derived",dependsOn:id==="h"?["A","D"]:id==="k"?["A","E"]:["A","D","E","F"]})),qualitativeClaims:[],lawIds:[],assumptions:[],visualRequirement:"required"};
 const before=JSON.stringify({problem,plan});const parsedPlan=parseTurnPlanV3Content(JSON.stringify(plan),question);assert.deepEqual(parsedPlan,plan);checks++;check(questionStatesPlanGiven(question,plan,"A",row.A),"complete source coefficient proof owns its implicit numeric value");check(buildGivenValueSegments(question,plan,{maxWidth:1000}).some(v=>v.command?.text?.includes(`A = ${row.A}`)),"source coefficient remains a stated intro given, not an invented example");check(validateProblemIR(problem,question).valid,"independent full IR valid");check(validateTurnPlanV3(plan,question).valid,"independent full Plan valid");
 const read=readCircleSourceProgram(question);check(read.status==="ok","leading For supported closed grammar");if(read.status!=="ok")throw Error("not read");assert.deepEqual([read.source.center.x,read.source.center.y,read.source.radius],[row.h,row.k,row.r]);checks++;
 const bound=bindCircleSourceProblem(question,problem);check(bound,"whole independent numeric requests source bind");if(!bound)throw Error("not bound");check(bound.problem===problem&&bound.requestBindings.length===3,"original graph retained all three requests");check(circleCallerIssues(question,problem,plan).length===0,"original whole caller passes independent admission");const compiled=compileSceneDocument(bound.document,{sourceAuthority:{question,problemIR:problem,turnPlan:plan}});check(compiled.ok&&compiled.renderScene,"existing operators compile complete source");
 let messages:Array<{content:string}>=[];
 const result=await planProblemAuthorityV1(question,plan,{proxyUrl:"http://offline.invalid/api/chat",timeoutMs:2000,fetchImpl:async(_input,init)=>{messages=JSON.parse(String(init?.body)).messages;return Response.json({choices:[{message:{content:JSON.stringify(problem)}}]});}});
 check(result&&!("status" in result),"ordinary API admits original complete numeric IR");if(!result||"status"in result)throw Error("API declined");check(result.audit.status==="verified"&&result.audit.bindings.length===3,"ordinary full Plan numeric audit verified");assert.deepEqual(result.problemIR,problem);checks++;const selected=selectVerifiedRepresentation({question,turnPlan:plan,problemIR:problem});check(selected.sceneDocument.visualDecision.mode==="scene"&&selected.family==="coordinate_figure","normal app selector retains the complete circle source figure");const teaching=buildTurnTeachingPrompt({question,turnPlan:plan,solverProjection:result.projection,diagramPromptAddon:null,codeLesson:null,isDsa:false,familiarity:"normal",fastMode:false});check(!teaching.systemPrompt.includes("NOT STATED BY THE QUESTION:"),"implicit source coefficients do not become invented examples in actual shared teaching context");check(JSON.stringify({problem,plan})===before,"input Plan and IR unchanged");
 const prompt=messages[0]!.content;check(prompt.includes("CARTESIAN LOCUS SOURCE OPERATOR DATA")&&prompt.includes("omit compact expr"),"normal API receives operator guidance");const data=JSON.parse(prompt.split("CARTESIAN LOCUS SOURCE OPERATOR DATA\n")[1]!.split("\n")[0]!);check(data.question===question,"question copied unchanged in planning data");assert.deepEqual(data.requestedResults.map((v:{symbol:string;root:ExpressionNodeIR})=>[v.symbol,v.root]),Object.entries(roots));checks++;
 for(const mutate of [
  (p:TurnPlanV3)=>{p.qualitativeClaims.push({id:"foreign",claim:"force is 999 N",expected:true});},
  (p:TurnPlanV3)=>{p.lawIds.push("force999");},
  (p:TurnPlanV3)=>{p.assumptions.push("The circle has zero radius");},
  (p:TurnPlanV3)=>{p.teachingSequenceHints=["centre is (999,999)"];},
  (p:TurnPlanV3)=>{p.givens[3]!.sourceText="constant term; force999N";},
  (p:TurnPlanV3)=>{p.derived[0]!.sourceText="Train travels at 999 m/s";},
  (p:TurnPlanV3)=>{p.derived[0]!.dependsOn=[];},
  (p:TurnPlanV3)=>{p.derived[0]!.dependsOn=["A","E"];},
  (p:TurnPlanV3)=>{p.derived[0]!.dependsOn=["k"];p.derived[1]!.dependsOn=["h"];},
  (p:TurnPlanV3)=>{p.derived[0]!.value=999;},
  (p:TurnPlanV3)=>{p.unknowns[0]!.symbol="force";},
  (p:TurnPlanV3)=>{p.derived[0]!.uncertainty=1;},
  (p:TurnPlanV3)=>{p.givens[0]!.sign="negative";},
  (p:TurnPlanV3)=>{p.derived.pop();p.unknowns.pop();},
 ]){const p=structuredClone(plan);mutate(p);const before=JSON.stringify(p);check(circlePlanSourceIssues(question,p).length>0,"unsupported whole Plan proposition/graph declines");check(circleCallerIssues(question,problem,p).length>0,"whole caller declines altered original Plan");check(!compileSceneDocument(bound.document,{sourceAuthority:{question,problemIR:problem,turnPlan:p}}).ok,"public caller compile cannot pair altered Plan with correct circle");const a=applySourceQuantityAuthority(p,problem,question);check(a.outcomes.some(v=>v.declineFigure)&&JSON.stringify(a.plan)===before,"source reconciliation retains full refused Plan instead of pruning it");const out=await planProblemAuthorityV1(question,p,{proxyUrl:"http://offline.invalid/api/chat",timeoutMs:2000,fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(problem)}}]})});check(out&&"status"in out&&out.status==="source_declined"&&JSON.stringify(out.rawTurnPlan)===before,"ordinary API returns original rejected Plan evidence");}
 for(const mutate of [(p:ProblemIR)=>{p.solveRequests.pop();},(p:ProblemIR)=>{p.solveRequests[0]!.resultBinding!.turnPlanQuantityId="k";},(p:ProblemIR)=>{p.entities[0]!.label="ball";},(p:ProblemIR)=>{(p as unknown as Record<string,unknown>).foreignForce=999;},(p:ProblemIR)=>{p.facts.push({id:"badcoef",kind:"given",statement:"constant term; force999N",evidence:span(row.equation)});}]){const p=structuredClone(problem);mutate(p);check(circleCallerIssues(question,p,plan).length>0,"extra/missing original IR semantic obligation declines");check(!compileSceneDocument(bound.document,{sourceAuthority:{question,problemIR:p,turnPlan:plan}}).ok,"source compile rejects incomplete or conflicting original IR");const out=await planProblemAuthorityV1(question,plan,{proxyUrl:"http://offline.invalid/api/chat",timeoutMs:2000,fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(p)}}]})});check(out&&"status"in out&&out.status==="source_declined"&&JSON.stringify(out.rawProblemIR)===JSON.stringify(p),"ordinary API retains full original refused IR");}
 for(const mutation of [ (p:ProblemIR)=>{p.expressions[0]!.root=n(999);},(p:ProblemIR)=>{p.solveRequests[0]!.resultBinding!.symbol="force";},(p:ProblemIR)=>{p.entities[0]!.label="ball";},(p:ProblemIR)=>{p.facts[0]!.statement="force is 999 N";},(p:ProblemIR)=>{p.solveRequests.push({id:"foreign",kind:"evaluate",expressionId:"h",resultBinding:{turnPlanQuantityId:"z",symbol:"z",unit:"N",evidenceFactIds:["ask"]}});},(p:ProblemIR)=>{p.constraints.push({id:"foreign",kind:"parallel",entityIds:["locus"],evidenceFactIds:["equation"]});}]){const p=structuredClone(problem);mutation(p);check(!bindCircleSourceProblem(question,p),"unsupported whole original obligation declines");}
 for(const bad of [123,null,{},["coefficient of x"],false]){const p=structuredClone(plan);(p.givens[0] as unknown as Record<string,unknown>).sourceText=bad;check(circlePlanSourceIssues(question,p).length>0,"malformed original role text returns refusal without throwing");}
 const foreign=structuredClone(plan);(foreign as unknown as Record<string,unknown>).foreignForce=999;const parsedForeign=parseTurnPlanV3Content(JSON.stringify(foreign),question);check(parsedForeign&&Object.hasOwn(parsedForeign,"foreignForce"),"source parser never erases an original unknown field");check(circlePlanSourceIssues(question,parsedForeign).length>0,"preserved original unknown field refuses");
}
for(const q of ["For x^2+y^2=25, find the centre and radius and take force as 999 N.","For x^2+y^2=25 and the line y=2x, find the centre and radius.","For x^2+y^2=25, find the centre and radius for a moving ball.","For x^2+y^2=-1, find the centre and radius.","For x^2+y^2=25, find the centre and radius with a tangent."])check(readCircleSourceProgram(q).status==="declined","leading header does not waive unknown whole clause");
check(readCircleSourceProgram("A train moves at 20 m/s.").status==="none","unrelated source unchanged");
// Frozen independent review inputs are unchanged complete callers, not new
// generated surrogates. The source-only carried S3 has no numeric authority.
for(const name of ["zeroed-source-coefficients.original.json","inexact-source-coefficient.original.json"]){
 const caller=JSON.parse(readFileSync(new URL(`./fixtures/circle-full-review-20261006/${name}`,import.meta.url),"utf8"));
 const before=JSON.stringify(caller);
 check(circlePlanSourceIssues(caller.question,caller.plan).length>0,"independent wrong literal coefficients refuse");
 check(circleCallerIssues(caller.question,caller.problem,caller.plan).length>0,"full correct IR cannot lend false Plan coefficients authority");
 const bound=bindCircleSourceProblem(caller.question,caller.problem);check(bound,"original independent IR source still binds");
 if(!bound)throw Error("frozen valid IR failed");
 check(!compileSceneDocument(bound.document,{sourceAuthority:{question:caller.question,problemIR:caller.problem,turnPlan:caller.plan}}).ok,"unsafe original coefficient caller cannot compile");
 const api=await planProblemAuthorityV1(caller.question,caller.plan,{proxyUrl:"http://offline.invalid",timeoutMs:2000,fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(caller.problem)}}]})});
 check(api&&"status"in api&&api.status==="source_declined"&&JSON.stringify(api.rawTurnPlan)===JSON.stringify(caller.plan),"unsafe coefficient API retains full original Plan");
 const selected=selectVerifiedRepresentation({question:caller.question,turnPlan:caller.plan,problemIR:caller.problem});check(selected.renderScene.primitives.length===0,"unsafe coefficients cannot regain normal figure authority");
 const reconciled=applySourceQuantityAuthority(caller.plan,caller.problem,caller.question);check(reconciled.outcomes.some(row=>row.declineFigure)&&JSON.stringify(reconciled.plan)===JSON.stringify(caller.plan),"refused original rows never enter legacy pruning");
 check(JSON.stringify(caller)===before,"independent original counterexample immutable");
}
for(const name of ["ir-functionResult.original.json","ir-wrongFactKind.original.json"]){
 const caller=JSON.parse(readFileSync(new URL(`./fixtures/circle-full-review-20261006/${name}`,import.meta.url),"utf8"));
 const before=JSON.stringify(caller);check(circleCallerIssues(caller.question,caller.problem,caller.plan).length>0,"numeric function outputs and definition-as-request cannot borrow scalar source authority");
 check(!bindCircleSourceProblem(caller.question,caller.problem),"complete wrong original IR refuses source binding");
 const api=await planProblemAuthorityV1(caller.question,caller.plan,{proxyUrl:"http://offline.invalid",timeoutMs:2000,fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(caller.problem)}}]})});
 check(api&&"status"in api&&api.status==="source_declined"&&JSON.stringify(api.rawProblemIR)===JSON.stringify(caller.problem),"ordinary API refuses and retains complete original IR");
 check(selectVerifiedRepresentation({question:caller.question,turnPlan:caller.plan,problemIR:caller.problem}).renderScene.primitives.length===0,"wrong original IR cannot regain figure authority");
 check(JSON.stringify(applySourceQuantityAuthority(caller.plan,caller.problem,caller.question).plan)===JSON.stringify(caller.plan),"wrong original IR never prunes caller Plan");
 check(JSON.stringify(caller)===before,"original independent IR mutation unchanged");
}
const carried=JSON.parse(readFileSync(new URL("./fixtures/circle-full-review-20261006/actual-carry-standard-s3.original.json",import.meta.url),"utf8"));
const carryBefore=JSON.stringify(carried);
check(circleCallerIssues(carried.question,carried.problem,carried.plan).length===0,"source-proved carried whole S3 retains original empty Plan/null IR");
const carrySelected=selectVerifiedRepresentation({question:carried.question,turnPlan:carried.plan,problemIR:carried.problem});
check(carrySelected.sceneDocument.visualDecision.mode==="scene"&&carrySelected.renderScene.primitives.length===6,"actual unchanged standard S3 source circle and point survive");
check(applySourceQuantityAuthority(carried.plan,carried.problem,carried.question).plan===carried.plan,"admitted carried source caller never rewritten");
check(JSON.stringify(carried)===carryBefore,"whole carried caller immutable");
for(const alteration of [(p:TurnPlanV3)=>p.assumptions.push("The point is outside the circle"),(p:TurnPlanV3)=>p.lawIds.push("gravity"),(p:TurnPlanV3)=>p.qualitativeClaims.push({id:"outside",claim:"point outside",expected:true}),(p:TurnPlanV3)=>p.unknowns.push({id:"force",symbol:"force",unit:"N"})]){
 const p=structuredClone(carried.plan);alteration(p);check(circleCallerIssues(carried.question,null,p).length>0,"source-only compatibility cannot lend unproved propositions authority");check(selectVerifiedRepresentation({question:carried.question,turnPlan:p,problemIR:null}).renderScene.primitives.length===0,"source-only unsafe additions remain terminal");
}
for(const question of ["For 4x^2+4y^2-16x+8y=80, find the centre and radius; and the equation.","For 4x^2+4y^2-16x+8y=80, find the centre and radius. And the coordinates of point T(7,-1).","For 4x^2+4y^2-16x+8y=80, find the radius. Equivalently the equation."]){check(readCircleSourceProgram(question).status==="declined","punctuation cannot hide a residual numeric query");}
// Fresh Kepler full-query/typed-request findings, unchanged original callers.
for(const name of ["query-radius-and-radius-squared-omitted.new-original.json","query-extra-equation-ask.new-original.json","query-extra-point-coordinates-complete-actors.new-original.json","ir-query-wrong-role-full-quote.new-original.json"]){
 const c=JSON.parse(readFileSync(new URL(`./fixtures/circle-full-review-20261006/${name}`,import.meta.url),"utf8")),before=JSON.stringify(c);
 check(circleCallerIssues(c.question,c.problem,c.plan).length>0,"whole query/request original caller must decline");
 const source=readCircleSourceProgram(c.question),bound=bindCircleSourceProblem(c.question,c.problem);
 if(bound)check(!compileSceneDocument(bound.document,{sourceAuthority:{question:c.question,problemIR:c.problem,turnPlan:c.plan}}).ok,"omitted query cannot lend compile authority");
 const result=await planProblemAuthorityV1(c.question,c.plan,{proxyUrl:"http://offline.invalid",timeoutMs:2000,fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(c.problem)}}]})});
 check(result&&"status"in result&&result.status==="source_declined","ordinary API declines unsupported full query/request");
 check(selectVerifiedRepresentation({question:c.question,turnPlan:c.plan,problemIR:c.problem}).renderScene.primitives.length===0,"whole query/request refusal remains terminal");
 const registry=applySourceQuantityAuthority(c.plan,c.problem,c.question);check(registry.outcomes.some(x=>x.declineFigure)&&JSON.stringify(registry.plan)===JSON.stringify(c.plan),"whole refused original Plan remains unchanged");
 check(JSON.stringify(c)===before,"fresh full-query original evidence remains unchanged");
 if(name.includes("extra-"))check(source.status==="declined","unsupported extra source request declines whole programme");
}
const completeQuery=JSON.parse(readFileSync(new URL("./fixtures/circle-full-review-20261006/query-radius-and-radius-squared-complete.new-original.json",import.meta.url),"utf8"));
const queryRead=readCircleSourceProgram(completeQuery.question);check(queryRead.status==="ok"&&queryRead.source.asks.includes("radius")&&queryRead.source.asks.includes("radius_squared"),"radius and radius squared are two distinct whole-source requests");
check(circleCallerIssues(completeQuery.question,completeQuery.problem,completeQuery.plan).length===0,"unchanged paired complete two-result caller survives");
const queryResult=await planProblemAuthorityV1(completeQuery.question,completeQuery.plan,{proxyUrl:"http://offline.invalid",timeoutMs:2000,fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(completeQuery.problem)}}]})});
check(queryResult&&!("status"in queryResult)&&queryResult.audit.status==="verified"&&queryResult.audit.bindings.length===2,"normal API verifies both whole original output requests");
check(selectVerifiedRepresentation({question:completeQuery.question,turnPlan:completeQuery.plan,problemIR:completeQuery.problem}).renderScene.primitives.length>0,"normal app complete radius/radius-squared source figure survives");
console.log(`circle source planning guidance: ${checks} checks passed; offline only`);
