import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compileKit, kitDocument, texts } from "./chemistryKitGate";
import type { SceneDocument } from "../../src/types";

const rows = new Map<string, { question: string }>(readFileSync(resolve(process.cwd(), "../../data/diagram-eval/v1/chemistry.jsonl"), "utf8").trim().split("\n").map((line) => {
  const row = JSON.parse(line) as { id: string; question: string };
  return [row.id, row];
}));
function question(id: string): string {
  const row = rows.get(`chemistry|${id}`);
  assert.ok(row, `real input ${id} must exist in chemistry.jsonl`);
  return row.question;
}
function panel(id: string, smiles: string[]): void {
  const scene = compileKit(kitDocument(question(id), "chem_skeletal_molecule", {
    molecules: smiles.map((smiles) => ({ smiles })), layout: "comparison",
  }));
  assert.equal(scene.primitives.filter((p) => p.kind === "rectangle" && p.entityId.endsWith("_panel")).length, smiles.length);
}

// Source-derived graph inputs for every wanted row that previously recorded
// invalid_chemistry_kit_input. These are oracles, never runtime lookup data.
panel("10|group-16-oxygen-family|q2", ["OOS(=O)(=O)O", "OS(=O)(=O)O"]);
panel("10|group-16-oxygen-family|q3", ["OS(=O)(=O)O"]);
panel("14|structural-and-stereoisomerism|q2", ["CC1=CCCCC1"]);
panel("15|classification-nomenclature-and-preparation-of-hydrocarbons|q2", ["CCC(Br)(C1CCCC1)CCC"]);
panel("15|ozonolysis-and-polymerisation-of-alkenes|q2", ["CC(C)=C(C)C", "CC(=O)C"]);
panel("16|preparation-and-nature-of-c-x-bond|q2", ["CCCCBr", "CCCCI", "Brc1ccccc1"]);
panel("17|alcohols-identification-and-dehydration|q1", ["CCCO", "CC(O)C", "CC(C)(C)O"]);
panel("17|alpha-hydrogen-aldol-cannizzaro-and-haloform|q1", ["CCC(=O)Cc1ccccc1", "CCC(C)(O)C", "CC(O)C(C)C"]);
panel("17|alpha-hydrogen-aldol-cannizzaro-and-haloform|q1", ["CC(O)c1ccccc1", "CC(=O)C(C)(C)C", "CC(O)Cc1ccccc1"]);
panel("17|ethers-structure-and-reactions|q3", ["COc1ccccc1", "Oc1ccccc1", "CI"]);
panel("17|preparation-of-aldehydes-and-ketones|q2", ["O=C(Cl)c1ccccc1", "O=Cc1ccccc1", "OCc1ccccc1"]);
panel("18|basic-character-of-amines|q1", ["N", "CN", "CNC", "CN(C)C"]);
panel("18|preparation-of-amines|q1", ["O=C1NC(=O)c2ccccc12", "NC(=O)c1ccccc1", "Nc1ccccc1"]);
panel("19|amino-acids-and-peptides|q2", ["NCC(=O)NC(C)C(=O)NC(C(C)C)C(=O)O"]);
panel("3|bond-parameters-sigma-and-pi-bonds|q2", ["C=C", "C#C"]);

const six = kitDocument(question("17|alpha-hydrogen-aldol-cannizzaro-and-haloform|q1"), "chem_skeletal_molecule", { molecules: ["CCC(=O)Cc1ccccc1", "CCC(C)(O)C", "CC(O)C(C)C"].map((smiles) => ({ smiles })) });
six.entities.push({ id: "second", kind: "group", role: "remaining comparison structures" });
six.constructions.push({ id: "make_second", operator: "chem_skeletal_molecule", inputs: { molecules: ["CC(O)c1ccccc1", "CC(=O)C(C)(C)C", "CC(O)Cc1ccccc1"].map((smiles) => ({ smiles })) }, outputs: ["second"] });
six.requiredEntityIds.push("second");
six.revealGroups[0]!.entityIds.push("second");
compileKit(six);

// Several existing kits in one document must not occupy the same origin.
const xenon = kitDocument(question("10|group-18-noble-gases|q3"), "chem_vsepr_shape", { formula: "XeF2" });
for (const [index, formula] of ["XeF4", "XeF6"].entries()) {
  const id = `xenon${index}`;
  xenon.entities.push({ id, kind: "group", role: "xenon fluoride" });
  xenon.constructions.push({ id: `make_${id}`, operator: "chem_vsepr_shape", inputs: { formula }, outputs: [id] });
  xenon.requiredEntityIds.push(id);
  xenon.revealGroups[0]!.entityIds.push(id);
}
const shapes = compileKit(xenon);
for (const label of ["XeF_2", "XeF_4", "XeF_6", "linear", "sq. planar", "dist. octahedral"]) assert.ok(texts(shapes).includes(label), `missing ${label}`);

// Nonzero resonance and expanded-octet inputs expose proof-count regressions.
compileKit(kitDocument("Draw sulphuric acid", "chem_lewis_structure", { formula: "H2SO4" }));
compileKit(kitDocument("Draw nitrate resonance forms", "chem_lewis_structure", { formula: "NO3", charge: -1, resonance: true }));

const exemplarRoot = resolve(process.cwd(), "../../data/diagram-eval/v1/exemplars/chemistry");
const panelExamples = readdirSync(exemplarRoot).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(readFileSync(resolve(exemplarRoot, file), "utf8")) as { question: string; sceneDocument: SceneDocument }).filter((example) => example.sceneDocument.constructions.some((construction) => construction.operator === "chem_skeletal_molecule" && Array.isArray(construction.inputs.molecules)));
assert.ok(panelExamples.length >= 4, "planner library needs at least four panel examples");
for (const layout of ["comparison", "reaction"]) assert.ok(panelExamples.filter((example) => example.sceneDocument.constructions.some((construction) => construction.inputs.layout === layout)).length >= 2, `need two ${layout} panels`);
for (const example of panelExamples) {
  assert.equal([...rows.values()].some((row) => row.question.trim().toLowerCase() === example.question.trim().toLowerCase()), false, "panel exemplars must not be evaluation rows");
  const scene = compileKit(example.sceneDocument);
  for (const construction of example.sceneDocument.constructions) {
    if (construction.operator !== "chem_skeletal_molecule") continue;
    const labelledInputs = [...(construction.inputs.molecules as Array<{ label?: string }>), ...((construction.inputs.arrows ?? []) as Array<{ label?: string }>)];
    for (const input of labelledInputs) {
      if (input.label) assert.ok(texts(scene).join("").replace(/\s+/g, "").includes(input.label.replace(/\s+/g, "")), `panel must preserve the complete label: ${input.label}`);
    }
  }
}
console.log("verify-chemistry-kit-fit: all 15 failed-row source inputs, panels, xenon composition and Lewis proofs pass");
