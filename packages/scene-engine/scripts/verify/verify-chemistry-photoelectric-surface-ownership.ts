/** Frozen public surface-owner refusals and unchanged single-surface figures. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildAtomicRadiationScene, isAtomicRadiationStem } from "../../src/chemistry/atomicRadiation";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry/router";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument, RenderScene } from "../../src/types";
import rows from "./fixtures/chemistry-photoelectric-surface-ownership.json";
import nonclaimMain from "./fixtures/chemistry-photoelectric-nonclaim-main.json";

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith("--"), `${flag} needs a path`);
  return value;
}
function labels(render: RenderScene): string[] {
  return render.primitives.flatMap((primitive) => primitive.text ? [primitive.text] : []);
}
function direct(document: SceneDocument | null) {
  if (!document) return null;
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  return { document, renderScene: result.renderScene, labels: labels(result.renderScene) };
}
function synthesized(scene: ReturnType<typeof synthesizeFamilyScene>) {
  return scene ? { ...scene, labels: labels(scene.renderScene) } : null;
}
function outcome(question: string) {
  return {
    atomic: isAtomicRadiationStem(question),
    chemistry: isChemistryQuestion(question),
    families: inferChemistryFamilies(question),
    direct: direct(buildAtomicRadiationScene(question, [], false)),
    schematic: direct(buildAtomicRadiationScene(question, [], true)),
    ordinary: synthesized(synthesizeFamilyScene({ question })),
    lastResort: synthesized(synthesizeLastResortScene({ question })),
  };
}
// A saved baseline omits undefined object fields; compare both sides as JSON.
function persisted(value: ReturnType<typeof outcome>): ReturnType<typeof outcome> {
  return JSON.parse(JSON.stringify(value));
}
// Capture complete documents/rendered outcomes once. ROOT uses --snapshot on
// gate-only main, then --baseline for positive/nonclaim whole-outcome parity.
const observed = rows.map((row) => ({ id: row.id, question: row.question, outcome: outcome(row.question) }));
const snapshot = argument("--snapshot");
if (snapshot) writeFileSync(snapshot, JSON.stringify(observed, null, 2) + "\n", { flag: "wx" });
const baselinePath = argument("--baseline");
const baseline: typeof observed | null = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
if (baseline) {
  assert.equal(baseline.length, rows.length, "baseline contains all frozen rows");
  assert.deepEqual(baseline.map(({ id, question }) => ({ id, question })), observed.map(({ id, question }) => ({ id, question })), "ordered baseline question identities");
}
let passed = 0;
let failed = 0;
for (const [index, row] of rows.entries()) {
  try {
    const actual = observed[index]!.outcome;
    assert.equal(actual.atomic, row.expected.isAtomicRadiationStem, `${row.id} recognition`);
    if (row.kind.includes("nonclaim")) {
      const fixed = nonclaimMain.find((entry) => entry.id === row.id);
      assert.ok(fixed, `${row.id} fixed main scene outcome`);
      assert.equal(fixed.question, row.question);
      assert.deepEqual(persisted(actual), fixed.outcome, `${row.id} default entire main outcome`);
      if (baseline) assert.deepEqual(persisted(actual), persisted(baseline[index]!.outcome), `${row.id} entire main outcome`);
    } else {
      assert.ok(actual.families.includes("chem_orbital"), `${row.id} ordinary chemistry ownership`);
      if (row.kind.includes("negative")) {
        for (const path of ["direct", "schematic", "ordinary", "lastResort"] as const) {
          assert.equal(actual[path], null, `${row.id} ${path} must decline unsupported multiple surfaces`);
        }
      } else {
        const expectedLabels = "labels" in row.expected ? row.expected.labels : undefined;
        assert.ok(expectedLabels, `${row.id} independent labels are frozen`);
        for (const path of ["direct", "schematic", "ordinary", "lastResort"] as const) {
          const drawn = actual[path];
          assert.ok(drawn, `${row.id} ${path} must draw`);
          assert.equal(drawn.document.source.question, row.question, `${row.id} ${path} source question`);
          assert.equal(drawn.document.source.chemistryFamily, "chem_orbital", `${row.id} ${path} source family`);
          for (const label of expectedLabels) assert.ok(drawn.labels.includes(label), `${row.id} ${path} missing ${label}`);
          if ("mustNotHaveKLabel" in row.expected && row.expected.mustNotHaveKLabel) {
            assert.ok(!drawn.labels.some((label) => /^K=/.test(label)), `${row.id} ${path} below-threshold K`);
          }
        }
        assert.equal(actual.ordinary!.family, "chem_orbital");
        assert.equal(actual.lastResort!.family, "chem_orbital");
        if (baseline) assert.deepEqual(persisted(actual), persisted(baseline[index]!.outcome), `${row.id} complete main documents and outcomes`);
      }
    }
    passed++;
    console.log(`PASS ${row.id}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`verify-chemistry-photoelectric-surface-ownership: ${passed} checks passed / ${failed} failed`);
if (failed) process.exitCode = 1;
