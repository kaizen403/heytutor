import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "@heytutor/scene-engine";
import { parseTurnPlanV3Content, planProblemAuthorityV1 } from "@heytutor/tutor-core";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { boardContinuationArtifacts, boardContinuationOf } from "../../lib/boards/boardContinuation";
import type { StoredTurn } from "../../lib/boards/boardsClient";

type Case = {question:string;problem:E.ProblemIR;plan:E.TurnPlanV3};
type Artifacts = Record<string, unknown>;
let checks = 0;
const equal = (actual:unknown, expected:unknown, label:string) => {assert.deepEqual(actual,expected,label);checks++;};
function check(value:unknown,label:string):asserts value {assert(value,label);checks++;}
const json = <T,>(value:T):T => JSON.parse(JSON.stringify(value));
const capture = JSON.parse(readFileSync(new URL("fixtures/w3-numeric-text-persistence-20261006/new255signed-count31.json", import.meta.url), "utf8")) as Case & {solverResult:E.SolverResult;apiAudit:E.SolverAuthorityAudit;rawContent:string;rawInput: {rawProblemIR:unknown;rawTurnPlan:unknown;issueCodes:string[]}};
const segment = {orderIndex:0,narration:"The calculation follows from the stated values.",spokenText:"The calculation follows from the stated values.",command:{type:"WRITE",params:[20,120],text:"N = 31",charPosition:0,narrationBefore:""}};
function stored(metadata:SubmittedTurnSceneMetadata):StoredTurn {
 return {id:"offline-numeric",question:metadata.question,rawResponse:"",orderIndex:0,speedMultiplier:1,traceId:null,
  sceneDocument:metadata.sceneDocument ?? null,sceneArtifacts:metadata.sceneArtifacts ?? null,
  visualStatus:metadata.visualStatus ?? "text_only",sceneEngineVersion:null,validationReport:null,
  segments:metadata.segments.map(row=>({...row,id:`segment-${row.orderIndex}`,command:row.command as StoredTurn["segments"][number]["command"],audioUrl:null,durationMs:500,timings:null}))};
}
async function artifacts(c:Case):Promise<Artifacts> {
 return {schemaVersion:"scene-artifacts/v3",turnPlan:c.plan,problemIR:c.problem,
  solverResult:await new E.LocalDeterministicSolverProvider().solve(c.problem),
  solverAuthority:{status:"verified",bindings:[{quantityId:"FORGED",approximate:999}],issues:[]},
  candidates:[],selectedCandidateId:null,proofObligations:[],diagramResultStatus:"text_only"};
}
async function positive(c:Case,expected:number[],label:string,submitted?:Artifacts):Promise<Artifacts> {
 const input=submitted ?? await artifacts(c),before=JSON.stringify(input);
 const saved=await canonicalizeTurnSceneMetadata({question:c.question,visualStatus:"text_only",segments:[segment],sceneArtifacts:input});
 check(saved.ok,`${label}: save admitted`);check(saved.value.sceneArtifacts,`${label}: numeric artifacts persisted`);
 equal(saved.value.visualStatus,"text_only",`${label}: numeric authority never promotes visual status`);
 equal([saved.value.sceneDocument,saved.value.sceneEngineVersion,saved.value.validationReport],[null,null,null],`${label}: no invented scene`);
 const persisted=json(saved.value.sceneArtifacts);
 equal(persisted.problemIR,c.problem,`${label}: FULL original IR unchanged`);
 equal(persisted.turnPlan,c.plan,`${label}: FULL original Plan unchanged`);
 equal(persisted.solverAuthority?.status,"verified",`${label}: fresh server audit`);
 equal(persisted.solverAuthority?.bindings.some(row=>row.quantityId==="FORGED"),false,`${label}: cached audit ignored`);
 expected.forEach((value,i)=>check(Math.abs((persisted.solverResult!.values[i]!.approximate as number)-value)<1e-10*Math.max(1,Math.abs(value)),`${label}: independent output ${i}`));
 const turn=stored({question:c.question,...json(saved.value)});
 const read=sourceCheckedStoredTurn(turn),readArtifacts=json(read.sceneArtifacts) as E.SceneArtifactsV3;
 equal(readArtifacts.problemIR,c.problem,`${label}: JSON/read original IR`);
 equal(readArtifacts.turnPlan,c.plan,`${label}: JSON/read original Plan`);
 equal(readArtifacts.solverAuthority?.status,"verified",`${label}: read fresh authority`);
 check(readArtifacts.solverResult && readArtifacts.solverAuthority,`${label}: replay authority payload complete`);
 equal((E.buildSolverAuthorityProjection(readArtifacts.problemIR!,readArtifacts.solverResult,readArtifacts.solverAuthority).bindings as unknown[]).length,c.plan.derived.length,`${label}: replay numeric projection`);
 equal(restoreVerifiedPresentationFromTurn(read),null,`${label}: replay has no figure`);
 const replay=buildReplayTimeline([read]);equal(replay.cues.length,1,`${label}: writing replay retained`);
 equal(replay.cues[0]?.trustedDiagramGeometry,false,`${label}: no trusted geometry`);
 equal(json(sourceCheckedStoredTurn(read)),json(read),`${label}: read normalization idempotent`);
 const resaved=await canonicalizeTurnSceneMetadata({question:c.question,visualStatus:"text_only",segments:[segment],sceneArtifacts:read.sceneArtifacts});
 check(resaved.ok && resaved.value.sceneArtifacts?.problemIR,`${label}: normalized numeric payload can resave`);
 equal(JSON.stringify(input),before,`${label}: caller never modified`);
 return persisted as unknown as Artifacts;
}
async function negative(c:Case,input:Artifacts,label:string,question=c.question):Promise<void> {
 const saved=await canonicalizeTurnSceneMetadata({question,visualStatus:"text_only",segments:[segment],sceneArtifacts:input});
 check(saved.ok,`${label}: text lesson still saves after numeric decline`);
 equal([saved.value.sceneArtifacts?.problemIR ?? null,saved.value.sceneArtifacts?.solverResult ?? null,saved.value.sceneArtifacts?.solverAuthority ?? null,saved.value.sceneArtifacts?.turnPlan ?? null],[null,null,null,null],`${label}: no authority or smaller Plan saved`);
 equal(saved.value.sceneDocument,null,`${label}: no repaired/invented figure`);
 const read=sourceCheckedStoredTurn(stored({question,visualStatus:"text_only",segments:[segment],sceneArtifacts:input}));
 const a=read.sceneArtifacts as Artifacts;
 equal([a.problemIR ?? null,a.solverResult ?? null,a.solverAuthority ?? null,a.turnPlan ?? null],[null,null,null,null],`${label}: historical/untrusted read removes numeric authority`);
 equal(buildReplayTimeline([read]).cues.length,1,`${label}: replay narration survives`);
}
function countCase(diameter:number,error:number,expected:number,main:number):Case {
 const question=`Least count corresponding to the main scale and circular scale of a screw gauge are 0.5 mm and 0.005 mm, respectively. A wire of diameter ${diameter} mm is measured with the screw gauge. What would be the reading of divisions on circular scale of the screw gauge, if the zero error of the screw gauge is ${error<0?error:`+${error}`} mm?`;
 const reading=E.readScrewGaugeQuestion(question);check(reading.status==="ok","independent source grammar");
 const roles=["pitch","least_count","true_reading","zero_error","circular_reading"] as const;
 const c=structuredClone(capture);c.question=question;c.problem.question=question;c.plan.question=question;
 c.problem.facts.forEach((fact,i)=>fact.evidence=reading.evidence[roles[i]!]![0]!);
 c.plan.givens.forEach((row,i)=>{row.value=[.5,.005,diameter,error][i]!;row.sourceText=c.problem.facts[i]!.evidence.quote;delete row.sign;});
 c.plan.derived[0]!.value=expected;c.plan.derived[0]!.sourceText=c.problem.facts.map(f=>f.evidence.quote).join(" | ");
 const n=(value:number):E.ExpressionNodeIR=>({kind:"number",value});
 c.problem.expressions[0]!.root={kind:"binary",operator:"/",left:{kind:"binary",operator:"-",left:{kind:"binary",operator:"+",left:n(diameter),right:n(error)},right:n(main)},right:n(.005)};
 return c;
}
// The corrected parent diagnostic parses directly to Plan, not {plan}.
const parsedPrimary=parseTurnPlanV3Content(JSON.stringify(capture.plan),capture.question);
equal(parsedPrimary,capture.plan,"new actual primary parse retains the complete direct Plan");
const api=await planProblemAuthorityV1(capture.question,parsedPrimary,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:capture.rawContent}}]}),{status:200})});
check(api && !("status" in api),"new actual primary normal API has whole source authority");
equal(api.problemIR,capture.problem,"new actual primary normal API retains full original IR identities");
equal(api.audit.status,"verified","new actual primary normal API verified");
const actual=await positive(capture,[31],"NEW actual primary signed count31",{schemaVersion:"scene-artifacts/v3",turnPlan:capture.plan,problemIR:capture.problem,solverResult:capture.solverResult,solverAuthority:capture.apiAudit,diagramResultStatus:"text_only"});
const earlier=JSON.parse(readFileSync(new URL("fixtures/w3-numeric-text-persistence-20261006/captured-signed-source31.json",import.meta.url),"utf8")) as Case;
await positive(earlier,[31],"earlier typed full source31 control; no new-actual credit");
const alternate=JSON.parse(readFileSync(new URL("fixtures/w3-numeric-text-persistence-20261006/new255signed-count31-alternate-refusal.json",import.meta.url),"utf8")) as {question:string;plan:E.TurnPlanV3;rejection:Record<string,unknown> & {issueCodes:string[];rawContent:string}};
const parsedAlternate=parseTurnPlanV3Content(JSON.stringify(alternate.plan),alternate.question);
equal(parsedAlternate,alternate.plan,"new actual alternate direct Plan remains whole");
const alternateApi=await planProblemAuthorityV1(alternate.question,parsedAlternate,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:alternate.rejection.rawContent}}]}),{status:200})});
check(alternateApi && "status" in alternateApi,"new actual alternate normal API refuses");
equal(alternateApi.status,"source_declined","new actual alternate API source_declined");
equal(alternateApi.issueCodes,["plan_binding_incomplete"],"new actual alternate keeps precise refusal");
equal(alternateApi.rawTurnPlan,alternate.plan,"new actual alternate original Plan not reconciled/pruned");
await negative(capture,{...structuredClone(actual),turnPlan:alternate.plan},"new actual alternate Plan refused without cached refusal crutch");
await negative(capture,{...structuredClone(actual),turnPlan:alternate.plan,problemIRRejection:alternate.rejection},"new actual alternate explicit refusal remains opaque");
const alternateSaved=await canonicalizeTurnSceneMetadata({question:alternate.question,visualStatus:"text_only",segments:[],sceneArtifacts:{...structuredClone(actual),turnPlan:alternate.plan,problemIRRejection:alternate.rejection}});check(alternateSaved.ok,"new actual alternate diagnostic saves");
equal(alternateSaved.value.sceneArtifacts?.problemIRRejection,alternate.rejection,"new actual alternate complete refusal diagnostic retained");
for(const [diameter,error,expected,main] of [[2.695,0,39,2.5],[3,0,0,3],[2.99,.005,99,2.5]] as const)await positive(countCase(diameter,error,expected,main),[expected],`independent count${expected}`);
const claim=structuredClone(capture);claim.plan.qualitativeClaims.push({id:"proved",claim:"circular_divisions",expected:31,relatedQuantityIds:["circular_reading"]});await positive(claim,[31],"complete true claim retained");

