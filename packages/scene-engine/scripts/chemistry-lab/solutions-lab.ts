/**
 * Solutions lane bench: replay SOLUTIONS_PROBES, a few extra pairings, and
 * the real bank stems tagged titration_ph or colligative.
 *
 *   pnpm exec tsx scripts/chemistry-lab/solutions-lab.ts <outdir> [chem_profile.json]
 */
import { readFileSync } from "node:fs";
import {
  SOLUTIONS_PROBES,
  buildSolutionsGraphScene,
  isSolutionsGraphStem,
  raoultLines,
  titrationCurve,
} from "../../src/chemistry/solutionsGraphs";
import { compileForLab, rasterize, renderDocument } from "./lab";

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const outDir = args[0] ?? ".chemistry-lab/solutions";
const profilePath = args[1];
const skipRaster = process.argv.includes("--no-raster");

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

/* Solver cross checks against the textbook values the brief lists. */
const checks: Array<[string, number, number]> = [];
{
  const hcl = titrationCurve({ analyte: { kind: "acid", strength: "strong", concentration: 0.1, volume: 25, name: "HCl" }, titrant: { kind: "base", strength: "strong", concentration: 0.1, name: "NaOH" } })!;
  checks.push(["HCl/NaOH V_eq", hcl.equivalenceVolume, 25]);
  checks.push(["HCl/NaOH pH initial", hcl.pHInitial, 1]);
  checks.push(["HCl/NaOH pH eq", hcl.pHEquivalence, 7]);
  checks.push(["HCl/NaOH pH at 50 mL", hcl.pHAt(50), 12.52]);
  const ac = titrationCurve({ analyte: { kind: "acid", strength: "weak", pK: 4.76, concentration: 0.1, volume: 25, name: "CH3COOH" }, titrant: { kind: "base", strength: "strong", concentration: 0.1, name: "NaOH" } })!;
  checks.push(["AcOH/NaOH pH initial", ac.pHInitial, 2.88]);
  checks.push(["AcOH/NaOH pH half", ac.pHHalfEquivalence, 4.76]);
  checks.push(["AcOH/NaOH pH eq", ac.pHEquivalence, 8.73]);
  checks.push(["AcOH/NaOH textbook eq", ac.textbook.pHEquivalence, 8.73]);
  const nh3 = titrationCurve({ analyte: { kind: "base", strength: "weak", pK: 4.75, concentration: 0.1, volume: 25, name: "NH3" }, titrant: { kind: "acid", strength: "strong", concentration: 0.1, name: "HCl" } })!;
  checks.push(["NH3/HCl pH eq", nh3.pHEquivalence, 5.28]);
  checks.push(["NH3/HCl pH half", nh3.pHHalfEquivalence, 9.25]);
  checks.push(["NH3/HCl pH initial", nh3.pHInitial, 11.12]);
  const h2so4 = titrationCurve({ analyte: { kind: "acid", strength: "strong", protons: 2, concentration: 0.1, volume: 25, name: "H2SO4" }, titrant: { kind: "base", strength: "strong", concentration: 0.1, name: "NaOH" } })!;
  checks.push(["H2SO4/NaOH V_eq", h2so4.equivalenceVolume, 50]);
  const r = raoultLines(200, 100);
  checks.push(["Raoult p_total(0.5)", r.pTotal(0.5), 150]);
  checks.push(["Raoult y_A(0.5)", r.yA(0.5), 0.6667]);
}
console.log("solver checks");
for (const [name, got, want] of checks) {
  const ok = Math.abs(got - want) < 0.006;
  console.log(`  ${ok ? "ok " : "BAD"} ${name}: ${got.toFixed(4)} (expect ${want})`);
}

interface Row { name: string; question: string; expect: "draw" | "decline"; result: string; labels: string[]; ok: boolean }
const rows: Row[] = [];

