/**
 * Periodicity: atomic and ionic radii, and ionisation enthalpy.
 *
 * The numbers below are the independent checks. Covalent radii and first
 * ionisation enthalpies are read from the element table. The six-coordinate
 * ionic radii are the stated Shannon / NCERT values (Na+ 102, Mg2+ 72,
 * Al3+ 54, F- 133, O2- 140, N3- 171 pm). They are not imported from the
 * figure module. Electron counts are Z minus charge.
 */
import { elementBySymbol } from "../../src/chemistry/elements";
import { PERIODIC_PROBES, isPeriodicTrendStem } from "../../src/chemistry/periodicTrend";
import { buildPeriodicSizeScene, claimsPeriodicSize } from "../../src/chemistry/periodicSize";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

function element(symbol: string) {
  const found = elementBySymbol(symbol);
  if (!found) throw new Error(`missing element ${symbol}`);
  return found;
}

const NA = element("Na");
const MG = element("Mg");
const AL = element("Al");
const N = element("N");
const O = element("O");
const F = element("F");
const BE = element("Be");
const B = element("B");
const LI = element("Li");

check(NA.radiusPm === 166 && MG.radiusPm === 141 && AL.radiusPm === 121, "Na, Mg and Al covalent radii");
check(BE.ie1 === 899 && B.ie1 === 801 && N.ie1 === 1402 && O.ie1 === 1314, "Be/B and N/O first ionisation enthalpies");
check(NA.ie1 === 496 && LI.ie1 === 520 && AL.ie1 === 578, "Na, Li and Al first ionisation enthalpies");
check(NA.z - 1 === 10 && MG.z - 2 === 10 && AL.z - 3 === 10, "Na+, Mg2+ and Al3+ have 10 electrons");
check(N.z - (-3) === 10 && O.z - (-2) === 10 && F.z - (-1) === 10, "N3-, O2- and F- have 10 electrons");
check(NA.z < MG.z && MG.z < AL.z, "cation nuclear charge rises Na < Mg < Al");
check(N.z < O.z && O.z < F.z, "anion nuclear charge rises N < O < F");

const CATION_PM = [
  { symbol: "Na", z: NA.z, pm: 102 },
  { symbol: "Mg", z: MG.z, pm: 72 },
  { symbol: "Al", z: AL.z, pm: 54 },
] as const;
const ANION_PM = [
  { symbol: "N", z: N.z, pm: 171 },
  { symbol: "O", z: O.z, pm: 140 },
  { symbol: "F", z: F.z, pm: 133 },
] as const;
const cationChain = [...CATION_PM].sort((a, b) => a.z - b.z).map((row) => row.pm).join(">");
const anionChain = [...ANION_PM].sort((a, b) => a.z - b.z).map((row) => row.pm).join(">");
check(cationChain === "102>72>54", "cation radii fall as Z rises");
check(anionChain === "171>140>133", "anion radii fall as Z rises");

function drawn(question: string): { labels: string[]; caption: string } | null {
  check(claimsPeriodicSize(question), `${question.slice(0, 64)} was not claimed`);
  const document = buildPeriodicSizeScene(question, [], false);
  if (!document) {
    check(false, `${question.slice(0, 64)} drew nothing`);
    return null;
  }
  return finish(question, document);
}

function finish(question: string, document: SceneDocument): { labels: string[]; caption: string } | null {
  check(document.source.chemistryFamily === "chem_periodic", `${question.slice(0, 48)} family ${document.source.chemistryFamily}`);
  const compiled = compileSceneDocument(document);
  check(compiled.ok && compiled.renderScene !== null, `${question.slice(0, 48)} did not compile`);
  if (!compiled.ok || !compiled.renderScene) return null;
  check(
    !compiled.report.issues.some((issue) => issue.code === "assertion_failed"),
    `${question.slice(0, 48)} failed an assertion`,
  );
  const xs = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.x));
  const ys = compiled.renderScene.primitives.flatMap((primitive) => primitive.points.map((point) => point.y));
  check(xs.length > 0 && xs.every((x) => x >= 400 && x <= 1160) && ys.every((y) => y >= 0 && y <= 700), `${question.slice(0, 48)} left the diagram zone`);
  const labels = compiled.renderScene.primitives.filter((primitive) => primitive.text).map((primitive) => primitive.text!);
  check(labels.length > 0 && labels.every((label) => label.length <= 16), `${question.slice(0, 48)} label longer than 16`);
  return { labels, caption: compiled.renderScene.caption ?? "" };
}

