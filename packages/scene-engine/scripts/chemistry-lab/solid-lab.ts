/**
 * Solid state lane bench: render every SOLID_PROBES entry and the real bank
 * stems tagged unit_cell, then rasterize with headless Firefox.
 *
 *   pnpm exec tsx scripts/chemistry-lab/solid-lab.ts <outdir> [chem_profile.json]
 */
import { readFileSync } from "node:fs";
import { SOLID_PROBES, buildUnitCellScene, isUnitCellStem, unitCellDensity, unitCellFacts } from "../../src/chemistry/unitCell";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/solid";
const bankPath = process.argv[3];

console.log("solver checks");
console.log("  fcc", JSON.stringify(unitCellFacts("fcc")));
console.log("  density fcc a=400pm M=60:", unitCellDensity({ z: 4, molarMass: 60, edgeLengthPm: 400 }).toFixed(3), "g/cm3 (expect 6.228)");

console.log("\nprobes");
const rows: string[] = [];
SOLID_PROBES.forEach((probe, index) => {
  const cue = isUnitCellStem(probe.question);
  const document = cue ? buildUnitCellScene(probe.question, [], false) : null;
  const slug = `probe-${String(index + 1).padStart(2, "0")}`;
  const result = renderDocument(document, `${outDir}/${slug}.svg`, `${slug} ${probe.question.slice(0, 70)}`);
  const outcome = result.ok ? "draw" : "decline";
  const missing = (probe.labels ?? []).filter((label) => !result.labels.includes(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => result.labels.includes(label));
  const verdict = outcome === probe.expect && missing.length === 0 && forbidden.length === 0 ? "PASS" : "FAIL";
  const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
  const metric = document?.assertions.filter((assertion) => assertion.expected !== undefined && typeof assertion.expected !== "boolean").map((assertion) => assertion.predicate) ?? [];
  rows.push(`${verdict} | ${slug} | expect ${probe.expect} | got ${outcome}${missing.length ? ` | missing ${missing.join(",")}` : ""}${forbidden.length ? ` | forbidden ${forbidden.join(",")}` : ""} | labels [${result.labels.join(", ")}] | metric [${metric.join(",")}]`);
  if (caption) rows.push(`      caption: ${caption}`);
});
console.log(rows.join("\n"));

if (bankPath) {
  console.log("\nreal bank stems");
  interface BankItem { id: string; unit: string | null; figs: string[]; figure_absent: boolean; text: string }
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as BankItem[];
  const tagged = bank.filter((item) => (item.figs ?? []).some((fig) => /unit_cell/.test(fig)));
  const extraIds = new Set(["q_52af9d3b171f", "q_8f20ea6c74ff", "q_499258b036a0", "q_fcaf9593a25c"]);
  const extra = bank.filter((item) => extraIds.has(item.id.slice(0, 14)));
  const stems = [...tagged, ...extra];
  let drew = 0;
  let declined = 0;
  let refused = 0;
  stems.forEach((item, index) => {
    const slug = `bank-${String(index + 1).padStart(2, "0")}-${item.id.slice(2, 10)}`;
    const cue = isUnitCellStem(item.text);
    let document = null;
    let error = "";
    try {
      document = cue ? buildUnitCellScene(item.text, [], false) : null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const result = document ? renderDocument(document, `${outDir}/${slug}.svg`, `${slug} ${item.text.replace(/\s+/g, " ").slice(0, 70)}`) : compileForLab(null);
    const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
    if (result.ok) drew += 1;
    else if (document) refused += 1;
    else declined += 1;
    const status = result.ok ? "DRAW" : document ? "REFUSED" : "DECLINE";
    console.log(`${status} ${slug} cue=${cue} absent=${item.figure_absent} :: ${item.text.replace(/\s+/g, " ").slice(0, 110)}`);
    if (caption) console.log(`      caption: ${caption}`);
    if (error) console.log(`      threw: ${error}`);
    if (document && !result.ok) console.log(`      issues: ${JSON.stringify(result.issues.map((issue) => `${issue.code}: ${issue.message}`))}`);
  });
  console.log(`\nbank summary: tried ${stems.length}, drew ${drew}, declined ${declined}, refused ${refused}`);
}

rasterize(outDir);
