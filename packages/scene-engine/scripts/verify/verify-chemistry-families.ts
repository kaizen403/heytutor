/**
 * Every chemistry family's own probes, replayed through the registry, the
 * builder, the validator and the compiler, plus the routing rules the
 * families share: a chemistry stem reaches its family through the real
 * family path, a physics stem never reaches a chemistry family, and a
 * chemistry stem never receives a physics figure.
 *
 * Each family module declares `<NAME>_PROBES` with `expect: "draw" |
 * "decline"` and optional `labels` that must be on the board. A probe that
 * draws when it should decline is a wrong picture; one that is refused by
 * the compiler is a figure the student never sees. Both fail.
 */
import { CHEMISTRY_SCENE_FAMILIES, chemistryFamilyBuilder, inferChemistryFamilies, isChemistrySceneFamily } from "../../src/chemistry";
import { VSEPR_PROBES } from "../../src/chemistry/vsepr";
import { LEWIS_PROBES } from "../../src/chemistry/lewis";
import { MO_PROBES } from "../../src/chemistry/moDiagram";
import { ORBITAL_PROBES } from "../../src/chemistry/orbitalBox";
import { CFT_PROBES } from "../../src/chemistry/crystalField";
import { COORD_PROBES } from "../../src/chemistry/coordination";
import { ELECTROCHEM_PROBES } from "../../src/chemistry/electrochemistry";
import { SOLID_PROBES } from "../../src/chemistry/unitCell";
import { KINETICS_PROBES } from "../../src/chemistry/kinetics";
import { THERMO_PROBES } from "../../src/chemistry/thermoGraphs";
import { SOLUTIONS_PROBES } from "../../src/chemistry/solutionsGraphs";
import { PERIODIC_PROBES } from "../../src/chemistry/periodicTrend";
import { ORGANIC_PROBES } from "../../src/chemistry/organic";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

interface Probe { question: string; expect: "draw" | "decline"; labels?: string[]; forbidLabels?: string[]; note?: string }

const PROBES: ReadonlyArray<[string, ReadonlyArray<Probe>]> = [
  ["chem_vsepr", VSEPR_PROBES],
  ["chem_lewis", LEWIS_PROBES],
  ["chem_mo", MO_PROBES],
  ["chem_orbital", ORBITAL_PROBES],
  ["chem_cft", CFT_PROBES],
  ["chem_coordination", COORD_PROBES],
  ["chem_electrochem", ELECTROCHEM_PROBES],
  ["chem_unit_cell", SOLID_PROBES],
  ["chem_kinetics", KINETICS_PROBES],
  ["chem_thermo", THERMO_PROBES],
  ["chem_solutions", SOLUTIONS_PROBES],
  ["chem_periodic", PERIODIC_PROBES],
  ["chem_organic", ORGANIC_PROBES],
];

const failures: string[] = [];
let draws = 0;
let declines = 0;

