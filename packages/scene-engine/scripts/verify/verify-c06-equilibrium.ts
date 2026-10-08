/**
 * Equilibrium (chemistry unit 6).
 *
 * The numbers below are the independent checks: Kp = Kc (RT)^Δn, a 1:1
 * extent, ΔG = ΔG° + RT ln Q, the strong-acid quadratic with water, and
 * Ksp = 4s^3. They are not copied from the figure modules.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

function drawn(question: string, family: string): { labels: string[] } | null {
  const scene = synthesizeFamilyScene({ question });
  if (!scene) {
    check(false, `${question.slice(0, 72)} drew nothing`);
    return null;
  }
  check(scene.document.source.chemistryFamily === family, `${question.slice(0, 56)} landed on ${scene.document.source.chemistryFamily}`);
  check(scene.tier === "qualitative_verified", `${question.slice(0, 56)} tier ${scene.tier}`);
  const compiled = compileSceneDocument(scene.document);
  check(compiled.ok && compiled.renderScene !== null, `${question.slice(0, 56)} did not compile`);
  if (!compiled.ok || !compiled.renderScene) return null;
  check(
    !compiled.report.issues.some((issue) => issue.code === "assertion_failed"),
    `${question.slice(0, 56)} failed an assertion`,
  );
  const xs = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.x));
  const ys = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.y));
  check(xs.length > 0 && xs.every((x) => x >= 400 && x <= 1160) && ys.every((y) => y >= 0 && y <= 700), `${question.slice(0, 56)} left the diagram zone`);
  return { labels: compiled.renderScene.primitives.filter((primitive) => primitive.text).map((primitive) => primitive.text!) };
}

function has(figure: { labels: string[] } | null, text: string, message: string): void {
  check(figure !== null && figure.labels.some((label) => label.includes(text)), message);
}

function declined(question: string, family: string, message: string): void {
  const scene = synthesizeFamilyScene({ question });
  check(scene === null || scene.document.source.chemistryFamily !== family, message);
}

const WATER = "In a closed vessel liquid water and water vapour are at dynamic equilibrium. The forward and reverse rates are equal. The amount of liquid is not equal to the amount of vapour.";
const water = drawn(WATER, "chem_kinetics");
has(water, "rates equal", "dynamic equilibrium has equal forward and reverse rates");
has(water, "not equal c", "equal rates do not require equal amounts");
has(water, "closed", "the vessel is closed");
has(water, "fwd", "the forward process is drawn");
has(water, "rev", "the reverse process is drawn");

const ICE = "Ice and water at 273 K in a closed vessel are at solid-liquid equilibrium. Melting and freezing both continue. The masses need not be equal.";
const ice = drawn(ICE, "chem_kinetics");
has(ice, "rates equal", "melting and freezing continue at equal rates");
has(ice, "solid-liq", "the equilibrium is solid-liquid");
has(ice, "not equal c", "the two masses need not be equal");

const SOLID_GAS = "In a closed vessel solid iodine and iodine vapour are at dynamic equilibrium. The forward and reverse rates are equal. The amounts are not equal. This is a solid-gas equilibrium.";
has(drawn(SOLID_GAS, "chem_kinetics"), "solid-gas", "a closed solid-gas equilibrium is drawn");

const GAS_GAS = "In a closed vessel two gases are at dynamic equilibrium. The forward and reverse rates are equal. The amounts are not equal. This is a gas-gas equilibrium.";
has(drawn(GAS_GAS, "chem_kinetics"), "gas-gas", "a closed gas-gas equilibrium is drawn");

declined("Water evaporates from an open dish and the vapour is lost to the room. This is not equilibrium.", "chem_kinetics", "an open loss is not drawn as equilibrium");
declined("The reaction has stopped. Both the forward rate and the reverse rate are zero. Draw the equilibrium.", "chem_kinetics", "a stopped reaction is not dynamic equilibrium");
declined("A continuous flow reactor keeps concentrations constant by pumping material in and out. This is a driven steady state, not equilibrium.", "chem_kinetics", "a driven steady state is not equilibrium");

const PRESSURE = "State Le Chatelier's principle and explain the effect of increasing pressure on the equilibrium N2 + 3H2 <=> 2NH3.";
const pressure = drawn(PRESSURE, "chem_kinetics");
has(pressure, "dN=-2", "ammonia synthesis has delta n of gas equal to -2");
has(pressure, "toward NH3", "higher pressure shifts toward fewer gas moles");
has(pressure, "K fixed", "pressure does not change K");
has(pressure, "schematic", "the pressure direction is marked schematic");

const IMMEDIATE = "N2(g) + 3H2(g) <=> 2NH3(g) is at equilibrium. [N2]=1 M, [H2]=1 M and [NH3]=2 M, so Kc=4. At the same instant more N2 is added and [N2] becomes 2 M. Temperature is constant. Find the immediate Q.";
const immediateQ = 4 / 2;
check(Math.abs(immediateQ - 2) < 1e-12, "the immediate quotient is 2");
const immediate = drawn(IMMEDIATE, "chem_kinetics");
has(immediate, "Q=2", "adding N2 drops Q from 4 to 2");
has(immediate, "K=4", "K stays 4 at constant temperature");
has(immediate, "Q<K", "Q is below K");
has(immediate, "shift fwd", "the immediate shift is forward");

const EQUAL_MOLES = "H2(g) + I2(g) <=> 2HI(g). Delta n of gas is 0. Increasing the pressure does not change the equilibrium composition. K is unchanged.";
const equalMoles = drawn(EQUAL_MOLES, "chem_kinetics");
has(equalMoles, "dN=0", "HI formation has no gas mole change");
has(equalMoles, "no shift", "pressure does not shift an equal-mole gas reaction");

declined("Show that increasing pressure shifts H2(g) + I2(g) <=> 2HI(g) toward HI.", "chem_kinetics", "a false pressure shift is not drawn");

const CATALYST = "A catalyst is added to an equilibrium mixture. The catalyst does not change K and does not change the final equilibrium composition.";
const catalyst = drawn(CATALYST, "chem_kinetics");
has(catalyst, "K same", "a catalyst does not change K");
has(catalyst, "comp same", "a catalyst does not change the equilibrium composition");

const HEAT = "The forward reaction is exothermic. The temperature is increased. K decreases. A concentration change does not change K.";
const heat = drawn(HEAT, "chem_kinetics");
has(heat, "K down", "heating an exothermic reaction decreases K");
has(heat, "c no K", "concentration does not change K");

const INERT_V = "An inert gas is added at constant volume to N2(g) + 3H2(g) <=> 2NH3(g) at equilibrium. Partial pressures do not change. There is no shift.";
has(drawn(INERT_V, "chem_kinetics"), "V fixed", "inert gas at constant volume does not shift the equilibrium");

const INERT_P = "An inert gas is added at constant pressure to N2(g) + 3H2(g) <=> 2NH3(g). The volume increases and the equilibrium shifts toward more gas moles.";
const inertP = drawn(INERT_P, "chem_kinetics");
has(inertP, "P fixed", "the pressure is held fixed");
has(inertP, "shift left", "more gas moles are on the reactant side");
has(inertP, "dN=-2", "the gas mole change is -2");

const rt = 0.083 * 298;
const kp = 4 * rt ** -2;
check(Number(kp.toPrecision(3)) === 0.00654, "Kp to three figures is 0.00654");
const KP = "For N2(g) + 3H2(g) <=> 2NH3(g), Kc = 4 at 298 K. Use R = 0.083 L bar/K mol. Ideal gas. Find Kp.";
const kpFigure = drawn(KP, "chem_kinetics");
has(kpFigure, "Kp=0.00654", "Kp is Kc times (RT) to the power delta n");
has(kpFigure, "dN=-2", "the ammonia reaction loses two gas moles");
has(kpFigure, "ideal gas", "the conversion states the ideal-gas convention");

const HETERO = "CaCO3(s) <=> CaO(s) + CO2(g). Kp equals the pressure of CO2, which is 0.2 bar. Pure solids have activity 1 and are omitted.";
const hetero = drawn(HETERO, "chem_kinetics");
has(hetero, "Kp=0.2 bar", "Kp is the CO2 pressure");
has(hetero, "solids a=1", "pure solids have activity 1");
has(hetero, "omit solid", "pure solids are omitted from Q");

const extent = 4 / 5;
check(Math.abs(extent - 0.8) < 1e-12, "the 1:1 extent is 0.8");
const EXTENT = "The reaction A(g) <=> B(g) starts with 1 mol of A and 0 mol of B in a 1 L vessel. Kc = 4. Find the equilibrium extent.";
const extentFigure = drawn(EXTENT, "chem_kinetics");
has(extentFigure, "x=0.8 mol", "the extent is 0.8 mol");
has(extentFigure, "[A]=0.2", "A remaining is nonnegative");
has(extentFigure, "[B]=0.8", "B formed is nonnegative");

declined("Kc = -4 for A(g) <=> B(g). Find the extent.", "chem_kinetics", "a negative Kc is rejected");
declined("Include the concentration of CaCO3(s) in Kc for CaCO3(s) <=> CaO(s) + CO2(g).", "chem_kinetics", "a pure solid is not given a concentration in Kc");
declined("A(g) <=> B(g) starts with 1 mol of A. Kc = 4. The extent is 2 mol.", "chem_kinetics", "an extent past the available reactant is rejected");
declined("For N2(g) + 3H2(g) <=> 2NH3(g), Kc = 4 at 298 K. Ideal gas. Find Kp.", "chem_kinetics", "Kp is not converted without a stated R");

const GIBBS = "The reaction has ΔG° = 10 kJ/mol and Q = 1 at 298 K. R = 8.314 J/mol K. Find the reaction ΔG. This is not the total system Gibbs energy.";
const gibbs = drawn(GIBBS, "chem_kinetics");
has(gibbs, "dG=10 kJ/mol", "Q = 1 leaves reaction Delta G equal to Delta G°");
has(gibbs, "not G total", "reaction Delta G is not the total system Gibbs energy");

const AT_K = "ΔG° = 5.708 kJ/mol at 298 K and Q equals K. R = 8.314 J/mol K. Find the reaction ΔG.";
const atK = drawn(AT_K, "chem_kinetics");
has(atK, "dG=0", "Q = K makes the reaction Delta G zero");
has(atK, "dGo!=0", "equilibrium does not require Delta G° = 0");
declined("At equilibrium ΔG° must be 0. Q = K and ΔG° = 0.", "chem_kinetics", "Delta G° = 0 is not required for equilibrium");

const ARRHENIUS = "HCl in water produces H+ and is an Arrhenius acid. Show the ionisation HCl -> H+ + Cl-.";
has(drawn(ARRHENIUS, "chem_solutions"), "Arrhenius", "HCl in water is an Arrhenius acid");
has(drawn(ARRHENIUS, "chem_solutions"), "H+ donor", "the Arrhenius acid donates H+");

const BRONSTED = "NH3 + H2O <=> NH4+ + OH-. Identify the Bronsted acid, the Bronsted base, and the conjugate acid of NH3.";
const bronsted = drawn(BRONSTED, "chem_solutions");
has(bronsted, "base NH3", "NH3 is the Bronsted base");
has(bronsted, "acid H2O", "water is the Bronsted acid");
has(bronsted, "conj NH4+", "NH4+ is the conjugate acid");

const LEWIS = "BF3 accepts an electron pair from NH3. BF3 is the Lewis acid and NH3 is the Lewis base.";
const lewis = drawn(LEWIS, "chem_solutions");
has(lewis, "Lewis acid", "BF3 is the Lewis acid");
has(lewis, "BF3 accept", "the Lewis acid accepts the electron pair");

const STRONG = "0.001 M HCl is a strong acid and a dilute solution. Strong does not mean concentrated.";
const strong = drawn(STRONG, "chem_solutions");
has(strong, "strong", "the acid is strong");
has(strong, "dilute", "0.001 M is dilute");
has(strong, "not conc", "strong is not concentrated");
declined("The acid is strong, so its concentration is 10 M.", "chem_solutions", "strong is not turned into a concentration");

const WEAK = "A weak acid HA of concentration 0.1 M has Ka = 1e-5. Use [H+] = sqrt(Ka c) only because c/Ka is 10000. Find [H+].";
check(Math.abs(Math.sqrt(1e-5 * 0.1) - 0.001) < 1e-12, "the weak-acid approximation is 0.001");
has(drawn(WEAK, "chem_solutions"), "H+=0.001", "sqrt(Ka c) is 0.001");
has(drawn(WEAK, "chem_solutions"), "approx ok", "the approximation is inside its bound");

const STAGES = "Carbonic acid has Ka1 = 4.0e-7 and Ka2 = 4.7e-11. Keep both stages. Do not report one [H+] from a single Ka.";
const stages = drawn(STAGES, "chem_solutions");
has(stages, "Ka1=4e-7", "the first ionisation constant is kept");
has(stages, "Ka2=4.7e-11", "the second ionisation constant is kept");
has(stages, "two stages", "the two stages are not collapsed");
declined("Use one Ka = 4e-7 for both protons of H2CO3 and find one [H+].", "chem_solutions", "a single Ka does not replace both stages");

const cAcid = 1e-8;
const kw = 1e-14;
const hPlus = (cAcid + Math.sqrt(cAcid * cAcid + 4 * kw)) / 2;
const pH = -Math.log10(hPlus);
check(Math.abs(pH - 6.98) < 0.005, "1e-8 M HCl is near 6.98, not 8");
check(Math.abs(-Math.log10(cAcid) - 8) < 1e-9, "ignoring water would give pH 8");
const DILUTE = "Find the pH of 1e-8 M HCl. Kw = 1e-14. Include water. Do not report pH 8.";
const dilute = drawn(DILUTE, "chem_solutions");
has(dilute, "pH=6.98", "water keeps 1e-8 M HCl below pH 7");
has(dilute, "not pH 8", "ignoring water is rejected on the board");
has(dilute, "Kw used", "Kw is in the charge balance");
has(dilute, "not activity", "the pH uses the concentration approximation");

const NEUTRAL = "Kw = 1e-13. Find the pH of neutral water. Neutral is not pH 7 at this temperature.";
check(Math.abs(-Math.log10(Math.sqrt(1e-13)) - 6.5) < 1e-9, "neutral water at Kw 1e-13 is pH 6.5");
const neutral = drawn(NEUTRAL, "chem_solutions");
has(neutral, "pH=6.5", "neutral pH follows the stated Kw");
has(neutral, "not pH 7", "pH 7 is not neutral at every temperature");
declined("Kw = 1e-13 and the solution is neutral, so the pH is 7.", "chem_solutions", "a false neutral pH of 7 is not drawn");

const WATER_PH = "Pure water at 298 K has Kw = 1e-14. Find pH and pOH.";
const waterPh = drawn(WATER_PH, "chem_solutions");
has(waterPh, "pH=7", "pure water at this Kw is pH 7");
has(waterPh, "pOH=7", "pOH is reported separately");

const ACID2 = "A solution has [H+] = 2 M. Kw = 1e-14. Find the pH. The scale is not limited to 0 to 14.";
check(Number((-Math.log10(2)).toPrecision(3)) === -0.301, "2 M acid is pH -0.301");
const acid2 = drawn(ACID2, "chem_solutions");
has(acid2, "pH=-0.301", "pH can be negative");
has(acid2, "not 0..14", "0 to 14 is not a universal bound");

const BUFFER = "A buffer contains 0.1 M CH3COOH and 0.2 M CH3COONa. Calculate its pH (pKa = 4.76).";
const bufferPh = 4.76 + Math.log10(2);
check(bufferPh.toFixed(2) === "5.06", "the acetate buffer is pH 5.06");
const buffer = drawn(BUFFER, "chem_solutions");
has(buffer, "pH=5.06", "Henderson-Hasselbalch gives 5.06");
has(buffer, "HH ok", "both buffer species are present");

const EQUAL_BUFFER = "An acetic acid buffer has [HA] = 0.1 M and [A-] = 0.1 M. Ka = 1e-5. No reagent has been added. Use Henderson-Hasselbalch. Find the pH.";
has(drawn(EQUAL_BUFFER, "chem_solutions"), "pH=5", "equal acid and salt give pH = pKa");

const EXHAUSTED = "A buffer contains 0.10 mol HA and 0.10 mol A- in 1 L. Then 0.15 mol NaOH is added. Apply the stoichiometry before equilibrium.";
const exhausted = drawn(EXHAUSTED, "chem_solutions");
has(exhausted, "exhausted", "added base is applied before the equilibrium");
has(exhausted, "not buffer", "an exhausted buffer is not still a buffer");
has(exhausted, "OH left", "the excess hydroxide is named");
declined("Use Henderson-Hasselbalch for 0.1 M HA and 0 M A-. Ka = 1e-5.", "chem_solutions", "Henderson-Hasselbalch is not used with no conjugate base");

const COMMON = "0.10 M acetic acid has Ka = 1e-5. Sodium acetate makes [A-] = 0.10 M. Find [H+]. The pure weak acid would be higher.";
const common = drawn(COMMON, "chem_solutions");
has(common, "H+=1e-5", "the common ion sets [H+] to Ka times the ratio");
has(common, "suppressed", "the common ion suppresses ionisation");
has(common, "pure 0.001", "the pure weak acid would be 0.001");

const HYDRO = "Sodium acetate hydrolyses in water. The acetate ion hydrolyses. Na+ does not hydrolyse.";
const hydro = drawn(HYDRO, "chem_solutions");
has(hydro, "ion=acetate", "acetate is the hydrolysing ion");
has(hydro, "not Na+", "sodium ion is not the hydrolysing ion");
declined("NaCl hydrolysis is caused by Na+. Find that pH.", "chem_solutions", "sodium ion is not drawn as the hydrolysing ion");

const oh = Math.sqrt(5.6e-10 * 0.1);
const saltPh = 14 + Math.log10(oh);
check(saltPh.toFixed(2) === "8.87", "the acetate salt is pH 8.87");
const SALT = "Kw = 1e-14. Acetate has Kb = 5.6e-10 and the salt concentration is 0.1 M. [OH-] = sqrt(Kb*c). Find the pH.";
has(drawn(SALT, "chem_solutions"), "pH=8.87", "the salt pH uses Kb and Kw");

const sCaf2 = Math.cbrt(4e-11 / 4);
check(Number((sCaf2 / 10 ** Math.floor(Math.log10(sCaf2))).toPrecision(3)) === 2.15, "CaF2 solubility starts 2.15");
const CAF2 = "CaF2 dissolves in pure water. Ksp = 4.0e-11. Use Ksp = 4 s^3. Find s.";
const caf2 = drawn(CAF2, "chem_solutions");
has(caf2, "s=2.15e-4", "Ksp = 4 s^3 gives s = 2.15e-4");
has(caf2, "Ksp=4s^3", "the stoichiometric power is on the board");

const AGCL = "AgCl in pure water. Ksp = 1.0e-10. Ksp = s^2. Find s.";
has(drawn(AGCL, "chem_solutions"), "s=1e-5", "AgCl uses s squared");

const NO_PPT = "After mixing, [Ca2+] = 1e-5 M and [F-] = 1e-3 M. Ksp of CaF2 is 4e-11.";
const qLow = 1e-5 * (1e-3) ** 2;
check(qLow < 4e-11, "the low ion product is below Ksp");
const noPpt = drawn(NO_PPT, "chem_solutions");
has(noPpt, "Q=1e-11", "Q uses [F- ] squared");
has(noPpt, "no ppt", "Q below Ksp does not precipitate");

const YES_PPT = "After mixing, [Ca2+] = 1e-3 M and [F-] = 1e-3 M. Ksp of CaF2 is 4e-11.";
has(drawn(YES_PPT, "chem_solutions"), "ppt", "Q above Ksp precipitates");

const MIX = "10 mL of 0.020 M Ca2+ is mixed with 10 mL of 0.020 M F-. The mixture volume is 20 mL. Ksp of CaF2 is 4e-11. Find Q after mixing.";
const qMix = 0.01 * 0.01 ** 2;
check(Math.abs(qMix - 1e-6) < 1e-15, "the mixed ion product is 1e-6");
const mix = drawn(MIX, "chem_solutions");
has(mix, "Q=1e-6", "mixing uses the combined volume");
has(mix, "V=20 mL", "the mixture volume is on the board");
declined("10 mL of 0.020 M Ca2+ is mixed with 10 mL of 0.020 M F-. Ignore the volume change and use the original concentrations. Ksp is 4e-11.", "chem_solutions", "the original concentrations are not used after mixing");
declined("Q is below Ksp so a precipitate forms. Ksp of CaF2 is 4e-11 and Q = 1e-12.", "chem_solutions", "a precipitate is not drawn when Q is below Ksp");

if (failures.length > 0) {
  console.error(`verify-c06-equilibrium: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("verify-c06-equilibrium: ok");
