/** Chemistry bank rows the classifier does not read as chemistry, with evidence. */
import { readFileSync } from "node:fs";
import { chemistryEvidence, isChemistryStem } from "../../src/chemistry/classify";
const root = "/Users/kaizen/heytutor";
const subjectById = new Map<string, string>();
for (const line of readFileSync(`${root}/data/question-bank/build/question-syllabus.jsonl`, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as { question_id: string; subject?: string | null };
  if (row.subject) subjectById.set(row.question_id, row.subject);
}
let shown = 0; let total = 0; let missed = 0;
for (const line of readFileSync(`${root}/data/question-bank/build/questions.all.jsonl`, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as { question_id: string; text?: string };
  if (subjectById.get(row.question_id) !== "Chemistry") continue;
  const text = row.text ?? "";
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (text.length < 40 || words.length < 8 || letters / text.length < 0.45) continue;
  total += 1;
  if (isChemistryStem(text)) continue;
  missed += 1;
  if (shown < Number(process.argv[2] ?? 40)) { shown += 1; console.log(`- ${text.slice(0, 150).replace(/\s+/g, " ")} :: ${JSON.stringify(chemistryEvidence(text))}`); }
}
console.log(`missed ${missed} of ${total}`);
