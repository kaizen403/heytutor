/**
 * Thermo lane bench: render every THERMO_PROBES entry plus any extra stems in
 * a JSON file, check expected labels, and rasterize.
 *
 *   pnpm exec tsx scripts/chemistry-lab/thermo-lab.ts <outdir> [extra.json]
 */
import { readFileSync } from "node:fs";
import { THERMO_PROBES, buildThermoGraphScene, isThermoGraphStem } from "../../src/chemistry/thermoGraphs";
import { compileForLab, rasterize, renderDocument } from "./lab";

const outDir = process.argv[2] ?? ".chemistry-lab/thermo";
const extraPath = process.argv.slice(3).find((arg) => !arg.startsWith("--"));
const skipRaster = process.argv.includes("--no-raster");

interface Row { question: string; expect?: "draw" | "decline"; labels?: string[]; forbidLabels?: string[]; note?: string; id?: string }

const rows: Row[] = extraPath
  ? (JSON.parse(readFileSync(extraPath, "utf8")) as Row[])
  : THERMO_PROBES.map((probe) => ({ ...probe }));

let pass = 0;
let fail = 0;
const summary: string[] = [];
rows.forEach((row, index) => {
  const cued = isThermoGraphStem(row.question);
  const document = cued ? buildThermoGraphScene(row.question, [], false) : null;
  const tag = `${String(index + 1).padStart(2, "0")}_${(row.id ?? row.question).replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}`;
  const result = document
    ? renderDocument(document, `${outDir}/${tag}.svg`, `${row.expect ?? "?"}: ${row.question.slice(0, 90)}`)
    : compileForLab(null);
  const drew = result.ok;
  const outcome = !cued ? "declined (no cue)" : !document ? "declined (builder null)" : drew ? "drew" : "REFUSED";
  const missing = (row.labels ?? []).filter((label) => !result.labels.includes(label));
  const forbidden = (row.forbidLabels ?? []).filter((label) => result.labels.includes(label));
  const expectOk = row.expect === undefined || (row.expect === "draw" ? drew : !drew);
  const ok = expectOk && missing.length === 0 && forbidden.length === 0;
  if (ok) pass += 1; else fail += 1;
  const caption = result.document?.annotations.find((annotation) => annotation.id === "figure_caption")?.text ?? "";
  summary.push(`${ok ? "PASS" : "FAIL"} #${index + 1} ${outcome} | ${row.question.slice(0, 70)} | labels=[${result.labels.join(" | ")}]${missing.length ? ` missing=[${missing.join(", ")}]` : ""}${forbidden.length ? ` forbidden=[${forbidden.join(", ")}]` : ""}${result.issues.length && cued && document ? ` issues=${JSON.stringify(result.issues.map((issue) => `${issue.code}: ${issue.message}`))}` : ""}`);
  if (caption) summary.push(`      caption: ${caption}`);
});
console.log(summary.join("\n"));
console.log(`\n${pass} pass, ${fail} fail of ${rows.length}`);
if (!skipRaster) rasterize(outDir);
