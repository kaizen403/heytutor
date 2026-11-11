/**
 * "Edge length" is shared by solid geometry, physics and the unit cell. The
 * router counts a family cue as subject evidence, so when the bare phrase was
 * a unit cell cue a maths pyramid or a physics square loop entered the
 * chemistry lane, skipped the exact planner and taught with no figure.
 *
 *   tsx scripts/chemistry-lab/shared-solid-cue.ts [questions.all.jsonl]
 *
 *   kept out  maths and physics stems whose only solid word is "edge length"
 *             are not chemistry and no chemistry family claims them.
 *   kept in   a chemistry stem whose only solid word is "edge length" still
 *             claims chem_unit_cell, and the lattice probes still draw.
 *   mutation  each kept-out stem carries the phrase, so the old unconditional
 *             cue would have claimed it.
 *   bank      with a bank file, no row outside the Chemistry section is
 *             claimed by chem_unit_cell through the phrase alone.
 */
import { readFileSync } from "node:fs";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry";
import { isChemistryStem } from "../../src/chemistry/classify";
import { chemStem } from "../../src/chemistry/sceneKit";
import { SOLID_PROBES, isUnitCellStem } from "../../src/chemistry/unitCell";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const KEPT_OUT = [
  "A regular square pyramid has base edge 8 cm and lateral edge length 9 cm. Find its height and volume.",
  "A regular tetrahedron has edge length 6. Find the radius of the sphere that passes through its four vertices.",
  "A square loop of edge length 10 cm carries a current of 3 A in a uniform magnetic field of 0.2 T. Find the maximum torque on the loop.",
];
const KEPT_IN = [
  "The edge length of a sodium chloride crystal is 564 pm. Find the distance between the nearest chloride ions.",
];

const failures: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); };

for (const question of KEPT_OUT) {
  check(/edge length/.test(chemStem(question)), `mutation: the stem must carry the shared phrase: ${question}`);
  check(!isChemistryStem(question), `kept out: the subject test reads chemistry: ${question}`);
  check(!isUnitCellStem(question), `kept out: chem_unit_cell claims a non-chemistry stem: ${question}`);
  check(!isChemistryQuestion(question), `kept out: the router reads chemistry: ${question}`);
  const claimed = inferChemistryFamilies(question);
  check(claimed.length === 0, `kept out: chemistry families ${claimed.join(", ")} claim: ${question}`);
}
for (const question of KEPT_IN) {
  check(isChemistryStem(question), `kept in: the subject test must read chemistry: ${question}`);
  check(inferChemistryFamilies(question).includes("chem_unit_cell"), `kept in: chem_unit_cell must claim: ${question}`);
}
let draws = 0;
for (const probe of SOLID_PROBES) {
  if (probe.expect !== "draw") continue;
  check(isUnitCellStem(probe.question), `probe: chem_unit_cell must claim: ${probe.question.slice(0, 80)}`);
  const scene = synthesizeFamilyScene({ question: probe.question });
  check(scene?.family === "chem_unit_cell", `probe: expected a chem_unit_cell figure, got ${scene?.family ?? "nothing"}: ${probe.question.slice(0, 80)}`);
  if (scene?.family === "chem_unit_cell") draws += 1;
}

const bankPath = process.argv[2];
let bankSummary = "";
if (bankPath) {
  const tally = new Map<string, number>();
  for (const line of readFileSync(bankPath, "utf8").split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line) as { question_id?: string; text?: string; source_refs?: { subject_context?: string | null }[] };
    const text = row.text ?? "";
    if (!/edge length/.test(chemStem(text)) || !isUnitCellStem(text)) continue;
    const section = row.source_refs?.map((ref) => ref.subject_context).find(Boolean) ?? "unfiled";
    tally.set(section, (tally.get(section) ?? 0) + 1);
    const otherCue = isUnitCellStem(text.replace(/edge length/gi, "side"));
    check(section === "Chemistry" || otherCue, `bank: a ${section} row is claimed through "edge length" alone: ${row.question_id ?? "?"}`);
  }
  bankSummary = `, bank claims with the phrase ${JSON.stringify(Object.fromEntries(tally))}`;
}

if (failures.length) {
  for (const failure of failures) console.log(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`shared-solid-cue: ok (kept out=${KEPT_OUT.length}, kept in=${KEPT_IN.length}, lattice probes drawn=${draws}${bankSummary})`);
