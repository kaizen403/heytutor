import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseTurnPlanV3Content,normalizeProblemIRModelOutput,bindProblemIRToTurnPlan,planProblemAuthorityV1} from "@heytutor/tutor-core";
import {validateProblemIR,readStatedCircuitProblemSource,bindStatedCircuitProblem,applySourceQuantityAuthority,compileSceneDocument,type TurnPlanV3,type ProblemIR} from "@heytutor/scene-engine";
import {selectVerifiedRepresentation} from "../../../../apps/tutor/features/tutor-session/lib/scene/representationFallback";
let checks=0;function check(x:unknown,label:string):asserts x{checks++;assert.ok(x,label);}
const cap=JSON.parse(readFileSync(new URL("./fixtures/w2-ohm-whole-caller-20261006/actual-1618.original.json",import.meta.url),"utf8")) as {question:string;planContents:string[];problemContent:string};
const api=async(question:string,plan:TurnPlanV3,content:string)=>planProblemAuthorityV1(question,plan,{proxyUrl:"http://offline.invalid",timeoutMs:2000,fetchImpl:async()=>Response.json({choices:[{message:{content}}]})});
const lift=(question:string,plan:TurnPlanV3,raw:unknown):ProblemIR=>{const v=validateProblemIR(normalizeProblemIRModelOutput(raw,question,plan),question);check(v.valid&&v.problem,"ordinary whole compact syntax");return bindProblemIRToTurnPlan(v.problem,plan);};
async function positive(question:string,plan:TurnPlanV3,raw:unknown,expected:number){
 const problem=lift(question,plan,raw),before=JSON.stringify({plan,problem,raw});
 const source=readStatedCircuitProblemSource(question);check(source,"entire source circuit binds");check(source.solution.sourceCurrent?.value===expected,"independent current oracle");
 const binding=bindStatedCircuitProblem(question,problem);check(binding,"all original IR obligations bind");check(binding.problem===problem,"original IR reference retained");
 check(binding.factBindings.length===problem.facts.length&&binding.entityBindings.length===problem.entities.length&&binding.expressionBindings.length===problem.expressions.length,"all original facts, actors and expressions retained");
 check(compileSceneDocument(binding.document,{sourceAuthority:{question,problemIR:problem,turnPlan:plan}}).ok,"whole normal source compile");
 const result=await api(question,plan,JSON.stringify(raw));check(result&&!("status"in result),"normal API accepts complete original wire");if(!result||"status"in result)throw Error("declined positive");check(result.audit.status==="verified"&&result.audit.bindings.length===1,"original result binding independently audited");assert.deepEqual(result.problemIR,problem);checks++;
 const selected=selectVerifiedRepresentation({question,turnPlan:plan,problemIR:problem});check(selected.sceneDocument.visualDecision.mode==="scene"&&selected.family==="circuit_network"&&selected.renderScene.primitives.length===14,"normal app full circuit body and current annotation");
 const authority=applySourceQuantityAuthority(plan,problem,question);check(!authority.outcomes.some(x=>x.declineFigure),"normal registry accepts");assert.deepEqual(authority.plan,plan);checks++;
 check(JSON.stringify({plan,problem,raw})===before,"original complete callers immutable");return{problem,document:binding.document};
}
for(const content of cap.planContents){const plan=parseTurnPlanV3Content(content,cap.question);check(plan,"original actual Plan syntax");const raw=JSON.parse(cap.problemContent);await positive(cap.question,plan,raw,2);}
// Independent full-wire parameter/ordering/lexical controls, each with an exact oracle.
for(const row of [{v:26,r:13,answer:2,batteryFirst:true,article:false},{v:9,r:6,answer:1.5,batteryFirst:false,article:true},{v:15,r:5,answer:3,batteryFirst:true,article:true},{v:4.5,r:3,answer:1.5,batteryFirst:false,article:false}]){
 const question=row.batteryFirst?`A ${row.v} V battery is connected across a ${row.r} Ω resistor. Find the current through ${row.article?"the ":""}resistor.`:`A ${row.r} Ω resistor is connected across a ${row.v} V battery. Find the current through ${row.article?"the ":""}resistor.`;
 const original=JSON.parse(cap.planContents[1]!),plan={...original,question} as TurnPlanV3;
 plan.givens[0]!.value=row.v;plan.givens[0]!.sourceText=`${row.v} V battery`;plan.givens[1]!.value=row.r;plan.givens[1]!.sourceText=`${row.r} Ω resistor`;plan.derived[0]!.value=row.answer;plan.derived[0]!.sourceText=`I = V/R = ${row.v}/${row.r} = ${row.answer}`;plan.qualitativeClaims[0]!.expected=`I = V/R = ${row.answer} A`;
 const raw=JSON.parse(cap.problemContent);raw.facts[0].statement=`battery voltage is ${row.v} V`;raw.facts[0].quote=`${row.v} V battery`;raw.facts[1].statement=`resistor resistance is ${row.r} Ω`;raw.facts[1].quote=`${row.r} Ω resistor`;raw.facts[2].quote=question.slice(question.indexOf("Find"));raw.expressions[0].expr=`${row.v}/${row.r}`;
 const {problem,document}=await positive(question,plan,raw,row.answer);
 for(const mutate of [(p:ProblemIR)=>{p.facts[2]!.statement="find current through resistor and force";},(p:ProblemIR)=>{p.facts[2]!.statement="find current through capacitor";},(p:ProblemIR)=>{p.facts[2]!.statement="find current through second resistor";},(p:ProblemIR)=>{p.solveRequests[0]!.resultBinding!.unit="V";},(p:ProblemIR)=>{p.entities[1]!.evidenceFactIds=["fV"];},(p:ProblemIR)=>{p.expressions[0]!.root={kind:"number",value:row.answer};}]){
  const bad=structuredClone(problem);mutate(bad);const before=JSON.stringify({bad,plan});check(!bindStatedCircuitProblem(question,bad),"wrong whole requested proposition/owner/unit/formulation declines");check(!compileSceneDocument(document,{sourceAuthority:{question,problemIR:bad,turnPlan:plan}}).ok,"bad original full IR cannot borrow correct scene");const refused=applySourceQuantityAuthority(plan,bad,question);check(refused.outcomes.some(x=>x.declineFigure),"registry declines");assert.deepEqual(refused.plan,plan);checks++;
  const result=await api(question,plan,JSON.stringify(bad));check(result&&"status"in result&&result.status==="source_declined","ordinary API refuses complete bad IR");check(selectVerifiedRepresentation({question,turnPlan:plan,problemIR:bad}).renderScene.primitives.length===0,"bad full caller terminal at normal app");check(JSON.stringify({bad,plan})===before,"refused original callers immutable");
 }
}
console.log(`ohm article/full-caller gate: ${checks} checks passed; offline only, no lifecycle or READY`);
