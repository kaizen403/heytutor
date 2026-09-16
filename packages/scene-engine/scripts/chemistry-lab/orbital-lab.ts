/**
 * Orbital lane bench: replays ORBITAL_PROBES, a set of hand-checked
 * configuration facts, and real bank stems tagged orbital_box, rendering
 * every drawn figure to SVG (and PNG via headless Firefox).
 *
 *   pnpm exec tsx scripts/chemistry-lab/orbital-lab.ts <outdir> [bank.json]
 */
import { readFileSync } from "node:fs";
import { electronConfiguration } from "../../src/chemistry/electronConfiguration";
import { ORBITAL_PROBES, buildOrbitalScene, isOrbitalStem } from "../../src/chemistry/orbitalBox";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/orbital";
const bankPath = process.argv[3] ?? null;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

/* 1. Configuration facts the brief lists, checked against the shared module. */
console.log("== configuration facts ==");
const FACTS: Array<[string, number, string, number, number]> = [
  ["Cr", 0, "[Ar] 3d5 4s1", 6, 6.93], ["Cu", 0, "[Ar] 3d10 4s1", 1, 1.73], ["Fe", 3, "[Ar] 3d5", 5, 5.92], ["Fe", 2, "[Ar] 3d6", 4, 4.9],
  ["Mn", 2, "[Ar] 3d5", 5, 5.92], ["Ni", 2, "[Ar] 3d8", 2, 2.83], ["Cu", 2, "[Ar] 3d9", 1, 1.73], ["Zn", 2, "[Ar] 3d10", 0, 0],
  ["Cr", 3, "[Ar] 3d3", 3, 3.87], ["Co", 2, "[Ar] 3d7", 3, 3.87], ["Ti", 3, "[Ar] 3d1", 1, 1.73], ["V", 3, "[Ar] 3d2", 2, 2.83],
  ["Sc", 3, "[Ne] 3s2 3p6", 0, 0], ["Gd", 3, "[Xe] 4f7", 7, 7.94], ["Cl", -1, "[Ne] 3s2 3p6", 0, 0], ["N", 0, "[He] 2s2 2p3", 3, 3.87], ["O", 0, "[He] 2s2 2p4", 2, 2.83],
];
let factFailures = 0;
for (const [symbol, charge, condensed, unpaired, moment] of FACTS) {
  const configuration = electronConfiguration(symbol, charge)!;
  const ok = configuration.condensed === condensed && configuration.unpairedElectrons === unpaired && Math.abs(configuration.magneticMomentBM - moment) < 0.01;
  if (!ok) factFailures += 1;
  console.log(`${ok ? "ok " : "BAD"} ${symbol}${charge ? (charge > 0 ? `${charge}+` : `${-charge}-`) : ""} -> ${configuration.condensed} unpaired=${configuration.unpairedElectrons} mu=${configuration.magneticMomentBM} boxes=${configuration.valenceBoxes.map((b) => `${b.subshell.n}${b.subshell.l}[${b.boxes.join("")}]`).join(" ")}`);
}
console.log(`facts: ${FACTS.length - factFailures}/${FACTS.length} ok\n`);

