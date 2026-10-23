/** Multiple-bond marks are a joint geometric witness; existing organic is a separate route. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildLewisScene, lewisStructure } from "../../src/chemistry/lewis";
import { auditChemistryRepresentation, readChemistryRepresentation } from "../../src/chemistry/representation/audit";
import { existingOrganicComponents } from "../../src/chemistry/representation/existingOrganicSource";
import { prepareSourceBoundChemistryStructure } from "../../src/chemistry/representation/existingOrganicStructure";
import { buildSourceBoundNeutralComparison } from "../../src/chemistry/representation/neutralComparisonFactory";
import { bindLewisRepresentation } from "../../src/chemistry/representation/bindings";
import { compileSceneDocument } from "../../src/compile/compiler";
import { prepareVerifiedParts } from "../../src/compile/verifiedParts";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import fixture from "./fixtures/chemistry-bond-mark-multiplicity.json";

const rows: Array<{ id: string; passed: boolean; error: string | null; actual: unknown }> = [];
function check(id: string, actual: unknown, run: () => void): void {
  try { run(); rows.push({ id, passed: true, error: null, actual }); }
  catch (error) { rows.push({ id, passed: false, error: error instanceof Error ? error.message : String(error), actual }); }
}
function point(document: SceneDocument, id: string): { x: number; y: number } {
  const construction = document.constructions.find(value => value.outputs.includes(id));
  assert.ok(construction);
  if (construction.operator === "label") return point(document, String(construction.inputs.target));
  assert.equal(construction.operator, "point");
  assert.equal(typeof construction.inputs.x, "number"); assert.equal(typeof construction.inputs.y, "number");
  return { x: Number(construction.inputs.x), y: Number(construction.inputs.y) };
}
for (const row of fixture.bondRows) {
  const question = `Draw the Lewis structure of ${row.formula}.`;
  const generated = buildLewisScene(question, [], false), resolved = lewisStructure(row.formula);
  assert.ok(generated && resolved, question);
  const document = bindLewisRepresentation(generated, [{ sourceText: row.formula, prefix: "s1_", result: resolved }]);
  assert.ok(document, "ordinary generated geometry must pass the real source binder");
  const metadata = readChemistryRepresentation(document.source.chemistryRepresentation);
  assert.ok(metadata);
  const binding = metadata.species[0]!;
  const bond = binding.bonds.find(value => value.entityIds.length > 1);
  assert.ok(bond);
  const first = binding.nodes.find(node => node.nodeKey === bond.a)!;
  const last = binding.nodes.find(node => node.nodeKey === bond.b)!;
  const a = point(document, first.entityId), b = point(document, last.entityId);
  const dx = b.x - a.x, dy = b.y - a.y;
  if (row.mutation === "broken") bond.entityIds.pop();
  else for (const [index, id] of bond.entityIds.entries()) {
    const construction = document.constructions.find(value => value.outputs.includes(id));
    assert.equal(construction?.operator, "segment");
    if (row.mutation === "none") continue;
    if (row.mutation === "reversed") {
      [construction.inputs.start, construction.inputs.end] = [construction.inputs.end, construction.inputs.start];
      continue;
    }
    let low = .1, high = .9, offset = 0, lastOffset = 0;
    if (row.mutation === "unequal-collinear") { low = .1 + .05 * index; high = .9 - .05 * index; }
    if (row.mutation === "near-coincident") offset = lastOffset = index * 1e-7;
    if (row.mutation === "subpixel") { low = .1 + .05 * index; high = .9 - .05 * index; offset = lastOffset = index * .001 / Math.hypot(dx, dy); }
    if (row.mutation === "thin-width-separated") {
      low = .1 + .05 * index; high = .9 - .05 * index; offset = lastOffset = index * .0035 / Math.hypot(dx, dy);
      document.entities.find(entity => entity.id === id)!.provenance = { strokeWidth: .1 };
    }
    if (row.mutation === "detached") { low = -.002 / Math.hypot(dx, dy); offset = lastOffset = index ? .06 : -.06; }
    if (row.mutation === "skewed") { offset = index ? .06 : -.06; lastOffset = offset + (index ? .04 : 0); }
    if (row.mutation === "short-overlap") { low = index ? .44 : 0; high = index ? 1 : .56; offset = lastOffset = index ? .06 : -.06; }
    for (const [reference, fraction, displacement] of [[construction.inputs.start, low, offset], [construction.inputs.end, high, lastOffset]] as const) {
      const anchor = document.constructions.find(value => value.operator === "point" && value.outputs.includes(String(reference)));
      assert.ok(anchor);
      anchor.inputs.x = a.x + fraction * dx - displacement * dy;
      anchor.inputs.y = a.y + fraction * dy + displacement * dx;
    }
  }
  const audit = auditChemistryRepresentation(document, question);
  const compiled = compileSceneDocument(document);
  const flagOn = compileSceneDocument(document, { yieldPolicy: "verified_parts" });
  const repaired = prepareVerifiedParts(document, { enabled: true });
  const actual = { document, auditIssues: audit.issues, structuralSymbolIds: [...audit.structuralSymbolIds], compiled, flagOn, repaired };
  check(row.id, actual, () => {
    const nativeOverlap = row.mutation === "subpixel";
    if (!nativeOverlap) assert.equal(audit.issues.length === 0, row.accept, "independent joint bond-stroke oracle");
    assert.equal(compiled.ok, row.accept, JSON.stringify(compiled.report.issues));
    assert.equal(Boolean(compiled.renderScene), row.accept);
    assert.equal(flagOn.ok, row.accept, "verified_parts never omits a false bond");
    assert.equal(repaired.compiledScene?.ok, row.accept, "yield repair retains core bond truth");
    assert.deepEqual(repaired.document.entities, document.entities); assert.deepEqual(repaired.document.constructions, document.constructions);
    if (!row.accept && !nativeOverlap) assert.ok(audit.issues.some(issue => issue.code === "chemistry_bond_topology"));
    if (nativeOverlap) assert.ok(flagOn.report.issues.some(issue => issue.code === "chemistry_bond_native_ink" && issue.failureKind === "truth"));
  });
}
for (const row of fixture.styleRows) {
  const question = `Draw the Lewis structure of ${row.formula}.`;
  const generated = buildLewisScene(question, [], false), resolved = lewisStructure(row.formula);
  assert.ok(generated && resolved);
  const document = bindLewisRepresentation(generated, [{ sourceText: row.formula, prefix: "s1_", result: resolved }]); assert.ok(document);
  const binding = readChemistryRepresentation(document.source.chemistryRepresentation)!.species[0]!;
  const bond = binding.bonds.find(value => value.entityIds.length > 1)!;
  for (const id of bond.entityIds) {
    const entity = document.entities.find(value => value.id === id)!;
    entity.provenance = "strokeWidth" in row ? { strokeWidth: row.strokeWidth } : { dashed: row.dashed };
  }
  const compiled = compileSceneDocument(document), flagOn = compileSceneDocument(document, { yieldPolicy: "verified_parts" });
  const repaired = prepareVerifiedParts(document, { enabled: true });
  check(row.id, { document, compiled, flagOn, repaired }, () => {
    assert.equal(compiled.ok, row.accept); assert.equal(Boolean(compiled.renderScene), row.accept);
    assert.equal(flagOn.ok, row.accept); assert.equal(repaired.compiledScene?.ok, row.accept);
    if (!row.accept) assert.ok(flagOn.report.issues.some(issue => issue.code === "chemistry_bond_native_ink" && issue.failureKind === "truth"));
    assert.deepEqual(repaired.document.entities, document.entities); assert.deepEqual(repaired.document.constructions, document.constructions);
  });
}
for (const row of fixture.existingRows) {
  const question = row.question, selected = synthesizeFamilyScene({ question });
  assert.equal(selected?.family, "chem_organic");
  assert.ok(selected);
  const document = selected.document;
  const compiled = compileSceneDocument(document);
  const prepared = prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument: document, compiledWitness: compiled.renderScene });
  check(`existing/${question}`, { document, compiled, prepared }, () => {
    assert.ok(existingOrganicComponents(document, question));
    assert.ok(compiled.ok && compiled.renderScene);
    assert.equal(prepared.status, "verified"); assert.ok(prepared.status === "verified");
    assert.equal(prepared.proof.version, "existing-organic-structure-proof/v1");
    for (const label of prepared.labels) if (label.kind === "complete_source_name_line") {
      assert.equal(question.slice(label.sourceArgument.start, label.sourceArgument.end), label.sourceArgument.text);
      if (label.projection === "canonical_same_graph") {
        assert.equal(label.originalStart, label.sourceArgument.start); assert.equal(label.originalEnd, label.sourceArgument.end);
        assert.equal(label.text, "butanone"); assert.equal(label.sourceArgument.text, "butan-2-one");
      } else assert.equal(question.slice(label.originalStart, label.originalEnd).toLowerCase(), label.text.toLowerCase());
    }
    const reopened = prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument: JSON.parse(JSON.stringify(document)), compiledWitness: JSON.parse(JSON.stringify(compiled.renderScene)) });
    assert.deepEqual(JSON.parse(JSON.stringify(reopened)), JSON.parse(JSON.stringify(prepared)), "every serialized source/geometry/proof field survives JSON reopen");
  });
  for (const mutation of ["bond", "name", "source-question", "source-span-claim"] as const) {
    const changed = structuredClone(document);
    if (mutation === "bond") {
      const line = changed.constructions.find(value => value.operator === "segment"); assert.ok(line);
      line.inputs.end = line.inputs.start;
    } else if (mutation === "name") { const name = changed.entities.find(value => value.id === "m0_name"); assert.ok(name); name.label = "ethanol"; }
    else if (mutation === "source-question") changed.source.question = "Draw the skeletal structure of ethanol.";
    else changed.source.cachedProof = { version: "existing-organic-structure-proof/v1", sourceBindings: [{ source: { start: 0, end: question.length, text: question }, graphIdentity: "trusted" }] };
    const refused = prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument: changed });
    check(`existing/${mutation}/${question}`, { document: changed, prepared: refused }, () => {
      assert.equal(refused.status, "declined");
      assert.equal(prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument: JSON.parse(JSON.stringify(changed)) }).status, "declined");
    });
  }
}
const multiline = buildSourceBoundNeutralComparison({ originalQuestion: fixture.literalMultilineQuestion });
check("literal complete multiline name retains its source projections", multiline, () => {
  assert.ok(multiline.status === "verified");
  assert.ok(multiline.proof.nameLines.some(line => line.lineIndex > 0));
  for (const line of multiline.proof.nameLines) {
    assert.equal(line.projection, undefined);
    assert.equal(fixture.literalMultilineQuestion.slice(line.originalStart, line.originalEnd), line.text);
  }
  const reopened = prepareSourceBoundChemistryStructure({ originalQuestion: fixture.literalMultilineQuestion,
    rawDocument: JSON.parse(JSON.stringify(multiline.document)), compiledWitness: JSON.parse(JSON.stringify(multiline.renderScene)) });
  assert.deepEqual(JSON.parse(JSON.stringify(reopened)), JSON.parse(JSON.stringify(multiline)));
});
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }));
if (result.failed) process.exitCode = 1;
