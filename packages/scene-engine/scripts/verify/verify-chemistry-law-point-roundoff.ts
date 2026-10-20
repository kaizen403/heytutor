/** A derived affine root may cancel to roundoff; false points still decline. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildMeasuredGibbsGraph } from "../../src/chemistry/gibbsLaw";
import { buildSourceLawGraphFigure, sourceLawValue } from "../../src/chemistry/lawGraphFigure";
import type { SourceLawGraph, SourceLawRelation } from "../../src/chemistry/sourceLawGraph";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

const results: Array<{id:string;passed:boolean;error?:string;document?:SceneDocument|null}>=[];
function check(id:string, run:()=>SceneDocument|null):void {
  try { results.push({id,passed:true,document:run()}); }
  catch(error) { results.push({id,passed:false,error:error instanceof Error?error.message:String(error)}); }
}
function compiled(document:SceneDocument):void {
  const validation=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(validation.document,JSON.stringify(validation.report.issues));
  const result=compileSceneDocument(validation.document);
  assert.ok(result.ok&&result.renderScene,JSON.stringify(result.report.issues));
}

// The first case is the reported full question, not a preconstructed graph.
for (const [id,H,S] of [["review-H50-S300",50,300],["transfer-H41-S300",41,300],["transfer-opposite-sign",-50,-300]] as const) {
  const question=`Plot Delta G = Delta H - T Delta S from 100 to 300 K. Delta H = ${H} kJ/mol and Delta S = ${S} J/(mol K), independent of temperature. Mark the zero crossing and positive and negative Delta G regions.`;
  for(const [route,produce] of [
    ["direct",()=>buildMeasuredGibbsGraph(question,[])],
    ["ordinary",()=>synthesizeFamilyScene({question})?.document??null],
    ["last",()=>synthesizeLastResortScene({question})?.document??null],
  ] as const) check(`${id}:${route}`,()=>{
    const document=produce();assert.ok(document,"the source-grounded Gibbs crossing must draw");
    assert.equal(document.source.question,question);assert.equal(document.source.chemistryFamily,"chem_thermo");
    const model=document.source.sourceLawGraph as SourceLawGraph;
    const relation=model.curves[0]!.relation;assert.equal(relation.operator,"affine");
    assert.ok(relation.operator==="affine");assert.equal(relation.intercept,H);assert.equal(relation.slope,-S/1000);
    const root=-H/relation.slope;
    assert.ok(model.points.some(point=>point.x===root&&point.y===0),"derived zero datum remains zero");
    for(const binding of model.bindings)for(const evidence of [binding.scalarSource,...(binding.unitSource?[binding.unitSource]:[])])
      assert.equal(question.slice(evidence.span.start,evidence.span.end),evidence.text);
    compiled(document);return document;
  });
}

// Typed external-adapter controls exercise only point/curve truth at the generic
// lowering seam. They confer no source authority or new question coverage.
function adapter(slope=-.3,intercept=50):SourceLawGraph {
  const question=`Supplied affine relation y = (${slope}) x + (${intercept}).`;
  const scalar=String(intercept),start=question.lastIndexOf(scalar);
  const source={span:{start,end:start+scalar.length},text:scalar};
  const domain:[number,number]=[100,300];
  return {version:"chemistry-source-law-graph/v1",question,family:"chem_solutions",
    relationSource:{span:{start:0,end:question.length},text:question},
    bindings:[{role:"intercept",value:intercept,dimension:"dimensionless",unit:"1",scalarSource:source}],
    x:{symbol:"x",label:"x",unit:"1",domain,transform:"linear"},
    y:{symbol:"y",label:"y",unit:"1",domain:[Math.min(slope*100+intercept,slope*300+intercept),Math.max(slope*100+intercept,slope*300+intercept)],transform:"linear"},
    curves:[{id:"line",label:"source line",relation:{operator:"affine",slope,intercept},domain}],
    points:[{curveId:"line",x:-intercept/slope,y:0}],notes:[]};
}
const base=adapter(),tiny=adapter(-.3e-25,50e-25);
const controls:Array<{id:string;model:SourceLawGraph;draw:boolean}>=[
  {id:"affine-rounded-root",model:base,draw:true},
  {id:"affine-opposite-sign-root",model:adapter(.3,-50),draw:true},
  {id:"tiny-affine-root",model:tiny,draw:true},
  {id:"wrong-zero-y",model:{...base,points:[{...base.points[0]!,y:1e-6}]},draw:false},
  {id:"wrong-root-x",model:{...base,points:[{...base.points[0]!,x:base.points[0]!.x+1e-6}]},draw:false},
  {id:"huge-axis-not-truth-tolerance",model:{...base,y:{...base.y,domain:[-1e100,1e100]},points:[{...base.points[0]!,y:1e-6}]},draw:false},
  {id:"tiny-wrong-zero-y",model:{...tiny,points:[{...tiny.points[0]!,y:1e-31}]},draw:false},
  {id:"tiny-wrong-root-x",model:{...tiny,points:[{...tiny.points[0]!,x:tiny.points[0]!.x+1e-6}]},draw:false},
  {id:"nonlinear-ratio-false-zero",model:{...base,curves:[{...base.curves[0]!,relation:{operator:"ratio_complements",pK:base.points[0]!.x,complement:false}}]},draw:false},
  {id:"nonlinear-quadratic-false-zero",model:{...base,curves:[{...base.curves[0]!,relation:{operator:"positive_quadratic",product:1}}]},draw:false},
];
function changedRelation(relation:SourceLawRelation):SourceLawGraph {
  return {...base,curves:[{...base.curves[0]!,relation}]};
}
controls.push(
  {id:"overflow-product-declines",model:changedRelation({operator:"affine",slope:1e308,intercept:50}),draw:false},
  {id:"nonfinite-intercept-declines",model:changedRelation({operator:"affine",slope:-.3,intercept:Infinity}),draw:false},
  {id:"nonfinite-slope-declines",model:changedRelation({operator:"affine",slope:NaN,intercept:50}),draw:false},
);
for(const row of controls)check(`adapter:${row.id}`,()=>{
  const document=buildSourceLawGraphFigure(row.model);
  assert.equal(Boolean(document),row.draw,"whole figure must reject false or nonfinite points");
  if(document)compiled(document);
  return document;
});
const relation=base.curves[0]!.relation,point=base.points[0]!;
const report={scope:"Source-question graphs and typed point-guard controls; no native/stock coverage.",
  reportedCancellation:{x:point.x,y:point.y,evaluated:sourceLawValue(relation,point.x)},
  passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,results};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({checks:results.length,passed:report.passed,failed:report.failed}));
if(report.failed)process.exitCode=1;
