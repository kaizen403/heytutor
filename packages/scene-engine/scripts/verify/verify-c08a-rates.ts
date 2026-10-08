/**
 * Stoichiometric rate, initial-rate order, molecularity, and catalyst.
 * The expected rate 1.0e-3 is computed here from d[NO2]/dt / 4.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { buildReactionRatesScene, claimsReactionRates } from "../../src/chemistry/reactionRates";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const formation = 4.0e-3;
const reactionRate = formation / 4;
check(Math.abs(reactionRate - 1.0e-3) < 1e-12, "stoichiometric rate");

function labelsOf(question: string, claimed = true): string[] | null {
  check(claimsReactionRates(question) === claimed, `claim ${claimed} failed: ${question.slice(0, 64)}`);
  const document = buildReactionRatesScene(question, [], false);
  if (!claimed) {
    check(document === null, `should decline: ${question.slice(0, 64)}`);
    return null;
  }
  if (!document) {
    check(false, `drew nothing: ${question.slice(0, 64)}`);
    return null;
  }
  const compiled = compileSceneDocument(document);
  check(compiled.ok, `compile failed: ${question.slice(0, 48)}`);
  if (!compiled.ok || !compiled.renderScene) return null;
  return compiled.renderScene.primitives.flatMap((primitive) =>
    primitive.kind === "label" && primitive.text ? [primitive.text] : [],
  );
}

function has(labels: string[] | null, text: string): void {
  check(labels?.includes(text) === true, `missing ${text}; got ${labels?.join(" | ")}`);
}

const rate = "For the reaction 2 n2o5 -> 4 no2 + o2, d[no2]/dt = 4.0e-3 mol/L/s. Find the reaction rate. The reaction rate is not the species derivative.";
const rateLabels = labelsOf(rate);
has(rateLabels, "v=1.0e-3");
has(rateLabels, "not d[NO2]/dt");
has(rateLabels, "1/4 d[NO2]/dt");
has(rateLabels, "-1/2 d[N2O5]/dt");
check(rateLabels !== null && rateLabels.every((label) => !/d\[[^\]]+\]$/.test(label)), "a concentration change is not written as a rate");

const order = "When [A] is doubled, the initial rate doubles. When [B] is doubled, the rate becomes 4 times. The rate is in mol/L/s. Find the order in A, the order in B, and the units of the rate constant k.";
const orderLabels = labelsOf(order);
has(orderLabels, "order A=1");
has(orderLabels, "order B=2");
has(orderLabels, "L2/mol2 s");

const molecularity = "One elementary step a + b -> products is bimolecular, so the molecularity is 2. The order of the reaction is 1.5, which is not a molecularity.";
const molecularityLabels = labelsOf(molecularity);
has(molecularityLabels, "mol=2");
has(molecularityLabels, "order=1.5");

const catalyst = "A catalyst increases the rate of the reaction. It does not change the enthalpy. The figure is schematic.";
const catalystLabels = labelsOf(catalyst);
has(catalystLabels, "rate up");
has(catalystLabels, "dH same");
has(catalystLabels, "schematic");

const copied = "The reaction 2 n2o5 -> 4 no2 + o2 has order 2 because the coefficient is 2. State the order from the equation.";
check(claimsReactionRates(copied), "copied order is claimed");
check(buildReactionRatesScene(copied, [], false) === null, "order copied from the equation declines");

const probe = "The rate of a reaction doubles when the temperature is raised from 300 K to 310 K. R = 8.314 J/mol/K. Find the activation energy.";
check(!claimsReactionRates(probe), "300 K to 310 K probe stays on kinetics.ts");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c08a-rates: ok");