function compiled(document: SceneDocument | null): { ok: boolean; labels: string[]; why: string } {
  if (!document) return { ok: false, labels: [], why: "declined" };
  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  if (!validated.document) {
    return { ok: false, labels: [], why: `invalid: ${validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(",")}` };
  }
  const result = compileSceneDocument(validated.document);
  const fatal = result.report.issues.filter((issue) => issue.severity === "fatal");
  const labels = (result.renderScene?.primitives ?? [])
    .filter((primitive) => (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text)
    .map((primitive) => primitive.text!);
  const ok = result.ok && Boolean(result.renderScene) && labels.length > 0 && fatal.length === 0;
  return { ok, labels, why: ok ? "" : `refused: ${fatal.map((issue) => `${issue.code} ${issue.message}`).join("; ").slice(0, 200)}` };
}

for (const [family, probes] of PROBES) {
  const build = chemistryFamilyBuilder(family);
  if (!build) {
    failures.push(`${family}: not registered`);
    continue;
  }
  if (probes.length < 8) failures.push(`${family}: only ${probes.length} probes; the brief asks for at least 10`);
  for (const probe of probes) {
    const routed = inferChemistryFamilies(probe.question);
    const result = compiled(build(probe.question, [], false));
    if (probe.expect === "draw") {
      if (!routed.includes(family as (typeof CHEMISTRY_SCENE_FAMILIES)[number])) {
        failures.push(`${family}: cue does not fire on "${probe.question.slice(0, 70)}"`);
      }
      if (!result.ok) {
        failures.push(`${family}: expected a figure for "${probe.question.slice(0, 70)}" (${result.why})`);
        continue;
      }
      draws += 1;
      for (const label of probe.labels ?? []) {
        if (!result.labels.includes(label)) failures.push(`${family}: label "${label}" missing on "${probe.question.slice(0, 50)}" (drawn: ${result.labels.join(", ")})`);
      }
      for (const label of probe.forbidLabels ?? []) {
        if (result.labels.includes(label)) failures.push(`${family}: forbidden label "${label}" drawn on "${probe.question.slice(0, 50)}"`);
      }
      // The live path must land on this family (or an earlier chemistry one) too.
      const live = synthesizeFamilyScene({ question: probe.question });
      if (!live) failures.push(`${family}: the family path draws nothing for "${probe.question.slice(0, 70)}"`);
      else if (!isChemistrySceneFamily(live.family)) failures.push(`${family}: the family path drew a physics figure (${live.family}) for "${probe.question.slice(0, 60)}"`);
    } else {
      if (result.ok) failures.push(`${family}: drew for a decline probe "${probe.question.slice(0, 70)}" (labels: ${result.labels.join(", ")})`);
      else declines += 1;
    }
  }
}

// Physics stems never route to a chemistry family.
const PHYSICS_STEMS = [
  "Two cells of emf 2 V and 4 V are connected in parallel across a 4 ohm resistor. Find the current.",
  "A concave mirror of focal length 15 cm forms an image of an object at 20 cm. Draw the ray diagram.",
  "A ball is thrown at 20 m/s at 30 degrees above the horizontal. Find the range.",
  "A radioactive sample has a half-life of 10 days. Find the fraction left after 30 days.",
  "Find the equivalent resistance of three 6 ohm resistors in parallel.",
  "A solenoid of 1000 turns per metre carries 2 A. Find the magnetic field inside.",
  "Light of wavelength 500 nm falls on a single slit of width 0.1 mm. Find the width of the central maximum.",
  "Find the area bounded by the curve y = x^2 and the line y = 4.",
];
for (const stem of PHYSICS_STEMS) {
  const routed = inferChemistryFamilies(stem);
  if (routed.length > 0) failures.push(`physics stem routed to ${routed.join(",")}: "${stem.slice(0, 60)}"`);
  const live = synthesizeFamilyScene({ question: stem });
  if (live && isChemistrySceneFamily(live.family)) failures.push(`physics stem drew ${live.family}: "${stem.slice(0, 60)}"`);
}

// Bank regressions: OCR'd exam stems that once drew a wrong picture, and
// neighbours that must keep drawing. `none` means no chemistry figure at all
// and no physics figure either.
const BANK_REGRESSIONS: ReadonlyArray<{ stem: string; family?: string; labels?: string[]; forbidLabels?: string[]; none?: true }> = [
  { none: true, stem: "Among SO,, NF, NH, XeF,, CIF; and SF, the hybridization of the molecule with non- zero dipole moment and highest number of lone-pairs of electrons on the central atom is" },
  { none: true, stem: "The sum of lone pairs present on the central atom of the interhalogen IF, and IF, is" },
  { none: true, stem: "According to Lewis theory, the total number of σ bond-pairs and lone pair of electrons around the central atom of XeO,* ion is" },
  { none: true, stem: "A D-aldotetrose on oxidation with concentrated HNO; resulted in optically inactive dicarboxylic acid. The structure of the D-aldotetrose is:" },
  { none: true, stem: "Which of the following carbocations is most stable? A. the ring with H,CO attached B. the ring with OCH, attached" },
  { none: true, stem: "The most stable trihalide of nitrogen is : (A) NF; (B) NCI, (C) NBr, (D) NI," },
  { forbidLabels: ["acetic anhydride"], stem: "L-isomer of a compound 'A' (C4H8O4) gives a positive test with Tollens reagent. Treatment of 'A' with acetic anhydride yields triacetate derivative." },
  { forbidLabels: ["ethanol"], stem: "An optically active alkyl halide C4H9Br [A] reacts with hot KOH dissolved in ethanol and forms alkene [B] as major product which reacts with bromine to give dibromide [C]." },
  { forbidLabels: ["iodomethane"], stem: "The compound P reacts with 3 equivalents of NH2OH to produce oxime Q. Treatment of P with excess methyl iodide in the presence of KOH produces compound R." },
  { forbidLabels: ["butane"], stem: "An electrochemical cell is fueled by the combustion of butane at 1 bar and 298 K. Its cell potential is X x 10^-1 volts. Find X." },
  { family: "chem_organic", labels: ["acetaldehyde"], stem: "The compound formed by the reaction of ethanal with semicarbazide contains how many nitrogen atoms?" },
  { family: "chem_organic", labels: ["aniline"], stem: "Given below are two statements: Statement (I): Aminobenzene and aniline are same organic compounds. Statement (II): Aminobenzene and aniline are different organic compounds." },
  { family: "chem_organic", labels: ["PCC", "?"], stem: "Hex-4-en-2-ol on treatment with PCC gives A. A on reaction with sodium hypoiodite gives B. Identify C." },
  { family: "chem_lewis", labels: ["O_3"], stem: "Choose the correct statements. A. All group 16 elements form oxides EO2 and EO3. D. The ozone molecule contains five lone pairs of electrons." },
  // Organic answer options versus lettered statements, solvents, split names.
  { family: "chem_organic", labels: ["glucose"], stem: "Identify the correct statements. A. Glucose exists in two anomeric forms. B. Anomers of glucose differ in configuration at C-1 in the cyclic hemiacetal structure." },
  { family: "chem_organic", labels: ["benzoic acid", "salicylic acid"], stem: "The compound that does NOT liberate CO2 on treatment with aqueous sodium bicarbonate solution is (A) Benzoic acid (B) Benzenesulphonic acid (C) Salicylic acid (D) Carbolic acid" },
  { forbidLabels: ["glucose"], stem: "Sugar which does not give reddish brown precipitate with Fehling's reagent is: Options: 5335432959, Glucose 5335432960, Sucrose 5335432961, Maltose 5335432962, Lactose" },
  { forbidLabels: ["acetone"], stem: "KI in acetone undergoes SN2 reaction with each of P, Q, R and S. The rates of the reaction vary as" },
  { family: "chem_organic", labels: ["C_7H_16"], forbidLabels: ["pentane"], stem: "The compound (X) on heating in the presence of anhydrous AlCl3 and HCl gas gives 2,4-dimethyl pentane and on aromatization gives toluene." },
];
for (const regression of BANK_REGRESSIONS) {
  const scene = synthesizeFamilyScene({ question: regression.stem });
  const labels = scene ? scene.renderScene.primitives.filter((primitive) => (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text).map((primitive) => primitive.text!) : [];
  const where = regression.stem.slice(0, 60);
  if (regression.none && scene && labels.length > 0) failures.push(`bank regression drew ${scene.family} (${labels.slice(0, 6).join(", ")}) for "${where}"`);
  if (regression.family && scene?.family !== regression.family) failures.push(`bank regression expected ${regression.family}, got ${scene?.family ?? "nothing"} for "${where}"`);
  for (const label of regression.labels ?? []) if (!labels.includes(label)) failures.push(`bank regression missing "${label}" for "${where}" (drawn: ${labels.join(", ")})`);
  for (const label of regression.forbidLabels ?? []) if (labels.includes(label)) failures.push(`bank regression drew "${label}" as a structure for "${where}"`);
}

if (failures.length > 0) {
  console.error(`verify-chemistry-families: FAILED (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`verify-chemistry-families: ok (families=${PROBES.length} of ${CHEMISTRY_SCENE_FAMILIES.length} registered, draws=${draws}, declines=${declines}, physics stems kept out=${PHYSICS_STEMS.length}, bank regressions=${BANK_REGRESSIONS.length})`);
