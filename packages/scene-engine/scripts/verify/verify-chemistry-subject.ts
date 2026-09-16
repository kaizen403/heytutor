/**
 * The subject test that keeps physics figures off chemistry stems.
 *
 * Two halves. Hand-written stems pin the decisions that were wrong on the
 * day the classifier was written ("emf of the cell" drew a resistor chain,
 * "compound microscope" read as chemistry, "V10" from an OCR'd root read as
 * vanadium). The local question bank then measures the classifier across
 * every readable row: chemistry rows must mostly read as chemistry, and
 * physics and maths rows must almost never.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chemistryEvidence, isAtomicTransitionStem, isChemistryStem, isGasProcessStem } from "../../src/chemistry/classify";
import { restrictFamiliesToChemistry, type SceneVisualFamily } from "../../src/synthesize/familyClassification";
import { formulaTokens } from "../../src/chemistry/formula";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const CHEMISTRY: string[] = [
  "For the reaction taking place in the cell Pt(s)|H2(g)|H+(aq)||Ag+(aq)|Ag(s), E°cell = 0.5332 V. The value of ΔrG° is kJ/mol",
  "The molecule/ion with square pyramidal shape is PF5, BrF5, PCl5, [Ni(CN)4]2-",
  "The electronic configuration of Cr is [Ar] 3d5 4s1. How many unpaired electrons?",
  "0.5 g of an organic compound on combustion gave 1.46 g of CO2 and 0.9 g of H2O. The percentage of carbon is",
  "r = k[A] for a reaction, 50% of A is decomposed in 120 minutes. The time taken for 90% decomposition is",
  "The enthalpy of combustion of methane is -890 kJ/mol. Find the heat released when 8 g burns.",
  "Which of the following has the highest first ionisation enthalpy: Na, Mg, Al, Si",
  "In a solid AB, A atoms are in ccp arrangement and B atoms occupy all the octahedral sites.",
  "The spin only magnetic moment of [Fe(CN)6]3- is",
  "The rate of reaction doubles when temperature rises by 10 K. Find the activation energy.",
  "Molar conductivity of NaCl at infinite dilution is",
  "Find the pH of 0.01 M HCl.",
  "The major product of the reaction of propene with HBr in the presence of peroxide is",
  "A solution of weak acid with its conjugate base is a buffer.",
  "One mole of an ideal gas expands isothermally and reversibly from 10 L to 20 L at 300 K. Calculate the work done and the entropy change.",
];

const NOT_CHEMISTRY: string[] = [
  "Two cells of emf 2 V and 4 V are connected in parallel across a 4 ohm resistor. Find the current.",
  "A ball is thrown at 20 m/s at 30 degrees. Find the range.",
  "A concave mirror of focal length 15 cm forms an image of an object at 20 cm.",
  "An ideal gas undergoes an adiabatic expansion; find the work done by the gas.",
  "A radioactive sample has a half-life of 10 days. Find the decay constant.",
  "The magnetic moment of a current loop of radius 2 cm carrying 3 A is",
  "Explain the objective and eyepiece stages of a compound microscope and an astronomical telescope with separate, ordered image planes.",
  "A compound pendulum of length 1 m oscillates. Find the period.",
  "Find the modulus of the complex number 3 + 4i and plot it on the Argand plane.",
  "Triangle ABC has vertices at B(0,0) and C(4,0). Find the length BC.",
  "Calculate the rms speed of molecules of an ideal gas at 300 K.",
  "A wire has thermal conductivity 400 W/mK. Find the heat flow.",
  "A body moves 12 m in the same direction as a 5 N force acting on it.",
  "A uniform rod is hinged at one end and makes 40 degrees with the horizontal. Find the hinge reaction.",
  "x2 y2 Let one focus of the hyperbola H: a = =1 beat (V10,0) and the corresponding a b directrix be x= a If e and l respectively are the eccentricity and the length of the latus rectum of H, then 9(e2 + 1) is equal to:",
  "A thin conducting spherical shell of radius R has charge Q spread uniformly over its surface. Using Gauss's law, derive an expression for an electric field at a point outside the shell. Draw a graph of electric field E(r) with distance r from the centre of the shell for 0 < r < ∞.",
  "Spontaneous emission of a photon occurs when",
  "Two point charges q1 and q2 are located at r1 and r2 in an external electric field E of 3 x 10^7 N/C. Obtain the potential energy of the system.",
];

for (const stem of CHEMISTRY) {
  assert(isChemistryStem(stem), `chemistry stem read as not chemistry: ${stem.slice(0, 80)} ${JSON.stringify(chemistryEvidence(stem))}`);
}
for (const stem of NOT_CHEMISTRY) {
  assert(!isChemistryStem(stem), `physics or maths stem read as chemistry: ${stem.slice(0, 80)} ${JSON.stringify(chemistryEvidence(stem))}`);
}

// Shared figures a chemistry stem keeps: the Bohr ladder and the P-V plot.
assert(isAtomicTransitionStem("Xa+ and Yb+ are hydrogen-like species. The wavelength of light absorbed during the transition between n = 1 and n = 2 of Xa+ is λ."), "hydrogen-like transition must read as an atomic transition");
assert(!isAtomicTransitionStem("The electronic configuration of Cr and the number of unpaired electrons in Fe3+"), "a configuration stem is not an atomic transition");
assert(isGasProcessStem("One mole of an ideal gas expands isothermally and reversibly from 10 L to 20 L."), "an isothermal expansion is a gas process");
const physicsFamilies: SceneVisualFamily[] = ["circuit_network", "point_field", "state_plot", "energy_level"];
assert(
  JSON.stringify(restrictFamiliesToChemistry("For the Daniell cell Zn|Zn2+||Cu2+|Cu find the emf of the cell", physicsFamilies)) === "[]",
  "a chemistry cell stem must not keep the circuit family",
);
assert(
  JSON.stringify(restrictFamiliesToChemistry("One mole of an ideal gas expands isothermally and reversibly; calculate the work done and the entropy change", physicsFamilies)) === JSON.stringify(["state_plot"]),
  "an isothermal chemistry stem keeps the P-V figure only",
);
assert(
  JSON.stringify(restrictFamiliesToChemistry("Two cells of emf 2 V are connected across a resistor", physicsFamilies)) === JSON.stringify(physicsFamilies),
  "a physics stem keeps every physics family",
);

// OCR guard on formula tokens. Each negative case once drew a confident,
// wrong structure on a bank stem: SO for SO2, IF for IF5, HNO for HNO3,
// C-I-F for ClF3, I2 for a roman numeral.
const OCR_CASES: Array<[string, string[]]> = [
  ["Among SO,, NF, NH, XeF,, CIF; and SF, the hybridization", []],
  ["the interhalogen IF, and IF, is", []],
  ["oxidation with concentrated HNO; resulted in", []],
  ["species XeF 4 and SF4", ["SF4"]],
  ["attached through H,CO to the ring", []],
  ["structures (IV) and (II)", []],
  ["regarding HCIO and HCI", []],
  ["(B) NO; (D) NO} Answer OC) (A)", []],
  ["CO, NO and HCl are gases", ["CO", "NO", "HCl"]],
  ["SO2, NF3 and NH3", ["SO2", "NF3", "NH3"]],
  ["carbon monoxide (CO) binds", ["CO"]],
];
for (const [text, expected] of OCR_CASES) {
  const found = formulaTokens(text).map((token) => token.replace(/^\((.*)\)$/, "$1"));
  if (expected.length === 0) assert(found.length === 0, `OCR guard let ${JSON.stringify(found)} through in "${text}"`);
  for (const token of expected) assert(found.includes(token), `OCR guard dropped a clean ${token} in "${text}" (kept ${JSON.stringify(found)})`);
}

// Bank-level measurement.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../../..");
const questionsPath = join(root, "data/question-bank/build/questions.all.jsonl");
const syllabusPath = join(root, "data/question-bank/build/question-syllabus.jsonl");
if (existsSync(questionsPath) && existsSync(syllabusPath)) {
  const subjectById = new Map<string, string>();
  for (const line of readFileSync(syllabusPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { question_id: string; subject?: string | null };
    if (row.subject) subjectById.set(row.question_id, row.subject);
  }
  const counts = { Chemistry: { total: 0, chemistry: 0 }, Physics: { total: 0, chemistry: 0 }, Mathematics: { total: 0, chemistry: 0 } };
  const leaks: string[] = [];
  for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { question_id: string; text?: string };
    const subject = subjectById.get(row.question_id) as keyof typeof counts | undefined;
    const text = row.text ?? "";
    if (!subject || !(subject in counts) || text.length < 40) continue;
    const words = text.match(/[A-Za-z]{3,}/g) ?? [];
    const letters = (text.match(/[A-Za-z]/g) ?? []).length;
    if (words.length < 8 || letters / text.length < 0.45) continue;
    counts[subject].total += 1;
    if (isChemistryStem(text)) {
      counts[subject].chemistry += 1;
      if (subject !== "Chemistry" && leaks.length < 12) leaks.push(`${subject}: ${text.slice(0, 90).replace(/\s+/g, " ")} ${JSON.stringify(chemistryEvidence(text))}`);
    }
  }
  const rate = (row: { total: number; chemistry: number }) => (row.total ? row.chemistry / row.total : 0);
  console.log(`  bank: chemistry ${counts.Chemistry.chemistry}/${counts.Chemistry.total} (${(rate(counts.Chemistry) * 100).toFixed(1)}%), physics leaks ${counts.Physics.chemistry}/${counts.Physics.total} (${(rate(counts.Physics) * 100).toFixed(2)}%), maths leaks ${counts.Mathematics.chemistry}/${counts.Mathematics.total} (${(rate(counts.Mathematics) * 100).toFixed(2)}%)`);
  for (const leak of leaks) console.log(`    leak ${leak}`);
  // The bank's subject labels come from paper section headings and are
  // noisy: rows labelled Chemistry include triangles and matrices, and rows
  // labelled Physics include sodium chromate and glycosidic linkages. The
  // thresholds are therefore loose; the hand-written stems above are exact.
  assert(counts.Chemistry.total === 0 || rate(counts.Chemistry) >= 0.75, "fewer than 75% of readable chemistry bank rows read as chemistry");
  assert(rate(counts.Physics) <= 0.1, "more than 10% of readable physics bank rows read as chemistry");
  assert(rate(counts.Mathematics) <= 0.05, "more than 5% of readable maths bank rows read as chemistry");
} else {
  console.log("  bank corpus absent; hand-written stems only");
}

console.log(`verify-chemistry-subject: ok (${CHEMISTRY.length} chemistry, ${NOT_CHEMISTRY.length} not chemistry)`);
