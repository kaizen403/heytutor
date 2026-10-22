/** Authored original-span and physical-identity oracles. No recorded plans. */
import assert from "node:assert/strict";
import fs from "node:fs";
import "../../src/chemistry/families";
import { readChemistryQuantity, findChemistryQuantities, chemistryPlanBindingsValid, type ChemistryDimension, type ChemistryUnit } from "../../src/chemistry/quantityReader";
import { SceneBuilder } from "../../src/archetypes/document";
import { checkVisualObligations, type VisualObligationSet } from "../../src/synthesize/visualObligations";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/chemistry-deposition-boundaries.json", import.meta.url), "utf8")) as {
  units: Array<{ id: string; question: string; cue: string; dimension: ChemistryDimension; unit: ChemistryUnit; text: string | null }>;
  phase: Array<{ id: string; problemLabel: string; sceneLabel: string; expectedSamePhysicalIdentity: boolean }>;
  deposition: Array<{ id: string; question: string; draw: boolean }>;
};
const results: unknown[] = [];
let failed = 0;
function check(id: string, run: () => unknown): void {
  try { results.push({ id, actual: run(), error: null }); }
  catch (error) { failed++; results.push({ id, error: String(error) }); }
}
for (const row of fixture.units) check(row.id, () => {
  const full = readChemistryQuantity({ question: row.question, after: new RegExp(row.cue), dimension: row.dimension, targetUnit: row.unit });
  assert.equal(full.ok, row.text !== null);
  if (!full.ok || row.text === null) return full;
  assert.equal(full.reading.source.text, row.text);
  const start = row.question.indexOf(row.text);
  const end = start + row.text.length;
  assert.deepEqual(full.reading.source.span, { start, end });
  const within = readChemistryQuantity({ question: row.question, after: new RegExp(row.cue), within: { start: 0, end }, dimension: row.dimension, targetUnit: row.unit });
  assert.ok(within.ok); assert.deepEqual(within.reading, full.reading);
  assert.ok(chemistryPlanBindingsValid(row.question, [{ id: "source", symbol: "source", value: full.reading.value, unit: row.unit, origin: "given", sourceText: row.question.slice(0, end) }]));
  const unowned = findChemistryQuantities({ question: row.question, dimension: "dimensionless" });
  assert.ok(unowned.ok && unowned.reading.length === 0, "unit exponent is notation, not a new scalar");
  return { full, within };
});
for (const row of fixture.phase) check(row.id, () => {
  const s = new SceneBuilder("An authored identity comparison.", "physical body identity", "chem_electrochem");
  s.helper("left", { x: 0, y: 0 }); s.helper("right", { x: 2, y: 0 });
  s.segment("body", "left", "right", "actual physical solution body", row.sceneLabel);
  s.group("body_group", ["body"], "physical source body");
  const set: VisualObligationSet = { version: "visual-obligations/v1", problemId: "test", obligations: [{ id: "required", kind: "named_body", problemEntityIds: ["source_body"], problemEntityId: "source_body", problemKind: "body", problemLabel: row.problemLabel, label: row.problemLabel, factIds: [], supported: true }] };
  const document = s.build();
  const actual = checkVisualObligations(set, document);
  assert.equal(actual.satisfied, row.expectedSamePhysicalIdentity);
  if (row.expectedSamePhysicalIdentity) {
    assert.equal(checkVisualObligations({ ...set, obligations: [...set.obligations, { ...set.obligations[0]!, id: "second", problemEntityId: "second_body" }] }, document).satisfied, false, "one-to-one physical ownership");
    assert.equal(checkVisualObligations(set, { ...document, entities: document.entities.map(entity => entity.id === "body" ? { ...entity, kind: "label" as const } : entity) }).satisfied, false, "free text is not a physical body");
  }
  return actual;
});
for (const row of fixture.deposition) check(row.id, () => {
  const actual = synthesizeFamilyScene({ question: row.question });
  assert.equal(Boolean(actual), row.draw);
  return actual;
});
check("physical-apparatus-and-source-open-together", () => {
  const question = "A current of 1 A passes through aqueous CuSO4 for 20 min using inert electrodes. Calculate the mass of copper deposited at the cathode. Molar mass of Cu = 64 g/mol; F = 96500 C/mol.";
  const actual = synthesizeFamilyScene({ question });
  assert.ok(actual);
  const first = actual.document.revealGroups[0]!;
  for (const id of ["beaker", "cathode_bar", "deposit", "deposition_fact_0", "deposition_fact_1", "deposition_fact_2", "deposition_fact_3"]) assert.ok(first.entityIds.includes(id), `first physical setup: ${id}`);
  assert.ok(!first.entityIds.includes("mass"), "mass answer follows source setup");
  const labels = ["aqueous CuSO4 solution", "cathode", "deposited copper"];
  const set: VisualObligationSet = { version: "visual-obligations/v1", problemId: "source", obligations: labels.map((label, index) => ({ id: `body${index}`, kind: "named_body", problemEntityIds: [`body${index}`], problemEntityId: `body${index}`, problemKind: "body", problemLabel: label, label, factIds: [], supported: true })) };
  assert.ok(checkVisualObligations(set, actual.document).satisfied, "source identities attach to actual physical components");
  return actual;
});
const out = process.argv.indexOf("--out");
if (out >= 0) fs.writeFileSync(process.argv[out + 1]!, JSON.stringify({ checks: results.length, failed, results }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ checks: results.length, passed: results.length - failed, failed }));
if (failed) process.exitCode = 1;
