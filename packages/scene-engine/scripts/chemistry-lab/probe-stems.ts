/** Print subject evidence and the family path result for stems in a JSON array file. */
import { readFileSync } from "node:fs";
import { chemistryEvidence, isChemistryStem } from "../../src/chemistry/classify";
import { inferChemistryFamilies } from "../../src/chemistry";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";

const file = process.argv[2];
if (!file) throw new Error("usage: probe-stems.ts <stems.json>");
const rows = JSON.parse(readFileSync(file, "utf8")) as string[];
for (const question of rows) {
  const scene = synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
  const labels = scene?.renderScene.primitives.filter((p) => p.kind === "label" && p.text).map((p) => p.text).join(", ") ?? "";
  console.log(
    `${isChemistryStem(question) ? "CHEM" : "    "} ${JSON.stringify(inferChemistryFamilies(question))} ${JSON.stringify(chemistryEvidence(question))} -> ${scene ? `${scene.family} [${scene.tier}] labels=${labels}` : "NONE"} :: ${question.slice(0, 70).replace(/\s+/g, " ")}`,
  );
}
