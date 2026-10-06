/** Whole original caller regressions for F1/F2/G1/G2; no provider or DB. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../../src/index";
import * as C from "@heytutor/tutor-core";
const load = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const capture = load<{planResponseBodies:string[];irResponseBody:string}>("./fixtures/w2-ucm-actual-claims-20261006/actual-exchange.json");
const contents = capture.planResponseBodies.map(body => JSON.parse(body).choices[0].message.content as string);
const wire: E.TurnPlanV3[] = contents.map(text => JSON.parse(text));
const question = wire[1]!.question;
const plan = C.parseTurnPlanV3Content(contents[1]!, question); assert.ok(plan);
assert.equal(C.parseTurnPlanV3Content(contents[0]!, question), null);
const rawContent = JSON.parse(capture.irResponseBody).choices[0].message.content as string;
const rawIR = JSON.parse(rawContent);
const problem = E.validateProblemIR(C.normalizeProblemIRModelOutput(rawIR, question, plan), question).problem; assert.ok(problem);
const candidate = E.synthesizeFamilyScene({question,turnPlan:plan,problemIR:problem}); assert.ok(candidate);
const obligations = load<{
  periodResultPositions:string[]; accelerationExpected:string[]; foreignLaws:string[]; foreignEntities:string[];
  foreignTeaching:string[]; badPeriodDependencies:string[][]; badPeriodClaimLinks:(string[]|null)[];
}>("./fixtures/w2-ucm-claim-role-20261006/obligations.json");
const failures: string[] = []; let cases = 0;
async function check(label: string, p: E.TurnPlanV3, accept: boolean) {
  cases++;
  const before = structuredClone({p,problem,rawIR});
  try {
    const authority = {question,turnPlan:p,problemIR:problem};
    assert.equal(E.uniformCircularRuntimePlanConflicts(question,p).length === 0, accept, label+"/whole Plan");
    assert.equal(E.uniformCircularCallerIssues(question,problem,p).every(issue=>issue.severity!=="fatal"), accept, label+"/caller");
    assert.equal(!!E.synthesizeFamilyScene(authority), accept, label+"/family");
    assert.equal(E.validateSceneSourceAuthority(candidate!.document,question,problem,p).every(issue=>issue.severity!=="fatal"), accept, label+"/central");
    const compiled = E.compileSceneDocument(candidate!.document,{sourceAuthority:authority});
    assert.equal(compiled.ok,accept,label+"/compile"); assert.equal(!!compiled.renderScene,accept,label+"/atomic render");
    const applied = E.applySourceQuantityAuthority(p,problem,question);
    assert.equal(applied.outcomes.every(outcome=>!outcome.declineFigure),accept,label+"/reconciliation");
    if (!accept) { assert.strictEqual(applied.plan,p); assert.deepEqual(applied.plan,p); assert.ok(applied.outcomes.every(outcome=>outcome.corrections.length===0)); }
    const api = await C.planProblemAuthorityV1(question,p,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(capture.irResponseBody,{status:200})});
    assert.ok(api,label+"/ordinary API reply");
    if (accept) {
      assert.ok(!("status" in api),label+"/ordinary API positive");
      assert.equal(api.audit.status,"verified"); assert.ok(api.projection);
      assert.deepEqual(api.problemIR,problem); assert.equal(api.rawContent,rawContent);
      assert.deepEqual(api.solverResult.values.map(row=>row.approximate),[8,5*Math.PI]);
    } else {
      assert.ok("status" in api && api.status === "source_declined",label+"/ordinary API whole refusal");
      assert.deepEqual(api.rawTurnPlan,p); assert.deepEqual(api.rawProblemIR,rawIR);
    }
    console.log(`PASS ${label}`);
  } catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); console.log(`FAIL ${failures.at(-1)}`); }
  assert.deepEqual({p,problem,rawIR},before,label+"/original inputs immutable");
}
async function mutation(label:string, edit:(p:E.TurnPlanV3)=>void, accept=false) {
  const p=structuredClone(plan!); edit(p); await check(label,p,accept);
}
await check("unchanged complete wire alternate / optional",wire[1]!,true);
await check("unchanged production parsed alternate",plan,true);
await check("unchanged full primary",wire[0]!,false);
await mutation("full compound true claims and whole correct original IR",p=>{p.qualitativeClaims.forEach(claim=>{claim.expected=true;});},true);
for (const tail of obligations.periodResultPositions) await mutation(`F1 period position ${tail}`,p=>{p.qualitativeClaims[2]!.claim=`One revolution covers the circumference 2*pi*r at constant speed v, giving period ${tail}`;});
for (const expected of obligations.accelerationExpected) await mutation(`F2 acceleration result ${expected}`,p=>{p.qualitativeClaims[0]!.expected=expected;});
await mutation("F1 period expected has unrelated true assertion",p=>{p.qualitativeClaims[2]!.expected+="; Tangential acceleration is zero";});
for (const law of obligations.foreignLaws) await mutation(`G1 law ${law}`,p=>{p.lawIds.push(law);});
for (const hint of obligations.foreignEntities) await mutation(`G1 entity ${hint}`,p=>{p.qualitativeClaims[2]!.relatedEntityHints=[hint];});
for (const hint of obligations.foreignTeaching) await mutation(`G1 teaching ${hint}`,p=>{p.teachingSequenceHints=[hint];});
for (const deps of obligations.badPeriodDependencies) await mutation(`G2 period deps ${JSON.stringify(deps)}`,p=>{p.derived[1]!.dependsOn=deps;});
await mutation("G2 omitted derived dependencies",p=>{delete p.derived[1]!.dependsOn;});
for (const links of obligations.badPeriodClaimLinks) await mutation(`G2 period links ${JSON.stringify(links)}`,p=>{if(links===null)delete p.qualitativeClaims[2]!.relatedQuantityIds;else p.qualitativeClaims[2]!.relatedQuantityIds=links;});
await mutation("G2 tangential result needs speed link",p=>{p.qualitativeClaims[1]!.relatedQuantityIds=["r"];});
await mutation("role/unit join fails even with true radius scalar",p=>{p.derived[0]!.symbol="r";p.derived[0]!.unit="m";p.derived[0]!.value=50;p.derived[0]!.sourceText="r = 50 m";});
await mutation("whole given quotation rejects foreign tail",p=>{p.givens[0]!.sourceText+=" and mass is 1 kg";});
await mutation("caller prefix cannot waive complete provenance",p=>{p.derived[1]!.sourceText="Source-verified T = 2*pi*r/v = 5*pi ≈ 15.708";});
await mutation("derived result cannot be just true prose",p=>{p.derived[1]!.sourceText="Speed is constant";});
await mutation("source-resolved hints and laws preserve complete input",p=>{
  p.qualitativeClaims[2]!.relatedEntityHints=["car","circular track","centre of the circular track"];
  p.teachingSequenceHints=["Speed is constant","Tangential acceleration is zero"];
  p.lawIds.push("uniform_circular_motion");
},true);
await mutation("original quantity graph order is irrelevant",p=>{p.givens.reverse();p.derived.reverse();p.derived.forEach(row=>row.dependsOn!.reverse());},true);
await mutation("numeric expanded law uses the original proved operands",p=>{p.derived[1]!.sourceText="T = 2*pi*50/20 = 5*pi ≈ 15.708";},true);
await mutation("existing complete proved derived prose remains positive",p=>{p.derived.forEach(row=>{row.sourceText+="; Speed is constant; Centripetal acceleration points toward the centre.";});},true);
await mutation("acyclic intermediate operator graph",p=>{
  p.derived.push({id:"omega",symbol:"omega",unit:"rad/s",value:.4,provenance:"derived",sourceText:"omega = v/r",dependsOn:["v","r"]});
  p.derived[0]!.sourceText="a_c = omega^2*r";p.derived[0]!.dependsOn=["omega","r"];
},true);
await mutation("claim expected equation needs its intermediate role link",p=>{
  p.derived.push({id:"omega",symbol:"omega",unit:"rad/s",value:.4,provenance:"derived",sourceText:"omega = v/r",dependsOn:["v","r"]});
  p.qualitativeClaims[0]!.expected="a_c = omega^2*r = 8 m/s^2";
});
await mutation("whole expected role equation with intermediate link",p=>{
  p.derived.push({id:"omega",symbol:"omega",unit:"rad/s",value:.4,provenance:"derived",sourceText:"omega = v/r",dependsOn:["v","r"]});
  p.qualitativeClaims[0]!.expected="a_c = omega^2*r = 8 m/s^2";
  p.qualitativeClaims[0]!.relatedQuantityIds!.push("omega");
},true);
await mutation("cycle between two physically valid formulas declines whole graph",p=>{
  p.derived.push({id:"omega",symbol:"omega",unit:"rad/s",value:.4,provenance:"derived",sourceText:"omega = 2*pi/T",dependsOn:["T"]});
  p.derived[1]!.sourceText="T = 2*pi/omega";p.derived[1]!.dependsOn=["omega"];
});
await mutation("existing source-proved global boolean optional-link policy",p=>{
  p.qualitativeClaims.push({id:"global",claim:"Velocity is tangent to the circle",expected:true,relatedQuantityIds:[],relatedEntityHints:[]});
},true);
await mutation("global assertion cannot discharge unrelated scalar result",p=>{
  p.qualitativeClaims[0]!.expected="Use pi ≈ 3.141592653589793";
});
const preserved = load<{cases:Array<{label:string;question:string;artifacts:E.SceneArtifactsV3;expected:number[]}>}>("./fixtures/w2-ucm-claim-role-20261006/preserved-positive11.json");
assert.equal(preserved.cases.length,11);
for (const c of preserved.cases) {
  cases++;
  const before = structuredClone(c);
  const p = c.artifacts.turnPlan!, ir = c.artifacts.problemIR!;
  assert.ok(E.validateProblemIR(ir,c.question).valid,c.label);
  assert.ok(E.uniformCircularCallerIssues(c.question,ir,p).every(issue=>issue.severity!=="fatal"),c.label);
  const api = await C.planProblemAuthorityV1(c.question,p,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(ir)}}]}))});
  assert.ok(api && !("status" in api),c.label); assert.equal(api.audit.status,"verified"); assert.ok(api.projection);
  assert.deepEqual(JSON.parse(JSON.stringify(api.problemIR)),JSON.parse(JSON.stringify(ir)),c.label+"/full original graph");
  assert.equal(api.rawContent,JSON.stringify(ir));
  c.expected.forEach((value,i)=>{
    const actual = api.solverResult.values[i]!.approximate;
    assert.ok(typeof actual === "number",c.label+"/scalar result");
    assert.ok(Math.abs(actual-value)<=32*Number.EPSILON*Math.abs(value),c.label);
  });
  assert.deepEqual(c,before,c.label+"/full original immutable");
  console.log(`PASS original positive11 ${c.label}`);
}
console.log(`${cases} claim-role cases, ${failures.length} failures (${process.env.UCM_ROLE_GATE_MODE})`);
assert.deepEqual(failures,[]);
