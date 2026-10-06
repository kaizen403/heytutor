import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import * as source from "../../src/index";
import * as engine from "@heytutor/scene-engine";
const api:typeof source=process.argv.includes("--built")?await import("../../dist/index.js"):source;
const fixture=JSON.parse(readFileSync(new URL("../../../scene-engine/scripts/verify/fixtures/point-line-full-caller-20261006.json",import.meta.url),"utf8"));
const {selectFastVerifiedRepresentation,selectVerifiedRepresentation}=await import("../../../../apps/tutor/features/tutor-session/lib/scene/representationFallback");
let checks=0;const receipts:unknown[]=[];
function check(condition:unknown,message:string):asserts condition{checks++;assert.ok(condition,message);}
const response=(wire:unknown)=>async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(wire)}}]}),{status:200});
async function attempt(plan:engine.TurnPlanV3,wire:unknown){return api.planProblemAuthorityV1(plan.question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:10000,fetchImpl:response(wire)});}
for(const [index,original] of fixture.plans.entries()){
 const before=JSON.stringify(original),parsed=api.parseTurnPlanV3Content(before,original.question);check(parsed,"original parser");
 check(JSON.stringify(parsed)===before,"all model Plan fields remain unchanged before/after parsing");
 const wire=structuredClone(fixture.wire),wireBefore=JSON.stringify(wire);
 const result=await attempt(parsed,wire);check(result && !("status" in result),`ordinary API ${index}: ${JSON.stringify(result)}`);
 check(result.audit.status==="verified" && result.audit.bindings.length===3,"all three bound results verified");
 check(JSON.stringify(wire)===wireBefore,"original wire fields not mutated");
 const expected=api.liftCompactProblemIR(wire,parsed.question);check(JSON.stringify(result.problemIR)===JSON.stringify(expected),"only syntax lifting, complete unsimplified IR retained");
 check(result.problemIR.constraints.length===2 && result.problemIR.facts.length===4 && result.problemIR.entities.length===3 && result.problemIR.expressions.length===3,"original obligations retained");
 const input={question:parsed.question,turnPlan:parsed,problemIR:result.problemIR};
 const families=api.inferSceneCapabilities(parsed.question,{turnPlan:parsed,problemIR:result.problemIR,lawIds:parsed.lawIds}).families;
 for(const scope of [undefined,families]){
  const fast=selectFastVerifiedRepresentation({...input,families:scope}),normal=selectVerifiedRepresentation({...input,families:scope});
  check(normal.tier==="exact_verified" && normal.renderScene.primitives.length>0,"normal app figure source-bound honest");
  check(normal.sceneDocument.entities.some(e=>e.id==="F" && e.label==="foot") && normal.sceneDocument.entities.some(e=>e.id==="L" && e.label==="3x+4y-5=0"),"actual requested identities retained");
  receipts.push({index,scope,fast,normal,result});
 }
}
async function reject(name:string,edit:(plan:engine.TurnPlanV3,wire:Record<string,any>)=>void){
 const plan=structuredClone(fixture.plans[1]),wire=structuredClone(fixture.wire);edit(plan,wire);const before=JSON.stringify({plan,wire});
 const parsed=api.parseTurnPlanV3Content(JSON.stringify(plan),plan.question);check(parsed===null || JSON.stringify(parsed)===JSON.stringify(plan),"parser refuses unsafe arithmetic or retains all original fields");
 const result=await attempt(plan,wire);check(result && "status" in result && result.status==="source_declined",`${name}: API declines original input ${JSON.stringify(result)}`);
 check(JSON.stringify(result.rawProblemIR)===JSON.stringify(wire),`${name}: original unsafe wire preserved`);
 check(JSON.stringify(result.rawTurnPlan)===JSON.stringify(plan),`${name}: original unsafe Plan preserved`);
 check(JSON.stringify({plan,wire})===before,`${name}: no reconciliation mutates originals`);
 receipts.push({name,result});
}
await reject("wrong-copied-oracle",(plan)=>{plan.derived.find(r=>r.id==="d")!.value=2;});
await reject("wrong-AST",(_plan,wire)=>{wire.expressions[0].expr="2";});
await reject("malformed-constraint",(_plan,wire)=>{wire.constraints[1].kind="parallel";});
await reject("unrecognized-wire-field",(_plan,wire)=>{wire.hiddenConstraint={kind:"parallel"};});
await reject("extra-wire-unit",(_plan,wire)=>{wire.expressions[0].unit="m";});
await reject("missing-wire-evidence",(_plan,wire)=>{wire.facts[0].quote="absent";});
await reject("unknown-entity",(_plan,wire)=>{wire.entities.push({id:"Q",kind:"point",label:"Q",evidenceFactIds:["fPoint"]});});
await reject("unproved-claim",plan=>{plan.qualitativeClaims[0]!.claim="P is on the line";});
await reject("cyclic-Plan",plan=>{plan.derived.find(r=>r.id==="s")!.dependsOn=["d"];});
const output=process.argv.find(arg=>arg.startsWith("--output="))?.slice(9);if(output)writeFileSync(output,JSON.stringify({checks,built:process.argv.includes("--built"),receipts},null,2));
console.log(`point-line ordinary API and normal app: ${checks} checks passed (${process.argv.includes("--built")?"own public ESM":"source core"})`);
