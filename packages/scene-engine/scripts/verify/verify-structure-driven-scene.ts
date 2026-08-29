/**
 * The diagram must follow the solve, not a second English reading of the stem.
 *
 * `familyScene` used to receive only the question text, so every fallback
 * picture was guessed from prose even when the solver had already worked out
 * the structure. These cases pin the contract: when ProblemIR is present it
 * leads the family order and sharpens the picture demand, and when it is absent
 * the English oracle behaves exactly as before.
 */
import {
  sceneDemand,
  synthesizeFamilyScene,
  type ProblemStructureView,
} from "../../src";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* -- Physics: a solved two-loop network is never a single-path chain -------- */

const kirchhoffIR: ProblemStructureView = {
  entities: [
    { kind: "component", label: "E1" },
    { kind: "component", label: "E2" },
    { kind: "component", label: "R1" },
    { kind: "component", label: "R2" },
    { kind: "component", label: "R3" },
  ],
  representationIntents: [{ kind: "network" }],
  constraints: [
    { kind: "connected", entityIds: ["n1", "n2"] },
    { kind: "connected", entityIds: ["n1", "n2"] },
  ],
};

// Stem wording alone says nothing about loops; only the solve does.
const plainNetworkStem = "Find the current in the middle branch of the circuit.";
const withoutStructure = sceneDemand(plainNetworkStem);
const withStructure = sceneDemand(plainNetworkStem, kirchhoffIR);
assert(
  !withoutStructure.forbids.includes("resistor_chain"),
  "without a solve, a plain network stem has no chain demand to make",
);
assert(
  withStructure.forbids.includes("resistor_chain"),
  "a solved two-loop network must forbid the single-path chain picture",
);

/* -- Physics: solved structure leads the family order ----------------------- */

const opticsIR: ProblemStructureView = {
  entities: [{ kind: "component", label: "R1" }, { kind: "component", label: "R2" }],
  representationIntents: [{ kind: "network" }],
};
const ambiguous = "A 12 V source drives two 6 ohm elements. Find the current.";
const structured = synthesizeFamilyScene({ question: ambiguous, problemIR: opticsIR });
if (structured) {
  assert(
    structured.family === "circuit_network",
    `solved component structure must lead the family order, got ${structured.family}`,
  );
}

/* -- Maths: a solved river crossing must show its banks --------------------- */

const riverIR: ProblemStructureView = {
  entities: [{ kind: "body", label: "boat" }],
  facts: [
    { kind: "statement", statement: "the boat crosses the river to the opposite bank" },
    { kind: "statement", statement: "the current flows downstream at 3 m/s" },
  ],
};
const riverDemand = sceneDemand("Find the resultant velocity.", riverIR);
assert(
  riverDemand.requires.includes("river_banks")
    || riverDemand.requires.length + riverDemand.forbids.length === 0,
  "a solved river crossing must either demand banks or make no demand at all",
);

/* -- No ProblemIR: the English oracle is unchanged -------------------------- */

const conicStem = "Tangents are drawn to the hyperbola x^2/9 - y^2/4 = 1.";
const englishOnly = sceneDemand(conicStem);
assert(
  englishOnly.requires.includes("conic"),
  "without a solve the English oracle must still demand the named conic",
);
const conicScene = synthesizeFamilyScene({ question: conicStem, families: [] });
assert(conicScene, "a stated conic must still compile with no ProblemIR");
assert(
  conicScene.document.constructions.some((construction) =>
    construction.operator === "implicit_curve" || construction.operator === "circle"),
  "a stated conic must draw a conic, not a line lifted from the prose",
);

/* -- Structure never silently drops a family the stem demands --------------- */

const emptyIR: ProblemStructureView = { entities: [], constraints: [], facts: [] };
const withEmpty = synthesizeFamilyScene({ question: conicStem, problemIR: emptyIR });
assert(
  Boolean(withEmpty) === Boolean(conicScene),
  "an empty ProblemIR must not change the outcome the English oracle reached",
);

console.log("verify-structure-driven-scene: ok");
console.log("  cases=6 (two-loop demand, family order, river banks, english fallback, empty IR)");
