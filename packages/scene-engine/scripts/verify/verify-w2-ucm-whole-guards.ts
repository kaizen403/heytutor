/** Whole-field authority regressions, original captures retained in full. Offline only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as engine from "../../src/index";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { normalizeProblemIRModelOutput } from "../../../tutor-core/src/planners/problemPlannerV1";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { rawStoredTurnSourceIssues, sourceCheckedStoredTurn } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { restoreVerifiedDiagramFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";
interface Case { id: string; question: string; rawIR: unknown; plan: TurnPlanV3; expected: number[] }
const load = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const cases: Case[] = ["car", "stone", "clockwise"].map((name, i) => {
 const c = load<{question:string;rawIRs:unknown[];canonicalPlan:TurnPlanV3}>(`./fixtures/w2-ucm-live-20261006/w2-ucm-${name}.json`);
 return {id:name, question:c.question, rawIR:c.rawIRs[0], plan:c.canonicalPlan, expected:[[8,5*Math.PI],[.8*Math.PI,.8*Math.PI**2],[.5,3]][i]!};
});
cases.push(...load<Case[]>("./fixtures/w2-ucm-whole-guards-20261006/independent.json"));
let checks = 0; const failures: string[] = [];
function check(label: string, run: () => void) {checks++;try {run();console.log(`PASS ${label}`);}catch(e){failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);console.log(`FAIL ${failures.at(-1)}`);}}
for (const c of cases) {
 const normalized = engine.validateProblemIR(normalizeProblemIRModelOutput(c.rawIR,c.question,c.plan),c.question);
 assert.ok(normalized.problem); const problem = normalized.problem;
 const plan = engine.applySourceQuantityAuthority(c.plan,problem,c.question).plan;
 const scene = engine.synthesizeFamilyScene({question:c.question,turnPlan:plan,problemIR:problem});
 assert.ok(scene,`${c.id} control scene: ${JSON.stringify(engine.uniformCircularRuntimeProblemIssues((engine.readUniformCircularRuntimeContract(c.question) as {status:"bound";contract:engine.UniformCircularRuntimeContract}).contract,problem))}`);
 const doc = scene.document;
 const solved = await new engine.LocalDeterministicSolverProvider().solve(problem);
 check(`${c.id}/control independent solver and complete IDs`,()=>{
  const raw=c.rawIR as Record<string,Array<{id:string}>>;
  for(const key of ["facts","entities","expressions","constraints","representationIntents","solveRequests"] as const) assert.deepEqual(problem[key].map(r=>r.id),raw[key]!.map(r=>r.id));
  assert.equal(engine.verifyTurnPlanAgainstSolver(problem,solved,plan,c.question).status,"verified");
  problem.solveRequests.forEach((r,i)=>assert.ok(Math.abs(Number(solved.values.find(v=>v.requestId===r.id)!.approximate)-c.expected[i]!)<1e-12));
 });
 function seams(p: ProblemIR, actualPlan: TurnPlanV3, accept: boolean, kind: "ir" | "plan" | "control") {
  assert.equal(engine.validateProblemIR(p,c.question).valid,true);
  assert.equal(engine.validateTurnPlanV3(actualPlan,c.question).valid,true);
  const issues = engine.uniformCircularRuntimePlanConflicts(c.question,actualPlan);
  if(kind==="plan") {
   assert.ok(issues.length,"whole plan must conflict");
   const authority=engine.applySourceQuantityAuthority(actualPlan,p,c.question);
   assert.ok(authority.outcomes.some(r=>r.declineFigure));
   assert.deepEqual(authority.plan.assumptions,actualPlan.assumptions);assert.deepEqual(authority.plan.qualitativeClaims,actualPlan.qualitativeClaims);assert.deepEqual(authority.plan.unknowns,actualPlan.unknowns);
  }
  assert.equal(!!engine.synthesizeFamilyScene({question:c.question,turnPlan:actualPlan,problemIR:p}),accept,"synthesis");
  const sourceIssues=engine.validateSceneSourceAuthority(doc,c.question,p,actualPlan);
  const compiled=engine.compileSceneDocument(doc,{sourceAuthority:{question:c.question,problemIR:p,turnPlan:actualPlan}});
  if(kind!=="plan") {
   assert.equal(sourceIssues.every(r=>r.severity!=="fatal"),accept,"source authority");
   assert.equal(compiled.ok,accept,"compile");if(!accept)assert.equal(compiled.renderScene,null);
  } else if (["car","stone","clockwise"].includes(c.id)) {
   // The compiler's central source/plan hook belongs to the parent. Record
   // it rather than bless compilation alongside an unsupported teaching plan.
   console.log("PARENT_HOOK "+JSON.stringify({case:c.id,planConflictIds:issues.map(i=>i.id),sourcePlanFatal:sourceIssues.some(r=>r.severity==="fatal"),compiled:compiled.ok,disposition:"central compile must reuse UCM whole-plan conflicts and stale scalar guards"}));
  }
  const admission={document:doc,question:c.question,turnPlan:actualPlan,problemIR:p,tier:"qualitative_verified" as const};
  // Reverse object keys to exercise JSONB without deleting any channel.
  const stored=JSON.parse(JSON.stringify({question:c.question,sceneDocument:doc,sceneArtifacts:{turnPlan:actualPlan,problemIR:p,representationTier:"qualitative_verified"}},(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
  assert.equal(liveSceneSaveFailure(admission)===null,accept,"live");assert.equal(sceneSaveAdmissionFailure(admission)===null,accept,"save");
  assert.equal(rawStoredTurnSourceIssues(doc,stored).every(r=>r.severity!=="fatal"),accept,"raw read");
  assert.equal(!!restoreVerifiedDiagramFromTurn(stored),accept,"restore");
  const turn={...stored,id:"offline",orderIndex:0,rawResponse:"",speedMultiplier:1,createdAt:0,segments:[],traceId:null,sceneEngineVersion:null,validationReport:null,visualStatus:"validated" as const};
  assert.equal(sourceCheckedStoredTurn(turn).visualStatus==="validated",accept,"sanitizer");
 }
 check(`${c.id}/all control seams`,()=>seams(problem,plan,true,"control"));
 const irMutations: Array<[string,(p:ProblemIR)=>void]> = [
  ["F1 requested extra operations",p=>{p.facts.find(f=>f.kind==="requested")!.statement="Find displacement and angular acceleration";}],
  ["F1 exact review speed units",p=>{const f=p.facts.find(f=>f.kind==="given"&&/\bspeed\b/.test(f.evidence.quote));if(f)f.statement=`The speed is ${f.evidence.quote.match(/\d+(?:\.\d+)?/)![0]} km/s`;else p.facts[0]!.statement="period 2 min";}],
  ["F1 role numeral swap",p=>{const f=p.facts[0]!;const radius=p.facts.find(f=>/radius/.test(f.evidence.quote))!;const rate=p.facts.find(f=>f.kind==="given"&&!/radius/.test(f.evidence.quote))!;f.evidence=structuredClone(radius.evidence);f.statement=`radius ${rate.evidence.quote.match(/\d+(?:\.\d+)?/)![0]} m`;}],
  ["F1 invented actor",p=>{p.facts[0]!.statement="A bus moves beside the car";}],
  ["F1 nonuniform fact",p=>{p.facts[0]!.statement="The speed is not constant";}],
  ["F1 wrong units",p=>{const f=p.facts.find(f=>f.kind==="given"&&/radius/.test(f.statement))!;f.statement=f.statement.replace(/\bm\b|\bcm\b|\bkm\b/,"s");}],
  ["F1 correct literal plus unsupported tail",p=>{p.facts[0]!.statement=p.facts[0]!.evidence.quote+" and speed increases";}],
  ["F3 supplied IR without entities and intents",p=>{p.entities=[];p.representationIntents=[];}],
  ["F3 supplied IR without intents",p=>{p.representationIntents=[];}],
  ["F4 incident requested only",p=>{p.constraints=[{id:"incident",kind:"incident",entityIds:p.entities.slice(0,2).map(e=>e.id),evidenceFactIds:[p.facts.find(f=>f.kind==="requested")!.id]}];}],
  ["F4 intent requested only",p=>{p.representationIntents[0]!.evidenceFactIds=[p.facts.find(f=>f.kind==="requested")!.id];}],
  ["F4 mixed intent evidence",p=>{p.representationIntents[0]!.evidenceFactIds.push(p.facts.find(f=>f.kind==="requested")!.id);}],
  ["F4 sense-only expression evidence",p=>{const source=engine.readUniformCircularRuntimeContract(c.question);assert.ok(source?.status==="bound");const scalar=p.facts.find(f=>f.kind==="given")!;p.facts.push({id:"wrongRole",kind:"given",statement:"The motion is anticlockwise",evidence:structuredClone(scalar.evidence)});p.expressions[0]!.evidenceFactIds.push("wrongRole");}],
  ["F4 mixed expression evidence",p=>{p.expressions[0]!.evidenceFactIds.push(p.facts.find(f=>f.kind==="requested")!.id);}],
 ];
 for(const [label,mutate] of irMutations) check(`${c.id}/${label}`,()=>{const p=structuredClone(problem);mutate(p);seams(p,plan,false,"ir");});
 const planMutations: Array<[string,(p:TurnPlanV3)=>void]> = [
  ["F2 outward claim",p=>{p.qualitativeClaims=[{id:"outward",claim:"Centripetal acceleration points radially outward, away from the centre.",expected:true,relatedQuantityIds:[p.derived.at(-1)!.id]}];}],
  ["F2 zero acceleration",p=>{p.qualitativeClaims=[{id:"zero",claim:"Acceleration is zero because the speed is constant.",expected:true,relatedQuantityIds:[]}];}],
  ["F2 increasing speed",p=>{p.assumptions.push("The speed is increasing with time.");}],
  ["F2 reversed or invented sense",p=>{p.assumptions.push(/anticlockwise/.test(c.question)?"The body moves clockwise.":"The body moves anticlockwise.");}],
  ["F2 false expected magnitude",p=>{p.qualitativeClaims=[{id:"falseValue",claim:"Centripetal acceleration points toward the center of the circle.",expected:"a_c = v^2/r = 0 m/s^2",relatedQuantityIds:[]}];}],
  ["F2 correct clause with false tail",p=>{p.assumptions.push("Speed is constant, but acceleration is zero.");}],
  ["F2 nongiven zero uncertainty without value",p=>{(p.unknowns[0]! as {uncertainty?:number}).uncertainty=0;}],
  ["F2 nonzero given uncertainty",p=>{p.givens[0]!.uncertainty=1;}],
  ["F2 nonzero derived uncertainty",p=>{p.derived[0]!.uncertainty=1;}],
  ["F2 unsupported physical assumption",p=>{p.assumptions.push("Friction is negligible.");}],
  ["F3 empty unknowns",p=>{p.unknowns=[];}],
  ["F3 empty plan",p=>{p.givens=[];p.derived=[];p.unknowns=[];p.assumptions=[];p.qualitativeClaims=[];}],
  ["F3 missing givens",p=>{p.givens=[];p.derived.forEach(r=>{delete r.dependsOn;delete r.sourceText;});p.qualitativeClaims=[];}],
 ];
 for(const [label,mutate] of planMutations) check(`${c.id}/${label}`,()=>{const bad=structuredClone(plan);mutate(bad);seams(problem,bad,false,"plan");});
 // Measure the parent-owned presence gap; never count source-only admission
 // as evidence that the original full IR was retained.
 if (["car","stone","clockwise"].includes(c.id)) {
  const noIR={question:c.question,sceneDocument:doc,sceneArtifacts:{turnPlan:plan,representationTier:"qualitative_verified" as const}};
  console.log("PARENT_HOOK "+JSON.stringify({case:c.id,missingOriginalIR:true,sourceOnlySynthesis:!!engine.synthesizeFamilyScene({question:c.question,turnPlan:plan}),rawReadFatal:rawStoredTurnSourceIssues(doc,noIR).some(r=>r.severity==="fatal"),restored:!!restoreVerifiedDiagramFromTurn(noIR),disposition:"outside actual-full-IR scope; parent must enforce presence"}));
 }
 check(`${c.id}/F3 empty plan without IR`,()=>{
  const stripped=structuredClone(plan);stripped.givens=[];stripped.derived=[];stripped.unknowns=[];stripped.qualitativeClaims=[];stripped.assumptions=[];
  assert.equal(engine.validateTurnPlanV3(stripped,c.question).valid,true);
  assert.equal(engine.synthesizeFamilyScene({question:c.question,turnPlan:stripped}),null);
  const admission={document:doc,question:c.question,turnPlan:stripped,tier:"qualitative_verified" as const};
  const stored={question:c.question,sceneDocument:doc,sceneArtifacts:{turnPlan:stripped,representationTier:"qualitative_verified" as const}};
  assert.ok(liveSceneSaveFailure(admission));assert.ok(sceneSaveAdmissionFailure(admission));assert.ok(rawStoredTurnSourceIssues(doc,stored).some(r=>r.severity==="fatal"));assert.equal(restoreVerifiedDiagramFromTurn(stored),null);
 });
 check(`${c.id}/exact source quotes`,()=>{const p=structuredClone(problem);p.facts.forEach(f=>{if(f.kind!=="assumption")f.statement=f.evidence.quote;});seams(p,plan,true,"control");});
 check(`${c.id}/complete request and formula evidence proof`,()=>{const p=structuredClone(problem);const expression=p.expressions[0]!;const request=p.solveRequests.find(r=>r.kind==="evaluate"&&r.expressionId===expression.id)!;const ask=request.resultBinding!.evidenceFactIds.find(id=>p.facts.find(f=>f.id===id)?.kind==="requested")!;expression.evidenceFactIds.push(ask);request.resultBinding!.evidenceFactIds=[...expression.evidenceFactIds];seams(p,plan,true,"control");});
 check(`${c.id}/bounded true plan assertions`,()=>{const p=structuredClone(plan);p.assumptions.push("Speed is constant","Centripetal acceleration is perpendicular to velocity","Velocity is tangent to the circle");p.qualitativeClaims.push({id:"inward",claim:"Centripetal acceleration points radially inward toward the centre.",expected:true,relatedQuantityIds:[]});p.derived.forEach(row=>{row.uncertainty=0;});seams(problem,p,true,"control");});
 check(`${c.id}/setup incident positive`,()=>{const p=structuredClone(problem);p.constraints=[{id:"setup",kind:"incident",entityIds:p.entities.slice(0,2).map(e=>e.id),evidenceFactIds:p.facts.filter(f=>f.kind==="given").map(f=>f.id)}];seams(p,plan,true,"control");});
}
console.log(`${checks} whole UCM groups, ${failures.length} failures`);
assert.deepEqual(failures,[]);
