/**
 * Periodic trend lane bench: render every PERIODIC_PROBES entry, then replay
 * the periodic_trend rows of the real chemistry bank and count what draws.
 *
 *   pnpm exec tsx scripts/chemistry-lab/periodic-lab.ts <outdir> [bank.json] [--extra stem]
 */
import { readFileSync } from "node:fs";
import { buildPeriodicTrendScene, isPeriodicTrendStem, PERIODIC_PROBES } from "../../src/chemistry/periodicTrend";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/periodic";
const bankPath = process.argv[3];
const extra = process.argv.indexOf("--extra");

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

let pass = 0;
let fail = 0;
console.log("== probes ==");
PERIODIC_PROBES.forEach((probe, index) => {
  const cue = isPeriodicTrendStem(probe.question);
  const document = cue ? buildPeriodicTrendScene(probe.question, [], false) : null;
  const result = renderDocument(document, `${outDir}/probe-${String(index + 1).padStart(2, "0")}-${slug(probe.question)}.svg`, probe.question);
  const drew = result.ok;
  const labelSet = new Set(result.labels);
  const missing = (probe.labels ?? []).filter((label) => !labelSet.has(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => labelSet.has(label));
  const okExpect = probe.expect === "draw" ? drew && missing.length === 0 && forbidden.length === 0 : !drew;
  if (okExpect) pass += 1; else fail += 1;
  const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
  console.log(`  ${okExpect ? "PASS" : "FAIL"} [${probe.expect}] cue=${cue} drew=${drew}${missing.length ? " missing=" + JSON.stringify(missing) : ""}${forbidden.length ? " forbidden=" + JSON.stringify(forbidden) : ""}`);
  if (caption) console.log(`       caption: ${caption}`);
});
console.log(`probes: ${pass} pass, ${fail} fail of ${PERIODIC_PROBES.length}`);

if (extra >= 0) {
  const stem = process.argv.slice(extra + 1).join(" ");
  const document = isPeriodicTrendStem(stem) ? buildPeriodicTrendScene(stem, [], false) : null;
  const result = renderDocument(document, `${outDir}/extra-${slug(stem)}.svg`, stem);
  console.log("extra caption:", document?.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "(none)", result.ok);
}

if (bankPath) {
  console.log("== bank ==");
  const rows = JSON.parse(readFileSync(bankPath, "utf8")) as Array<{ id: string; figs: string[]; figure_absent: boolean; text: string }>;
  const periodic = rows.filter((row) => row.figs.includes("periodic_trend"));
  let drew = 0;
  let declined = 0;
  let refused = 0;
  let cueMiss = 0;
  periodic.forEach((row, index) => {
    const stem = row.text.replace(/\s+/g, " ").trim();
    const cue = isPeriodicTrendStem(stem);
    const document = cue ? buildPeriodicTrendScene(stem, [], false) : null;
    const compiled = compileForLab(document);
    let status: string;
    if (!cue) { cueMiss += 1; status = "no-cue"; }
    else if (!document) { declined += 1; status = "declined"; }
    else if (!compiled.ok) { refused += 1; status = "REFUSED " + JSON.stringify(compiled.issues.map((issue) => `${issue.code}: ${issue.message}`)); }
    else { drew += 1; status = "drew"; }
    if (document && compiled.ok) {
      renderDocument(document, `${outDir}/bank-${String(index).padStart(2, "0")}-${slug(stem)}.svg`, stem.slice(0, 90));
    }
    const caption = document?.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
    console.log(`  #${index} ${row.figure_absent ? "[absent]" : "[figure]"} ${status} :: ${stem.slice(0, 110)}`);
    if (caption) console.log(`       caption: ${caption}`);
  });
  console.log(`bank periodic_trend rows: ${periodic.length}; drew ${drew}, declined ${declined}, refused ${refused}, no cue ${cueMiss}`);
}

rasterize(outDir);
