/** Whole supplied laws own their requested axes, marks and model subjects. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { buildMeasuredGibbsGraph } from "../../src/chemistry/gibbsLaw";
import { readSourceLawGraph } from "../../src/chemistry/sourceLawGraph";
import { buildSourceLawGraphFigure } from "../../src/chemistry/lawGraphFigure";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { parseMathExpression } from "../../src/math/expression";
import { compileForLab } from "../chemistry-lab/lab";
import type { SourceLawGraph } from "../../src/chemistry/sourceLawGraph";
import fixture from "./fixtures/chemistry-law-source-ownership.json";
const near = (actual: number, expected: number) => assert.ok(Number.isFinite(actual)
  && Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-8), `${actual} != ${expected}`);
const rows = fixture.rows.flatMap(gold => ["adapter", "strict", "schematic", "ordinary", "lastResort"].map(route => {
  const question = normalizeTutorQuestion(gold.question);
  let actual: unknown = null;
  let error: string | null = null;
  try {
    const read = gold.kind === "henry" ? readSourceLawGraph(question, "chem_solutions") : null;
    if (read) assert.equal(read.state === "valid", gold.draw, "whole positive model-subject and request proof");
    const build = gold.kind === "gibbs" ? buildThermoGraphScene : buildSolutionsGraphScene;
    const candidate = route === "adapter" ? gold.kind === "gibbs" ? buildMeasuredGibbsGraph(question, [])
      : read?.state === "valid" ? buildSourceLawGraphFigure(read.model) : null
      : route === "strict" || route === "schematic" ? build(question, [], route === "schematic")
        : (route === "ordinary" ? synthesizeFamilyScene : synthesizeLastResortScene)({ question });
    const document = candidate ? "document" in candidate ? candidate.document : candidate : null;
    const compiled = document ? compileForLab(document) : null;
    actual = { read, document, compiled };
    assert.equal(!!document, gold.draw, "complete source-request admission");
    if (document) {
      assert.ok(compiled?.ok && compiled.renderScene, "ordinary whole candidate validation/compiler");
      assert.equal(document.source.question, question);
      const model = document.source.sourceLawGraph as SourceLawGraph;
      assert.equal(model.question, question);
      assert.equal(model.curves[0]!.relation.operator, "affine");
      for (const binding of model.bindings) for (const proof of [binding.scalarSource, ...(binding.unitSource ? [binding.unitSource] : [])]) {
        assert.equal(question.slice(proof.span.start, proof.span.end), proof.text, "original question span");
      }
      const plot = document.source.sourceLawPlot as { xDisplayDomain: [number, number]; yDisplayDomain: [number, number] };
      const curve = document.constructions.find(entry => entry.operator === "function_curve" && entry.outputs.includes(model.curves[0]!.id));
      assert.ok(curve && typeof curve.inputs.expression === "string");
      const expression = parseMathExpression(curve.inputs.expression);
      const points: number[][] = "points" in gold ? gold.points : gold.domain.map(x => [x, gold.intercept + gold.slope * x]);
      if (gold.kind === "gibbs") {
        assert.equal(model.x.symbol, "T"); assert.equal(model.y.symbol, "ΔG");
        if ("domain" in gold) assert.deepEqual(model.x.domain, gold.domain);
      }
      for (const [x, y] of points) {
        const displayX = plot.xDisplayDomain[0] + (x! - model.x.domain[0]) * (plot.xDisplayDomain[1] - plot.xDisplayDomain[0]) / (model.x.domain[1] - model.x.domain[0]);
        const displayY = expression.evaluate(displayX);
        const physicalY = model.y.domain[0] + (displayY - plot.yDisplayDomain[0]) * (model.y.domain[1] - model.y.domain[0]) / (plot.yDisplayDomain[1] - plot.yDisplayDomain[0]);
        near(physicalY, y!);
      }
    }
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  return { id: gold.id, route, question, expectedDraw: gold.draw, passed: error === null, error, actual };
}));
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows.filter(row => !row.passed)) console.error(`${row.id}/${row.route}: ${row.error}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }));
if (result.failed) process.exitCode = 1;
