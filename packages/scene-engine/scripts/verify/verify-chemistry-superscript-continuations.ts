/** A retained unsupported power cannot lend its numeric prefix to any quantity owner. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { readChemistryQuantity, readChemistryLiteral, readChemistryQuantityDeclaration,
  parseChemistryScalar, findChemistryQuantities, type ChemistryDimension, type ChemistryUnit } from "../../src/chemistry/quantityReader";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import fixtures from "./fixtures/chemistry-superscript-continuations.json";

interface Gold {
  id: string; question: string; cue: string; dimension: ChemistryDimension; unit?: ChemistryUnit;
  raw: boolean; canonical: boolean; value?: number | null; prefixMustRefuse?: boolean; figure?: boolean;
}
function near(actual: number, expected: number): void {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-28, Math.abs(expected) * 1e-12), `${actual} != ${expected}`);
}
const results: unknown[] = [];
let passed = 0; let failed = 0;
for (const row of fixtures as Gold[]) {
  for (const arm of ["raw", "canonical"] as const) {
    const question = arm === "raw" ? row.question : normalizeTutorQuestion(row.question);
    const input = { question, after: new RegExp(row.cue), dimension: row.dimension, targetUnit: row.unit };
    const read = readChemistryQuantity(input);
    const declaration = readChemistryQuantityDeclaration({ ...input, owner: row.id });
    const errors: string[] = [];
    const check = (name: string, run: () => void): void => {
      try { run(); } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    };
    check("complete quantity", () => {
      assert.equal(read.ok, row[arm]);
      if (read.ok && row.value !== null && row.value !== undefined) near(read.reading.value, row.value);
      if (read.ok) assert.equal(question.slice(read.reading.source.span.start, read.reading.source.span.end), read.reading.source.text);
      // Three former raw-parser limitations are complete Unicode powers,
      // independently audited numeric gains, never borrowed numeric prefixes.
      const approvedRawPower = new Map([["valid-unicode-power","10⁻¹⁵"],["valid-positive-unicode","10¹⁵"],["valid-normalized-gibbs","10⁻¹⁵"]]).get(row.id);
      if(arm==="raw"&&approvedRawPower){assert.ok(read.ok);assert.deepEqual(read.reading.source.span,{start:question.indexOf(approvedRawPower),end:question.indexOf(approvedRawPower)+approvedRawPower.length});assert.equal(read.reading.source.text,approvedRawPower);}
    });
    check("supplied declaration", () => assert.equal(declaration.state, row[arm] ? "valid" : "invalid"));
    let prefix: unknown = null;
    if (row.prefixMustRefuse) {
      const start = question.indexOf("10"); assert.ok(start >= 0);
      const scalarSpan = { start, end: start + 2 };
      const scalar = parseChemistryScalar(question, scalarSpan);
      const literal = readChemistryLiteral({ ...input, scalarSpan });
      const chopped = readChemistryQuantity({ ...input, within: { start: 0, end: scalarSpan.end } });
      const inventory = findChemistryQuantities({ question, dimension: row.dimension });
      prefix = { scalarSpan, scalar, literal, chopped, inventory };
      check("original numeric prefix", () => assert.equal(scalar.ok, false));
      check("literal prefix", () => assert.equal(literal.ok, false));
      check("chopped caller window", () => assert.equal(chopped.ok, false));
      check("inventory never owns prefix", () => {
        if (inventory.ok) assert.equal(inventory.reading.some(reading => reading.source.span.start === start), false);
      });
    }
    if (errors.length) failed++; else passed++;
    results.push({ id: row.id, arm, question, gold: row[arm], read, declaration, prefix, passed: errors.length === 0, errors });
  }
  if (row.figure !== undefined) {
    const question = normalizeTutorQuestion(row.question);
    for (const route of ["chemical", "thermo", "schematic", "ordinary", "lastResort"] as const) {
      const document = route === "chemical" ? buildChemicalThermodynamicsScene(question, [], false)
        : route === "thermo" || route === "schematic" ? buildThermoGraphScene(question, [], route === "schematic")
          : (route === "ordinary" ? synthesizeFamilyScene : synthesizeLastResortScene)({ question })?.document ?? null;
      const compiled = document ? compileSceneDocument(document) : null;
      const errors: string[] = [];
      try {
        assert.equal(!!document, row.figure, "whole source-bound figure draw/refusal");
        if (document) { assert.equal(document.source?.question, question); assert.ok(compiled?.ok && compiled.renderScene); }
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      if (errors.length) failed++; else passed++;
      results.push({ id: row.id, route, question, expectedDraw: row.figure, document, compiled, passed: errors.length === 0, errors });
    }
  }
}
const report = { scope: "Original complete scalar boundaries and actual source/public figure refusal; no saved-board or coverage claim.", passed, failed, results };
const at = process.argv.indexOf("--out");
if (at >= 0) writeFileSync(process.argv[at + 1]!, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed, failed }));
if (failed) process.exitCode = 1;
