/**
 * Chemical kinetics through the live family path.
 * A claimed decline must not be replaced by another family's figure.
 */
import { KINETICS_PROBES } from "../../src/chemistry/kinetics";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

function labelsOf(question: string): { family: string | null; labels: string[] } {
  const scene = synthesizeFamilyScene({ question });
  if (!scene) return { family: null, labels: [] };
  const labels = scene.renderScene.primitives.flatMap((primitive) =>
    primitive.kind === "label" && primitive.text ? [primitive.text] : [],
  );
  return { family: scene.family, labels };
}

function expectDraw(id: string, question: string, label: string): void {
  const drawn = labelsOf(question);
  check(drawn.family === "chem_kinetics", `${id} family ${drawn.family}`);
  check(drawn.labels.includes(label), `${id} missing ${label}; got ${drawn.labels.join(" | ")}`);
}

function expectDecline(id: string, question: string): void {
  const drawn = labelsOf(question);
  check(drawn.family === null, `${id} fell through to ${drawn.family}: ${drawn.labels.join(" | ")}`);
}

expectDraw(
  "rate-of-reaction",
  "For the reaction 2 n2o5 -> 4 no2 + o2, d[no2]/dt = 4.0e-3 mol/L/s. Find the reaction rate. The reaction rate is not the species derivative.",
  "v=1.0e-3",
);
expectDraw(
  "rate-factor",
  "Raising the temperature increases the rate of a reaction of positive order. The figure is schematic.",
  "schematic",
);
expectDraw(
  "rate-law-order",
  "When [A] is doubled, the initial rate doubles. When [B] is doubled, the rate becomes 4 times. The rate is in mol/L/s. Find the order in A, the order in B, and the units of the rate constant k.",
  "L2/mol2 s",
);
expectDraw(
  "molecularity",
  "One elementary step a + b -> products is bimolecular, so the molecularity is 2. The order of the reaction is 1.5, which is not a molecularity.",
  "order=1.5",
);
expectDraw(
  "zero-order-cutoff",
  "A zero-order reaction has [A]0 = 0.50 mol/L and k = 0.10 mol/L/s. Find [A] at t = 2.0 s and the half-life. Stop at exhaustion. Do not draw a negative concentration.",
  "[A]=0.3",
);
expectDraw(
  "half-life-formulas",
  "Compare the half-lives. For a zero-order reaction t_half = [A]0/(2k). For a first-order reaction t_half = ln2/k. Do not use the first-order half-life for zero order.",
  "not the same",
);
expectDraw(
  "arrhenius",
  "Find the activation energy when the rate constant triples from 290 K to 300 K. R = 8.314 J/mol/K. Plot ln k versus 1/T.",
  "basis ln",
);
expectDraw(
  "collision",
  "Collision theory for bimolecular gases A and B needs both partners, a favourable orientation, and a threshold energy. Not every collision reacts. Do not calculate a rate.",
  "not all react",
);

expectDecline(
  "copied-order",
  "The reaction 2 n2o5 -> 4 no2 + o2 has order 2 because the coefficient is 2. State the order from the equation.",
);
expectDecline(
  "negative-concentration",
  "For this zero-order reaction continue the plot to a negative concentration. [A]0 = 0.50 mol/L and k = 0.10 mol/L/s.",
);
expectDecline(
  "celsius",
  "Find the activation energy from 25 celsius to 35 celsius if the rate constant triples. Plot ln k versus 1/T.",
);

const doubling = KINETICS_PROBES.find((probe) => probe.labels?.includes("E_a=53.6 kJ/mol"));
check(doubling !== undefined, "300 K to 310 K probe is still declared");
if (doubling) {
  const drawn = labelsOf(doubling.question);
  check(drawn.family === "chem_kinetics", `doubling probe family ${drawn.family}`);
  check(drawn.labels.includes("E_a=53.6 kJ/mol"), `doubling probe lost E_a=53.6; got ${drawn.labels.join(" | ")}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c08-kinetics: ok");
