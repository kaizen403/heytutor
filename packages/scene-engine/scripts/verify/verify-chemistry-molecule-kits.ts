import assert from "node:assert/strict";
import { compileKit, assertRejected, kitDocument, texts } from "./chemistryKitGate";
import { parseSmiles, molecularFormula } from "../../src/chemistry/organic/smiles";

// Real evaluation inputs: alcohols q1, bonding q1 and VSEPR q2.
const skeletal = compileKit(kitDocument(
  "Draw the structure of 2-methylpropan-2-ol and label the carbon bearing the OH group.",
  "chem_skeletal_molecule",
  { name: "2-methylpropan-2-ol" },
));
assert.ok(texts(skeletal).includes("C_4H_10O"));
assert.equal(skeletal.primitives.filter((primitive) => primitive.entityId.includes("__m0_b") && primitive.kind === "line").length >= 4, true, "skeletal graph needs its C-C and C-O bonds");

const lewis = compileKit(kitDocument(
  "Draw the Lewis structure of CO2 and use it to count sigma and pi bonds.",
  "chem_lewis_structure",
  { formula: "CO2", charge: 0, resonance: false },
));
assert.ok(texts(lewis).includes("CO_2"));
assert.equal(lewis.primitives.filter((primitive) => primitive.entityId.includes("__s1_b_") && primitive.kind === "line").length, 4, "CO2 needs two double bonds");
assert.equal(lewis.primitives.filter((primitive) => primitive.entityId.includes("__s1_lp_") && primitive.kind === "point").length, 8, "CO2 needs four lone pairs");

const vsepr = compileKit(kitDocument(
  "For SF4, state the VSEPR class, molecular shape and number of lone pairs on sulfur.",
  "chem_vsepr_shape",
  { formula: "SF4", charge: 0 },
));
for (const label of ["SF_4", "sp^3d", "see-saw", "e: TBP"]) assert.ok(texts(vsepr).includes(label), `missing ${label}`);
assert.equal(vsepr.primitives.filter((primitive) => primitive.entityId.includes("__m1_lp") && primitive.kind === "point").length, 2, "SF4 needs one central lone pair");

assertRejected(kitDocument("Draw it", "chem_skeletal_molecule", { name: "not-a-resolvable-molecule" }), "send SMILES");
assertRejected(kitDocument("Draw it", "chem_lewis_structure", { formula: "FeCl3", charge: 0 }), "cannot produce a verified Lewis structure");
assertRejected(kitDocument("Draw it", "chem_vsepr_shape", { formula: "C2H4", charge: 0 }), "cannot produce a verified VSEPR shape");

// SMILES is a fully consumed graph, not a permissive token scanner. Never
// silently accept broken syntax, impossible valence or ignored stereochemistry.
for (const invalid of ["C=", "=CC", "C()C", "C(=)C", "C==C", "C11", "C1C1", "C=1CCCCC-1", "C(C)(C)(C)(C)C", "[NH5+]", "[CH99]", "cC", "[13CH4]", "N[C@@H](C)C(=O)O"]) {
  assert.equal(parseSmiles(invalid), null, `must reject unsupported/invalid SMILES ${invalid}`);
}
assert.equal(molecularFormula(parseSmiles("OS(=O)(=O)O")!, false), "H2O4S", "normal expanded sulfur valence must not be rejected");
assert.equal(molecularFormula(parseSmiles("OOS(=O)(=O)O")!, false), "H2O5S");

// Real chemistry.jsonl inputs: every bond stroke must survive kit proofs,
// including triple bonds, aromatic rings and collapsed functional groups.
for (const smiles of ["C=C", "C#C", "Brc1ccccc1", "COc1ccccc1", "O=[N+]([O-])c1ccccc1", "N", "NC(=O)c1ccccc1"]) {
  compileKit(kitDocument("Compare the stated molecular structures.", "chem_skeletal_molecule", { smiles }));
}

const comparison = compileKit(kitDocument(
  "How many sigma and pi bonds are in ethene and in ethyne? Which molecule has the shorter carbon-carbon bond, and why?",
  "chem_skeletal_molecule", { molecules: [{ smiles: "C=C", label: "ethene" }, { smiles: "C#C", label: "ethyne" }], layout: "comparison" },
));
assert.ok(texts(comparison).includes("ethene") && texts(comparison).includes("ethyne"));
assert.equal(comparison.primitives.filter((p) => p.kind === "line" && /__m[01]_b/.test(p.entityId)).length, 5);
const reaction = compileKit(kitDocument(
  "An alkene consumes one mole of ozone and gives only propanone. What is the structure of the alkene?",
  "chem_skeletal_molecule", { molecules: [{ smiles: "CC(C)=C(C)C" }, { smiles: "CC(=O)C", label: "2 propanone" }], layout: "reaction", arrows: [{ from: 0, to: 1, label: "O3 / Zn, H2O" }] },
));
assert.ok(texts(reaction).includes("O3 / Zn, H2O"));
assert.equal(reaction.primitives.filter((p) => p.kind === "vector" && p.entityId.includes("reaction_arrow")).length, 1);
const branching = compileKit(kitDocument("cleavage of anisole with HI", "chem_skeletal_molecule", {
  molecules: [{ smiles: "COc1ccccc1", label: "anisole" }, { smiles: "Oc1ccccc1", label: "phenol" }, { smiles: "CI", label: "methyl iodide" }],
  layout: "reaction", arrows: [{ from: 0, to: 1, label: "HI" }, { from: 0, to: 2 }],
}));
assert.equal(branching.primitives.filter((p) => p.kind === "vector" && p.entityId.includes("reaction_arrow")).length, 2);
assertRejected(kitDocument("Draw panel", "chem_skeletal_molecule", { molecules: Array.from({ length: 5 }, () => ({ smiles: "C" })) }), "one to four");
assertRejected(kitDocument("Draw reaction", "chem_skeletal_molecule", { molecules: [{ smiles: "C" }, { smiles: "CC" }], layout: "reaction", arrows: [{ from: 0, to: 2 }] }), "arrow");

console.log("verify-chemistry-molecule-kits: skeletal, Lewis and VSEPR facts compile with exact bonds, lone pairs, labels and clear failure messages");
