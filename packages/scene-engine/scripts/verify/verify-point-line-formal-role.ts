import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../../../',import.meta.url).pathname.replace(/\/$/,''), mode=process.argv.includes('--built')?'public':'source';
const dir=new URL('.',import.meta.url);
const moduleAt=async(path:string)=>await import(pathToFileURL(root+'/'+path).href);
const engine=await moduleAt('packages/scene-engine/'+(mode==='source'?'src/index.ts':'dist/index.js'));
const core=await moduleAt('packages/tutor-core/'+(mode==='source'?'src/index.ts':'dist/index.js'));
const app=await moduleAt('apps/tutor/features/tutor-session/lib/scene/representationFallback.ts');
const frozenBytes=readFileSync(new URL('fixtures/point-line-formal-role-frozen-20261006.json',dir));
assert.equal(createHash('sha256').update(frozenBytes).digest('hex'),'d7943748fb501c7683fd6ae9a226912ae1d5e77f830bdf26bfb29b5e2370984f','immutable 45 complete observations');
const frozen=JSON.parse(frozenBytes.toString());
frozen.cases.push(...JSON.parse(readFileSync(new URL('fixtures/point-line-formal-role-authored-20261006.json',dir),'utf8')).cases);
const rows=[];
for(const c of frozen.cases){
 const {problem,plan,wire}=c.input,before=JSON.stringify(c.input),checks:any[]=[];
 const check=(name:string,pass:boolean)=>checks.push({name,pass});
 const parsedPlan=core.parseTurnPlanV3Content(JSON.stringify(plan),plan.question);
 check('plan-parser-preserves-or-declines',c.positive?JSON.stringify(parsedPlan)===JSON.stringify(plan):parsedPlan===null||JSON.stringify(parsedPlan)===JSON.stringify(plan));
 const reference=engine.pointLineSourceDocument(c.reference.question,c.reference);
 const refCompiled=reference&&engine.compileSceneDocument(reference,{sourceAuthority:{question:c.reference.question,problemIR:c.reference}});
 check('independent-reference',!!refCompiled?.ok&&!!refCompiled?.renderScene);
 const compiled=reference&&engine.compileSceneDocument(reference,{sourceAuthority:{question:plan.question,problemIR:problem,turnPlan:plan}});
 const caller=engine.pointLineCallerIssues?.(plan.question,problem,plan)??null;
 if(caller)check('caller',c.positive?caller.length===0:caller.some((i:any)=>i.severity==='fatal'));
 check('compiler',c.positive?compiled?.ok&&!!compiled?.renderScene:!compiled?.ok&&!compiled?.renderScene);
 const api=await core.planProblemAuthorityV1(plan.question,plan,{proxyUrl:'https://offline.invalid',timeoutMs:10000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(wire)}}]}),{status:200})});
 check('API',c.positive?api&& !('status'in api)&&api.audit.status==='verified':api?.status==='source_declined');
 if(api?.status==='source_declined'){
  check('whole-wire-retained',JSON.stringify(api.rawProblemIR)===JSON.stringify(wire));
  check('whole-plan-retained',JSON.stringify(api.rawTurnPlan)===JSON.stringify(plan));
 }
 if(c.positive&&api&&!('status'in api)){
  check('unsimplified-whole-IR',JSON.stringify(api.problemIR)===JSON.stringify(core.liftCompactProblemIR(wire,plan.question)));
  check('original-cPerp',api.problemIR.constraints.find((x:any)=>x.id==='cPerp')?.entityIds.join()===problem.constraints.find((x:any)=>x.id==='cPerp')?.entityIds.join());
 }
 const selections=[];
 const inferred=core.inferSceneCapabilities(plan.question,{turnPlan:plan,problemIR:problem,lawIds:plan.lawIds}).families;
 for(const families of [undefined,inferred])for(const exact of [undefined,refCompiled?.ok?{sceneDocument:reference,renderScene:refCompiled.renderScene,validationReport:refCompiled.report}:undefined]){
  const input={question:plan.question,turnPlan:plan,problemIR:problem,families,exact};
  const normal=app.selectVerifiedRepresentation(input),fast=app.selectFastVerifiedRepresentation(input);
  if(!c.positive)check('normal-whole-source-retained',normal.sceneDocument.source.question===plan.question);
  check('normal-selector',c.positive?normal.tier==='exact_verified'&&normal.renderScene.primitives.length>0:normal.renderScene.primitives.length===0);
  if(!c.positive)check('fast-selector',!fast||fast.renderScene.primitives.length===0);
  if(c.positive)check('actors-retained',problem.entities.every((e:any)=>normal.sceneDocument.entities.some((x:any)=>x.id===e.id&&x.kind===e.kind)));
  selections.push({inferred:families!==undefined,exact:!!exact,normal,fast});
 }
 if(!c.positive){
  let sketch:any,exception:any;
  try{sketch=app.buildSourceGroundedRepresentation(plan.question,plan);}catch(e){exception=String(e);}
  check('direct-sketch',!!exception||sketch?.renderScene.primitives.length===0);
 }
 if(c.oracle){
  const reading=engine.readPointLineProgram(plan.question);
  check('independent-oracle',reading.status==='ok'&&Math.abs(reading.distance-c.oracle.distance)<1e-12&&Math.abs(reading.foot.x-c.oracle.foot[0])<1e-12&&Math.abs(reading.foot.y-c.oracle.foot[1])<1e-12);
  if(c.oracle.distance===0)for(const s of selections)check('incidence-no-false-angle',!s.normal.sceneDocument.assertions.some((a:any)=>a.predicate==='perpendicular')&&s.normal.sceneDocument.entities.filter((e:any)=>e.id==='P'||e.id==='F').length===2);
 }
 if(c.noCaller){
  for(const families of [undefined,['line_figure'],['function_curve']])for(const exact of [undefined,refCompiled?.ok?{sceneDocument:reference,renderScene:refCompiled.renderScene,validationReport:refCompiled.report}:undefined]){
   const input={question:plan.question,families,exact};
   const selected=app.selectVerifiedRepresentation(input),fast=app.selectFastVerifiedRepresentation(input);
   check('missing-caller-normal',selected.renderScene.primitives.length===0);
   check('missing-caller-fast',!fast||fast.renderScene.primitives.length===0);
  }
  let refused=false;try{refused=app.buildSourceGroundedRepresentation(plan.question).renderScene.primitives.length===0;}catch{refused=true;}
  check('missing-caller-sketch',refused);
 }
 check('originals-unchanged',JSON.stringify(c.input)===before);
 const observed={caller,compiler:compiled,api,selections,parsedPlan};
 const failed=checks.filter(x=>!x.pass).map(x=>x.name);
 rows.push({name:c.name,positive:c.positive,input:c.input,checks,failed,observed});
 console.log(JSON.stringify({name:c.name,failed,caller:caller?.map((i:any)=>i.code),compile:compiled?.ok,api:api&&('status'in api?api.status:api.audit.status),normalInk:selections.map(s=>s.normal.renderScene.primitives.length)}));
}
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
if(output)writeFileSync(output,JSON.stringify({reviewedCommit:frozen.reviewedCommit,mode,rows},null,2)+'\n');
console.log(JSON.stringify({cases:rows.length,failedCases:rows.filter(r=>r.failed.length).map(r=>r.name)}));
assert.deepEqual(rows.filter(r=>r.failed.length).map(r=>({name:r.name,failed:r.failed})),[], 'every boundary assertion must pass');
console.log(`point-line formal-role: ${rows.reduce((n,r)=>n+r.checks.length,0)} assertions passed (${mode})`);
