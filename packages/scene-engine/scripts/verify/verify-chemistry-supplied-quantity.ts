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

// Extent and particle-count owners cannot disappear behind a separately supplied i.
const molarMassOwnerRegressions: ReadonlyArray<{ id: string; question: string; expectedDraw: boolean; expectedApparent: number | null }> = [
  {
    "id": "EXACT-alpha-damaged-exponent",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 2e-. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-1",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha =. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-2",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = NaN. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-3",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = unknown. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-4",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5 kg. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-5",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha reads 2e-. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-6",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with \u03b1 = 2e-. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-7",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with degree of dissociation is 2e-. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-8",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5 and alpha = 2e-. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-9",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 2e- and alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-10",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5 and alpha = 0.25. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-11",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = -0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-invalid-12",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 1.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-positive-1",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120.0
  },
  {
    "id": "ALPHA-positive-2",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with \u03b1 = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120.0
  },
  {
    "id": "ALPHA-positive-3",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with degree of dissociation is 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120.0
  },
  {
    "id": "ALPHA-positive-4",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120.0
  },
  {
    "id": "ALPHA-positive-5",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120.0
  },
  {
    "id": "ALPHA-positive-6",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0. i = 1. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 180.0
  },
  {
    "id": "ALPHA-positive-7",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 1. i = 2. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 90.0
  },
  {
    "id": "ALPHA-positive-8",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5 and alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120.0
  },
  {
    "id": "ALPHA-contradicts-i",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.25. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ASSOC-invalid-1",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 2e-. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ASSOC-invalid-2",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 0.5 kg. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ASSOC-invalid-3",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 0.5 and alpha = 0.25. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ASSOC-invalid-4",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 0.5 and alpha = 2e-. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ASSOC-positive-1",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "ASSOC-positive-2",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "ASSOC-positive-3",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 0.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "ASSOC-positive-4",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 0. i = 1. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 180
  },
  {
    "id": "ASSOC-positive-5",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 1. i = 0.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 360
  },
  {
    "id": "ASSOC-positive-6",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers with alpha = 0.5 and alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "NU-invalid-1",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. nu = 3 with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "NU-invalid-2",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. \u03bd = 3 with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "NU-invalid-3",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. nu = 2e- with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "NU-invalid-4",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. nu = 2 kg with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "NU-invalid-5",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. nu = 2.5 with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "MONOMERS-invalid-1",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers. k = 3 with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "MONOMERS-invalid-2",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers. k = 2e- with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "MONOMERS-invalid-3",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers. k = 2 kg with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "MONOMERS-invalid-4",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers. k = 2.5 with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "NU-agreeing-repeat",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. nu = 2 with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "MONOMERS-agreeing-repeat",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers. k = 2 with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "I-existing-invalid-1",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. i = 2e-. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "I-existing-invalid-2",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. i = 1.5 and i = 2. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "I-existing-invalid-3",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. i = unknown. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "I-existing-invalid-4",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. i = 1.5 kg. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "I-existing-agreeing",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. i = 1.5 and i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "TRUE-absence-no-alpha-no-i",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "TRUE-absence-plain-i",
    "question": "The true molar mass is 180 g/mol. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "ALPHA-natural-order-1",
    "question": "A solute has a true molar mass of 180 g/mol and dissociates into 2 particles. Its degree of dissociation is unreadable; i = 1.5. Calculate the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-natural-order-2",
    "question": "For dissociation into 2 particles, alpha has a value of 2e-. The true molar mass is 180 g/mol and i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-natural-order-3",
    "question": "The true molar mass is 180 g/mol. Association joins 2 monomers, but the degree of association is NaN. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-natural-order-4",
    "question": "With i = 1.5, find the apparent molar mass of a solute with true molar mass 180 g/mol. It dissociates into 2 particles with \u03b1 = 0.5 kg.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "ALPHA-natural-order-5",
    "question": "The true molar mass is 180 g/mol. It dissociates into 2 particles. Alpha = 0.5 is stated first; \u03b1 = 2e- is also stated. Given i = 1.5, calculate the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  }
];
for (const row of molarMassOwnerRegressions) {
  for (const mode of ["strict", "schematic", "ordinary"] as const) test(`molar-mass-owner/${row.id}/${mode}`, () => {
    const raw = mode === "ordinary" ? synthesizeFamilyScene({ question: row.question })?.document ?? null
      : buildSolutionLessonScene(row.question, [], mode === "schematic");
    if (!row.expectedDraw) { assert(!drawable(raw), "every supplied extent/count must be consumed or refuse before i fallback"); return; }
    compiled(raw);
    const result = compileSceneDocument(raw!);
    assert(result.ok && result.renderScene);
    assert(result.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === `M'=${row.expectedApparent} g/mol`), "actual rendered apparent mass must match the independently expected value");
  });
}

