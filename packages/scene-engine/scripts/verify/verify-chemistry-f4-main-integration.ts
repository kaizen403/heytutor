/** Reviewed source-role fixes composed with current-main chemistry and real physics producers. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { inferSceneCapabilities } from "../../../tutor-core/src/planners/sceneCapabilities";
import { inferChemistryFamilies, isChemistryQuestion, isChemistrySceneFamily } from "../../src/chemistry";
import { isChemistryStem } from "../../src/chemistry/classify";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { attemptArchetypeScene } from "../../src/archetypes";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-f4-main-integration.json";
import selection from "./fixtures/chemistry-f4-main-selection.json";
import ownerTransfers from "./fixtures/chemistry-f4-main-owner-transfers.json";

interface Gold { id: string; question: string; kind: string; family?: string; halfLife?: number; time?: number; remaining?: number }
function near(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) < Math.abs(expected) * 1e-10); }
function compiled(document: SceneDocument | null, question: string): SceneDocument {
  assert.ok(document, "source-bound family declined"); assert.equal(document.source?.question, question);
  const output = compileSceneDocument(document); assert.ok(output.ok && output.renderScene, "ordinary compiler must accept complete figure");
  return document;
}
const results: Array<{ id: string; passed: boolean; error?: string; document?: SceneDocument | null; capabilities?: unknown; attempt?: unknown }> = [];
for (const row of fixtures as Gold[]) {
  const record: typeof results[number] = { id: row.id, passed: false };
  try {
    if (row.kind === "kinetics") {
      const spec = kineticsFromStem(row.question); assert.ok(spec);
      const solution = solveKinetics(spec); near(solution.tHalf!, row.halfLife!);
      assert.equal(solution.timeUnit, "min");
      near(solution.remainingAtTimes.find(point => point.time === row.time)!.remaining, row.remaining!);
      record.document = compiled(buildKineticsScene(row.question, [], false), row.question);
      assert.equal(synthesizeFamilyScene({ question: row.question })?.family, "chem_kinetics");
    } else if (row.kind === "no-kinetics") {
      assert.equal(inferChemistryFamilies(row.question).includes("chem_kinetics"), false);
      assert.equal(buildKineticsScene(row.question, [], false), null);
    } else if (row.kind === "photoelectric") {
      const document = compiled(buildAtomicRadiationScene(row.question, [], false), row.question);
      const labels = document.entities.map(entity => entity.label ?? "").join("\n");
      for (const label of ["E=3.00 eV", "phi=2.00 eV", "K=1.00 eV"]) assert.ok(labels.includes(label), label);
      record.document = document; assert.ok(synthesizeFamilyScene({ question: row.question }));
    } else if (row.kind === "decline-photoelectric") {
      assert.equal(buildAtomicRadiationScene(row.question, [], false), null);
      assert.equal(synthesizeFamilyScene({ question: row.question }), null);
    } else if (row.kind === "chemistry") {
      assert.equal(isChemistryStem(row.question), true); assert.equal(isChemistryQuestion(row.question), true);
    } else {
      assert.equal(row.kind, "physics"); assert.equal(isChemistryQuestion(row.question), false);
      assert.deepEqual(inferChemistryFamilies(row.question), []);
      const gold = selection.find(candidate => candidate.id === row.id); assert.ok(gold);
      assert.equal(createHash("sha256").update(row.question).digest("hex"), gold.questionSHA256);
      const capabilities = inferSceneCapabilities(row.question); record.capabilities = capabilities;
      assert.equal(capabilities.families.some(isChemistrySceneFamily), false); assert.ok(capabilities.families.some(family => family === gold.family));
      const attempt = attemptArchetypeScene({ question: row.question }); record.attempt = attempt;
      assert.equal(attempt.match?.id, gold.archetype); assert.ok(attempt.scene);
      const selected = synthesizeFamilyScene({ question: row.question }); assert.ok(selected);
      assert.equal(selected.family, gold.family); assert.equal(selected.document.source?.archetype, gold.archetype);
      const document = compiled(selected.document, row.question); record.document = document;
      for (const operator of gold.operators) assert.ok(document.constructions.some(step => step.operator === operator), operator);
      for (const [symbol, count] of Object.entries(gold.symbolCounts)) {
        if (count !== undefined) assert.ok(document.constructions.filter(step => step.operator === "symbol" && step.inputs.symbol === symbol).length >= count);
      }
      if (gold.bodyCount) assert.equal(document.entities.filter(entity => entity.role === "body").length, gold.bodyCount);
    }
    record.passed = true;
  } catch (error) { record.error = error instanceof Error ? error.message : String(error); }
  results.push(record);
}
for (const row of ownerTransfers) {
  try {
    const document = buildAtomicRadiationScene(row.question, [], false);
    assert.equal(!!document, row.draw);
    if (document) compiled(document, row.question);
    results.push({ id: row.id, passed: true, document });
  } catch (error) { results.push({ id: row.id, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
const report = { scope: "Actual source/direct/public physics archetypes, operators and chemistry source truth; fresh-built native proof remains separate.",
  passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const at = process.argv.indexOf("--out"); if (at >= 0) writeFileSync(process.argv[at + 1]!, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, failed: report.failed })); if (report.failed) process.exitCode = 1;
