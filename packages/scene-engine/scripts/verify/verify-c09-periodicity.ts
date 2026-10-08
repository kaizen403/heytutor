/**
 * Periodicity through the live family path.
 * A claimed decline must not be replaced by another family's figure.
 */
import { PERIODIC_PROBES } from "../../src/chemistry/periodicTrend";
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
  check(drawn.family === "chem_periodic", `${id} family ${drawn.family}`);
  check(drawn.labels.includes(label), `${id} missing ${label}; got ${drawn.labels.join(" | ")}`);
}

function expectDecline(id: string, question: string): void {
  const drawn = labelsOf(question);
  check(drawn.family === null, `${id} fell through to ${drawn.family}: ${drawn.labels.join(" | ")}`);
}

expectDraw(
  "modern-law",
  "State the modern periodic law. Mendeleev ordered by atomic mass. The modern law orders by atomic number, not mass.",
  "not mass",
);
expectDraw(
  "helium",
  "Where is helium placed? Give its block, group, period, and configuration 1s2.",
  "block s",
);
expectDraw(
  "f-block",
  "An f-block element is not given a group number.",
  "f not group",
);
expectDraw(
  "chromium",
  "Chromium is written 4s1 3d5. Classify its block. Do not classify only by the last configuration term.",
  "Cr block d",
);
expectDraw(
  "ionic-radii",
  "Arrange the isoelectronic ions Na+, Mg2+ and Al3+ in order of ionic radius. State the radius convention and the nuclear-charge order.",
  "6-coord",
);
expectDraw(
  "ionisation-exceptions",
  "Explain the exceptions in the first ionisation enthalpy: beryllium versus boron, and nitrogen versus oxygen. The trend is not monotonic.",
  "Be>B",
);
expectDraw(
  "successive-ie",
  "The second ionisation enthalpy of Na is 4562 kJ/mol. Do not use the first ionisation enthalpy in its place.",
  "not IE1",
);
expectDraw(
  "gain-versus-en",
  "Although the electron-gain enthalpy of Cl is -349 kJ/mol and that of F is -328 kJ/mol, the Pauling electronegativity of F is 3.98 and that of Cl is 3.16. Distinguish electron-gain enthalpy from electronegativity.",
  "Cl more -",
);
expectDraw(
  "valence",
  "In NaCl, sodium has valence 1 and oxidation state +1. Oxidation state is not formal charge. Do not invent a reactivity.",
  "valence 1",
);

expectDecline(
  "mass-is-modern-law",
  "The modern periodic law is atomic mass order.",
);
expectDecline(
  "unknown-as-zero",
  "Set the Pauling electronegativity of helium to 0.",
);

const period3 = PERIODIC_PROBES.find((probe) => probe.question.startsWith("Plot the variation of first ionisation enthalpy across period 3"));
check(period3 !== undefined, "period 3 ionisation probe is still declared");
if (period3) {
  const drawn = labelsOf(period3.question);
  check(drawn.family === "chem_periodic", `period 3 probe family ${drawn.family}`);
  check(drawn.labels.includes("Be") === false, "period 3 probe should not be the beryllium exception board");
  check(drawn.labels.includes("Na"), `period 3 probe lost Na; got ${drawn.labels.join(" | ")}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c09-periodicity: ok");