// Quantified noun siblings are separate declarations even without a repeated into/as.
const molarMassCountSiblings: ReadonlyArray<{ id: string; question: string; expectedDraw: boolean; expectedApparent: number | null }> = [
  {
    "id": "particle-conflict",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and 3 particles with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "particle-unread-sibling",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and unknown particles with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "particle-agreeing",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and 2 particles with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120.0
  },
  {
    "id": "particle-conflict-separate",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and into 3 particles with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "monomer-conflict",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers and 3 monomers with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "monomer-unread-sibling",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers and unknown monomers with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "monomer-agreeing",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers and 2 monomers with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240.0
  }
];
for (const row of molarMassCountSiblings) {
  for (const mode of ["strict", "schematic", "ordinary"] as const) test(`molar-mass-count-sibling/${row.id}/${mode}`, () => {
    const raw = mode === "ordinary" ? synthesizeFamilyScene({ question: row.question })?.document ?? null
      : buildSolutionLessonScene(row.question, [], mode === "schematic");
    if (!row.expectedDraw) { assert(!drawable(raw), "every process-count declaration must agree or refuse"); return; }
    compiled(raw);
    const result = compileSceneDocument(raw!);
    assert(result.ok && result.renderScene);
    assert(result.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === `M'=${row.expectedApparent} g/mol`));
  });
}

// A particle/monomer subject is not a count declaration of its foreign temperature.
const molarMassSubjectReferences: ReadonlyArray<{ id: string; question: string; expectedDraw: boolean; expectedApparent: number | null }> = [
  {
    "id": "particle-subject-foreign-temperature",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles that remain at 300 K, with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "monomer-subject-foreign-temperature",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers that remain at 300 K, with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  }
];
for (const row of molarMassSubjectReferences) {
  for (const mode of ["strict", "schematic", "ordinary"] as const) test(`molar-mass-subject-reference/${row.id}/${mode}`, () => {
    const raw = mode === "ordinary" ? synthesizeFamilyScene({ question: row.question })?.document ?? null
      : buildSolutionLessonScene(row.question, [], mode === "schematic");
    compiled(raw);
    const result = compileSceneDocument(raw!);
    assert(result.ok && result.renderScene);
    assert(result.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === `M'=${row.expectedApparent} g/mol`));
  });
}