const irLocations=["root","fact","evidence","entity","expression","AST","request","binding"];
for(const location of irLocations){
 const input=structuredClone(actual),p=input.problemIR as E.ProblemIR;
 const target=location==="root"?p:location==="fact"?p.facts[0]:location==="evidence"?p.facts[0]!.evidence:location==="entity"?p.entities[0]:location==="expression"?p.expressions[0]:location==="AST"?p.expressions[0]!.root:location==="request"?p.solveRequests[0]:p.solveRequests[0]!.resultBinding;
 (target as unknown as Artifacts).hiddenClaim="force = 999 N";
 await negative(capture,input,`hidden IR ${location}`);
}
for(const location of ["root","given","derived","unknown","claim"]){
 const input=structuredClone(actual),p=input.turnPlan as E.TurnPlanV3;
 if(location==="claim")p.qualitativeClaims.push({id:"bad",claim:"circular_divisions",expected:31,relatedQuantityIds:["circular_reading"],hiddenClaim:"F=999"} as E.TurnPlanV3["qualitativeClaims"][number]);
 else ((location==="root"?p:location==="given"?p.givens[0]:location==="derived"?p.derived[0]:p.unknowns[0]) as unknown as Artifacts).hiddenClaim="F=999";
 await negative(capture,input,`hidden Plan ${location}`);
}
const mutations:Array<[string,(a:Artifacts)=>void]>=[
 ["stale Plan",a=>(a.turnPlan as E.TurnPlanV3).derived[0]!.value=35],
 ["false extra output",a=>(a.turnPlan as E.TurnPlanV3).derived.push({id:"force",symbol:"F",unit:"N",value:999,provenance:"derived"})],
 ["false original claim",a=>(a.turnPlan as E.TurnPlanV3).qualitativeClaims.push({id:"false",claim:"circular_divisions",expected:35,relatedQuantityIds:["circular_reading"]})],
 ["extra unknown",a=>(a.turnPlan as E.TurnPlanV3).unknowns.push({id:"force",symbol:"F",unit:"N"})],
 ["malformed original known field",a=>((a.problemIR as E.ProblemIR).entities[0] as unknown as Artifacts).label=12],
 ["stale Solver",a=>{const v=(a.solverResult as E.SolverResult).values[0]!;v.approximate=35;v.exact={kind:"integer",value:"35"};}],
 ["wide Solver bound",a=>{const v=(a.solverResult as E.SolverResult).values[0]!;v.approximate=35;v.errorBound=100;}],
 ["forged symbolic exact",a=>(a.solverResult as E.SolverResult).values[0]!.exact={kind:"symbolic",value:"F999"}],
 ["missing IR",a=>a.problemIR=null],
 ["Plan-only payload with absent IR",a=>{a.problemIR=null;a.solverResult=null;a.solverAuthority=null;}],
 ["no Plan numeric audit",a=>{a.problemIR=null;a.solverResult=null;a.turnPlan=null;}],
 ["unconsumed same-value AST",a=>{const p=a.problemIR as E.ProblemIR;p.expressions[0]!.root={kind:"binary",operator:"+",left:p.expressions[0]!.root,right:{kind:"binary",operator:"*",left:{kind:"number",value:0},right:{kind:"number",value:999}}};}],
 ["missing Solver",a=>a.solverResult=null],
 ["missing Plan",a=>a.turnPlan=null],
 ["partial Solver",a=>(a.solverResult as E.SolverResult).status="partial"],
 ["extra Solver output",a=>{const r=a.solverResult as E.SolverResult;r.values.push({...r.values[0]!,id:"extra",requestId:"foreign"});}],
 ["raw compact refused payload",a=>a.problemIR=capture.rawInput.rawProblemIR],
 ["apparatus Plan",a=>(a.turnPlan as E.TurnPlanV3).visualRequirement="required"],
];
for(const [label,mutate] of mutations){const input=structuredClone(actual);mutate(input);await negative(capture,input,label);}
await negative(capture,structuredClone(actual),"whole apparatus source",capture.question+" Draw the screw gauge.");
const refusal={status:"source_declined",question:capture.question,rawProblemIR:capture.rawInput.rawProblemIR,rawTurnPlan:capture.rawInput.rawTurnPlan,rawContent:JSON.stringify(capture.rawInput),issueCodes:capture.rawInput.issueCodes,elapsedMs:1};
const declined={...structuredClone(actual),problemIRRejection:refusal,sourcePlanEvidence:"opaque source evidence",...boardContinuationArtifacts("Earlier lesson")};
await negative(capture,declined,"refused original remains opaque");
const savedRefusal=await canonicalizeTurnSceneMetadata({question:capture.question,visualStatus:"text_only",segments:[],sceneArtifacts:declined});check(savedRefusal.ok,"refusal saves");
equal(savedRefusal.value.sceneArtifacts?.problemIRRejection,refusal,"full refused original retained solely as diagnostic");
equal(savedRefusal.value.sceneArtifacts?.sourcePlanEvidence,"opaque source evidence","source Plan evidence retained");
equal(boardContinuationOf(savedRefusal.value.sceneArtifacts)?.lessonQuestion,"Earlier lesson","board continuation preserved");
for(const length of [200000,200001]){
 const saved=await canonicalizeTurnSceneMetadata({question:capture.question,visualStatus:"text_only",segments:[],sceneArtifacts:{...structuredClone(actual),sourcePlanEvidence:"x".repeat(length)}});check(saved.ok,"bounded evidence save");
 equal(saved.value.sceneArtifacts?.sourcePlanEvidence?.length,length===200000?length:undefined,"diagnostic size boundary");
}

