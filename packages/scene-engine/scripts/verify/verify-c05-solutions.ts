/**
 * Solutions (chemistry unit 5).
 *
 * The numbers below are the independent checks: M = n/V, m = n/kg solvent,
 * mole fractions sum to 1, dilution conserves solute, p = k_H x, Raoult
 * partial pressures, ΔT = i K m, π = i c R T, and M_apparent = M_true / i.
 * They are not copied from the figure.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

function drawn(question: string): { labels: string[]; expressions: string[] } | null {
  const scene = synthesizeFamilyScene({ question });
  if (!scene) return null;
  check(scene.document.source.chemistryFamily === "chem_solutions", `${question.slice(0, 56)} landed on ${scene.document.source.chemistryFamily}`);
  check(scene.tier === "qualitative_verified", `${question.slice(0, 56)} tier ${scene.tier}`);
  const compiled = compileSceneDocument(scene.document);
  check(compiled.ok && compiled.renderScene !== null, `${question.slice(0, 56)} did not compile`);
  if (!compiled.ok || !compiled.renderScene) return null;
  check(
    !compiled.report.issues.some((issue) => issue.code === "assertion_failed"),
    `${question.slice(0, 56)} failed a curve assertion`,
  );
  const xs = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.x));
  const ys = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.y));
  check(xs.length > 0 && xs.every((x) => x >= 400 && x <= 1160) && ys.every((y) => y >= 0 && y <= 700), `${question.slice(0, 56)} left the diagram zone`);
  const expressions = scene.document.constructions
    .filter((construction) => construction.operator === "function_curve")
    .map((construction) => String(construction.inputs.expression ?? ""));
  return {
    labels: compiled.renderScene.primitives.filter((primitive) => primitive.text).map((primitive) => primitive.text!),
    expressions,
  };
}

function has(figure: { labels: string[] } | null, text: string, message: string): void {
  check(figure !== null && figure.labels.some((label) => label.includes(text)), message);
}

function declined(question: string, message: string): void {
  const scene = synthesizeFamilyScene({ question });
  check(scene === null || scene.document.source.chemistryFamily !== "chem_solutions", message);
}

const MOLAR = "A solution contains 0.5 mol of solute in a solution volume of 2 L. Find the molarity.";
const molar = drawn(MOLAR);
has(molar, "M=0.25 mol/L", "0.5 mol in 2 L is 0.25 mol/L");
has(molar, "solution V", "molarity uses the solution volume");

const MOLAL = "0.2 mol of solute is dissolved in 500 g of solvent. Find the molality. The solvent mass is not the solution mass.";
const molal = drawn(MOLAL);
has(molal, "m=0.4 mol/kg", "0.2 mol in 0.5 kg of solvent is 0.4 mol/kg");
has(molal, "not solution", "molality names the solvent mass");

const FRACTION = "A solution contains 2 mol of A and 3 mol of B. Find the mole fractions.";
const fraction = drawn(FRACTION);
has(fraction, "xA=0.4", "mole fraction of A is 0.4");
has(fraction, "xB=0.6", "mole fraction of B is 0.6");
has(fraction, "sum=1", "the mole fractions add to one");

const MASS_SOLVENT = "10 g of solute is dissolved in 40 g of solvent. Find the mass percent of the solution.";
has(drawn(MASS_SOLVENT), "20 mass%", "10 g in 40 g of solvent is 20 mass percent");
has(drawn(MASS_SOLVENT), "solvent 40 g", "the solvent mass stays separate from the solution mass");

const MASS_SOLUTION = "10 g of solute in 50 g of solution. Find the percentage by mass.";
has(drawn(MASS_SOLUTION), "20 mass%", "10 g in 50 g of solution is 20 mass percent");
has(drawn(MASS_SOLUTION), "solution mass", "the stated mass is the solution mass");

const DILUTE = "100 mL of 2 M solution is diluted to 500 mL. The solute is conserved. Find the final molarity.";
const dilute = drawn(DILUTE);
has(dilute, "M2=0.4 mol/L", "dilution to 500 mL gives 0.4 mol/L");
has(dilute, "n=0.2 mol", "dilution keeps 0.2 mol of solute");

const VOLUME = "25 mL of the solute in 100 mL of solution. Find the volume percent.";
has(drawn(VOLUME), "25 vol%", "25 mL in 100 mL of solution is 25 volume percent");

const DENSITY = "A 2 M solution of a solute of molar mass 40 g/mol has density 1.2 g/mL. Find the molality.";
const solventKg = (1.2 * 1000 - 2 * 40) / 1000;
has(drawn(DENSITY), `m=${Number((2 / solventKg).toFixed(3))} mol/kg`, "molality uses the stated density");

declined("Convert a 2 M solution of molar mass 40 g/mol to molality.", "a molarity to molality conversion without density is rejected");
declined("Dilute 100 mL of 2 M solution. Find the final molarity.", "dilution without a final volume is rejected");
declined("The mole fractions are x_A = 0.4 and x_B = 0.4.", "mole fractions that do not sum to one are rejected");
declined("A solution contains 0 mol of solute in a solution volume of 2 L. Find the molarity.", "a zero amount is rejected");

const HENRY = "Use Henry's law p = k_H x. The mole fraction of the dissolved gas is 0.02 and k_H = 200 kPa at fixed temperature. Find the gas partial pressure.";
const henry = drawn(HENRY);
has(henry, "p=4 kPa", "0.02 times 200 kPa is 4 kPa");
has(henry, "x=0.02", "the dissolved mole fraction is labelled");
has(henry, "p=kH*x", "the declared pressure convention is labelled");
has(henry, "T fixed", "Henry's law keeps temperature fixed");
has(henry, "display scaled", "the Henry line says its axis is display-scaled");
check(henry !== null && henry.expressions.some((expression) => expression.includes("200") && expression.includes("*x")), "the Henry line is k_H times x");

const HENRY_ZERO = "Henry's law is p = k_H x with k_H = 200 kPa. The partial pressure is zero. Find the dissolved mole fraction at this fixed temperature.";
const henryZero = drawn(HENRY_ZERO);
has(henryZero, "p=0 kPa", "zero partial pressure gives zero pressure");
has(henryZero, "x=0", "the zero-pressure limit is zero mole fraction");

const HENRY_C = "Henry's law is written c = k_H p. k_H = 0.034 mol/(L kPa) and the gas partial pressure is 20 kPa. Find c.";
has(drawn(HENRY_C), `c=${Number((0.034 * 20).toFixed(3))} mol/L`, "the declared concentration convention uses partial pressure");

declined("Use Henry's law p = k_H x. The mole fraction is 1.2 and k_H = 200 kPa. Find the partial pressure.", "a mole fraction above one is rejected");
declined("The total pressure of the mixture is 100 kPa. Henry's law is p = k_H x with k_H = 200 kPa. Find the dissolved mole fraction.", "total pressure is not the gas partial pressure");
declined("Henry's law is p = k_H x with k_H = -5 kPa and mole fraction 0.02.", "a negative Henry constant is rejected");
declined("Apply Henry's law. k_H = 200 kPa and the mole fraction is 0.02.", "an undeclared Henry convention is rejected");

const RAOULT = "Two volatile liquids A and B follow Raoult's law. The vapour pressure of pure A is 100 kPa and the vapour pressure of pure B is 50 kPa. x_A = 0.4. Find p_A, p_B, the total pressure and the vapour mole fraction y_A.";
const raoult = drawn(RAOULT);
const pA = 0.4 * 100;
const pB = 0.6 * 50;
const total = pA + pB;
has(raoult, `p_A=${pA} kPa`, "partial pressure of A is 40 kPa");
has(raoult, `p_B=${pB} kPa`, "partial pressure of B is 30 kPa");
has(raoult, `p_total = ${total}`, "the total pressure is 70 kPa");
has(raoult, `y_A=${Number((pA / total).toFixed(3))}`, "the vapour mole fraction is 4/7");
has(raoult, "display scaled", "the Raoult axis says it is display-scaled");
check(raoult !== null && raoult.expressions.some((expression) => expression.includes("100*x")), "the partial-pressure line is p°_A x");
check(Math.abs(pA / total - 4 / 7) < 1e-12, "40/70 is exactly 4/7");

const NONVOLATILE = "A nonvolatile solute has mole fraction of the solute 0.1. The pure solvent vapour pressure is 100 kPa. The solute contributes no vapour pressure.";
const nonvolatile = drawn(NONVOLATILE);
has(nonvolatile, "p=90 kPa", "the solution pressure is 0.9 times the pure solvent");
has(nonvolatile, "solute p=0", "a nonvolatile solute adds no vapour pressure");
has(nonvolatile, "display scaled", "the nonvolatile line says it is display-scaled");

declined("A nonvolatile solute has mole fraction of the solute 1.2. The pure solvent vapour pressure is 100 kPa.", "an impossible solute fraction is rejected");
declined("Two volatile liquids A and B follow Raoult's law. x_A = 0.4. Find the total pressure.", "missing pure vapour pressures are not invented");

const POSITIVE = "Which mixture shows positive deviation from Raoult's law: ethanol and acetone, or chloroform and acetone? Draw the vapour pressure curves.";
const positive = drawn(POSITIVE);
has(positive, "schematic", "a deviation sketch says it is schematic");
has(positive, "not measured p", "deviation heights are not presented as measured pressures");
check(positive !== null && !positive.labels.some((label) => /azeotrope/i.test(label)), "a deviation alone does not create an azeotrope");

const NEGATIVE = "Chloroform and acetone show negative deviation from Raoult's law. Draw the vapour pressure versus composition graph.";
has(drawn(NEGATIVE), "schematic", "a negative deviation sketch says it is schematic");
has(drawn(NEGATIVE), "not measured p", "a negative deviation is not a measured pressure");

const IDEAL_SHAPE = "Draw the vapour pressure graph of an ideal solution according to Raoult's law.";
has(drawn(IDEAL_SHAPE), "schematic", "a symbolic ideal graph says it is schematic");
has(drawn(IDEAL_SHAPE), "not measured p", "symbolic ideal heights are not measured pressures");

declined("The solution shows positive deviation from Raoult's law. Draw the azeotrope.", "an azeotrope is not inferred from a deviation alone");

const LOWERING = "The relative lowering of vapour pressure is required. The mole fraction of the solute is 0.1. The pure solvent vapour pressure is 80 kPa.";
const lowering = drawn(LOWERING);
has(lowering, "dp/p=0.1", "relative lowering equals the solute mole fraction");
has(lowering, "p=72 kPa", "the solvent vapour pressure falls by x times p°");
has(lowering, "nonvolatile", "the solute is treated as nonvolatile");

const BOILING = "The boiling point of a dilute solution is raised. Kb = 0.52 K kg/mol and the molality is 0.5 mol/kg. i = 1.";
const boiling = drawn(BOILING);
has(boiling, "dTb=0.26 K", "boiling elevation is 0.26 K");
has(boiling, "boiling up", "boiling moves upward");
has(boiling, "Tb not given", "the pure solvent boiling point is not invented");

const BOILING_REF = "The boiling point of the pure solvent is 373.15 K. Kb = 0.52 K kg/mol and the molality is 0.5 mol/kg. i = 1. Find the solution boiling point.";
has(drawn(BOILING_REF), "Tb=373.41 K", "the solution boils 0.26 K above the stated solvent boiling point");

const FREEZING = "The freezing point of a dilute solution is depressed. Kf = 1.86 K kg/mol and the molality is 0.2 mol/kg.";
const freezing = drawn(FREEZING);
has(freezing, "dTf=0.372 K", "freezing depression is 0.372 K");
has(freezing, "freezing down", "freezing moves downward");

declined("The boiling point decreases. Kb = 0.52 K kg/mol and the molality is 0.5 mol/kg.", "a downward boiling shift is rejected");
declined("The freezing point increases. Kf = 1.86 K kg/mol and the molality is 0.2 mol/kg.", "an upward freezing shift is rejected");
declined("Find the boiling point elevation. The molality is 0.5 mol/kg.", "a missing ebullioscopic constant is rejected");

const OSMOTIC = "The osmotic pressure of a 0.1 M glucose solution at 300 K is (R = 0.083 L bar/K mol).";
const osmotic = drawn(OSMOTIC);
has(osmotic, "pi=2.49 bar", "osmotic pressure is 2.49 bar");
has(osmotic, "solvent", "solvent crosses the membrane");
has(osmotic, "no solute", "the solute does not cross the membrane");
has(osmotic, "T=300 K", "the temperature is absolute");

const WARM = "The osmotic pressure of a 0.1 M glucose solution at 27°C is R = 0.083 L bar/K mol.";
has(drawn(WARM), "T=300.15 K", "27°C is converted to kelvin");
has(drawn(WARM), `pi=${Number((0.1 * 0.083 * 300.15).toFixed(3))} bar`, "osmotic pressure uses the kelvin temperature");

declined("The osmotic pressure of a 0.5 molal glucose solution at 300 K is R = 0.083 L bar/K mol.", "osmotic pressure is not calculated from molality");
declined("The osmotic pressure of a 0.1 M electrolyte solution at 300 K is R = 0.083 L bar/K mol.", "an electrolyte without a van't Hoff factor is rejected");

const MASS = "1.2 g of a non volatile solute dissolved in 50 g of water lowers the freezing point by 0.372 K. Calculate the molar mass of the solute (Kf = 1.86 K kg/mol).";
const expectedMolarMass = Number(((1 * 1.86 * 1.2 * 1000) / (0.372 * 50)).toFixed(3));
has(drawn(MASS), `M=${expectedMolarMass} g/mol`, "the freezing-point molar mass is 120 g/mol");
has(drawn(MASS), "i=1", "a nonelectrolyte is not treated as dissociated");

const DISSOCIATION = "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. Find the van't Hoff factor and the apparent molar mass.";
const dissociationI = 1 + (2 - 1) * 0.5;
const dissociation = drawn(DISSOCIATION);
has(dissociation, `i=${Number(dissociationI.toFixed(3))}`, "i = 1 + (nu - 1) alpha");
has(dissociation, `Mapp=${Number((180 / dissociationI).toFixed(3))} g/mol`, "apparent molar mass is the true mass divided by i");
has(dissociation, "Mapp < M", "dissociation makes the apparent molar mass smaller");

const ASSOCIATION = "The true molar mass is 60 g/mol. The solute associates as 2 monomers with alpha = 0.8. Find the apparent molar mass.";
const associationI = 1 - 0.8 + 0.8 / 2;
const association = drawn(ASSOCIATION);
has(association, `i=${Number(associationI.toFixed(3))}`, "association uses 1 - alpha + alpha/k");
has(association, `Mapp=${Number((60 / associationI).toFixed(3))} g/mol`, "association raises the apparent molar mass");
has(association, "Mapp > M", "association is labelled as a larger apparent mass");

declined("The solute dissociates into 2 particles with alpha = 1.5. The true molar mass is 180 g/mol.", "a dissociation extent above one is rejected");
declined("The solute dissociates into 1 particles with alpha = 0.5. The true molar mass is 180 g/mol.", "a one-particle dissociation is rejected");
declined("The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5, but i = 3.", "an inconsistent van't Hoff factor is rejected");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("c05 solutions: concentration, Henry, Raoult, colligative properties, and van't Hoff checks passed");