// Coordinated unquantified noun references do not supply another count.
const repeatedMolarMassReferences: ReadonlyArray<{ id: string; question: string; expectedDraw: boolean; expectedApparent: number | null }> = [
  {
    "id": "D-exact-repeated-reference",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and the particles remain at 300 K, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "D-demonstrative-reference",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and these particles remain at 300 K, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "D-possessive-reference",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and its particles remain at 300 K, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "D-while-reference",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles while the particles remain at 300 K, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "D-semicolon-reference",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles; the particles remain at 300 K, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "D-agreement-count",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and 2 particles, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "D-conflicting-count",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and 3 particles, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "D-unknown-count",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and unknown particles, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "D-damaged-count",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and 2e- particles, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "D-unit-count",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and 2 kg particles, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "D-reference-no-foreign-value",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and the particles remain stable, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "D-reference-only-query",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles. Consider the particles, alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "A-exact-repeated-reference",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and the monomers remain at 300 K, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "A-demonstrative-reference",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and these monomers remain at 300 K, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "A-possessive-reference",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and its monomers remain at 300 K, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "A-while-reference",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers while the monomers remain at 300 K, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "A-semicolon-reference",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers; the monomers remain at 300 K, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "A-agreement-count",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and 2 monomers, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "A-conflicting-count",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and 3 monomers, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "A-unknown-count",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and unknown monomers, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "A-damaged-count",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and 2e- monomers, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "A-unit-count",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and 2 kg monomers, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": false,
    "expectedApparent": null
  },
  {
    "id": "A-reference-no-foreign-value",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers and the monomers remain stable, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "A-reference-only-query",
    "question": "The true molar mass is 180 g/mol. The solute associates from 2 monomers. Consider the monomers, alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "root-reference-1",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and the particles remain at 300 K, with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "root-reference-2",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles and particles remain at 300 K, with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "root-reference-3",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles , and the particles remain at 300 K, with alpha = 0.5. i = 1.5. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 120
  },
  {
    "id": "root-reference-4",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers and the monomers remain at 300 K, with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "root-reference-5",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers and monomers remain at 300 K, with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  },
  {
    "id": "root-reference-6",
    "question": "The true molar mass is 180 g/mol. The solute associates as 2 monomers , and these monomers remain at 300 K, with alpha = 0.5. i = 0.75. Find the apparent molar mass.",
    "expectedDraw": true,
    "expectedApparent": 240
  }
];
for (const row of repeatedMolarMassReferences) {
  for (const mode of ["strict", "schematic", "ordinary"] as const) test(`molar-mass-repeated-reference/${row.id}/${mode}`, () => {
    const raw = mode === "ordinary" ? synthesizeFamilyScene({ question: row.question })?.document ?? null
      : buildSolutionLessonScene(row.question, [], mode === "schematic");
    if (!row.expectedDraw) { assert(!drawable(raw), "all supplied process-count arguments still require a valid agreeing value"); return; }
    compiled(raw);
    const result = compileSceneDocument(raw!);
    assert(result.ok && result.renderScene);
    assert(result.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === `M'=${row.expectedApparent} g/mol`));
  });
}

