/** Public routing oracles; chemistry vocabulary must describe a chemical role. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chemistryFamilyBuilder, inferChemistryFamilies, isChemistryQuestion, isChemistrySceneFamily, readChemistryQuantity } from "../../src/chemistry";
import { isChemistryStem } from "../../src/chemistry/classify";
import { applyStemFamilyOverrides, inferFamiliesFromQuestion, normalizeStem, restrictFamiliesToChemistry } from "../../src/synthesize/familyClassification";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { isAtomicRadiationStem } from "../../src/chemistry/atomicRadiation";

const failures: string[] = [];
const results: Array<{ name: string; passed: boolean; error?: string }> = [];
let passed = 0;
function check(name: string, run: () => void): void {
  try { run(); passed++; results.push({ name, passed: true }); }
  catch (error) { failures.push(`${name}: ${String(error)}`); results.push({ name, passed: false, error: String(error) }); }
}
function outsideChemistry(question: string): void {
  assert.equal(isChemistryStem(question), false, "subject classifier");
  assert.equal(isChemistryQuestion(question), false, "question classifier");
  assert.deepEqual(inferChemistryFamilies(question), [], "chemistry family route");
  const families = new Set(inferFamiliesFromQuestion(question));
  applyStemFamilyOverrides(question, families);
  assert.equal([...families].some(isChemistrySceneFamily), false, "shared family route");
  const live = synthesizeFamilyScene({ question });
  assert.equal(live ? isChemistrySceneFamily(live.family) : false, false, "compiled family route");
}
function chemistryFigure(question: string, family: string): void {
  assert.equal(isChemistryQuestion(question), true);
  assert.ok(isChemistrySceneFamily(family));
  assert.ok(inferChemistryFamilies(question).includes(family));
  const document = chemistryFamilyBuilder(family)?.(question, [], false);
  assert.ok(document, "direct family must draw");
  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  assert.ok(validated.document, "complete document validates");
  const result = compileSceneDocument(validated.document);
  assert.equal(result.ok, true, "complete document compiles");
  assert.ok(result.renderScene);
  assert.ok(synthesizeFamilyScene({ question }), "family synthesis draws");
}

check("head-on collision retains mechanics", () => outsideChemistry("Two balls collide head-on elastically. Find the transferred kinetic energy."));
check("orbital overlap retains molecular bonding", () => chemistryFigure("Draw head-on orbital overlap forming the sigma bond in H2.", "chem_lewis"));
for (const question of [
  "Describe the set of complex z satisfying |z - 1| <= 2.",
  "Decompose 1/(x(x+1)) into partial fractions.",
  "The lines r = i + lambda j and r = k + mu i are skew.",
  "Explain diamagnetic and paramagnetic materials.",
  "A linear first-order differential equation has an exponential solution.",
  "Electron diffraction gives a first-order Bragg angle of 30 degrees.",
  "A quantity decays with half-life 10 years. Find what remains of 80 g after 20 years.",
  "An insulated vessel mixes hot water with cold water. The specific heat capacity is 4200 J/(kg K).",
  "Explain specific heat capacity and calorimetry.",
  "Kirchhoff's rules calculate the current in each branch of the circuit. qwrt zxcv pqrs.",
  "The work function of a metal is 2.0 eV. Light of wavelength 400 nm falls on it. Find the maximum kinetic energy of the photoelectrons.",
  "Young fringes from two slits are followed by photoelectron emission from a metal of work function 2.0 eV.",
  "An electron has wavelength lambda[nm]=1.227/sqrt(V[V]). Find its accelerating voltage.",
]) check(`negative chemical-role neighbor: ${question}`, () => outsideChemistry(question));
check("chemical first-order half-life retains kinetics", () => chemistryFigure("The half life of a first order reaction is 20 min. What fraction of the reactant remains after 60 min?", "chem_kinetics"));
check("rate law notation retains kinetics", () => chemistryFigure("For a first order reaction the rate law is r = k[A]. 50% of A is decomposed in 120 min. Calculate time for 90% decomposition.", "chem_kinetics"));
check("molar heat capacity retains thermodynamics", () => chemistryFigure("The molar heat capacity is 30 J/(mol K). Find heat for 2 mol heated from 300 K to 310 K.", "chem_thermo"));
check("orbital electrons retain magnetism", () => chemistryFigure("Draw the box diagram of the chloride ion Cl- and show that it is diamagnetic.", "chem_orbital"));
check("explicit atomic context retains radiation operator", () => chemistryFigure("In an atomic electron model, light of photon energy 3.0 eV exceeds a work function of 2.0 eV. Draw the photoelectron energy balance.", "chem_orbital"));
for (const values of [
  "photon energy is 3.0 eV and work function is 2.0 eV",
  "work function is 2.0 eV and photon energy is 3.0 eV",
  "work function is 3.204353268e-19 J and photon energy is 4.806529902e-19 J",
]) check(`distinct original atomic energy roles: ${values}`, () => {
  const question = `In an atomic electron model, ${values}. Draw the photoelectron energy balance.`;
  const work = readChemistryQuantity({ question, after: /work function/, dimension: "energy", targetUnit: "eV" });
  const photon = readChemistryQuantity({ question, after: /photon energy/, dimension: "energy", targetUnit: "eV" });
  assert.ok(work.ok && photon.ok);
  assert.ok(Math.abs(work.reading.value - 2) < 1e-12);
  assert.ok(Math.abs(photon.reading.value - 3) < 1e-12);
  for (const reading of [work.reading, photon.reading]) assert.equal(question.slice(reading.source.span.start, reading.source.span.end), reading.source.text);
  chemistryFigure(question, "chem_orbital");
  const scene = synthesizeFamilyScene({ question });
  assert.ok(scene);
  const labels = scene.renderScene.primitives.filter(primitive => primitive.kind === "label").map(primitive => primitive.text);
  for (const expected of ["phi=2.00 eV", "E=3.00 eV", "K=1.00 eV"]) assert.ok(labels.includes(expected), expected);
});
for (const values of [
  "work function is 2 eV; work function is 4 eV; photon energy is 3 eV",
  "photon energy is 3 eV; photon energy is 4 eV; work function is 2 eV",
  "work function is 2 eV; photon energy is 3e- eV",
  "work function is 2 eV; photon energy is 3 M",
  "work function is 2 eV; energy is 3 eV",
]) check(`atomic role cannot hide conflict damage or absent label: ${values}`, () => {
  const question = `In an atomic electron model, ${values}. Draw the photoelectron energy balance.`;
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null);
  assert.equal(synthesizeFamilyScene({ question }), null);
});
for (const values of [
  "work function is 2 eV; photon energy is 3 eV; energy of the photon is 4 eV; frequency is 1e15 Hz",
  "work function is 2 eV; photon energy is 3 eV; energy of the photon is 4e- eV; frequency is 1e15 Hz",
  "work function is 2 eV; photon energy is 3 eV; energy of the photon is 4 M; frequency is 1e15 Hz",
  "work function is 2 eV; photon energy is 3 eV; energy of the photon is -4 eV; frequency is 1e15 Hz",
  "work function is 2 eV; photon energy is 3 eV; frequency is 1e15 Hz",
  "work function is 2 eV; photon energy is 3 eV; wavelength is 400 nm",
  "frequency is 1e15 Hz; energy of the photon is 4 eV; photon energy is 3 eV; work function is 2 eV",
  "frequency is 1e15 Hz; energy of the photon is 4e- eV; photon energy is 3 eV; work function is 2 eV",
  "frequency is 1e15 Hz; energy of the photon is 4 M; photon energy is 3 eV; work function is 2 eV",
  "frequency is 1e15 Hz; energy of the photon is -4 eV; photon energy is 3 eV; work function is 2 eV",
  "frequency is 1e15 Hz; photon energy is 3 eV; work function is 2 eV",
  "wavelength is 400 nm; photon energy is 3 eV; work function is 2 eV",
  "work function is 2 eV; energy of the photon is 3e- eV; frequency is 1e15 Hz",
  "work function is 2 eV; energy of the photon is 3 M; wavelength is 400 nm",
  "work function is 2 eV; energy of the photon is -3 eV; frequency is 1e15 Hz",
  "work function is 2 eV; energy of the photon is 0 eV; frequency is 1e15 Hz",
  "work function is 2e- eV; photon energy is 3 eV; frequency is 1e15 Hz",
  "work function is 2 M; photon energy is 3 eV; wavelength is 400 nm",
  "work function is -2 eV; photon energy is 3 eV",
  "work function is 2 eV; frequency is 1e15 Hz; wavelength is 400 nm",
  "wavelength is 400 nm; frequency is 1e15 Hz; work function is 2 eV",
  "work function is 2 eV; photon energy is 4.135667696923859 eV; frequency is 1e15 Hz; wavelength is 400 nm",
  "work function is 2 eV; photon energy is 3 eV; frequency is 1e- Hz",
  "work function is 2 eV; photon energy is 3 eV; wavelength is 4 M",
  "work function is 2 eV; photon energy is 3 eV; frequency is 0 Hz",
  "work function is 2 eV; photon energy is 3 eV; wavelength is -400 nm",
  "work function is 2 eV; frequency is 1e15 Hz; frequency is 2e15 Hz; wavelength is 299.792458 nm",
  "work function is 2 eV; wavelength is 400 nm; wavelength is 500 nm; frequency is 1e15 Hz",
]) check(`every explicit photon source must agree before fallback: ${values}`, () => {
  const question = `In an atomic electron model, ${values}. Draw the photoelectron energy balance.`;
  const document = chemistryFamilyBuilder("chem_orbital")?.(question, [], false);
  assert.equal(document ? compileSceneDocument(document).ok : false, false, "no compiled partial candidate");
  assert.equal(document, null, "complete direct candidate declines");
  assert.equal(synthesizeFamilyScene({ question }), null, "native synthesis cannot replace damaged or conflicting photon evidence");
});
for (const [values, energyLabel, kineticLabel] of [
  ["work function is 2 eV; energy of the photon is 3 eV", "E=3.00 eV", "K=1.00 eV"],
  ["energy of the photon is 3 eV; work function is 2 eV", "E=3.00 eV", "K=1.00 eV"],
  ["work function is 2 eV; photon energy is 4.135667696923859 eV; frequency is 1e15 Hz", "E=4.14 eV", "K=2.14 eV"],
  ["frequency is 1e15 Hz; photon energy is 4.135667696923859 eV; work function is 2 eV", "E=4.14 eV", "K=2.14 eV"],
  ["work function is 2 eV; photon energy is 3.099604960830006 eV; wavelength is 400 nm", "E=3.10 eV", "K=1.10 eV"],
  ["wavelength is 400 nm; photon energy is 3.099604960830006 eV; work function is 2 eV", "E=3.10 eV", "K=1.10 eV"],
  ["work function is 3.204353268e-19 J; energy of the photon is 6.62607015e-19 J; frequency is 1e15 Hz; wavelength is 299.792458 nm", "E=4.14 eV", "K=2.14 eV"],
  ["wavelength is 2.99792458e-7 m; frequency is 1e15 Hz; energy of the photon is 6.62607015e-19 J; work function is 3.204353268e-19 J", "E=4.14 eV", "K=2.14 eV"],
  ["work function is 2 eV; frequency is 1e15 Hz; wavelength is 299.792458 nm", "E=4.14 eV", "K=2.14 eV"],
  ["wavelength is 0.0000299792458 cm; frequency is 1e15 Hz; work function is 2 eV", "E=4.14 eV", "K=2.14 eV"],
  ["work function is 2 eV; frequency is 1e15 Hz", "E=4.14 eV", "K=2.14 eV"],
  ["work function is 2 eV; wavelength is 400 nm", "E=3.10 eV", "K=1.10 eV"],
] as const) check(`consistent complete photon evidence compiles: ${values}`, () => {
  const question = `In an atomic electron model, ${values}. Draw the photoelectron energy balance.`;
  const document = chemistryFamilyBuilder("chem_orbital")?.(question, [], false);
  assert.ok(document);
  assert.equal(document.source.question, question);
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene);
  const native = synthesizeFamilyScene({ question });
  assert.equal(native?.family, "chem_orbital");
  assert.equal(native?.document.source.question, question);
  for (const scene of [compiled.renderScene, native?.renderScene]) {
    const labels = scene?.primitives.filter(p => p.kind === "label").map(p => p.text);
    for (const expected of ["phi=2.00 eV", energyLabel, kineticLabel]) assert.ok(labels?.includes(expected), expected);
  }
});
for (const question of [
  "In an atomic electron model, explain the photoelectric effect.",
  "In an atomic electron model, explain the work function and photon energy.",
]) check(`missing photon roles preserve existing unsupported chemistry disposition: ${question}`, () => {
  assert.equal(isAtomicRadiationStem(question), false);
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null);
  assert.equal(synthesizeFamilyScene({ question })?.family, "energy_level", "unchanged existing fallback family, not numerical certification");
});
for (const question of [
  "A hydrogen-free metal has work function 2e- eV; photon energy is 3 eV; frequency is 1e15 Hz. Draw the photoelectric energy balance.",
  "In the absence of atoms or ions, a metal has work function 2 M; photon energy is 3 eV; wavelength is 400 nm. Draw the photoelectric energy balance.",
]) check(`invalid context cannot grant a chemical photon role: ${question}`, () => {
  assert.equal(isAtomicRadiationStem(question), false);
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null);
  const native = synthesizeFamilyScene({ question });
  assert.equal(native ? isChemistrySceneFamily(native.family) : false, false, "physics scope remains independent");
});
for (const [values, after] of [
  ["work function is 2 eV; work function is 3.204353268e-19 J; photon energy is 3 eV", /work function/],
  ["photon energy is 3 eV; photon energy is 4.806529902e-19 J; work function is 2 eV", /photon energy/],
] as const) check(`equivalent repeated source roles retain shared-reader ambiguity: ${values}`, () => {
  const question = `In an atomic electron model, ${values}. Draw the photoelectron energy balance.`;
  const read = readChemistryQuantity({ question, after, dimension: "energy", targetUnit: "eV" });
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.code, "ambiguous");
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null);
});
for (const question of [
  "Draw photoelectric emission with work function 2 eV and frequency 9.65×10^14 Hz.",
  "Light of frequency 1e15 Hz falls on a metal of work function 2 eV. h = 6.62607015e-34 J s.",
  "Light of wavelength 500 nm falls on a metal of work function 2 eV. hc = 1.9864458571489286e-25 J m.",
]) check(`generic photon numeric fixture remains physics: ${question}`, () => {
  outsideChemistry(question);
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null);
});
for (const species of ["He+", "He⁺", "He^+", "Li2+", "Ar+", "Li²⁺", "He²⁺", "Ar²⁺", "Li³⁺"]) check(`complete atomic species retains matter wave: ${species}`, () => {
  const question = `The ${species} has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.`;
  chemistryFigure(question, "chem_orbital");
  const scene = synthesizeFamilyScene({ question });
  assert.ok(scene?.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === "L=0.066 nm"));
});
for (const question of [
  "The emitted electron from a hydrogen-free metal has work function 2 eV; a photon of energy 3 eV falls on it. Draw the photoelectric energy balance.",
  "In the absence of atoms or ions, a photon of energy 3 eV falls on a metal of work function 2 eV. Draw the photoelectric energy balance.",
  "No atoms, ions, or hydrogen participate; a photon of energy 3 eV falls on a metal of work function 2 eV. Draw the photoelectric energy balance.",
  "Atoms and ions are absent; a photon of energy 3 eV falls on a metal of work function 2 eV. Draw the photoelectric energy balance.",
]) check(`negative atomic context: ${question}`, () => outsideChemistry(question));
// Complete recognized roles and parsed ions share only their coordinated list polarity.
for (const prefix of [
  "No atomic structure, atoms, or ions participate; ",
  "Atomic structure and ions are absent; ",
  "No He+ or Li2+ participate; ",
  "No He⁺ or Li²⁺ participate; ",
  "No He^(+) or Li^{2+} participate; ",
  "No He+, Li2+, or atoms participate; ",
  "No bound electrons, atoms, or ions participate; ",
  "No atoms, hydrogen-like models, or ions participate; ",
]) check(`complete atomic-role list is excluded: ${prefix}`, () => {
  const question = `${prefix}a photon of energy 3 eV falls on a metal of work function 2 eV. Draw the photoelectric energy balance.`;
  outsideChemistry(question);
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null, "excluded list cannot authorize direct radiation builder");
});
for (const prefix of [
  "No atomic structure, atoms, or ions participate in the metal; but ",
  "No He+ or Li2+ participate in the metal; but ",
  "No He+, Li2+, or atoms participate; ",
  "Atomic structure and ions are absent, but ",
  "No atomic structure is required, and ",
  "No He+ participates, and ",
]) check(`excluded complete list preserves independent bound role: ${prefix}`, () => {
  chemistryFigure(`${prefix}a bound electron has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.`, "chem_orbital");
});
for (const [negative, positive] of [["He+ or Li2+", "He+"], ["He⁺ or Li²⁺", "He⁺"], ["He^(+) or Li^{2+}", "Li²⁺"]]) check(`independent duplicate atomic identity stays positive: ${negative}`, () => {
  chemistryFigure(`No ${negative} participate in the metal; but ${positive} has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.`, "chem_orbital");
});
check("excluded atomic identities preserve independent molecular evidence", () => {
  chemistryFigure("No He+ or Li2+ participate; draw the Lewis structure of H2O.", "chem_lewis");
});
check("excluded atomic identities preserve independent coordination evidence", () => {
  const question = "No He+ or Li2+ participate; draw the crystal field splitting of [Fe(CN)6]3-.";
  assert.equal(isChemistryStem(question), true, "positive coordinating identity still supplies subject evidence");
  assert.ok(inferChemistryFamilies(question).includes("chem_cft"));
});
for (const species of ["((He+))O", "(He+)⁺", "(He+) . H2O"]) check(`complete list parsing preserves wrapper rejection: ${species}`, () => {
  const question = `The ${species} has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.`;
  outsideChemistry(question);
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null);
});
for (const species of ["He^(+)", "He^{+}", "(He+)"]) check(`complete charge spelling: ${species}`, () => {
  chemistryFigure(`The ${species} has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.`, "chem_orbital");
});
check("a complete singly charged hydrogen species retains its matter wave", () => {
  chemistryFigure("The H+ has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.", "chem_orbital");
});
check("atomic species followed by sentence punctuation remains complete", () => {
  chemistryFigure("The particle is He+. Its momentum is 1e-23 kg m/s. Draw its de Broglie wavelength.", "chem_orbital");
});
for (const species of ["He+O", "He+2", "He+⁻", "He+_2", "He+^2", "He+/s", "He+ / s", "He+·H2O", "He+ . H2O", "He+(OH)", "[He+]", "XHe+", "Xx+", "he+", "H2+", "CO+", "(He+)O", "(He+)2", "(He+)_2", "(He+)/s"]) check(`atomic source prefix cannot grant a role: ${species}`, () => {
  const question = `The ${species} has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.`;
  assert.ok(!inferChemistryFamilies(question).includes("chem_orbital"));
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null, "direct family declines unsupported atomic source");
  assert.notEqual(synthesizeFamilyScene({ question })?.family, "chem_orbital");
});
for (const role of ["no atoms or ions", "without atoms or ions", "an unrelated reference to hydrogen", "atoms are absent", "no atoms, ions, or hydrogen participate", "atoms and ions are absent"]) check(`local excluded atomic role: ${role}`, () => {
  outsideChemistry(`There are ${role}; a photon of energy 3 eV falls on a metal of work function 2 eV. Draw the photoelectric energy balance.`);
});
for (const excluded of ["A hydrogen-free metal is described.", "In the absence of atoms or ions, the metal is described.", "No ions are present, but", "No atoms, ions, or hydrogen participate;", "Atoms and ions are absent;"]) check(`mixed source preserves genuine bound role: ${excluded}`, () => {
  chemistryFigure(`${excluded} A bound electron has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.`, "chem_orbital");
});
for (const question of [
  "The He²⁺ has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.",
  "The Li³⁺ has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.",
]) check(`original chemistry source survives shared normalization: ${question}`, () => {
  const families = new Set(inferFamiliesFromQuestion(question));
  applyStemFamilyOverrides(normalizeStem(question), families, { originalQuestion: question });
  assert.ok(families.has("chem_orbital"));
});
for (const question of [
  "Find the area bounded by y = x² and y = 4.",
  "The lines r = i + lambda j and r = k + mu i are skew.",
  "A convex lens has focal length 10 cm. Draw the ray diagram.",
  "A proton has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.",
]) check(`original chemistry argument preserves nonchem overrides: ${question}`, () => {
  const normalized = normalizeStem(question);
  const before = new Set(inferFamiliesFromQuestion(question));
  const after = new Set(before);
  applyStemFamilyOverrides(normalized, before);
  applyStemFamilyOverrides(normalized, after, { originalQuestion: question });
  assert.deepEqual([...after], [...before]);
});
check("coordination identity retains complex", () => chemistryFigure("Draw the crystal field splitting of the complex [Fe(CN)6]3-.", "chem_cft"));
check("hybridized complex retains chemical subject with absent species", () => {
  const question = "Compare dsp2 and sp3 complexes.";
  assert.equal(isChemistryQuestion(question), true);
  assert.equal(synthesizeFamilyScene({ question }), null, "no species must not invent geometry");
});
check("chemical source roles preserve ordinary capitalization", () => assert.equal(isChemistryQuestion("Compare DSP2 Complexes."), true));
check("named ligand retains complex application subject", () => {
  const question = "Name the complex used to estimate hardness of water with EDTA.";
  assert.equal(isChemistryQuestion(question), true);
  assert.equal(synthesizeFamilyScene({ question }), null, "no species must not invent geometry");
});
check("named atomic masses retain atomic matter-wave context", () => {
  const question = "The atomic masses of He and Ne are 4 and 20 amu. Compare their de Broglie wavelengths at the stated temperatures.";
  assert.equal(isChemistryQuestion(question), true);
  assert.equal(synthesizeFamilyScene({ question }), null, "missing numeric state must decline");
});
check("chemical decomposition retains subject", () => assert.equal(isChemistryStem("Thermal decomposition of CaCO3 produces CaO and CO2."), true));
check("Le Chatelier home cue retains subject", () => assert.equal(isChemistryQuestion("Explain Le Chatelier's principle using the Haber process when pressure increases."), true));
check("shared gas process retains state plot", () => assert.deepEqual(restrictFamiliesToChemistry("One mole of an ideal gas expands isothermally and reversibly. Find the work and entropy change.", ["state_plot", "circuit_network"]), ["state_plot"]));
check("bound transition retains shared Bohr ladder", () => assert.deepEqual(restrictFamiliesToChemistry("Hydrogen atoms emit photons in a transition from n = 3 to n = 2.", ["energy_level", "circuit_network"]), ["energy_level"]));

for (const prefix of [
  "Atoms and ions are not present; ",
  "Atomic structure and bound electrons are not present; ",
  "He+ and Li2+ are not present; ",
  "Hydrogen atoms are not present; ",
]) check(`post-list not-present context cannot authorize radiation: ${prefix}`, () => {
  const question = `${prefix}a photon of energy 3 eV falls on a metal of work function 2 eV. Draw the photoelectric energy balance.`;
  outsideChemistry(question);
  assert.equal(isAtomicRadiationStem(question), false, "direct radiation cue respects list negation");
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null, "direct family cannot replace an excluded atomic role");
});
check("not-present list preserves a separate positive bound-electron role", () => {
  chemistryFigure("Atoms and ions are not present in the metal; but a bound electron has momentum 1e-23 kg m/s. Draw its de Broglie wavelength.", "chem_orbital");
});
for (const question of [
  "Draw the graph of ln k versus 1/T for activation energy 50 kJ/mol.",
  "Draw a graph of ln k against 1/T with an activation energy of 50 kJ/mol.",
]) check(`explicit inverse-temperature axes retain activation-energy kinetics: ${question}`, () => {
  chemistryFigure(question, "chem_kinetics");
  const direct = chemistryFamilyBuilder("chem_kinetics")?.(question, [], false);
  assert.ok(direct?.annotations.some(annotation => /50.*kJ/.test(annotation.text ?? "")), "provided activation energy is retained");
});
for (const question of [
  "Draw the graph of ln k versus 1/T.",
  "Draw the graph of ln k versus 1/T without activation energy.",
  "Activation energy is background. Draw the graph of ln k versus 1/T.",
  "Draw the graph of ln k versus 1/T; activation energy is mentioned separately.",
]) check(`generic inverse-temperature axes cannot authorize chemical kinetics: ${question}`, () => {
  assert.equal(isChemistryStem(question), false, "no positive chemical subject evidence");
  assert.equal(inferChemistryFamilies(question).includes("chem_kinetics"), false);
  assert.equal(chemistryFamilyBuilder("chem_kinetics")?.(question, [], false), null);
  assert.notEqual(synthesizeFamilyScene({ question })?.family, "chem_kinetics");
});
check("rounded dual photon evidence remains conservatively unsupported", () => {
  const question = "In an atomic electron model, the photon energy is 3.10 eV and wavelength is 400 nm; work function is 2 eV. Draw the photoelectron energy balance.";
  assert.equal(isChemistryQuestion(question), true);
  assert.equal(chemistryFamilyBuilder("chem_orbital")?.(question, [], false), null, "rounded inputs do not relax the strict consistency policy");
  assert.equal(synthesizeFamilyScene({ question }), null, "no replacement ink for inconsistent complete evidence");
});
for (const values of [
  "photon energy is 3.099604960830006 eV and wavelength is 400 nm",
  "wavelength is 400 nm",
]) check(`consistent photon evidence near the rounded case compiles: ${values}`, () => {
  chemistryFigure(`In an atomic electron model, ${values}; work function is 2 eV. Draw the photoelectron energy balance.`, "chem_orbital");
});

// The frozen public corpus remains external: fixtures are oracles, never routing inputs.
const args = process.argv.slice(2);
const argument = (name: string): string | undefined => {
  const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1];
};
const clearPath = argument("--clear-targets"); const input = argument("--input");
if (clearPath || input) {
  assert.ok(clearPath && input, "both --clear-targets and --input are required");
  const targets = JSON.parse(readFileSync(clearPath, "utf8")) as {
    schema: string; rows: Array<{ id: string; subject: string; questionSha256: string }>
  };
  assert.equal(targets.schema, "chemistry-clear-steals/v1");
  assert.equal(targets.rows.length, 22);
  assert.equal(new Set(targets.rows.map(row => row.id)).size, 22);
  const rows = new Map<string, { question: string; subject: string }>();
  for (const subject of ["physics", "maths"]) {
    for (const line of readFileSync(join(input, `${subject}.jsonl`), "utf8").split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line) as { id: string; question: string; subject: string };
      assert.equal(rows.has(row.id), false); rows.set(row.id, row);
    }
  }
  for (const target of targets.rows) check(`frozen clear target ${target.id}`, () => {
    const row = rows.get(target.id); assert.ok(row);
    assert.equal(row.subject, target.subject);
    assert.equal(createHash("sha256").update(row.question).digest("hex"), target.questionSha256);
    outsideChemistry(row.question);
  });
}

const out = argument("--out");
if (out) writeFileSync(out, `${JSON.stringify({ passed, failed: failures.length, results }, null, 2)}\n`);

console.log(`verify-chemistry-no-steal-cues: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exitCode = 1;
