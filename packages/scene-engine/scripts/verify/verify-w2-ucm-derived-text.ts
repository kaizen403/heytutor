/** Complete captured IR/Plan controls and derived text regressions. Offline only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as engine from "../../src/index";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { ProblemIR } from "../../src/ir/problemIR";
import { normalizeProblemIRModelOutput } from "../../../tutor-core/src/planners/problemPlannerV1";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { rawStoredTurnSourceIssues, sourceCheckedStoredTurn } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { restoreVerifiedDiagramFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { canonicalizeTurnSceneMetadata } from "../../../../apps/tutor/lib/scene/turnScenePersistence";
import { buildTurnTeachingPrompt } from "../../../../apps/tutor/features/tutor-session/lib/turn/turnTeachingPrompt";
const load = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
interface Capture {question:string;rawIRs:unknown[];canonicalPlan:TurnPlanV3;expected?:number[]}
const cases = ["car", "stone", "clockwise"].map((id,i)=>({id,...load<Capture>(`./fixtures/w2-ucm-live-20261006/w2-ucm-${id}.json`),expected:[[8,5*Math.PI],[.8*Math.PI,.8*Math.PI**2],[.5,3]][i]!}));
cases.push(...[1,2,3,4].map(i=>({id:`independent-${i}`,...load<Capture>(`./fixtures/w2-ucm-derived-text-20261006/independent-${i}.json`),expected:load<Capture>(`./fixtures/w2-ucm-derived-text-20261006/independent-${i}.json`).expected!})));
let groups=0; const failures:string[]=[];
async function check(label:string,run:()=>unknown|Promise<unknown>) {groups++;try{await run();console.log(`PASS ${label}`);}catch(e){failures.push(`${label}: ${e instanceof Error?e.message:String(e)}`);console.log(`FAIL ${failures.at(-1)}`);}}
const channels=["facts","entities","expressions","constraints","representationIntents","solveRequests"] as const;
for (const c of cases) {
 const normalized=engine.validateProblemIR(normalizeProblemIRModelOutput(c.rawIRs[0],c.question,c.canonicalPlan),c.question);
 assert.ok(normalized.valid&&normalized.problem);const problem=normalized.problem;
 for(const key of channels) assert.deepEqual(problem[key].map(row=>row.id),(c.rawIRs[0] as Record<string,{id:string}[]>)[key]!.map(row=>row.id));
 const solved=await new engine.LocalDeterministicSolverProvider().solve(problem);
 problem.solveRequests.forEach((r,i)=>assert.ok(Math.abs(Number(solved.values.find(v=>v.requestId===r.id)!.approximate)-c.expected[i]!)<1e-12));
 const positive=structuredClone(c.canonicalPlan);
 // The complete original stone is a negative. A new positive changes only
 // the false text; every original Plan and IR row/obligation remains.
 if(c.id==="stone") {
  positive.derived[0]!.sourceText="v = 2*pi*r/T = 2*pi*0.8/2 = 0.8*pi ≈ 2.513";
  positive.derived[1]!.sourceText="a_c = v^2/r = (2*pi*0.8/2)^2/0.8 = 0.8*pi^2 ≈ 7.896";
 }
 const plan=engine.applySourceQuantityAuthority(positive,problem,c.question).plan;
 assert.ok(engine.uniformCircularRuntimePlanConflicts(c.question,plan).length===0,`${c.id} positive text proof`);
 const scene=engine.synthesizeFamilyScene({question:c.question,turnPlan:plan,problemIR:problem});assert.ok(scene,`${c.id} complete positive scene`);
 const doc=scene.document;
 async function seams(p:ProblemIR,t:TurnPlanV3,accept:boolean) {
  const before=structuredClone(t),originalIR=structuredClone(p);
  const sourceAuthority={question:c.question,problemIR:p,turnPlan:t};
  const applied=engine.applySourceQuantityAuthority(t,p,c.question);
  if(!accept) {assert.strictEqual(applied.plan,t,"raw Plan reference retained");assert.deepEqual(applied.plan,before,"raw Plan retained in full");assert.ok(applied.outcomes.some(o=>o.declineFigure));assert.ok(applied.outcomes.every(o=>o.corrections.length===0));}
  else assert.ok(applied.outcomes.every(o=>!o.declineFigure));
  assert.deepEqual(p,originalIR);assert.deepEqual(t,before,"input not mutated");
  assert.equal(engine.uniformCircularRuntimePlanConflicts(c.question,t).length===0,accept,"text conflicts");
  assert.equal(engine.uniformCircularCallerIssues(c.question,p,t).every(i=>i.severity!=="fatal"),accept,"caller");
  assert.equal(!!engine.synthesizeFamilyScene(sourceAuthority),accept,"family");
  assert.equal(!!engine.validateSceneDocument(doc,{sourceAuthority}).document,accept,"structural");
  assert.equal(engine.validateSceneSourceAuthority(doc,c.question,p,t).every(i=>i.severity!=="fatal"),accept,"central");
  const compiled=engine.compileSceneDocument(doc,{sourceAuthority});assert.equal(compiled.ok,accept,"compile");assert.equal(!!compiled.renderScene,accept,"atomic render");
  const admission={...sourceAuthority,document:doc,tier:"qualitative_verified" as const};
  assert.equal(liveSceneSaveFailure(admission)===null,accept,"live");assert.equal(sceneSaveAdmissionFailure(admission)===null,accept,"save");
  const stored=JSON.parse(JSON.stringify({id:"offline",orderIndex:0,question:c.question,sceneDocument:doc,sceneArtifacts:{turnPlan:t,problemIR:p,representationTier:"qualitative_verified"},visualStatus:"validated",segments:[]},(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));
  assert.equal(rawStoredTurnSourceIssues(doc,stored).every(i=>i.severity!=="fatal"),accept,"raw read");assert.equal(sourceCheckedStoredTurn(stored).visualStatus==="validated",accept,"sanitizer");assert.equal(!!restoreVerifiedDiagramFromTurn(stored),accept,"restore");
  const audit=engine.verifyTurnPlanAgainstSolver(p,solved,t,c.question);
  const canonical=await canonicalizeTurnSceneMetadata({question:c.question,sceneDocument:doc,visualStatus:"validated",segments:[],sceneArtifacts:{schemaVersion:"scene-artifacts/v3",diagramResultStatus:"ready",representationTier:"qualitative_verified",nonMetric:true,turnPlan:t,problemIR:p,solverResult:solved,solverAuthority:audit,candidates:[]}});
  assert.equal(canonical.ok,accept,"canonical save");
  if(accept&&canonical.ok) {
   assert.deepEqual(canonical.value.sceneArtifacts?.turnPlan,t,"full persisted Plan");
   assert.deepEqual(canonical.value.sceneArtifacts?.problemIR,p,"full persisted IR");
  }
  assert.deepEqual(p,originalIR,"all seams retain original IR");assert.deepEqual(t,before,"all seams retain original Plan");
  assert.deepEqual(stored.sceneArtifacts.turnPlan,t,"stored bad Plan remains raw");
 }
 await check(`${c.id}/complete positive all seams`,()=>seams(problem,plan,true));
 if(["car","stone","clockwise"].includes(c.id)) {
  const repro=load<{problemIR:ProblemIR;turnPlan:TurnPlanV3}>(`./fixtures/w2-ucm-derived-text-20261006/${c.id}-false-text-repro.json`);
  await check(`${c.id}/fresh report exact repro all seams`,()=>seams(repro.problemIR,repro.turnPlan,false));
 }
 if(c.id==="stone") await check("stone/unaltered actual false rounded intermediates",()=>seams(problem,c.canonicalPlan,false));
 const mutations:Array<[string,(p:TurnPlanV3)=>void]>=[
  ["false zero physical sentence",p=>{p.derived[0]!.sourceText="Centripetal acceleration is zero because speed is constant.";}],
  ["valid derivation false outward tail",p=>{p.derived[0]!.sourceText+="; acceleration points radially outward.";}],
  ["valid derivation false a=0",p=>{p.derived[0]!.sourceText+="; a_c = 0";}],
  ["unrelated true arithmetic",p=>{p.derived[0]!.sourceText+="; 1 = 1";}],
  ["unrelated physical claim",p=>{p.derived[0]!.sourceText+="; friction is negligible.";}],
  ["unsupported prose",p=>{p.derived[0]!.sourceText="By an unspecified theorem this is true.";}],
  ["empty text",p=>{p.derived[0]!.sourceText="";}],
  ["nonstring text",p=>{(p.derived[0] as unknown as {sourceText:unknown}).sourceText=42;}],
  ["arithmetic overflow",p=>{p.derived[0]!.sourceText=`${p.derived[0]!.symbol} = 1e400`;}],
  ["equal answer wrong expression",p=>{const r=p.derived[0]!;r.sourceText=`${r.symbol} = ${r.value*31}/31`;}],
  ["same-valued wrong source role",p=>{p.derived[0]!.sourceText="a_c = r^2/r";}],
  ["canceling radius role",p=>{const r=p.derived[0]!;r.sourceText=`${r.symbol} = ${r.value}*r/r`;}],
  ["canceling period role",p=>{const r=p.derived[0]!;r.sourceText=`${r.symbol} = ${r.value}+T-T`;}],
  ["bad text and stale bound scalar no laundering",p=>{p.derived[0]!.value+=1;p.derived[0]!.sourceText="a_c = 0; acceleration points outward.";}],
  ["unproved exact truncation",p=>{const r=p.derived[0]!;r.sourceText=`${r.symbol} = ${r.value.toFixed(3)}`;if(Number(r.value.toFixed(3))===r.value)r.sourceText=`${r.symbol} = ${r.value+0.001}`;}],
  ["approximate intermediate reused",p=>{const r=p.derived[0]!;r.sourceText=`${r.symbol} ≈ ${r.value.toFixed(3)} = ${r.value}`;}],
  ["formula plus inline physical claim",p=>{p.derived[0]!.sourceText+=" because acceleration is zero";}],
  ["wrong equation role",p=>{p.derived[0]!.sourceText="r = r";}],
  ["wrong member units",p=>{const r=p.derived[0]!;r.sourceText=`${r.symbol} = ${r.value} N`;}],
  ["unbounded expression",p=>{p.derived[0]!.sourceText="a_c = "+"(".repeat(130)+"8"+")".repeat(130);}],
 ];
 for(const [label,mutate] of mutations) await check(`${c.id}/${label} all seams`,()=>{const bad=structuredClone(plan);mutate(bad);return seams(problem,bad,false);});
 const formulas:Record<string,string>={"a_c":"v^2/r","ω":"v/r",omega:"v/r",v:"2*pi*r/T",T:"2*pi*r/v"};
 await check(`${c.id}/exact symbolic formula and complete safe prose`,()=>{const safe=structuredClone(plan);safe.derived.forEach(r=>{r.sourceText=`${r.symbol} = ${formulas[r.symbol]}; Speed is constant; Centripetal acceleration points toward the centre.`;});return seams(problem,safe,true);});
 await check(`${c.id}/direction suffix preserves quantity role`,()=>{
  const row=plan.derived.find(r=>engine.uniformCircularRuntimeQuantityRole(r)!=="acceleration");assert.ok(row);
  const bad=structuredClone(plan);bad.derived.find(r=>r.id===row.id)!.sourceText=`${row.symbol} = ${row.value}, directed radially inward`;
  return seams(problem,bad,false);
 });
 await check(`${c.id}/scalar correction preserves independently proved text and all obligations`,()=>{
  const stale=structuredClone(plan);stale.derived[0]!.value+=1;
  const result=engine.applySourceQuantityAuthority(stale,problem,c.question);
  assert.ok(result.outcomes.every(o=>!o.declineFigure));
  const expected=structuredClone(stale);expected.derived[0]!.value=plan.derived[0]!.value;
  assert.deepEqual(result.plan,expected);
  assert.deepEqual(stale.derived[0]!.sourceText,result.plan.derived[0]!.sourceText);
 });
 // The parent prompt has no refusal discriminator at this pin. Preserve and
 // measure this remaining integration obligation; never bless it as safe.
 const bad=structuredClone(plan);bad.derived[0]!.sourceText="Centripetal acceleration is zero because speed is constant.";
 const refused=engine.applySourceQuantityAuthority(bad,problem,c.question);
 const prompt=buildTurnTeachingPrompt({question:c.question,diagramPromptAddon:"",turnPlan:refused.plan,solverProjection:null,codeLesson:null,isDsa:false,familiarity:"revision",fastMode:false});
 console.log("PARENT_TEACHING_HOOK "+JSON.stringify({case:c.id,declineFigure:refused.outcomes.some(o=>o.declineFigure),rawPlanRetained:JSON.stringify(refused.plan)===JSON.stringify(bad),unsafePromptStillContainsRawText:prompt.runtimeAddon.includes(bad.derived[0]!.sourceText!),required:"typed refusal must retain raw Plan outside authoritative prompt; parent owns hook"}));
}
console.log(`${groups} derived-text groups, ${failures.length} failures (${process.env.UCM_GATE_MODE})`);
assert.deepEqual(failures,[]);
