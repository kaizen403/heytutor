/** Render the family-path figure for each stem in a JSON array to <outdir>/<n>.svg and .png. */
import { readFileSync } from "node:fs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { rasterize, renderDocument } from "./lab";

const [file, outDir] = process.argv.slice(2);
if (!file || !outDir) throw new Error("usage: render-stems.ts <stems.json> <outdir>");
const rows = JSON.parse(readFileSync(file, "utf8")) as string[];
rows.forEach((question, index) => {
  const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
  if (!scene) { console.log(`NONE ${index + 1}: ${question.slice(0, 70)}`); return; }
  renderDocument(scene.document, `${outDir}/${String(index + 1).padStart(2, "0")}-${scene.family}.svg`, question.slice(0, 100), `family=${scene.family} tier=${scene.tier}`);
});
rasterize(outDir);