// Every unavailable declaration remains owned, even beside a readable sibling.
const thermalDeclarations: readonly {id:string;question:string;expectedDraw:boolean}[] = [
  {
    "id": "heat-exact",
    "question": "The heat capacity is unknown; the heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "heat-unreadable",
    "question": "The heat capacity is unreadable. The heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "heat-reversed",
    "question": "The heat capacity is 20 J/K. The heat capacity is unknown. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "heat-sample",
    "question": "The sample heat capacity is unknown. Its heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "heat-equals",
    "question": "The heat capacity equals unknown; the heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "heat-cannot-read",
    "question": "The heat capacity cannot be read. The heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "temp-exact",
    "question": "At an unreadable temperature. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "temp-unknown",
    "question": "The temperature is unknown. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "temp-at-unknown",
    "question": "At an unknown temperature; at 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "temp-reversed",
    "question": "At 310 K, equilibrium constant is 2. The temperature is unreadable. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "temp-unreadable-reported",
    "question": "An unreadable temperature is reported. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "temp-cannot-read",
    "question": "The reported temperature cannot be read. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "entropy-unreadable",
    "question": "At an unreadable temperature. At 310 K, a reversible isothermal change absorbs q_rev = 1000 J. Draw the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "entropy-unknown-reversed",
    "question": "At 310 K, a reversible isothermal change absorbs q_rev = 1000 J. The temperature is unknown. Draw the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "heat-valid-single",
    "question": "The heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "heat-valid-molar",
    "question": "The molar heat capacity is 20 J/(mol K). n = 1 mol. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "heat-absence-ideal-gas",
    "question": "For an ideal gas, Cp = 29.1 J/(mol K). Show Cp - Cv = R and explain molar heat capacity.",
    "expectedDraw": true
  },
  {
    "id": "gibbs-valid-single",
    "question": "At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": true
  },
  {
    "id": "entropy-valid-single",
    "question": "At 310 K, a reversible isothermal change absorbs q_rev = 1000 J. Draw the entropy change.",
    "expectedDraw": true
  },
  {
    "id": "heat-unknown-only",
    "question": "The heat capacity is unknown. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "gibbs-unknown-only",
    "question": "At an unreadable temperature, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "heat-duplicate-agree",
    "question": "The heat capacity is 20 J/K; the heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "heat-duplicate-conflict",
    "question": "The heat capacity is 20 J/K; the heat capacity is 30 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "temperature-duplicate-agree",
    "question": "The temperature is 310 K. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": true
  },
  {
    "id": "temperature-duplicate-conflict",
    "question": "The temperature is 300 K. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "cp-unknown",
    "question": "For an ideal gas, Cp is unknown; Cp = 29.1 J/(mol K). Show Cp - Cv = R and explain molar heat capacity.",
    "expectedDraw": false
  },
  {
    "id": "cp-reversed-unknown",
    "question": "For an ideal gas, Cp = 29.1 J/(mol K). Cp is unreadable. Show Cp - Cv = R and explain molar heat capacity.",
    "expectedDraw": false
  },
  {
    "id": "cp-cannot-read",
    "question": "For an ideal gas, Cp cannot be read; Cp = 29.1 J/(mol K). Show Cp - Cv = R and explain molar heat capacity.",
    "expectedDraw": false
  },
  {
    "id": "entropy-temperature-absent",
    "question": "The entropy of the system is 10 J/K and entropy of the surroundings is 5 J/K. Draw the entropy of the universe.",
    "expectedDraw": true
  },
  {
    "id": "heat-named-symbol-control",
    "question": "The heat capacity C = 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "heat-supplied-role-after-request",
    "question": "Find q. The supplied heat capacity is unreadable; the heat capacity is 20 J/K. ΔT = 10 K with no phase change.",
    "expectedDraw": false
  },
  {
    "id": "temp-unspecified-prefix",
    "question": "At an unspecified temperature. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "T-symbol-is-unknown",
    "question": "T is unknown. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "T-symbol-cannot-read",
    "question": "T cannot be read. At 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "T-symbol-reverse-unknown",
    "question": "At 310 K, equilibrium constant is 2. T is unknown. Draw the standard Gibbs energy relation.",
    "expectedDraw": false
  },
  {
    "id": "T-symbol-readable",
    "question": "T is 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": true
  },
  {
    "id": "T-named-alias-readable",
    "question": "The temperature T = 310 K, equilibrium constant is 2. Draw the standard Gibbs energy relation.",
    "expectedDraw": true
  },
  {
    "id": "Cp-named-unknown",
    "question": "For an ideal gas, the molar heat capacity at constant pressure is unknown; Cp = 20 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "Cp-named-cannot-read",
    "question": "For an ideal gas, the molar heat capacity at constant pressure cannot be read; Cp = 20 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "Cp-named-reverse-unknown",
    "question": "For an ideal gas, Cp = 20 J/(mol K). The molar heat capacity at constant pressure is unknown. Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "Cp-named-readable-agrees",
    "question": "For an ideal gas, the molar heat capacity at constant pressure is 20 J/(mol K); Cp = 20 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": true
  },
  {
    "id": "Cp-named-readable-conflict",
    "question": "For an ideal gas, the molar heat capacity at constant pressure is 25 J/(mol K); Cp = 20 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "cv-conflict",
    "question": "For an ideal gas, Cp = 20 J/(mol K). Cv = 12 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "cv-unknown",
    "question": "For an ideal gas, Cp = 20 J/(mol K). Cv is unknown. Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "cv-agree",
    "question": "For an ideal gas, Cp = 20 J/(mol K). Cv = 11.686 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": true
  },
  {
    "id": "R-explicit-correct",
    "question": "For an ideal gas, Cp = 20 J/(mol K). R = 8.314 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": true
  },
  {
    "id": "R-explicit-conflict",
    "question": "For an ideal gas, Cp = 20 J/(mol K). R = 9 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "R-unknown-sibling",
    "question": "For an ideal gas, Cp = 20 J/(mol K). R is unknown; R = 8.314 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "cv-named-unknown",
    "question": "For an ideal gas, Cp = 20 J/(mol K). The molar heat capacity at constant volume is unknown. Draw the Cp and Cv relation.",
    "expectedDraw": false
  },
  {
    "id": "cv-named-agree",
    "question": "For an ideal gas, Cp = 20 J/(mol K). The molar heat capacity at constant volume is 11.686 J/(mol K). Draw the Cp and Cv relation.",
    "expectedDraw": true
  }
];
for (const row of thermalDeclarations) for (const mode of ["strict", "schematic", "ordinary"] as const) test(`thermal-all-declarations/${row.id}/${mode}`, () => {
  const raw = mode === "ordinary" ? synthesizeFamilyScene({question:row.question})?.document ?? null
    : buildChemicalThermodynamicsScene(row.question, [], mode === "schematic");
  if (!row.expectedDraw) { assert(!drawable(raw), "unreadable or contradictory same-owner input cannot be replaced by a readable sibling"); return; }
  compiled(raw);
});
const unavailableDeclarationControls: readonly {id:string;question:string;after:RegExp;dimension:ChemistryDimension;expected:"invalid"|"absent"}[] = [
  {id:"temperature-prefix",question:"At an unreadable temperature.",after:/\btemperature\b/,dimension:"temperature",expected:"invalid"},
  {id:"pressure-prefix",question:"The unspecified pressure is reported.",after:/\bpressure\b/,dimension:"pressure",expected:"invalid"},
  {id:"capacity-cannot-read",question:"The heat capacity cannot be read.",after:/\bheat capacity\b/,dimension:"heat_capacity",expected:"invalid"},
  {id:"momentum-cannot-read",question:"Its momentum cannot be read.",after:/\bmomentum\b/,dimension:"momentum",expected:"invalid"},
  {id:"requested-unknown-temperature",question:"Find the unknown temperature using the speed of the particle.",after:/\btemperature\b/,dimension:"temperature",expected:"absent"},
  {id:"requested-unspecified-pressure",question:"Calculate the unspecified pressure using the stated volume.",after:/\bpressure\b/,dimension:"pressure",expected:"absent"},
  {id:"requested-ordinary-temperature",question:"What is the temperature?",after:/\btemperature\b/,dimension:"temperature",expected:"absent"},
  {id:"supplied-role-after-request",question:"Find q. The supplied heat capacity is unreadable.",after:/\bheat capacity\b/,dimension:"heat_capacity",expected:"invalid"},
];
for (const row of unavailableDeclarationControls) test(`unavailable-owner/${row.id}`, () => {
  assert.equal(readChemistryQuantityDeclaration({...row,owner:`unavailable:${row.dimension}`}).state,row.expected);
});

