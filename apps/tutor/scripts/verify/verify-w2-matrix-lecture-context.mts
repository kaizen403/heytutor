import type {AddressInfo} from 'node:net';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {runLecture} from '../lecture-lab/lecturePipeline';
import * as E from '@heytutor/scene-engine';
const out='/Users/kaizen/heytutor-claude-coord/reviews/w2-matrix-selection-fix-20261006';
const a=JSON.parse(readFileSync(new URL('../../../../packages/scene-engine/fixtures/matrix-products-live-20261006/actual-runtime.json',import.meta.url),'utf8'));
const capture=JSON.parse(readFileSync(a.provenance.capture,'utf8')) as {kind:string;responseBody:string}[];
const rawPlans=capture.filter((x)=>x.kind==='turn-plan-v3').map((x)=>JSON.parse(x.responseBody).choices[0].message.content);
let variant='canonicalActual', turnRequests=0; const requests:Record<string,unknown>[]=[];
const server=createServer(async(req,res)=>{
 let text='';for await(const c of req)text+=c; const body=JSON.parse(text);
 const headers=req.headers;const kind=headers['x-turn-planner-version']?'turn':headers['x-problem-ir-version']?'ir':body.stream?'teaching':'scene';
 requests.push({variant,kind,headers,body});
 if(kind==='teaching'){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const content='[STEP] Each entry comes from the row of A and column of B. [WRITE:AB11 = 1*2 + 2*1 = 4] [STEP] Reversing the order changes the result. [WRITE:BA11 = 2*1 + 0*3 = 2] [STEP] Compare AB and BA: these are different. [WRITE:AB != BA] [STEP] This completes both requested products. [END]';
  res.end(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:null}]})}\n\ndata: [DONE]\n\n`);return;
 }
 let content:unknown;
 if(kind==='turn'){content=variant==='rawCapture'?rawPlans[turnRequests++%rawPlans.length]:JSON.stringify(a.plan);}
 else if(kind==='ir'){const ir=structuredClone(a.rawProblemResponse);if(variant==='refusedExtraIR')ir.unconsumedGraph={ask:'determinant A'};content=JSON.stringify(ir);}
 else {const doc=E.buildMatrixSourceDocument(a.question)!;content=JSON.stringify(doc);}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address() as AddressInfo;const results=[];
try{
 for(const name of ['canonicalActual','rawCapture','refusedExtraIR']){
  variant=name;turnRequests=0;
  const run=await runLecture(a.question,{origin:`http://127.0.0.1:${address.port}`});
  results.push({variant:name,...run});
  writeFileSync(`${out}/lecture-${name}-partial.json`,JSON.stringify({run,requests},null,2));
  if(name==='canonicalActual'){assert.equal(run.diagram.committed,true);assert.equal(run.plan?.givens.length,8);assert.equal(run.solver?.status,'not_applicable');assert.equal(run.solver?.projection,null);assert.equal(run.plan?.derived.length,8);assert.equal(run.givenRows.some(x=>/^A\s*=\s*0|^B\s*=\s*0/.test(x)),false);}
  // Normal exported lecture behavior must match the final live admission guard.
  if(name==='refusedExtraIR'){assert.equal(run.diagram.committed,false);assert.equal(run.solver,null);assert.equal(run.plan?.givens.length,0);}
 }
}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
writeFileSync(`${out}/lecture-${process.argv.includes('--esm')?'esm':'source'}.json`,JSON.stringify({results,requests},null,2));
console.log(JSON.stringify(results.map(r=>({variant:r.variant,error:r.error,committed:r.diagram.committed,family:r.diagram.family,givens:r.plan?.givens.length,derived:r.plan?.derived.length,solver:r.solver,reason:r.diagram.reason})),null,2));
