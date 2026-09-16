/**
 * Electrochemistry bench: replay the probes, render every figure to SVG and
 * PNG, then try the real bank stems tagged galvanic_cell or electrolysis.
 *
 *   pnpm exec tsx scripts/chemistry-lab/electrochem-lab.ts <outdir> [chem_profile.json]
 */
import { readFileSync } from "node:fs";
import {
  ELECTROCHEM_PROBES,
  buildElectrochemScene,
  cellEmf,
  electrolysisProducts,
  isElectrochemStem,
  parseCellNotation,
  standardPotential,
} from "../../src/chemistry/electrochemistry";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/electrochem";
const profilePath = process.argv[3];

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

console.log("== solver checks ==");
const checks: Array<[string, unknown]> = [
  ["E°(Zn2+/Zn)", standardPotential("Zn2+/Zn")],
  ["E°(Zn/Zn2+)", standardPotential("Zn/Zn2+")],
  ["E°(Fe3+/Fe2+)", standardPotential("Fe^(3+)/Fe^(2+)")],
  ["E°(SHE)", standardPotential("SHE")],
  ["E°(Cr2O7^2-/Cr3+)", standardPotential("Cr2O7^(2-)/Cr3+")],
];
for (const [name, value] of checks) console.log(`  ${name} = ${String(value)}`);
const daniell = parseCellNotation("Zn(s) | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu(s)");
console.log("  daniell 0.1/0.01 ->", JSON.stringify(daniell && cellEmf(daniell), (key, value) => (key === "record" ? undefined : value)));
const she = parseCellNotation("Pt(s) | H2(g, 1 bar) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag(s)");
console.log("  she/ag ->", JSON.stringify(she && cellEmf(she), (key, value) => (key === "record" ? undefined : value)));
const salts = parseCellNotation("Zn|ZnSO4||CuSO4|Cu");
console.log("  Zn|ZnSO4||CuSO4|Cu ->", salts?.notation, salts && cellEmf(salts)?.e0);
const ferric = parseCellNotation("Pt | Fe2+, Fe3+ || Ag+ | Ag");
console.log("  Pt|Fe2+,Fe3+||Ag+|Ag ->", ferric?.notation, ferric && cellEmf(ferric)?.e0, ferric && cellEmf(ferric)?.n);
const ni = parseCellNotation("Ni(s) | Ni2+(aq) || Ag+(aq) | Ag(s)");
console.log("  Ni|Ni2+||Ag+|Ag ->", ni && cellEmf(ni)?.e0, ni && cellEmf(ni)?.n);
for (const text of ["electrolysis of brine", "molten NaCl", "aqueous CuSO4 with Pt electrodes", "CuSO4 solution using copper electrodes", "electrolysis of water", "dilute NaCl solution", "aqueous KI", "electrolysis of NaCl"]) {
  const products = electrolysisProducts(text);
  console.log(`  ${text} -> ${products ? `${products.cathode} | ${products.anode}${products.solution ? ` | ${products.solution}` : ""}` : "null"}`);
}

console.log("\n== probes ==");
let probeFailures = 0;
ELECTROCHEM_PROBES.forEach((probe, index) => {
  const cue = isElectrochemStem(probe.question);
  const document = cue ? buildElectrochemScene(probe.question, [], false) : null;
  const title = `${String(index + 1).padStart(2, "0")}-${slug(probe.question)}`;
  const result = renderDocument(document, `${outDir}/probe-${title}.svg`, probe.question.slice(0, 90));
  const drew = result.ok;
  const outcome = drew ? "draw" : "decline";
  const missing = (probe.labels ?? []).filter((label) => !result.labels.includes(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => result.labels.includes(label));
  const pass = outcome === probe.expect && missing.length === 0 && forbidden.length === 0;
  if (!pass) probeFailures += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"} #${index + 1} expect=${probe.expect} got=${outcome} cue=${cue}${missing.length ? ` missing=[${missing.join(", ")}]` : ""}${forbidden.length ? ` forbidden=[${forbidden.join(", ")}]` : ""}`);
  if (document) {
    const caption = document.annotations.find((annotation) => annotation.id === "figure_caption");
    console.log(`       caption: ${caption && "text" in caption ? String(caption.text) : ""}`);
  }
});
console.log(`probe failures: ${probeFailures}`);

if (profilePath) {
  console.log("\n== bank stems ==");
  const rows = JSON.parse(readFileSync(profilePath, "utf8")) as Array<{ id: string; figs: string[]; text: string; figure_absent: boolean }>;
  const stems = rows.filter((row) => row.figs.some((fig) => fig === "galvanic_cell" || fig === "electrolysis"));
  let drew = 0;
  let declined = 0;
  let refused = 0;
  let nocue = 0;
  stems.forEach((row, index) => {
    const cue = isElectrochemStem(row.text);
    if (!cue) {
      nocue += 1;
      console.log(`  ${index + 1}. ${row.id.slice(0, 14)} no cue`);
      return;
    }
    const document = buildElectrochemScene(row.text, [], false);
    if (!document) {
      declined += 1;
      console.log(`  ${index + 1}. ${row.id.slice(0, 14)} declined`);
      return;
    }
    const result = compileForLab(document);
    if (result.ok) {
      drew += 1;
      renderDocument(document, `${outDir}/bank-${String(index + 1).padStart(2, "0")}-${row.id.slice(2, 12)}.svg`, row.text.slice(0, 90));
      console.log(`  ${index + 1}. ${row.id.slice(0, 14)} DREW labels=[${result.labels.join(", ")}]`);
    } else {
      refused += 1;
      console.log(`  ${index + 1}. ${row.id.slice(0, 14)} REFUSED ${JSON.stringify(result.issues.map((issue) => `${issue.code}: ${issue.message}`))}`);
    }
  });
  console.log(`bank: ${stems.length} stems, drew ${drew}, declined ${declined}, refused ${refused}, no cue ${nocue}`);
}

rasterize(outDir);
