/** Existing ordinary organic figures use the existing-components proof, never Compare. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { getSegmentCommands } from "@heytutor/drawing";
import { synthesizeFamilyScene, compileSceneDocument, prepareSourceBoundChemistryStructure, type SceneDocument } from "@heytutor/scene-engine";
import { buildSourceBoundChemistryPresentation, buildVerifiedDiagramPresentation, NeutralPanelPresentationDeclined } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/chemistry-bond-mark-multiplicity.json", import.meta.url), "utf8")) as { existingRows: Array<{ question: string; accept: boolean }> };
const rows: Array<{ id: string; passed: boolean; error: string | null; actual: unknown }> = [];
function check(id: string, run: () => unknown): void {
  try { rows.push({ id, passed: true, error: null, actual: run() }); }
  catch (error) { rows.push({ id, passed: false, error: error instanceof Error ? error.message : String(error), actual: null }); }
}
for (const row of fixture.existingRows) {
  const question = row.question;
  const selected = synthesizeFamilyScene({ question });
  assert.equal(selected?.family, "chem_organic"); assert.ok(selected);
  const document = selected.document;
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene);
  const renderScene = compiled.renderScene;
  check(`existing-proof-and-opening/${question}`, () => {
    const prepared = prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument: document, compiledWitness: renderScene });
    assert.ok(prepared.status === "verified", JSON.stringify(prepared));
    assert.equal(prepared.proof.version, "existing-organic-structure-proof/v1");
    const presentation = buildSourceBoundChemistryPresentation(document, renderScene, { originalQuestion: question });
    const opening = presentation.introSegments.flatMap(getSegmentCommands);
    for (const label of prepared.labels) {
      assert.equal(opening.filter(command => command.semanticRef?.primitiveId === label.primitiveId && command.semanticRef.entityId === label.entityId && command.text === label.text).length, 1, "every independently bound symbol/name opens with its real graph");
    }
    assert.ok(opening.every(command => command.type !== "WRITE" && command.type !== "CLEAR"));
    return { document, renderScene, prepared, presentation };
  });
  check(`existing-JSON-reopen/${question}`, () => {
    const expected = buildSourceBoundChemistryPresentation(document, renderScene, { originalQuestion: question });
    const reopened = buildSourceBoundChemistryPresentation(JSON.parse(JSON.stringify(document)), JSON.parse(JSON.stringify(renderScene)), { originalQuestion: question });
    assert.deepEqual(JSON.parse(JSON.stringify(reopened)), JSON.parse(JSON.stringify(expected)), "every serialized command/proof/reveal field survives reopen");
    const prepared = prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument: JSON.parse(JSON.stringify(document)), compiledWitness: JSON.parse(JSON.stringify(renderScene)) });
    assert.ok(prepared.status === "verified");
    assert.equal(prepared.proof.version, "existing-organic-structure-proof/v1");
    return reopened;
  });
  for (const mutation of ["bond", "name", "source-question", "source-span-claim"] as const) check(`existing-raw-${mutation}-refusal/${question}`, () => {
    const changed: SceneDocument = structuredClone(document);
    if (mutation === "bond") {
      const line = changed.constructions.find(value => value.operator === "segment"); assert.ok(line);
      line.inputs.end = line.inputs.start;
    } else if (mutation === "name") { const name = changed.entities.find(value => value.id === "m0_name"); assert.ok(name); name.label = "ethanol"; }
    else if (mutation === "source-question") changed.source.question = "Draw the skeletal structure of ethanol.";
    else changed.source.cachedProof = { version: "existing-organic-structure-proof/v1", sourceBindings: [{ source: { start: 0, end: question.length, text: question }, graphIdentity: "trusted" }] };
    // The changed candidate reaches both boundaries raw; no test cleanup/repair.
    const prepared = prepareSourceBoundChemistryStructure({ originalQuestion: question, rawDocument: changed });
    assert.equal(prepared.status, "declined");
    assert.throws(() => buildSourceBoundChemistryPresentation(changed, renderScene, { originalQuestion: question }), error => error instanceof NeutralPanelPresentationDeclined);
    assert.throws(() => buildSourceBoundChemistryPresentation(JSON.parse(JSON.stringify(changed)), JSON.parse(JSON.stringify(renderScene)), { originalQuestion: question }), error => error instanceof NeutralPanelPresentationDeclined);
    return { document: changed, prepared };
  });
}
check("actual ordinary line transport retains its authored width", () => {
  const question = "Draw the Lewis structure of CO2.", selected = synthesizeFamilyScene({ question });
  assert.equal(selected?.family, "chem_lewis"); assert.ok(selected);
  const document = selected.document, ids = document.entities.filter(entity => entity.kind === "segment" && (entity.role === "double bond" || entity.role === "double bond stroke")).map(entity => entity.id);
  assert.equal(ids.length, 4);
  for (const id of ids) document.entities.find(entity => entity.id === id)!.provenance = { strokeWidth: .5 };
  const compiled = compileSceneDocument(document); assert.ok(compiled.ok && compiled.renderScene);
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  for (const id of ids) {
    const commands = presentation.diagram.commands.filter(command => command.semanticRef?.entityId === id);
    assert.equal(commands.length, 1); assert.equal(commands[0]!.type, "DRAW_LINE"); assert.equal(commands[0]!.visualStyle?.strokeWidth, .5);
  }
  return { document, compiled, presentation };
});
const result = { scope: "public-existing-organic-structure-proof-presentation-and-JSON-reopen", passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }));
if (result.failed) process.exitCode = 1;
