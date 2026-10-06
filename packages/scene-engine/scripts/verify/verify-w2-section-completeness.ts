import assert from "node:assert/strict";
import * as ts from "../../src/index";
const esm:typeof ts=await import(new URL("../../dist/index.js",import.meta.url).href);
let checks=0;
for(const e of [ts,esm]){
 for(const [question,point] of [
  ["Find point R which divides the join of A(-2,7) and B(3,-3) internally in the ratio 2:3.",[0,3]],
  ["Find the midpoint M of the join of A(-8,4) and B(2,-6).",[-3,-1]],
  ["Find point Q which divides the join of A(-2,7) and B(3,-3) externally in the ratio 2:3.",[-12,27]],
 ] as const){
  const doc=e.sectionFormulaScene(question);assert.ok(doc);const result=e.compileSceneDocument(doc,{sourceAuthority:{question}});assert.ok(result.ok,JSON.stringify(result.report.issues));assert.ok(e.synthesizeFamilyScene({question}));
  const geometry=result.renderScene!.primitives.find(row=>row.entityId===`pt_${question.includes("point R")?"R":question.includes("midpoint M")?"M":"Q"}` && row.kind==="point");assert.ok(geometry);checks++;
  const reading=e.readSectionFormulaSource(question);assert.equal(reading.status,"ok");if(reading.status==="ok")assert.deepEqual([reading.source.point.x,reading.source.point.y],point);
  for(const suffix of [" Also draw its tangent."," with a perpendicular line."," and find its area."," with speed 2 m/s."," Also prove an unrelated statement."]){const q=question+suffix;assert.equal(e.readSectionFormulaSource(q).status,"declined");assert.equal(e.synthesizeFamilyScene({question:q}),null);assert.ok(e.validateSceneSourceAuthority({...doc,source:{...doc.source,question:q}},q).some(issue=>issue.severity==="fatal"));checks++;}
 }
 const question="Find the point P which divides the line segment joining A(1,2) and B(4,5) externally in the ratio 2:1.";
 const raw:ts.TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:[{id:"ax",symbol:"x1",value:1,provenance:"given",sourceText:"A(1,2)"}],derived:[{id:"px",symbol:"x",value:7,provenance:"derived"},{id:"py",symbol:"y",value:8,provenance:"derived"},{id:"foreign",symbol:"speed",value:7,unit:"m/s",provenance:"derived"}],unknowns:[{id:"px",symbol:"x",unit:"coordinate"},{id:"py",symbol:"y",unit:"coordinate"},{id:"foreign",symbol:"speed",unit:"m/s"}],qualitativeClaims:[{id:"wrong",claim:"speed",expected:7,relatedQuantityIds:["foreign"]}],assumptions:[],lawIds:[],visualRequirement:"required"};
 const fixed=e.applySectionFormulaAuthority(question,raw)!;assert.equal(fixed.plan.derived.find(row=>row.id==="px")!.unit,"coordinate");assert.equal(fixed.plan.derived.some(row=>row.id==="foreign"),false);assert.equal(fixed.plan.unknowns.some(row=>row.id==="foreign"),false);assert.equal(fixed.plan.qualitativeClaims.length,0);assert.equal(e.validateTurnPlanV3(fixed.plan,question).valid,true);assert.deepEqual(e.sectionFormulaPlanIssues(question,fixed.plan),[]);checks++;
 const wrongQuote=structuredClone(raw);wrongQuote.givens[0]!.sourceText="B(4,5)";assert.ok(e.sectionFormulaPlanIssues(question,wrongQuote).some(issue=>issue.path==="turnPlan.ax"));assert.equal(e.applySectionFormulaAuthority(question,wrongQuote)!.plan.givens.length,0);checks++;
 const metric=structuredClone(raw);metric.derived[0]!.unit="m";metric.unknowns[0]!.unit="m";const stripped=e.applySectionFormulaAuthority(question,metric)!;assert.equal(stripped.plan.derived.some(row=>row.id==="px"),false);assert.equal(stripped.plan.unknowns.some(row=>row.id==="px"),false);checks++;
}
console.log(`PASS ${checks} whole section source, zero coordinate and numeric role TS/ESM controls; no READY increment`);
