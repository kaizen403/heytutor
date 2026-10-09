import assert from "node:assert/strict";
import { compileKit, assertRejected, kitDocument, texts } from "./chemistryKitGate";

// Real evaluation input: electronic-configuration-and-filling-rules q1.
const scene = compileKit(kitDocument(
  "Write the ground state electronic configurations of Cr (Z = 24) and Cu (Z = 29), and show their unpaired electrons.",
  "chem_orbital_boxes",
  { species: [{ atomicNumber: 24, charge: 0 }, { atomicNumber: 29, charge: 0 }], showMagneticMoment: true },
));
for (const label of ["Cr", "Cu", "[Ar] 3d^5 4s^1", "[Ar] 3d^10 4s^1", "6 unpaired", "1 unpaired"]) {
  assert.ok(texts(scene).includes(label), `missing ${label}`);
}
assert.equal(scene.primitives.filter((primitive) => primitive.entityId.includes("_b") && primitive.kind === "rectangle").length, 12, "Cr and Cu need six valence boxes each");
assert.equal(scene.primitives.filter((primitive) => primitive.entityId.includes("_e") && primitive.kind === "vector").length, 17, "Cr and Cu need 17 displayed valence electrons");

assertRejected(kitDocument("Draw boxes", "chem_orbital_boxes", { species: [{ atomicNumber: 0, charge: 0 }], showMagneticMoment: false }), "atomicNumber must be an integer from 1 to 118");
assertRejected(kitDocument("Draw boxes", "chem_orbital_boxes", { species: [{ atomicNumber: 24 }], showMagneticMoment: false }), "charge must be an integer from -4 to 4");

console.log("verify-chemistry-orbital-kit: Cr and Cu exceptions compile to exact Hund-filled boxes with readable labels and strict inputs");
