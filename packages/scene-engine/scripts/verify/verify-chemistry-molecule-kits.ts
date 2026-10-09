import assert from "node:assert/strict";
import { compileKit, assertRejected, kitDocument, texts } from "./chemistryKitGate";

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

assertRejected(kitDocument("Draw it", "chem_skeletal_molecule", { name: "not-a-resolvable-molecule" }), "cannot produce a verified skeletal structure");
assertRejected(kitDocument("Draw it", "chem_lewis_structure", { formula: "FeCl3", charge: 0 }), "cannot produce a verified Lewis structure");
assertRejected(kitDocument("Draw it", "chem_vsepr_shape", { formula: "C2H4", charge: 0 }), "cannot produce a verified VSEPR shape");

console.log("verify-chemistry-molecule-kits: skeletal, Lewis and VSEPR facts compile with exact bonds, lone pairs, labels and clear failure messages");
