/**
 * A contrasted shape is denied for its owner, never asserted.
 *
 *   positives  "bent rather than tetrahedral", "instead of linear", "unlike a
 *              tetrahedral shape", "tetrahedral is not the molecular shape",
 *              "not tetrahedral but bent": true plan claims for H2O admit
 *   property   "unlike the tetrahedral electron geometry, the molecular shape
 *              is bent" contrasts two properties; each stays positive for its
 *              own property, so a false electron geometry there still refuses
 *   controls   real wrong claims still refuse: "H2O is tetrahedral", "linear
 *              rather than bent", "NH3 is trigonal planar, not pyramidal",
 *              wrong hybridisation and lone-pair counts
 *   owners     a contrast between two molecules ("unlike the linear shape of
 *              CO2, H2O is bent") keeps each shape positive for its own
 *              owner, so a wrong shape for the asked molecule there refuses
 *   denied     "<shape> is not ..." denies the shape only when the words
 *              after "not" name the shape property: "the tetrahedral shape
 *              is not flat" admits, "the square planar shape is not
 *              distorted" for CH4 refuses; "bent is not the molecular shape
 *              of CO2" denies bent for CO2, so it admits for H2O, while the
 *              same denial of H2O refuses
 *   comma      a bare comma joins a contrasted list only when the list ends in
 *              or/nor and no member takes a predicate: "rather than
 *              tetrahedral, linear is the shape of H2O" checks linear
 *   reach      every row asks its molecule by formula, so the question resolves
 *              one species and the claim reaches the shape reader; with the
 *              shape claim reader disabled every shape refusal row admits
 *   mutation   the reader without contrast negation turns the positives red;
 *              a bare comma that always joins admits every false comma row;
 *              a role-blind contrast turns every property row red, including
 *              admitting the false electron geometry
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { vseprPlanConflict, vseprSpecies } from "../../src/chemistry/vsepr";

type Conflict = (question: string, plan: TurnPlanV3) => string | null;
interface Row { id: string; question: string; claim: string; expected: string | boolean; admit: boolean }

const WATER = "Why is H2O bent";
const NH3 = "What is the shape of NH3";
const POSITIVES: Row[] = [
  // Recorded short ask water_bent (Kimi K3 Fast), claim c2 verbatim, asked by formula.
  { id: "positive/water-bent-c2", question: WATER, claim: "The molecular shape is determined by the positions of atoms only, not lone pairs.", expected: "With two atoms bonded to oxygen, the molecular geometry is bent rather than tetrahedral.", admit: true },
  { id: "positive/instead-of", question: WATER, claim: "H2O is bent instead of linear.", expected: true, admit: true },
  { id: "positive/rather-than-leading", question: "Explain the shape of H2O", claim: "Rather than linear, the molecular shape of H2O is bent.", expected: true, admit: true },
  { id: "positive/rather-than-list", question: WATER, claim: "H2O is bent rather than linear or tetrahedral.", expected: true, admit: true },
  { id: "positive/instead-of-list", question: WATER, claim: "H2O is bent instead of linear, or tetrahedral.", expected: true, admit: true },
  { id: "positive/unlike", question: WATER, claim: "Unlike a tetrahedral shape, H2O is bent.", expected: true, admit: true },
  { id: "positive/denied-subject", question: WATER, claim: "Tetrahedral is not the molecular shape of H2O; it is bent.", expected: true, admit: true },
  { id: "positive/not-but", question: WATER, claim: "The shape of H2O is not tetrahedral but bent.", expected: true, admit: true },
  { id: "positive/nh3-rather-than", question: NH3, claim: "NH3 is pyramidal rather than trigonal planar.", expected: true, admit: true },
];
const PROPERTY: Row[] = [
  { id: "property/unlike-electron-geometry", question: WATER, claim: "Unlike the tetrahedral electron geometry, the molecular shape of H2O is bent.", expected: true, admit: true },
  { id: "property/rather-than-electron-geometry", question: "Explain the shape of H2O", claim: "The molecular shape of H2O is bent rather than the tetrahedral electron geometry.", expected: true, admit: true },
  // One shape word: the contrast names a different property, so the electron geometry stays asserted.
  { id: "property/unlike-electron-geometry-alone", question: WATER, claim: "Unlike its tetrahedral electron geometry, H2O's shape is based only on atom positions.", expected: true, admit: true },
  { id: "property/false-electron-geometry-alone", question: WATER, claim: "Unlike its linear electron geometry, H2O's shape is based only on atom positions.", expected: true, admit: false },
  { id: "property/false-electron-geometry", question: WATER, claim: "Unlike the bent electron geometry, the molecular shape of H2O is bent.", expected: true, admit: false },
];
const CONTROLS: Row[] = [
  { id: "control/h2o-tetrahedral", question: WATER, claim: "H2O is tetrahedral.", expected: true, admit: false },
  { id: "control/linear-rather-than-bent", question: WATER, claim: "The molecular shape of H2O is linear rather than bent.", expected: true, admit: false },
  { id: "control/tetrahedral-rather-than-bent", question: WATER, claim: "The shape is tetrahedral rather than bent.", expected: true, admit: false },
  { id: "control/tetrahedral-instead-of-bent", question: WATER, claim: "H2O is tetrahedral instead of bent.", expected: true, admit: false },
  { id: "control/nh3-planar-not-pyramidal", question: NH3, claim: "NH3 is trigonal planar, not pyramidal.", expected: true, admit: false },
  { id: "control/nh3-planar-rather-than-pyramidal", question: NH3, claim: "NH3 is trigonal planar rather than pyramidal.", expected: true, admit: false },
  { id: "control/hybridisation", question: NH3, claim: "The nitrogen in NH3 is sp2 hybridised rather than sp3.", expected: true, admit: false },
  { id: "control/lone-pairs", question: NH3, claim: "NH3 has two lone pairs rather than one.", expected: true, admit: false },
  { id: "control/tetrahedral-rather-than-list", question: WATER, claim: "H2O is tetrahedral rather than bent or linear.", expected: true, admit: false },
  { id: "control/false-claim-expected-false", question: WATER, claim: "H2O is bent rather than tetrahedral.", expected: false, admit: false },
];
const CO2 = "What is the shape of CO2";
const CH4 = "What is the shape of CH4";
/** A contrast between two molecules keeps each shape positive for its own owner, both ways round. */
const OWNERS: Row[] = [
  { id: "owners/unlike-co2-formula", question: CO2, claim: "Unlike the linear shape of CO2, H2O is bent.", expected: true, admit: true },
  { id: "owners/unlike-co2-asked-h2o", question: WATER, claim: "Unlike the linear shape of CO2, H2O is bent.", expected: true, admit: true },
  { id: "owners/rather-than-h2o", question: CO2, claim: "Rather than the bent shape of H2O, CO2 is linear.", expected: true, admit: true },
  { id: "owners/false-co2-bent", question: CO2, claim: "Unlike the bent shape of CO2, H2O is linear.", expected: true, admit: false },
  { id: "owners/false-h2o-linear", question: WATER, claim: "Unlike the linear shape of H2O, CO2 is bent.", expected: true, admit: false },
  { id: "owners/same-owner-still-denied", question: CO2, claim: "Unlike a bent shape, CO2 is linear.", expected: true, admit: true },
  { id: "owners/unlike-intro-subject", question: CO2, claim: "Unlike H2O, CO2 is linear.", expected: true, admit: true },
  { id: "owners/discourse-then-unlike", question: CO2, claim: "For example, unlike H2O, CO2 is linear.", expected: true, admit: true },
  { id: "owners/discourse-then-unlike-other", question: CO2, claim: "For example, unlike CO2, H2O is bent.", expected: true, admit: true },
  { id: "owners/false-discourse-then-like", question: "What is the shape of H2O", claim: "However, like CO2, H2O is linear.", expected: true, admit: false },
  // "like" and "as with" share the property: the compared molecule is held to it too.
  { id: "owners/false-like-shares", question: "What is the shape of H2O", claim: "Like H2O, CO2 is linear.", expected: true, admit: false },
  { id: "owners/false-discourse-like-shares", question: "What is the shape of H2O", claim: "For example, like H2O, CO2 is linear.", expected: true, admit: false },
  { id: "owners/false-similar-to-shares", question: "What is the shape of H2O", claim: "Similar to H2O, CO2 is linear.", expected: true, admit: false },
  { id: "owners/false-as-with-shares", question: "What is the shape of H2O", claim: "As with H2O, CO2 is linear.", expected: true, admit: false },
  { id: "owners/false-like-intro", question: "What is the shape of H2O", claim: "Like CO2, H2O is linear.", expected: true, admit: false },
  // A comma list with no introductory comparison is a shared subject.
  { id: "owners/false-comma-list", question: "What is the shape of H2O", claim: "H2O, NH3, CO2 are linear.", expected: true, admit: false },
  { id: "owners/false-comma-and-list", question: "What is the shape of H2O", claim: "NH3, H2O and CO2 are linear.", expected: true, admit: false },
  { id: "owners/false-postposed-comma-list", question: "What is the shape of H2O", claim: "The shapes of CO2, H2O are linear.", expected: true, admit: false },
];
/** "<shape> is not ..." denies the shape only when the words after "not" name the shape property. */
const DENIED: Row[] = [
  { id: "denied/tetrahedral-not-flat", question: CH4, claim: "The tetrahedral shape is not flat.", expected: true, admit: true },
  { id: "denied/tetrahedral-isnt-planar", question: CH4, claim: "The tetrahedral geometry isn't planar.", expected: true, admit: true },
  { id: "denied/linear-not-correct-shape", question: WATER, claim: "Linear is not the correct shape for H2O; H2O is bent.", expected: true, admit: true },
  { id: "denied/false-square-planar-not-distorted", question: CH4, claim: "The square planar shape is not distorted.", expected: true, admit: false },
  { id: "denied/false-linear-isnt-surprising", question: WATER, claim: "The linear shape of H2O isn't surprising.", expected: true, admit: false },
  { id: "denied/false-bent-not-the-shape", question: WATER, claim: "Bent is not the shape of H2O.", expected: true, admit: false },
  // The owner named after the shape noun owns the denial, not the asked molecule.
  { id: "denied/bent-not-molecular-shape-of-co2", question: WATER, claim: "Bent is not the molecular shape of CO2.", expected: true, admit: true },
  { id: "denied/bent-not-shape-of-co2", question: WATER, claim: "Bent is not the shape of CO2.", expected: true, admit: true },
  { id: "denied/false-bent-not-molecular-shape-of-h2o", question: WATER, claim: "Bent is not the molecular shape of H2O.", expected: true, admit: false },
  { id: "denied/false-bent-not-shape-of-co2-or-h2o", question: WATER, claim: "Bent is not the molecular shape of CO2 or H2O.", expected: true, admit: false },
  // A bare comma before a molecule with its own predicate ends the denied list.
  { id: "denied/bent-not-shape-of-co2-comma-h2o-is-bent", question: WATER, claim: "Bent is not the shape of CO2, H2O is bent.", expected: true, admit: true },
  { id: "denied/false-bent-not-shape-of-co2-comma-h2o", question: WATER, claim: "Bent is not the molecular shape of CO2, H2O.", expected: true, admit: false },
];
/**
 * A bare comma joins a contrasted list only when the list ends in an or/nor
 * member and no member takes a predicate; the shape that starts the main
 * clause keeps its positive reading and is checked.
 */
