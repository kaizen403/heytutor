/** Organic mentions, roles, cue and result for bank question ids (prefixes) or a JSON array of stems. */
import { readFileSync } from "node:fs";
import { buildOrganicScene, findMentions, isOrganicStem, mentionRole } from "../../src/chemistry/organic";
import { normalizeChemistryText } from "../../src/chemistry/formula";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { inferChemistryFamilies, isChemistryQuestion } from "../../src/chemistry";

const args = process.argv.slice(2);
const root = new URL("../../../../", import.meta.url).pathname;
let stems: string[];
if (args[0]?.endsWith(".json")) stems = JSON.parse(readFileSync(args[0], "utf8")) as string[];
else {
  const bank = readFileSync(`${root}data/question-bank/build/questions.all.jsonl`, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { question_id: string; text: string });
  stems = args.map((prefix) => bank.find((row) => row.question_id.startsWith(`q_${prefix}`) || row.question_id.startsWith(prefix))?.text ?? `missing ${prefix}`);
}
for (const question of stems) {
  const text = normalizeChemistryText(question).replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
  const organic = buildOrganicScene(question, [], false);
  const labels = (doc: typeof organic) => doc ? doc.entities.filter((e) => e.label).map((e) => e.label).join(", ").slice(0, 120) : "null";
  console.log(`\n${text.slice(0, 220)}`);
  console.log(`  chemistry=${isChemistryQuestion(question)} families=${JSON.stringify(inferChemistryFamilies(question))} organicCue=${isOrganicStem(question)} organicDoc=${labels(organic)}`);
  console.log(`  family path -> ${scene ? `${scene.family}: ${scene.renderScene.primitives.filter((p) => p.kind === "label" && p.text).map((p) => p.text).join(", ").slice(0, 120)}` : "NONE"}`);
  for (const m of findMentions(text)) console.log(`    mention ${JSON.stringify(m.text)} -> ${m.molecule.name} @${m.start} weak=${m.weak} role=${mentionRole(lower, m)}`);
}
