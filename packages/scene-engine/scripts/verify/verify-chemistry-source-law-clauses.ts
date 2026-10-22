/** A valid supplied law never authorizes unowned source facts or drawing asks. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { readSourceLawGraph, type SourceLawGraph, type SourceLawFamily } from "../../src/chemistry/sourceLawGraph";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildElectrochemScene } from "../../src/chemistry/electrochemistry";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileForLab } from "../chemistry-lab/lab";
import { buildSourceLawGraphFigure } from "../../src/chemistry/lawGraphFigure";
import { parseMathExpression } from "../../src/math/expression";
import fixture from "./fixtures/chemistry-source-law-clauses.json";

const rows: Array<{ id: string; passed: boolean; actual: unknown; error: string | null }> = [];
function check(id: string, actual: unknown, test: () => void): void {
  try { test(); rows.push({ id, passed: true, actual, error: null }); }
  catch (error) { rows.push({ id, passed: false, actual, error: error instanceof Error ? error.message : String(error) }); }
}
function semantics(model: SourceLawGraph, gold: typeof fixture.rows[number], question: string): void {
  assert.equal(model.question, question);
  assert.equal(model.family, gold.family);
  const relation = model.curves[0]!.relation;
  assert.equal(relation.operator, gold.operator);
  for (const [x, expected] of gold.points) {
    const actual = relation.operator === "positive_quadratic" ? 2 * relation.product / (Math.sqrt(x! * x! + 4 * relation.product) + x!)
      : relation.operator === "ratio_complements" ? (relation.complement ? 1 : 10 ** (x! - relation.pK)) / (1 + 10 ** (x! - relation.pK))
        : relation.slope * x! + relation.intercept;
    const scale = Math.max(Math.abs(model.y.domain[0]), Math.abs(model.y.domain[1]), Math.abs(expected!));
    assert.ok(Math.abs(actual - expected!) <= Math.max(64 * Number.EPSILON * scale, Math.abs(expected!) * 1e-8), `source law ${actual} != ${expected}`);
  }
  for (const text of gold.forbidNotes ?? []) assert.ok(model.notes.every(note => !note.includes(text)), `unbound source variable: ${text}`);
  for (const binding of model.bindings) for (const proof of [binding.scalarSource, ...(binding.unitSource ? [binding.unitSource] : [])]) {
    assert.equal(question.slice(proof.span.start, proof.span.end), proof.text);
  }
  if (gold.thresholdBoundary) {
    const boundary=gold.thresholdBoundary;
    assert.equal(relation.operator,"threshold_affine");
    assert.deepEqual(model.x.domain,[boundary.lowerHz,boundary.upperHz]);
    assert.deepEqual(model.curves[0]!.domain,[boundary.thresholdHz,boundary.upperHz]);
    const regions=model.regions??[];
    assert.equal(regions.length,boundary.noEmissionRegion?1:0);
    if(boundary.noEmissionRegion)assert.deepEqual(regions[0]!.domain,[boundary.lowerHz,boundary.thresholdHz]);
    assert.ok(regions.every(region=>region.domain[1]>region.domain[0]),"no empty region is emitted");
    assert.ok(model.points.some(point=>point.x===boundary.thresholdHz&&Math.abs(point.y)<1e-12),"threshold datum survives even at the domain endpoint");
  }
}
for (const gold of fixture.rows) {
  const family = gold.family as SourceLawFamily;
  const result = readSourceLawGraph(gold.question, family);
  check(gold.id + "/reader", result, () => {
    assert.equal(result.state === "valid", gold.draw);
    if (result.state === "valid") semantics(result.model, gold, gold.question);
  });
  for (const route of ["direct", "ordinary", "lastResort"] as const) {
    const question = route === "direct" ? gold.question : normalizeTutorQuestion(gold.question);
    const build = family === "chem_solutions" ? buildSolutionsGraphScene : family === "chem_electrochem" ? buildElectrochemScene : buildAtomicRadiationScene;
    const document = route === "direct" ? build(question, [], false)
      : (route === "ordinary" ? synthesizeFamilyScene : synthesizeLastResortScene)({ question })?.document ?? null;
    const compiled = compileForLab(document);
    check(gold.id + "/" + route, { question, document, compiled }, () => {
      assert.equal(document !== null, gold.draw);
      if (!gold.draw) return;
      assert.ok(document && compiled.ok && compiled.renderScene);
      assert.equal(document.source.question, question);
      const model = document.source.sourceLawGraph as SourceLawGraph;
      assert.ok(model);
      semantics(model, gold, question);
      if(gold.thresholdBoundary){
        const plot=document.source.sourceLawPlot as {xDisplayDomain:[number,number];yDisplayDomain:[number,number]};
        const curve=document.constructions.find(step=>step.operator==="function_curve");assert.ok(curve&&typeof curve.inputs.expression==="string");
        const [x0,x1]=plot.xDisplayDomain,[y0,y1]=plot.yDisplayDomain;
        const start=x0+(gold.thresholdBoundary.thresholdHz-model.x.domain[0])*(x1-x0)/(model.x.domain[1]-model.x.domain[0]);
        assert.equal(curve.inputs.xMin,start);assert.equal(curve.inputs.xMax,x1,"emitting branch retains its whole source domain");
        const expression=parseMathExpression(curve.inputs.expression);
        assert.ok(Math.abs(expression.evaluate(start)-y0)<1e-9,"actual drawn branch starts at zero kinetic energy");
        assert.ok(Math.abs(expression.evaluate(x1)-y1)<1e-9,"actual drawn branch ends at the source maximum energy");
      }
    });
  }
}
// The source reader omits an empty interval; ordinary figure guards remain
// strict for external typed adapters that actually supply invalid topology.
const endpoint=fixture.rows.find(row=>row.id==="review-threshold-equals-lower")!;
const boundary=readSourceLawGraph(endpoint.question,"chem_orbital");
if(boundary.state==="valid"){
 const model=boundary.model,[lo,hi]=model.x.domain;
 const mutations:Array<[string,SourceLawGraph]>=[
  ["zero-width-region",{...model,regions:[{domain:[lo,lo],label:"no emission",meaning:"no_emission"}]}],
  ["reversed-region",{...model,regions:[{domain:[hi,lo],label:"no emission",meaning:"no_emission"}]}],
  ["out-of-domain-region",{...model,regions:[{domain:[lo-1,lo+1],label:"no emission",meaning:"no_emission"}]}],
  ["zero-width-curve",{...model,points:[],curves:[{...model.curves[0]!,domain:[lo,lo]}]}],
 ];
 for(const[id,mutated]of mutations)check(`threshold-guard/${id}`,mutated,()=>assert.equal(buildSourceLawGraphFigure(mutated),null));
}
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const at = process.argv.indexOf("--out"); if (at >= 0) writeFileSync(process.argv[at + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed })); if (result.failed) process.exitCode = 1;
