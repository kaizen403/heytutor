import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import * as source from "../../src/index";
import type { ProblemIR, TurnPlanV3, SceneDocument } from "../../src/index";
const api:typeof source=process.argv.includes("--built")?await import("../../dist/index.js"):source;
const fixture=JSON.parse(readFileSync(new URL("./fixtures/point-line-full-caller-20261006.json",import.meta.url),"utf8")) as {problem:ProblemIR;plans:TurnPlanV3[]};
let checks=0;
const receipts:unknown[]=[];
function check(value:unknown,message:string):asserts value{checks++;assert.ok(value,message);}
function positive(name:string,problem:ProblemIR,plan:TurnPlanV3,expected:{d:number;foot:[number,number]}){
  const before=JSON.stringify({problem,plan});
  check(api.pointLineCallerIssues(problem.question,problem,plan).length===0,`${name}: complete caller audit`);
  const doc=api.pointLineSourceDocument(problem.question,problem);check(doc,`${name}: full source document`);
  const result=api.compileSceneDocument(doc,{sourceAuthority:{question:problem.question,problemIR:problem,turnPlan:plan}});
  check(result.ok && result.renderScene,`${name}: atomic compile ${JSON.stringify(result.report)}`);
  check(api.visualObligationIssues(problem,doc,plan).length===0,`${name}: every original obligation`);
  const projection=api.readPointLineProgram(problem.question);check(projection.status==="ok",`${name}: complete source`);
  check(Math.abs(projection.distance-expected.d)<1e-12,`${name}: independent distance`);
  check(Math.abs(projection.foot.x-expected.foot[0])<1e-12 && Math.abs(projection.foot.y-expected.foot[1])<1e-12,`${name}: independent foot`);
  check(result.renderScene.primitives.some(p=>p.kind==="label" && p.text===problem.entities[2]!.label),`${name}: actual foot label ink`);
  check(JSON.stringify({problem,plan})===before,`${name}: original records unchanged`);
  const family=api.synthesizeFamilyScene({question:problem.question,turnPlan:plan,problemIR:problem});check(family?.tier==="exact_verified",`${name}: normal family`);
  receipts.push({name,expected,problem,plan,document:doc,scene:result.renderScene});return doc;
}
const oracle={d:1.2,foot:[.28,1.04] as [number,number]};
for(const [index,plan] of fixture.plans.entries())positive(`capture-${index+1}`,structuredClone(fixture.problem),structuredClone(plan),oracle);
function reject(name:string,edit:(p:ProblemIR,t:TurnPlanV3)=>void){
  const problem=structuredClone(fixture.problem),plan=structuredClone(fixture.plans[1]!);edit(problem,plan);
  const doc=api.pointLineSourceDocument(fixture.problem.question,fixture.problem)!;
  const result=api.compileSceneDocument(doc,{sourceAuthority:{question:fixture.problem.question,problemIR:problem,turnPlan:plan}});
  check(!result.ok && result.renderScene===null,`${name}: atomic caller rejection`);
  check(api.synthesizeFamilyScene({question:fixture.problem.question,problemIR:problem,turnPlan:plan})===null,`${name}: no replacement family`);
  receipts.push({name,rejected:true,issues:result.report.issues});
}
reject("copied-wrong-oracle",(p,t)=>{t.derived.find(r=>r.id==="d")!.value=2;t.derived.find(r=>r.id==="fx")!.value=-.2;t.derived.find(r=>r.id==="fy")!.value=.4;});
reject("wrong-distance-AST",p=>{p.expressions[0]!.root={kind:"number",value:2};});
reject("equal-valued-unrelated-AST",p=>{p.expressions[0]!.root={kind:"binary",operator:"+",left:{kind:"number",value:1},right:{kind:"number",value:.2}};});
reject("wrong-foot-AST",p=>{p.expressions[1]!.root={kind:"number",value:-.2};});
reject("unused-expression",p=>{p.expressions.push({id:"extra",root:{kind:"number",value:1},valueType:"scalar",evidenceFactIds:["fPoint"]});});
reject("extra-unit",(p,t)=>{p.solveRequests[0]!.resultBinding!.unit="m";t.unknowns[0]!.unit="m";t.derived.find(r=>r.id==="d")!.unit="m";});
reject("unit-role-conflict",p=>{p.solveRequests[0]!.resultBinding!.unit="1";});
reject("wrong-given-sign",(_p,t)=>{t.givens[0]!.sign="negative";});
reject("claim-result-role",(_p,t)=>{t.qualitativeClaims[1]!.relatedQuantityIds=["d"];});
reject("physical-given-unit",(_p,t)=>{t.givens[0]!.unit="m";});
reject("extra-raw-unit-field",p=>{Object.assign(p.expressions[0]!,{unit:"m"});});
reject("unbound-evidence",p=>{p.expressions[0]!.evidenceFactIds=["fDist"];});
reject("bad-evidence-span",p=>{p.facts[0]!.evidence.start++;});
reject("unproved-fact-statement",p=>{p.facts[0]!.statement="P is on the line";});
reject("duplicate-source-evidence",p=>{p.facts.push({...p.facts[0]!,id:"extraFact"});});
reject("actor-alias",p=>{p.entities[0]!.label="Q";});
reject("foot-alias",p=>{p.entities[2]!.label="Q";});
reject("binding-actor-alias",p=>{p.solveRequests[1]!.resultBinding!.symbol="x_H";});
reject("actor-case-alias",p=>{p.solveRequests[1]!.resultBinding!.symbol="x_f";});
reject("ambiguous-foot",p=>{p.entities.push({...p.entities[2]!,id:"H"});});
reject("unproved-relation",p=>{p.constraints.push({id:"extraRelation",kind:"parallel",entityIds:["P","F","L"],evidenceFactIds:["fFoot"]});});
reject("wrong-derived-operands",p=>{const c=p.constraints[1]!;if(c.kind==="perpendicular")c.entityIds=["F","P","L"];});
reject("perpendicular-with-given-evidence",p=>{p.constraints[1]!.evidenceFactIds=["fPoint"];});
reject("extra-unknown",(_p,t)=>{t.unknowns.push({id:"Q",symbol:"Q"});});
reject("wrong-intermediate",(_p,t)=>{t.derived.find(r=>r.id==="s")!.value=10;});
reject("bad-source-equation",(_p,t)=>{t.derived.find(r=>r.id==="fx")!.sourceText="x_F=0.28=2";});
reject("extra-claim",(_p,t)=>{t.qualitativeClaims.push({id:"bad",claim:"P is on the line",expected:true,relatedQuantityIds:["px"]});});
reject("false-expected-equation",(_p,t)=>{t.qualitativeClaims[2]!.expected="3*0.28+4*1.04-5=1";});
reject("unproved-entity-hint",(_p,t)=>{t.qualitativeClaims[1]!.relatedEntityHints=["Q"];});
reject("unproved-teaching-hint",(_p,t)=>{t.teachingSequenceHints=["circle"];});
reject("unproved-assumption",(_p,t)=>{t.assumptions.push("Coordinates in consistent units and P is on the line");});
reject("unproved-law",(_p,t)=>{t.lawIds.push("circle_tangent");});
reject("dependency-cycle",(_p,t)=>{t.derived.find(r=>r.id==="s")!.dependsOn=["d"];});
reject("missing-DAG-node",(_p,t)=>{t.derived.find(r=>r.id==="s")!.dependsOn=["absent"];});
reject("extra-original-field",p=>{Object.assign(p,{hiddenConstraint:{kind:"parallel"}});});
reject("missing-request",p=>{p.solveRequests.pop();});

