/**
 * A clinical note names drugs and salts as treatments ("nitrates", "urea and
 * electrolytes", aspirin). Those words used to make the note a chemistry
 * stem, the chemistry lane forced a required figure that no family could
 * honestly draw, and the turn ended required_visual_unavailable. The bare
 * connective "combination" ("combination therapy") also met the capacitor
 * network's default score and drew a capacitor circuit for the same note.
 *
 *   tsx scripts/chemistry-lab/clinical-context.ts [questions.all.jsonl]
 *
 *   kept out  clinical notes that name a drug or an electrolyte are not
 *             chemistry, no chemistry family claims them, and the family
 *             path draws nothing for them.
 *   kept in   a chemistry stem with one clinical word, and a clinical stem
 *             that asks for a structure, keep their chemistry figure.
 *   mutation  each kept-out note carries a chemistry word, so the subject
 *             test without the clinical evidence would have claimed it.
 *   circuit   a capacitor stem written with the singular noun still claims
 *             capacitor_network; "combination" or "in series" alone does not.
 *   bank      with a bank file, no Chemistry row with clinical vocabulary
 *             leaves the chemistry lane.
 */
import { readFileSync } from "node:fs";
import { detectArchetype } from "../../src/archetypes/detect";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry";
import { chemistryEvidence, isChemistryStem } from "../../src/chemistry/classify";
import { isOrganicStem } from "../../src/chemistry/organic";
import { chemStem } from "../../src/chemistry/sceneKit";
import { clinicalPracticeContext } from "../../src/chemistry/semanticCues";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const KEPT_OUT = [
  "Loop diuretics: adverse effects include hypokalaemia and dehydration, so patients need their urea and electrolytes checked. They are contraindicated in anuria.",
  "Heart failure management: first-line therapy is an ACE inhibitor with a beta blocker. Monitor electrolytes and renal function after each dose change.",
  "Chronic stable angina: give aspirin and a statin to improve prognosis; long-acting nitrates or a calcium channel blocker relieve symptoms. Combination therapy is used when one agent fails.",
];
const KEPT_IN: Array<{ question: string; family: string }> = [
  { question: "Draw the structure of aspirin and name its functional groups. It is given to patients as an analgesic.", family: "chem_organic" },
  { question: "Antacids such as magnesium hydroxide neutralise excess stomach acid in patients. Write the balanced equation for the neutralisation.", family: "" },
];
const CAPACITOR_IN = [
  "A 2 μF capacitor and a 4 μF capacitor are connected in series across a 12 V battery. Find the charge on each.",
  "Three capacitors of 3 μF each are connected in parallel. Find the equivalent capacitance.",
];
const CAPACITOR_OUT = [
  "A combination of two lenses in contact has focal lengths 20 cm and 30 cm. Find the power of the combination.",
  "Combination therapy is used when a single drug fails to control the blood pressure.",
];

const failures: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); };

for (const question of KEPT_OUT) {
  check(clinicalPracticeContext(chemStem(question)), `mutation: the note must read as clinical practice: ${question}`);
  check(chemistryEvidence(question).chemistry.length > 0, `mutation: the note must carry a chemistry word: ${question}`);
  check(!isChemistryStem(question), `kept out: the subject test reads chemistry: ${question}`);
  check(!isOrganicStem(question), `kept out: chem_organic claims a drug named as a treatment: ${question}`);
  check(!isChemistryQuestion(question), `kept out: the router reads chemistry: ${question}`);
  const claimed = inferChemistryFamilies(question);
  check(claimed.length === 0, `kept out: chemistry families ${claimed.join(", ")} claim: ${question}`);
  const scene = synthesizeFamilyScene({ question });
  check(!scene, `kept out: the family path drew ${scene?.family}: ${question}`);
}
for (const { question, family } of KEPT_IN) {
  check(isChemistryQuestion(question), `kept in: the router must read chemistry: ${question}`);
  if (family) {
    check(inferChemistryFamilies(question).includes(family as never), `kept in: ${family} must claim: ${question}`);
    const scene = synthesizeFamilyScene({ question });
    check(scene?.family === family, `kept in: expected a ${family} figure, got ${scene?.family ?? "nothing"}: ${question}`);
  }
}
for (const question of CAPACITOR_IN)
  check(detectArchetype(question)?.id === "capacitor_network", `circuit: capacitor_network must claim: ${question}`);
for (const question of CAPACITOR_OUT)
  check(detectArchetype(question)?.id !== "capacitor_network", `circuit: capacitor_network claims a stem with no capacitor: ${question}`);

const bankPath = process.argv[2];
let bankSummary = "";
if (bankPath) {
  let clinical = 0;
  for (const line of readFileSync(bankPath, "utf8").split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line) as { question_id?: string; text?: string; source_refs?: { subject_context?: string | null }[] };
    const text = row.text ?? "";
    const section = row.source_refs?.map((ref) => ref.subject_context).find(Boolean);
    if (section !== "Chemistry" || !clinicalPracticeContext(chemStem(text))) continue;
    clinical += 1;
    check(isChemistryQuestion(text), `bank: a Chemistry row with clinical words left the chemistry lane: ${row.question_id ?? "?"}`);
  }
  bankSummary = `, bank Chemistry rows with clinical words=${clinical}`;
}

if (failures.length) {
  for (const failure of failures) console.log(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`clinical-context: ok (kept out=${KEPT_OUT.length}, kept in=${KEPT_IN.length}, capacitor in=${CAPACITOR_IN.length}, out=${CAPACITOR_OUT.length}${bankSummary})`);
