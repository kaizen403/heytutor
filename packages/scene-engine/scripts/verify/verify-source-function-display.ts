import assert from "node:assert/strict";
import { GRAPH_GENERATORS } from "../../src/archetypes/generators/graphs";
import { resolveTier } from "../../src/archetypes/tier";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";

// Independent source/body and display-factor oracles. A common positive axis
// scale preserves the whole function program, never its physical measurements.
const fixtures = [
  { expressions: ["x^3", "x"], factor: 0.07777777777777777 },
  { expressions: ["x^2"], factor: 0.46666666666666656 },
  { expressions: ["sin(x)"], factor: 1 },
];
let checks = 0;
let failures = 0;
function check(name: string, run: () => void): void {
  checks++;
  try { run(); }
  catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const fixture of fixtures) {
  const document = GRAPH_GENERATORS.function_graph!({
    question: `Plot ${fixture.expressions.map(body => `y=${body}`).join(" and ")}.`,
    slots: { expressions: fixture.expressions, xMin: -3, xMax: 3 },
    sources: { expressions: "stem", xMin: "stem", xMax: "stem" },
    quantities: [], schematic: false,
  });
  assert(document, "native function program must be generated");
  const scaled = fixture.factor !== 1;
  check(`${fixture.expressions}: declared transform`, () => {
    if (!scaled) {
      assert.equal(document.source.functionDisplayTransform, undefined);
      assert.notEqual(document.source.nonMetric, true);
    } else {
      assert.deepEqual(document.source.functionDisplayTransform, {
        schemaVersion: "function-display/v1", xScale: 1, yScale: fixture.factor,
      });
      assert.equal(document.source.nonMetric, true);
      assert.equal(document.source.representationTier, "qualitative_verified");
    }
  });
  check(`${fixture.expressions}: whole input bodies`, () => {
    const curves = document.constructions.filter(({ operator }) => operator === "function_curve");
    assert.equal(curves.length, fixture.expressions.length);
    for (const [index, curve] of curves.entries()) {
      const body = fixture.expressions[index]!;
      assert.equal(curve.inputs.expression, scaled ? `(${fixture.factor})*(${body})` : body);
      assert.equal(document.entities.find(entity => entity.id === curve.outputs[0])?.label, `y=${body}`);
    }
  });
  check(`${fixture.expressions}: truthful tier`, () => {
    const result = resolveTier({ document, archetype: "function_graph", sources: { expressions: "stem", xMin: "stem", xMax: "stem" }, schematic: false });
    assert.equal(result.tier, scaled ? "qualitative_verified" : "exact_verified");
    assert.equal(result.nonMetric, scaled);
  });
  check(`${fixture.expressions}: native geometry and labels unchanged`, () => {
    const unmarked = structuredClone(document);
    delete unmarked.source.functionDisplayTransform;
    delete unmarked.source.nonMetric;
    delete unmarked.source.representationTier;
    const current = compileSceneDocument(document);
    const legacy = compileSceneDocument(unmarked);
    assert(current.ok && current.renderScene, JSON.stringify(current.report.issues));
    assert(legacy.ok && legacy.renderScene, JSON.stringify(legacy.report.issues));
    assert.deepEqual(current.renderScene, legacy.renderScene);
    const reopened = validateSceneDocument(JSON.parse(JSON.stringify(document)));
    assert(reopened.document, JSON.stringify(reopened.report.issues));
    assert.deepEqual(reopened.document.source, document.source, "the display declaration survives schema/JSON round trips");
    const compiledReopened = compileSceneDocument(reopened.document);
    assert(compiledReopened.ok && compiledReopened.renderScene, JSON.stringify(compiledReopened.report.issues));
    assert.deepEqual(compiledReopened.renderScene, current.renderScene);
  });
  check(`${fixture.expressions}: an explicit nonmetric declaration only lowers authority`, () => {
    const lowered = structuredClone(document);
    lowered.source.nonMetric = true;
    const result = resolveTier({ document: lowered, archetype: "function_graph", sources: { expressions: "stem", xMin: "stem", xMax: "stem" }, schematic: false });
    assert.equal(result.tier, "qualitative_verified");
    assert.equal(result.nonMetric, true);
  });
}
console.log(`source function display: ${checks - failures}/${checks} checks passed`);
if (failures) process.exitCode = 1;