const COMMA: Row[] = [
  { id: "comma/false-rather-than-linear-is-shape", question: "why is H2O bent", claim: "Rather than tetrahedral, linear is the molecular shape of H2O.", expected: true, admit: false },
  { id: "comma/false-rather-than-linear-is-the-shape", question: "why is H2O bent", claim: "Rather than tetrahedral, linear is the shape of H2O.", expected: true, admit: false },
  { id: "comma/false-instead-of-linear", question: "why is H2O bent", claim: "Instead of tetrahedral, linear is the molecular shape of H2O.", expected: true, admit: false },
  { id: "comma/false-unlike-linear-describes", question: "why is H2O bent", claim: "Unlike tetrahedral, linear describes H2O.", expected: true, admit: false },
  { id: "comma/false-nh3-planar", question: "why is NH3 pyramidal", claim: "Rather than tetrahedral, trigonal planar is the shape of NH3.", expected: true, admit: false },
  { id: "comma/or-ended-list", question: WATER, claim: "Rather than linear, trigonal planar or tetrahedral, the shape of H2O is bent.", expected: true, admit: true },
  { id: "comma/false-not-then-comma", question: WATER, claim: "H2O is not tetrahedral, linear is its shape.", expected: true, admit: false },
  { id: "comma/not-or-list", question: WATER, claim: "H2O is not linear, trigonal planar or tetrahedral.", expected: true, admit: true },
  { id: "comma/nor-ended-list", question: WATER, claim: "H2O is neither linear, trigonal planar nor tetrahedral, but bent.", expected: true, admit: true },
];
const ALL = [...POSITIVES, ...PROPERTY, ...CONTROLS, ...OWNERS, ...DENIED, ...COMMA];

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

