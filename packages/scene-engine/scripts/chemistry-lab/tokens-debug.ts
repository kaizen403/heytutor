/** Formula tokens with their surroundings, and the electrochemistry cue parts, for bank question id prefixes. */
import { readFileSync } from "node:fs";
import { formulaTokens, normalizeChemistryText } from "../../src/chemistry/formula";
import { isElectrochemStem, parseCellNotation, electrolysisProducts } from "../../src/chemistry/electrochemistry";
const root = new URL("../../../../", import.meta.url).pathname;
const bank = readFileSync(`${root}data/question-bank/build/questions.all.jsonl`, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { question_id: string; text: string });
for (const prefix of process.argv.slice(2)) {
  const question = bank.find((row) => row.question_id.startsWith(`q_${prefix}`))?.text ?? "";
  const text = normalizeChemistryText(question);
  console.log(`\n== ${prefix} (${text.length} chars)`);
  console.log(`  tokens: ${JSON.stringify(formulaTokens(question))}`);
  console.log(`  electrochem cue=${isElectrochemStem(question)} cell=${JSON.stringify(parseCellNotation(question))?.slice(0, 120)} electrolysis=${JSON.stringify(electrolysisProducts(question))?.slice(0, 160)}`);
  const hits = [...text.matchAll(/(?:electrol\w*|refin\w*|copper|CuSO4|\bcell\b|electrode|anode|cathode|ozone|O3|NO\b|OC\b)/gi)].slice(0, 8).map((m) => text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40).replace(/\s+/g, " "));
  for (const hit of hits) console.log(`  ...${hit}...`);
}
