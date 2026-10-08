/**
 * Redox and electrochemistry (chemistry unit 7).
 *
 * Oxidation totals, the acidic permanganate balance, Nernst at 310 K,
 * ΔG° = −nFE°, κ = G l / A, and Faraday mass are computed here and then
 * compared with the board. They are not imported from the figure modules.
 */
import { elementBySymbol } from "../../src/chemistry/elements";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

function drawn(question: string): { labels: string[] } | null {
  const scene = synthesizeFamilyScene({ question });
  if (!scene) {
    check(false, `${question.slice(0, 72)} drew nothing`);
    return null;
  }
  check(scene.document.source.chemistryFamily === "chem_electrochem", `${question.slice(0, 56)} landed on ${scene.document.source.chemistryFamily}`);
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

function declined(question: string, message: string): void {
  const scene = synthesizeFamilyScene({ question });
  check(scene === null || scene.document.source.chemistryFamily !== "chem_electrochem", message);
}

check(2 * 1 + 2 * -1 === 0, "peroxide oxygen at -1 sums to zero");
check(2 * 1 + 2 * -2 === -2, "blind oxygen at -2 does not sum to the peroxide charge");
const PEROXIDE = "Assign oxidation numbers in H2O2. Do not set oxygen to -2. The sum equals the formula charge of 0.";
const peroxide = drawn(PEROXIDE);
has(peroxide, "O=-1", "oxygen in hydrogen peroxide is -1");
has(peroxide, "not O=-2", "the peroxide exception is on the board");
has(peroxide, "sum=0", "the oxidation numbers sum to the formula charge");
declined("The oxidation number of oxygen in H2O2 is -2.", "blind oxygen at -2 in peroxide is not drawn");

const SUPEROXIDE = "Assign oxidation numbers in KO2. This is a superoxide. The sum equals the formula charge of 0.";
const superoxide = drawn(SUPEROXIDE);
has(superoxide, "O=-1/2", "superoxide oxygen is -1/2");
has(superoxide, "K=+1", "potassium in KO2 is +1");
check(1 + 2 * -0.5 === 0, "KO2 oxidation numbers sum to zero");

const HYDRIDE = "Assign oxidation numbers in NaH. Hydrogen is a hydride. The sum equals the formula charge of 0.";
has(drawn(HYDRIDE), "H=-1", "hydride hydrogen is -1");

const MIXED = "Assign the average oxidation number of iron in Fe3O4. Oxygen is -2. The compound is mixed valence. The sum equals 0.";
check(3 * (8 / 3) + 4 * -2 === 0, "Fe3O4 averages to zero");
const mixed = drawn(MIXED);
has(mixed, "Fe=+8/3", "the average iron oxidation number is +8/3");
has(mixed, "mixed", "Fe3O4 is marked mixed valence");

const SULFUR = "Assign the oxidation number of S in H2SO4. The sum of atom-weighted oxidation numbers equals 0. This is not the formal charge.";
check(2 * 1 + 6 + 4 * -2 === 0, "sulfur +6 makes sulfuric acid neutral");
const sulfur = drawn(SULFUR);
has(sulfur, "S=+6", "sulfur in sulfuric acid is +6");
has(sulfur, "not formal", "oxidation number is not formal charge");

const leftCharge = -1 + 5 * 2 + 8 * 1;
const rightCharge = 2 + 5 * 3;
check(leftCharge === 17 && rightCharge === 17, "the acidic permanganate net has charge 17 on both sides");
const ACID = "Balance MnO4- + Fe2+ in acidic medium. The net is MnO4- + 5Fe2+ + 8H+ -> Mn2+ + 5Fe3+ + 4H2O.";
const acid = drawn(ACID);
has(acid, "e cancel", "the five electrons cancel");
has(acid, "acidic", "the medium is acidic");
has(acid, "charge ok", "the charge balance is on the board");
has(acid, "atoms ok", "the atom balance is on the board");

const ACID_ASK = "Balance MnO4- and Fe2+ in acidic medium.";
has(drawn(ACID_ASK), "e cancel", "the acidic pair still cancels electrons when the net is not written out");

declined("Balance MnO4- and Fe2+ in basic medium and keep the products Mn2+ and Fe3+.", "acidic products are not certified in base");
declined("The net reaction is MnO4- + Fe2+ + 8H+ + 4e- -> Mn2+ + Fe3+ + 4H2O.", "a net that still contains electrons is rejected");

const Q1 = "Apply the Nernst equation. E° = 1.10 V, n = 2, Q = 1, T = 298 K. Find E.";
const q1 = drawn(Q1);
has(q1, "E=1.10 V", "Q = 1 returns E°");
has(q1, "Q=1", "the reaction quotient is 1");
has(q1, "E=E0", "E and E° are the same at Q = 1");

const e310 = 1.1 - ((8.314 * 310) / (2 * 96500)) * Math.log(10);
check(e310.toFixed(3) === "1.069", "the 310 K Nernst value is 1.069 V");
const e059 = 1.1 - (0.059 / 2) * 1;
check(Math.abs(e059 - e310) > 0.001, "the 298 K shortcut is not the 310 K result");
const WARM = "Apply the Nernst equation at T = 310 K. E° = 1.10 V, n = 2, Q = 10. R = 8.314 J/mol K and F = 96500 C/mol. Do not use 0.059 V.";
const warm = drawn(WARM);
has(warm, "E=1.069 V", "Nernst at 310 K uses RT/nF");
has(warm, "T=310 K", "the temperature is on the board");
has(warm, "not 0.059", "the 298 K shortcut is refused");

declined("Apply the Nernst equation at T = 310 K. E° = 1.10 V, n = 2, Q = 10. Do not use 0.059 V.", "310 K without R and F is not given the shortcut");
declined("E = 0.100 V at Q = 10, n = 1, T = 298 K. Find K from this E alone.", "K is not taken from a nonstandard E");

const dG = -1 * 96500 * 0.1 / 1000;
const kEq = Math.exp((1 * 96500 * 0.1) / (8.314 * 298));
check(dG === -9.65, "Delta G° is -9.65 kJ/mol");
check(Number(kEq.toPrecision(3)) === 49.2, "K from E° is 49.2");
const GIBBS = "E° = 0.100 V, n = 1, T = 298 K. F = 96500 C/mol and R = 8.314 J/mol K. Find ΔG° and K from E°. There is no nonstandard E.";
const gibbs = drawn(GIBBS);
has(gibbs, "dGo=-9.65kJ", "Delta G° = -nFE°");
has(gibbs, "K=49.2", "ln K uses E°, not a nonstandard E");
has(gibbs, "from E0", "K is tied to the standard potential");

const REVERSE = "The cell reaction is reversed. E° was 0.100 V and n = 1. The reversed E° is -0.100 V and ΔG° changes sign.";
const reversed = drawn(REVERSE);
has(reversed, "E0=-0.10 V", "reversal changes the sign of E°");
has(reversed, "sign flip", "Delta G° changes sign with the reaction");

const POLARITY = "In a galvanic cell the anode is negative. In an electrolytic cell the anode is positive. Oxidation is at the anode in both.";
const polarity = drawn(POLARITY);
has(polarity, "ox anode", "oxidation stays at the anode");
has(polarity, "galv an-", "the galvanic anode is negative");
has(polarity, "elec an+", "the electrolytic anode is positive");

const DANIELL = "Draw the Daniell cell and calculate its standard emf.";
const daniell = drawn(DANIELL);
has(daniell, "E° = 1.10 V", "the existing Daniell cell still reports 1.10 V");
has(daniell, "anode (-)", "the galvanic anode is the negative electrode");
has(daniell, "salt bridge", "the salt bridge is still drawn");

const BRINE = "Draw the electrolytic cell for the electrolysis of brine with inert electrodes and name the products at each electrode.";
const brine = drawn(BRINE);
has(brine, "anode (+)", "the electrolytic anode is positive");
has(brine, "Cl_2", "brine still gives chlorine");
has(brine, "H_2", "brine still gives hydrogen");

const MOLTEN = "What are the products of electrolysis of molten NaCl using platinum electrodes?";
const molten = drawn(MOLTEN);
has(molten, "Na", "molten sodium chloride gives sodium");
has(molten, "Cl_2", "molten sodium chloride gives chlorine");
check(molten !== null && !molten.labels.some((label) => label.includes("NaOH")), "molten sodium chloride does not invent aqueous NaOH");

const kappa = 0.02 * 2 / 4;
check(Math.abs(kappa - 0.01) < 1e-12, "kappa is G l / A");
const KAPPA = "A solution has conductance G = 0.020 S. The cell length l = 2 cm and the electrode area A = 4 cm2. Find the conductivity kappa.";
const kappaFigure = drawn(KAPPA);
has(kappaFigure, "k=0.01 S/cm", "conductivity is 0.01 S/cm");
has(kappaFigure, "k=G*l/A", "the cell-constant relation is on the board");

const lambda = 1000 * 0.01 / 0.1;
check(lambda === 100, "molar conductivity is 1000 kappa / c");
const LAMBDA = "kappa = 0.010 S/cm and c = 0.10 mol/L. Find the molar conductivity. Use Lambda_m = 1000*kappa/c.";
const lambdaFigure = drawn(LAMBDA);
has(lambdaFigure, "Lm=100", "Lambda_m is 100");
has(lambdaFigure, "1000k/c", "the unit conversion is on the board");

check(50 + 76 === 126, "Kohlrausch's law adds the ionic conductivities");
const SUM = "Kohlrausch's law: the limiting ionic conductivity of Na+ is 50 and of Cl- is 76, in S cm2/mol. Find Lambda_m° of NaCl.";
const sum = drawn(SUM);
has(sum, "Lm0=126", "the limiting molar conductivity is the ionic sum");
has(sum, "Na+=50", "the sodium ion conductivity is kept");
has(sum, "Cl-=76", "the chloride ion conductivity is kept");

const PLOT = "Draw the variation of molar conductivity with √c for a strong electrolyte and a weak electrolyte and explain Kohlrausch law.";
const plot = drawn(PLOT);
has(plot, "schematic", "the dilution curve says it is schematic");
has(plot, "not measured", "the dilution curve is not measured data");
has(plot, "strong", "the strong electrolyte curve remains");
has(plot, "weak", "the weak electrolyte curve remains");

const cu = elementBySymbol("Cu");
check(cu !== null && cu.mass === 63.546, "copper mass comes from the element table");
const mass = ((cu?.mass ?? 0) * 965) / (2 * 96500);
check(Number(mass.toPrecision(3)) === 0.318, "965 C deposits 0.318 g of copper");
const FARADAY = "Faraday's law. Cu2+ is deposited. z = 2, I = 1 A, t = 965 s, F = 96500 C/mol. Efficiency is 100 percent and enough Cu2+ is available. Find the mass.";
const faraday = drawn(FARADAY);
has(faraday, "m=0.318 g", "Faraday mass uses the copper molar mass");
has(faraday, "Q=965 C", "charge is current times time");
has(faraday, "eff=100%", "the efficiency assumption is visible");

const mass2 = ((cu?.mass ?? 0) * 1200) / (2 * 96500);
check(Number(mass2.toPrecision(3)) === 0.395, "10 minutes at 2 A deposits 0.395 g");
const MINUTES = "Faraday's law. Cu2+ , z = 2, I = 2 A for 10 min, F = 96500 C/mol. Efficiency is 100 percent and enough reactant is available. Find the mass.";
has(drawn(MINUTES), "m=0.395 g", "minutes are converted before Faraday's law");
has(drawn(MINUTES), "t=600 s", "10 min is 600 s");

declined("Faraday's law. Cu2+ is deposited. z = 2, I = 1 A, t = 965 s, F = 96500 C/mol. Find the mass.", "a Faraday mass without an efficiency is not drawn");
declined("I = 1 A for 96500 s deposits Cu from 0.001 mol of Cu2+. z=2, F=96500. Efficiency is 100 percent.", "a deposit larger than the available copper is rejected");
declined("The standard emf of a cell is 1.1 V. Calculate ΔG° for the cell reaction if n = 2.", "Delta G° without named electrodes stays declined");

const DRY = "Draw the Leclanche dry cell discharge. Anode Zn -> Zn2+ + 2e-. Cathode 2MnO2 + 2NH4+ + 2e- -> Mn2O3 + 2NH3 + H2O. Do not invent a voltage.";
const dry = drawn(DRY);
has(dry, "dry cell", "the dry cell is named");
has(dry, "Zn anode", "zinc is the anode on discharge");
has(dry, "discharge", "the direction is discharge");
has(dry, "no voltage", "no voltage is invented");
check(dry !== null && !dry.labels.some((label) => /\d+\.\d+\s*V/.test(label)), "the dry cell has no decimal voltage");

const LEAD = "Lead accumulator discharge. Anode Pb + SO4^2- -> PbSO4 + 2e-. Cathode PbO2 + SO4^2- + 4H+ + 2e- -> PbSO4 + 2H2O. Net Pb + PbO2 + 2H2SO4 -> 2PbSO4 + 2H2O.";
const lead = drawn(LEAD);
has(lead, "discharge", "the lead cell is discharging");
has(lead, "Pb anode", "lead is the discharge anode");
has(lead, "PbO2 cath", "lead dioxide is the discharge cathode");
has(lead, "net ok", "the lead net balances");

const CHARGE = "The lead accumulator is recharged. The discharge reactions are reversed. PbSO4 is converted back at both electrodes.";
const charge = drawn(CHARGE);
has(charge, "recharge", "recharge is distinguished from discharge");
has(charge, "reversed", "recharge reverses the discharge reactions");
has(charge, "not disch", "recharge is not labelled as discharge");
declined("During recharge of the lead accumulator the anode reaction stays Pb -> PbSO4.", "discharge is not drawn as recharge");

const FUEL = "Hydrogen-oxygen fuel cell in acid. Anode 2H2 -> 4H+ + 4e-. Cathode O2 + 4H+ + 4e- -> 2H2O. Net 2H2 + O2 -> 2H2O. Do not invent a voltage.";
const fuel = drawn(FUEL);
has(fuel, "fuel cell", "the fuel cell is named");
has(fuel, "net 2H2+O2", "the net fuel-cell reaction is on the board");
has(fuel, "no voltage", "the fuel cell voltage is not invented");
declined("Draw a hydrogen fuel cell.", "a fuel cell without an acid or alkali medium is not given a reaction");

const RUST = "Iron corrodes in moist air. Anode Fe -> Fe2+ + 2e-. Cathode O2 + 2H2O + 4e- -> 4OH-. Do not invent a corrosion rate.";
const rust = drawn(RUST);
has(rust, "Fe anode", "iron is the corrosion anode");
has(rust, "O2 cath", "oxygen is reduced");
has(rust, "no rate", "no corrosion rate is invented");
has(rust, "net ok", "the corrosion net balances");
declined("The corrosion rate is 2 mm per year. Draw iron corrosion in moist air.", "an invented corrosion rate is not drawn");
declined("The dry cell voltage is 1.5 V. Draw that voltage.", "a stated dry-cell voltage is not certified");

if (failures.length > 0) {
  console.error(`verify-c07-redox: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("verify-c07-redox: ok");
