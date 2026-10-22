/** A stated first-order law can own a normalized mathematical figure without claiming a species identity. */
import assert from "node:assert/strict";
import { readNeutralDecaySource, buildNeutralDecayScene } from "../../src/physics/neutralDecaySource";
import { compileSceneDocument } from "../../src/compile/compiler";
import fixtures from "./fixtures/chemistry-f4-neutral-law-source.json";
const outcomes: unknown[] = [];
let failures = 0;
for (const row of fixtures) {
  try {
    const result = readNeutralDecaySource(row.question);
    const document = buildNeutralDecayScene(row.question);
    assert.equal(result.status === "source", row.draw);
    assert.equal(document !== null, row.draw);
    if (row.draw) {
      assert.ok(result.status === "source" && document);
      assert.equal(document.source.question, row.question);
      assert.equal(document.source.chemistryFamily, undefined);
      assert.equal(document.source.sourceModel, "mathematical_fraction_decay");
      assert.equal(result.model.timeUnit, row.unit);
      assert.equal(result.model.requested.time, row.time);
      assert.ok(Math.abs(result.model.requested.remaining - row.fraction!) < 1e-12);
      const fraction = document.quantities.find(q => q.id === "requested_fraction")?.value;
      assert.ok(typeof fraction === "number" && Math.abs(fraction - row.fraction!) < 1e-12);
      const compiled = compileSceneDocument(document);
      assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled));
      assert.ok(document.assertions.filter(a => a.predicate === "function_value").every(a => a.severity === "fatal"));
    }
    outcomes.push({id:row.id, question:row.question, passed:true, result, document});
  } catch(error) {
    failures++;
    outcomes.push({id:row.id, question:row.question, passed:false, error:String(error)});
  }
}
console.log(JSON.stringify({passed:fixtures.length-failures, failed:failures, outcomes}));
process.exitCode = failures ? 1 : 0;