/* 2. Probes. */
console.log("== probes ==");
let probeFailures = 0;
const probeRows: string[] = [];
ORBITAL_PROBES.forEach((probe, index) => {
  const cue = isOrbitalStem(probe.question);
  const document = cue ? buildOrbitalScene(probe.question, [], false) : null;
  const result = renderDocument(document, `${outDir}/probe-${String(index + 1).padStart(2, "0")}-${slug(probe.question)}.svg`, probe.question);
  const drew = result.ok;
  const outcome = drew ? "draw" : cue && document ? "refused" : "decline";
  const missing = (probe.labels ?? []).filter((label) => !result.labels.includes(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => result.labels.includes(label));
  const pass = outcome === probe.expect && missing.length === 0 && forbidden.length === 0;
  if (!pass) probeFailures += 1;
  probeRows.push(`${pass ? "PASS" : "FAIL"} | ${probe.question.slice(0, 60)} | expect ${probe.expect} | got ${outcome}${missing.length ? ` | missing ${missing.join(", ")}` : ""}${forbidden.length ? ` | forbidden ${forbidden.join(", ")}` : ""} | labels: ${result.labels.join(", ")}`);
});
console.log(probeRows.join("\n"));
console.log(`probes: ${ORBITAL_PROBES.length - probeFailures}/${ORBITAL_PROBES.length} pass\n`);

/* 3. Extra hand-written cases beyond the probes. */
console.log("== extra cases ==");
const EXTRA = [
  "Find the spin only magnetic moment of Mn2+ and Zn2+.",
  "Arrange Cr3+, Co2+, Ti3+ and V3+ in increasing order of spin only magnetic moment.",
  "Sc3+ is diamagnetic. Write its electronic configuration.",
  "Write the electronic configuration of oxygen and count its unpaired electrons.",
  "How many radial nodes and angular nodes are present in a 3d orbital?",
  "The number of radial nodes in the 4s orbital is",
  "Draw the shape of the 2s orbital and mark its radial node.",
  "For n = 3 and l = 2, write the possible values of m and the number of orbitals.",
  "What is the maximum number of electrons that can be accommodated in the shell with n = 4?",
  "Which of the following electronic configurations has the highest magnetic moment? [Ar] 3d8, [Ar] 3d5, [Ar] 3d3, [Ar] 3d10",
  "Electronic configuration of four elements are given: (A) 1s2 2s2 2p2 (B) 1s2 2s2 2p4 (C) 1s2 2s2 2p5 (D) 1s2 2s2 2p3. Which has the most unpaired electrons?",
  "Sketch the shape of the p_x orbital and show its nodal plane.",
  "Draw the d_(x^2-y^2) orbital and indicate its nodal planes.",
  "Among Sc, Mn, Co and Cu, the spin only magnetic moment of the element in its +2 oxidation state is",
  "Which set of quantum numbers is correct for the 19th electron of chromium (atomic number 24) according to the aufbau principle?",
  "The spin only magnetic moment of Cr(CO)6 is",
  "Arrange the elements Sc, Cr, V, Ti and Mn in increasing order of the number of unpaired electrons.",
  "A hydrogen atom in its ground state absorbs a photon; the electron moves to n = 3. Find the wavelength.",
  "Write the electronic configuration of Pt (atomic number 78).",
];
EXTRA.forEach((question, index) => {
  const cue = isOrbitalStem(question);
  const document = cue ? buildOrbitalScene(question, [], false) : null;
  renderDocument(document, `${outDir}/extra-${String(index + 1).padStart(2, "0")}-${slug(question)}.svg`, question);
});

/* 4. Real bank stems tagged orbital_box. */
if (bankPath) {
  console.log("\n== bank stems (figs include orbital_box) ==");
  const rows = JSON.parse(readFileSync(bankPath, "utf8")) as Array<{ id: string; unit: string | null; figs: string[]; text: string }>;
  const tagged = rows.filter((row) => row.figs.includes("orbital_box"));
  const sweepAll = process.argv[4] === "all";
  const untagged = sweepAll
    ? rows.filter((row) => !row.figs.includes("orbital_box") && /quantum number|nodal|\bnodes?\b|shape of|orbital|electronic configuration|unpaired/i.test(row.text) && /atomic structure|d-f block|periodicity/.test(row.unit ?? ""))
    : [];
  const bank = sweepAll ? [...tagged, ...untagged] : tagged.slice(0, 20);
  let drew = 0;
  let declined = 0;
  let refused = 0;
  const lines: string[] = [];
  bank.forEach((row, index) => {
    const question = row.text.replace(/^Topic Name:[^\n]*\n/, "").replace(/^(?:Item|Ttem)Code:[^\n]*\n/, "").replace(/\s+/g, " ").trim();
    const cue = isOrbitalStem(question);
    const document = cue ? buildOrbitalScene(question, [], false) : null;
    const result = document ? renderDocument(document, `${outDir}/bank-${String(index + 1).padStart(2, "0")}-${row.id.slice(2, 10)}.svg`, question.slice(0, 80)) : compileForLab(null);
    const outcome = result.ok ? "draw" : document ? "REFUSED" : "decline";
    if (result.ok) drew += 1;
    else if (document) refused += 1;
    else declined += 1;
    const why = !cue ? "no cue or vetoed" : !document ? "builder returned null" : result.ok ? "" : result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
    lines.push(`${outcome.padEnd(7)} ${row.id.slice(2, 10)} ${(row.unit ?? "?").padEnd(24)} ${why.padEnd(24)} ${question.slice(0, 90)}${result.ok ? ` | labels: ${result.labels.join(", ")}` : ""}`);
  });
  console.log(lines.join("\n"));
  console.log(`bank: tried=${bank.length} drew=${drew} declined=${declined} refused=${refused}`);
}

rasterize(outDir);
