/**
 * Kinetics lane bench: replay every probe, check the expected labels, write an
 * SVG and PNG per drawn probe, then run the real bank stems tagged rate_graph.
 *
 *   pnpm exec tsx scripts/chemistry-lab/kinetics-lab.ts <outdir> [chem_profile.json]
 */
import { readFileSync } from "node:fs";
import { KINETICS_PROBES, buildKineticsScene, isKineticsStem, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/kinetics";
const bankPath = process.argv[3];

let failures = 0;
console.log("== probes ==");
KINETICS_PROBES.forEach((probe, index) => {
  const cue = isKineticsStem(probe.question);
  const document = cue ? buildKineticsScene(probe.question, [], false) : null;
  const slug = `kinetics-${String(index + 1).padStart(2, "0")}`;
  const result = document ? renderDocument(document, `${outDir}/${slug}.svg`, probe.question) : compileForLab(null);
  const drew = result.ok;
  const outcome: "draw" | "decline" = drew ? "draw" : "decline";
  const missing = (probe.labels ?? []).filter((label) => !result.labels.includes(label));
  const forbidden = (probe.forbidLabels ?? []).filter((label) => result.labels.includes(label));
  const ok = outcome === probe.expect && missing.length === 0 && forbidden.length === 0;
  if (!ok) failures += 1;
  const reason = !cue ? "cue=false" : !document ? "builder=null" : !result.ok ? `refused: ${result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}` : "";
  console.log(`${ok ? "PASS" : "FAIL"} [${index + 1}] expect=${probe.expect} got=${outcome} ${reason}${missing.length ? ` missing=${JSON.stringify(missing)}` : ""}${forbidden.length ? ` forbidden=${JSON.stringify(forbidden)}` : ""}`);
  console.log(`       ${probe.question.slice(0, 110)}`);
  if (document) {
    const caption = document.annotations.find((annotation) => annotation.id === "figure_caption");
    if (caption && "text" in caption) console.log(`       caption: ${(caption as { text?: string }).text}`);
    const numeric = document.assertions.filter((assertion) => assertion.predicate === "function_value").length;
    console.log(`       function_value assertions: ${numeric}; labels: ${result.labels.join(" | ")}`);
  }
});
console.log(`probes: ${KINETICS_PROBES.length - failures}/${KINETICS_PROBES.length} pass`);

if (bankPath) {
  console.log("\n== real bank (rate_graph) ==");
  const rows = JSON.parse(readFileSync(bankPath, "utf8")) as Array<{ id: string; unit: string; figs?: string[]; figure_absent?: boolean; text: string }>;
  const stems = rows.filter((row) => (row.figs ?? []).includes("rate_graph"));
  let drew = 0;
  let declined = 0;
  let refused = 0;
  let notCue = 0;
  stems.forEach((row, index) => {
    const question = row.text.replace(/\s+/g, " ").trim();
    const cue = isKineticsStem(question);
    const document = cue ? buildKineticsScene(question, [], false) : null;
    const result = document ? renderDocument(document, `${outDir}/bank/bank-${String(index + 1).padStart(2, "0")}.svg`, question.slice(0, 80)) : compileForLab(null);
    let verdict: string;
    if (!cue) { verdict = "no cue"; notCue += 1; declined += 1; }
    else if (!document) { verdict = "declined"; declined += 1; }
    else if (!result.ok) { verdict = `REFUSED ${result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`; refused += 1; }
    else { verdict = `drew [${result.labels.join(" | ")}]`; drew += 1; }
    const spec = kineticsFromStem(question);
    const solved = spec ? solveKinetics(spec) : null;
    const summary = spec ? `order=${spec.order} k=${spec.k} t½=${spec.tHalf} unit=${spec.timeUnit} plot=${spec.plot} linear=${spec.linear} arr=${spec.arrhenius ? JSON.stringify({ T1: spec.arrhenius.T1, T2: spec.arrhenius.T2, ratio: spec.arrhenius.ratio, Ea: spec.arrhenius.Ea, k1: spec.arrhenius.k1, k2: spec.arrhenius.k2 }) : null} solved={Ea:${solved?.Ea}, tHalf:${solved?.tHalf}}` : "spec=null";
    console.log(`[${index + 1}] ${verdict}\n      ${question.slice(0, 140)}\n      ${summary}`);
  });
  console.log(`bank: ${stems.length} stems, drew ${drew}, declined ${declined} (no cue ${notCue}), refused ${refused}`);
}

rasterize(outDir);
