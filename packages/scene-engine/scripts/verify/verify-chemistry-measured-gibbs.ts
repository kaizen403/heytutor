/** Measured affine Gibbs plots: source coefficients/domain, strict surplus operands. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { buildMeasuredGibbsGraph } from "../../src/chemistry/gibbsLaw";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import fixtures from "./fixtures/chemistry-measured-gibbs.json";
const near=(a:number,b:number)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-9,`${a} != ${b}`);
const results:Array<{id:string;passed:boolean;error?:string}>=[];
for(const row of fixtures)try{
 const question=normalizeTutorQuestion(row.question);const document=buildMeasuredGibbsGraph(question,[]);
 assert.equal(!!document,row.draw,"complete scientific gold");
 if(document){
  assert.equal(document.source.question,question);
  const validation=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(validation.document,JSON.stringify(validation.report.issues));
  const compiled=compileSceneDocument(validation.document);assert.ok(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
  const model=document.source.sourceLawGraph as {x:{domain:number[]};curves:Array<{relation:{slope:number;intercept:number}}>;points:Array<{x:number;y:number}>};
  assert.equal(model.x.domain.length,row.domain!.length);
  model.x.domain.forEach((value,index)=>near(value,row.domain![index]!));const relation=model.curves[0]!.relation;near(relation.slope,row.slope!);near(relation.intercept,row.intercept!);
  for(const x of row.domain!)assert.ok(model.points.some(point=>Math.abs(point.x-x)<1e-9&&Math.abs(point.y-(row.intercept!+row.slope!*x))<1e-9),"source domain endpoint value");
  if(row.crossing!==null)assert.ok(model.points.some(point=>Math.abs(point.x-row.crossing!)<1e-9&&Math.abs(point.y)<1e-9),"physical zero crossing");
  assert.equal(document.quantities.length,0,"no projected physical quantities outside the checked law model");
 }
 results.push({id:row.id,passed:true});
}catch(error){results.push({id:row.id,passed:false,error:error instanceof Error?error.message:String(error)});}
const report={scope:"Checked physical Gibbs law/domain and normal compile, not native/stock coverage.",passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(report.failed)process.exitCode=1;
