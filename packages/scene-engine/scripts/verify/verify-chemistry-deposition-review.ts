/** Authored deposition source repetitions and compact physical identity. */
import assert from "node:assert/strict";
import fs from "node:fs";
import "../../src/chemistry/families";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { findChemistryQuantities } from "../../src/chemistry/quantityReader";
import { readDepositionMassSource } from "../../src/chemistry/electrolysisSource";
import { elementBySymbol } from "../../src/chemistry/elements";
import type { SceneDocument } from "../../src/types";

interface Row { id: string; question: string; expectedDraw: boolean; depositSymbol?: string; molarMass?: number; electronsPerAtom?: number }
const rows = JSON.parse(fs.readFileSync(new URL("./fixtures/chemistry-deposition-review.json", import.meta.url), "utf8")) as Row[];
const results: Array<{ id: string; error: string | null }> = [];
function check(id: string, work: () => void): void {
  try { work(); results.push({ id, error: null }); }
  catch (error) { results.push({ id, error: String(error) }); }
}
for (const row of rows) for (const [route, produce] of [["ordinary", synthesizeFamilyScene], ["last", synthesizeLastResortScene]] as const) check(`${row.id}/${route}`, () => {
  const actual = produce({ question: row.question });
  assert.equal(Boolean(actual), row.expectedDraw);
  if (!actual) return;
  assert.equal(actual.family, "chem_electrochem");
  const source = readDepositionMassSource(row.question, { symbol: row.depositSymbol!, n: row.electronsPerAtom! });
  assert.ok(source);
  if (row.molarMass !== undefined) assert.equal(source.molarMass, row.molarMass);
  assert.equal(source.grams, source.molarMass * source.charge / (source.electrons * source.faraday));
  for (const dimension of ["molar_mass", "faraday_constant"] as const) {
    const inventory = findChemistryQuantities({ question: row.question, dimension }); assert.ok(inventory.ok);
    for (const reading of inventory.reading) assert.ok(source.bindings.some(binding => binding.reading.source.span.start === reading.source.span.start && binding.reading.source.span.end === reading.source.span.end), "every accepted repeated occurrence is independently consumed");
  }
  const name = elementBySymbol(source.symbol)!.name.toLowerCase();
  const label = `deposited ${name}`;
  const displayed = label.length <= 16 ? label : `deposited ${source.symbol}`;
  assert.ok(actual.renderScene.primitives.some(primitive => primitive.entityId === "deposit" && primitive.text === displayed), "complete compact identity attaches to actual deposit");
  assert.ok(actual.document.revealGroups[0]!.entityIds.includes("deposit"));
});
for (const symbol of ["Mg", "Ca", "Al"]) {
  const row = rows.find(candidate => candidate.id === (symbol === "Al" ? "Al-supported-source-M" : `${symbol}-source-M`))!;
  const name = elementBySymbol(symbol)!.name.toLowerCase();
  const quote = `${name} deposited at the cathode`;
  const start = row.question.indexOf(quote); assert.ok(start >= 0);
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: `source_${symbol}`, question: row.question,
    facts: [{ id: "source_deposit", kind: "given", statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } }],
    entities: [{ id: "source_deposit_body", kind: "body", label: `deposited ${name}`, evidenceFactIds: ["source_deposit"] }],
    expressions: [], constraints: [], representationIntents: [{ id: "draw_deposit", kind: "conceptual", entityIds: ["source_deposit_body"], evidenceFactIds: ["source_deposit"] }], solveRequests: [],
  };
  check(`${symbol}/valid-authored-problemIR`, () => { assert.equal(validateProblemIR(problem, row.question).valid, true); });
  for (const [route, produce] of [["ordinary", synthesizeFamilyScene], ["last", synthesizeLastResortScene]] as const) check(`${symbol}/${route}/named-physical-deposit`, () => {
    const actual = produce({ question: row.question, problemIR: problem }); assert.ok(actual);
    const set = deriveVisualObligations(problem);
    assert.ok(checkVisualObligations(set, actual.document, row.question).satisfied);
    assert.ok(!checkVisualObligations(set, actual.document).satisfied, "compact role requires independent original source");
    const foreign = structuredClone(set); foreign.obligations[0] = { ...foreign.obligations[0]!, problemLabel: "deposited silver" } as typeof foreign.obligations[number];
    assert.ok(!checkVisualObligations(foreign, actual.document, row.question).satisfied, "no unrelated-name alias");
    for (const mutation of ["anchor", "paint", "free-label", "required", "reveal", "question"]) {
      const forged: SceneDocument = structuredClone(actual.document);
      if (mutation === "anchor") forged.constructions.find(construction => construction.outputs.includes("deposit"))!.inputs.end = "anode_bar";
      if (mutation === "paint") forged.entities.find(entity => entity.id === "deposit")!.provenance = { strokeWidth: 0 };
      if (mutation === "free-label") forged.entities.find(entity => entity.id === "deposit")!.kind = "label";
      if (mutation === "required") forged.requiredEntityIds = forged.requiredEntityIds.filter(id => id !== "deposit");
      if (mutation === "reveal") forged.revealGroups[0]!.entityIds = forged.revealGroups[0]!.entityIds.filter(id => id !== "deposit");
      if (mutation === "question") forged.source.question = "An unrelated electrolyte question.";
      forged.source.depositionProof = { verified: true, symbol };
      assert.ok(!checkVisualObligations(set, forged, row.question).satisfied, `cached metadata cannot authorize ${mutation}`);
    }
  });
}
const report = { checks: results.length, failed: results.filter(row => row.error !== null).length, results };
const output = process.argv.indexOf("--out");
if (output >= 0) fs.writeFileSync(process.argv[output + 1]!, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ checks: report.checks, passed: report.checks - report.failed, failed: report.failed }));
if (report.failed) process.exitCode = 1;
