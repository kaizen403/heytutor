/**
 * Render what the deterministic engine draws for a question, as SVG.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/render-scene.ts "A ball is thrown at 20 m/s at 30 degrees..." [out.svg]
 *
 * Runs the same path lectures fall back to (archetype/family synthesis, then
 * last resort) and writes the board. Pass `--png` to also rasterize with
 * macOS `qlmanage` when available. No LLM is involved.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../src/synthesize/familyScene";
import { renderSceneSvg } from "./lib/renderSceneSvg";

const args = process.argv.slice(2);
const wantPng = args.includes("--png");
const positional = args.filter((argument) => argument !== "--png");
const question = positional[0]?.trim();
if (!question) {
  console.error('usage: tsx scripts/render-scene.ts "<question>" [out.svg] [--png]');
  process.exit(2);
}
const outPath = resolve(positional[1] ?? `render-scene-${Date.now()}.svg`);

let result = synthesizeFamilyScene({ question });
let via = "family";
if (!result) {
  result = synthesizeLastResortScene({ question });
  via = "last_resort";
}
if (!result) {
  console.log("no diagram: the deterministic path declined this question (honest text-only)");
  process.exit(0);
}
const assertions = result.document.assertions.map((assertion) => assertion.predicate).join("/");
const subtitle = `family=${result.family} via=${via} tier=${result.tier} primitives=${result.renderScene.primitives.length} assertions=${assertions}`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, renderSceneSvg(result.renderScene, { title: question.slice(0, 110), subtitle }));
console.log(subtitle);
console.log(`svg: ${outPath}`);
if (wantPng) {
  try {
    execFileSync("qlmanage", ["-t", "-s", "1200", "-o", dirname(outPath), outPath], { stdio: "ignore" });
    console.log(`png: ${outPath}.png`);
  } catch {
    console.log("png: qlmanage unavailable; open the svg directly");
  }
}
