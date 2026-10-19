/** Generic curves retain the complete native MAIN render, including their labels. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { RenderScene, SceneDocument } from "../../src/types";

interface NativeArcOracle {
  degrees: number;
  document: SceneDocument;
  renderScene: RenderScene;
}
const fixture = JSON.parse(readFileSync(new URL("./fixtures/generic-arc-native-oracles.json", import.meta.url), "utf8")) as {
  schemaVersion: string; sourceCommit: string; records: NativeArcOracle[];
};
assert.equal(fixture.schemaVersion, "generic-arc-native-oracles/v1");
assert.equal(fixture.sourceCommit, "aeb3eb11e4d5cbc5e074fa2b590a09fdb4734eb6");
assert.deepEqual(fixture.records.map((record) => record.degrees), [270, 360]);
let passed = 0;
const failures: string[] = [];
for (const oracle of fixture.records) {
  const name = `generic ${oracle.degrees} degree arc retains complete native render and labels`;
  try {
    const result = compileSceneDocument(structuredClone(oracle.document));
    assert.ok(result.ok && result.renderScene, "native-valid generic arc must render");
    // The oracle captures the complete serialized native output, not selected fields.
    assert.equal(JSON.stringify(result.renderScene), JSON.stringify(oracle.renderScene),
      "all serialized native primitives, labels, bounds, reveal and identity remain exact");
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`generic arc native controls: ${passed}/${fixture.records.length} passed`);
if (failures.length) process.exitCode = 1;
