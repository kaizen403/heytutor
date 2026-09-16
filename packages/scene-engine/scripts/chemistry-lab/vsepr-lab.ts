/**
 * VSEPR lane bench: solve, render and rasterize every probe, a sweep of
 * extra species, and the real bank stems tagged molecule_shape.
 *
 *   pnpm exec tsx scripts/chemistry-lab/vsepr-lab.ts <outdir> [bankJson] [--no-png]
 */
import { existsSync, readFileSync } from "node:fs";
import { buildVseprScene, isVseprStem, vseprGeometry, vseprSpecies, VSEPR_PROBES } from "../../src/chemistry/vsepr";
import { rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/vsepr";
const bankPath = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
const png = !process.argv.includes("--no-png");

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

console.log("== solver sweep ==");
const SWEEP = [
  "SF4", "XeF4", "BrF5", "PCl5", "ClF3", "XeF2", "I3-", "NH3", "H2O", "CO2", "BF3", "SO4^2-", "NO3-", "XeOF4", "IF7",
  "SO2", "NH4+", "XeF6", "[Ni(CN)4]2-", "C2H4", "H2O2", "N2O4", "SF6", "PH3", "H2S", "ClO4-", "ClO3-", "CO3^2-", "SO3",
  "XeO3", "NO2+", "NO2-", "NO2", "ICl4-", "BeCl2", "CH4", "PF5", "HCN", "N2O", "OF2", "Cl2O", "SnCl2", "SOCl2",
  "POCl3", "SO2Cl2", "XeO2F2", "XeOF2", "H2SO4", "HNO3", "HClO4", "H3PO4", "H3PO3", "NH2OH", "H3O+", "ClO2", "XeF5-",
  "SiF6^2-", "PCl6-", "TeF5-", "XeF5+", "XeO4", "IF5", "BrF3", "SCl2", "NCl3", "HOCl", "ICl", "CIF3", "AlCl3", "CS2", "O3",
];
for (const formula of SWEEP) {
  const result = vseprGeometry(formula);
  if (!result) {
    console.log(`  ${formula.padEnd(12)} -> null`);
    continue;
  }
  console.log(`  ${formula.padEnd(12)} -> ${result.axe.padEnd(6)} ${result.hybridisation.padEnd(6)} ${result.shape.padEnd(22)} lp=${result.lonePairs}${result.unpairedElectron ? " (odd e)" : ""} angle=${result.bondAngle ?? "none"} ligands=${result.ligands.map((ligand) => `${ligand.label}x${ligand.count}`).join(",")}`);
}

console.log("\n== probes ==");
let probePass = 0;
for (const [index, probe] of VSEPR_PROBES.entries()) {
  const cue = isVseprStem(probe.question);
  const document = cue ? buildVseprScene(probe.question, [], false) : null;
  const name = `probe-${String(index + 1).padStart(2, "0")}-${slug(probe.question)}`;
  const result = renderDocument(document, `${outDir}/${name}.svg`, probe.question);
  const drew = result.ok;
  const missing = (probe.labels ?? []).filter((label) => !result.labels.includes(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => result.labels.includes(label));
  const pass = probe.expect === "draw" ? drew && missing.length === 0 && forbidden.length === 0 : !drew && document === null;
  if (pass) probePass += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"} expect=${probe.expect} cue=${cue} drew=${drew}${missing.length ? ` missing=[${missing.join(", ")}]` : ""}${forbidden.length ? ` forbidden=[${forbidden.join(", ")}]` : ""}${!drew && document ? ` REFUSED ${JSON.stringify(result.issues.map((issue) => issue.message))}` : ""}`);
}
console.log(`probes: ${probePass}/${VSEPR_PROBES.length} pass`);

console.log("\n== extra renders ==");
const EXTRA = [
  "The shape of SF6 molecule is:",
  "The bond angle in PH3 is:",
  "The shape of H2S and its bond angle are:",
  "The shape of ClO4- ion is:",
  "The shape of NO2 molecule is:",
  "The shape of ICl4- ion is:",
  "The shape of POCl3 is:",
  "The geometry of XeO2F2 is:",
  "The hybridisation of the central atom in HClO4 is:",
  "The shape of HCN is:",
  "The shape of SnCl2 in the gas phase is:",
  "Statement I: PF5 and BrF5 both exhibit sp3d hybridisation. Statement II: Both SF4 and [Co(NH3)6]3+ exhibit sp3d2 hybridisation.",
  "Consider the following species: BrF5, XeF3+, BF3, ICl4-, XeF4, SF4, NH4+, ClF3, XeF2, ICl. Number of species having sp3d hybridized central atom is",
  "Consider the following statements: (A) NF3 molecule has a trigonal planar structure. (B) Bond length of N2 is shorter than O2. (D) Dipole moment of H2S is higher than that of water molecule.",
];
for (const [index, question] of EXTRA.entries()) {
  const cue = isVseprStem(question);
  const document = cue ? buildVseprScene(question, [], false) : null;
  renderDocument(document, `${outDir}/extra-${String(index + 1).padStart(2, "0")}-${slug(question)}.svg`, question);
}

if (bankPath && existsSync(bankPath)) {
  console.log("\n== bank stems (molecule_shape) ==");
  const rows = JSON.parse(readFileSync(bankPath, "utf8")) as Array<{ id: string; unit: string; figs: string[]; figure_absent?: boolean; text: string }>;
  const stems = rows.filter((row) => row.figs.includes("molecule_shape"));
  let drew = 0;
  let declined = 0;
  let refused = 0;
  const limit = Number(process.env.BANK_LIMIT ?? "20");
  for (const [index, row] of stems.slice(0, limit).entries()) {
    const cue = isVseprStem(row.text);
    const species = vseprSpecies(row.text);
    const document = cue ? buildVseprScene(row.text, [], false) : null;
    const result = renderDocument(document, `${outDir}/bank-${String(index + 1).padStart(2, "0")}-${row.id.slice(2, 10)}.svg`, row.text.replace(/\s+/g, " ").slice(0, 90));
    if (result.ok) drew += 1;
    else if (document) refused += 1;
    else declined += 1;
    console.log(`     cue=${cue} species=[${species.map((item) => item.formula).join(", ")}] figure_absent=${row.figure_absent ?? false}`);
  }
  console.log(`bank: tried=${Math.min(limit, stems.length)} drew=${drew} declined=${declined} refused=${refused}`);
}

if (png) rasterize(outDir);
