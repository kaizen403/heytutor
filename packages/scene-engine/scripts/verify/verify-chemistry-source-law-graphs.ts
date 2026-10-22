/** Source-supplied relations must produce complete, ordinarily verified graphs. */
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildElectrochemScene } from "../../src/chemistry/electrochemistry";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { parseMathExpression } from "../../src/math/expression";
import type { SourceLawGraph } from "../../src/chemistry/sourceLawGraph";
import { buildSourceLawGraphFigure } from "../../src/chemistry/lawGraphFigure";
import { compileSceneDocument } from "../../src/compile/compiler";

interface Fixture {
  id: string; question: string; family: string; draw: boolean;
  operator: string | null; points: Array<[number, number]>; originalAuthoredQuestion?: string; rawQuestion?: string;
}
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/chemistry-source-law-graphs.json", import.meta.url), "utf8")) as Fixture[];
const cases = fixtures.flatMap(row=>row.originalAuthoredQuestion ? [row,{...row,id:`pipeline-${row.id}`,rawQuestion:row.originalAuthoredQuestion,question:normalizeTutorQuestion(row.originalAuthoredQuestion)}] : [row]);
const results = cases.map(row => {
  const build = row.family === "chem_solutions" ? buildSolutionsGraphScene
    : row.family === "chem_electrochem" ? buildElectrochemScene : buildAtomicRadiationScene;
  const document = build(row.question, [], false);
  const validation = document ? validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>)) : null;
  const compiled = validation?.document ? compileSceneDocument(validation.document) : null;
  let error: string | null = null;
  try {
    assert.equal(document !== null, row.draw, row.question);
    if (row.draw) {
      assert.ok(document);
      assert.equal(document.source.question, row.question);
      assert.equal(document.source.chemistryFamily, row.family);
      assert.ok(validation?.document, "normal prune/validate must admit the whole source figure");
      assert.ok(compiled?.ok, "normal compilation must verify the figure");
      assert.equal(document.source.sourceModel, "chemistry-source-law-graph/v1");
      assert.ok(document.assertions.some(value => value.severity === "fatal" && value.predicate === "function_value"));
      const model = document.source.sourceLawGraph as SourceLawGraph;
      const plot = document.source.sourceLawPlot as {xDisplayDomain:[number,number];yDisplayDomain:[number,number]};
      assert.equal(model.curves[0]!.relation.operator,row.operator);
      assert.equal(model.question,row.question,"source spans name the canonical question actually consumed");
      for (const binding of model.bindings) {
        for (const evidence of [binding.scalarSource,...(binding.unitSource?[binding.unitSource]:[])]) {
          assert.equal(row.question.slice(evidence.span.start,evidence.span.end),evidence.text);
        }
        assert.ok(Number.isFinite(binding.value));
      }
      assert.equal(document.quantities.length,0,"no output quantity or IR authority is fabricated");
      const transformed=(value:number,axis:SourceLawGraph["x"])=>axis.transform === "linear" ? value : Math.log10(value);
      const toDisplay=(value:number,axis:SourceLawGraph["x"],bounds:[number,number])=>bounds[0]+(transformed(value,axis)-transformed(axis.domain[0],axis))*(bounds[1]-bounds[0])/(transformed(axis.domain[1],axis)-transformed(axis.domain[0],axis));
      const fromDisplay=(value:number,axis:SourceLawGraph["x"],bounds:[number,number])=>{
        const real=transformed(axis.domain[0],axis)+(value-bounds[0])*(transformed(axis.domain[1],axis)-transformed(axis.domain[0],axis))/(bounds[1]-bounds[0]);
        return axis.transform==="linear"?real:10**real;
      };
      const close=(actual:number,expected:number,message:string)=>assert.ok(Math.abs(actual-expected)<=Math.max(1e-15,Math.abs(model.y.domain[1]-model.y.domain[0])*1e-10,Math.abs(expected)*2e-6),`${message}: ${actual} != ${expected}`);
      for (const [goldX,goldY] of row.points) {
        if (goldX===0 && model.x.transform==="log10") {
          const zero=model.points.find(point=>point.detached && point.x===0);
          assert.ok(zero,"zero is a separate datum, never a finite log coordinate"); close(zero.y,goldY,"zero-C positive root");
          continue;
        }
        for (const [index,curve] of model.curves.entries()) {
          assert.ok(goldX>=curve.domain[0]-Math.abs(curve.domain[1]-curve.domain[0])*1e-12 && goldX<=curve.domain[1]+Math.abs(curve.domain[1]-curve.domain[0])*1e-12,"gold coordinate belongs to plotted physical domain");
          const construction=document.constructions.find(value=>value.operator==="function_curve" && value.outputs.includes(curve.id));
          assert.ok(construction && typeof construction.inputs.expression==="string");
          const graph=parseMathExpression(construction.inputs.expression);
          const displayX=toDisplay(goldX,model.x,plot.xDisplayDomain);
          const displayY=graph.evaluate(displayX);
          close(fromDisplay(displayY,model.y,plot.yDisplayDomain),index===0?goldY:1-goldY,"independent physical gold on actual emitted expression");
          close(Number(construction.inputs.xMin),toDisplay(curve.domain[0],model.x,plot.xDisplayDomain),"curve starts at exact source domain");
          close(Number(construction.inputs.xMax),toDisplay(curve.domain[1],model.x,plot.xDisplayDomain),"curve stops at exact source domain");
        }
      }
      assert.ok(document.entities.every(entity=>!entity.label || entity.label.length<=16),"whole labels fit; no cropped values or units");
      assert.equal(buildSourceLawGraphFigure({...model,relationSource:{...model.relationSource,text:"invented source"}}),null,"source identity mismatch declines");
      assert.equal(buildSourceLawGraphFigure({...model,points:[...model.points,{curveId:"missing",x:0,y:0}]}),null,"unknown-point ownership declines the whole figure");
      if (row.operator==="threshold_affine") {
        const threshold=model.curves[0]!.domain[0];
        assert.ok(threshold>model.x.domain[0]);
        assert.ok(model.regions?.some(region=>region.meaning==="no_emission" && region.domain[0]===model.x.domain[0] && region.domain[1]===threshold));
        close(model.points[0]!.y,0,"threshold kinetic energy is zero");
      }
    }
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  return { id: row.id, question: row.question, ...(row.rawQuestion?{rawQuestion:row.rawQuestion,inputBoundary:"normalizeTutorQuestion-once"}:{}), expectedDraw: row.draw, passed: error === null, error, document, validation, compiled };
});
const output = { passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const outAt = process.argv.indexOf("--out");
if (outAt >= 0) writeFileSync(process.argv[outAt + 1]!, JSON.stringify(output, null, 2) + "\n");
for (const row of results) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(`verify-chemistry-source-law-graphs: ${output.passed} passed, ${output.failed} failed`);
if (output.failed) process.exitCode = 1;
