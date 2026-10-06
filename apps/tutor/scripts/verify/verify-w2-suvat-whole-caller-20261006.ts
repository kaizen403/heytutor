import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTurnPlanV3Content, planProblemAuthorityV1, liftCompactProblemIR, collectQuestionGivens,
  refuseSourcePlan } from "@heytutor/tutor-core";
import { constantAccelerationSourceProgram, suvatCallerDocument, compileSceneDocument, admitSuvatCaller,
  suvatAstKey, type ProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectFastVerifiedRepresentation, selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/suvat-whole-caller-20261006/${name}`, import.meta.url)), "utf8");
const { question, contents } = JSON.parse(fixture("provenance.json")) as {question:string;contents:Array<{file:string;sha256ModelContent:string}>};
const wire = fixture("03-problem-ir-v1-caller.json");
const problem = liftCompactProblemIR(JSON.parse(wire), question) as ProblemIR;
let checks=0;
const check=(value:unknown,message:string) => {checks++;assert(value,message);};
const same=(actual:unknown,expected:unknown,message:string) => {checks++;assert.deepEqual(actual,expected,message);};
const api=(q:string,plan:TurnPlanV3,content:string) => planProblemAuthorityV1(q,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,
  fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content}}]}))});

async function positive(name:string,q:string,plan:TurnPlanV3,ir:ProblemIR,content:string,expected:{u:number;v:number;a:number;t:number;s:number}) {
  const before=JSON.stringify({plan,ir});
  const admitted=admitSuvatCaller(q,ir,plan);
  check(admitted.status==="ok",`${name}: whole source admission: ${admitted.status==="declined"?admitted.reason:admitted.status}`);
  const outcome=await api(q,plan,content);
  check(outcome && !("status" in outcome),`${name}: ordinary API admits complete caller`);
  assert(outcome && !("status" in outcome));
  same(outcome.audit.status,"verified",`${name}: solver verifies original bindings`);
  same(outcome.audit.bindings.length,2,`${name}: both original queries bound`);
  same(outcome.problemIR,ir,`${name}: original full IR retained`);
  const source=suvatCallerDocument(q,ir,plan);
  check(source,`${name}: source document`);assert(source);
  const compiled=compileSceneDocument(source,{sourceAuthority:{question:q,problemIR:ir,turnPlan:plan}});
  check(compiled.ok,`${name}: source compile: ${compiled.report.issues.map(issue=>issue.code).join(",")}`);
  const selected=selectVerifiedRepresentation({question:q,turnPlan:plan,problemIR:outcome.problemIR});
  check(selected.renderScene.primitives.some(mark=>mark.entityId==="graph"),`${name}: normal selector draws source graph (${selected.reason}; ${selected.validationReport.issues.map(issue=>issue.code).join(",")})`);
  same(selected.tier,"exact_verified",`${name}: source-proved tier`);
  check(selectFastVerifiedRepresentation({question:q,turnPlan:plan,problemIR:ir}),`${name}: fast selector`);
  for(const [role,value] of Object.entries(expected)){
    const quantity=selected.sceneDocument.quantities?.find(row=>row.symbol===role);
    check(quantity&&Math.abs(Number(quantity.value)-value)<1e-6,`${name}: independent ${role}=${value}`);
  }
  const prompt=buildTurnTeachingPrompt({question:q,turnPlan:plan,solverProjection:outcome.projection,
    diagramPromptAddon:"Verified source v-t graph.",codeLesson:null,isDsa:false,familiarity:"new",fastMode:false});
  check(prompt.systemPrompt.includes("SOURCE-PROVED MOTION CONDITIONS"),`${name}: real teaching prompt carries source proof`);
  check(prompt.systemPrompt.includes("constant acceleration is explicitly stated"),`${name}: uniform condition is stated`);
  check(!prompt.systemPrompt.includes("NOT STATED BY THE QUESTION"),`${name}: no stated role is demoted to assumption`);
  same(JSON.stringify({plan,ir}),before,`${name}: no caller mutations`);
  console.log(JSON.stringify({name,tier:selected.tier,marks:selected.renderScene.primitives.length,bindings:outcome.audit.bindings.map(row=>({quantityId:row.quantityId,value:row.approximate}))}));
  return source;
}

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

async function main(){
  for(const original of contents) same(createHash("sha256").update(fixture(original.file)).digest("hex"),original.sha256ModelContent,`${original.file}: frozen model content is byte-identical`);
  for(const file of ["01-turn-plan-v3-caller.json","02-turn-plan-v3-caller.json"]){
    const plan=parseTurnPlanV3Content(fixture(file),question);check(plan,"captured plan parses");assert(plan);
    await positive(file,question,plan,problem,wire,{u:20,v:0,a:-4,t:5,s:50});
    same(plan.qualitativeClaims.length,2,"both full captured claims retained");
    same(plan.assumptions.length,JSON.parse(fixture(file)).assumptions.length+1,"legacy minimum-visual note retained");
    check(collectQuestionGivens(question,plan).some(row=>row.board==="v = 0 m/s"),"rest appears in actual given opening");
  }
  for(const c of [interval("accelerating",3,15,6,2,54),interval("decelerating",18,6,3,-4,36),
    interval("negative-axis",-8,-2,3,2,-15),interval("zero-acceleration",7,7,4,0,28),
    interval("source-unit-conversion",36,72,5,2,75,"km/h",10,20)]){
    await positive(c.name,c.q,c.plan,c.ir,c.content,c.expected);
  }
  const plan=parseTurnPlanV3Content(fixture("01-turn-plan-v3-caller.json"),question)!;
  const valid=suvatCallerDocument(question,problem,plan)!;
  const controls:Array<{name:string;mutate:(p:TurnPlanV3,ir:ProblemIR)=>void}>=[
    {name:"coincident-answer-literal",mutate:(_p,ir)=>{ir.expressions[0]!.root={kind:"number",value:-4};}},
    {name:"false-formula-equal-answer",mutate:(_p,ir)=>{ir.expressions[0]!.root={kind:"binary",operator:"-",left:{kind:"number",value:0},right:{kind:"number",value:4}};}},
    {name:"foreign-actor",mutate:(_p,ir)=>{ir.entities[0]!.label="truck";}},
    {name:"extra-query",mutate:(_p,ir)=>{ir.solveRequests.push({...structuredClone(ir.solveRequests[0]!),id:"extra"});}},
    {name:"foreign-statement",mutate:(_p,ir)=>{ir.facts[0]!.statement="final speed 20 m/s";}},
    {name:"extra-statement",mutate:(_p,ir)=>{ir.facts[0]!.statement+=" and mass 20 kg";}},
    {name:"missing-uniform-condition",mutate:(_p,ir)=>{ir.facts[3]!.statement="constant force";}},
    {name:"borrowed-evidence",mutate:(_p,ir)=>{ir.expressions[0]!.evidenceFactIds=["fReqA"];}},
    {name:"wrong-unit",mutate:(p)=>{p.derived[0]!.unit="m/s";}},
    {name:"cyclical-plan-dependency",mutate:(p)=>{p.derived[0]!.dependsOn=["u","a","t"];}},
    {name:"foreign-plan-quantity",mutate:(p)=>{p.derived.push({id:"force",symbol:"F",value:50,unit:"N",provenance:"derived"});}},
    {name:"foreign-claim",mutate:(p)=>{p.qualitativeClaims[0]!.claim="Acceleration is in the direction of motion.";}},
    {name:"coincident-plan-formula",mutate:(p)=>{p.derived[0]!.sourceText="a=u/t-8=-4";}},
    {name:"coincident-later-plan-formula",mutate:(p)=>{p.derived[1]!.sourceText="s=(u+v)t/2=u*t/2=50";}},
    {name:"false-claim-formula",mutate:(p)=>{p.qualitativeClaims[1]!.expected="s=u*t/2=50 m";}},
    {name:"foreign-law",mutate:(p)=>{p.lawIds.push("F=ma");}},
    {name:"unstated-assumption-in-legacy-note",mutate:(p)=>{p.assumptions.push("A verified illustration is required by the question's spatial or explicit visual request. Friction is negligible.");}},
    {name:"equation-root-own-field",mutate:(_p,ir)=>{Object.assign(ir.expressions[0]!.root,{foreignEquation:"F=ma"});}},
    {name:"request-own-field",mutate:(_p,ir)=>{Object.assign(ir.solveRequests[0]!,{root:{kind:"number",value:-4}});}},
    {name:"extra-equation-field",mutate:(_p,ir)=>{ir.constraints.push({id:"falseEq",kind:"equation",leftExpressionId:"eA",rightExpressionId:"eA",evidenceFactIds:["fU"],...{unproved:true}});}},
  ];
  for(const control of controls){
    const p=structuredClone(plan),ir=structuredClone(problem);control.mutate(p,ir);
    const content=JSON.stringify(ir);const before=JSON.stringify({p,ir});
    if(JSON.stringify(p)!==JSON.stringify(plan)) same(parseTurnPlanV3Content(JSON.stringify(p),question),null,`${control.name}: Plan transport does not rewrite false originals`);
    check(admitSuvatCaller(question,ir,p).status==="declined",`${control.name}: full source declines`);
    const outcome=await api(question,p,content);
    check(outcome && "status" in outcome && outcome.status==="source_declined",`${control.name}: ordinary API declines`);
    assert(outcome && "status" in outcome);
    same(outcome.rawContent,content,`${control.name}: raw original retained`);
    same(outcome.rawProblemIR,ir,`${control.name}: all original IR obligations retained`);
    const compiled=compileSceneDocument(valid,{sourceAuthority:{question,problemIR:ir,turnPlan:p}});
    check(!compiled.ok&&!compiled.renderScene,`${control.name}: source compile atomically declines`);
    const selected=selectVerifiedRepresentation({question,turnPlan:p,problemIR:ir});
    same(selected.renderScene.primitives.length,0,`${control.name}: normal app has zero marks`);
    same(selectFastVerifiedRepresentation({question,turnPlan:p,problemIR:ir}),null,`${control.name}: fast app declines`);
    same(JSON.stringify({p,ir}),before,`${control.name}: originals unchanged`);
    console.log(JSON.stringify({control:control.name,issues:compiled.report.issues.map(issue=>issue.code)}));
  }
  const missing=question.replace("uniformly ","");
  same(constantAccelerationSourceProgram(missing),null,"unstated uniform acceleration cannot produce source programme");
  check(refuseSourcePlan(missing,{...plan,question:missing}),"original Plan-only boundary refuses unstated condition");
  same(selectVerifiedRepresentation({question:missing,turnPlan:{...plan,question:missing},problemIR:Object.assign(structuredClone(problem),{question:missing})}).renderScene.primitives.length,0,"unstated uniform condition cannot draw fallback");
  for(const [name,q] of [["foreign-source-premise",question.replace(". Find",", with mass 20 kg. Find")],
    ["extra-source-query",question+" Also find the force."],
    ["conflicting-rest-role",question.replace("moving at 20 m/s","with a final velocity of 20 m/s")],
    ["unbound-direction-condition",question.replace(". Find",", with initial direction taken as negative. Find")],
    ["multiple-source-intervals",question.replace(". Find"," then accelerates for 2 s. Find")],
    ["physical-reversal","A car decelerates uniformly from 8 m/s to -2 m/s in 5 s. Find its acceleration and displacement."]] as const){
    const p={...plan,question:q},ir={...problem,question:q},content=JSON.stringify(ir);
    same(constantAccelerationSourceProgram(q),null,`${name}: source programme declines`);
    const outcome=await api(q,p,content);check(outcome&&"status" in outcome&&outcome.status==="source_declined",`${name}: API refuses whole source`);
    assert(outcome&&"status" in outcome);same(outcome.rawContent,content,`${name}: original wire retained`);
    check(!compileSceneDocument(valid,{sourceAuthority:{question:q,problemIR:ir,turnPlan:p}}).ok,`${name}: compile refuses whole source`);
    same(selectVerifiedRepresentation({question:q,turnPlan:p,problemIR:ir}).renderScene.primitives.length,0,`${name}: no arbitrary fallback`);
  }
  const forged=structuredClone(valid);forged.constructions.find(row=>row.id==="make_graph")!.inputs.expression="999";
  check(!compileSceneDocument(forged,{sourceAuthority:{question,problemIR:problem,turnPlan:plan}}).ok,"false source graph rejected");
  check(!compileSceneDocument(valid).ok,"cached source proof lacks external caller authority");
  const cyclic=structuredClone(problem);Object.assign(cyclic.expressions[0]!.root,{cycle:cyclic});
  check(admitSuvatCaller(question,cyclic,plan).status==="declined","cyclical own data declined");
  let reads=0;const accessor=structuredClone(problem);Object.defineProperty(accessor.expressions[0]!.root,"value",{get(){reads++;return -4;},enumerable:true});
  check(admitSuvatCaller(question,accessor,plan).status==="declined","accessor caller declined");same(reads,0,"accessors never executed");
  const equation=structuredClone(problem);equation.expressions.push({id:"lhsA",valueType:"scalar",root:{kind:"variable",name:"a"},evidenceFactIds:["fU","fV","fT"]});
  equation.constraints.push({id:"eqA",kind:"equation",leftExpressionId:"lhsA",rightExpressionId:"eA",evidenceFactIds:["fU","fV","fT","fUniform"]});
  check(admitSuvatCaller(question,equation,plan).status==="ok","proved role equation retained");
  check(suvatAstKey(equation.expressions[0]!.root)!==suvatAstKey({kind:"number",value:-4}),"answer equality is not source formula identity");
  console.log(`W2 SUVAT whole caller: ${checks} checks passed (2 captured plans, 5 independent intervals, ${controls.length} complete failure controls)`);
}
void main();
