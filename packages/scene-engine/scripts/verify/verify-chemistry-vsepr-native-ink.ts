/** Source-derived VSEPR coordinates must still become visible native bonds. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildVseprScene, vseprGeometry } from "../../src/chemistry/vsepr";
import { bindVseprRepresentation } from "../../src/chemistry/representation/bindings";
import { auditChemistryRepresentation, readChemistryRepresentation } from "../../src/chemistry/representation/audit";
import { compileSceneDocument } from "../../src/compile/compiler";
import { prepareVerifiedParts } from "../../src/compile/verifiedParts";
import fixture from "./fixtures/chemistry-vsepr-native-ink.json";

const rows = fixture.map(row => {
  const question = `Show the molecular shape of ${row.formula}.`;
  const generated = buildVseprScene(question, [], false), result = vseprGeometry(row.formula);
  assert.ok(generated && result);
  const bound = bindVseprRepresentation(generated, [{ sourceText: row.formula, prefix: "m1", result }]);
  assert.ok(bound, "the real VSEPR operator must bind before any paint mutation");
  const metadata = readChemistryRepresentation(bound.source.chemistryRepresentation); assert.ok(metadata);
  let mutated = 0;
  for (const bond of metadata.species[0]!.bonds) for (const id of bond.entityIds) {
    const entity = bound.entities.find(value => value.id === id); assert.ok(entity);
    const style = entity.kind === "polygon" ? "wedge" : entity.provenance?.dashed ? "dash" : "plain";
    if (row.width !== null && (row.target === "all" || row.target === style)) {
      entity.provenance = { ...entity.provenance, strokeWidth: row.width }; mutated++;
    }
  }
  if (row.width !== null) assert.ok(mutated, "the specified original bond operator was actually mutated");
  const audit = auditChemistryRepresentation(bound, question);
  const compiled = compileSceneDocument(bound), flagOn = compileSceneDocument(bound, { yieldPolicy: "verified_parts" }), repaired = prepareVerifiedParts(bound, { enabled: true });
  let error: string | null = null;
  try {
    assert.equal(audit.issues.length, 0, "coordinates/style remain independently source-valid; native paint is the missing obligation");
    for (const output of [compiled, flagOn, repaired.compiledScene]) {
      assert.equal(output?.ok, row.accept);
      if (!row.accept) assert.ok(output?.report.issues.some(issue => issue.code === "chemistry_bond_native_ink" && issue.severity === "fatal" && (output === compiled || issue.failureKind === "truth")));
    }
    assert.deepEqual(repaired.document.entities, bound.entities); assert.deepEqual(repaired.document.constructions, bound.constructions);
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  return { ...row, passed: error === null, error, document: bound, auditIssues: audit.issues, compiled, flagOn, repaired };
});
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }));
if (result.failed) process.exitCode = 1;
