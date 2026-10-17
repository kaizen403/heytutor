/** Complete relative rate changes and original-span Arrhenius expression keywords. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { kineticsFromStem, solveKinetics, buildKineticsScene } from "../../src/chemistry/kinetics";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileForLab } from "../chemistry-lab/lab";
import { readChemistryArrheniusEquation } from "../../src/chemistry/quantityReader";

const failures: string[] = [];
const evidence: unknown[] = [];
let passed = 0;
function check(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function near(actual: unknown, expected: number): void {
  assert(typeof actual === "number" && Number.isFinite(actual));
  assert(Math.abs(actual - expected) < Math.max(Math.abs(expected) * 1e-10, 1e-6), `${actual} != ${expected}`);
}
const relative = [
  { name: "owner-three-times-original", question: "The rate constant becomes 3 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.", ratio: 3, first: 300, last: 310, energy: 84944.92188227581 },
  { name: "fresh-four-times", question: "The rate constant becomes 4 times the original value when the temperature rises from 300 K to 320 K. Calculate the activation energy.", ratio: 4, first: 300, last: 320, energy: 55323.12632808369 },
  { name: "fresh-decimal-times", question: "The rate constant becomes 2.5 times its value when temperature rises from 290 K to 310 K. Calculate the activation energy.", ratio: 2.5, first: 290, last: 310, energy: 34243.094945883764 },
  { name: "fresh-five-fold", question: "The rate constant becomes 5-fold its original value when temperature rises from 300 K to 330 K. Calculate the activation energy.", ratio: 5, first: 300, last: 330, energy: 44156.860453124435 },
  { name: "fresh-increases-four-fold", question: "The rate constant increases 4-fold when temperature rises from 300 K to 320 K. Calculate the activation energy.", ratio: 4, first: 300, last: 320, energy: 55323.12632808369 },
  { name: "fresh-space-fold", question: "The rate constant becomes 1.5 fold its original value when temperature rises from 280 K to 300 K. Calculate the activation energy.", ratio: 1.5, first: 280, last: 300, energy: 14158.35501700739 },
];
for (const row of relative) check(row.name, () => {
  const spec = kineticsFromStem(row.question);
  assert(spec?.arrhenius, "a complete relative change must reach the Arrhenius reader");
  assert.equal(spec.k, null, "a multiplier is not an absolute rate constant");
  assert.equal(spec.arrhenius.k1, null); assert.equal(spec.arrhenius.k2, null);
  near(spec.arrhenius.ratio, row.ratio); near(spec.arrhenius.T1, row.first); near(spec.arrhenius.T2, row.last);
  near(solveKinetics(spec).Ea, row.energy);
  const document = buildKineticsScene(row.question, [], false);
  const compiled = compileForLab(document);
  assert(document && compiled.ok && compiled.renderScene, JSON.stringify(compiled.issues));
  near(document.quantities.find((value) => value.id === "Ea")?.value, row.energy);
  near(document.quantities.find((value) => value.id === "ratio")?.value, row.ratio);
  const family = synthesizeFamilyScene({ question: row.question });
  assert.equal(family?.family, "chem_kinetics", "normal production family synthesis must retain the figure");
  evidence.push({ name: row.name, question: row.question, Ea: solveKinetics(spec).Ea, labels: compiled.labels });
});
for (const [index, payload] of ["3e- times", "3/0 times", "0 times", "-3 times", "3-fold per second", "3 times its unreadable original value"].entries()) check(`damaged-or-nonrelative-change-${index + 1}`, () => {
  const question = `The rate constant becomes ${payload} when temperature rises from 300 K to 310 K. Calculate the activation energy.`;
  assert.equal(kineticsFromStem(question), null, "unread original material cannot become an absent absolute rate");
  assert.equal(buildKineticsScene(question, [], false), null);
});
for (const [index, question] of [
  "The rate constant becomes 3 times its original value when temperature rises from 300 K to 310 K. The rate constant is unknown. Calculate the activation energy.",
  "The rate constant is unreadable. The rate constant becomes 3 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.",
  "The rate constant becomes 3 times its original value when temperature rises from 300 K to 310 K. The ratio k2/k1 is 4. Calculate the activation energy.",
].entries()) check(`independent-owner-or-ratio-conflict-${index + 1}`, () => {
  assert.equal(kineticsFromStem(question), null);
  assert.equal(buildKineticsScene(question, [], false), null);
});
for (const subject of ["The rate constant", "The rate"]) for (const [index, change] of ["increases by 3 times its original value", "decreases 3 fold", "changes by 4 times its original value", "decreases 4-fold"].entries()) check(`ambiguous-magnitude-or-direction-${subject}-${index + 1}`, () => {
  const question = `${subject} ${change} when temperature rises from 300 K to 310 K. Calculate the activation energy.`;
  const spec = kineticsFromStem(question);
  const document = buildKineticsScene(question, [], false);
  const diagnostic = JSON.stringify({ solvedEa: spec ? solveKinetics(spec).Ea : null, caption: document?.annotations.map((annotation) => annotation.text) });
  assert.equal(spec, null, `ambiguous magnitude/direction must not become a positive multiplier: ${diagnostic}`);
  assert.equal(document, null, diagnostic);
});
const equations = [
  { name: "owner-uppercase-LN", question: "LN k = 5 - 2000/T. Draw the Arrhenius plot.", coefficient: 2000, literal: "2000", natural: true, energy: 16628, display: "16.6" },
  { name: "fresh-uppercase-LOG", question: "LOG k = 5 - 2000/T. Draw the Arrhenius plot.", coefficient: 2000, literal: "2000", natural: false, energy: 38287.38492630499, display: "38.3" },
  { name: "fresh-mixed-Ln-original-span", question: "🧪 Given: Ln k = 2.5 - 1250/T. Draw the Arrhenius plot.", coefficient: 1250, literal: "1250", natural: true, energy: 10392.5, display: "10.4" },
  { name: "fresh-mixed-lOg-scientific", question: "lOg k = 3.2 - 1.5e3/T. Draw the Arrhenius plot.", coefficient: 1500, literal: "1.5e3", natural: false, energy: 28715.538694728748, display: "28.7" },
  { name: "lowercase-ln-control", question: "ln k = 5 - 2000/T. Draw the Arrhenius plot.", coefficient: 2000, literal: "2000", natural: true, energy: 16628, display: "16.6" },
  { name: "lowercase-log-control", question: "log k = 5 - 2000/T. Draw the Arrhenius plot.", coefficient: 2000, literal: "2000", natural: false, energy: 38287.38492630499, display: "38.3" },
];
for (const row of equations) check(row.name, () => {
  const read = readChemistryArrheniusEquation(row.question);
  assert(read.ok, JSON.stringify(read));
  assert.equal(read.reading.natural, row.natural);
  near(read.reading.coefficient.value, row.coefficient);
  assert.equal(read.reading.coefficient.text, row.literal);
  assert.equal(read.reading.coefficient.span.start, row.question.indexOf(row.literal));
  assert.equal(row.question.slice(read.reading.coefficient.span.start, read.reading.coefficient.span.end), row.literal);
  assert.equal(row.question.slice(read.reading.source.span.start, read.reading.source.span.end), read.reading.source.text);
  const spec = kineticsFromStem(row.question);
  assert(spec?.arrhenius?.statedSlope);
  assert.equal(spec.k, null); assert.equal(spec.arrhenius.statedSlope.natural, row.natural);
  near(solveKinetics(spec).Ea, row.energy);
  const document = buildKineticsScene(row.question, [], false);
  const compiled = compileForLab(document);
  assert(document && compiled.ok && compiled.renderScene, JSON.stringify(compiled.issues));
  assert(document.annotations.some((annotation) => annotation.text?.includes(`E_a = ${row.display} kJ/mol`)), "the exact solver value must reach the qualitative plot caption at display precision");
  assert.equal(synthesizeFamilyScene({ question: row.question })?.family, "chem_kinetics");
  evidence.push({ name: row.name, source: read.reading, Ea: solveKinetics(spec).Ea, labels: compiled.labels });
});
for (const [index, expression] of ["LN K = 5 - 2000/T", "LN k = 5 - 2000e-/T", "LOG k = 5 - 2000/T^2", "LOG k = 5 - 2000/T; LN k = 4 - 1000/T", "LN k = 5 - 0/T"].entries()) check(`expression-boundary-and-symbol-case-${index + 1}`, () => {
  assert.equal(readChemistryArrheniusEquation(`${expression}. Draw the Arrhenius plot.`).ok, false);
});

const qaRefusals = [
  { name: "physical-symbol-uppercase-K-LN", question: "LN K = 5 - 2000/T. Draw the Arrhenius plot.", badExpression: true },
  { name: "physical-symbol-uppercase-K-LOG", question: "LOG K = 5 - 2000/T. Draw the Arrhenius plot.", badExpression: true },
  { name: "physical-symbol-uppercase-K-mixed", question: "Ln K = 3 - 1500/T. Draw the Arrhenius plot.", badExpression: true },
  {
    "name": "qa-contradictory-half-increases",
    "question": "The rate constant increases 0.5-fold when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "qa-contradictory-equal-increases",
    "question": "The rate constant increases 1-fold when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "qa-becomes-one-times",
    "question": "The rate constant becomes 1 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "qa-becomes-half-times",
    "question": "The rate constant becomes 0.5 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "qa-unread-extra-equation",
    "question": "LN k = 5 - 2000/T. LN k = unknown. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "qa-unread-extra-equation-before",
    "question": "LN k = unknown. LN k = 5 - 2000/T. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "qa-unread-extra-lowercase-equation",
    "question": "ln k = 5 - 2000/T. ln k = unknown. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "qa-damaged-extra-expression",
    "question": "LN k = 5 - 2000/T. LOG k = 4 - 1000e-/T. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "qa-zero-extra-expression",
    "question": "LN k = 5 - 2000/T. LOG k = 4 - 0/T. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "qa-extra-physical-slope",
    "question": "LN k = 5 - 2000/T. The activation energy is 50 kJ/mol. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "qa-extra-ratio-slope",
    "question": "The rate constant becomes 3 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy. LN k = 5 - 2000/T. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "qa-extra-ratio-log-slope",
    "question": "The rate constant becomes 3 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy. LOG k = 5 - 2000/T. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "fresh-nonincreasing-1",
    "question": "The rate constant becomes 0.75 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "fresh-nonincreasing-2",
    "question": "The rate constant increases 1/2-fold when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "fresh-nonincreasing-3",
    "question": "The rate constant becomes 1e0-fold its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "fresh-nonincreasing-4",
    "question": "The rate constant increases 1.0 times its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "fresh-nonincreasing-5",
    "question": "The rate constant becomes 3/4 fold its original value when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "badExpression": false
  },
  {
    "name": "fresh-independent-authority-conflict-1",
    "question": "LOG k = 4 - 1500/T. The activation energy is 50 kJ/mol. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "fresh-independent-authority-conflict-2",
    "question": "The activation energy is 60 kJ/mol. Ln k = 5 - 2000/T. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "fresh-independent-authority-conflict-3",
    "question": "lN k = 3 - 1250/T. Ea = 20000 J/mol. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "fresh-independent-authority-conflict-4",
    "question": "The rate constant becomes 4 times its original value when temperature rises from 300 K to 320 K. LOG k = 4 - 1500/T. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "fresh-independent-authority-conflict-5",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. LN k = 5 - 2000/T. Draw the Arrhenius plot.",
    "badExpression": false
  },
  {
    "name": "fresh-complete-owner-inventory-1",
    "question": "LOG k = unreadable. Ln k = 2 - 1500/T. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "fresh-complete-owner-inventory-2",
    "question": "ln k = 5 - 2000/T. lOg k = unavailable. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "fresh-complete-owner-inventory-3",
    "question": "Ln k = 3 - 1250/T. ln k = 4 - 1000e-/T. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "fresh-complete-owner-inventory-4",
    "question": "LN k = 5 - 2000/T. e^(-1000e-/T). Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "fresh-complete-owner-inventory-5",
    "question": "LN k = 5 - 2000/T. e^-1000e-/T. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "fresh-complete-owner-inventory-6",
    "question": "LN k = 5 - 2000/T. k = A e^(-1000e-/T). Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "fresh-complete-owner-inventory-7",
    "question": "e^(-q/T). LOG k = 4 - 1500/T. Draw the Arrhenius plot.",
    "badExpression": true
  },
  {
    "name": "fresh-complete-owner-inventory-8",
    "question": "LOG k = 4 - 1500/T. e^-unreadable/T. Draw the Arrhenius plot.",
    "badExpression": true
  }
];
for (const row of qaRefusals) check(row.name, () => {
  const spec = kineticsFromStem(row.question);
  const document = buildKineticsScene(row.question, [], false);
  assert.equal(spec, null, JSON.stringify({ question: row.question, Ea: spec ? solveKinetics(spec).Ea : null, caption: document?.annotations.map((annotation) => annotation.text) }));
  assert.equal(document, null, "a refusal cannot fall back to a generic qualitative curve");
  if (row.badExpression) assert.equal(readChemistryArrheniusEquation(row.question).ok, false, "every original supported expression owner must be consumed");
});
for (const row of [
  { name: "matching-explicit-LN-energy", question: "LN k = 5 - 2000/T. The activation energy is 16.628 kJ/mol. Draw the Arrhenius plot.", energy: 16628 },
  { name: "matching-LN-temperature-ratio", question: "The rate constant becomes 1.2399285579997819 times its original value when temperature rises from 300 K to 310 K. LN k = 5 - 2000/T. Draw the Arrhenius plot.", energy: 16628 },
  { name: "known-measured-pair-confirms-fold", question: "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate changes by 3.5 fold. Calculate the activation energy.", energy: 96863.88327665535 },
]) check(row.name, () => {
  const spec = kineticsFromStem(row.question); assert(spec?.arrhenius);
  near(solveKinetics(spec).Ea, row.energy);
  const document = buildKineticsScene(row.question, [], false); assert(document);
  assert(compileForLab(document).ok);
});

for (const [index, question] of [
  "The rate constant is halved when the temperature changes from 310 K to 300 K. LN k = 5 - 6446.2687792074785/T. Draw the Arrhenius plot.",
  "The rate constant of a reaction at 310 K is 0.08 s^-1 and at 300 K is 0.04 s^-1. The rate constant is halved. LN k = 5 - 6446.2687792074785/T. Draw the Arrhenius plot.",
].entries()) check(`relative-renderer-caption-${index + 1}`, () => {
  const spec = kineticsFromStem(question);
  const document = buildKineticsScene(question, [], false);
  assert(spec?.arrhenius, "an agreeing positive-energy cooling pair must retain its figure");
  near(solveKinetics(spec).Ea, 53594.27863033097);
  assert(document && compileForLab(document).ok);
  near(document.quantities.find((value) => value.id === "ratio")?.value, 0.5);
  const caption = document.annotations.map((annotation) => annotation.text).join(" ");
  assert(!caption.includes("k rises"), "a cooling decline in k must not be captioned as a rise");
  assert.equal(synthesizeFamilyScene({ question })?.family, "chem_kinetics");
});
check("complete-measured-cooling-pair-keeps-directional-caption", () => {
  const question = "The rate constant of a reaction at 310 K is 0.08 s^-1 and at 300 K is 0.04 s^-1. LN k = 5 - 6446.2687792074785/T. Draw the Arrhenius plot.";
  const spec = kineticsFromStem(question); assert(spec?.arrhenius);
  near(solveKinetics(spec).Ea, 53594.27863033097);
  const document = buildKineticsScene(question, [], false); assert(document && compileForLab(document).ok);
  const caption = document.annotations.map((annotation) => annotation.text).join(" ");
  assert(caption.includes("k goes from")); assert(!caption.includes("k rises"));
});
const output = process.argv.indexOf("--out");
if (output >= 0) writeFileSync(process.argv[output + 1]!, JSON.stringify({ passed, failures, evidence }, null, 2) + "\n");
console.log(`verify-chemistry-arrhenius-rate-case-followups: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
