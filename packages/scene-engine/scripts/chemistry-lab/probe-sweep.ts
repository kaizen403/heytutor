/** Every chemistry syllabus probe through the live family path, per unit. `tsx probe-sweep.ts <outdir>` */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isChemistrySceneFamily } from "../../src/chemistry";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { renderSceneSvg } from "../lib/renderSceneSvg";

const outDir = process.argv[2] ?? ".chemistry-lab/probe-sweep";
mkdirSync(`${outDir}/svg`, { recursive: true });
const root = new URL("../../../../", import.meta.url).pathname;
const dir = `${root}data/syllabus-probes`;
const rows: string[] = [];
const perUnit: Array<{ unit: string; probes: number; drew: number; physics: number }> = [];
for (const file of readdirSync(dir).filter((name) => /^chemistry-unit-\d+\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))) {
  const data = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as { unitId: string; questions: Array<{ id: string; question: string }> };
  let drew = 0; let physics = 0;
  for (const probe of data.questions) {
    let family: string | null = null; let labels: string[] = []; let error = "";
    try {
      const scene = synthesizeFamilyScene({ question: probe.question }) ?? synthesizeLastResortScene({ question: probe.question });
      if (scene) {
        labels = scene.renderScene.primitives.filter((p) => (p.kind === "label" || p.kind === "dimension") && p.text).map((p) => p.text!);
        if (labels.length > 0) {
          family = scene.family;
          if (isChemistrySceneFamily(family)) drew += 1; else physics += 1;
          writeFileSync(`${outDir}/svg/${probe.id.replace(/[^a-z0-9]+/gi, "_")}.svg`, renderSceneSvg(scene.renderScene, { title: probe.question.slice(0, 110), subtitle: `family=${family} tier=${scene.tier}` }));
        }
      }
    } catch (caught) { error = (caught as Error).message; }
    rows.push(JSON.stringify({ id: probe.id, family, labels: labels.slice(0, 12), error, question: probe.question }));
  }
  perUnit.push({ unit: data.unitId, probes: data.questions.length, drew, physics });
}
writeFileSync(`${outDir}/rows.jsonl`, `${rows.join("\n")}\n`);
writeFileSync(`${outDir}/per-unit.json`, `${JSON.stringify(perUnit, null, 1)}\n`);
const total = perUnit.reduce((sum, row) => sum + row.probes, 0);
const drew = perUnit.reduce((sum, row) => sum + row.drew, 0);
const physics = perUnit.reduce((sum, row) => sum + row.physics, 0);
console.log(`probes ${total} drew chemistry figure ${drew} physics figure ${physics} errors ${rows.filter((row) => JSON.parse(row).error).length}`);
for (const row of perUnit) console.log(`  ${row.unit.padEnd(14)} probes ${String(row.probes).padStart(2)} drew ${String(row.drew).padStart(2)}${row.physics ? ` physics ${row.physics}` : ""}`);
