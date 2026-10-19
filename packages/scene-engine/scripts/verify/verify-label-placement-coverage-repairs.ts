/** Native information and collision constraints; no image-quality claims. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { RenderPrimitive, SceneDocument } from "../../src/types";

interface RepairCase {
  id: string;
  document: SceneDocument;
  expectedDrawn: boolean;
  physicalPrimitives: RenderPrimitive[];
  originalLabels: Array<{ id: string; entityId: string; text: string }>;
  expectedRejection: { code: string; entityId: string } | null;
}
const fixture = JSON.parse(readFileSync(new URL("./fixtures/label-placement-coverage-transactions.json", import.meta.url), "utf8")) as {
  schemaVersion: string; records: RepairCase[];
};
assert.equal(fixture.schemaVersion, "label-placement-coverage-repairs/v2");
// The two old branch-only refusals are retained verbatim in the v1 fixture.
// ROOT approved only their default admission expectations changing in v2.
const original = JSON.parse(readFileSync(new URL("./fixtures/label-placement-coverage-repairs.json", import.meta.url), "utf8")) as { records: RepairCase[] };
for (const item of fixture.records) {
  const before = original.records.find(candidate => candidate.id === item.id)!;
  assert.deepEqual(item.document, before.document);
  assert.deepEqual(item.physicalPrimitives, before.physicalPrimitives);
  assert.deepEqual(item.originalLabels, before.originalLabels);
  if (["closed-section-physical-extent", "fixed-font-narrow-wedge"].includes(item.id)) {
    assert.equal(before.expectedDrawn, false);
    assert.equal(item.expectedDrawn, true);
  } else assert.equal(item.expectedDrawn, before.expectedDrawn);
}
const failures: string[] = [];
let passed = 0;
for (const item of fixture.records) {
  try {
    const source = JSON.stringify(item.document);
    const result = compileSceneDocument(item.document);
    assert.equal(JSON.stringify(item.document), source, "neither policy mutates the original document");
    if (!item.expectedDrawn) {
      const rejection = item.expectedRejection;
      assert.ok(rejection && !result.ok && !result.renderScene, "a physically invalid or infeasible scene must remain rejected");
      assert.ok(result.report.issues.some((issue) => issue.code === rejection.code && issue.entityIds?.includes(rejection.entityId)),
        "retain the original physical-extent or fixed-font collision guard");
    } else {
      assert.ok(result.ok && result.renderScene, `native scene must remain drawable: ${JSON.stringify(result.report.issues)}`);
      const physical = result.renderScene.primitives.filter((primitive) => primitive.kind !== "label" && primitive.provenance?.labelLeader !== true);
      assert.equal(JSON.stringify(physical), JSON.stringify(item.physicalPrimitives), "every native physical primitive remains exact");
      const labels = result.renderScene.primitives.filter((primitive) => primitive.kind === "label");
      const groups = new Map(item.document.revealGroups.flatMap(group => group.entityIds.map(id => [id, group.id] as const)));
      for (const before of item.originalLabels) {
        assert.ok(labels.some((after) => after.entityId === before.entityId &&
          after.groupId === groups.get(before.entityId) &&
          preservesLiteral(before.text, after.text ?? "")),
          `owner ${before.entityId} must retain original literal ${before.text}`);
      }
    }
    passed++;
    console.log(`PASS ${item.id}`);
  } catch (error) {
    failures.push(item.id);
    console.error(`FAIL ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`label placement coverage repairs: ${passed}/${fixture.records.length} passed`);
if (failures.length) process.exitCode = 1;

function preservesLiteral(before: string, after: string): boolean {
  if (before === after) return true;
  if (/^[^\W\d]\w*$/u.test(before)) {
    return after.startsWith(before) && /^(?:\s+|[=≈:])/u.test(after.slice(before.length));
  }
  return after.endsWith(` ${before}`);
}
