/** A derived affine root may cancel to roundoff; false points still decline. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildMeasuredGibbsGraph } from "../../src/chemistry/gibbsLaw";
import { buildSourceLawGraphFigure, sourceLawValue } from "../../src/chemistry/lawGraphFigure";
import { readSourceLawGraph, type SourceLawGraph, type SourceLawRelation } from "../../src/chemistry/sourceLawGraph";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { RenderScene, SceneDocument } from "../../src/types";

const results: Array<{id:string;passed:boolean;error?:string;document?:SceneDocument|null}>=[];
function check(id:string, run:()=>SceneDocument|null):void {
  try { results.push({id,passed:true,document:run()}); }
  catch(error) { results.push({id,passed:false,error:error instanceof Error?error.message:String(error)}); }
}
function compiled(document:SceneDocument):RenderScene {
  const validation=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(validation.document,JSON.stringify(validation.report.issues));
  const result=compileSceneDocument(validation.document);
  assert.ok(result.ok&&result.renderScene,JSON.stringify(result.report.issues));
  return result.renderScene;
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

// The reported threshold values cancel below the zero lower bound at the
// first proof sample. Keep an exact derived zero datum and actual visible zero,
// while all source operands, other samples and normal compiler guards remain.
for(const[id,phi,hText,h,cancellation]of[
  ["review-threshold-curve",2.5,"4.1e-15",4.1e-15,true],
  ["transfer-threshold-curve",3.1,"4.7e-15",4.7e-15,true],
  ["review-threshold-multiplicative",2.5,"4.1*10^-15",4.1*10**-15,false],
  ["transfer-threshold-multiplicative",3.1,"4.7*10^-15",4.7*10**-15,false],
]as const){
  const question=`Plot maximum photoelectron kinetic energy against incident-light frequency for a metal with work function ${phi} eV, over 0 to 1.00*10^15 Hz. Use K_max = hν-φ and h = ${hText} eV s. Mark the threshold and the region with no photoelectron emission.`;
  const reading=readSourceLawGraph(question,"chem_orbital");
  for(const[route,produce]of[
    ["direct",()=>buildAtomicRadiationScene(question,[],false)],
    ["ordinary",()=>synthesizeFamilyScene({question})?.document??null],
    ["last",()=>synthesizeLastResortScene({question})?.document??null],
  ]as const)check(`${id}:${route}`,()=>{
    assert.equal(reading.state,"valid");
    const document=produce();assert.ok(document,"valid threshold curve must survive sample roundoff");
    assert.equal(document.source.question,question);
    const model=document.source.sourceLawGraph as SourceLawGraph;
    const relation=model.curves[0]!.relation;assert.equal(relation.operator,"threshold_affine");assert.ok(relation.operator==="threshold_affine");
    assert.ok(Math.abs(relation.slope-h)<=4*Number.EPSILON*Math.abs(h),"both source serializations retain their arithmetic coefficient");assert.equal(relation.intercept,-phi);
    const root=phi/relation.slope,expectedRoot=phi/h;
    assert.ok(Math.abs(root-expectedRoot)<=4*Number.EPSILON*Math.abs(expectedRoot),"derived root matches independently computed source operands");
    assert.deepEqual(model.points[0],{curveId:"law_curve",x:root,y:0},"mathematically derived threshold is exactly zero");
    if(cancellation)assert.ok(sourceLawValue(relation,root)<0,"e-notation exercises real reported product/add cancellation");
    for(const point of model.points.slice(1))assert.equal(point.y,relation.slope*point.x-phi,"other source values are not clamped");
    for(const binding of model.bindings)for(const evidence of[binding.scalarSource,...(binding.unitSource?[binding.unitSource]:[])])
      assert.equal(question.slice(evidence.span.start,evidence.span.end),evidence.text);
    const render=compiled(document);
    assert.ok(render.primitives.some(mark=>mark.kind==="label"&&mark.entityId==="law_datum_0_y_0"&&mark.text==="y=0"),"threshold legend visibly prints zero rather than negative roundoff");
    return document;
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
// Proof-sample bounds use their own finite affine operands, never the opposite
// axis endpoint or a unit floor. Empty points force these through sample truth.
function thresholdAdapter(phi=2.5,h=4.1e-15,opposite=false):SourceLawGraph {
  const model=adapter(opposite?-h:h,opposite?phi:-phi),root=phi/h,hi=1e15;
  return {...model,x:{...model.x,domain:[root,hi]},
    y:{...model.y,domain:opposite?[phi-h*hi,0]:[0,h*hi-phi]},
    curves:[{...model.curves[0]!,domain:[root,hi]}],points:[]};
}
const lower=thresholdAdapter(),upper=thresholdAdapter(2.5,4.1e-15,true);
const tinySample={...adapter(.3e-27,-3e-26),points:[]};
controls.push(
  {id:"sample-lower-cancellation",model:lower,draw:true},
  {id:"sample-upper-cancellation",model:upper,draw:true},
  {id:"sample-wrong-lower-bound",model:{...lower,y:{...lower.y,domain:[1e-6,lower.y.domain[1]]}},draw:false},
  {id:"sample-wrong-upper-bound",model:{...upper,y:{...upper.y,domain:[upper.y.domain[0],-1e-6]}},draw:false},
  {id:"sample-huge-opposite-upper-not-tolerance",model:{...lower,y:{...lower.y,domain:[1e-6,1e100]}},draw:false},
  {id:"sample-huge-opposite-lower-not-tolerance",model:{...upper,y:{...upper.y,domain:[-1e100,-1e-6]}},draw:false},
  {id:"sample-tiny-true-lower-violation",model:{...tinySample,y:{...tinySample.y,domain:[1e-31,1e-25]}},draw:false},
  {id:"sample-nonlinear-remains-strict",model:{...lower,y:{...lower.y,domain:[-1,0]},curves:[{...lower.curves[0]!,relation:{operator:"ratio_complements",pK:lower.x.domain[0],complement:false}}]},draw:false},
  {id:"sample-overflow-product-declines",model:{...changedRelation({operator:"affine",slope:1e308,intercept:50}),points:[]},draw:false},
  {id:"sample-nonfinite-intercept-declines",model:{...changedRelation({operator:"affine",slope:-.3,intercept:Infinity}),points:[]},draw:false},
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