// A question that resolves no species admits every claim unread, so a
// refusal row there would pass without testing anything.
await check("reach/one-species-per-question", () => {
  const unread = ALL.filter(row => vseprSpecies(row.question).length !== 1).map(row => row.question);
  assert.deepEqual([...new Set(unread)], [], "every row question must resolve exactly one species");
});

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
  const conflict = await mutant("no-contrast", " || contrastedShape(clause, roles, shapes, index, ownersOf)", "");
  const went = red(conflict, ALL);
  // Rows read through a denial of the shape itself depend on the reader too.
  const denials = new Set(["owners/same-owner-still-denied", "denied/linear-not-correct-shape", "denied/false-bent-not-the-shape", "denied/false-bent-not-molecular-shape-of-h2o", "denied/false-bent-not-shape-of-co2-or-h2o", "denied/false-bent-not-shape-of-co2-comma-h2o", "comma/or-ended-list"]);
  assert.ok(went.every(id => id.startsWith("positive/") || denials.has(id)), `only positives and denials go red: ${went.join(", ")}`);
  for (const id of denials) assert.ok(went.includes(id), `${id} must depend on the contrast reader`);
  // Forms no other reader covers (a "than" reference skip cannot reach them).
  for (const id of ["positive/instead-of", "positive/rather-than-list", "positive/unlike", "positive/denied-subject"]) {
    assert.ok(went.includes(id), `${id} must depend on the contrast reader`);
  }
});
await check("mutation/no-denied-shape-owner", async () => {
  const conflict = await mutant("no-denied-owner", "const deniedOf = DENIED_SHAPE_OF.exec(tail);", "const deniedOf = null as RegExpExecArray | null;");
  const went = red(conflict, ALL);
  // Without the owner after "is not the shape of", the CO2 denial falls to H2O and refuses.
  const owned = ["denied/bent-not-molecular-shape-of-co2", "denied/bent-not-shape-of-co2", "denied/bent-not-shape-of-co2-comma-h2o-is-bent"];
  for (const id of owned) assert.ok(went.includes(id), `${id} must depend on the denied shape owner`);
  assert.ok(went.every(id => owned.includes(id)), `only the denied owner rows go red: ${went.join(", ")}`);
});
await check("mutation/no-denied-list-predicate-stop", async () => {
  const conflict = await mutant("no-denied-stop", "if (BARE_COMMA.test(clause.slice(mentions[at]!.end, next.start)) && PREDICATE_START.test(clause.slice(next.end))) break;", "");
  const went = red(conflict, ALL);
  // Without the stop, "CO2, H2O is bent" carries the CO2 denial onto H2O.
  assert.deepEqual(went, ["denied/bent-not-shape-of-co2-comma-h2o-is-bent"], `only the predicate-stop row goes red: ${went.join(", ")}`);
});
await check("mutation/no-shape-claims", async () => {
  const conflict = await mutant("no-shape-claims", "for (const described of shapeClaims(rawText, result)) {", "for (const described of [] as ShapeClaim[]) {");
  const went = red(conflict, ALL);
  // Hybridisation and lone pair counts have their own readers, so only those
  // two controls stay refused; every other refusal row is refused by a shape.
  const countControls = new Set(["control/hybridisation", "control/lone-pairs"]);
  const shapeRefusals = ALL.filter(row => !row.admit && !countControls.has(row.id)).map(row => row.id);
  for (const id of shapeRefusals) assert.ok(went.includes(id), `${id} must be refused by the shape reader`);
  assert.ok(went.every(id => shapeRefusals.includes(id)), `only shape refusal rows go red: ${went.join(", ")}`);
});
await check("mutation/role-blind-contrast", async () => {
  const conflict = await mutant("role-blind", "return own === null || other === null || own === other;", "return true || own === other;");
  const went = red(conflict, ALL);
  // Role-blind negation also admits a false electron geometry: the property check is live both ways.
  assert.ok(went.every(id => id.startsWith("property/")), `only property rows go red: ${went.join(", ")}`);
  assert.ok(went.includes("property/unlike-electron-geometry") && went.includes("property/false-electron-geometry"), went.join(", "));
});

await check("mutation/bare-comma-always-joins", async () => {
  const conflict = await mutant("bare-comma", "function bareCommaJoinsList(clause: string, shapes: readonly Span[], at: number): boolean {\n", "function bareCommaJoinsList(clause: string, shapes: readonly Span[], at: number): boolean {\n  if (at >= 0) return true;\n");
  const went = red(conflict, ALL);
  // Every false fronted contrast row goes red (admitted) when a bare comma always joins.
  const falseRows = COMMA.filter(row => !row.admit).map(row => row.id);
  for (const id of falseRows) assert.ok(went.includes(id), `${id} must depend on the bare comma rule`);
  assert.ok(went.every(id => falseRows.includes(id)), `only the false comma rows go red: ${went.join(", ")}`);
});

console.log(`verify-vsepr-contrast-claims: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
