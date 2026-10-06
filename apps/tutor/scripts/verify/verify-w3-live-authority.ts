import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as engine from '@heytutor/scene-engine';
import {liveSceneSaveFailure} from '../../lib/scene/sceneSaveAdmission';
import {canonicalizeTurnSceneMetadata} from '../../lib/scene/turnScenePersistence';
import {sourceCheckedStoredTurn} from '../../lib/scene/storedSceneSource';
import {restoreVerifiedPresentationFromTurn} from '../../features/tutor-session/lib/scene/restoreVerifiedDiagram';
import {buildVerifiedDiagramPresentation} from '../../features/tutor-session/lib/scene/verifiedScenePresentation';
import {planAndSolveProblemV1,inferSceneCapabilities} from '@heytutor/tutor-core';
import type {StoredTurn} from '../../lib/boards/boardsClient';
let checks=0;
const check=(v:unknown,m:string)=>{assert(v,m);checks++;};
function authored(question:string,expected?:number){
 const read=engine.readFiniteBinomialProgram(question);assert(read.status==='ok');
 const evidence=(quote:string)=>{const start=question.indexOf(quote);return {source:'question' as const,quote,start,end:start+quote.length};};
 const problem:engine.ProblemIR={schemaVersion:'problem-ir/v1',id:'whole_polynomial',question,facts:[{id:'given',kind:'given',statement:read.source.expressionSource,evidence:evidence(read.source.expressionSource)},{id:'asked',kind:'requested',statement:read.source.requestSource,evidence:evidence(read.source.requestSource)}],entities:[{id:'P',kind:'other',label:'P(x)',evidenceFactIds:['given']}],expressions:[{id:'polynomial',valueType:'function',root:read.source.root,evidenceFactIds:['given']},...(expected===undefined?[]:[{id:'coefficient',valueType:'scalar' as const,root:{kind:'number' as const,value:expected},evidenceFactIds:['asked']}])],constraints:[],representationIntents:[{id:'table',kind:'conceptual',entityIds:['P'],evidenceFactIds:['given','asked']}],solveRequests:expected===undefined?[]:[{id:'coefficient_ask',kind:'evaluate',expressionId:'coefficient',resultBinding:{turnPlanQuantityId:'answer',symbol:'C',unit:'1',evidenceFactIds:['asked']}}]};
 const plan:engine.TurnPlanV3={schemaVersion:'turn-plan/v3',question,givens:[],unknowns:expected===undefined?[]:[{id:'answer',symbol:'C',unit:'1'}],derived:expected===undefined?[]:[{id:'answer',symbol:'C',unit:'1',value:expected,provenance:'derived'}],lawIds:[],assumptions:[],qualitativeClaims:[],visualRequirement:'required'};
 return {question,problem,plan};
}
async function run(){
 const native=JSON.parse(readFileSync('../../packages/scene-engine/scripts/verify/w3-binomial/native2014P2Q43.json','utf8'));
 for(const [question,expected] of [['Expand (1+x)^4.',undefined],['Coefficient of x^2 in the expansion of (2-3x)^4 is',216],['Coefficient of x^3 in the expansion of (1+x)^2(1-x)^3 is',2],['Coefficient of x^5 in the expansion of (1+x)^2 is',0],['Expand (1/2+x/3)^3.',undefined],[native.question_options_and_source_answer_verbatim as string,1113]] as const){
  const c=authored(question,expected),before=JSON.stringify(c),opt={sourceAuthority:{question,problemIR:c.problem,turnPlan:c.plan}};
  check(engine.finiteBinomialPlanIssues(question,c.problem,c.plan).length===0,'full Plan roles');
  const family=engine.synthesizeFamilyScene({question,problemIR:c.problem,turnPlan:c.plan});assert(family);
  check(family.nonMetric && family.tier==='exact_verified','exact arithmetic does not imply a geometric metric');
  check(engine.compileSceneDocument(family.document,opt).ok,'normal public compile');
  const caps=inferSceneCapabilities(question,{problemIR:c.problem,turnPlan:c.plan});check(caps.hasSourceProgram,'executed source availability');
  const presentation=buildVerifiedDiagramPresentation(family.document,family.renderScene);
  const labels=family.renderScene.primitives.filter(p=>p.kind==='label');
  for(const label of labels)check(presentation.diagram.commands.some(command=>command.text===label.text),`full compiler label preserved: ${label.text}`);
  check(liveSceneSaveFailure({document:family.document,question,turnPlan:c.plan,problemIR:c.problem,tier:family.tier})===null,'live same source proof');
  const solver=engine.solveFiniteBinomialProblem(question,c.problem)!;assert(solver);const audit=engine.verifyTurnPlanAgainstSolver(c.problem,solver,c.plan,question);
  check(audit.status===(expected===undefined?'not_applicable':'verified'),'source solver actual Plan join');
  const artifacts:engine.SceneArtifactsV3={schemaVersion:'scene-artifacts/v3',turnPlan:c.plan,problemIR:c.problem,solverResult:solver,solverAuthority:audit,representationTier:family.tier,nonMetric:true,candidates:[],selectedCandidateId:null,selectionReason:family.reason,diagramResultStatus:'ready',proofObligations:[]};
  const saved=await canonicalizeTurnSceneMetadata({question,sceneDocument:family.document,sceneArtifacts:artifacts,visualStatus:'validated',segments:[]});check(saved.ok,saved.ok?'normal save':saved.error);
  const turn:StoredTurn={id:'offline',question,rawResponse:'',orderIndex:0,speedMultiplier:2,traceId:null,segments:[],sceneDocument:family.document,sceneArtifacts:artifacts,visualStatus:'validated',sceneEngineVersion:null,validationReport:null};
  check(sourceCheckedStoredTurn(turn).visualStatus==='validated','stored source checked');check(!!restoreVerifiedPresentationFromTurn(turn),'restore recompiles actual source and Plan');
  const response=new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(c.problem)}}]}),{status:200});
  const authority=await planAndSolveProblemV1(question,c.plan,{proxyUrl:'https://test.invalid',timeoutMs:1000,fetchImpl:async()=>response});check(authority?.audit.status===(expected===undefined?'not_applicable':'verified'),'normal formulation path joins source solver');
  check(JSON.stringify(c)===before,'caller remains whole and immutable');
  for(const defect of ['statement','hidden-fact','missing-IR',...(expected===undefined?[]:['stale','unknown-unit','foreign-role','wrong-exponent-role'])]){
   const bad=structuredClone(c);let rawProblem:unknown=bad.problem;
   if(defect==='statement')bad.problem.facts[1]!.statement='Find radius 9';
   if(defect==='hidden-fact')bad.problem.facts.push({...bad.problem.facts[1]!,id:'hidden',statement:'Find a further coefficient'});
   if(defect==='missing-IR')rawProblem=null;
   if(defect==='stale')bad.plan.derived[0]!.value+=1;
   if(defect==='unknown-unit')bad.plan.unknowns[0]!.unit='m';
   if(defect==='foreign-role'||defect==='wrong-exponent-role'){
    const symbol=defect==='foreign-role'?'speed':'C99';bad.plan.derived[0]!.symbol=symbol;bad.plan.unknowns[0]!.symbol=symbol;bad.problem.solveRequests[0]!.resultBinding!.symbol=symbol;
   }
   check(!engine.compileSceneDocument(family.document,{sourceAuthority:{question,problemIR:rawProblem,turnPlan:bad.plan}}).ok,`${defect} compile declines`);
   check(!!liveSceneSaveFailure({document:family.document,question,turnPlan:bad.plan,problemIR:rawProblem,tier:family.tier}),`${defect} live declines`);
   const badArtifacts={...artifacts,problemIR:rawProblem,turnPlan:bad.plan};const badTurn={...turn,sceneArtifacts:badArtifacts};
   check(sourceCheckedStoredTurn(badTurn).visualStatus==='retry_required',`${defect} read declines`);check(!restoreVerifiedPresentationFromTurn(badTurn),`${defect} restore declines`);
   const badSave=await canonicalizeTurnSceneMetadata({question,sceneDocument:family.document,sceneArtifacts:badArtifacts,visualStatus:'validated',segments:[]});check(!badSave.ok,`${defect} save declines`);
  }
 }
 const progressionCases=JSON.parse(readFileSync('../../packages/scene-engine/scripts/verify/fixtures/w3-progression-source/authored-cases.json','utf8')).cases as Array<{question:string;problem:engine.ProblemIR;plan:engine.TurnPlanV3;expected:number[]}>;
 for(const raw of progressionCases){
  const plan={...structuredClone(raw.plan),derived:raw.plan.unknowns.map((row,i)=>({...row,value:raw.expected[i]!,provenance:'derived' as const}))};
  const c={...raw,plan},family=engine.synthesizeFamilyScene({question:c.question,problemIR:c.problem,turnPlan:c.plan});assert(family);
  check(family.document.source.nonMetric===true,'numeric table source has nonmetric display scope');
  const presentation=buildVerifiedDiagramPresentation(family.document,family.renderScene);check(presentation.diagram.promptAddon?.includes('intentionally non-metric'),'nonmetric display survives app conversion');
  for(const label of family.renderScene.primitives.filter(p=>p.kind==='label'))check(presentation.diagram.commands.some(command=>command.text===label.text),`full progression label ${label.text}`);
  check(liveSceneSaveFailure({document:family.document,question:c.question,turnPlan:plan,problemIR:c.problem,tier:family.tier})===null,'progression live source proof');
  const solver=await new engine.LocalDeterministicSolverProvider().solve(c.problem),audit=engine.verifyTurnPlanAgainstSolver(c.problem,solver,plan,c.question);
  const artifacts:engine.SceneArtifactsV3={schemaVersion:'scene-artifacts/v3',turnPlan:plan,problemIR:c.problem,solverResult:solver,solverAuthority:audit,representationTier:family.tier,nonMetric:true,candidates:[],selectedCandidateId:null,selectionReason:family.reason,diagramResultStatus:'ready',proofObligations:[]};
  const saved=await canonicalizeTurnSceneMetadata({question:c.question,sceneDocument:family.document,sceneArtifacts:artifacts,visualStatus:'validated',segments:[]});check(saved.ok,saved.ok?'progression save':saved.error);
  const turn:StoredTurn={id:'offline',question:c.question,rawResponse:'',orderIndex:0,speedMultiplier:2,traceId:null,segments:[],sceneDocument:family.document,sceneArtifacts:artifacts,visualStatus:'validated',sceneEngineVersion:null,validationReport:null};check(sourceCheckedStoredTurn(turn).visualStatus==='validated','progression stored source');check(!!restoreVerifiedPresentationFromTurn(turn),'progression restore');
  const badProblem=structuredClone(c.problem);badProblem.facts[0]!.statement='All terms are 99 and prove infinite convergence';
  const withdrawn=engine.applySourceQuantityAuthority(plan,badProblem,c.question);check(withdrawn.plan.derived.length===0 && withdrawn.plan.unknowns.length===0 && withdrawn.plan.qualitativeClaims.length===0,'bad complete graph withdraws unsupported progression numbers');
  const badTurn={...turn,sceneArtifacts:{...artifacts,problemIR:badProblem}};check(sourceCheckedStoredTurn(badTurn).visualStatus==='retry_required','contradictory progression read');check(!restoreVerifiedPresentationFromTurn(badTurn),'contradictory progression restore');
 }
 console.log(`PASS ${checks} W3 actual Plan/whole-IR numeric, source, label and offline lifecycle checks; normal student acceptance pending`);
}
run().catch(error=>{console.error(error);process.exitCode=1;});
