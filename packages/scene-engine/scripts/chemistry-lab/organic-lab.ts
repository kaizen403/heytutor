/**
 * Organic lane bench: render every ORGANIC_PROBE plus extra structures,
 * reactions and isomer sets to SVG and PNG, then print facts for the
 * compounds whose stems ask about them.
 *
 *   pnpm exec tsx scripts/chemistry-lab/organic-lab.ts <outdir> [--bank <stems.json>]
 */
import { readFileSync } from "node:fs";
import { ORGANIC_PROBES, buildOrganicScene, isOrganicStem, moleculeFromName, organicFacts } from "../../src/chemistry/organic/index";
import { compileForLab, rasterize, renderDocument } from "./lab";

const args = process.argv.slice(2);
const outDir = args[0] ?? ".chemistry-lab/organic";
const bankIndex = args.indexOf("--bank");
const bankFile = bankIndex >= 0 ? args[bankIndex + 1] : null;

const EXTRA: Array<{ tag: string; question: string }> = [
  { tag: "cyclohexanol", question: "Draw the structure of cyclohexanol." },
  { tag: "isomers-c5h12", question: "How many structural isomers are possible for C5H12? Draw them." },
  { tag: "isomers-c4h8", question: "Draw all the isomers of C4H8 including geometrical isomers." },
  { tag: "toluene-kmno4", question: "Toluene on oxidation with alkaline KMnO4 followed by acidification gives benzoic acid." },
  { tag: "dou-benzene", question: "The degree of unsaturation of C6H6 (benzene) is" },
  { tag: "anthracene", question: "Draw the structures of anthracene and phenanthrene." },
  { tag: "glucose", question: "Draw the open chain structure of glucose." },
  { tag: "aspirin", question: "Aspirin (acetylsalicylic acid) is prepared from salicylic acid and acetic anhydride." },
  { tag: "list-four", question: "Which of the following will give iodoform test: ethanol, propan-2-ol, acetaldehyde and benzaldehyde?" },
  { tag: "grignard", question: "CH3MgBr reacts with acetone followed by hydrolysis to give 2-methylpropan-2-ol." },
  { tag: "aniline-diazo", question: "Aniline on treatment with NaNO2/HCl at 273 K gives benzenediazonium chloride." },
  { tag: "pyridine-pyrrole", question: "Compare the basicity of pyridine, pyrrole and piperidine." },
  { tag: "picric", question: "Phenol on treatment with conc. HNO3 gives picric acid." },
  { tag: "chiral-lactic", question: "The number of chiral carbon atoms in lactic acid and in tartaric acid is" },
  { tag: "wurtz", question: "Bromoethane on treatment with Na in dry ether gives butane (Wurtz reaction)." },
  { tag: "nitrobenzene", question: "Nitrobenzene on reduction with Sn/HCl gives aniline." },
  { tag: "decline-complex", question: "The magnetic moment of [Fe(CN)6]3- is" },
  { tag: "decline-kf", question: "Kf for benzene is 5.12 K kg/mol. The freezing point depression of a solution of 1 g naphthalene in 50 g benzene is" },
];

let index = 0;
for (const probe of ORGANIC_PROBES) {
  index += 1;
  const tag = `probe-${String(index).padStart(2, "0")}`;
  const fired = isOrganicStem(probe.question);
  const document = buildOrganicScene(probe.question, [], false);
  const result = renderDocument(document, `${outDir}/${tag}.svg`, `${tag} [${probe.expect}, cue=${fired}] ${probe.question}`);
  const verdict = probe.expect === "draw" ? (result.ok ? "ok" : "MISS") : (result.ok ? "WRONG DRAW" : "ok decline");
  console.log(`   ${verdict}`);
}
for (const extra of EXTRA) {
  const fired = isOrganicStem(extra.question);
  const document = buildOrganicScene(extra.question, [], false);
  renderDocument(document, `${outDir}/${extra.tag}.svg`, `${extra.tag} [cue=${fired}] ${extra.question}`);
}

for (const name of ["benzaldehyde", "2-chlorobutane", "benzene", "lactic acid", "tartaric acid", "but-2-yne", "acetophenone", "aspirin"]) {
  const molecule = moleculeFromName(name);
  if (!molecule) { console.log(`facts: ${name} -> null`); continue; }
  const facts = organicFacts(molecule);
  console.log(`facts: ${name} ${facts.formulaPlain} DoU=${facts.degreeOfUnsaturation} sp=${facts.counts.sp} sp2=${facts.counts.sp2} sp3=${facts.counts.sp3} chiral=${facts.chiralCentres.length} groups=[${facts.functionalGroups.join(", ")}]`);
}

if (bankFile) {
  const rows = JSON.parse(readFileSync(bankFile, "utf8")) as Array<{ id: string; text: string }>;
  let drew = 0; let declined = 0; let refused = 0; let cueOff = 0;
  for (const row of rows) {
    const fired = isOrganicStem(row.text);
    if (!fired) { cueOff += 1; console.log(`bank ${row.id} cue off :: ${row.text.slice(0, 110).replace(/\s+/g, " ")}`); continue; }
    const document = buildOrganicScene(row.text, [], false);
    if (!document) { declined += 1; console.log(`bank ${row.id} declined :: ${row.text.slice(0, 110).replace(/\s+/g, " ")}`); continue; }
    const result = compileForLab(document);
    if (result.ok) {
      drew += 1;
      renderDocument(document, `${outDir}/bank-${row.id.slice(2, 10)}.svg`, `bank ${row.id.slice(0, 12)} ${row.text.slice(0, 90)}`);
      console.log(`bank ${row.id} DREW labels=[${result.labels.join(", ")}] :: ${row.text.slice(0, 110).replace(/\s+/g, " ")}`);
    } else {
      refused += 1;
      console.log(`bank ${row.id} REFUSED ${result.issues.map((issue) => issue.code).join(",")} :: ${row.text.slice(0, 110).replace(/\s+/g, " ")}`);
    }
  }
  console.log(`bank summary: tried=${rows.length} drew=${drew} declined=${declined} refused=${refused} cue_off=${cueOff}`);
}

rasterize(outDir);