function has(figure: { labels: string[] } | null, text: string, message: string): void {
  check(figure !== null && figure.labels.some((label) => label.includes(text)), message);
}

function lacks(figure: { labels: string[] } | null, text: string, message: string): void {
  check(figure !== null && figure.labels.every((label) => !label.includes(text)), message);
}

function declined(question: string, message: string): void {
  check(claimsPeriodicSize(question), `${message} (not claimed)`);
  check(buildPeriodicSizeScene(question, [], false) === null, message);
}

function released(question: string, message: string): void {
  check(!claimsPeriodicSize(question), message);
  check(buildPeriodicSizeScene(question, [], false) === null, message);
}

const CATIONS = "Arrange the isoelectronic ions Na+, Mg2+ and Al3+ in order of ionic radius. State the radius convention and the nuclear-charge order.";
const cations = drawn(CATIONS);
has(cations, "6-coord", "cation radii are six-coordinate");
has(cations, "10 electrons", "the cations have 10 electrons");
has(cations, "Na<Mg<Al", "nuclear charge rises from Na to Al");
has(cations, cationChain, "cation radii are 102 > 72 > 54 pm");
has(cations, `${cationChain} pm`, "cation radii carry the pm unit");
has(cations, "r falls, Z rises", "radius falls as nuclear charge rises");
lacks(cations, String(NA.radiusPm), "Na covalent radius is not plotted as ionic");
lacks(cations, String(MG.radiusPm), "Mg covalent radius is not plotted as ionic");
lacks(cations, String(AL.radiusPm), "Al covalent radius is not plotted as ionic");

const poisoned = buildPeriodicSizeScene(
  CATIONS,
  [{ id: "r", symbol: "r", value: 40, unit: "pm" }],
  true,
);
const poisonedFigure = poisoned ? finish(CATIONS, poisoned) : null;
has(poisonedFigure, cationChain, "a planner radius does not replace the six-coordinate values");
lacks(poisonedFigure, "40", "the supplied planner radius is not drawn");

const UNICODE = "Arrange Na⁺, Mg²⁺ and Al³⁺ by ionic radius.";
const unicode = drawn(UNICODE);
has(unicode, cationChain, "superscript charges use the same six-coordinate radii");
has(unicode, "6-coord", "superscript ions keep the six-coordinate label");

const ANIONS = "Compare the ionic radii of the isoelectronic ions N3-, O2- and F-. Use the six-coordinate values.";
const anions = drawn(ANIONS);
has(anions, "6-coord", "anion radii are six-coordinate");
has(anions, "10 electrons", "the anions have 10 electrons");
has(anions, "N<O<F", "nuclear charge rises from N to F");
has(anions, anionChain, "anion radii are 171 > 140 > 133 pm");
has(anions, `${anionChain} pm`, "anion radii carry the pm unit");
has(anions, "r falls, Z rises", "anion radius falls as nuclear charge rises");

const NEUTRALS = "Find the ionic radii of Na, Mg and Al.";
const neutrals = drawn(NEUTRALS);
has(neutrals, "cov != ionic", "neutral atoms are told that covalent radius is not ionic radius");
has(neutrals, "need charge", "an ionic radius needs a charge");
has(neutrals, "no ion plot", "covalent data is not plotted as ionic");
has(neutrals, "Na Mg Al", "the neutral atoms are named");
lacks(neutrals, String(NA.radiusPm), "Na covalent radius is not filled in as an ionic radius");
lacks(neutrals, "102", "a known ionic radius is not substituted for the neutral atom");

const DEFINE = "Define covalent radius and ionic radius. They are not the same quantity.";
has(drawn(DEFINE), "cov != ionic", "the two radius definitions are distinguished");
has(drawn("Compare the definitions of covalent radius and ionic radius."), "cov != ionic", "a definition comparison is not a mixed-radius plot");

