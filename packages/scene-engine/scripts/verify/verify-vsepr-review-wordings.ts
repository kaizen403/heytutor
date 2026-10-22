/** Real review wordings: complete source sets and local claim polarity. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildVseprFigure, vseprPlanConflict } from "../../src/chemistry/vsepr";
import { verifiedVseprStructure } from "../../src/chemistry/vseprStructure";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

interface Word { id: string; question: string; requiredRestoration: boolean; expectedSpecies: number }
interface Claim { id: string; question: string; claim: string; expected: string | boolean; draw: boolean }
interface Unresolved { id: string; question: string }
interface Equatorial { species: string; equatorial: boolean }
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/vsepr-review-wordings.json", import.meta.url), "utf8")) as {
  wordings: Word[]; claims: Claim[]; unresolved: Unresolved[]; equatorial: Equatorial[];
};
let passed = 0;
const failures: string[] = [];
function test(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function plan(row: Claim): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [], derived: [],
    lawIds: [], assumptions: [], qualitativeClaims: [{ id: row.id, claim: row.claim, expected: row.expected }],
    visualRequirement: "required",
  };
}
for (const row of fixtures.wordings.filter(row => row.requiredRestoration)) {
  test(`complete molecular shape: ${row.id}`, () => {
    const figure = buildVseprFigure(row.question, [], false);
    assert.ok(figure, row.question);
    assert.equal(figure.structures.length, row.expectedSpecies);
    assert.ok(verifiedVseprStructure(figure.document, row.question));
    assert.ok(compileSceneDocument(figure.document).ok);
  });
}
for (const row of fixtures.claims) test(`owned claim truth: ${row.id}`, () => {
  assert.equal(vseprPlanConflict(row.question, plan(row)) === null, row.draw);
});
for (const row of fixtures.unresolved) test(`no partial substitute: ${row.id}`, () => {
  assert.equal(buildVseprFigure(row.question, [], false), null);
  assert.equal(synthesizeFamilyScene({ question: row.question }), null);
  assert.equal(synthesizeLastResortScene({ question: row.question }), null);
});
for (const row of fixtures.equatorial) test(`equatorial metadata is not universal: ${row.species}`, () => {
  const question = `Show the molecular shape of ${row.species}.`;
  const figure = buildVseprFigure(question, [], false);
  assert.ok(figure);
  const witness = verifiedVseprStructure(figure.document, question);
  assert.ok(witness);
  const pairs = witness.structures.flatMap(structure => structure.lonePairs);
  assert.ok(pairs.length > 0);
  assert.ok(pairs.every(pair => pair.equatorial === row.equatorial));
});
console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;

interface MethodRoleWord {
  id: string | number;
  question: string;
  expectedFamily: "chem_vsepr" | null;
  expectedSpecies: number;
  deferred?: boolean;
}
const methodRoleWords = JSON.parse(readFileSync(new URL("./fixtures/vsepr-method-role-wordings.json", import.meta.url), "utf8")) as MethodRoleWord[];
for (const row of methodRoleWords.filter(row => !row.deferred)) test(`method descriptor or chemical member: ${row.id}`, () => {
  const figure = buildVseprFigure(row.question, [], false);
  if (row.expectedFamily === null) {
    assert.equal(figure, null);
    assert.equal(synthesizeFamilyScene({ question: row.question }), null);
    assert.equal(synthesizeLastResortScene({ question: row.question }), null);
  } else {
    assert.ok(figure, row.question);
    assert.equal(figure.structures.length, row.expectedSpecies);
    assert.ok(verifiedVseprStructure(figure.document, row.question));
    assert.ok(compileSceneDocument(figure.document).ok);
  }
});
console.log(JSON.stringify({ scope: "Original 88 assertions plus method-role transfer", passed, failed: failures.length, failures, deferredMethodRoleWordings: methodRoleWords.filter(row => row.deferred).map(row => row.id) }, null, 2));
if (failures.length) process.exitCode = 1;

const memberRoleWords = JSON.parse(readFileSync(new URL("./fixtures/vsepr-method-role-wordings.json", import.meta.url), "utf8")) as Array<MethodRoleWord & { members?: string[] | null }>;
for (const row of memberRoleWords.filter(row => row.members)) test(`complete explicit member set: ${row.id}`, () => {
  const figure = buildVseprFigure(row.question, [], false);
  assert.ok(figure, row.question);
  const formulas = figure.structures.map(structure => figure.document.entities.find(entity => entity.id === structure.formulaId)?.label?.replace(/[^A-Za-z0-9+-]/g, ""));
  assert.deepEqual(formulas, row.members);
});
console.log(JSON.stringify({ scope: "Method roles and complete explicit member sets", passed, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
