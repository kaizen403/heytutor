/** Supplied-but-unreadable values never become absent, defaults, or another role. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { buildElectrochemScene, parseCellNotation, cellEmf } from "../../src/chemistry/electrochemistry";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { readChemistryQuantity, readChemistryQuantityDeclaration, type ChemistryDimension, type ChemistryUnit } from "../../src/chemistry/quantityReader";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";

const builders = { atomic: buildAtomicRadiationScene, chemistryThermo: buildChemicalThermodynamicsScene,
  electrochemistry: buildElectrochemScene, kinetics: buildKineticsScene, solutionProperties: buildSolutionLessonScene,
  solutionGraphs: buildSolutionsGraphScene, thermoGraphs: buildThermoGraphScene, unitCell: buildUnitCellScene };
interface MatrixCase { id: string; family: keyof typeof builders; valid: string; invalid: string }
const cases: MatrixCase[] = [
  {
    "id": "adiabatic-q",
    "family": "chemistryThermo",
    "valid": "Using the first law, an adiabatic process has q = 0 J and w = 200 J. Show the energy account.",
    "invalid": "Using the first law, an adiabatic process has q = 500 kg and w = 200 J. Show the energy account."
  },
  {
    "id": "isochoric-w",
    "family": "chemistryThermo",
    "valid": "Using the first law, an isochoric process has q = 500 J and w = 0 J. Show the energy account.",
    "invalid": "Using the first law, an isochoric process has q = 500 J and w = 200 kg. Show the energy account."
  },
  {
    "id": "heat-capacity",
    "family": "chemistryThermo",
    "valid": "The heat capacity of a sample is 25 J K^-1. It is heated from 300 K to 310 K. Calculate the heat absorbed and draw the heat account.",
    "invalid": "The heat capacity of a sample is 25 kg. It is heated from 300 K to 310 K. Calculate the heat absorbed and draw the heat account."
  },
  {
    "id": "equilibrium-K",
    "family": "chemistryThermo",
    "valid": "The equilibrium constant is 2 at 300 K. Draw the standard Gibbs energy relation.",
    "invalid": "The equilibrium constant is 2 kg at 300 K. The standard Gibbs energy is -5 kJ/mol. Draw the relation."
  },
  {
    "id": "gas-pressure-duplicate",
    "family": "electrochemistry",
    "valid": "Pt | H2(g, 0.2 bar) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag. Draw the galvanic cell.",
    "invalid": "Pt | H2(g, 0.2 bar; pressure 0.3 bar) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag. Draw the galvanic cell."
  },
  {
    "id": "ion-concentration",
    "family": "electrochemistry",
    "valid": "Zn | Zn2+(aq, 0.1 M) || Cu2+(aq, 0.01 M) | Cu. Draw the galvanic cell.",
    "invalid": "Zn | Zn2+(aq, 0.1 kg) || Cu2+(aq, 0.01 M) | Cu. Draw the galvanic cell."
  },
  {
    "id": "half-life",
    "family": "kinetics",
    "valid": "The half life of a first order reaction is 20 min. What fraction of the reactant remains after 60 min?",
    "invalid": "The half life of a first order reaction is 20 kg. What fraction of the reactant remains after 60 min?"
  },
  {
    "id": "rate-constant",
    "family": "kinetics",
    "valid": "For a first order reaction, the rate constant is 0.0231 min^-1. Draw the concentration versus time graph.",
    "invalid": "For a first order reaction, the rate constant is 0.0231 kg and half life is 20 min. Draw the concentration versus time graph."
  },
  {
    "id": "initial-concentration",
    "family": "kinetics",
    "valid": "For a first order reaction, initial concentration of A is 2 M and rate constant is 0.0231 min^-1. Draw [A] versus time.",
    "invalid": "For a first order reaction, initial concentration of A is 2 kg and rate constant is 0.0231 min^-1. Draw [A] versus time."
  },
  {
    "id": "henry-constant",
    "family": "solutionProperties",
    "valid": "Use Henry's law p = k_H x. The mole fraction of the dissolved gas is 0.02 and k_H = 200 kPa at fixed temperature. Find the gas partial pressure.",
    "invalid": "Use Henry's law p = k_H x. The mole fraction of the dissolved gas is 0.02 and k_H = 200 kg at fixed temperature. Find the gas partial pressure."
  },
  {
    "id": "colligative-factor",
    "family": "solutionProperties",
    "valid": "The freezing point of a dilute solution is depressed. Kf = 1.86 K kg/mol and the molality is 0.2 mol/kg. i = 2.",
    "invalid": "The freezing point of a dilute solution is depressed. Kf = 1.86 K kg/mol and the molality is 0.2 mol/kg. i = 2 kg."
  },
  {
    "id": "titration-concentration",
    "family": "solutionGraphs",
    "valid": "25 mL of 0.1 M HCl is titrated with 0.1 M NaOH. Draw the titration curve and find the pH at the equivalence point.",
    "invalid": "Draw the titration curve of strong acid HCl with strong base NaOH. HCl concentration is 0.1 kg."
  },
  {
    "id": "vapour-pressure",
    "family": "solutionGraphs",
    "valid": "Two volatile liquids A and B form an ideal solution. The vapour pressure of pure A is 200 torr and that of pure B is 100 torr. Plot the vapour pressure against mole fraction.",
    "invalid": "Two volatile liquids A and B form an ideal solution. The vapour pressure of pure A is 200 kg and that of pure B is 100 torr. Plot the vapour pressure against mole fraction."
  },
  {
    "id": "activation-energy",
    "family": "thermoGraphs",
    "valid": "For an exothermic reaction the activation energy of the forward reaction is 60 kJ/mol and ΔH = -20 kJ/mol. Draw the energy profile diagram.",
    "invalid": "For an exothermic reaction the activation energy of the forward reaction is 60 kg and ΔH = -20 kJ/mol. Draw the energy profile diagram."
  },
  {
    "id": "gibbs-enthalpy",
    "family": "thermoGraphs",
    "valid": "For a reaction ΔH = 40 kJ/mol and ΔS = 100 J K^-1 mol^-1. Above what temperature will the reaction become spontaneous?",
    "invalid": "For a reaction ΔH = 40 kg and ΔS = 100 J K^-1 mol^-1. Above what temperature will the reaction become spontaneous?"
  },
  {
    "id": "maxwell-temperature",
    "family": "thermoGraphs",
    "valid": "Draw the Maxwell Boltzmann distribution of molecular speeds at 300 K and 600 K.",
    "invalid": "Draw the Maxwell Boltzmann distribution of molecular speeds. The temperature is 300 kg."
  },
  {
    "id": "unit-cell-edge",
    "family": "unitCell",
    "valid": "An element crystallises in fcc with edge length 400 pm and atomic mass 60 g/mol. Find the density of the element.",
    "invalid": "An element crystallises in fcc with edge length 400 kg, atomic radius 150 pm and atomic mass 60 g/mol. Find the density of the element."
  },
  {
    "id": "unit-cell-mass",
    "family": "unitCell",
    "valid": "An element crystallises in fcc with edge length 400 pm and atomic mass 60 g/mol. Find the density of the element.",
    "invalid": "An element crystallises in fcc with edge length 400 pm and atomic mass 60 kg. Find the density of the element."
  },
  {
    "id": "momentum",
    "family": "atomic",
    "valid": "An electron has momentum 1e-24 kg m/s and speed 1e6 m/s. Draw its de Broglie wavelength.",
    "invalid": "An electron has momentum 0 kg m s^-1 and speed 1e6 m/s. Draw its de Broglie wavelength."
  },
  {
    "id": "photoelectric-energy",
    "family": "atomic",
    "valid": "In the photoelectric effect, work function is 2 eV and photon energy is 3 eV. Draw the energy threshold.",
    "invalid": "In the photoelectric effect, work function is 2 eV and photon energy is unreadable. The frequency is 1e15 Hz. Draw the energy threshold."
  },
  {
    "id": "uncertainty-momentum",
    "family": "atomic",
    "valid": "Using Heisenberg uncertainty, uncertainty in position is 1e-10 m and uncertainty in momentum is 1e-24 kg m/s. Draw the uncertainty relation.",
    "invalid": "Using Heisenberg uncertainty, uncertainty in position is 1e-10 m and uncertainty in momentum is 1e-24 kg. Draw the uncertainty relation."
  }
];
const dimensions: Record<ChemistryDimension, ChemistryUnit> = {
  dimensionless: "1", time: "s", temperature: "K", temperature_delta: "K", length: "m", volume: "L", mass: "kg", amount: "mol", molar_mass: "g/mol", density: "g/cm^3", concentration: "mol/L", normality: "eq/L", molality: "mol/kg", pressure: "Pa", energy: "J", molar_energy: "J/mol", entropy: "J/K", molar_entropy: "J/(mol K)", heat_capacity: "J/K", molar_heat_capacity: "J/(mol K)", frequency: "Hz", speed: "m/s", momentum: "kg m/s", action: "J s", energy_length: "J m", potential: "V", current: "A", charge: "C", faraday_constant: "C/mol", avogadro_constant: "mol^-1", gas_constant: "J/(mol K)", rate_constant_first: "s^-1", rate_constant_zero: "mol/(L s)", rate_constant_second: "L/(mol s)", colligative_constant: "K kg/mol", concentration_pressure: "mol/(L atm)",
};
const failures: Array<{ name: string; message: string }> = [];
const evidence: unknown[] = [];
let passed = 0;
function test(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); failures.push({ name, message }); console.error(`FAIL ${name}: ${message}`); }
}
function drawable(document: SceneDocument | null): boolean { return !!document && document.visualDecision.mode !== "text_only"; }
function compiled(document: SceneDocument | null): void {
  assert(document, "valid source control must draw");
  const result = compileSceneDocument(document); assert(result.ok && result.renderScene, "valid source must compile");
  assert(document.quantities.every(quantity => Number.isFinite(quantity.value)), "all emitted physical values must be finite");
  for (const primitive of result.renderScene.primitives) for (const point of primitive.points) assert(Number.isFinite(point.x) && Number.isFinite(point.y));
}
for (const [dimension, unit] of Object.entries(dimensions) as [ChemistryDimension, ChemistryUnit][]) {
  const after = /\bvalue\s*=/;
  const sourceUnit = dimension === "rate_constant_zero" ? "mol/L s^-1" : unit;
  test(`reader/${dimension}/valid`, () => {
    const input = { question: `value = 2${dimension === "dimensionless" ? "" : " " + sourceUnit}.`, after, dimension, targetUnit: unit };
    const literal = readChemistryQuantity(input);
    assert(literal.ok, "known supported scalar/unit must still read"); assert.equal(literal.reading.value, 2);
    const result = readChemistryQuantityDeclaration({ ...input, owner: `fixture:${dimension}` });
    assert.equal(result.state, "valid", "a supported declaration remains valid");
    if (result.state === "valid") assert.equal(result.reading.value, 2);
  });
  test(`reader/${dimension}/truly-absent`, () => {
    const input = { question: "Find the value.", after, dimension };
    const literal = readChemistryQuantity(input);
    assert(!literal.ok && literal.code === "missing", "strict literal missing behavior is unchanged");
    const result = readChemistryQuantityDeclaration({ ...input, owner: `fixture:${dimension}` });
    assert.equal(result.state, "absent", "an absent declaration remains absent");
  });
  for (const payload of ["", "unreadable", "1e-"]) test(`reader/${dimension}/supplied-${payload || "empty"}`, () => {
    const question = `value = ${payload}${dimension === "dimensionless" ? "" : " " + sourceUnit};`;
    const result = readChemistryQuantityDeclaration({ question, after, dimension, targetUnit: unit, owner: `fixture:${dimension}` });
    assert.equal(result.state, "invalid", "a present unread declaration must not be reported absent");
  });
}


// Original UTF-16 spans and same-owner repeat authority are independent of family policy.
for (const [id, payload, expected, repeats] of [
  ["repeat-no-authority", "0.2 bar; pressure = 0.2 bar", "invalid", false],
  ["repeat-agree", "0.2 bar; pressure = 0.2 bar", "valid", true],
  ["repeat-converted", "0.2 bar; pressure = 20 kPa", "valid", true],
  ["repeat-conflict", "0.2 bar; pressure = 0.3 bar", "invalid", true],
  ["repeat-bad-sibling", "0.2 bar; pressure = unreadable", "invalid", true],
  ["zero-is-still-supplied", "0 bar", "valid", false],
] as const) test(`owner-span/${id}`, () => {
  const question = `⚗️ pressure = ${payload}.`;
  const result = readChemistryQuantityDeclaration({ question, after: /\bpressure\s*=/, dimension: "pressure", targetUnit: "bar", owner: "H2:anode:pressure", allowAgreeingRepeats: repeats });
  assert.equal(result.state, expected);
  assert.equal(result.owner, "H2:anode:pressure");
  for (const occurrence of result.occurrences) {
    assert(occurrence.cueSpan, "cue-bound declaration must preserve its original cue");
    assert.equal(question.slice(occurrence.cueSpan.start, occurrence.cueSpan.end), "pressure =");
    assert(occurrence.payloadSpan.start >= occurrence.cueSpan.end && occurrence.payloadSpan.end <= question.length);
    if (occurrence.read.ok) {
      const source = occurrence.read.reading.source;
      assert.equal(question.slice(source.span.start, source.span.end), source.text);
      assert(source.span.start >= occurrence.payloadSpan.start && source.span.end <= occurrence.payloadSpan.end);
    }
  }
  if (result.state === "valid") {
    assert.equal(result.occurrences.length, payload.includes(";") ? 2 : 1);
    assert.equal(result.reading.value, id === "zero-is-still-supplied" ? 0 : 0.2);
  } else if (result.state === "invalid") assert.equal(result.failure.code, result.code);
});
for (const [id, question, expected] of [
  ["asked-target", "Find the pressure from the amount and temperature.", "absent"],
  ["explicit-unknown", "The pressure is unknown.", "invalid"],
  ["explicit-empty", "pressure = ;", "invalid"],
] as const) test(`owner-state/${id}`, () => {
  const result = readChemistryQuantityDeclaration({ question, after: /\bpressure\b/, dimension: "pressure", targetUnit: "bar", owner: "gas:pressure" });
  assert.equal(result.state, expected);
});


for (const [id, prefix, payload] of [
  ["of", "An electron has a momentum of ", "0 kg m s^-1"],
  ["equals", "An electron has momentum equal to ", "unreadable"],
  ["is", "The electron momentum is ", "unreadable"],
  ["approximately", "An electron has momentum approximately ", "0 kg m s^-1"],
  ["about", "An electron has momentum about ", "1e- kg m/s"],
] as const) {
  const suffix = " and speed 1e6 m/s. Draw its de Broglie wavelength.";
  const valid = prefix + "1e-24 kg m/s" + suffix;
  const invalid = prefix + payload + suffix;
  test(`momentum-neighbor/${id}/positive`, () => compiled(buildAtomicRadiationScene(valid, [], false)));
  test(`momentum-neighbor/${id}/invalid-no-speed-default`, () => {
    assert(!drawable(buildAtomicRadiationScene(invalid, [], false)), invalid);
    assert(!drawable(synthesizeFamilyScene({ question: invalid })?.document ?? null), "family fallback must also decline");
  });
}


for (const [id, source, marker] of [
  ["adiabatic-assignment", "Using the first law, an adiabatic process has q = 500 J and w = 200 J. Show the energy account.", "q = 500 J"],
  ["adiabatic-is", "In an adiabatic process q is 500 J and w is 200 J. Apply the first law and show the energy account.", "q is 500 J"],
  ["adiabatic-separated", "The process is adiabatic; q = 500 J, w = 200 J. Draw the first law energy account.", "q = 500 J"],
  ["isochoric-assignment", "Using the first law, an isochoric process has q = 500 J and w = 200 J. Show the energy account.", "w = 200 J"],
  ["constant-volume-is", "During a constant volume process q = 500 J and w is 200 J. Draw the first law energy account.", "w is 200 J"],
  ["isochoric-separated", "The process is isochoric; q = 500 J, w = 200 J. Draw the first law energy account.", "w = 200 J"],
] as const) {
  const valid = source.replace(marker, marker.replace(/(?:500|200)/, "0"));
  test(`first-law-consistency/${id}/zero-positive`, () => compiled(buildChemicalThermodynamicsScene(valid, [], false)));
  test(`first-law-consistency/${id}/contradiction-refusal`, () => {
    assert(!drawable(buildChemicalThermodynamicsScene(source, [], false)), "readable source contradiction cannot be overwritten in strict mode");
    assert(!drawable(buildChemicalThermodynamicsScene(source, [], true)), "readable source contradiction cannot be overwritten in schematic mode");
    assert(!drawable(synthesizeFamilyScene({ question: source })?.document ?? null), "ordinary family fallback cannot overwrite readable source contradiction");
  });
}


for (const question of ["Find the pressure.", "Find the pressure?", "Find the pressure!", "What is the pressure."]) test(`owner-request-punctuation/${question}`, () => {
  const result = readChemistryQuantityDeclaration({question,after:/\bpressure\b/,dimension:"pressure",owner:"gas:pressure"});
  assert.equal(result.state, "absent", "terminal sentence punctuation is not a supplied decimal");
});
for (const connector of ["has a value of", "reads", "comes to"]) for (const payload of ["0 kg m s^-1", "1e-24 kg m/s"]) test(`supplied-momentum-inventory/${connector}/${payload}`, () => {
  const question = `An electron momentum ${connector} ${payload} and speed 1000 m/s. Draw de Broglie wavelength.`;
  // These legacy-unreadable connectors may safely refuse. They must not use
  // the speed while erasing a supplied momentum, whether zero or nonzero.
  assert(!drawable(buildAtomicRadiationScene(question, [], false)), question);
  assert(!drawable(synthesizeFamilyScene({question})?.document ?? null), "ordinary fallback may not erase the supplied momentum");
});
test("gas-phase/wrong-dimensional-payload-no-pressure-word", () => {
  const question = "Pt | H2(g, 0.2 kg) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag. Draw the galvanic cell.";
  assert(!drawable(buildElectrochemScene(question, [], false)));
  assert(!drawable(synthesizeFamilyScene({question})?.document ?? null));
});


for (const question of [
  "Find the momentum using speed 1000 m/s.",
  "What is the momentum of an electron whose speed is 1000 m/s?",
]) test(`asked-owner-foreign-value/${question}`, () => {
  const result = readChemistryQuantityDeclaration({question,after:/\bmomentum\b/,dimension:"momentum",owner:"particle momentum"});
  assert.equal(result.state,"absent","another owner supplying speed does not supply momentum");
});
for (const question of [
  "An electron has speed 1e6 m/s. Find its momentum and draw its de Broglie wavelength.",
  "Find the de Broglie wavelength and momentum of an electron from speed 1e6 m/s.",
]) test(`asked-momentum-speed-derived/${question}`, () => compiled(buildAtomicRadiationScene(question,[],false)));


for (const connector of ["has a value of", "reads", "comes to"]) for (const mode of ["adiabatic", "isochoric"]) test(`first-law-owner-verb/${mode}/${connector}`, () => {
  const question = mode === "adiabatic"
    ? `For an adiabatic process, q ${connector} 500 kg and w = 200 J. Show the first law energy account.`
    : `For an isochoric process, q = 500 J and w ${connector} 200 kg. Show the first law energy account.`;
  assert(!drawable(buildChemicalThermodynamicsScene(question,[],false)), question);
  assert(!drawable(synthesizeFamilyScene({question})?.document ?? null));
});
for (const [id,valid,invalid] of [
 ["deltaU","Using the first law, q = 500 J and w = 200 J. Internal energy change is 700 J. Draw the energy account.","Using the first law, q = 500 J and w = 200 J. Internal energy change is 900 kg. Draw the energy account."],
 ["deltaPV","Using the first law, q = 500 J and w = 200 J. Δ(PV) = 100 J. Draw the energy account.","Using the first law, q = 500 J and w = 200 J. Δ(PV) = 100 kg. Draw the energy account."],
 ["external-pressure","Using the first law, an adiabatic process has external pressure 100 kPa and w = 200 J. Draw the energy account.","Using the first law, an adiabatic process has external pressure 100 kg and w = 200 J. Draw the energy account."],
 ["by-volume","Using the first law, q = 500 J and w = -100 J. The gas expands by 1 L against external pressure 100 kPa. Draw the energy account.","Using the first law, q = 500 J and w = -100 J. The gas expands by 1 kg against external pressure 100 kPa. Draw the energy account."],
 ["systems-from-volume","A closed system undergoes isothermal expansion from 1 L to 2 L. Draw the thermodynamic system boundary.","A closed system undergoes isothermal expansion from 1 kg to 2 L. Draw the thermodynamic system boundary."],
 ["systems-to-volume","A closed system undergoes isothermal expansion from 1 L to 2 L. Draw the thermodynamic system boundary.","A closed system undergoes isothermal expansion from 1 L to 2 kg. Draw the thermodynamic system boundary."],
] as const) {
 test(`optional-owner/${id}/positive`,()=>compiled(buildChemicalThermodynamicsScene(valid,[],false)));
 test(`optional-owner/${id}/invalid-refusal`,()=>{
  assert(!drawable(buildChemicalThermodynamicsScene(invalid,[],false)),invalid);
  assert(!drawable(synthesizeFamilyScene({question:invalid})?.document??null));
 });
}
test("asked-momentum-given-foreign-speed/state",()=>{
 const question="Find the momentum given the speed 1000 m/s.";
 assert.equal(readChemistryQuantityDeclaration({question,after:/\bmomentum\b/,dimension:"momentum",owner:"particle momentum"}).state,"absent");
});
test("asked-momentum-given-foreign-speed/actual-positive",()=>compiled(buildAtomicRadiationScene("Find the de Broglie wavelength and momentum given the electron speed 1e6 m/s.",[],false)));
for(const payload of ["zero kg m/s","zero kg m s^-1"])test(`momentum-word-scalar/${payload}/no-default`,()=>{
 const question=`An electron has momentum ${payload} and speed 1e6 m/s. Draw its de Broglie wavelength.`;
 assert(!drawable(buildAtomicRadiationScene(question,[],false)),question);
 assert(!drawable(synthesizeFamilyScene({question})?.document??null));
});
test("titration-long-owner/wrong-unit-refusal",()=>{
 const question="Draw the titration curve of HCl with NaOH. The concentration of hydrochloric acid is 0.1 kg.";
 assert(!drawable(buildSolutionsGraphScene(question,[],false)));
});


test("first-law-stated-DU/readable-conflict-refusal",()=>{
 const question="Using the first law, q = 500 J and w = 200 J. Internal energy change is 900 J. Draw the energy account.";
 assert(!drawable(buildChemicalThermodynamicsScene(question,[],false)));
 assert(!drawable(synthesizeFamilyScene({question})?.document??null));
});


for(const question of [
 "Using ΔU=q+w, an adiabatic process has q=0 J and w=200 J. Draw the energy account.",
 "Using ΔU=q+w, a process has q=500 J and w=200 J. Draw the energy account.",
])test(`law-symbol-reference/baseline-positive/${question}`,()=>compiled(buildChemicalThermodynamicsScene(question,[],false)));


for(const reference of ["ΔU=q+w+500 kg","ΔU=q+w = 900 kg","ΔU=q+w and equals 900 kg","w=-Pext ΔV+500 kg","w=-Pext ΔV and equals 900 kg"])test(`law-reference-extended-value/${reference}/refusal`,()=>{
 const question=`Using the first law ${reference}, a process has q=500 J and w=200 J. Draw the energy account.`;
 assert(!drawable(buildChemicalThermodynamicsScene(question,[],false)),question);
 assert(!drawable(synthesizeFamilyScene({question})?.document??null));
});


for(const [id,family,valid,invalid] of [
 ["pure-solvent-temperature","solutionProperties","A solution has molality 0.5 mol/kg and Kb = 0.52 K kg/mol. The boiling point of pure solvent is 373 K. Calculate boiling point elevation.","A solution has molality 0.5 mol/kg and Kb = 0.52 K kg/mol. The boiling point of pure solvent is 373 kg. Calculate boiling point elevation."],
 ["true-molar-mass","solutionProperties","1 g of a non-volatile solute dissolved in 100 g of water lowers the freezing point by 0.5 K. Kf = 1.86 K kg/mol. The true molar mass is 37.2 g/mol. Find molar mass.","1 g of a non-volatile solute dissolved in 100 g of water lowers the freezing point by 0.5 K. Kf = 1.86 K kg/mol. The true molar mass is 37.2 kg. Find molar mass."],
 ["stated-deltaT","solutionGraphs","Draw vapour pressure curves for boiling point elevation. The boiling point elevation is 2 K.","Draw vapour pressure curves for boiling point elevation. The boiling point elevation is 2 kg."],
] as const){
 test(`optional-solution/${id}/positive`,()=>compiled(builders[family](valid,[],false)));
 test(`optional-solution/${id}/invalid-refusal`,()=>{
  assert(!drawable(builders[family](invalid,[],false)),invalid);
  assert(!drawable(builders[family](invalid,[],true)),"schematic may not erase unread supplieddata");
  assert(!drawable(synthesizeFamilyScene({question:invalid})?.document??null));
 });
}


for(const connector of ["reads","comes to"])test(`half-life-supplied-owner/${connector}/invalid-refusal`,()=>{
 const question=`For a first order reaction, the rate constant k = 0.0231 min^-1. The half life ${connector} 20 kg. Draw [A]/[A]0 versus time.`;
 assert(!drawable(buildKineticsScene(question,[],false)),question);
 assert(!drawable(buildKineticsScene(question,[],true)),"schematic mode cannot erase half-life source");
 assert(!drawable(synthesizeFamilyScene({question})?.document??null));
});

for (const row of cases) {
  const build = builders[row.family];
  const valid = build(row.valid, [], false);
  const strict = build(row.invalid, [], false);
  const schematic = build(row.invalid, [], true);
  const ordinary = synthesizeFamilyScene({ question: row.invalid })?.document ?? null;
  evidence.push({ ...row, positiveDraws: drawable(valid), strictDraws: drawable(strict), schematicDraws: drawable(schematic), ordinaryDraws: drawable(ordinary), badQuantities: strict?.quantities ?? [], badLabels: strict?.entities.flatMap(entity => entity.label ? [entity.label] : []) ?? [], badCaption: strict?.annotations.find(annotation => annotation.id === "figure_caption")?.text });
  test(`${row.id}/positive`, () => compiled(valid));
  test(`${row.id}/strict-refusal`, () => assert(!drawable(strict), "supplied unread value cannot become a default or derived value"));
  test(`${row.id}/schematic-refusal`, () => assert(!drawable(schematic), "schematic mode cannot erase supplied data"));
  test(`${row.id}/ordinary-family-refusal`, () => assert(!drawable(ordinary), "ordinary family fallback cannot bypass the refusal"));
}

const absent = [
  ["adiabatic-heat", "chemistryThermo", "Using the first law, an adiabatic process has w = 200 J. Show the energy account."],
  ["isochoric-work", "chemistryThermo", "Using the first law, an isochoric process has q = 500 J. Show the energy account."],
  ["rate-from-half-life", "kinetics", "The half life of a first order reaction is 20 min. What fraction of the reactant remains after 60 min?"],
  ["momentum-from-speed", "atomic", "An electron has speed 1e6 m/s. Draw its de Broglie wavelength."],
  ["qualitative-titration", "solutionGraphs", "Draw the titration curve of a weak acid with a strong base and mark the half equivalence point."],
  ["qualitative-raoult", "solutionGraphs", "Draw the vapour-pressure graph of an ideal solution according to Raoult's law."],
  ["vanthoff-factor", "solutionProperties", "The freezing point of a dilute solution is depressed. Kf = 1.86 K kg/mol and the molality is 0.2 mol/kg."],
  ["qualitative-maxwell", "thermoGraphs", "Draw the Maxwell Boltzmann distribution of molecular speeds at two temperatures."],
  ["symbolic-unit-cell", "unitCell", "An element crystallises in a face centred cubic lattice. Draw the unit cell and find the number of atoms per unit cell."],
] as const;
for (const [id, family, question] of absent) test(`absent/${id}/preserved`, () => compiled(builders[family](question, [], false)));

for (const [id, payload] of [
  ["single", "0.2 bar"], ["agreeing-repeated", "0.2 bar; pressure 0.2 bar"],
  ["agreeing-converted", "0.2 bar; pressure 20 kPa"],
] as const) test(`pressure/${id}/correct`, () => {
  const question = `Pt | H2(g, ${payload}) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag. Draw the galvanic cell.`;
  const spec = parseCellNotation(question); assert(spec);
  assert.equal(spec.anode.concentrations.H2, 0.2, "hydrogen activity must retain the supplied gas pressure");
  const result = cellEmf(spec); assert(result && result.e !== null);
  // H2 is consumed by the cell reaction, so Q = 1 / p(H2) at unit ion activities.
  assert.equal(result.e, Number((0.8 - 0.0591 * Math.log10(1 / 0.2) / 2).toFixed(4)));
  compiled(buildElectrochemScene(question, [], false));
});
test("pressure/truly-absent-retains-standard-state", () => {
  const spec = parseCellNotation("Pt | H2(g) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag. Draw the galvanic cell.");
  assert(spec); assert.equal(spec.anode.concentrations.H2 ?? 1, 1);
});

for (const question of [
  "At T1 = 300 K, k1 = 0.02 s^-1; at T2 = 310 K, k2 = 0.07 s^-1. Draw the Arrhenius plot and calculate the activation energy.",
  "At T2 = 310 K, k2 = 0.07 s^-1; at T1 = 300 K, k1 = 0.02 s^-1. Draw the Arrhenius plot and calculate the activation energy.",
  "k2 = 0.07 s^-1 at T2 = 310 K and k1 = 0.02 s^-1 at T1 = 300 K. Draw the Arrhenius plot and calculate the activation energy.",
  "k_2 = 0.07 s^-1 at T2 = 310 K; k_1 = 0.02 s^-1 at T1 = 300 K. Draw the Arrhenius plot and calculate the activation energy.",
  "At T2 = 310 K the value of k2 = 0.07 s^-1, and at T1 = 300 K the value of k1 = 0.02 s^-1. Draw the Arrhenius plot and calculate the activation energy.",
]) test(`indexed-rate-role/${question}`, () => {
  const spec = kineticsFromStem(question); assert(spec?.arrhenius, "complete indexed source data must not decline");
  assert.equal(spec.arrhenius.k1, 0.02); assert.equal(spec.arrhenius.k2, 0.07);
  assert.equal(spec.arrhenius.T1, 300); assert.equal(spec.arrhenius.T2, 310);
  const solved = solveKinetics(spec); assert(solved.Ea !== null);
  assert(Math.abs(solved.Ea - 8.314 * Math.log(3.5) / (1 / 300 - 1 / 310)) < 1e-6);
  compiled(buildKineticsScene(question, [], false));
});


// Numbered owners retain their labels even when index1 has the higher value;
// sorting by scalar or encounter order is not source ownership.
for (const question of [
  "At T1 = 310 K, k1 = 0.07 s^-1; at T2 = 300 K, k2 = 0.02 s^-1. Draw the Arrhenius plot and calculate the activation energy.",
  "At T2 = 300 K, k2 = 0.02 s^-1; at T1 = 310 K, k1 = 0.07 s^-1. Draw the Arrhenius plot and calculate the activation energy.",
]) test(`indexed-rate-role/high-index1/${question}`, () => {
  const spec = kineticsFromStem(question); assert(spec?.arrhenius);
  assert.equal(spec.arrhenius.k1, 0.07); assert.equal(spec.arrhenius.k2, 0.02);
  assert.equal(spec.arrhenius.T1, 310); assert.equal(spec.arrhenius.T2, 300);
  const solved = solveKinetics(spec); assert(solved.Ea !== null);
  assert(Math.abs(solved.Ea - 8.314 * Math.log(3.5) / (1 / 300 - 1 / 310)) < 1e-6);
  compiled(buildKineticsScene(question, [], false));
});

// Existing qualitative/reference owners must survive stricter supplied-value admission.
// The unchanged aggregate family gate independently checks the mechanism labels.
const referenceOwnerRegressions: ReadonlyArray<{ id: string; family: keyof typeof builders; question: string; expectedDraw: boolean }> = [
  {
    "id": "oldgate-mechanism-two-step",
    "family": "thermoGraphs",
    "question": "An exothermic reaction proceeds in two steps: A → I is slow with ΔH = +ve and I → P is fast with ΔH = −ve. Draw the reaction coordinate diagram showing the intermediate and the rate determining step.",
    "expectedDraw": true
  },
  {
    "id": "oldgate-mechanism-three-step",
    "family": "thermoGraphs",
    "question": "Reactant A converts to product D through the given mechanism with net evolution of heat: A → B slow, ΔH = +ve; B → C fast, ΔH = −ve; C → D fast, ΔH = −ve. Which energy profile represents this mechanism?",
    "expectedDraw": true
  },
  {
    "id": "oldgate-freezing-heading",
    "family": "solutionGraphs",
    "question": "Depression of freezing point: draw the vapour pressure curve of the solvent and the solution showing ΔT_f.",
    "expectedDraw": true
  },
  {
    "id": "ordinary-boiling-absence-control",
    "family": "solutionGraphs",
    "question": "Draw vapour pressure curves for boiling point elevation.",
    "expectedDraw": true
  },
  {
    "id": "mechanism-extra-unread-activation-owner",
    "family": "thermoGraphs",
    "question": "An exothermic reaction proceeds in two steps: A → I is slow with ΔH = +ve and I → P is fast with ΔH = −ve. Draw the reaction coordinate diagram showing the intermediate and the rate determining step. The activation energy is 20 kg.",
    "expectedDraw": false
  },
  {
    "id": "mechanism-damaged-step-enthalpy",
    "family": "thermoGraphs",
    "question": "Reactant A converts to product D through the given mechanism with net evolution of heat: A → B slow, ΔH = 20 kg; B → C fast, ΔH = −ve; C → D fast, ΔH = −ve. Which energy profile represents this mechanism?",
    "expectedDraw": false
  },
  {
    "id": "freezing-colon-stated-invalid",
    "family": "solutionGraphs",
    "question": "Depression of freezing point: 2 kg. Draw the vapour pressure curve of the solvent and the solution showing ΔT_f.",
    "expectedDraw": false
  },
  {
    "id": "freezing-heading-plus-unread-independent-delta",
    "family": "solutionGraphs",
    "question": "Depression of freezing point: draw the vapour pressure curve of the solvent and the solution showing ΔT_f. The freezing point depression is 2 kg.",
    "expectedDraw": false
  },
  {
    "id": "freezing-heading-plus-valid-independent-delta",
    "family": "solutionGraphs",
    "question": "Depression of freezing point: draw the vapour pressure curve of the solvent and the solution showing ΔT_f. The freezing point depression is 2 K.",
    "expectedDraw": true
  }
];
for (const row of referenceOwnerRegressions) {
  for (const schematic of [false, true]) test(`reference-owner/${row.id}/${schematic ? "schematic" : "strict"}`, () => {
    const document = builders[row.family](row.question, [], schematic);
    if (row.expectedDraw) compiled(document);
    else assert(!drawable(document), "a qualitative reference cannot erase a supplied-invalid owner");
  });
  test(`reference-owner/${row.id}/ordinary-family`, () => {
    const document = synthesizeFamilyScene({ question: row.question })?.document ?? null;
    if (row.expectedDraw) compiled(document);
    else assert(!drawable(document), "ordinary fallback cannot erase a supplied-invalid owner");
  });
}

// A qualitative sign witness owns no independent numeric enthalpy.
const nonWitnessedEnthalpy = "An exothermic reaction proceeds in two steps: A → I is slow with ΔH = +ve and I → P is fast with ΔH = −ve. Draw the reaction coordinate diagram showing the intermediate and the rate determining step. The overall enthalpy change is +40 kJ/mol.";
for (const schematic of [false, true]) test(`reference-owner/nonwitnessed-physical-enthalpy/${schematic ? "schematic" : "strict"}`, () => {
  assert(!drawable(buildThermoGraphScene(nonWitnessedEnthalpy, [], schematic)), "an extra physical enthalpy cannot vanish behind qualitative signs");
});
test("reference-owner/nonwitnessed-physical-enthalpy/ordinary", () => {
  assert(!drawable(synthesizeFamilyScene({ question: nonWitnessedEnthalpy })?.document ?? null));
});
const hyphenatedMechanismRequest = "An exothermic reaction proceeds in two steps: A → I is slow with ΔH = +ve and I → P is fast with ΔH = −ve, identify the rate-determining step in the reaction coordinate diagram.";
for (const schematic of [false, true]) test(`reference-owner/hyphenated-request/${schematic ? "schematic" : "strict"}`, () => compiled(buildThermoGraphScene(hyphenatedMechanismRequest, [], schematic)));
test("reference-owner/hyphenated-request/ordinary", () => compiled(synthesizeFamilyScene({ question: hyphenatedMechanismRequest })?.document ?? null));

const sourceFiles = ["quantityReader", "sceneKit", "atomicRadiation", "chemicalThermodynamics", "electrochemistry", "kinetics", "solutionProperties", "solutionsGraphs", "thermoGraphs", "unitCell"];
const sourceHashes = Object.fromEntries(sourceFiles.map(name => [name + ".ts", createHash("sha256").update(readFileSync(new URL(`../../src/chemistry/${name}.ts`, import.meta.url))).digest("hex")]));
const output = { passed, failures, sourceHashes, dimensions: Object.keys(dimensions).length, families: Object.keys(builders).length, numericOwnerCases: cases.length, evidence, scope: "Source-only independent owner-declaration/family admission matrix with valid positive and absent controls. Declaration fixtures are byte-identical to red-gate-v1.ts; assertions use the new owner seam while strict literal valid/missing behavior remains unchanged. No built package, provider, DB, server, browser, production or coverage claim." };
const outAt = process.argv.indexOf("--out");
if (outAt >= 0) writeFileSync(process.argv[outAt + 1]!, JSON.stringify(output, null, 2) + "\n");
console.log(`verify-chemistry-supplied-quantity: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
