/**
 * Coordination family bench: solver checks against textbook isomer counts,
 * every probe rendered, then real bank stems replayed.
 *
 *   pnpm exec tsx scripts/chemistry-lab/coord-lab.ts <outdir> [bank-stems.json] [extra-stems.json]
 */
import { readFileSync } from "node:fs";
import {
  COORD_PROBES,
  buildCoordinationScene,
  coordinationIsomers,
  isCoordinationStem,
} from "../../src/chemistry/coordination";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/coord";
const profilePath = process.argv[3];
const extraPath = process.argv[4];

/* ---------------------------------------------------------------- solver */

const SOLVER_CASES: Array<{ text: string; geometry: string; geometrical: number; optical: boolean; stereo: number; names?: string[] }> = [
  { text: "[Co(NH3)4Cl2]+", geometry: "octahedral", geometrical: 2, optical: false, stereo: 2, names: ["cis", "trans"] },
  { text: "[Co(NH3)3Cl3]", geometry: "octahedral", geometrical: 2, optical: false, stereo: 2, names: ["fac", "mer"] },
  { text: "[Co(en)2Cl2]+", geometry: "octahedral", geometrical: 2, optical: true, stereo: 3, names: ["cis", "trans"] },
  { text: "[Cr(en)3]3+", geometry: "octahedral", geometrical: 1, optical: true, stereo: 2 },
  { text: "[Co(ox)3]3-", geometry: "octahedral", geometrical: 1, optical: true, stereo: 2 },
  { text: "[Co(NH3)2Cl2(H2O)2]+", geometry: "octahedral", geometrical: 5, optical: true, stereo: 6 },
  { text: "[Co(NH3)4ClBr]+", geometry: "octahedral", geometrical: 2, optical: false, stereo: 2, names: ["cis", "trans"] },
  { text: "[Co(NH3)5Cl]2+", geometry: "octahedral", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Co(en)(NH3)3(H2O)]3+", geometry: "octahedral", geometrical: 2, optical: false, stereo: 2 },
  { text: "[Co(en)(NH3)2Cl2]+", geometry: "octahedral", geometrical: 3, optical: true, stereo: 4 },
  { text: "[Co(gly)3]", geometry: "octahedral", geometrical: 2, optical: true, stereo: 4, names: ["fac", "mer"] },
  { text: "[Pt(NH3)2Cl2]", geometry: "square planar", geometrical: 2, optical: false, stereo: 2, names: ["cis", "trans"] },
  { text: "[Pt(NH3)(H2O)Cl2]", geometry: "square planar", geometrical: 2, optical: false, stereo: 2, names: ["cis", "trans"] },
  { text: "[Pt(NH3)(py)ClBr]", geometry: "square planar", geometrical: 3, optical: false, stereo: 3 },
  { text: "[Pt(en)Cl2]", geometry: "square planar", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Ni(dmg)2]", geometry: "square planar", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Ni(CN)4]2-", geometry: "square planar", geometrical: 1, optical: false, stereo: 1 },
  { text: "[NiCl4]2-", geometry: "tetrahedral", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Ni(CO)4]", geometry: "tetrahedral", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Cu(NH3)4]2+", geometry: "square planar", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Co(NH3)6]Cl3", geometry: "octahedral", geometrical: 1, optical: false, stereo: 1 },
  { text: "K4[Fe(CN)6]", geometry: "octahedral", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Cr(H2O)4Cl2]Cl", geometry: "octahedral", geometrical: 2, optical: false, stereo: 2, names: ["cis", "trans"] },
  { text: "[Ag(NH3)2]+", geometry: "linear", geometrical: 1, optical: false, stereo: 1 },
  { text: "[Pt(en)2Cl2]2+", geometry: "octahedral", geometrical: 2, optical: true, stereo: 3, names: ["cis", "trans"] },
  { text: "[Cr(ox)2Cl2]3-", geometry: "octahedral", geometrical: 2, optical: true, stereo: 3, names: ["cis", "trans"] },
  { text: "[Co(NH3)3Cl2(H2O)]+", geometry: "octahedral", geometrical: 3, optical: false, stereo: 3 },
];

