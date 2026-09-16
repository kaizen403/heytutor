/**
 * Every chemistry row in the question bank through the live family path.
 *
 *   tsx scripts/chemistry-lab/bank-sweep.ts <outdir> [samplesPerFamily]
 *
 * Reads data/question-bank/build/questions.all.jsonl, keeps rows whose paper
 * section is Chemistry, and for each readable stem records: is it read as
 * chemistry, which chemistry families claim it, what the family path drew
 * (family, tier, labels), and any builder exception. Writes rows.jsonl and
 * summary.json to <outdir>, and SVGs for a sample of draws per family.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inferChemistryFamilies, isChemistryQuestion, isChemistrySceneFamily } from "../../src/chemistry";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { renderSceneSvg } from "../lib/renderSceneSvg";

const outDir = process.argv[2] ?? ".chemistry-lab/bank-sweep";
const samplesPerFamily = Number(process.argv[3] ?? 6);
const root = new URL("../../../../", import.meta.url).pathname;
mkdirSync(`${outDir}/samples`, { recursive: true });

interface Row { question_id: string; text?: string; source_refs?: Array<{ subject_context?: string | null; document_id?: string }> }

function readable(text: string): boolean {
  if (text.length < 40) return false;
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return words.length >= 8 && letters / text.length >= 0.45;
}

const rows: Row[] = readFileSync(`${root}data/question-bank/build/questions.all.jsonl`, "utf8")
  .split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row)
  .filter((row) => (row.source_refs ?? []).some((ref) => ref.subject_context === "Chemistry"));

const out: string[] = [];
const byFamily = new Map<string, number>();
const byTier = new Map<string, number>();
const samples = new Map<string, number>();
let readableCount = 0; let chemistry = 0; let claimed = 0; let drew = 0; let physicsFigure = 0; let errors = 0;
const physicsExamples: string[] = [];
const errorExamples: string[] = [];

for (const row of rows) {
  const text = row.text ?? "";
  if (!readable(text)) continue;
  readableCount += 1;
  const isChem = isChemistryQuestion(text);
  if (isChem) chemistry += 1;
  const families = inferChemistryFamilies(text);
  if (families.length > 0) claimed += 1;
  let family: string | null = null; let tier: string | null = null; let labels: string[] = []; let error: string | null = null;
  try {
    const scene = synthesizeFamilyScene({ question: text }) ?? synthesizeLastResortScene({ question: text });
    if (scene) {
      family = scene.family; tier = scene.tier;
      labels = scene.renderScene.primitives.filter((p) => (p.kind === "label" || p.kind === "dimension") && p.text).map((p) => p.text!);
      if (labels.length > 0) {
        drew += 1;
        byFamily.set(family, (byFamily.get(family) ?? 0) + 1);
        byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
        if (!isChemistrySceneFamily(family)) {
          physicsFigure += 1;
          if (physicsExamples.length < 25) physicsExamples.push(`${family}: ${text.slice(0, 110).replace(/\s+/g, " ")}`);
        }
        const taken = samples.get(family) ?? 0;
        if (taken < samplesPerFamily) {
          samples.set(family, taken + 1);
          writeFileSync(`${outDir}/samples/${family}-${taken + 1}-${row.question_id.slice(2, 10)}.svg`, renderSceneSvg(scene.renderScene, { title: text.slice(0, 110).replace(/\s+/g, " "), subtitle: `family=${family} tier=${tier} labels=${labels.join(" | ").slice(0, 150)}` }));
        }
      }
    }
  } catch (caught) {
    errors += 1;
    error = (caught as Error).message;
    if (errorExamples.length < 25) errorExamples.push(`${error.slice(0, 80)} :: ${text.slice(0, 90).replace(/\s+/g, " ")}`);
  }
  out.push(JSON.stringify({ id: row.question_id, chemistry: isChem, families, family, tier, labels, error, text: text.slice(0, 400) }));
}

writeFileSync(`${outDir}/rows.jsonl`, `${out.join("\n")}\n`);
const summary = {
  generated: new Date().toISOString(),
  chemistryRows: rows.length,
  readable: readableCount,
  readAsChemistry: chemistry,
  claimedByAChemistryFamily: claimed,
  drewAFigure: drew,
  physicsFigureOnChemistryRow: physicsFigure,
  builderExceptions: errors,
  byFamily: Object.fromEntries([...byFamily.entries()].sort((a, b) => b[1] - a[1])),
  byTier: Object.fromEntries(byTier),
  physicsExamples,
  errorExamples,
};
writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify({ ...summary, physicsExamples: physicsExamples.slice(0, 12), errorExamples: errorExamples.slice(0, 12) }, null, 1));
