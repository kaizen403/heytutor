/**
 * Crystal field lane bench: replay the probes through the solver and the
 * builder, render each to SVG/PNG, then measure the real bank.
 *
 *   pnpm exec tsx scripts/chemistry-lab/cft-lab.ts <outdir> [chem_profile.json]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CFT_PROBES,
  buildCrystalFieldScene,
  crystalFieldAnalysis,
  isCrystalFieldStem,
} from "../../src/chemistry/crystalField";
import { complexTokens } from "../../src/chemistry/formula";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = resolve(process.argv[2] ?? ".chemistry-lab/cft");
const profilePath = process.argv[3];

let failures = 0;
function check(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL ${message}`);
  }
}

/* --------------------------------------------------------------------- */
/* 1. Solver against hand-checked textbook values                        */
/* --------------------------------------------------------------------- */

const SOLVER_CASES: Array<{ complex: string; unpaired: number; hybrid: string; geometry: string; spin: "high" | "low" | null; cfse?: string; d: number }> = [
  { complex: "[Fe(H2O)6]2+", unpaired: 4, hybrid: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = -0.4Δ_o", d: 6 },
  { complex: "[Fe(CN)6]4-", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.4Δ_o", d: 6 },
  { complex: "[Fe(CN)6]3-", unpaired: 1, hybrid: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.0Δ_o", d: 5 },
  { complex: "K3[Fe(CN)6]", unpaired: 1, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 5 },
  { complex: "K4[Fe(CN)6]", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Co(NH3)6]3+", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.4Δ_o", d: 6 },
  { complex: "[Co(NH3)6]Cl3", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[CoF6]3-", unpaired: 4, hybrid: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = -0.4Δ_o", d: 6 },
  { complex: "[Co(C2O4)3]3-", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Co(H2O)6]2+", unpaired: 3, hybrid: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = -0.8Δ_o", d: 7 },
  { complex: "[Co(NH3)6]2+", unpaired: 3, hybrid: "sp3d2", geometry: "octahedral", spin: "high", d: 7 },
  { complex: "[Cr(H2O)6]3+", unpaired: 3, hybrid: "d2sp3", geometry: "octahedral", spin: null, cfse: "CFSE = -1.2Δ_o", d: 3 },
  { complex: "[Cr(NH3)6]3+", unpaired: 3, hybrid: "d2sp3", geometry: "octahedral", spin: null, d: 3 },
  { complex: "[Mn(H2O)6]2+", unpaired: 5, hybrid: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = 0", d: 5 },
  { complex: "[Mn(CN)6]4-", unpaired: 1, hybrid: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -2.0Δ_o", d: 5 },
  { complex: "[Mn(CN)6]3-", unpaired: 2, hybrid: "d2sp3", geometry: "octahedral", spin: "low", cfse: "CFSE = -1.6Δ_o", d: 4 },
  { complex: "[MnBr6]3-", unpaired: 4, hybrid: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = -0.6Δ_o", d: 4 },
  { complex: "[FeF6]3-", unpaired: 5, hybrid: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = 0", d: 5 },
  { complex: "[Ni(CN)4]2-", unpaired: 0, hybrid: "dsp2", geometry: "square_planar", spin: null, d: 8 },
  { complex: "[NiCl4]2-", unpaired: 2, hybrid: "sp3", geometry: "tetrahedral", spin: null, cfse: "CFSE = -0.8Δ_t", d: 8 },
  { complex: "[Ni(CO)4]", unpaired: 0, hybrid: "sp3", geometry: "tetrahedral", spin: null, cfse: "CFSE = 0", d: 10 },
  { complex: "[Ni(NH3)6]2+", unpaired: 2, hybrid: "sp3d2", geometry: "octahedral", spin: null, cfse: "CFSE = -1.2Δ_o", d: 8 },
  { complex: "[Cu(NH3)4]2+", unpaired: 1, hybrid: "dsp2", geometry: "square_planar", spin: null, d: 9 },
  { complex: "[CuCl4]2-", unpaired: 1, hybrid: "sp3", geometry: "tetrahedral", spin: null, d: 9 },
  { complex: "[Ti(H2O)6]3+", unpaired: 1, hybrid: "d2sp3", geometry: "octahedral", spin: null, cfse: "CFSE = -0.4Δ_o", d: 1 },
  { complex: "[V(H2O)6]2+", unpaired: 3, hybrid: "d2sp3", geometry: "octahedral", spin: null, d: 3 },
  { complex: "[Pt(NH3)2Cl2]", unpaired: 0, hybrid: "dsp2", geometry: "square_planar", spin: null, d: 8 },
  { complex: "[PtCl4]2-", unpaired: 0, hybrid: "dsp2", geometry: "square_planar", spin: null, d: 8 },
  { complex: "[CoCl4]2-", unpaired: 3, hybrid: "sp3", geometry: "tetrahedral", spin: "high", cfse: "CFSE = -1.2Δ_t", d: 7 },
  { complex: "[MnCl4]2-", unpaired: 5, hybrid: "sp3", geometry: "tetrahedral", spin: "high", cfse: "CFSE = 0", d: 5 },
  { complex: "[FeCl4]-", unpaired: 5, hybrid: "sp3", geometry: "tetrahedral", spin: "high", d: 5 },
  { complex: "[ZnCl4]2-", unpaired: 0, hybrid: "sp3", geometry: "tetrahedral", spin: null, d: 10 },
  { complex: "[Fe(H2O)5(NO)]2+", unpaired: 3, hybrid: "sp3d2", geometry: "octahedral", spin: "high", d: 7 },
  { complex: "[Fe(CN)5(NO)]2-", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Cr(CO)6]", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Co(NH3)5Cl]Cl2", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Co(en)3]3+", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Fe(bipy)3]2+", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Ru(NH3)6]2+", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: "low", d: 6 },
  { complex: "[Sc(H2O)6]3+", unpaired: 0, hybrid: "d2sp3", geometry: "octahedral", spin: null, cfse: "CFSE = 0", d: 0 },
  { complex: "[Cu(H2O)6]2+", unpaired: 1, hybrid: "sp3d2", geometry: "octahedral", spin: null, cfse: "CFSE = -0.6Δ_o", d: 9 },
  { complex: "[Cr(H2O)6]2+", unpaired: 4, hybrid: "sp3d2", geometry: "octahedral", spin: "high", cfse: "CFSE = -0.6Δ_o", d: 4 },
];

console.log("== solver ==");
for (const expected of SOLVER_CASES) {
  const result = crystalFieldAnalysis(expected.complex);
  if (!result) {
    check(false, `${expected.complex}: solver returned null`);
    continue;
  }
  check(result.dCount === expected.d, `${expected.complex}: d${result.dCount} expected d${expected.d}`);
  check(result.unpaired === expected.unpaired, `${expected.complex}: ${result.unpaired} unpaired expected ${expected.unpaired}`);
  check(result.hybridisationPlain === expected.hybrid, `${expected.complex}: ${result.hybridisationPlain} expected ${expected.hybrid}`);
  check(result.geometry === expected.geometry, `${expected.complex}: ${result.geometry} expected ${expected.geometry}`);
  check(result.spin === expected.spin, `${expected.complex}: spin ${result.spin} expected ${expected.spin}`);
  if (expected.cfse) check(result.cfse?.text === expected.cfse, `${expected.complex}: ${result.cfse?.text} expected ${expected.cfse}`);
  check(result.ionLabel.length <= 16, `${expected.complex}: label ${result.ionLabel} too long`);
  console.log(`  ${expected.complex.padEnd(16)} ${result.geometry.padEnd(14)} d${result.dCount} ${String(result.spin ?? "").padEnd(4)} ${result.fieldStrength.padEnd(6)} n=${result.unpaired} μ=${result.magneticMomentBM} ${(result.cfse?.text ?? "").padEnd(16)} ${result.hybridisationPlain.padEnd(6)} label=${result.ionLabel}`);
}
for (const declined of ["[Fe(CN)6]", "[CoF6]", "[Ag(NH3)2]+", "[Fe(CO)5]", "[Ca(H2O)6]2+"]) {
  const result = crystalFieldAnalysis(declined);
  const ok = result === null || result.geometry === "linear";
  check(ok, `${declined}: expected null or linear, got ${result ? result.geometry : "null"}`);
  console.log(`  ${declined.padEnd(16)} -> ${result ? result.geometry : "null"}`);
}

/* --------------------------------------------------------------------- */
/* 2. Probes through the builder, rendered                               */
/* --------------------------------------------------------------------- */

console.log("\n== probes ==");
const probeRows: string[] = [];
CFT_PROBES.forEach((probe, index) => {
  const cue = isCrystalFieldStem(probe.question);
  const document = cue ? buildCrystalFieldScene(probe.question, [], false) : null;
  const name = `probe-${String(index + 1).padStart(2, "0")}`;
  const result = renderDocument(document, `${outDir}/${name}.svg`, `${name} ${probe.question}`);
  const drew = result.ok;
  const outcome = drew ? "draw" : (document === null ? (cue ? "decline (builder)" : "decline (cue)") : "REFUSED");
  check((probe.expect === "draw") === drew, `${name}: expected ${probe.expect}, got ${outcome}`);
  if (drew && probe.labels) {
    for (const label of probe.labels) check(result.labels.includes(label), `${name}: missing label ${JSON.stringify(label)} in [${result.labels.join(", ")}]`);
  }
  if (drew && probe.forbidLabels) {
    for (const label of probe.forbidLabels) check(!result.labels.includes(label), `${name}: forbidden label ${JSON.stringify(label)} present`);
  }
  if (probe.solver) {
    const complex = complexTokens(probe.question)[0]!;
    const analysis = crystalFieldAnalysis(complex);
    check(analysis !== null, `${name}: solver null for ${complex}`);
    if (analysis) {
      check(analysis.unpaired === probe.solver.unpaired, `${name}: unpaired ${analysis.unpaired} expected ${probe.solver.unpaired}`);
      check(analysis.hybridisationPlain === probe.solver.hybridisation, `${name}: hybrid ${analysis.hybridisationPlain} expected ${probe.solver.hybridisation}`);
      check(analysis.geometry === probe.solver.geometry, `${name}: geometry ${analysis.geometry} expected ${probe.solver.geometry}`);
      if (probe.solver.spin !== undefined) check(analysis.spin === probe.solver.spin, `${name}: spin ${analysis.spin} expected ${probe.solver.spin}`);
      if (probe.solver.cfse) check(analysis.cfse?.text === probe.solver.cfse, `${name}: cfse ${analysis.cfse?.text} expected ${probe.solver.cfse}`);
    }
  }
  for (const label of result.labels) check(label.length <= 16, `${name}: label ${JSON.stringify(label)} longer than 16`);
  const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
  probeRows.push(`| ${probe.question.slice(0, 60)} | ${probe.expect} | ${outcome} | ${result.labels.join(", ")} |`);
  if (caption) console.log(`     caption: ${caption}`);
});

/* --------------------------------------------------------------------- */
/* 3. Real bank stems                                                    */
/* --------------------------------------------------------------------- */

interface BankRow { id: string; unit: string; figs: string[]; figure_absent: boolean; text: string }

const CFT_WORDS = /magnetic|spin|cfse|hybridi|unpaired|paramagnet|diamagnet|crystal field|splitting|t2g|colou?r/i;
const COMPLEX_HINT = /\[[A-Z][a-z]?[^\]]{1,40}\]|complex|ligand|coordination/i;

/**
 * Real stems for this family: a JSON profile (fields unit, figs, text) when
 * given, otherwise the question bank itself filtered to chemistry rows that
 * use a crystal field word and write a coordination complex.
 */
function loadBankRows(path: string | undefined): BankRow[] {
  if (path && existsSync(path)) {
    const rows = JSON.parse(readFileSync(path, "utf8")) as BankRow[];
    return rows.filter((row) => row.figs.some((fig) => fig === "crystal_field" || fig === "coord_isomer") && CFT_WORDS.test(row.text));
  }
  const root = "/Users/kaizen/heytutor/data/question-bank/build";
  const syllabusPath = `${root}/question-syllabus.jsonl`;
  const questionsPath = `${root}/questions.all.jsonl`;
  if (!existsSync(syllabusPath) || !existsSync(questionsPath)) {
    console.log(`bank: no profile at ${path ?? "(none)"} and no question bank under ${root}; skipping`);
    return [];
  }
  const subjectById = new Map<string, string>();
  for (const line of readFileSync(syllabusPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { question_id: string; subject?: string | null };
    if (row.subject) subjectById.set(row.question_id, row.subject);
  }
  const rows: BankRow[] = [];
  for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { question_id: string; text?: string };
    if (subjectById.get(row.question_id) !== "Chemistry") continue;
    const text = row.text ?? "";
    if (!CFT_WORDS.test(text) || !COMPLEX_HINT.test(text)) continue;
    rows.push({ id: row.question_id, unit: "chem", figs: [], figure_absent: false, text });
  }
  return rows;
}

const bankRows: string[] = [];
{
  console.log("\n== bank ==");
  const selected = loadBankRows(profilePath);
  const withComplex = selected.filter((row) => complexTokens(row.text).length > 0);
  console.log(`bank candidates: ${selected.length} chemistry stems with a crystal field word and a complex hint; ${withComplex.length} carry at least one parseable complex token; ${selected.filter((row) => isCrystalFieldStem(row.text)).length} pass isCrystalFieldStem`);
  let drew = 0;
  let declinedCue = 0;
  let declinedBuilder = 0;
  let refused = 0;
  let tried = 0;
  for (const row of selected) {
    if (tried >= 20) break;
    tried += 1;
    const cue = isCrystalFieldStem(row.text);
    const document = cue ? buildCrystalFieldScene(row.text, [], false) : null;
    const name = `bank-${row.id.replace(/^q_/, "").slice(0, 8)}`;
    const result = cue && document ? renderDocument(document, `${outDir}/${name}.svg`, `${name}`) : compileForLab(document);
    let outcome: string;
    if (result.ok) { drew += 1; outcome = "draw"; }
    else if (!cue) { declinedCue += 1; outcome = "decline (no cue or no readable complex)"; }
    else if (document === null) { declinedBuilder += 1; outcome = "decline (builder: unreadable or unmodelled complex)"; }
    else { refused += 1; outcome = `REFUSED ${result.issues.map((issue) => issue.code + ": " + issue.message).join("; ")}`; }
    const tokens = complexTokens(row.text);
    const brackets = row.text.match(/\[[^\]]{1,30}\]/g) ?? [];
    bankRows.push(`| ${row.id.slice(0, 14)} | ${outcome} | parsed ${tokens.length} of ${brackets.length} bracket tokens | ${row.text.replace(/\s+/g, " ").slice(0, 90)} |`);
    console.log(`  ${row.id.slice(0, 14)} ${outcome.padEnd(48)} tokens=${tokens.length}/${brackets.length} :: ${row.text.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  console.log(`\nbank: tried ${tried}, drew ${drew}, declined ${declinedCue + declinedBuilder} (cue ${declinedCue}, builder ${declinedBuilder}), refused ${refused}`);
}

rasterize(outDir);

console.log("\n== probe table ==");
console.log("| question | expect | result | labels |");
for (const row of probeRows) console.log(row);
if (bankRows.length) {
  console.log("\n== bank table ==");
  for (const row of bankRows) console.log(row);
}
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
