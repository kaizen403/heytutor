import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "@heytutor/scene-engine";
import * as C from "@heytutor/tutor-core";
import { selectVerifiedRepresentation } from "../../../../apps/tutor/features/tutor-session/lib/scene/representationFallback";
import { callers } from "./fixtures/w2-matrix-actual-caller-fix-20261006/cases";
import type { ProblemIR, TurnPlanV3 } from "@heytutor/scene-engine";
let checks = 0;
const check = (value: unknown, label: string): void => { assert.ok(value,label); checks++; };
const read = (i:number): {question:string; plan:TurnPlanV3; raw:TurnPlanV3; problemIR:ProblemIR; wire:string} => JSON.parse(readFileSync(new URL(`./fixtures/w2-matrix-colon-closeout-20261006/actual1805-${i}.json`,import.meta.url),"utf8"));
const originals = [read(0),read(1)];
for(const input of originals){
 const before=JSON.stringify(input),{question,plan,problemIR}=input;
 check(JSON.stringify(plan)===JSON.stringify(input.raw),"actual model Plan retained unchanged");
 check(E.matrixProductSourcePlanIssues(question,plan).length===0,"complete actual Plan proved");
 check(E.matrixProductFullIRIssues(question,problemIR).length===0,"whole actual IR proved");
 const authority=E.applySourceQuantityAuthority(plan,problemIR,question);
 check(authority.plan===plan&&!authority.outcomes.some(x=>x.declineFigure),"original Plan reference admitted without correction");
 const selected=selectVerifiedRepresentation({question,turnPlan:plan,problemIR});
 check(selected.renderScene.primitives.length===28,"ordinary app displays complete two nonmetric product tables");
 const api=await C.planProblemAuthorityV1(question,plan,{proxyUrl:"http://offline.invalid",timeoutMs:5000,fetchImpl:async()=>Response.json({choices:[{message:{content:input.wire}}]})});
 check(api&&!("status"in api)&&api.audit.status==="not_applicable"&&JSON.stringify(api.problemIR)===JSON.stringify(problemIR),"normal API retains complete fact-only IR, without claiming a numeric solve");
 check(JSON.stringify(input)===before,"whole actual original immutable");
}
// Four independent finite source cases already fix exact ordered-product oracles.
for(const input of callers.slice(2)){
 const plan=structuredClone(input.plan),claim=plan.qualitativeClaims.at(-1)!;
 const names=claim.relatedQuantityIds!,equal=JSON.stringify(input.products[0])===JSON.stringify(input.products[1]);
 claim.claim=`Matrix multiplication is ${equal?"commutative":"not commutative"} here: ${names[0]} ${equal?"=":"!="} ${names[1]}`;
 const before=JSON.stringify(plan);
 check(E.matrixProductSourcePlanIssues(input.question,plan).length===0,"entire local colon statement agrees with independent products");
 check(selectVerifiedRepresentation({question:input.question,turnPlan:plan,problemIR:input.problemIR}).renderScene.primitives.length>0,"whole renamed/fractional/rectangular/equal original selects");
 check(JSON.stringify(plan)===before,"full source variant retained");
 for(const wrong of [claim.claim.replace(equal?"commutative":"not commutative",equal?"not commutative":"commutative"),claim.claim.replace(equal?" = ":" != ",equal?" != ":" = "),claim.claim+" and A is invertible",claim.claim+"; Show determinant A",claim.claim.replace("here:","always:"),claim.claim.replace(names[0]!,"Z")]){
  const bad=structuredClone(plan);bad.qualitativeClaims.at(-1)!.claim=wrong;
  const beforeBad=JSON.stringify(bad),authority=E.applySourceQuantityAuthority(bad,input.problemIR,input.question);
  check(E.matrixProductSourcePlanIssues(input.question,bad).length>0,"false or unowned complete conjunct declines");
  check(authority.plan===bad&&authority.outcomes.some(x=>x.declineFigure),"refused original not corrected or pruned");
  check(selectVerifiedRepresentation({question:input.question,turnPlan:bad,problemIR:input.problemIR}).renderScene.primitives.length===0,"unsafe full caller no partial ink");
  check(JSON.stringify(bad)===beforeBad,"unsafe caller remains unchanged");
 }
}
console.log(`PASS ${checks} matrix current colon claim closeout checks; full original callers, independent products and atomic refusals`);
