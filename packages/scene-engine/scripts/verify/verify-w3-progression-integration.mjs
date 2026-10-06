// Independent plain ESM controls use only this worktree's freshly built public
// package. No TS gate imports, test-generated IR, or document-owned authority.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import * as engine from "../../dist/index.js";
let checks = 0;
function check(value, message) {checks++; assert(value, message);}
function equal(actual, expected, message) {checks++; assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);}
const authored = JSON.parse(readFileSync(new URL("./fixtures/w3-progression-source/authored-cases.json", import.meta.url), "utf8")).cases;
const expected = [[3,1,-1,-3], [2,-4,8,-16,-10], [8,0], [1504,10510,3454,35615], [4,-4]];
for (const operator of ["indexed_progression", "progression_recover", "progression_insert"]) {
  check(engine.isExecutableSceneConstructionOperator(operator), "public existing operator available");
  check(engine.isPlannerVisibleSceneConstructionOperator(operator), "canonical existing operator visible");
}
function reject(document, authority, message) {
  const result = engine.compileSceneDocument(document, {sourceAuthority: authority});
  check(!result.ok && result.renderScene === null && result.report.stats.primitiveCount === 0, message);
}
for (const [i, c] of authored.entries()) {
  // Frozen independent expected values supplied by the test's external caller.
  const plan = {...structuredClone(c.plan), derived: c.plan.unknowns.map((q, j) => ({...q, value: expected[i][j], provenance: "derived"}))};
  check(engine.validateTurnPlanV3(plan, c.question).valid, "whole actual V3 profile");
  const program = engine.finiteProgressionSourceProgram(c.question, c.problem, plan);
  check(program.status === "ok", `public program ${c.id}`);
  equal(program.bindings.map(b => b.ask.value), expected[i], "independent frozen outputs");
  const authority = {question: c.question, problemIR: c.problem, turnPlan: plan};
  equal(engine.validateSceneSourceAuthority(program.document, c.question, c.problem, plan), [], "public central proof");
  const result = engine.compileSceneDocument(program.document, {sourceAuthority: authority});
  check(result.ok && result.renderScene, "built normal compiler");
  const family = engine.synthesizeFamilyScene({question: c.question, problemIR: c.problem, turnPlan: plan});
  check(family?.family === "indexed_progression" && family.tier === "exact_verified", "built normal source/fullIR/Plan family");
  const parsed = JSON.parse(JSON.stringify(program.document));
  equal(engine.validateFiniteProgressionSourceDocument(parsed, c.question, c.problem, plan), [], "public parent read helper");
  equal(engine.compileSceneDocument(parsed, {sourceAuthority: authority}).renderScene, result.renderScene, "built JSON ink roundtrip");
  const checked = engine.validateSceneDocument(parsed, {sourceAuthority: authority});
  equal(checked.document, parsed, "validated document is canonical for subsequent boundaries");
  check(engine.compileSceneDocument(checked.document, {sourceAuthority: authority}).ok, "compile validated candidate again");
  check(program.document.requiredEntityIds.every(id => result.renderScene.primitives.some(p => p.entityId === id)), "all required source names/givens/requests ink");
  check(result.renderScene.primitives.every(p => ["label", "point"].includes(p.kind)), "honest discrete ink");
  program.bindings.forEach(b => check(result.renderScene.primitives.some(p => p.provenance?.quantityId === b.quantityId && p.provenance?.unit === b.unit && p.provenance?.requestId === b.requestId), "actual public binding survives"));
  reject(parsed, undefined, "cannot use stored Plan/IR as authority");
  reject(parsed, {question:c.question, problemIR:c.problem}, "actual Plan required");
  reject(parsed, {question:c.question, problemIR:undefined, turnPlan:plan}, "actual fullIR required");
  const unresolved = structuredClone(plan); unresolved.derived=[];
  reject(parsed, {...authority, turnPlan:unresolved}, "whole actual V3 rejects unresolved numeric unknowns");
  for (const mutate of [
    d => {d.requiredEntityIds.pop();}, d => {d.revealGroups[0].entityIds.pop();},
    d => {d.teachingTimeline.pop();}, d => {d.quantities.at(-1).value=123;},
    d => {d.source.turnPlan=plan;d.constructions[0].inputs.origin=[111,222];},
    d => {d.entities[0].label="wrong_n";}, d => {d.source={};},
    d => {d.constructions[0].inputs.waiver=true;}, d => {d.constructions[0].inputs.displayScale=9;},
  ]) {const bad=structuredClone(parsed);mutate(bad);reject(bad,authority,"built whole-payload attack");check(engine.validateFiniteProgressionSourceDocument(bad,c.question,c.problem,plan).length,"built read helper attack");}
  for (const mutate of [
    p => {p.unknowns.push({...p.unknowns[0]});}, p => {p.derived.push({...p.derived[0]});},
    p => {p.derived[0].symbol="conflict";}, p => {p.derived[0].unit="m";},
    p => {p.derived[0].value=999;}, p => {p.derived[0].dependsOn=["missing"];},
    p => {p.visualRequirement="none";}, p => {p.inventedFlag=true;},
  ]) {const changed=structuredClone(plan);mutate(changed);reject(parsed,{...authority,turnPlan:changed},"built actual Plan attack");}
  for (const mutate of [
    ir => {ir.expressions[0].root={kind:"number",value:expected[i][0]};},
    ir => {ir.entities.push({id:"extra",kind:"body",evidenceFactIds:["modelFact"]});},
    ir => {ir.solveRequests.pop();}, ir => {ir.representationIntents[0].kind="graph";},
    ir => {ir.solveRequests[0].resultBinding.turnPlanQuantityId="invented";},
    ir => {ir.extraConstraints=["ignored"];},
  ]) {const changed=structuredClone(c.problem);mutate(changed);reject(parsed,{...authority,problemIR:changed},"built actual wholeIR attack");}
}
function generic(kind, first, parameter, at) {
  return {schemaVersion:"scene-document/v2",visualDecision:{mode:"scene",reason:"independent finite generic control"},source:{},quantities:[],entities:[{id:"p",kind:"indexed_progression",role:"discrete generic terms"}],constructions:[{id:"make_p",operator:"indexed_progression",inputs:{kind,first,[kind==="arithmetic"?"difference":"ratio"]:parameter,indices:at,origin:[-4,3],displayScale:2},outputs:["p"]}],relations:[],assertions:[],annotations:[],requiredEntityIds:["p"],revealGroups:[{id:"g",entityIds:["p"],dependsOn:[],narrationCue:"show only finite indexed terms"}],teachingTimeline:[]};
}
// Independently enumerated term controls through the public compiler, including
// maxima, zero/alternating ratios and display changes that never affect values.
for (const [kind, first, parameter, at] of [
  ["arithmetic",-7,3,[1,2,5,64]], ["arithmetic",3,0,[1,64]],
  ["geometric",2,-1,[1,2,3,64]], ["geometric",2,0,[1,2,64]],
  ["geometric",0,9,[1,4,64]], ["geometric",2,1,[1,4,64]],
]) {
  let value=first;const values=[];
  for(let n=1;n<=64;n++){if(at.includes(n))values.push(String(value));value=kind==="arithmetic"?value+parameter:value*parameter;}
  const document=generic(kind,first,parameter,at), result=engine.compileSceneDocument(document);
  check(result.ok,"built explicit generic operator graph");
  equal(result.renderScene.primitives.filter(p=>p.id.includes("_value_")).map(p=>p.text),values,"independent generic recurrence ink");
  const moved=structuredClone(document); moved.constructions[0].inputs.origin=[140,-100];moved.constructions[0].inputs.displayScale=.01;
  const recompiled=engine.compileSceneDocument(moved);check(recompiled.ok,"generic placement remains nonmetric");
  equal(recompiled.renderScene.primitives.filter(p=>p.id.includes("_value_")).map(p=>p.text),values,"display coordinates never alter exact values");
  const invalid=structuredClone(document);invalid.constructions[0].inputs.indices=[2.5];reject(invalid,undefined,"existing structural validator rejects noninteger index");
}
// Separate recurrence for the corrected cumulative asks (including both sums).
let t=3,a=7,s=0;const answers=[];
for(let n=1;n<=30;n++){s+=t;if(n===20||n===30)answers.push(t,s);t+=a;a+=8;}
equal(answers,[1504,10510,3454,35615],"independent corrected T20/S20/T30/S30");
check(answers[0]!==1604 && answers[3]!==35610,"printed false options remain false");
const native=JSON.parse(readFileSync(new URL("./fixtures/w3-progression-source/native-sources.json",import.meta.url),"utf8")).cases;
for(const c of native){equal(createHash("sha256").update(c.question_options_and_source_answer_verbatim).digest("hex"),c.verbatim_question_block_sha256,"native OCR bytes frozen");check(engine.readFiniteProgressionSource(c.question_options_and_source_answer_verbatim).status==="declined","native OCR/mixed gaps remain unaccepted");}
console.log(`W3 progression normal engine integration (independent built ESM): ${checks} checks PASS; READY=0 accepted=0; actual student/native/lifecycle parent pending`);
