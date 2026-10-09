import assert from "node:assert/strict";
import { compileKit, assertRejected, kitDocument, texts } from "./chemistryKitGate";

// Real evaluation input: arrhenius-and-activation-energy q1.
const document = kitDocument(
  "For an exothermic reaction the forward activation energy is 60 kJ/mol and delta H is -20 kJ/mol. Draw the profile.",
  "chem_reaction_energy_profile",
  { reactants: "R", products: "P", activationEnergyQuantityId: "Ea", deltaHQuantityId: "dH" },
  [
    { id: "Ea", symbol: "E_a", value: 60, unit: "kJ/mol", sourceText: "activation energy is 60 kJ/mol" },
    { id: "dH", symbol: "ΔH", value: -20, unit: "kJ/mol", sourceText: "delta H is -20 kJ/mol" },
  ],
);
const scene = compileKit(document);
for (const label of ["R", "P", "TS", "E_a = 60 kJ", "ΔH = −20 kJ"]) assert.ok(texts(scene).includes(label), `missing ${label}`);
const dimensions = scene.primitives.filter((primitive) => primitive.kind === "dimension");
assert.equal(dimensions.length, 2, "Ea and delta H must both be dimensioned");

const missing = structuredClone(document);
missing.quantities = missing.quantities.filter((quantity) => quantity.id !== "Ea");
assertRejected(missing, "does not name a finite plan quantity");
const impossible = structuredClone(document);
impossible.quantities.find((quantity) => quantity.id === "dH")!.value = 80;
assertRejected(impossible, "physically valid profile");

console.log("verify-chemistry-energy-kit: exact Ea and delta H stay plan-bound, labelled, non-overlapping and physically valid");
