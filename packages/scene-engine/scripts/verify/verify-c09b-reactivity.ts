/**
 * Periodicity distinctions the trend graph does not draw.
 *
 * Electron-gain enthalpies below are the NCERT main-group values. Pauling
 * electronegativities are read from the element table. Neither set is imported
 * from periodicReactivity.ts. Chlorine's gain enthalpy is more negative than
 * fluorine's; fluorine's electronegativity is higher. He, Ne and Ar stay null.
 * Sodium's valence is its group number, and its oxidation state in NaCl is +1.
 */
import { compileSceneDocument } from "../../src/compile/compiler";
import { elementBySymbol } from "../../src/chemistry/elements";
import { PERIODIC_PROBES, buildPeriodicTrendScene } from "../../src/chemistry/periodicTrend";
import {
  buildPeriodicReactivityScene,
  claimsPeriodicReactivity,
} from "../../src/chemistry/periodicReactivity";
import type { SceneDocument } from "../../src/types";

const GAIN = { F: -328, Cl: -349, Br: -325, I: -295, O: -141, S: -200 } as const;

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

function quantityValue(document: SceneDocument, id: string): number | null {
  const found = document.quantities.find((item) => item.id === id);
  const value = found?.value;
  return typeof value === "number" ? value : null;
}

function captionOf(document: SceneDocument): string {
  return document.annotations.map((annotation) => annotation.text ?? "").join(" ");
}

function drawn(question: string): { labels: string[]; document: SceneDocument } | null {
  check(claimsPeriodicReactivity(question), `not claimed: ${question.slice(0, 72)}`);
  const document = buildPeriodicReactivityScene(question, [], false);
  if (!document) {
    check(false, `${question.slice(0, 72)} drew nothing`);
    return null;
  }
  check(document.source.chemistryFamily === "chem_periodic", `${question.slice(0, 56)} family ${String(document.source.chemistryFamily)}`);
  check(!document.entities.some((entity) => entity.kind === "axes" || entity.kind === "vector"), `${question.slice(0, 56)} drew a trend axis or an arrow`);
  const compiled = compileSceneDocument(document);
  check(compiled.ok && compiled.renderScene !== null, `${question.slice(0, 56)} did not compile`);
  if (!compiled.ok || !compiled.renderScene) return null;
  check(
    !compiled.report.issues.some((issue) => issue.code === "assertion_failed"),
    `${question.slice(0, 56)} failed an assertion`,
  );
  const labels = compiled.renderScene.primitives.filter((primitive) => primitive.text).map((primitive) => primitive.text!);
  check(labels.length > 0 && labels.every((label) => label.length <= 16), `${question.slice(0, 56)} label longer than 16`);
  const xs = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.x));
  const ys = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.y));
  check(xs.length > 0 && xs.every((x) => x >= 400 && x <= 1160) && ys.every((y) => y >= 0 && y <= 700), `${question.slice(0, 56)} left the diagram zone`);
  return { labels, document };
}

function has(figure: { labels: string[] } | null, text: string, message: string): void {
  check(figure !== null && figure.labels.some((label) => label.includes(text)), message);
}

function lacks(figure: { labels: string[] } | null, text: string, message: string): void {
  check(figure !== null && figure.labels.every((label) => !label.includes(text)), message);
}

function declined(question: string, message: string): void {
  check(claimsPeriodicReactivity(question), `decline not owned: ${message}`);
  check(buildPeriodicReactivityScene(question, [], false) === null, message);
}

function notClaimed(question: string, message: string): void {
  check(!claimsPeriodicReactivity(question), message);
  check(buildPeriodicReactivityScene(question, [], false) === null, `${message} still built`);
}

const fluorine = elementBySymbol("F");
const chlorine = elementBySymbol("Cl");
const oxygen = elementBySymbol("O");
const sulfur = elementBySymbol("S");
const sodium = elementBySymbol("Na");
const fEn = fluorine?.electronegativity ?? null;
const clEn = chlorine?.electronegativity ?? null;
const oEn = oxygen?.electronegativity ?? null;
const sEn = sulfur?.electronegativity ?? null;

