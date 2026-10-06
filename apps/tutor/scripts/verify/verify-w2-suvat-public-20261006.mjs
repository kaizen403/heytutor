import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
// Explicit built ESM imports: do not allow tsconfig paths to substitute source.
import {parseTurnPlanV3Content,planProblemAuthorityV1,liftCompactProblemIR,collectQuestionGivens} from '../../../../packages/tutor-core/dist/index.js';
import {suvatCallerDocument,compileSceneDocument,admitSuvatCaller,readSuvatSource} from '../../../../packages/scene-engine/dist/index.js';
const fixture=name=>readFileSync(new URL(`./fixtures/suvat-whole-caller-20261006/${name}`,import.meta.url),'utf8');
const {question}=JSON.parse(fixture('provenance.json'));
const wire=fixture('03-problem-ir-v1-caller.json');
let checks=0;
const check=(value,message)=>{checks++;assert(value,message);};
for(const name of ['01-turn-plan-v3-caller.json','02-turn-plan-v3-caller.json']){
  const plan=parseTurnPlanV3Content(fixture(name),question);
  const problem=liftCompactProblemIR(JSON.parse(wire),question);
  check(admitSuvatCaller(question,problem,plan).status==='ok','public whole caller');
  const call=content=>planProblemAuthorityV1(question,plan,{proxyUrl:'https://offline.invalid',timeoutMs:3000,
    fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content}}]}))});
  const outcome=await call(wire);
  check(outcome&& !('status' in outcome)&&outcome.audit.status==='verified','public ordinary API verifies');
  assert(outcome&&!('status' in outcome));
  check(outcome.audit.bindings[0].approximate===-4&&outcome.audit.bindings[1].approximate===50,'public -4/50 oracle');
  const document=suvatCallerDocument(question,problem,plan);
  check(document&&compileSceneDocument(document,{sourceAuthority:{question,problemIR:problem,turnPlan:plan}}).ok,'public source compile');
  check(collectQuestionGivens(question,plan).some(row=>row.board==='v = 0 m/s'),'public source rest intro');
  for(const mutate of [ir=>{ir.expressions[0].root={kind:'number',value:-4};},ir=>{ir.facts[0].statement='final speed 20 m/s';},
    ir=>{ir.solveRequests[0].resultBinding.unit='N';},ir=>{ir.expressions[0].root.foreign='equation';}]){
    const bad=structuredClone(problem);mutate(bad);const content=JSON.stringify(bad);
    const decline=await call(content);
    check(decline?.status==='source_declined'&&decline.rawContent===content,'public atomic API refusal retains raw');
    check(!compileSceneDocument(document,{sourceAuthority:{question,problemIR:bad,turnPlan:plan}}).ok,'public source refusal');
  }
}
check(readSuvatSource('A car moves on a circular track of radius 50 m at 20 m/s. Find its centripetal acceleration.').status==='none','UCM ownership preserved');
console.log(`W2 SUVAT public built ESM: ${checks} checks passed`);