const PARENT = "A cation is smaller than its parent atom and an anion is larger. The nuclear charge is the same. Do not plot covalent and ionic radii on one axis.";
const parent = drawn(PARENT);
has(parent, "cation smaller", "a cation is smaller than its parent atom");
has(parent, "anion larger", "an anion is larger than its parent atom");
has(parent, "same Z", "the parent comparison keeps the nuclear charge");
has(parent, "no mixed r", "covalent and ionic radii stay off one axis");
lacks(parent, String(NA.radiusPm), "the parent comparison does not use a covalent radius");
lacks(parent, "102", "the parent comparison does not use an ionic radius");

const EXCEPTION = "Explain the exceptions in the first ionisation enthalpy: beryllium versus boron, and nitrogen versus oxygen. The trend is not monotonic.";
const exception = drawn(EXCEPTION);
has(exception, "Be>B", "beryllium is above boron");
has(exception, "N>O", "nitrogen is above oxygen");
has(exception, "not monotonic", "the first ionisation enthalpy is not monotonic");
has(exception, `${BE.ie1}>${B.ie1}`, "Be and B keep the table values");
has(exception, `${N.ie1}>${O.ie1}`, "N and O keep the table values");
has(exception, `${BE.ie1}>${B.ie1} kJ/mol`, "Be and B are in kJ/mol");
has(exception, `${N.ie1}>${O.ie1} kJ/mol`, "N and O are in kJ/mol");
check(
  exception !== null && exception.labels.every((label) => !label.includes("monotonic") || label.includes("not monotonic")),
  "the exception figure does not claim a monotonic rise",
);
check(
  exception !== null && !exception.labels.some((label) => /Be<B|B>Be|N<O|O>N/.test(label)),
  "the exceptions are not reversed",
);

const MONOTONIC = "Draw a monotonic increase in the first ionisation enthalpy from Be to B to N to O.";
const monotonic = drawn(MONOTONIC);
has(monotonic, "Be>B", "a monotonic request still shows Be above B");
has(monotonic, "N>O", "a monotonic request still shows N above O");
has(monotonic, "not monotonic", "a monotonic increase is not drawn");
has(monotonic, `${BE.ie1}>${B.ie1}`, "the monotonic request keeps the Be/B values");
check(
  monotonic !== null && !monotonic.labels.some((label) => label === "monotonic" || label.includes("Be<B") || label.includes("N<O")),
  "the monotonic wording is not drawn as the trend",
);
const monotonicDocument = buildPeriodicSizeScene(MONOTONIC, [], false);
check(
  monotonicDocument !== null && !monotonicDocument.entities.some((entity) => entity.kind === "polyline"),
  "the exception is not drawn as a rising trend line",
);

const AMERICAN = "The first ionization energy of Be is greater than that of B.";
const american = drawn(AMERICAN);
has(american, "Be>B", "American spelling still shows Be above B");
has(american, "N>O", "the nitrogen-oxygen exception is kept beside beryllium-boron");
has(american, "not monotonic", "one named exception still says the trend is not monotonic");

const IE2 = "The second ionisation enthalpy of Na is 4562 kJ/mol. Do not use the first ionisation enthalpy in its place.";
const ie2 = drawn(IE2);
has(ie2, "IE2=4562", "the second ionisation enthalpy is the stem value");
has(ie2, "not IE1", "the second value is marked as not the first");
has(ie2, "from stem", "the second value is marked as supplied");
lacks(ie2, String(NA.ie1), "Na first ionisation enthalpy is not reused as the second");

const BOTH = "The second ionisation enthalpy of Na is 4562 kJ/mol and the second ionisation enthalpy of Mg is 1450 kJ/mol.";
const both = drawn(BOTH);
has(both, "Na IE2=4562", "sodium's second enthalpy stays the supplied value");
has(both, "Mg IE2=1450", "magnesium's second enthalpy stays the supplied value");
lacks(both, String(NA.ie1), "sodium's first enthalpy is not copied into the second");
lacks(both, String(MG.ie1), "magnesium's first enthalpy is not copied into the second");

