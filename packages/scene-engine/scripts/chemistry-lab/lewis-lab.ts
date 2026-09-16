/**
 * Lewis lane bench: render every probe (and, with `--bank <json>`, real bank
 * stems) through the family builder, print what drew and why not, then
 * rasterize. `pnpm exec tsx scripts/chemistry-lab/lewis-lab.ts <outdir> [--bank stems.json] [--stem "..."]`
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLewisScene, isLewisStem, LEWIS_PROBES, lewisStructure } from "../../src/chemistry/lewis";
import { formulaTokens } from "../../src/chemistry/formula";
import { rasterize, renderDocument } from "./lab";

const args = process.argv.slice(2);
const outDir = args.find((arg) => !arg.startsWith("--")) ?? ".chemistry-lab/lewis";
const bankIndex = args.indexOf("--bank");
const stemIndex = args.indexOf("--stem");
const noRaster = args.includes("--no-raster");

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

interface Row { question: string; expect?: "draw" | "decline"; labels?: string[]; forbidLabels?: string[]; note?: string; id?: string }

function run(rows: Row[], prefix: string): void {
  let drew = 0;
  let declined = 0;
  let refused = 0;
  let mismatched = 0;
  rows.forEach((row, index) => {
    const cue = isLewisStem(row.question);
    const document = buildLewisScene(row.question, [], false);
    const name = `${prefix}-${String(index + 1).padStart(2, "0")}-${slug(row.id ?? row.question)}`;
    if (!document) {
      const tokens = formulaTokens(row.question);
      const solvable = tokens.filter((token) => lewisStructure(token));
      const why = !cue ? "no cue or vetoed" : tokens.length === 0 ? "no formula token" : solvable.length === 0 ? `tokens unsolvable: ${tokens.join(" ")}` : solvable.length > 4 ? `${solvable.length} species (more than four)` : "builder returned null";
      const flag = row.expect === "draw" ? "  <-- expected draw" : "";
      console.log(`declined ${name} :: ${why}${flag}`);
      declined += 1;
      if (row.expect === "draw") mismatched += 1;
      return;
    }
    const result = renderDocument(document, `${outDir}/${name}.svg`, row.question.slice(0, 90));
    if (!result.ok) {
      refused += 1;
      if (row.expect !== "decline") mismatched += 1;
      return;
    }
    drew += 1;
    const missing = (row.labels ?? []).filter((label) => !result.labels.includes(label));
    const present = (row.forbidLabels ?? []).filter((label) => result.labels.includes(label));
    if (row.expect === "decline" || missing.length || present.length) {
      mismatched += 1;
      console.log(`  MISMATCH ${name}: expect=${row.expect ?? "?"} missing=[${missing.join(", ")}] forbidden present=[${present.join(", ")}]`);
    }
  });
  console.log(`\n${prefix}: ${rows.length} stems, drew ${drew}, declined ${declined}, refused ${refused}, mismatched ${mismatched}\n`);
}

if (stemIndex >= 0) {
  run([{ question: args[stemIndex + 1]! }], "stem");
} else if (bankIndex >= 0) {
  const rows = JSON.parse(readFileSync(args[bankIndex + 1]!, "utf8")) as Row[];
  run(rows, "bank");
} else {
  run([...LEWIS_PROBES], "probe");
}
// The shared SVG bench writes 13 px text; the board writes 24 px handwritten
// labels, so the PNGs are re-lettered at board size before anyone judges overlap.
function boardSizeLabels(dir: string): void {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".svg")) continue;
    const path = join(dir, file);
    const svg = readFileSync(path, "utf8").replace(/font-size="13" text-anchor="middle"/g, 'font-size="24" text-anchor="middle" dominant-baseline="middle"');
    writeFileSync(path, svg);
  }
}
if (!noRaster) {
  boardSizeLabels(outDir);
  rasterize(outDir);
}