function binomial(question:string,expected:number):Case {
 const r=E.readFiniteBinomialProgram(question);check(r.status==="ok","binomial full source");
 const evidence=(quote:string)=>({source:"question" as const,quote,start:question.indexOf(quote),end:question.indexOf(quote)+quote.length});
 return {question,problem:{schemaVersion:"problem-ir/v1",id:"independentPolynomial",question,
  facts:[{id:"given",kind:"given",statement:r.source.expressionSource,evidence:evidence(r.source.expressionSource)},{id:"asked",kind:"requested",statement:r.source.requestSource,evidence:evidence(r.source.requestSource)}],
  entities:[{id:"P",kind:"other",label:"P(x)",evidenceFactIds:["given"]}],expressions:[{id:"polynomial",valueType:"function",root:r.source.root,evidenceFactIds:["given"]},{id:"coefficient",valueType:"scalar",root:{kind:"number",value:expected},evidenceFactIds:["asked"]}],constraints:[],representationIntents:[{id:"table",kind:"conceptual",entityIds:["P"],evidenceFactIds:["given","asked"]}],solveRequests:[{id:"coefficientAsk",kind:"evaluate",expressionId:"coefficient",resultBinding:{turnPlanQuantityId:"answer",symbol:"C",unit:"1",evidenceFactIds:["asked"]}}]},
  plan:{schemaVersion:"turn-plan/v3",question,givens:[],derived:[{id:"answer",symbol:"C",unit:"1",value:expected,provenance:"derived"}],unknowns:[{id:"answer",symbol:"C",unit:"1"}],assumptions:[],lawIds:[],qualitativeClaims:[],visualRequirement:"required"}};
}
const otherCases:Case[]=[binomial("Coefficient of x^2 in the expansion of (2-3x)^4 is",216),binomial("Coefficient of x^5 in the expansion of (1+x)^2 is",0)];
const progressions=JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/w3-progression-source/authored-cases.json",import.meta.url),"utf8")) as {cases:Array<Case & {expected:number[]}>};
for(const p of progressions.cases.slice(0,3)){
 const c=structuredClone(p);c.plan.derived=c.plan.unknowns.map((row,i)=>({...row,value:c.expected[i]!,provenance:"derived"}));
 await positive(c,c.expected,"complete progression");otherCases.push(c);
}
const ucm=await E.buildUniformCircularSourceFallback("A stone moves in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed and centripetal acceleration.");check(ucm,"UCM fixture");
const broadCircular={question:ucm.problemIR.question,problem:ucm.problemIR,plan:ucm.turnPlan};
await negative(broadCircular,await artifacts(broadCircular),"broader UCM graph is never pruned into positive");
const circular=JSON.parse(readFileSync(new URL("fixtures/w3-numeric-text-persistence-20261006/independent-ucm.json",import.meta.url),"utf8")) as Case;
await positive(circular,[3,.27],"whole independently authored UCM source");otherCases.push(circular);
for(const c of otherCases){
 if(c.problem.id==="independentPolynomial")await positive(c,[c.plan.derived[0]!.value],"whole finite binomial");
 const base=await artifacts(c);
 for(const [label,mutate] of [
  ["hidden original IR",(a:Artifacts)=>(a.problemIR as unknown as Artifacts).hiddenClaim="F=999"],
  ["hidden original derived field",(a:Artifacts)=>((a.turnPlan as E.TurnPlanV3).derived[0] as unknown as Artifacts).hiddenClaim="F=999"],
  ["stale original scalar",(a:Artifacts)=>(a.turnPlan as E.TurnPlanV3).derived[0]!.value+=1],
  ["extra original unknown",(a:Artifacts)=>(a.turnPlan as E.TurnPlanV3).unknowns.push({id:"foreign",symbol:"F",unit:"N"})],
 ] as Array<[string,(a:Artifacts)=>void]>){const bad=structuredClone(base);mutate(bad);await negative(c,bad,`${c.problem.id}: ${label}`);}
}

