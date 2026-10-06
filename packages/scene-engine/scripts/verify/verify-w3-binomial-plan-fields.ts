import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "../../src/index";
import type { StoredTurn } from "../../../../apps/tutor/lib/boards/boardsClient";
import { liveSceneSaveFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../../../apps/tutor/lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";

const esm = process.argv.includes("--esm");
const engine: typeof import("../../src/index") = esm
  ? await import(new URL("../../dist/index.js", import.meta.url).href)
  : await import("../../src/index");
const mutations = JSON.parse(readFileSync(new URL("./fixtures/w3-binomial-plan-fields/mutations.json", import.meta.url), "utf8")) as Array<{name:string;placement:"root"|"derived"|"unknown"|"given"}>;
const question = "Coefficient of x^2 in the expansion of (2+x)^6 is";
const expression = "(2+x)^6";
const evidence = (quote:string) => { const start=question.indexOf(quote); return {source:"question" as const,start,end:start+quote.length,quote}; };
const problem = {
  schemaVersion:"problem-ir/v1" as const,id:"plan_fields",question,
  facts:[{id:"premise",kind:"given" as const,statement:expression,evidence:evidence(expression)},{id:"requested",kind:"requested" as const,statement:"Coefficient of x^2 in the expansion of",evidence:evidence("Coefficient of x^2 in the expansion of")}],
  entities:[{id:"polynomial",kind:"other" as const,label:"P(x)",evidenceFactIds:["premise"]}],
  expressions:[{id:"source",valueType:"function" as const,root:{kind:"binary" as const,operator:"^" as const,left:{kind:"binary" as const,operator:"+" as const,left:{kind:"number" as const,value:2},right:{kind:"variable" as const,name:"x"}},right:{kind:"number" as const,value:6}},evidenceFactIds:["premise"]},{id:"coefficient",valueType:"scalar" as const,root:{kind:"number" as const,value:240},evidenceFactIds:["requested"]}],
  constraints:[],representationIntents:[{id:"scope",kind:"conceptual" as const,entityIds:["polynomial"],evidenceFactIds:["premise","requested"]}],
  solveRequests:[{id:"actual_request",kind:"evaluate" as const,expressionId:"coefficient",resultBinding:{turnPlanQuantityId:"actual_answer",symbol:"C_2",unit:"1",evidenceFactIds:["requested"]}}],
};
const cleanPlan:TurnPlanV3 = {
  schemaVersion:"turn-plan/v3",question,
  givens:[{id:"n",symbol:"n",value:6,unit:"1",provenance:"given",sourceText:"Exponent 6 in (2+x)^6"}],
  unknowns:[{id:"actual_answer",symbol:"C_2",unit:"1"}],
  derived:[{id:"actual_answer",symbol:"C_2",value:240,unit:"1",sign:"positive",sourceText:"Coefficient of x^2",provenance:"derived",dependsOn:["n"],uncertainty:0}],
  qualitativeClaims:[{id:"coefficient-sign",claim:"coefficient_positive",expected:true,relatedQuantityIds:["actual_answer"],relatedEntityHints:[]}],
  lawIds:[],assumptions:["Finite algebraic expansion."],visualRequirement:"required",teachingSequenceHints:[],
};
const document = engine.finiteBinomialSourceDocument(question,problem);
assert.ok(document,"source-derived finite-binomial document exists");
const records:Array<{name:string;actual:unknown;expected:unknown;passed:boolean}> = [];
function check(name:string,actual:unknown,expected:unknown):void{
  let passed=true;try{assert.deepEqual(actual,expected);}catch{passed=false;}
  records.push({name,actual,expected,passed});
}
const accepted={structural:true,compile:true,central:true,live:true,save:true,read:"validated",restore:true};
const rejected={structural:false,compile:false,central:false,live:false,save:false,read:"retry_required",restore:false};
async function seams(plan:TurnPlanV3){
  const authority={question,problemIR:problem,turnPlan:plan};
  const structural=engine.validateSceneDocument(document!,{sourceAuthority:authority});
  const compiled=engine.compileSceneDocument(document!,{sourceAuthority:authority});
  const solver=engine.solveFiniteBinomialProblem(question,problem);
  const artifacts={schemaVersion:"scene-artifacts/v3",turnPlan:plan,problemIR:problem,solverResult:solver,
    solverAuthority:solver?engine.verifyTurnPlanAgainstSolver(problem,solver,plan,question):null,
    representationTier:"exact_verified",nonMetric:true,candidates:[],selectedCandidateId:null,
    selectionReason:"F5 actual-plan field guard",diagramResultStatus:"ready",proofObligations:[]};
  const turn:StoredTurn={id:"offline",question,rawResponse:"",orderIndex:0,speedMultiplier:2,traceId:null,segments:[],sceneDocument:document!,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
  const saved=await canonicalizeTurnSceneMetadata({question,sceneDocument:document!,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});
  const read=sourceCheckedStoredTurn(JSON.parse(JSON.stringify(turn)));
  const restored=restoreVerifiedPresentationFromTurn(JSON.parse(JSON.stringify(turn)));
  return {structural:!!structural.document&&structural.report.valid,compile:compiled.ok,central:engine.validateSceneSourceAuthority(document!,question,problem,plan).length===0,
    live:liveSceneSaveFailure({document:document!,question,problemIR:problem,turnPlan:plan,tier:"exact_verified"})===null,
    save:saved.ok,read:read.visualStatus,restore:!!restored};
}
check("clean exact actual-plan five-core control",await seams(cleanPlan),accepted);
check("clean plan retains proved givens/derived/unknowns/claims/assumptions/certainty",
  [cleanPlan.givens.length,cleanPlan.derived[0]?.sign,cleanPlan.derived[0]?.sourceText,cleanPlan.derived[0]?.provenance,cleanPlan.derived[0]?.dependsOn,cleanPlan.derived[0]?.uncertainty,cleanPlan.qualitativeClaims.length,cleanPlan.assumptions.length],
  [1,"positive","Coefficient of x^2","derived",["n"],0,1,1]);
for(const mutation of mutations){
  const poisoned=structuredClone(cleanPlan) as TurnPlanV3 & Record<string,unknown>;
  const payload={extraObligations:["Prove every coefficient and describe all sign changes"]};
  if(mutation.placement==="root")Object.assign(poisoned,payload);
  else if(mutation.placement==="derived")Object.assign(poisoned.derived[0]!,payload);
  else if(mutation.placement==="unknown")Object.assign(poisoned.unknowns[0]!,payload);
  else Object.assign(poisoned.givens[0]!,payload);
  const before=structuredClone(poisoned),actual=engine.applyFiniteBinomialAuthority(question,poisoned,problem);
  check(`${mutation.name} all seven authority seams`,await seams(poisoned),rejected);
  check(`${mutation.name} plan validation rejects before canonicalization`,engine.finiteBinomialPlanIssues(question,problem,poisoned).some(row=>row.severity==="fatal"),true);
  check(`${mutation.name} early authority declines and withdraws numeric/claim roles`,actual?[actual.plan.givens.length,actual.plan.derived.length,actual.plan.unknowns.length,actual.plan.qualitativeClaims.length,actual.declineFigure,actual.issueCodes]:null,[0,0,0,0,true,["finite_binomial_plan_fields_declined"]]);
  check(`${mutation.name} original Plan evidence retained for inspection`,actual?.declinedPlanEvidence,before);
  check(`${mutation.name} caller payload and obligation evidence retained`,poisoned,before);
}
const failures=records.filter(row=>!row.passed);
console.log(JSON.stringify({mode:esm?"public ESM":"source",checks:records.length,failures:failures.length,failed:failures},null,2));
if(failures.length)process.exitCode=1;