// Independent geometric oracles: choose a known line point and its normal
// displacement. The expected feet are those known points, not engine outputs.
function heldCase(name:string,pointName:string,point:[number,number],line:[number,number,number],foot:[number,number],d:number){
  const [a,b,c]=line,[x,y]=point;
  const equation=`${a}x${b<0?"":"+"}${b}y${c<0?"":"+"}${c}=0`,pointText=`${pointName}=(${x},${y})`;
  const question=`Find the distance and perpendicular foot F from ${pointText} to ${equation}.`;
  const p=structuredClone(fixture.problem),t=structuredClone(fixture.plans[0]!);p.question=question;t.question=question;
  const quotes=[pointText,equation,"distance","perpendicular foot F"];
  p.facts.forEach((f,i)=>{const quote=quotes[i]!,start=question.indexOf(quote);f.statement=quote;f.evidence={source:"question",start,end:start+quote.length,quote};});
  p.entities[0]!.id=pointName;p.entities[0]!.label=pointName;p.entities[1]!.label=equation;p.entities[2]!.label="F";
  for(const constraint of p.constraints)if("entityIds" in constraint)constraint.entityIds=constraint.entityIds.map(id=>id==="P"?pointName:id);
  p.representationIntents[0]!.entityIds=[pointName,"L","F"];
  const n=(value:number)=>({kind:"number" as const,value});
  const bin=(operator:"+"|"-"|"*"|"/"|"^",left:ProblemIR["expressions"][number]["root"],right:ProblemIR["expressions"][number]["root"])=>({kind:"binary" as const,operator,left,right});
  const residual=()=>bin("+",bin("+",bin("*",n(a),n(x)),bin("*",n(b),n(y))),n(c));
  const norm=()=>bin("+",bin("^",n(a),n(2)),bin("^",n(b),n(2)));
  p.expressions[0]!.root=bin("/",{kind:"call",function:"abs",argument:residual()},{kind:"call",function:"sqrt",argument:norm()});
  p.expressions[1]!.root=bin("-",n(x),bin("/",bin("*",n(a),residual()),norm()));
  p.expressions[2]!.root=bin("-",n(y),bin("/",bin("*",n(b),residual()),norm()));
  t.givens.forEach((row,i)=>{row.value=[x,y,a,b,c][i]!;row.sourceText=i<2?pointText:equation;if(i<2)row.symbol=`${i===0?"x":"y"}_${pointName}`;});
  t.derived.forEach((row,i)=>{row.value=[d,...foot][i]!;row.sourceText=`${row.symbol}=${row.value}`;});
  t.qualitativeClaims=[];positive(name,p,t,{d,foot});
}
heldCase("vertical", "A",[-2,3],[1,0,-5],[5,3],7);
heldCase("horizontal", "Q",[4,-3],[0,1,-2],[4,2],5);
heldCase("negative-oblique", "B",[0,0],[1,-1,-6],[3,-3],Math.sqrt(18));
heldCase("zero-distance-incidence", "P",[3,4],[3,4,-25],[3,4],0);
const document=api.pointLineSourceDocument(fixture.problem.question,fixture.problem)!;
for(const [name,edit] of [
 ["scene-false-foot",(doc:SceneDocument)=>{doc.constructions.find(c=>c.operator==="project")!.inputs.point="F";}],
 ["scene-false-line-equation",(doc:SceneDocument)=>{doc.entities.find(e=>e.id==="L")!.label="3x+4y+5=0";}],
 ["scene-extra-obligation",(doc:SceneDocument)=>{doc.assertions.push({id:"unproved",predicate:"parallel",entities:["projection_distance","L"],severity:"fatal"});}],
 ["scene-renamed-foot",(doc:SceneDocument)=>{doc.entities.find(e=>e.id==="F")!.label="H";}],
] as const){const doc=structuredClone(document);edit(doc);const result=api.compileSceneDocument(doc,{sourceAuthority:{question:fixture.problem.question,problemIR:fixture.problem,turnPlan:fixture.plans[0]}});check(!result.ok && !result.renderScene,name);}
let getterCalls=0;const unsafe=structuredClone(fixture.problem);Object.defineProperty(unsafe,"entities",{get(){getterCalls++;return [];}});
check(api.pointLineCallerIssues(fixture.problem.question,unsafe,fixture.plans[0]).length>0,"accessor rejects");check(getterCalls===0,"accessor never runs");
const unsafeCompiled=api.compileSceneDocument(document,{sourceAuthority:{question:fixture.problem.question,problemIR:unsafe,turnPlan:fixture.plans[0]}});
check(!unsafeCompiled.ok && unsafeCompiled.renderScene===null && getterCalls===0,"complete compiler boundary rejects accessors without execution");
const cyclic=structuredClone(fixture.problem);Object.assign(cyclic.expressions[0]!.root,{left:cyclic.expressions[0]!.root});
check(api.pointLineCallerIssues(fixture.problem.question,cyclic,fixture.plans[0]).length>0,"cyclic original input rejects");
const output=process.argv.find(arg=>arg.startsWith("--output="))?.slice(9);if(output)writeFileSync(output,JSON.stringify({built:process.argv.includes("--built"),checks,receipts},null,2));
console.log(`point-line full caller: ${checks} checks passed (${process.argv.includes("--built")?"own public ESM":"source"})`);
