/** Four source ownership boundaries, through actual complete public output. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { evaluateMathExpression } from "../../src/math/expression";
import fixtures from "./fixtures/chemistry-f4-review4-source-ownership.json";

const rows = fixtures.rows.map(gold => {
  const radiation = readRadiationSource(gold.question);
  const routes = ([["ordinary", synthesizeFamilyScene], ["lastResort", synthesizeLastResortScene]] as const).map(([route, build]) => {
    const result = build({ question: gold.question });
    return { route, result, compiled: result ? compileSceneDocument(result.document) : null };
  });
  try {
    for (const { route, result, compiled } of routes) {
      const expectedDraw = gold.expectedScientificAvailability;
      assert.equal(!!result, expectedDraw, `${gold.id}/${route}: complete requested source figure`);
      if (!result) continue;
      assert.ok(compiled?.ok && compiled.renderScene);
      assert.equal(result.document.source.question, gold.question);
      const doc = result.document, paint = compiled.renderScene.primitives.filter(mark => mark.kind === "label");
      const science = gold.scientificGold;
      if (gold.finding === "first-order-scope") {
        assert.equal(result.family, "analytic_curve");
        assert.equal(doc.source.chemistryFamily, undefined);
        assert.notEqual(doc.source.archetype, "radioactive_decay");
        const curve = doc.constructions.find(step => step.operator === "function_curve");
        assert.ok(curve && "function" in science);
        const scale = Number((doc.source.displayScale as { y?: number } | undefined)?.y);
        assert.ok(Number.isFinite(scale) && scale > 0 && result.nonMetric && result.tier !== "exact_verified");
        assert.ok(curve.inputs.expression === science.function && scale === 1
          || curve.inputs.expression === `(${scale})*(${science.function})`, "whole exact source function under one explicit positive display map");
        assert.ok(paint.some(mark => mark.text === `y=${science.function.replace(/\*/g, "")}`),
          "visible whole function, permitting conventional implicit multiplication only");
        assert.ok(!paint.some(mark => /^[-+]?\d|^\(/.test(mark.text ?? "")), "no unscaled numeric ticks/coordinates on scaled axes");
        if ("requiredPoints" in science) for (const [x, y] of science.requiredPoints) {
          assert.ok(Math.abs(evaluateMathExpression(String(curve.inputs.expression), x) / scale - y) < 1e-12);
        }
        assert.ok(!paint.some(mark => /\[A\]|half.life|nuclei/.test(mark.text ?? "")));
      } else if (gold.finding === "law-example-scope") {
        assert.ok("resistorsPerView" in science && "seriesEquivalentOhm" in science && "parallelEquivalentOhm" in science);
        assert.notEqual(doc.source.sourceModel, "circuit_law_example");
        for (const topology of ["series", "parallel"]) {
          const group = doc.revealGroups.find(group => group.id === `${topology}_group`);
          assert.ok(group, `${topology}: actual complete requested view`);
          const components = doc.constructions.filter(step => step.operator === "symbol" && step.inputs.symbol === "resistor"
            && step.outputs.some(id => group.entityIds.includes(id)));
          assert.equal(components.length, science.resistorsPerView);
        }
        assert.equal(doc.quantities.filter(item => item.value === science.eachResistanceOhm && /ohm|Ω/.test(String(item.unit))).length,
          science.resistorsPerView, "complete independently bound source roster");
        for (const [symbol, value] of [["Req(s)", science.seriesEquivalentOhm], ["Req(p)", science.parallelEquivalentOhm]]) {
          assert.ok(doc.quantities.some(item => item.symbol === symbol && item.value === value && item.unit === "ohm"));
          assert.ok(paint.some(mark => mark.text === `${symbol}=${value} ohm`
            || mark.text === `${symbol}=${science.eachResistanceOhm}/${science.resistorsPerView}Ω`));
        }
      } else {
        assert.ok(radiation.status === "source" && radiation.model.kind === "photoelectric");
        const model = radiation.model;
        for (const binding of model.bindings) {
          const { span, text } = binding.reading.source;
          assert.equal(gold.question.slice(span.start, span.end), text);
        }
        assert.equal(model.workFunctionEV, science.workEV);
        if (gold.finding === "emitted-particle-role") {
          assert.ok("photonEV" in science && "givenEmittedKineticEV" in science);
          assert.equal(model.photonEnergyEV, science.photonEV);
          assert.equal(model.givenKineticEV, science.givenEmittedKineticEV);
        } else {
          assert.ok("derivedIncidentEV" in science && "thresholdNM" in science);
          assert.equal(model.photonEnergyEV, science.derivedIncidentEV);
          assert.ok(Math.abs(model.thresholdWavelengthM! * 1e9 - science.thresholdNM) < 1e-9);
          assert.ok(paint.some(mark => /derived/i.test(mark.text ?? "")), "actual visible derived incident-energy basis");
          assert.ok(paint.some(mark => /λ0=620/.test(mark.text ?? "")), "stated threshold remains visible");
          if ("givenStoppingV" in science) {
            assert.equal(model.stoppingPotentialV, science.givenStoppingV);
            assert.ok(doc.quantities.some(item => item.symbol === "Vstop" && item.value === science.givenStoppingV && item.unit === "V"));
            assert.ok(paint.some(mark => mark.text === `Vstop=${science.givenStoppingV} V`));
          }
          assert.ok(doc.quantities.some(item => item.symbol === "E" && item.value === science.derivedIncidentEV
            && item.unit === "eV" && item.provenance === "derived"), "derived E is never a manufactured incident given");
        }
        const kinetic = "givenEmittedKineticEV" in science ? science.givenEmittedKineticEV
          : "givenStoppingV" in science ? science.givenStoppingV : undefined;
        assert.equal(model.kineticEV, kinetic);
        assert.ok(doc.quantities.some(item => item.symbol === "K" && item.value === kinetic && item.unit === "eV")
          || paint.some(mark => new RegExp(`^K=${Number(kinetic)}(?:\\.0+)? eV$`).test(mark.text ?? "")), "all sourced emitted energy survives");
      }
    }
    return { id: gold.id, passed: true, radiation, routes };
  } catch (error) { return { id: gold.id, passed: false, error: String(error), radiation, routes }; }
});
const report = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, failed: report.failed,
  failures: rows.filter(row => !row.passed).map(({ id, error }) => ({ id, error })) }));
process.exitCode = report.failed ? 1 : 0;