const IE3 = "The third ionisation enthalpy of Al is 2745 kJ/mol.";
const ie3 = drawn(IE3);
has(ie3, "IE3=2745", "the third ionisation enthalpy is the stem value");
has(ie3, "not IE1", "the third value is not the first");
lacks(ie3, String(AL.ie1), "Al first ionisation enthalpy is not reused");

const JUMP = "Successive ionisation enthalpies of Li are 520, 7298 and 11815 kJ/mol. The jump after the first is a new shell.";
const jump = drawn(JUMP);
has(jump, "IE1=520", "the supplied first value matches the table and stays the first");
has(jump, "IE2=7298", "the second value is the stem value");
has(jump, "IE3=11815", "the third value is the stem value");
has(jump, "jump stated", "the shell jump is marked only because later values were supplied");
has(jump, "not from IE1", "the shell jump is not taken from the first value alone");
check(
  jump !== null && jump.labels.some((label) => label.includes("IE2") && label.includes("7298") && !label.includes("520")),
  "the second enthalpy is not the first",
);

declined(
  "Plot the covalent radius of Na and the ionic radius of Na+ on the same axis.",
  "covalent and ionic radii are not plotted on one axis",
);
declined(
  "Arrange the ionic radii of Na+, Mg2+, Al3+ and Si4+. Fill in the unknown radius.",
  "an unknown ionic radius is not filled in",
);
check(
  buildPeriodicSizeScene(
    "Arrange the ionic radii of Na+, Mg2+, Al3+ and Si4+. Fill in the unknown radius.",
    [{ id: "r", symbol: "r", value: 40, unit: "pm" }],
    false,
  ) === null,
  "a planner value does not fill Si4+",
);
declined(
  "Estimate the ionic radius of K+ from the covalent radius of K.",
  "a covalent radius is not converted into an ionic radius",
);
declined(
  "Using only the first ionisation enthalpy of Na, show the shell jump when the second electron is removed.",
  "a shell jump is not drawn from the first ionisation enthalpy alone",
);
declined(
  "What is the second ionisation enthalpy of sodium?",
  "a missing second ionisation enthalpy is not replaced by the first",
);
declined(
  "The second ionisation enthalpy of Na is 496 kJ/mol.",
  "the first ionisation enthalpy is not accepted as the second",
);
declined(
  "Successive ionisation enthalpies of Li are 100, 7298 and 11815 kJ/mol. The jump is a new shell.",
  "a successive list that contradicts the first ionisation enthalpy is rejected",
);
declined(
  "State the van der Waals radius of neon. It is not the covalent radius.",
  "a van der Waals radius is not filled from the covalent radius",
);

released("Arrange K+ and Ca2+ in increasing order of ionic radius.", "ions outside the six-coordinate list are left to the existing trend figure");
released("How does the atomic radius change across period 2?", "a period covalent-radius curve is not claimed here");
released("Describe the trend in electronegativity down group 17.", "electronegativity is not claimed here");

const HANDOFF = [
  "Plot the variation of first ionisation enthalpy across period 3 from Na to Ar and explain the irregularities.",
  "How does the first ionisation enthalpy vary across the second period of the periodic table?",
  "How does the atomic radius change down group 1 (alkali metals)?",
  "The correct order of first ionisation enthalpy of Na, Mg, Al and Si is",
  "Arrange Na+, Mg2+, F- and O2- in increasing order of ionic radius.",
];
for (const question of HANDOFF) {
  released(question, `existing trend figure keeps: ${question.slice(0, 48)}`);
  check(isPeriodicTrendStem(question), `periodic trend still recognises: ${question.slice(0, 48)}`);
}

for (const probe of PERIODIC_PROBES) {
  const successive = /second ionisation|third ionisation|successive ionisation/i.test(probe.question);
  if (successive) {
    declined(probe.question, "second ionisation enthalpy without a supplied number declines");
  } else {
    released(probe.question, `probe stays on periodic trend: ${probe.question.slice(0, 48)}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("c09b size: ionic radii, radius definitions, and ionisation enthalpy checks passed");
