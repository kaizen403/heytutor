/**
 * Chemical Thermodynamics (chemistry unit 4).
 *
 * The numbers below are the independent checks: w = −Pext ΔV with
 * 1 kPa·L = 1 J, ΔU = q + w, ΔH = ΔU + Δ(PV), q = C ΔT, Cp,m − Cv,m = R
 * for an ideal gas, Hess addition, ΔS_univ = ΔS_sys + ΔS_surr,
 * ΔG = ΔH − TΔS, and ΔG° = −RT ln K. They are not copied from the figure.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const R_J = 8.314;

function labelsOf(question: string, allowExact = false): string[] | null {
  const scene = synthesizeFamilyScene({ question });
  if (!scene) return null;
  check(scene.document.source.chemistryFamily === "chem_thermo", `${question.slice(0, 60)} landed on ${scene.document.source.chemistryFamily}`);
  check(
    scene.tier === "qualitative_verified" || (allowExact && scene.tier === "exact_verified"),
    `${question.slice(0, 60)} tier ${scene.tier}`,
  );
  const compiled = compileSceneDocument(scene.document);
  check(compiled.ok && compiled.renderScene !== null, `${question.slice(0, 60)} did not compile`);
  if (!compiled.renderScene) return null;
  const xs = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.x));
  const ys = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.y));
  check(xs.length > 0 && xs.every((x) => x >= 400 && x <= 1160) && ys.every((y) => y >= 0 && y <= 700), `${question.slice(0, 60)} left the diagram zone`);
  return compiled.renderScene.primitives.filter((primitive) => primitive.text).map((primitive) => primitive.text!);
}

function has(labels: string[] | null, text: string, message: string): void {
  check(labels !== null && labels.some((label) => label.includes(text)), message);
}

function exact(labels: string[] | null, text: string, message: string): void {
  check(labels !== null && labels.some((label) => label === text), message);
}

function declined(question: string, message: string): void {
  const scene = synthesizeFamilyScene({ question });
  check(scene === null || scene.document.source.chemistryFamily !== "chem_thermo", message);
  if (scene && scene.document.source.chemistryFamily === "chem_thermo") {
    failures.push(`${message} (still drew chem_thermo)`);
  }
}

const EXPAND = "A gas expands by 2 L against a constant external pressure of 100 kPa. q = +500 J. Use the first law ΔU = q + w and w = -Pext ΔV. Find w and ΔU.";
const expand = labelsOf(EXPAND);
has(expand, "w=-200 J", "expansion work is -200 J");
has(expand, "q=+500 J", "expansion heat stays +500 J");
has(expand, "dU=+300 J", "expansion internal energy is +300 J");
has(expand, "dU=q+w", "first law is the chemistry convention");

const COMPRESS = "A gas is compressed by 2 L against a constant external pressure of 100 kPa. q = -100 J. Use the first law ΔU = q + w and w = -Pext ΔV.";
const compress = labelsOf(COMPRESS);
has(compress, "w=+200 J", "compression work is positive");
has(compress, "q=-100 J", "compression heat");
has(compress, "dU=+100 J", "compression internal energy is +100 J");

const ISOCHORIC = "Isochoric heating with q = +400 J. Use the first law ΔU = q + w.";
const isochoric = labelsOf(ISOCHORIC);
has(isochoric, "w=0 J", "isochoric work is zero");
has(isochoric, "dU=+400 J", "isochoric internal energy equals heat");
has(isochoric, "isochoric", "isochoric path is named");

const ADIABATIC = "Adiabatic expansion by 2 L against a constant external pressure of 100 kPa. Use the first law ΔU = q + w and w = -Pext ΔV.";
const adiabatic = labelsOf(ADIABATIC);
has(adiabatic, "q=0 J", "adiabatic heat is zero");
has(adiabatic, "w=-200 J", "adiabatic expansion work");
has(adiabatic, "dU=-200 J", "adiabatic internal energy equals work");
has(adiabatic, "adiabatic", "adiabatic path is named");

const ENTHALPY = "The internal energy change ΔU = +300 J and Δ(PV) = +50 J. Find ΔH from ΔH = ΔU + Δ(PV).";
const enthalpy = labelsOf(ENTHALPY);
has(enthalpy, "dH=+350 J", "enthalpy adds the stated pressure-volume change");
has(enthalpy, "dH=dU+dPV", "enthalpy relation is shown");

declined(
  "A gas expands and q = +500 J. Use the first law ΔU = q + w. The external pressure and the volume change are not given.",
  "missing pressure and volume change must not invent work",
);
declined(
  "The gas expands and the internal energy change ΔU = +300 J. Find ΔH. Δ(PV) is not given and the gas is not stated to be ideal.",
  "an expansion must not invent Δ(PV) or an ideal-gas ΔH",
);
declined(
  "Isochoric expansion by 2 L against a constant external pressure of 100 kPa. q = +100 J. Use the first law ΔU = q + w.",
  "isochoric and a volume change contradict",
);
declined(
  "Adiabatic expansion by 2 L against a constant external pressure of 100 kPa. q = +100 J. Use the first law ΔU = q + w.",
  "adiabatic heat must not be a nonzero value",
);

const SAMPLE = "The heat capacity of a sample is 20 J/K. It is heated from 300 K to 310 K with no phase change. Find q.";
const sample = labelsOf(SAMPLE);
has(sample, "q=200 J", "sample heat is C times ΔT");
has(sample, "C sample", "sample heat capacity is named");
has(sample, "q=C*dT", "constant heat capacity relation");

const MOLAR = "The molar heat capacity is 25 J/(mol K) and the amount is 2 mol. ΔT = 10 K. Find q.";
const molar = labelsOf(MOLAR);
has(molar, "q=500 J", "molar heat uses the amount");
has(molar, "C molar", "molar heat capacity is named");
has(molar, "n=2 mol", "amount is shown");

const IDEAL = "For an ideal gas Cp,m = 29.1 J/(mol K) and Cp,m - Cv,m = R. Find Cv,m.";
const idealCv = 29.1 - R_J;
const ideal = labelsOf(IDEAL);
has(ideal, `Cv=${idealCv.toFixed(2)}`, "ideal-gas molar Cv subtracts R");
has(ideal, "ideal gas R", "the R relation is limited to an ideal gas");

declined("The amount is 0 mol and the heat capacity is 20 J/K from 300 K to 310 K. Find q.", "a nonpositive amount is rejected");
declined("The heat capacity of a sample is -5 J/K from 300 K to 310 K. Find q.", "a negative heat capacity is rejected");
declined("The sample melts. The heat capacity is 20 J/K from 300 K to 400 K. Find q.", "a phase change is not a constant-C calculation");
declined("Liquid water has Cp,m = 75 J/(mol K) and Cp,m - Cv,m = R. Find Cv,m.", "Cp,m - Cv,m = R is not used for a liquid");

const HESS = "Using Hess's law, step 1 has ΔH = -394 kJ as written. Step 2 has ΔH = -283 kJ and is reversed. Draw the enthalpy sum.";
const hess = labelsOf(HESS);
has(hess, "-394 kJ", "the first Hess step keeps its sign");
has(hess, "rev +283 kJ", "reversing a step reverses ΔH");
has(hess, "net=-111 kJ", "the Hess net is -111 kJ");

const SCALE = "Using Hess's law, step 1 has ΔH = -100 kJ multiplied by 2. Step 2 has ΔH = +30 kJ as written. Draw the enthalpy sum.";
const scale = labelsOf(SCALE);
has(scale, "x2 -200 kJ", "scaling multiplies the enthalpy");
has(scale, "net=-170 kJ", "the scaled Hess net is -170 kJ");

const NAMED = "Using Hess's law, step 1 is the enthalpy of combustion and has ΔH = -394 kJ as written. Step 2 is the enthalpy of formation and has ΔH = -283 kJ and is reversed. Draw the enthalpy sum.";
const named = labelsOf(NAMED);
has(named, "net=-111 kJ", "combustion and formation use the same sum");

declined("Using Hess's law, combine the reaction steps. The enthalpy values are not given. Draw the cycle.", "missing enthalpies stay undrawn");

const CLOSED = "A closed system exchanges energy but no matter. Draw the boundary.";
const closed = labelsOf(CLOSED);
has(closed, "closed", "closed system");
has(closed, "energy", "closed systems let energy cross");
has(closed, "no matter", "closed systems keep matter in");

const ISOLATED = "An isolated system exchanges neither matter nor energy. Draw the boundary.";
const isolated = labelsOf(ISOLATED);
has(isolated, "isolated", "isolated system");
has(isolated, "no energy", "isolated systems block energy");
has(isolated, "no matter", "isolated systems block matter");

const OPEN = "An open system exchanges matter and energy. Draw the boundary.";
const open = labelsOf(OPEN);
has(open, "open", "open system");
has(open, "matter", "open systems let matter cross");
has(open, "energy", "open systems let energy cross");

const INTENSIVE = "The temperature 300 K is intensive and the internal energy is 10 kJ is extensive. The sample is doubled. Draw the distinction.";
const intensive = labelsOf(INTENSIVE);
has(intensive, "T=300 K", "intensive temperature does not double");
has(intensive, "U=20 kJ", "extensive internal energy doubles");
has(intensive, "intensive", "intensive is named");
has(intensive, "extensive", "extensive is named");

const STATE = "U is a state function. q and w are path functions. Draw the distinction.";
const state = labelsOf(STATE);
has(state, "U state", "internal energy is a state function");
has(state, "q path", "heat is a path function");
has(state, "w path", "work is a path function");

const PATH = "A closed system undergoes an isothermal compression from 10 L to 5 L. Draw the stated endpoints.";
const path = labelsOf(PATH);
has(path, "V=10 L", "the supplied initial volume");
has(path, "V=5 L", "the supplied final volume");
has(path, "isothermal", "the declared model");
check(path !== null && !path.some((label) => label.includes("P=")), "volumes alone do not invent a pressure");

declined("An isolated system exchanges matter with the surroundings. Draw the boundary.", "an isolated system cannot exchange matter");
declined("A closed system has matter entering. Draw the boundary.", "a closed system cannot gain matter");
declined("An open system lets no matter cross. Draw the boundary.", "an open system that blocks matter is not open");
{
  const pv = synthesizeFamilyScene({ question: "Draw a PV curve of an isothermal expansion." });
  check(pv === null || pv.document.source.chemistryFamily !== "chem_thermo", "an endpoint-free PV request must not become a thermo figure");
}

const REVERSIBLE = "Draw the entropy account. dS_sys = +20 J/K and dS_surr = -20 J/K. The process is reversible.";
const reversible = labelsOf(REVERSIBLE);
has(reversible, "dSsys=+20", "system entropy");
has(reversible, "dSsurr=-20", "surroundings entropy");
has(reversible, "dSuniv=0", "reversible universe entropy is zero");
exact(reversible, "reversible", "a zero total is labelled reversible");
check(reversible !== null && !reversible.some((label) => label.includes("spontaneous")), "a reversible account is not called spontaneous");

const IRREVERSIBLE = "Draw the entropy account. dS_sys = +50 J/K and dS_surr = -20 J/K. The process is irreversible.";
const irreversible = labelsOf(IRREVERSIBLE);
has(irreversible, "dSuniv=+30", "irreversible universe entropy is positive");
exact(irreversible, "spontaneous", "a positive universe entropy is spontaneous");

const NEGATIVE = "Draw the entropy account. dS_sys = +10 J/K and dS_surr = -40 J/K.";
const negative = labelsOf(NEGATIVE);
has(negative, "dSuniv=-30", "negative universe entropy");
exact(negative, "not spontaneous", "a negative total is not spontaneous");

const SYS_ONLY = "Draw the entropy account. dS_sys = +50 J/K. Is the process spontaneous? The surroundings are not given.";
const sysOnly = labelsOf(SYS_ONLY);
has(sysOnly, "dSsys=+50", "system-only entropy is shown");
exact(sysOnly, "sys only", "surroundings are not invented");
check(sysOnly !== null && !sysOnly.some((label) => label.includes("spontaneous")), "system entropy alone is not spontaneity");

const QREV = "Find the entropy change of the system. The change is reversible and isothermal. q_rev = 400 J at 298 K.";
const qrev = labelsOf(QREV);
has(qrev, `dS=${(400 / 298).toFixed(2)} J/K`, "reversible isothermal entropy is q_rev/T");
has(qrev, "qrev/T", "the relation is named");

declined("Find the entropy change. q_rev = 400 J at 298 K. The process is irreversible.", "q/T is refused when the change is not reversible");
declined("Draw the entropy account. dS_sys = +20 J/K and dS_surr = -20 J/K. The process is irreversible.", "a zero total cannot be irreversible");
declined("Draw the entropy account. dS_sys = +50 J/K and dS_surr = -20 J/K. The process is reversible.", "a nonzero total cannot be reversible");

const GIBBS = "For a reaction ΔH = -40 kJ/mol and ΔS = -100 J/(mol K). At 298 K find ΔG and the temperature where spontaneity changes.";
const gibbs = labelsOf(GIBBS);
const dg298 = -40 - 298 * (-100 / 1000);
has(gibbs, "T = 400 K", "the crossover is 400 K");
has(gibbs, `ΔG=${dg298.toFixed(1)} kJ/mol`, "ΔG at 298 K is -10.2 kJ/mol");
has(gibbs, "schematic", "the Gibbs line says it is schematic on the board");
has(gibbs, "not a kJ scale", "the Gibbs line says the axis is not an energy scale");
exact(gibbs, "spontaneous", "the reaction is spontaneous on one side of the crossover");
exact(gibbs, "not spontaneous", "the reaction is not spontaneous on the other side");

const BOTH_POSITIVE = "For a reaction ΔH = 40 kJ/mol and ΔS = 100 J K−1 mol−1. Above what temperature will the reaction become spontaneous?";
const bothPositive = labelsOf(BOTH_POSITIVE);
has(bothPositive, "T = 400 K", "the existing positive pair still crosses at 400 K");
has(bothPositive, "schematic", "a Gibbs line without a stated temperature is still marked schematic");
has(bothPositive, "not a kJ scale", "a Gibbs line without a stated temperature still discloses the axis");
exact(bothPositive, "spontaneous", "positive pair is spontaneous above the crossover");
check(bothPositive !== null && !bothPositive.some((label) => label.startsWith("ΔG=")), "a stem that does not state a temperature does not invent ΔG");

const ALWAYS = "For a reaction ΔH = -40 kJ/mol and ΔS = 100 J/(mol K). Is the reaction spontaneous?";
exact(labelsOf(ALWAYS), "ΔG < 0 at all T", "opposite signs with negative ΔH are spontaneous at every T");

const NEVER = "For a reaction ΔH = 40 kJ/mol and ΔS = -100 J/(mol K). Is the reaction spontaneous?";
exact(labelsOf(NEVER), "ΔG > 0 at all T", "opposite signs with positive ΔH are nonspontaneous at every T");

const G_KJ = -5.708;
const K_EQ = Math.exp(-G_KJ * 1000 / (R_J * 298));
const EQUILIBRIUM = "ΔG° = -5.708 kJ/mol at 298 K. Find the thermodynamic equilibrium constant K. This is not a reaction rate.";
const equilibrium = labelsOf(EQUILIBRIUM);
has(equilibrium, `dGo=${G_KJ.toFixed(3)} kJ`, "standard Gibbs energy");
has(equilibrium, `K=${K_EQ.toFixed(2)}`, "K comes from ΔG° = -RT ln K");
has(equilibrium, "dGo=-RT lnK", "the standard relation is named");
has(equilibrium, "T=298 K", "the temperature is absolute");
check(equilibrium !== null && !equilibrium.some((label) => /rate|barrier/i.test(label)), "equilibrium is not a rate or a barrier");

declined("ΔG° = -5 kJ/mol at 298 K. The equilibrium constant K = 0.", "a nonpositive equilibrium constant is rejected");
declined("ΔG° = -5 kJ/mol at 0 K. Find the equilibrium constant K.", "a nonpositive temperature is rejected");

const NACL = "Construct the Born Haber cycle for NaCl. Enthalpy of sublimation of Na = 108 kJ/mol, ionisation enthalpy of Na = 496 kJ/mol, bond dissociation enthalpy of Cl2 = 242 kJ/mol, electron gain enthalpy of Cl = −349 kJ/mol and enthalpy of formation of NaCl = −411 kJ/mol. Calculate the lattice enthalpy of NaCl.";
const nacl = labelsOf(NACL);
has(nacl, "U = −787 kJ", "a closing NaCl cycle still gives U = -787 kJ");
has(nacl, "IE = 496", "the stated ionisation enthalpy stays");
has(nacl, "½ΔH_diss = 121", "half the stated bond enthalpy stays");

const KBR = "Draw the Born-Haber cycle for KBr. The enthalpy of sublimation of potassium is 90 kJ/mol. The other steps are not given.";
const kbr = labelsOf(KBR);
has(kbr, "ΔH_sub", "a stated sublimation can be labelled");
check(kbr !== null && !kbr.some((label) => /787|108|496|349/.test(label)), "an incomplete KBr cycle must not borrow NaCl magnitudes");

const PROFILE = "For an exothermic reaction the activation energy of the forward reaction is 60 kJ/mol and ΔH = −20 kJ/mol. Draw the energy profile diagram and find the activation energy of the backward reaction.";
has(labelsOf(PROFILE, true), "E_a = 60 kJ", "an activation-energy profile stays on its own figure");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("c04 chemical thermodynamics: systems, first law, heat capacity, Hess, entropy, and Gibbs checks passed");
