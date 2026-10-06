import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "@heytutor/scene-engine";
import * as C from "@heytutor/tutor-core";
import { selectVerifiedRepresentation, selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { withdrawDeclinedProblemAuthority } from "../../features/tutor-session/lib/turn/declinedProblemAuthority";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
const fixture = JSON.parse(readFileSync(new URL("fixtures/w2-w3-refusal-p2-20261006/signed-count31.json", import.meta.url), "utf8")) as {question:string;problem:E.ProblemIR;plan:E.TurnPlanV3};
const { question, problem, plan } = fixture;
let checks = 0;
function equal(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; }
function check(actual: unknown, label: string): asserts actual { assert(actual, label); checks++; }
const api = (p:E.TurnPlanV3|null, ir:unknown=problem) => C.planProblemAuthorityV1(question,p,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(ir)}}]}),{status:200})});
const authority = await api(plan);
check(authority && !("status" in authority), "full signed count31 API control");
equal(authority.audit.status,"verified","positive audit");
equal(E.verifyMeasurementSourceAuthority(problem,plan,question).numericalAuthority?.value,31,"independent (2.675-0.02-2.5)/0.005 =31");
check(E.verifyMeasurementSourceAuthority(problem,plan,question).problem === problem,"2cd complete original IR identity");
// A unary negative AST retains the signed-literal6d8 control.
const signed = structuredClone(problem);
const root = signed.expressions[0]!.root;
check(root.kind === "binary" && root.left.kind === "binary" && root.left.left.kind === "binary", "signed fixture AST");
root.left.left.right = {kind:"unary",operator:"-",operand:{kind:"number",value:0.02}};
equal(E.verifyMeasurementSourceAuthority(signed,plan,question).status,"verified","signed unary literal");
const validClaim = structuredClone(plan);
validClaim.qualitativeClaims.push({id:"countClaim",claim:"circular_divisions",expected:31,relatedQuantityIds:["circular_reading"]});
equal(E.verifyMeasurementSourceAuthority(problem,validClaim,question).status,"verified","proved original claim retained");
equal((E.verifyMeasurementSourceAuthority(problem,validClaim,question).plan as E.TurnPlanV3).qualitativeClaims,validClaim.qualitativeClaims,"no claim pruning");
const stale = structuredClone(validClaim); stale.derived[0]!.value=999;
equal((E.verifyMeasurementSourceAuthority(problem,stale,question).plan as E.TurnPlanV3).derived[0]!.value,31,"only fully joined scalar corrected");
for (const sign of ["+", "-"] as const) {
  const zeroQuestion=question.replace("-0.02 mm?", `${sign}0 mm?`);
  const source=E.readScrewGaugeQuestion(zeroQuestion);check(source.status === "ok", "signed zero source control");
  const zeroIR=structuredClone(problem), zeroPlan=structuredClone(plan);
  zeroIR.question=zeroQuestion;zeroPlan.question=zeroQuestion;
  const roles=["pitch","least_count","true_reading","zero_error","circular_reading"] as const;
  zeroIR.facts.forEach((fact,i)=>{fact.evidence=source.evidence[roles[i]!]![0]!;});
  zeroPlan.givens.forEach((row,i)=>{row.sourceText=zeroIR.facts[i]!.evidence.quote;});
  zeroPlan.givens[3]!.value=sign === "-" ? -0 : 0;
  zeroPlan.derived[0]!.value=35;zeroPlan.derived[0]!.sourceText=zeroIR.facts.map(f=>f.evidence.quote).join(" | ");
  const expr=zeroIR.expressions[0]!.root;
  check(expr.kind === "binary" && expr.left.kind === "binary" && expr.left.left.kind === "binary", "zero AST");
  expr.left.left.right={kind:"number",value:sign === "-" ? -0 : 0};
  const admitted=E.verifyMeasurementSourceAuthority(zeroIR,zeroPlan,zeroQuestion);
  equal(admitted.status,"verified", "complete signed zero caller has no pruned extras");
  equal(admitted.numericalAuthority?.value,35,"signed zero independent count35");
  equal(Object.is(admitted.values.zero_error?.value,sign === "-" ? -0 : 0),true,"original signed zero retained");
}
const mutations: Array<[string,(p:E.TurnPlanV3)=>void]> = [
  ["false claim",p=>p.qualitativeClaims.push({id:"false",claim:"circular_divisions",expected:999,relatedQuantityIds:["circular_reading"]})],
  ["extra force",p=>p.derived.push({id:"force",symbol:"F",unit:"N",value:999,sourceText:"The force on the wire is 999 N.",provenance:"derived",dependsOn:["d"]})],
  ["extra count",p=>p.derived.push({id:"twice",symbol:"2N",unit:"division",value:62,sourceText:"twice N",provenance:"derived",dependsOn:["circular_reading"]})],
  ["extra unknown",p=>p.unknowns.push({id:"force",symbol:"F",unit:"N"})],
  ["missing dependencies",p=>{delete p.derived[0]!.dependsOn;}],
  ["wrong dependencies",p=>{p.derived[0]!.dependsOn=["d"];}],
  ["extra dependency",p=>{p.derived[0]!.dependsOn!.push("hidden");}],
  ["duplicate dependency",p=>{p.derived[0]!.dependsOn!.push("d");}],
  ["wrong claim identity",p=>p.qualitativeClaims.push({id:"false",claim:"circular_divisions",expected:31,relatedQuantityIds:["other"]})],
  ["hidden claim",p=>p.qualitativeClaims.push({id:"hidden",claim:"circular_divisions",expected:31,relatedQuantityIds:["circular_reading"],hiddenClaim:"F=999"} as E.TurnPlanV3["qualitativeClaims"][number])],
];
for (const [name, mutate] of mutations) {
  const original=structuredClone(plan);mutate(original);const before=structuredClone(original);
  const admission=E.verifyMeasurementSourceAuthority(problem,original,question);
  equal(admission.status,"declined",`${name}: full original refuses`);
  equal(admission.numericalAuthority,null,`${name}: no scalar authority`);
  check(admission.problem === problem,`${name}: original IR retained`);
  equal(original,before,`${name}: original untouched`);
  const outcome=await api(original);
  check(outcome && "status" in outcome,`${name}: terminal API refusal`);
  equal(outcome.rawTurnPlan,before,`${name}: full original Plan diagnostics`);
  equal(outcome.rawProblemIR,problem,`${name}: full original IR diagnostics`);
  const early=E.applySourceQuantityAuthority(original,null,question);
  equal(early.plan,before,`${name}: question-only cannot erase obligations`);
  const pending=await api(null);check(pending && !("status" in pending),`${name}: pending authority`);
  const late=C.refuseProblemAuthorityForPlan(question,early.plan,pending);
  check(late,`${name}: final callback refuses whole caller`);
  equal(late.rawTurnPlan,before,`${name}: late full Plan diagnostics`);
  check(C.refuseSourcePlan(question,original),`${name}: unavailable IR also refuses`);
  const empty=withdrawDeclinedProblemAuthority(original,outcome);
  const prompt=buildTurnTeachingPrompt({question,turnPlan:empty,solverProjection:null,diagramPromptAddon:null,codeLesson:null,isDsa:false,familiarity:"revision",fastMode:false});
  check(!prompt.runtimeAddon.includes("AUTHORITATIVE TURN PLAN V3") && !prompt.runtimeAddon.includes("999"),`${name}: no false authority in teacher`);
}
for (const location of ["root","fact","evidence","entity","AST","binding"] as const) {
  const bad=structuredClone(problem);
  const object=location==="root"?bad:location==="fact"?bad.facts[0]:location==="evidence"?bad.facts[0]!.evidence:location==="entity"?bad.entities[0]:location==="AST"?bad.expressions[0]!.root:(bad.solveRequests[0] as Extract<E.SolveRequest, {kind:"evaluate"}>).resultBinding;
  Object.defineProperty(object,"hiddenObligation",{value:"F=999",enumerable:true});
  const outcome=await api(plan,bad);check(outcome && "status" in outcome,`${location}: original IR refuses`);
  equal(outcome.rawProblemIR,bad,`${location}: full unknown IR channel retained`);
}
for (const selfRemoving of [false,true]) {
  for (const location of ["root","derived","claim","toJSON"] as const) {
    const original=structuredClone(validClaim);let reads=0,requests=0;
    const object=location==="derived"?original.derived[0]!:location==="claim"?original.qualitativeClaims[0]!:original;
    const key=location==="toJSON"?"toJSON":"hiddenObligation";
    Object.defineProperty(object,key,{enumerable:true,configurable:true,get(){reads++;if(selfRemoving)Reflect.deleteProperty(object,key);return undefined;}});
    const outcome=await C.planProblemAuthorityV1(question,original,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>{requests++;throw Error("must not request");}});
    check(outcome && "status" in outcome,"descriptor API terminal refusal");
    equal([reads,requests],[0,0],"capture before serialization/request");
    check(Object.getOwnPropertyDescriptor(object,key)?.get,"self-removing getter remains unexecuted");
    check(JSON.stringify(outcome.rawTurnPlan).includes("accessor"),"opaque descriptor evidence serializes without getter");
    check(C.refuseSourcePlan(question,original),"descriptor source-plan helper");
    check(C.refuseUniformCircularPlan(question,original),"descriptor legacy refusal helper");
    check(C.refuseProblemAuthorityForPlan(question,original,authority),"descriptor final callback helper");
    equal(reads,0,"all refusal evidence avoids getters");
  }
}
const oversizedKey={...plan};Object.defineProperty(oversizedKey,"x".repeat(1048577),{value:0,enumerable:true});
const invalids:unknown[]=[oversizedKey,Object.assign(Object.create({hidden:"F=999"}),plan),{...plan,hidden:()=>1},{...plan,hidden:Symbol("x")},{...plan,hidden:Infinity},{...plan,hidden:"x".repeat(1048577)},{...plan,hidden:new Array(16385).fill(0)},{...plan,hidden:new Array(2)}];
let deep:unknown=null;for(let i=0;i<66;i++)deep={next:deep};invalids.push({...plan,hidden:deep});
const cycle:Record<string,unknown>={...plan};cycle.self=cycle;invalids.push(cycle);
for(const invalid of invalids){const outcome=await api(invalid as E.TurnPlanV3);check(outcome && "status" in outcome,"bounded non-data input declines");check(JSON.stringify(outcome).length<1100000,"diagnostic evidence remains bounded");}
const apparatus=question+" Draw the screw gauge.";
const apparatusPlan={...plan,question:apparatus,visualRequirement:"required" as const};
const refusal=C.refuseSourcePlan(apparatus,apparatusPlan);check(refusal,"apparatus whole source refusal");
const empty=withdrawDeclinedProblemAuthority(apparatusPlan,refusal);
for(const p of [apparatusPlan,empty]){
  const selection=selectVerifiedRepresentation({question:apparatus,turnPlan:p,problemIR:null});
  equal(selection.renderScene.primitives.length,0,"refused apparatus directly selects zero primitives");
  equal(selectFastVerifiedRepresentation({question:apparatus,turnPlan:p,problemIR:null}),null,"fast selection also empty");
  equal(E.synthesizeFamilyScene({question:apparatus,turnPlan:p,problemIR:null}),null,"direct family no apparatus");
  equal(E.synthesizeLastResortScene({question:apparatus,turnPlan:p,problemIR:null}),null,"last resort no apparatus");
}
const rejectedScene=JSON.parse(readFileSync(new URL("fixtures/w2-w3-refusal-p2-20261006/refused-apparatus-scene.json",import.meta.url),"utf8")) as E.SceneDocument;
check(liveSceneSaveFailure({document:rejectedScene,question:apparatus,turnPlan:empty,problemIR:null,tier:"qualitative_verified"}),"final save guard still refuses the original fabricated apparatus candidate");
console.log(`PASS ${checks} full-original source refusal, descriptors, bounds, signed31 and zero-figure controls`);