check(fEn === 3.98, "oracle: Pauling EN of F is 3.98");
check(clEn === 3.16, "oracle: Pauling EN of Cl is 3.16");
check(oEn === 3.44, "oracle: Pauling EN of O is 3.44");
check(sEn !== null && oEn !== null && oEn > sEn, "oracle: O EN is higher than S");
check(GAIN.Cl < GAIN.F, "oracle: Cl electron-gain enthalpy is more negative than F");
check(GAIN.S < GAIN.O, "oracle: S electron-gain enthalpy is more negative than O");
check(fEn !== null && clEn !== null && fEn > clEn && GAIN.Cl < GAIN.F, "oracle: higher EN is not the more negative gain enthalpy");
check(oEn !== null && sEn !== null && oEn > sEn && GAIN.S < GAIN.O, "oracle: O/S electronegativity and gain enthalpy disagree");
check(GAIN.Br === -325 && GAIN.I === -295 && GAIN.Br < GAIN.I, "oracle: Br is more negative than I");
const brEn = elementBySymbol("Br")?.electronegativity ?? null;
const iEn = elementBySymbol("I")?.electronegativity ?? null;
check(brEn !== null && iEn !== null && brEn > iEn, "oracle: Br/I electronegativity agrees with gain enthalpy, unlike F/Cl");
check(["He", "Ne", "Ar"].every((symbol) => elementBySymbol(symbol)?.electronegativity === null), "oracle: He, Ne and Ar electronegativity is null");
const krEn = elementBySymbol("Kr")?.electronegativity ?? null;
check(krEn !== null && krEn !== 0, "oracle: Kr electronegativity is not zero");
check(sodium?.group === 1, "oracle: Na is group 1, valence 1, oxidation state +1 in NaCl");

const FCL = "Although the electron-gain enthalpy of Cl is -349 kJ/mol and that of F is -328 kJ/mol, the Pauling electronegativity of F is 3.98 and that of Cl is 3.16. Distinguish electron-gain enthalpy from electronegativity.";
const fcl = drawn(FCL);
has(fcl, "F egH -328", "fluorine electron-gain enthalpy stays -328");
has(fcl, "Cl egH -349", "chlorine electron-gain enthalpy stays -349");
has(fcl, "Cl more -", "chlorine is the more negative gain enthalpy");
has(fcl, "F EN 3.98", "fluorine Pauling EN stays 3.98");
has(fcl, "Cl EN 3.16", "chlorine Pauling EN stays 3.16");
has(fcl, "F higher EN", "fluorine has the higher Pauling electronegativity");
lacks(fcl, "F more -", "fluorine is not labelled as the more negative gain enthalpy");
lacks(fcl, "Cl higher EN", "chlorine is not labelled as the higher electronegativity");
if (fcl) {
  check(quantityValue(fcl.document, "egh_Cl") === GAIN.Cl, "quantity keeps Cl at -349");
  check(quantityValue(fcl.document, "egh_F") === GAIN.F, "quantity keeps F at -328");
  check(quantityValue(fcl.document, "en_F") === fEn, "quantity keeps F EN from the element table");
  check(quantityValue(fcl.document, "en_Cl") === clEn, "quantity keeps Cl EN from the element table");
  const eghCl = quantityValue(fcl.document, "egh_Cl");
  const eghF = quantityValue(fcl.document, "egh_F");
  const enF = quantityValue(fcl.document, "en_F");
  const enCl = quantityValue(fcl.document, "en_Cl");
  check(eghCl !== null && eghF !== null && eghCl < eghF, "stored gain enthalpies are not swapped");
  check(enF !== null && enCl !== null && enF > enCl, "stored electronegativities are not swapped");
  check(captionOf(fcl.document).includes("not a more negative"), "the caption refuses the swapped convention");
}

const FCL_WORDS = "Distinguish electron-gain enthalpy from Pauling electronegativity for fluorine and chlorine. Chlorine is more negative in electron-gain enthalpy. Fluorine has the higher electronegativity. Do not treat the larger electronegativity as the more negative enthalpy.";
const fclWords = drawn(FCL_WORDS);
has(fclWords, "Cl more -", "the wording stem still labels Cl more -");
has(fclWords, "F higher EN", "the wording stem still labels F higher EN");