function runProbe(index: number, probe: (typeof SOLUTIONS_PROBES)[number], prefix: string): void {
  const cue = isSolutionsGraphStem(probe.question);
  const doc = cue ? buildSolutionsGraphScene(probe.question, [], false) : null;
  const name = `${prefix}${String(index + 1).padStart(2, "0")}-${slug(probe.question)}`;
  const result = renderDocument(doc, `${outDir}/${name}.svg`, probe.question, probe.note);
  const drew = result.ok;
  const outcome = !cue ? "decline (no cue)" : !doc ? "decline (builder null)" : drew ? "draw" : "REFUSED";
  const missing = (probe.labels ?? []).filter((label) => !result.labels.includes(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => result.labels.includes(label));
  const ok = probe.expect === "draw"
    ? drew && missing.length === 0 && forbidden.length === 0
    : !drew;
  rows.push({ name, question: probe.question, expect: probe.expect, result: outcome + (missing.length ? ` missing=[${missing.join(", ")}]` : "") + (forbidden.length ? ` forbidden=[${forbidden.join(", ")}]` : ""), labels: result.labels, ok });
}

SOLUTIONS_PROBES.forEach((probe, index) => runProbe(index, probe, "probe-"));

const extras: Array<(typeof SOLUTIONS_PROBES)[number]> = [
  { question: "25 mL of 0.1 M NaOH is titrated with 0.1 M HCl. Draw the pH curve.", expect: "draw", labels: ["eq. point", "pH = 7", "pH = 13"] },
  { question: "At 25°C, 20.0 mL of 0.2 M weak monoprotic acid HX is titrated against 0.2 M NaOH. The pH of the solution (a) at the start of the titration and (b) when 10 mL of NaOH is added respectively are. Given: Ka = 5 x 10^-4, pKa = 3.3", expect: "draw", labels: ["pH = pK_a = 3.3", "V_eq = 20 mL"] },
  { question: "The vapour pressures of two volatile liquids A and B at 25°C are 50 Torr and 100 Torr, respectively. If the liquid mixture contains 0.3 mole fraction of A, then the mole fraction of liquid B in the vapour phase is", expect: "draw", labels: ["p°_A = 50", "p°_B = 100", "p_total = 85"] },
  { question: "A weak base is titrated with a strong acid. Sketch the titration curve and mark the equivalence point.", expect: "draw", labels: ["eq. point", "pOH = pK_b", "pH < 7"] },
  { question: "0.1 M HCN is titrated with 0.1 M NaOH. Sketch the pH curve and state the pH at equivalence.", expect: "draw", labels: ["eq. point"] },
  { question: "Draw the vapour pressure against composition graph for an ideal solution of two volatile liquids.", expect: "draw", labels: ["p_A", "p_B", "p_total"] },
  { question: "The elevation in boiling point of a solution is 0.52 K. Show it on a vapour pressure versus temperature graph.", expect: "draw", labels: ["ΔT_b = 0.52 K"] },
  { question: "A solution of 0.1 M weak base (B) is titrated with 0.1 M of a strong acid (HA). The variation of pH of the solution with the volume of HA added is shown in the figure below. What is the pKb of the base?", expect: "decline" },
  { question: "40 mL of a mixture of CH3COOH and HCl is titrated against 0.1 M NaOH solution conductometrically. Which statement is correct?", expect: "decline" },
  { question: "A solution is made by mixing one mole of volatile liquid A with 3 moles of volatile liquid B. The vapour pressure of pure A is 200 mm Hg and that of the solution is 500 mm Hg. The vapour pressure of pure B is", expect: "decline" },
];
extras.forEach((probe, index) => runProbe(index, probe, "extra-"));

console.log("\nprobe table");
console.log("| # | question | expect | result | labels |");
for (const row of rows) {
  console.log(`| ${row.ok ? "ok " : "BAD"} ${row.name.slice(0, 34)} | ${row.question.slice(0, 70)} | ${row.expect} | ${row.result} | ${row.labels.join(" ; ")} |`);
}
const bad = rows.filter((row) => !row.ok);
console.log(`\nprobes: ${rows.length - bad.length}/${rows.length} as expected${bad.length ? `; unexpected: ${bad.map((row) => row.name).join(", ")}` : ""}`);

/* Real bank stems. */
if (profilePath) {
  interface ProfileRow { id: string; unit: string; figs: string[]; figure_absent: boolean; text: string }
  const profile = JSON.parse(readFileSync(profilePath, "utf8")) as ProfileRow[];
  const tagged = profile.filter((row) => row.figs.includes("titration_ph") || row.figs.includes("colligative"));
  const clean = (text: string) => text.replace(/^Topic Name:.*?ItemCode:\s*\d+\s*/s, "").replace(/\s+/g, " ").trim();
  const relevant = tagged.filter((row) => /titrat|equivalence|raoult|vapou?r pressure|mole fraction|deviation|boiling point|freezing point|ph curve|indicator|ideal solution/i.test(row.text));
  console.log(`\nbank: ${tagged.length} stems tagged titration_ph or colligative; ${relevant.length} carry a solutions word`);
  let drew = 0;
  let declined = 0;
  let refused = 0;
  const refusals: string[] = [];
  const drawn: string[] = [];
  const focus: string[] = [];
  tagged.forEach((row, index) => {
    const question = clean(row.text);
    const cue = isSolutionsGraphStem(question);
    const doc = cue ? buildSolutionsGraphScene(question, [], false) : null;
    if (!doc) {
      declined += 1;
      return;
    }
    const result = compileForLab(doc);
    const name = `bank-${String(index + 1).padStart(3, "0")}-${slug(question)}`;
    renderDocument(doc, `${outDir}/${name}.svg`, question.slice(0, 120));
    if (result.ok) {
      drew += 1;
      drawn.push(`${name}: ${question.slice(0, 110)} -> [${result.labels.join(", ")}]`);
    } else {
      refused += 1;
      refusals.push(`${name}: ${question.slice(0, 90)} -> ${result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    }
  });
  console.log(`bank tagged ${tagged.length}: drew ${drew}, declined ${declined}, refused ${refused}`);
  for (const line of drawn) console.log("  drew   " + line);
  for (const line of refusals) console.log("  REFUSED " + line);
  // The focused 20: relevant stems in file order, cue result each.
  relevant.slice(0, 20).forEach((row) => {
    const question = clean(row.text);
    const cue = isSolutionsGraphStem(question);
    const doc = cue ? buildSolutionsGraphScene(question, [], false) : null;
    const compiled = doc ? compileForLab(doc) : null;
    const outcome = !cue ? "decline (no cue)" : !doc ? "decline (not grounded)" : compiled?.ok ? "draw" : "refused";
    focus.push(`${outcome.padEnd(24)} | ${row.figs.join("+")} | ${question.slice(0, 120)}`);
  });
  console.log("\nfocused 20 relevant bank stems");
  for (const line of focus) console.log("  " + line);
}

if (!skipRaster) rasterize(outDir);
