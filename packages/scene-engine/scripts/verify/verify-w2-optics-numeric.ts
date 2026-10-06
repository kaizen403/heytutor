import assert from "node:assert/strict";
import {opticalConjugateDocument} from "../../src/ir/opticalConjugateProgram";
import {compileSceneDocument} from "../../src/compile/compiler";
import {synthesizeFamilyScene} from "../../src/synthesize/familyScene";
import {LocalDeterministicSolverProvider} from "../../src/ir/solver";
import {verifyTurnPlanAgainstSolver} from "../../src/ir/solverAuthority";
import type {ProblemIR,ExpressionNodeIR as Node} from "../../src/ir/problemIR";
import type {TurnPlanV3} from "../../src/contracts/contractsV3";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const n=(value:number):Node=>({kind:"number",value});
const b=(operator:"+"|"-"|"*"|"/",left:Node,right:Node):Node=>({kind:"binary",operator,left,right});
async function main() {
 let checks=0;
 for (const [device,kind,expectedV,expectedM] of [["mirror","concave",-15,-.5],["mirror","convex",7.5,.25],["lens","convex",15,-.5],["lens","concave",-7.5,.25]] as const) for (const mixed of [false,true]) {
  const question=`An object is placed ${mixed?"300 mm":"30 cm"} in front of a ${kind} ${device} of focal length ${mixed?"0.1 m":"10 cm"}. Find the image distance and magnification.`;
  const setup=question.slice(0,question.indexOf("Find")),ask=question.slice(setup.length);
  const f=kind==="concave"?-10:10,u=-30;
  // Independent physical-law AST, not the binding module's factory.
  const v=b("/",b("*",n(u),n(f)),b(device==="mirror"?"-":"+",n(u),n(f)));
  const m=b("/",device==="mirror"?{kind:"unary",operator:"-",operand:v}:v,n(u));
  const problem:ProblemIR={schemaVersion:"problem-ir/v1",id:"optic",question,facts:[
   {id:"setup",kind:"given",statement:setup,evidence:{source:"question",quote:setup,start:0,end:setup.length}},
   {id:"ask",kind:"requested",statement:ask,evidence:{source:"question",quote:ask,start:setup.length,end:question.length}},
  ],entities:[{id:"sourceObject",kind:"body",label:"object",evidenceFactIds:["setup"]},{id:"sourceDevice",kind:"body",label:device,evidenceFactIds:["setup"]},{id:"sourceImage",kind:"body",label:"image",evidenceFactIds:["ask"]}],expressions:[
   {id:"eU",valueType:"scalar",root:n(mixed?300:30),evidenceFactIds:["setup"]},
   {id:"eF",valueType:"scalar",root:n(mixed?.1:10),evidenceFactIds:["setup"]},
   {id:"imageExpression",valueType:"scalar",root:v,evidenceFactIds:["setup","ask"]},
   {id:"magnificationExpression",valueType:"scalar",root:m,evidenceFactIds:["setup","ask"]},
  ],constraints:[],representationIntents:[{id:"apparatus",kind:"apparatus",entityIds:["sourceObject","sourceDevice","sourceImage"],evidenceFactIds:["setup","ask"]}],solveRequests:[
   {id:"imageResult",kind:"evaluate",expressionId:"imageExpression",resultBinding:{turnPlanQuantityId:"imageResult",symbol:"v",unit:"cm",evidenceFactIds:["ask"]}},
   {id:"magnificationResult",kind:"evaluate",expressionId:"magnificationExpression",resultBinding:{turnPlanQuantityId:"magnificationResult",symbol:"m",unit:"1",evidenceFactIds:["ask"]}},
  ]};
  const plan:TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:[],derived:[{id:"imageResult",symbol:"v",value:expectedV,unit:"cm",provenance:"derived"},{id:"magnificationResult",symbol:"m",value:expectedM,unit:"1",provenance:"derived"}],unknowns:[{id:"imageResult",symbol:"v",unit:"cm"},{id:"magnificationResult",symbol:"m",unit:"1"}],qualitativeClaims:[],assumptions:[],lawIds:[],visualRequirement:"required"};
  const concept=structuredClone(problem);concept.expressions=[];concept.solveRequests=[];
  const conceptualPlan:TurnPlanV3={...structuredClone(plan),derived:[],unknowns:[]};
  assert.ok(opticalConjugateDocument(question,conceptualPlan,concept));
  for(const list of ["givens","derived","unknowns"] as const){
   const invented=structuredClone(conceptualPlan);
   if(list==="unknowns") invented.unknowns.push({id:"inventedSpeed",symbol:"speed",unit:"m/s"});
   else invented[list].push({id:"inventedSpeed",symbol:"speed",value:999,unit:"m/s",provenance:list==="givens"?"given":"derived"});
   assert.equal(opticalConjugateDocument(question,invented,concept),null,list);
   assert.equal(synthesizeFamilyScene({question,turnPlan:invented,problemIR:concept}),null,list);checks++;
  }
  const before=structuredClone({problem,plan});
  if (process.argv[2]) {mkdirSync(process.argv[2],{recursive:true});writeFileSync(resolve(process.argv[2],`${device}-${kind}-${mixed?"mixed":"cm"}.json`),JSON.stringify({question,problem,plan,expectedV,expectedM},null,2));}
  const document=opticalConjugateDocument(question,plan,problem);assert.ok(document,`${device}/${kind}/${mixed}`);
  assert.equal(document.quantities.find(row=>row.id==="imageResult")!.value,expectedV);assert.equal(document.quantities.find(row=>row.id==="magnificationResult")!.value,expectedM);
  const compiled=compileSceneDocument(document,{sourceAuthority:{question,problemIR:problem}});assert.ok(compiled.ok,JSON.stringify(compiled.report.issues));
  assert.ok(synthesizeFamilyScene({question,turnPlan:plan,problemIR:problem}));
  const badPlan=structuredClone(plan);badPlan.unknowns[0]!.unit="m";
  assert.equal(opticalConjugateDocument(question,badPlan,problem),null);checks++;
  const solved=await new LocalDeterministicSolverProvider().solve(problem);assert.equal(verifyTurnPlanAgainstSolver(problem,solved,plan,question).status,"verified");assert.deepEqual({problem,plan},before);checks++;
  for (const defect of ["same-answer","literal-answer","unit","missing-result","given-role","extra-entity","unbound-fact","missing-entities","missing-intents","hidden-requested-fact","masked-binding-symbol","reveal"] as const) {
   const bad=structuredClone(problem),candidate=structuredClone(document);
   if (defect==="same-answer") bad.expressions[2]!.root=b("+",n(expectedV-1),n(1));
   if (defect==="literal-answer") bad.expressions[2]!.root=n(expectedV);
   if (defect==="unit") bad.solveRequests[0]!.resultBinding!.unit="V";
   if (defect==="missing-result") bad.solveRequests.pop();
   if (defect==="given-role") bad.expressions[0]!.id="eF";
   if (defect==="extra-entity") bad.entities.push({id:"otherObject",kind:"body",label:"object",evidenceFactIds:["setup"]});
   if (defect==="unbound-fact") bad.facts.push({...bad.facts[0]!,id:"orphan"});
   if (defect==="missing-entities") {bad.entities=[];bad.representationIntents=[];}
   if (defect==="missing-intents") bad.representationIntents=[];
   if (defect==="hidden-requested-fact") {const quote=`focal length ${mixed?"0.1 m":"10 cm"}`,start=question.indexOf(quote);bad.facts.push({id:"hiddenAsk",kind:"requested",statement:quote,evidence:{source:"question",quote,start,end:start+quote.length}});bad.entities[1]!.evidenceFactIds.push("hiddenAsk");}
   if (defect==="masked-binding-symbol") {bad.solveRequests[0]!.resultBinding!.turnPlanQuantityId="v";bad.solveRequests[0]!.resultBinding!.symbol="speed";}
   if (defect==="reveal") candidate.revealGroups[0]!.entityIds.pop();
   if (defect!=="reveal") assert.equal(opticalConjugateDocument(question,plan,bad),null,defect);
   assert.equal(compileSceneDocument(candidate,{sourceAuthority:{question,problemIR:bad}}).ok,false,defect);checks++;
  }
 }
 console.log(`PASS ${checks} authored complete numerical optical source/IR controls; student/native acceptance pending`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