const OS = "Distinguish electron-gain enthalpy from Pauling electronegativity for oxygen and sulphur. The electron-gain enthalpy of S is -200 kJ/mol and that of O is -141 kJ/mol. Oxygen has the higher electronegativity.";
const os = drawn(OS);
has(os, "O egH -141", "oxygen electron-gain enthalpy stays -141");
has(os, "S egH -200", "sulphur electron-gain enthalpy stays -200");
has(os, "S more -", "sulphur is the more negative gain enthalpy");
has(os, "O higher EN", "oxygen has the higher Pauling electronegativity");
has(os, `O EN ${oEn?.toFixed(2)}`, "oxygen EN is the element-table value");
has(os, `S EN ${sEn?.toFixed(2)}`, "sulphur EN is the element-table value");
lacks(os, "O more -", "oxygen is not labelled as the more negative gain enthalpy");
lacks(os, "S higher EN", "sulphur is not labelled as the higher electronegativity");
if (os) {
  check(quantityValue(os.document, "egh_S") === GAIN.S, "quantity keeps S at -200");
  check(quantityValue(os.document, "egh_O") === GAIN.O, "quantity keeps O at -141");
  const eghS = quantityValue(os.document, "egh_S");
  const eghO = quantityValue(os.document, "egh_O");
  check(eghS !== null && eghO !== null && eghS < eghO, "stored O/S gain enthalpies are not swapped");
}

declined(
  "Show the electron-gain enthalpy of fluorine as more negative than chlorine, and show chlorine with the higher Pauling electronegativity, because a larger electronegativity is a more negative enthalpy.",
  "a swapped F/Cl convention is not drawn",
);
declined(
  "Use electron-gain enthalpies F -349 and Cl -328, and Pauling electronegativities F 3.16 and Cl 3.98. Distinguish electron-gain enthalpy from electronegativity.",
  "swapped F/Cl numbers are not drawn",
);
declined(
  "Show the electron-gain enthalpy of oxygen as more negative than sulphur because oxygen has the higher electronegativity.",
  "a swapped O/S convention is not drawn",
);
declined(
  "Use electron-gain enthalpies O -200 and S -141 for oxygen and sulphur, and compare their Pauling electronegativity.",
  "swapped O/S gain enthalpies are not drawn",
);

const NOBLE = "The Pauling electronegativity of helium, neon and argon is unknown. Do not set an unknown noble-gas electronegativity to 0 and do not interpolate one.";
const noble = drawn(NOBLE);
has(noble, "He unknown", "helium electronegativity stays unknown");
has(noble, "Ne unknown", "neon electronegativity stays unknown");
has(noble, "Ar unknown", "argon electronegativity stays unknown");
has(noble, "not 0", "a null electronegativity is not zero");
has(noble, "no guess", "a null electronegativity is not guessed");
lacks(noble, "Kr", "krypton is not labelled unknown");
if (noble) {
  check(noble.labels.every((label) => !/^(He|Ne|Ar) 0$/.test(label) && !/^EN\s*=?\s*0$/.test(label)), "no noble gas is labelled 0");
  check(noble.document.quantities.every((item) => item.value !== 0), "no zero quantity is stored for a null electronegativity");
  check(captionOf(noble.document).includes("not 0") || captionOf(noble.document).includes("not zero") || captionOf(noble.document).toLowerCase().includes("not 0"), "the caption keeps null off zero");
}

const NEON = "What is the Pauling electronegativity of neon? The table has no value.";
const neon = drawn(NEON);
has(neon, "Ne unknown", "neon alone stays unknown");
has(neon, "not 0", "neon is not filled with zero");
lacks(neon, "He unknown", "helium is not added when only neon is asked");
lacks(neon, "Ar unknown", "argon is not added when only neon is asked");

declined("Interpolate the Pauling electronegativity of neon and set it to 0.", "an interpolated neon electronegativity is not drawn");
declined("The electronegativity of krypton is unknown. Set it to 0.", "a known noble-gas electronegativity is not replaced by unknown or zero");
declined("Noble gases have electronegativity 0.", "noble gases as a class are not set to zero");

const VALENCE = "In NaCl, sodium has valence 1 and oxidation state +1. Oxidation state is not formal charge. Do not invent a reactivity.";
const valence = drawn(VALENCE);
has(valence, "valence 1", "sodium valence is 1");
has(valence, "Na ox +1", "sodium oxidation state in NaCl is +1");
has(valence, "not formal", "oxidation state is not formal charge");
has(valence, "not reaction", "no reactant is stated, so no reaction is named");
lacks(valence, "water", "water is not invented");
lacks(valence, "H2O", "H2O is not invented");
if (valence) {
  check(quantityValue(valence.document, "valence_Na") === sodium?.group, "valence quantity is the sodium group number");
  check(quantityValue(valence.document, "ox_Na") === sodium?.group, "oxidation-state quantity is +1");
  check(captionOf(valence.document).toLowerCase().includes("not formal charge"), "the caption separates oxidation state from formal charge");
}