let solverFailures = 0;
console.log("== solver ==");
for (const expected of SOLVER_CASES) {
  const result = coordinationIsomers(expected.text);
  const got = result
    ? `${result.geometry}, ${result.geometricalCount} geometrical [${result.geometrical.map((isomer) => `${isomer.name || "one form"}${isomer.optical ? "*" : ""}${isomer.helicity ? isomer.helicity : ""}`).join(", ")}], optical=${result.opticalIsomers}, stereo=${result.stereoisomerCount}`
    : "null";
  const ok = Boolean(result) &&
    result!.geometry === expected.geometry &&
    result!.geometricalCount === expected.geometrical &&
    result!.opticalIsomers === expected.optical &&
    result!.stereoisomerCount === expected.stereo &&
    (!expected.names || expected.names.every((name, index) => result!.geometrical[index]?.name === name));
  if (!ok) solverFailures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${expected.text.padEnd(24)} ${got}`);
}
for (const text of ["[Co(NH3)5SO4]Cl", "[Mg(EDTA)]2-", "[Fe(CO)5]", "[M(NCS)(NO2)(gly)]", "[Co(NH3)6][Cr(CN)6]"]) {
  const result = coordinationIsomers(text);
  console.log(`${result === null ? "PASS" : "FAIL"} ${text.padEnd(24)} ${result === null ? "declined" : "drew " + result.geometry}`);
  if (result !== null) solverFailures += 1;
}
console.log(`solver failures: ${solverFailures}`);

/* ---------------------------------------------------------------- probes */

console.log("\n== probes ==");
let probeFailures = 0;
const probeRows: string[] = [];
COORD_PROBES.forEach((probe, index) => {
  const cue = isCoordinationStem(probe.question);
  const document = buildCoordinationScene(probe.question, [], false);
  const slug = `probe-${String(index + 1).padStart(2, "0")}`;
  const result = renderDocument(document, `${outDir}/${slug}.svg`, probe.question);
  const drew = result.ok;
  const labels = result.labels;
  const missing = (probe.labels ?? []).filter((label) => !labels.includes(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => labels.includes(label));
  const outcome = drew ? "draw" : "decline";
  const ok = outcome === probe.expect && missing.length === 0 && forbidden.length === 0 && (probe.expect === "decline" || cue);
  if (!ok) probeFailures += 1;
  const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption");
  const captionText = caption && "text" in caption ? String(caption.text) : "";
  probeRows.push(`${ok ? "PASS" : "FAIL"} | ${probe.question.slice(0, 70)} | expect ${probe.expect} | got ${outcome} | cue=${cue} | labels=[${labels.join(", ")}]${missing.length ? " MISSING " + missing.join(",") : ""}${forbidden.length ? " FORBIDDEN " + forbidden.join(",") : ""}`);
  if (captionText) probeRows.push(`      caption: ${captionText}`);
});
console.log(probeRows.join("\n"));
console.log(`probe failures: ${probeFailures}`);

/* ------------------------------------------------------------- real bank */

if (profilePath) {
  // A JSON list of real bank rows {id, unit, text}: OCR text as extracted,
  // chosen because it carries a bracketed complex and an isomer, structure,
  // shape, naming or chelation cue.
  console.log("\n== real bank ==");
  interface Row { id: string; unit: string | null; text: string }
  const rows = (JSON.parse(readFileSync(profilePath, "utf8")) as Row[]).slice(0, 20);
  let drew = 0;
  let declined = 0;
  let refused = 0;
  rows.forEach((row, index) => {
    const question = row.text;
    const cue = isCoordinationStem(question);
    const document = buildCoordinationScene(question, [], false);
    const slug = `bank-${String(index + 1).padStart(2, "0")}-${row.id.slice(2, 10)}`;
    const compiled = document ? renderDocument(document, `${outDir}/${slug}.svg`, question.replace(/\s+/g, " ").slice(0, 90)) : compileForLab(null);
    const status = !document ? "declined" : compiled.ok ? "drew" : "REFUSED";
    if (status === "drew") drew += 1; else if (status === "declined") declined += 1; else refused += 1;
    const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption");
    const captionText = caption && "text" in caption ? String(caption.text) : "";
    console.log(`[${slug}] ${status} cue=${cue} :: ${question.replace(/\s+/g, " ").slice(0, 110)}`);
    if (captionText) console.log(`      caption: ${captionText}`);
    if (status === "REFUSED") console.log(`      issues: ${JSON.stringify(compiled.issues.map((issue) => `${issue.code}: ${issue.message}`))}`);
  });
  console.log(`bank: ${rows.length} tried, drew ${drew}, declined ${declined}, refused ${refused}`);
}

/* ------------------------------------------------------------ extra stems */

if (extraPath) {
  // Typed stems outside the probes: layouts the probes do not reach.
  console.log("\n== extra stems ==");
  const stems = JSON.parse(readFileSync(extraPath, "utf8")) as string[];
  stems.forEach((question, index) => {
    const document = buildCoordinationScene(question, [], false);
    const result = renderDocument(document, `${outDir}/extra-${String(index + 1).padStart(2, "0")}.svg`, question);
    const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption");
    console.log(`      cue=${isCoordinationStem(question)} ${result.ok ? "drew" : document ? "REFUSED" : "declined"} :: ${caption && "text" in caption ? String(caption.text) : ""}`);
  });
}

rasterize(outDir);