// Absent scenes cannot retain cached visual claims, and refusals cannot promote them.
for(const visualStatus of ["text_only","retry_required","validated"] as const){
 const turn=stored({question:capture.question,visualStatus,segments:[segment],sceneArtifacts:{...structuredClone(actual),representationTier:"exact_verified",nonMetric:false,candidates:[{accepted:true,sceneDocument:{forged:true}}],selectedCandidateId:"forged",diagramResultStatus:"ready"}});
 const read=sourceCheckedStoredTurn(turn),a=read.sceneArtifacts as Artifacts;
 equal(read.visualStatus,visualStatus==="text_only"?"text_only":"retry_required","scene-less visual status never certified");
 equal([a.representationTier,a.nonMetric,a.selectedCandidateId,a.candidates],[undefined,undefined,null,[]],"scene-less cached geometry claims removed");
 equal(a.diagramResultStatus,read.visualStatus,"scene-less result status truthful");
}
const retried=await canonicalizeTurnSceneMetadata({question:capture.question,visualStatus:"retry_required",segments:[],sceneArtifacts:actual});check(retried.ok,"retry save remains available");
equal(retried.value.visualStatus,"retry_required","retry status preserved with valid numeric authority");
equal(retried.value.sceneArtifacts?.solverAuthority?.status,"verified","retry numeric payload independently admitted");
let getterReads=0;
const accessor=structuredClone(actual);Object.defineProperty(accessor.problemIR,"hiddenClaim",{enumerable:true,get(){getterReads++;return "F=999";}});
Object.assign(accessor,boardContinuationArtifacts("Earlier lesson"),{sourcePlanEvidence:"opaque diagnostic"});
await negative(capture,accessor,"source accessor safely declined");equal(getterReads,0,"numeric admission does not execute source accessors");
const accessorRead=sourceCheckedStoredTurn(stored({question:capture.question,visualStatus:"text_only",segments:[],sceneArtifacts:accessor}));
equal(boardContinuationOf(accessorRead.sceneArtifacts)?.lessonQuestion,"Earlier lesson","malformed numeric graph cannot erase board continuation at read");
equal((accessorRead.sceneArtifacts as Artifacts).sourcePlanEvidence,"opaque diagnostic","malformed numeric graph cannot erase bounded evidence at read");
const inherited=structuredClone(actual);inherited.problemIR=Object.assign(Object.create({hiddenClaim:"F=999"}),inherited.problemIR);
await negative(capture,inherited,"inherited source obligation safely declined");
const malformed=structuredClone(actual);((malformed.problemIR as E.ProblemIR).expressions[0]!.root as Artifacts).value=Infinity;
await negative(capture,malformed,"non-finite hidden original input declined");

// A solvable arbitrary expression and a forged audit are insufficient source admission.
const unsupported=structuredClone(capture);unsupported.question="Calculate 2+3.";unsupported.problem.question=unsupported.question;unsupported.plan.question=unsupported.question;
await negative(unsupported,await artifacts(unsupported),"default arbitrary numeric payload refused");
console.log(`PASS ${checks} numeric-only persistence checks: full actual31, independent39/0/99, binomial/progression/UCM, JSON/read/replay, complete-original negatives (offline; no DB/lifecycle/READY credit)`);
