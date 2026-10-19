/** Conceptual law examples are distinct from reconstruction of a source circuit. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import fixtures from "./fixtures/chemistry-f4-circuit-law-example.json";

const results = fixtures.map(gold => {
  const records: unknown[] = [];
  try {
    for (const [route, result] of [["ordinary", synthesizeFamilyScene({ question: gold.question })],
      ["lastResort", synthesizeLastResortScene({ question: gold.question })]] as const) {
      const compiled = result ? compileSceneDocument(result.document) : null;
      records.push({ route, result, compiled });
      assert.equal(!!result, gold.draw, `${gold.id}/${route}: whole requested view`);
      if (!result) continue;
      assert.equal(result.family, "circuit_network");
      assert.ok(compiled?.ok && compiled.renderScene);
      assert.equal(result.document.source.question, gold.question);
      const text = compiled.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []).join(" ");
      if (gold.mode === "example") {
        assert.deepEqual(result.document.quantities, [], "An example assigns no physical scalars");
        assert.equal(result.document.source.archetype, undefined, "Chosen example has no false catalog attribution");
        assert.equal(result.document.source.sourceModel, "circuit_law_example");
        assert.ok(text.includes("Symbolic example"));
        assert.ok(text.includes("Reference arrows"));
        assert.ok(text.includes("A") && text.includes("B"), "Terminals visible");
        const wires = result.document.constructions.filter(step => step.operator === "connect");
        const symbols = result.document.constructions.filter(step => step.operator === "symbol");
        assert.ok(symbols.some(step => step.inputs.symbol === "battery"));
        assert.ok(symbols.some(step => step.inputs.symbol === "resistor"));
        assert.ok(wires.length >= 4, "Actual connected branches, not isolated symbols");
        assert.ok(result.document.assertions.some(item => item.predicate === "path" && item.severity === "fatal"));
        assert.ok(result.document.assertions.some(item => item.predicate === "connected" && item.severity === "fatal"));
        const sources = symbols.filter(step => step.inputs.symbol === "battery");
        assert.equal(sources.length, 1, "Minimal example uses one symbolic source, not an unsourced two-source default");
        assert.ok(result.document.constructions.some(step => step.operator === "vector"), "Reference current arrows are real ink");
        if (!("lawSet" in gold) || gold.lawSet?.includes("current")) {
          const junction = wires.flatMap(step => [step.inputs.start, step.inputs.end]);
          assert.ok(junction.some(id => junction.filter(other => other === id).length >= 3), "Actual degree-three junction");
        }
      } else {
        for (const [symbol, value] of Object.entries(gold.quantities ?? {})) {
          assert.equal(result.document.quantities.find(q => q.symbol === symbol)?.value, value);
          assert.ok(text.includes(`${symbol}=${value}`), `Actual source value ${symbol} visible`);
        }
      }
    }
    return { id: gold.id, passed: true, records };
  } catch (error) { return { id: gold.id, passed: false, error: String(error), records }; }
});
const report = { passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, failures: results.filter(row => !row.passed).map(({ id, error }) => ({ id, error })) }));
process.exitCode = report.failed ? 1 : 0;
