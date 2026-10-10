/** Public F3 numerical oracles; imports actual family exports, never a copied adapter. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { kineticsFromStem, solveKinetics, buildKineticsScene } from "../../src/chemistry/kinetics";
import { parseCellNotation, cellEmf, buildElectrochemScene } from "../../src/chemistry/electrochemistry";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { collectChemistryPlanQuantities, synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

const readerPath = resolve("src/chemistry/quantityReader.ts");
const reader = existsSync(readerPath) ? await import(readerPath) : null;
const failures: string[] = []; let passed = 0;
const outputIndex = process.argv.indexOf("--out");
const output = outputIndex < 0 ? null : resolve(process.argv[outputIndex + 1]!);
const renderOnlyIndex = process.argv.indexOf("--render-only");
const renderOnly = renderOnlyIndex < 0 ? null : new Set(process.argv[renderOnlyIndex+1]!.split(","));
if (output) mkdirSync(output, { recursive: true });
function check(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
function near(actual: unknown, expected: number): void {
  assert.ok(typeof actual === "number" && Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-10, 1e-14), `${actual} != ${expected}`);
}
function scalar(text: string): number {
  assert.ok(reader, "shared reader absent");
  const read = reader.parseChemistryScalar(text, { start: 0, end: text.length });
  assert.ok(read.ok, JSON.stringify(read)); return read.reading;
}
function quantity(text: string, dimension: string, targetUnit?: string) {
  assert.ok(reader, "shared reader absent");
  return reader.readChemistryQuantity({ question: text, after: /^value\s*=/, dimension, targetUnit });
}
function compiled(name: string, doc: SceneDocument | null): string {
  assert.ok(doc, "family declined");
  const valid = validateSceneDocument(pruneDeadSceneEntities(doc as unknown as Record<string, unknown>));
  assert.ok(valid.document, JSON.stringify(valid.report.issues));
  const result = compileSceneDocument(valid.document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  if (output && (!renderOnly || renderOnly.has(name))) writeFileSync(resolve(output, `${name}.svg`), renderSceneSvg(result.renderScene, { title: name, subtitle: "F3 actual-family numerical gate; captured QA pending" }));
  return [...doc.entities.map(e => e.label ?? ""), ...doc.annotations.map(a => a.text ?? "")].join("\n");
}
check("complete scientific and fraction tokens", () => {
  for (const [text, expected] of [[".5", .5], ["-2.5", -2.5], ["1e-3", .001], ["1E+3", 1000], ["9.65 × 10^4", 96500], ["2 x 10^(-3)", .002], ["2*10^-3", .002], ["10^(-3)", .001], ["-10^-3", -.001], ["2/3rd", 2/3], ["1/4th", .25]] as const) near(scalar(text), expected);
});
check("damaged tails overflow and nonzero underflow decline", () => {
  assert.ok(reader);
  for (const text of ["1e-", "2x10~°", "5.5 x 107!4", "2 × 10^(3", "2 × 10^3)", "2 × 10^((3))", "1e3junk", "1.2.3", "1/0", "1e309", "1e-400", "2/3rdgarbage"]) assert.equal(reader.parseChemistryScalar(text, { start: 0, end: text.length }).ok, false, text);
});
check("units case time pressure and Celsius offsets", () => {
  for (const [text, dim, unit, expected] of [["value=1e-3 M", "concentration", "mol/L", .001], ["value=6.0 h", "time", "min", 360], ["value=0.2 m", "molality", "mol/kg", .2], ["value=25 °C", "temperature", "K", 298.15], ["value=27°C", "temperature", "K", 300.15], ["value=25 °C", "temperature_delta", "K", 25], ["value=1 atm", "pressure", "bar", 1.01325], ["value=2 nm", "length", "pm", 2000], ["value=9.65×10^4 C/mol", "faraday_constant", "C/mol", 96500]] as const) {
    const r = quantity(text, dim, unit); assert.ok(r.ok, JSON.stringify(r)); near(r.reading.value, expected);
    assert.equal(r.reading.source.text, text.slice(r.reading.source.span.start, r.reading.source.span.end));
  }
  for (const [text, dim] of [["value=.1 m", "concentration"], ["value=.1 M", "length"], ["value=25", "temperature"], ["value=1e-3junk M", "concentration"], ["value=2 m/s", "length"]]) assert.equal(quantity(text, dim).ok, false, text);
});
check("source binding origin and conflict", () => {
  assert.ok(reader);
  const question = "Activation energy is 50 kJ/mol. Plot the energy profile.";
  const base = { question, aliases: ["Ea"], after: /activation energy/, dimension: "molar_energy", targetUnit: "kJ/mol" };
  const given = { id: "Ea", symbol: "Ea", value: 50, unit: "kJ/mol", origin: "given", sourceText: "50 kJ/mol" };
  near(reader.resolveChemistryGiven({ ...base, quantities: [{ ...given, origin: "derived", value: 99 }] }).reading?.value, 50);
  near(reader.resolveChemistryGiven({ ...base, quantities: [given] }).reading?.value, 50);
  for (const bad of [{ ...given, value: 99 }, { ...given, unit: "K" }, { ...given, sourceText: "50 kJ/mol elsewhere" }]) assert.equal(reader.resolveChemistryGiven({ ...base, quantities: [bad] }).ok, false);
  assert.equal(reader.resolveChemistryGiven({ ...base, question: "Plot an energy profile.", quantities: [{ ...given, origin: "derived" }] }).ok, false);
  assert.equal(reader.resolveChemistryGiven({ ...base, question: "Plot an energy profile.", quantities: [{ ...given, origin: undefined }] }).ok, false);
});
check("scope options ambiguity regex state and pKa", () => {
  assert.ok(reader);
  const question = "Ka is 1e-5. Options: (a) Ka = 2 (b) Ka = 3.";
  const input = { question, after: /\bKa\s*(?:is|=)/g, dimension: "dimensionless" };
  near(reader.readChemistryQuantity(input).reading?.value, 1e-5);
  near(reader.readChemistryQuantity(input).reading?.value, 1e-5);
  assert.equal(reader.readChemistryQuantity({ question: "pKa is 5 for H2CO3.", after: /(?<![A-Za-z])Ka\b/, dimension: "dimensionless" }).ok, false);
  assert.equal(reader.readChemistryQuantity({ question: "Ka is 1e-5; Ka is 1e-6.", after: /\bKa\s*is/g, dimension: "dimensionless" }).ok, false);
});
check("actual kinetics bare h and Celsius", () => {
  const spec = kineticsFromStem("A first order reaction has a half-life of 6.0 h. Plot the decay curve.");
  assert.ok(spec); near(spec.tHalf!, 6); assert.equal(spec.timeUnit, "h");
  const arr = kineticsFromStem("For an Arrhenius reaction, rate constant doubles from 25 °C to 35 °C. Draw the Arrhenius plot.");
  assert.ok(arr?.arrhenius); near(arr.arrhenius.T1!, 298.15); near(arr.arrhenius.T2!, 308.15);
  near(solveKinetics(arr).Ea!, 8.314 * Math.log(2) / (1/298.15 - 1/308.15));
  compiled("kinetics-hour", buildKineticsScene("A first order reaction has a half-life of 6.0 h. Plot the decay curve.", [], false));
});
check("actual Ea derived scalar cannot override source", () => {
  const question = "An Arrhenius reaction has activation energy 50 kJ/mol at 300 K and 320 K. Draw its Arrhenius plot.";
  const spec = kineticsFromStem(question, [{ id: "Ea", symbol: "Ea", value: 99000, unit: "J/mol", origin: "derived" }]);
  assert.ok(spec?.arrhenius); near(spec.arrhenius.Ea!, 50000);
  assert.equal(kineticsFromStem(question, [{ id: "Ea", symbol: "Ea", value: 99, unit: "kJ/mol", origin: "given", sourceText: "50 kJ/mol" }]), null);
});
check("actual compartment concentration Celsius and pressure", () => {
  const spec = parseCellNotation("Zn | Zn2+(aq, 1e-3 M) || Cu2+(aq, .1 M) | Cu at 25 °C"); assert.ok(spec);
  near(spec.anode.concentrations["Zn2+"], .001); near(spec.cathode.concentrations["Cu2+"], .1); near(spec.temperatureK, 298.15);
  const emf = cellEmf(spec); assert.ok(emf); near(emf.q!, .01);
  const gas = parseCellNotation("Pt | H2(g, 1 atm) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag at 25 °C"); assert.ok(gas);
  near(gas.anode.concentrations["H2"], 1.01325);
  const parenthesized = "Calculate the emf of the cell Zn(s) | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu";
  const phase = parseCellNotation(parenthesized); assert.ok(phase); near(phase.anode.concentrations["Zn2+"], .1); near(phase.cathode.concentrations["Cu2+"], .01);
  compiled("cell-parenthesized-concentrations", buildElectrochemScene(parenthesized, [], false));
  compiled("cell-scientific-Celsius", buildElectrochemScene("Draw the galvanic cell Zn | Zn2+(aq, 1e-3 M) || Cu2+(aq, .1 M) | Cu at 25 °C.", [], false));
});
check("actual thermo Celsius and complete value units", () => {
  const q = "Draw ΔG versus temperature for ΔH = 40 kJ/mol and ΔS = 100 J/(mol K) at 25 °C.";
  const doc = buildThermoGraphScene(q, [{ id: "dH", symbol: "dH", value: 999, unit: "kJ/mol", origin: "derived" }], false);
  assert.ok(doc); near(doc.quantities.find(x => x.id === "dG")?.value, 10.185);
  assert.match(compiled("Gibbs-Celsius", doc), /10\.2 kJ\/mol/);
  const entropy = compiled("entropy-Celsius", buildChemicalThermodynamicsScene("Draw the entropy change for a reversible isothermal process with qrev = 2981.5 J at 25 °C.", [], false));
  assert.match(entropy, /10\.00 J\/K/);
});
check("actual energy profile origin conversion and absent data", () => {
  const q = "Draw an energy profile with activation energy 5×10^4 J/mol and enthalpy change -20 kJ/mol.";
  const doc = buildThermoGraphScene(q, [{ id: "Ea", symbol: "Ea", value: 80, unit: "kJ/mol", origin: "derived" }], false);
  assert.ok(doc); near(doc.quantities.find(x => x.id === "Ea_forward")?.value, 50);
  assert.equal(buildThermoGraphScene("Draw a numeric energy profile with an activation energy.", [{ id: "Ea", symbol: "Ea", value: 50, unit: "kJ/mol", origin: "derived" }], false), null);
  compiled("energy-source-given", doc);
});
check("actual atomic complete exponent", () => {
  assert.match(compiled("photon-exponent", buildAtomicRadiationScene("Draw photoelectric emission with work function 2 eV and frequency 9.65×10^14 Hz.", [], false)), /E=3\.99 eV/);
  assert.equal(buildAtomicRadiationScene("Draw photoelectric emission with work function 2 eV and frequency 9.65×10^ Hz.", [], false), null);
});
check("actual unit cell ordinal fraction and source length", () => {
  assert.match(compiled("unit-cell-fraction", buildUnitCellScene("Oxide ions form a cubic close packed lattice. Aluminium ions occupy 2/3rd of the octahedral voids. Draw the unit cell and find the formula.", [], false)), /O_?3Al_?2/);
  const doc = buildUnitCellScene("Draw an fcc unit cell with edge length 4e-10 m and molar mass 64 g/mol.", [{ id: "a", symbol: "a", value: 500, unit: "pm", origin: "derived" }], false); assert.ok(doc);
  near(doc.quantities.find(x => x.symbol === "a")?.value, 400); compiled("unit-cell-edge", doc);
});
check("actual solutions scientific concentrations and delta", () => {
  const dilution = compiled("solution-scientific", buildSolutionLessonScene("Find the molarity after 100 mL of 1e-3 M solution is diluted to 200 mL.", [], false));
  assert.match(dilution, /M2=0\.0005 mol\/L/);
  const shift = compiled("solution-temperature-delta", buildSolutionsGraphScene("Draw the vapour pressure curves showing freezing point depression of 2 °C for a nonvolatile solute.", [], false));
  assert.match(shift, /2 K/); assert.doesNotMatch(shift, /275\.15/);
});
check("physical energy dimensions, exact spans and conversion arithmetic", () => {
  assert.ok(reader);
  assert.equal(quantity("value=50 kJ/mol", "energy").ok, false);
  assert.equal(quantity("value=50 kJ", "molar_energy").ok, false);
  near(quantity("value=10 mA", "current", "A").reading?.value, .01);
  near(quantity("value=1 h^-1", "rate_constant_first", "s^-1").reading?.value, 1/3600);
  const q = "value=1e-3 M";
  assert.equal(reader.readChemistryLiteral({question: q, scalarSpan: {start: 6,end: 7}, dimension: "concentration"}).ok, false);
  assert.deepEqual(reader.findChemistryQuantities({question: "1e-3 M", dimension: "length"}), {ok: true, reading: []});
  near(reader.convertChemistryValue(25, "°C", "K", "temperature_delta").reading, 25);
  assert.equal(reader.convertChemistryValue(1, "kJ", "kJ/mol", "energy").ok, false);
});
check("chemistry collector origin and untrimmed real family provenance", () => {
  const q = "  Draw an energy profile with activation energy 50 kJ/mol and enthalpy change -20 kJ/mol.  ";
  const start = q.indexOf("50 kJ/mol");
  const given = {id: "Ea", symbol: "Ea", value: 50, unit: "kJ/mol", sourceText: "50 kJ/mol", sourceSpan: {start, end: start + 9}};
  const derived = {...given, value: 80};
  const rows = collectChemistryPlanQuantities({givens:[given], derived:[derived]});
  assert.deepEqual(rows.map(r => r.origin), ["given", "derived"]);
  assert.deepEqual(rows[0]!.sourceSpan, given.sourceSpan);
  const live = synthesizeFamilyScene({question:q, turnPlan:{givens:[given],derived:[derived]}});
  assert.ok(live); assert.equal(live.family, "chem_thermo");
  near(live.document.quantities.find(r => r.id === "Ea_forward")?.value, 50);
  assert.equal(buildThermoGraphScene(q, collectChemistryPlanQuantities({givens:[{...given,value:NaN}]}), false), null);
});
check("real family damaged, incompatible and absent givens decline", () => {
  for (const tail of ["6e- h", "6x10~° h", "6 h^junk", "6", "1e-400 h"]) assert.equal(buildKineticsScene(`A first order reaction has half-life ${tail}. Plot the decay curve.`, [], false), null, tail);
  for (const tail of ["4e- m", "4 m/s", "4", "1e-400 m"]) assert.equal(buildUnitCellScene(`Draw an fcc unit cell with edge length ${tail} and molar mass 64 g/mol.`, [], false), null, tail);
  for (const tail of ["1e- M", ".1 m", "1e-400 M"]) assert.equal(parseCellNotation(`Zn | Zn2+(aq, ${tail}) || Cu2+(aq, 1 M) | Cu at 25 °C`), null, tail);
  assert.equal(buildThermoGraphScene("Draw an energy profile with activation energy 1e- kJ/mol and enthalpy change -20 kJ/mol.", [], false), null);
  assert.equal(buildThermoGraphScene("Draw ΔG versus temperature for ΔH = 40 kJ and ΔS = 100 J/(mol K) at 25 °C.", [], false), null);
  assert.equal(buildSolutionLessonScene("Find the molarity after 100 mL of 1e-3 m solution is diluted to 200 mL.", [], false), null);
  assert.equal(buildSolutionLessonScene("Find the osmotic pressure of a 0.1 M solution at 25 °C.", [], false), null);
  assert.equal(buildAtomicRadiationScene("Draw photoelectric emission with work function 2 eV and frequency 1e-400 Hz.", [], false), null);
});
check("duplicate scalar tokens keep their species and unit spans", () => {
  const doc = compiled("dilution-equal-values", buildSolutionLessonScene("Find the molarity after 100 mL of 1e-3 M solution is diluted to 100 mL.", [], false));
  assert.match(doc, /M2=0\.001 mol\/L/);
  const match = new RegExp(`(${reader.CHEMISTRY_SCALAR_PATTERN}) mL.*?(${reader.CHEMISTRY_SCALAR_PATTERN}) L`, "d").exec("10 mL diluted to 10 L");
  assert.ok(match);
  near(reader.matchedChemistryQuantity(match.input, match, 1, "volume", "L"), .01);
  near(reader.matchedChemistryQuantity(match.input, match, 2, "volume", "L"), 10);
});
check("actual remaining consumers complete scientific values and unit roles", () => {
  const concentration = compiled("molarity-density", buildSolutionLessonScene("Convert 1e-3 M to molality for a solution with density 1 g/mL and molar mass 58.5 g/mol.", [], false));
  assert.match(concentration, /0.001 mol/);
  const osmotic = compiled("osmosis-Celsius", buildSolutionLessonScene("Find the osmotic pressure of a 1e-3 M solution at 25 °C with R = 0.083 L bar/(mol K).", [], false));
  assert.match(osmotic, /T=298.15 K/);
  const half = kineticsFromStem("A first order reaction has half-life 6 h. Find the fraction remaining after 30 min."); assert.ok(half);
  near(half.timesAsked[0], .5); near(solveKinetics(half).remainingAtTimes[0]?.remaining, Math.pow(2,-1/12));
  const cell = parseCellNotation("Zn | Zn2+(aq, .001 M) || Cu2+(aq, .1 M) | Cu at 27 °C"); assert.ok(cell); near(cell.temperatureK,300.15);
});
check("complete compound Unicode units and incompatible dimensions", () => {
  assert.ok(reader);
  for (const [text, dimension] of [["value=2 m²", "length"], ["value=2 m·s^-1", "length"], ["value=2 M⁻¹", "concentration"], ["value=50 kJ mol⁻¹", "energy"], ["value=2 m kg^-1", "length"], ["value=50 kJ mol^-2", "energy"]]) assert.equal(quantity(text, dimension).ok, false, text);
  for (const [text, dimension, unit, expected] of [["value=50 kJ mol⁻¹", "molar_energy", "kJ/mol", 50], ["value=2 M⁻¹ s⁻¹", "rate_constant_second", "L/(mol s)", 2], ["value=2 J mol⁻¹ K⁻¹", "molar_entropy", "J/(mol K)", 2], ["value=2 m·s⁻¹", "speed", "m/s", 2], ["value=2 g cm⁻³", "density", "g/cm^3", 2]] as const) {
    const r = quantity(text, dimension, unit); assert.ok(r.ok, JSON.stringify(r)); near(r.reading.value, expected); assert.equal(r.reading.source.text, text.slice(6));
  }
  assert.equal(buildUnitCellScene("Draw a simple cubic unit cell with edge 2 m².", [], false), null);
});
check("literal bounds include clause start and exclude options", () => {
  assert.ok(reader);
  const question = "outside 2 M; inside 3 M";
  assert.equal(reader.readChemistryLiteral({question,scalarSpan:{start:8,end:9},within:{start:13,end:question.length},dimension:"concentration"}).ok,false);
  const options = "Unknown concentration. Options: (a) 2 M (b) 3 M"; const start = options.indexOf("2 M");
  assert.equal(reader.readChemistryLiteral({question:options,scalarSpan:{start,end:start+1},within:{start:0,end:options.length},dimension:"concentration"}).ok,false);
  const r = reader.readChemistryLiteral({question,scalarSpan:{start:20,end:21},within:{start:13,end:question.length},dimension:"concentration"}); assert.ok(r.ok); assert.deepEqual(r.reading.source.span,{start:20,end:23});
  assert.equal(reader.readChemistryQuantity({question:"edge = 2 m²",after:/edge/,within:{start:0,end:10},dimension:"length"}).ok,false);
  for (const within of [{start:-1,end:23},{start:20,end:20},{start:0,end:100},{start:0,end:21}]) assert.equal(reader.readChemistryLiteral({question,scalarSpan:{start:20,end:21},within,dimension:"concentration"}).ok,false);
  const convention = "outside M; value=2";
  assert.equal(reader.readChemistryQuantity({question:convention,after:/value=/,within:{start:11,end:convention.length},dimension:"concentration",unitConvention:{unit:"mol/L",sourceSpan:{start:8,end:9}}}).ok,false);
  const cutUnit = "M⁻¹; value=2";
  assert.equal(reader.readChemistryQuantity({question:cutUnit,after:/value=/,dimension:"concentration",unitConvention:{unit:"mol/L",sourceSpan:{start:0,end:1}}}).ok,false);
});
check("source agreement rejects tiny zero sign and eV conflicts", () => {
  assert.ok(reader);
  for (const [value,unit,question,dimension] of [[0,"M","concentration = 1e-13 M","concentration"],[1,"eV","work function = 2 eV","energy"],[-1e-13,"m","edge = 1e-13 m","length"],[0,"J","energy = 1e-30 J","energy"]] as const) {
    const given = {id:"x",symbol:"x",value,unit,origin:"given",sourceText:question};
    const r = reader.resolveChemistryGiven({question,after:/=/,dimension,aliases:["x"],quantities:[given]}); assert.equal(r.ok,false,question); assert.equal(r.code,"source_conflict"); assert.equal(reader.chemistryPlanBindingsValid(question,[given]),false,question);
  }
  const question = "work function = 2 eV"; const good = {id:"x",symbol:"x",value:2,unit:"eV",origin:"given",sourceText:question};
  assert.ok(reader.resolveChemistryGiven({question,after:/=/,dimension:"energy",aliases:["x"],quantities:[good]}).ok);
  assert.ok(reader.chemistryPlanBindingsValid(question,[{...good,value:3.204353268e-19,unit:"J"}]));
});
check("every Hess step must read completely and share a dimension", () => {
  for (const bad of ["2e- kJ","20 J/kg","20","20 kJ mol⁻¹"]) {
    const question = `Use Hess law. Step 1: ΔH = 10 kJ. Step 2: ΔH = ${bad}. Step 3: ΔH = 30 kJ.`;
    assert.equal(buildChemicalThermodynamicsScene(question,[],false),null,bad); assert.equal(synthesizeFamilyScene({question}),null,bad);
  }
  const good = "Use Hess law. Step 1: ΔH = 10 kJ. Step 2: ΔH = 20000 J. Step 3: ΔH = 30 kJ.";
  assert.match(compiled("hess-complete",buildChemicalThermodynamicsScene(good,[],false)),/net=\+60 kJ/);
  const scaled = "Use Hess law. Step 1: ΔH = 10 kJ, reversed. Step 2: ΔH = 20 kJ, multiplied by 2. Step 3: ΔH = 30 kJ.";
  assert.match(compiled("hess-scaled",buildChemicalThermodynamicsScene(scaled,[],false)),/net=\+60 kJ/);
});
check("explicit Avogadro damage differs from absent reference", () => {
  const stem = "Draw an fcc unit cell with edge 400 pm and molar mass 64 g/mol.";
  for (const bad of ["1e- mol^-1","1e-999 mol^-1","0 mol^-1","-1e23 mol^-1","1e23 J","unknown"]) assert.equal(buildUnitCellScene(`${stem} Avogadro number is ${bad}. Find density.`,[],false),null,bad);
  const given = buildUnitCellScene(`${stem} Avogadro number is 1e23 mol⁻¹. Find density.`,[],false); assert.ok(given); near(Number(given.quantities.find(q=>q.symbol==="ρ")?.value),40); compiled("avogadro-given",given);
  const absent = buildUnitCellScene(`${stem} Find density.`,[],false); assert.ok(absent); near(Number(absent.quantities.find(q=>q.symbol==="ρ")?.value),6.642312);
});
check("association and dissociation capture roles survive migration", () => {
  const a = "For a solute with true molar mass 100 g/mol undergoing dissociation into 2 particles, alpha = 0.5. Find the apparent molar mass.";
  const b = "For a solute with true molar mass 100 g/mol undergoing association of 2 monomers, alpha = 0.5. Find the apparent molar mass.";
  const dissociated = compiled("dissociation-preserved",buildSolutionLessonScene(a,[],false));
  const associated = compiled("association-preserved",buildSolutionLessonScene(b,[],false));
  assert.match(dissociated,/i=1.5/); assert.match(dissociated,/M'=66.667 g\/mol/);
  assert.match(associated,/i=0.75/); assert.match(associated,/M'=133.333 g\/mol/);
});
check("Raoult independent component givens cannot hide conflicts or composition", () => {
  const conflict = "Draw the Raoult law graph: vapour pressure of pure A is 200 torr; vapour pressure of pure A is 300 torr; vapour pressure of pure B is 100 torr. Mole fraction of A is 0.4.";
  assert.equal(buildSolutionsGraphScene(conflict,[],false),null);
  for (const [a,b] of [["a","b"],["A","B"]]) {
    const question = `Draw the Raoult law graph: vapour pressures of pure ${a} and ${b} are 200 torr and 100 torr. The solution contains 2 mol ${a} and 3 mol ${b}.`;
    const labels = compiled("raoult-composition",buildSolutionsGraphScene(question,[],false)); assert.match(labels,/x_A = 0.4/); assert.match(labels,/p_total = 140 torr/);
  }
});
check("explicit fixed solver constants never silently become defaults", () => {
  const arr = "For an Arrhenius reaction rate constant doubles from 300 K to 310 K. Draw its Arrhenius plot.";
  for (const bad of ["8e- J/(mol K)","8.314 eV","9 J/(mol K)"]) assert.equal(kineticsFromStem(`${arr} R = ${bad}.`),null,bad);
  assert.ok(kineticsFromStem(`${arr} R = 8.314 J K⁻¹ mol⁻¹.`));
  const equilibrium = "Standard Gibbs energy ΔG° = -5 kJ/mol at 300 K. Find the equilibrium constant.";
  for (const bad of ["8e- J/(mol K)","9 J/(mol K)"]) assert.equal(buildChemicalThermodynamicsScene(`${equilibrium} R = ${bad}.`,[],false),null,bad);
  const photon = "Light of frequency 1e15 Hz falls on a metal of work function 2 eV.";
  for (const bad of ["6e- J s","6.6 J s","6.6e-34 J/kg"]) assert.equal(buildAtomicRadiationScene(`${photon} h = ${bad}.`,[],false),null,bad);
  assert.ok(buildAtomicRadiationScene(`${photon} h = 6.62607015e-34 J s.`,[],false));
  for (const bad of ["1e- eV nm","1000 eV nm"]) assert.equal(buildAtomicRadiationScene(`Light of wavelength 500 nm falls on a metal of work function 2 eV. hc = ${bad}.`,[],false),null,bad);
  const cell = "Zn | Zn2+(aq, .001 M) || Cu2+(aq, .1 M) | Cu at 300 K";
  for (const bad of ["9e- C/mol","90000 C/mol","96500 J"]) assert.equal(buildElectrochemScene(`${cell}. F = ${bad}.`,[],false),null,bad);
  assert.ok(buildElectrochemScene(`${cell}. F = 9.65×10^4 C/mol.`,[],false));
});
check("all registered whitespace unit factors are complete or decline", () => {
  for (const factor of ["C", "eV", "Hz", "V", "A", "mA", "N", "M", "eq", "dm", "coulombs", "hertz", "volts", "amperes", "Å"]) {
    assert.equal(quantity(`value=2 pm ${factor}`, "length").ok, false, factor);
    const question = `Draw a simple cubic unit cell with edge 2 pm ${factor}.`;
    assert.equal(buildUnitCellScene(question, [], false), null, question);
    assert.equal(synthesizeFamilyScene({question}), null, question);
  }
  assert.equal(quantity("value=50 kJ Hz", "energy").ok, false);
  assert.equal(buildChemicalThermodynamicsScene("Use Hess law. Step 1: ΔH = 10 kJ. Step 2: ΔH = 50 kJ Hz. Step 3: ΔH = 30 kJ.", [], false), null);
  const valid = quantity("value=2 pm and the cell is simple cubic", "length", "pm"); assert.ok(valid.ok); assert.equal(valid.reading.source.text, "2 pm");
  compiled("unit-factors-prose-control", buildUnitCellScene("Draw a simple cubic unit cell with edge 2 pm, with atoms at the corners.", [], false));
  for (const [text, dimension, unit, expected] of [["value=2 J s", "action", "J s", 2], ["value=2 eV nm", "energy_length", "eV nm", 2], ["value=2 M⁻¹ s⁻¹", "rate_constant_second", "L/(mol s)", 2], ["value=2 m·s⁻¹", "speed", "m/s", 2]] as const) {
    const r = quantity(text, dimension, unit); assert.ok(r.ok); near(r.reading.value, expected); assert.equal(r.reading.source.text, text.slice(6));
  }
});
check("every scalar binding respects complete original token boundaries", () => {
  assert.ok(reader);
  for (const [token, fragment] of [["-2", "2"], ["- 2", "2"], ["+2", "2"], ["−2", "2"], ["12", "2"], ["2.5", "5"], [".5", "5"], ["1e-3", "3"], ["2 x 10^(-3)", "3"], ["2/3rd", "3"], ["2 / 3rd", "3"], ["12", "1"], ["2.5", "2"], ["1e-3", "1"], ["2/3rd", "2"]]) {
    const question = `edge = ${token} pm`; const start = question.indexOf(fragment!, 7); const scalarSpan = {start, end:start + fragment!.length};
    assert.equal(reader.parseChemistryScalar(question,scalarSpan).ok,false,question);
    assert.equal(reader.readChemistryLiteral({question,scalarSpan,dimension:"length"}).ok,false,question);
    const inventory = reader.findChemistryQuantities({question,within:scalarSpan,dimension:"length"}); assert.ok(!inventory.ok || inventory.reading.length === 0, question);
    const match = new RegExp(`(${fragment})`,"d").exec(question.slice(0)); assert.equal(reader.matchedChemistryScalar(question,match),null,question);
    assert.equal(reader.matchedChemistryQuantity(question,match,1,"length"),null,question);
    const given = {id:"a",symbol:"a",value:Number(fragment),unit:"pm",origin:"given",sourceSpan:{start,end:question.length},sourceText:question.slice(start)};
    assert.equal(reader.chemistryPlanBindingsValid(question,[given]),false,question);
    assert.equal(reader.resolveChemistryGiven({question,after:/edge =/,dimension:"length",aliases:["a"],quantities:[given]}).ok,false,question);
  }
  for (const [token, expected] of [["-2", -2], ["- 2", -2], ["+2", 2], ["12", 12], [".5", .5], ["1e-3", .001], ["2 x 10^(-3)", .002], ["2/3rd", 2/3]] as const) {
    const question=`edge = ${token} pm`; const scalarSpan={start:7,end:7+token.length};
    const r=reader.readChemistryLiteral({question,scalarSpan,dimension:"length",targetUnit:"pm"}); assert.ok(r.ok,question); near(r.reading.value,expected);
    const inventory=reader.findChemistryQuantities({question,within:{start:7,end:question.length},dimension:"length",targetUnit:"pm"}); assert.ok(inventory.ok && inventory.reading.length===1,question); near(inventory.reading[0]!.value,expected);
    const match=new RegExp(`(${reader.CHEMISTRY_SCALAR_PATTERN})`,"d").exec(question); near(reader.matchedChemistryScalar(question,match),expected);
    assert.equal(reader.chemistryPlanBindingsValid(question,[{id:"a",symbol:"a",value:expected,unit:"pm",origin:"given",sourceSpan:{start:7,end:question.length},sourceText:question.slice(7)}]),true,question);
  }
  const question="Draw a simple cubic unit cell with edge 12 pm."; const start=question.indexOf("2 pm");
  assert.equal(buildUnitCellScene(question,[{id:"a",symbol:"a",value:2,unit:"pm",origin:"given",sourceSpan:{start,end:start+4},sourceText:"2 pm"}],false),null);
});
check("planner canonical conversion cannot erase nonzero underflow", () => {
  assert.ok(reader);
  const question="edge = 0 pm";
  for (const value of [1e-320,-1e-320,Number.MAX_VALUE]) {
    const unit=value===Number.MAX_VALUE ? "m" : "pm";
    const given={id:"a",symbol:"a",value,unit,origin:"given",sourceText:question};
    assert.equal(reader.resolveChemistryGiven({question,after:/=/,dimension:"length",aliases:["a"],quantities:[given]}).ok,false);
    assert.equal(reader.chemistryPlanBindingsValid(question,[given]),false);
  }
  for (const [question,value,unit] of [["edge = 0 pm",0,"pm"],["edge = 1e-300 pm",1e-312,"m"],["edge = 1e-300 pm",1e-300,"pm"]] as const) {
    const given={id:"a",symbol:"a",value,unit,origin:"given",sourceText:question};
    const r=reader.resolveChemistryGiven({question,after:/=/,dimension:"length",aliases:["a"],quantities:[given]}); assert.ok(r.ok,question); assert.equal(r.reading.source.kind,"plan_given"); assert.equal(reader.chemistryPlanBindingsValid(question,[given]),true,question);
  }
});
check("component amount roles require independent exact original identity", () => {
  assert.ok(reader);
  const question="Vapour pressure of pure A is 200 torr. The solution contains 2 mol A.";
  const sourceSpan={start:question.indexOf("A"),end:question.indexOf("A")+1};
  const match=/(2) mol (A)/d.exec(question); assert.ok(match);
  near(reader.matchedChemistryComponentAmount(question,match,1,2,{name:"a",sourceSpan}),2);
  assert.equal(reader.matchedChemistryComponentAmount(question,match,1,2,{name:"a",sourceSpan},"length"),null);
  for (const resolved of [{name:"b",sourceSpan},{name:"a",sourceSpan:{start:sourceSpan.start,end:sourceSpan.end+1}},{name:"a",sourceSpan:{start:-1,end:1}},{name:"a",sourceSpan:{start:match.indices![2]![0],end:match.indices![2]![1]}}]) assert.equal(reader.matchedChemistryComponentAmount(question,match,1,2,resolved),null);
  const partial="Vapour pressure of pure A is 200 torr. The solution contains 2 mol Amp.";
  assert.equal(reader.matchedChemistryComponentAmount(partial,/(2) mol (A)/d.exec(partial),1,2,{name:"a",sourceSpan}),null);
  const separated="Vapour pressure of pure A is 200 torr. The solution contains 2 mol C A.";
  assert.equal(reader.matchedChemistryComponentAmount(separated,/(2) mol C (A)/d.exec(separated),1,2,{name:"a",sourceSpan}),null);
  const noncontiguous="Vapour pressure of pure A is 200 torr. The solution contains 2 mol then A.";
  assert.equal(reader.matchedChemistryComponentAmount(noncontiguous,/(2) mol then (A)/d.exec(noncontiguous),1,2,{name:"a",sourceSpan}),null);
  for (const suffix of ["A","C"]) {
    const ordinary=`value=2 mol ${suffix}`; assert.equal(quantity(ordinary,"amount").ok,false);
    const start=ordinary.indexOf("2"); assert.equal(reader.readChemistryLiteral({question:ordinary,scalarSpan:{start,end:start+1},dimension:"amount"}).ok,false);
    assert.equal(reader.chemistryPlanBindingsValid(ordinary,[{id:"n",symbol:"n",value:2,unit:"mol",origin:"given",sourceText:ordinary}]),false);
  }
});
check("Raoult component roles cannot drop original suffix syntax", () => {
  for (const suffix of ["^-1", "⁻¹", "/s", "^+", "⁺", "_s", "(s)", "[A]", "·s", " C", "±", " ±", "¯"]) {
    const question=`Draw the Raoult law graph: vapour pressures of pure A and B are 200 torr and 100 torr. The solution contains 2 mol A${suffix} and 3 mol B.`;
    assert.equal(buildSolutionsGraphScene(question,[],false),null,suffix);
    assert.equal(synthesizeFamilyScene({question}),null,suffix);
  }
  for (const connector of [" ", " of "]) {
    const question=`Draw the Raoult law graph: vapour pressures of pure A and B are 200 torr and 100 torr. The solution contains 2 mol${connector}A and 3 mol${connector}B.`;
    const labels=compiled("raoult-complete-components",buildSolutionsGraphScene(question,[],false)); assert.match(labels,/x_A = 0.4/); assert.match(labels,/p_total = 140 torr/);
  }
});
check("both original component identities have complete boundaries", () => {
  assert.ok(reader);
  for (const token of ["Amp","xA","A^-1","A⁻¹","A/s","A^+","A₂","A(s)","[A]","A_s","A C","A±","A¯"]) {
    const question=`Vapour pressure of pure ${token} is 200 torr. The solution contains 2 mol A.`;
    const start=question.indexOf("A"); const sourceSpan={start,end:start+1};
    assert.equal(reader.matchedChemistryComponentAmount(question,/(2) mol (A)/d.exec(question),1,2,{name:"A",sourceSpan}),null,token);
  }
  for (const suffix of ["^-1","⁻¹","/s","^+","⁺","_s","(s)","[A]","·s"," C","±"," ±","¯"]) {
    const question=`Vapour pressure of pure A is 200 torr. The solution contains 2 mol A${suffix}.`;
    const start=question.indexOf("A");
    assert.equal(reader.matchedChemistryComponentAmount(question,/(2) mol (A)/d.exec(question),1,2,{name:"A",sourceSpan:{start,end:start+1}}),null,suffix);
  }
  for (const punctuation of [".",",", ";", " and the solution is ideal"]) {
    const question=`Vapour pressure of pure A is 200 torr. The solution contains 2 mol A${punctuation}`;
    const start=question.indexOf("A"); near(reader.matchedChemistryComponentAmount(question,/(2) mol (A)/d.exec(question),1,2,{name:"A",sourceSpan:{start,end:start+1}}),2);
  }
  const question="Vapour pressure of pure Amp is 200 torr. The solution contains 2 mol Amp.";
  const match=/(2) mol (Amp)/d.exec(question); assert.ok(match);
  const nameStart=question.indexOf("Amp"); near(reader.matchedChemistryComponentAmount(question,match,1,2,{name:"Amp",sourceSpan:{start:nameStart,end:nameStart+3}}),2);
  const forged=Object.assign([...match],{input:question,index:match.index,indices:match.indices}); forged[2]="A"; forged.indices=[...match.indices!]; forged.indices[2]=[match.indices![2]![0],match.indices![2]![0]+1];
  const start=question.indexOf("Amp"); assert.equal(reader.matchedChemistryComponentAmount(question,forged,1,2,{name:"A",sourceSpan:{start,end:start+1}}),null);
});
console.log(JSON.stringify({ passed, failed: failures.length, failures, capturedQA: "unavailable" }, null, 2));
process.exitCode = failures.length ? 1 : 0;