// Every supplied owner is checked before calculating; no numeric literal is needed to be invalid.
const entropyDeltaDeclarations: readonly {id:string;question:string;expectedDraw:boolean}[] = [
  {
    "id": "deltaT-exact",
    "question": "The heat capacity is 20 J/K. ΔT = cannot be read; ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "deltaT-unknown",
    "question": "The sample heat capacity is 20 J/K. ΔT = unknown; ΔT = 10 K with no phase change. Calculate q.",
    "expectedDraw": false
  },
  {
    "id": "deltaT-reverse",
    "question": "The heat capacity is 20 J/K. ΔT = 10 K; ΔT = unreadable. There is no phase change. Find the heat.",
    "expectedDraw": false
  },
  {
    "id": "deltaT-named",
    "question": "The heat capacity is 20 J/K. delta t = unspecified; ΔT = 10 K with no phase change. Draw the heat account.",
    "expectedDraw": false
  },
  {
    "id": "deltaT-unicode",
    "question": "The heat capacity is 20 J/K. ∆ t = cannot be read. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "deltaT-wrong-unit",
    "question": "The heat capacity is 20 J/K. ΔT = 5 kg; ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "qrev-exact",
    "question": "At 300 K, a reversible isothermal change has q_rev = cannot be read; q_rev = 3000 J. Draw the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "qrev-unknown",
    "question": "At 300 K, a reversible isothermal change has qrev = unknown; qrev = 3000 J. Calculate the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "qrev-reverse",
    "question": "At 300 K, a reversible isothermal change has q_rev = 3000 J; q_rev = unreadable. Draw the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "qrev-unspecified",
    "question": "For a reversible isothermal entropy change at 300 K, q_rev = unspecified; q_rev = 3000 J. Draw the entropy account.",
    "expectedDraw": false
  },
  {
    "id": "qrev-sentence",
    "question": "At 300 K, a reversible isothermal change has q_rev = cannot be read. q_rev = 3000 J. Calculate its entropy change.",
    "expectedDraw": false
  },
  {
    "id": "qrev-wrong-unit",
    "question": "At 300 K, a reversible isothermal change has q_rev = 20 kg; q_rev = 3000 J. Find the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "delta-single",
    "question": "The heat capacity is 20 J/K. ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "delta-celsius",
    "question": "The heat capacity is 20 J/K. ΔT = -10 °C with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "delta-agreeing",
    "question": "The heat capacity is 20 J/K. ΔT = 10 K; ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "delta-conflicting",
    "question": "The heat capacity is 20 J/K. ΔT = 10 K; ΔT = 20 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "delta-range-unread",
    "question": "The heat capacity is 20 J/K. The sample is heated from 300 K to 310 K. ΔT = cannot be read; ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "qrev-single",
    "question": "At 300 K, a reversible isothermal change has q_rev = 3000 J. Draw the entropy change.",
    "expectedDraw": true
  },
  {
    "id": "qrev-agreeing",
    "question": "At 300 K, a reversible isothermal change has q_rev = 3000 J; q_rev = 3 kJ. Draw the entropy change.",
    "expectedDraw": true
  },
  {
    "id": "qrev-conflicting",
    "question": "At 300 K, a reversible isothermal change has q_rev = 3000 J; q_rev = 2000 J. Draw the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "entropy-system-unread",
    "question": "The entropy of the system is unknown; entropy of the system is 10 J/K and entropy of the surroundings is 5 J/K. Draw the entropy of the universe.",
    "expectedDraw": false
  },
  {
    "id": "entropy-surroundings-unread",
    "question": "The entropy of the system is 10 J/K. The entropy of the surroundings is cannot be read; entropy of the surroundings is 5 J/K. Draw the entropy of the universe.",
    "expectedDraw": false
  },
  {
    "id": "entropy-account-positive",
    "question": "The entropy of the system is 10 J/K and entropy of the surroundings is 5 J/K. Draw the entropy of the universe.",
    "expectedDraw": true
  },
  {
    "id": "delta-is-unknown",
    "question": "The heat capacity is 20 J/K. ΔT is unknown; ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "delta-no-equals",
    "question": "The heat capacity is 20 J/K. ΔT cannot be read; ΔT = 10 K with no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "delta-range-no-equals",
    "question": "The heat capacity is 20 J/K. The sample is heated from 300 K to 310 K. ΔT is unknown. There is no phase change. Find q.",
    "expectedDraw": false
  },
  {
    "id": "delta-request-range",
    "question": "The heat capacity is 20 J/K. The sample is heated from 300 K to 310 K with no phase change. Find q and calculate the unknown ΔT.",
    "expectedDraw": true
  },
  {
    "id": "delta-range-agreement",
    "question": "The heat capacity is 20 J/K. The sample is heated from 300 K to 310 K. ΔT is 10 K with no phase change. Find q.",
    "expectedDraw": true
  },
  {
    "id": "qrev-is-unknown",
    "question": "At 300 K, a reversible isothermal change has q_rev is unknown; q_rev = 3000 J. Draw the entropy change.",
    "expectedDraw": false
  },
  {
    "id": "qrev-named-unknown",
    "question": "At 300 K, the reversible heat cannot be read; q_rev = 3000 J. Draw the reversible isothermal entropy change.",
    "expectedDraw": false
  },
  {
    "id": "qrev-named-positive",
    "question": "At 300 K, the reversible heat is 3000 J. Draw the reversible isothermal entropy change.",
    "expectedDraw": true
  },
  {
    "id": "system-unread-no-is",
    "question": "The entropy of the system cannot be read; entropy of the system is 10 J/K and entropy of the surroundings is 5 J/K. Draw the entropy of the universe.",
    "expectedDraw": false
  },
  {
    "id": "surroundings-unread-no-is",
    "question": "The entropy of the system is 10 J/K. The entropy of the surroundings cannot be read; entropy of the surroundings is 5 J/K. Draw the entropy of the universe.",
    "expectedDraw": false
  },
  {
    "id": "entropy-reference-request",
    "question": "The entropy of the system is 10 J/K and entropy of the surroundings is 5 J/K. Draw the entropy of the universe and label entropy of the system and entropy of the surroundings.",
    "expectedDraw": true
  },
  {
    "id": "qrev-reference-formula",
    "question": "At 300 K, a reversible isothermal change has q_rev = 3000 J. Use q_rev/T and draw the entropy change.",
    "expectedDraw": true
  }
];
for (const row of entropyDeltaDeclarations) for (const mode of ["strict", "schematic", "ordinary", "lastResort"] as const) test(`thermal-delta-entropy-declarations/${row.id}/${mode}`, () => {
  const raw = mode === "ordinary" || mode === "lastResort" ? synthesizeFamilyScene({question:row.question,lastResort:mode === "lastResort"})?.document ?? null
    : buildChemicalThermodynamicsScene(row.question, [], mode === "schematic");
  if (!row.expectedDraw) { assert(!drawable(raw), "each supplied owner must read before calculation or partial fallback"); return; }
  compiled(raw);
});

const sourceFiles = ["quantityReader", "sceneKit", "atomicRadiation", "chemicalThermodynamics", "electrochemistry", "kinetics", "solutionProperties", "solutionsGraphs", "thermoGraphs", "unitCell"];
const sourceHashes = Object.fromEntries(sourceFiles.map(name => [name + ".ts", createHash("sha256").update(readFileSync(new URL(`../../src/chemistry/${name}.ts`, import.meta.url))).digest("hex")]));
const output = { passed, failures, sourceHashes, dimensions: Object.keys(dimensions).length, families: Object.keys(builders).length, numericOwnerCases: cases.length, evidence, scope: "Source-only independent owner-declaration/family admission matrix with valid positive and absent controls. Declaration fixtures are byte-identical to red-gate-v1.ts; assertions use the new owner seam while strict literal valid/missing behavior remains unchanged. No built package, provider, DB, server, browser, production or coverage claim." };
const outAt = process.argv.indexOf("--out");
if (outAt >= 0) writeFileSync(process.argv[outAt + 1]!, JSON.stringify(output, null, 2) + "\n");
console.log(`verify-chemistry-supplied-quantity: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