const WATER = "In NaCl, sodium has valence 1 and oxidation state +1. Oxidation state is not the same as formal charge. Sodium reacts with water. Do not infer reactivity from the atomic radius.";
const water = drawn(WATER);
has(water, "valence 1", "the water stem keeps valence 1");
has(water, "Na ox +1", "the water stem keeps oxidation state +1");
has(water, "not formal", "the water stem keeps oxidation state off formal charge");
has(water, "Na + water", "sodium with water is named only because the stem states it");
has(water, "not radius", "the stated reaction is not a radius arrow");
lacks(water, "not reaction", "the stated water reaction is not withheld");
if (water) {
  check(!water.document.entities.some((entity) => entity.kind === "vector"), "no reactivity arrow is drawn");
}

const WATER_ONLY = "Sodium reacts with water.";
const waterOnly = drawn(WATER_ONLY);
has(waterOnly, "Na + water", "a stated sodium-water reaction is drawn");
lacks(waterOnly, "valence", "valence is not added to a reaction-only stem");
lacks(waterOnly, "ox", "an oxidation state is not added to a reaction-only stem");

declined(
  "Infer all chemical reactivity from atomic radius and draw one reactivity arrow for the alkali metals.",
  "reactivity inferred only from atomic radius is not drawn",
);
declined(
  "From the atomic radius, infer that sodium reacts with water.",
  "a water reaction inferred from radius is not drawn",
);
declined("In NaCl the oxidation state of sodium is +2. Draw that oxidation state.", "an unsupported sodium oxidation state is not drawn");
declined("In NaCl, sodium has valence 2 and oxidation state +1.", "an unsupported sodium valence is not drawn");
declined(
  "Treat the oxidation state of sodium in NaCl as the formal charge and draw them as one quantity.",
  "oxidation state is not drawn as formal charge",
);

notClaimed("Describe the trend in electronegativity down group 17.", "the group-17 electronegativity graph stays with the trend module");
notClaimed("Compare the electron gain enthalpy of the halogens F, Cl, Br and I. Which has the most negative value?", "the halogen electron-gain graph stays with the trend module");
notClaimed("Which of B, C, N and O has the highest electronegativity?", "the period-2 electronegativity ranking stays with the trend module");
notClaimed("The correct order of electron gain enthalpy (negative value) of O, S, Se and Te is", "the chalcogen electron-gain graph stays with the trend module");
notClaimed("How does the atomic radius change down group 1 (alkali metals)?", "the group-1 radius graph stays with the trend module");
notClaimed("How does electronegativity change down group 17?", "a group-17 electronegativity trend is not claimed here");
notClaimed("Compare the electron gain enthalpy of F, Cl, Br and I.", "a halogen electron-gain comparison without the electronegativity distinction is not claimed");
notClaimed("Assign the oxidation number of S in H2SO4. The sum equals 0. This is not the formal charge.", "sulfuric acid stays with oxidation-number assignment");
notClaimed("What is the electronegativity of krypton?", "a tabulated noble-gas electronegativity is not replaced");

for (const probe of PERIODIC_PROBES) {
  notClaimed(probe.question, `probe stays unclaimed: ${probe.question.slice(0, 64)}`);
}

const group17 = "Describe the trend in electronegativity down group 17.";
check(buildPeriodicTrendScene(group17, [], false) !== null, "the trend module still draws group-17 electronegativity");
const halogens = "Compare the electron gain enthalpy of the halogens F, Cl, Br and I. Which has the most negative value?";
check(buildPeriodicTrendScene(halogens, [], false) !== null, "the trend module still draws the halogen electron-gain graph");

if (failures.length > 0) {
  console.error(`verify-c09b-reactivity: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("oracles: Cl egH -349 is more negative than F -328; F EN 3.98 > Cl EN 3.16; O EN 3.44 > S; He/Ne/Ar EN null; Na valence 1 and Na ox +1 in NaCl");
console.log("verify-c09b-reactivity: ok");
