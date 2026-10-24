/**
 * A contrasted shape is denied for its owner, never asserted.
 *
 *   positives  "bent rather than tetrahedral", "instead of linear", "unlike a
 *              tetrahedral shape", "tetrahedral is not the molecular shape",
 *              "not tetrahedral but bent": true plan claims for water admit
 *   property   "unlike the tetrahedral electron geometry, the molecular shape
 *              is bent" contrasts two properties; each stays positive for its
 *              own property, so a false electron geometry there still refuses
 *   controls   real wrong claims still refuse: "water is tetrahedral", "linear
 *              rather than bent", "NH3 is trigonal planar, not pyramidal",
 *              wrong hybridisation and lone-pair counts
 *   mutation   the reader without contrast negation turns the positives red;
 *              a role-blind contrast turns every property row red, including
 *              admitting the false electron geometry
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { vseprPlanConflict } from "../../src/chemistry/vsepr";

type Conflict = (question: string, plan: TurnPlanV3) => string | null;
interface Row { id: string; question: string; claim: string; expected: string | boolean; admit: boolean }

const WATER = "Why is water bent";
const NH3 = "What is the shape of NH3";
const POSITIVES: Row[] = [
  // Recorded short ask water_bent (Kimi K3 Fast), claim c2 verbatim.
  { id: "positive/water-bent-c2", question: WATER, claim: "The molecular shape is determined by the positions of atoms only, not lone pairs.", expected: "With two atoms bonded to oxygen, the molecular geometry is bent rather than tetrahedral.", admit: true },
  { id: "positive/instead-of", question: WATER, claim: "Water is bent instead of linear.", expected: true, admit: true },
  { id: "positive/rather-than-leading", question: "Explain the shape of H2O", claim: "Rather than linear, the molecular shape of H2O is bent.", expected: true, admit: true },
  { id: "positive/rather-than-list", question: WATER, claim: "Water is bent rather than linear or tetrahedral.", expected: true, admit: true },
  { id: "positive/unlike", question: WATER, claim: "Unlike a tetrahedral shape, water is bent.", expected: true, admit: true },
  { id: "positive/denied-subject", question: WATER, claim: "Tetrahedral is not the molecular shape of water; it is bent.", expected: true, admit: true },
  { id: "positive/not-but", question: WATER, claim: "The shape of water is not tetrahedral but bent.", expected: true, admit: true },
  { id: "positive/nh3-rather-than", question: NH3, claim: "NH3 is pyramidal rather than trigonal planar.", expected: true, admit: true },
];
const PROPERTY: Row[] = [
  { id: "property/unlike-electron-geometry", question: WATER, claim: "Unlike the tetrahedral electron geometry, the molecular shape of water is bent.", expected: true, admit: true },
  { id: "property/rather-than-electron-geometry", question: "Explain the shape of H2O", claim: "The molecular shape of H2O is bent rather than the tetrahedral electron geometry.", expected: true, admit: true },
  { id: "property/false-electron-geometry", question: WATER, claim: "Unlike the bent electron geometry, the molecular shape of water is bent.", expected: true, admit: false },
];
const CONTROLS: Row[] = [
  { id: "control/water-tetrahedral", question: WATER, claim: "Water is tetrahedral.", expected: true, admit: false },
  { id: "control/linear-rather-than-bent", question: WATER, claim: "The molecular shape of water is linear rather than bent.", expected: true, admit: false },
  { id: "control/tetrahedral-rather-than-bent", question: WATER, claim: "The shape is tetrahedral rather than bent.", expected: true, admit: false },
  { id: "control/tetrahedral-instead-of-bent", question: WATER, claim: "Water is tetrahedral instead of bent.", expected: true, admit: false },
  { id: "control/nh3-planar-not-pyramidal", question: NH3, claim: "NH3 is trigonal planar, not pyramidal.", expected: true, admit: false },
  { id: "control/nh3-planar-rather-than-pyramidal", question: NH3, claim: "NH3 is trigonal planar rather than pyramidal.", expected: true, admit: false },
  { id: "control/hybridisation", question: NH3, claim: "The nitrogen in NH3 is sp2 hybridised rather than sp3.", expected: true, admit: false },
  { id: "control/lone-pairs", question: NH3, claim: "NH3 has two lone pairs rather than one.", expected: true, admit: false },
  { id: "control/false-claim-expected-false", question: WATER, claim: "Water is bent rather than tetrahedral.", expected: false, admit: false },
];
const ALL = [...POSITIVES, ...PROPERTY, ...CONTROLS];

function plan(row: Row): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [], derived: [],
    lawIds: [], assumptions: [], qualitativeClaims: [{ id: "c", claim: row.claim, expected: row.expected }],
    visualRequirement: "required",
  };
}
function red(conflict: Conflict, rows: readonly Row[]): string[] {
  return rows.filter(row => (conflict(row.question, plan(row)) === null) !== row.admit).map(row => row.id);
}

const failures: string[] = [];
let passed = 0;
function check(id: string, run: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(run).then(() => { passed++; }, (error: unknown) => {
    failures.push(id);
    console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

for (const row of ALL) {
  await check(row.id, () => assert.equal(vseprPlanConflict(row.question, plan(row)) === null, row.admit, vseprPlanConflict(row.question, plan(row)) ?? "admitted"));
}

// Mutants are copies of vsepr.ts beside it, so its relative imports resolve.
const source = fileURLToPath(new URL("../../src/chemistry/vsepr.ts", import.meta.url));
const original = readFileSync(source, "utf8");
async function mutant(name: string, from: string, to: string): Promise<Conflict> {
  assert.ok(original.includes(from), `mutation ${name} anchor is missing`);
  const text = original.replace(from, to);
  assert.notEqual(text, original, `mutation ${name} changed nothing`);
  const path = source.replace(/vsepr\.ts$/, `vsepr.mutant-${name}-${process.pid}.ts`);
  writeFileSync(path, text);
  try { return ((await import(path)) as { vseprPlanConflict: Conflict }).vseprPlanConflict; }
  finally { rmSync(path, { force: true }); }
}
await check("mutation/no-contrast-negation", async () => {
  const conflict = await mutant("no-contrast", " || contrastedShape(clause, roles, shapes, index)", "");
  const went = red(conflict, ALL);
  assert.ok(went.length >= 5, `too few red rows: ${went.join(", ")}`);
  assert.ok(went.every(id => id.startsWith("positive/")), `only positives go red: ${went.join(", ")}`);
  assert.ok(went.includes("positive/water-bent-c2"), "the recorded claim must depend on the reader");
});
await check("mutation/role-blind-contrast", async () => {
  const conflict = await mutant("role-blind", "return own === null || other === null || own === other;", "return true || own === other;");
  const went = red(conflict, ALL);
  // Role-blind negation also admits a false electron geometry: the property check is live both ways.
  assert.deepEqual(went, PROPERTY.map(row => row.id));
});

console.log(`verify-vsepr-contrast-claims: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
