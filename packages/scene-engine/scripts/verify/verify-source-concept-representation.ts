import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import {
  buildSourceConceptRepresentation,
  sourceConceptRepresentationRejection,
} from "../../src/synthesize/sourceConceptRepresentation";
import type { SceneDocument } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

function plan(question: string, claim: string, expected: string, hints: string[] = []) {
  return {
    schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [],
    assumptions: [], lawIds: [], visualRequirement: "required",
    qualitativeClaims: [{ id: "source_relation", claim, expected, relatedEntityHints: hints }],
  };
}

const cases = [
  {
    id: "born",
    question: "Explain the probability interpretation of a quantum wavefunction.",
    claim: "The probability density is the squared modulus of the wave function.",
    expected: "Born rule: probability density equals the modulus squared; integrate the density over a region to obtain its probability.",
    required: ["wavefunction", "probability_density"],
    lawIds: [],
  },
  {
    id: "induction",
    question: "Teach the connections in electricity and electromagnetism.",
    claim: "Explain induced emf in a magnetic field.",
    expected: "Induced emf is part of electromagnetic induction.",
    required: ["magnetic_flux_change", "induced_emf"],
    lawIds: ["Faraday's Law of Induction"],
  },
  {
    id: "constructor",
    question: "Explain constructors and object initialization.",
    claim: "A constructor is invoked when an instance is created.",
    expected: "Constructors initialize the state of the new object during instance creation.",
    required: ["instance_creation", "constructor", "initialized_object"],
    lawIds: [],
  },
  {
    id: "circulation",
    question: "Explain blood circulation through the human heart.",
    claim: "Trace the blood flow through the four chambers and both circuits.",
    expected: "Body to right atrium to right ventricle to lungs to left atrium to left ventricle to body. The pulmonary and systemic circuits form double circulation.",
    required: ["right_atrium", "right_ventricle", "lungs", "left_atrium", "left_ventricle", "body"],
    lawIds: [],
  },
  {
    id: "neuron",
    question: "Explain neuronal action potentials with depolarisation and repolarisation.",
    claim: "Explain an action potential in successive stages.",
    expected: "At rest, then depolarisation as Na+ enters, repolarisation as K+ leaves, hyperpolarisation, and restoration of the resting state.",
    required: ["resting_state", "depolarization", "repolarization", "hyperpolarization", "restored_state"],
    lawIds: [],
  },
];

const compiled: Array<{ id: string; document: SceneDocument; primitives: NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]> }> = [];
for (const test of cases) {
  const p = { ...plan(test.question, test.claim, test.expected), lawIds: test.lawIds };
  const document = buildSourceConceptRepresentation(test.question, p);
  assert(document, `${test.id}: a corroborated reference relation must be drawable`);
  assert.equal(sourceConceptRepresentationRejection(document, test.question, p), null);
  assert.equal(document.source.nonMetric, true);
  assert.equal(document.source.representationTier, "question_representation");
  assert.equal(document.quantities.length, 0, "reference relations cannot introduce numeric givens");
  for (const id of test.required) assert(document.entities.some((entity) => entity.id === id));
  assert(document.entities.some((entity) => entity.kind === "vector"), "a claim list is not a representation");
  const validation = validateSceneDocument(document);
  assert(validation.document, JSON.stringify(validation.report.issues));
  assert.equal(sourceConceptRepresentationRejection(validation.document, test.question, p), null);
  const result = compileSceneDocument(validation.document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert(result.renderScene.primitives.filter((primitive) => primitive.kind === "label").length >= test.required.length);
  compiled.push({ id: test.id, document, primitives: result.renderScene });

  // A compiled scene with the wrong directed relation must still fail source admission.
  const reversed = structuredClone(document);
  const vector = reversed.constructions.find((construction) => construction.operator === "vector")!;
  [vector.inputs.start, vector.inputs.end] = [vector.inputs.end, vector.inputs.start];
  assert(compileSceneDocument(reversed).ok, "the mutation isolates semantic admission from geometrical validity");
  assert(sourceConceptRepresentationRejection(reversed, test.question, p), "reversed source relation must be rejected");
  const missing = structuredClone(document);
  missing.assertions = missing.assertions.filter((assertion) => assertion.predicate !== "incident");
  assert(sourceConceptRepresentationRejection(missing, test.question, p), "missing source attachment proof must be rejected");
  const wrongRole = structuredClone(document);
  wrongRole.entities.find((entity) => entity.id === test.required[0])!.role = "unrelated topic";
  assert(sourceConceptRepresentationRejection(wrongRole, test.question, p), "wrong semantic role must be rejected");
  const forged = structuredClone(document);
  forged.source.conceptReferenceIds = ["unknown_reference"];
  assert(sourceConceptRepresentationRejection(forged, test.question, p), "unknown references cannot certify a diagram");
  const noMarker = structuredClone(document);
  delete noMarker.source.sourceConceptRepresentation;
  assert(sourceConceptRepresentationRejection(noMarker, test.question, p), "deleting the marker cannot disable source checks");
  assert(sourceConceptRepresentationRejection(document, "An unrelated question.", p), "stale question binding must reject");
  assert(sourceConceptRepresentationRejection(document, test.question, { ...p, qualitativeClaims: [] }), "stale plan binding must reject");
  assert(result.renderScene.primitives.every((primitive) => primitive.points.every((point) => point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700)), "diagram primitives must remain in the board diagram zone");
}

const born = cases[0]!;
const bp = plan(born.question, born.claim, born.expected);
assert.equal(buildSourceConceptRepresentation("Explain sound waves.", bp), null, "a wavefunction must not become a sound wave");
assert.equal(buildSourceConceptRepresentation(born.question, { ...bp, qualitativeClaims: [] }), null, "a topic name alone cannot produce a graph");
assert.equal(buildSourceConceptRepresentation(born.question, plan(born.question, "Probability", "Probability is useful")), null, "a generic claim list is insufficient");
assert.equal(buildSourceConceptRepresentation(born.question, plan(born.question, born.claim, "Probability density is not the squared modulus of the wave function.")), null, "contradictory Born claims must decline");
assert.equal(buildSourceConceptRepresentation(born.question, plan(born.question, "Probability density is not the squared modulus of the wave function.", born.expected)), null, "a false claim cannot be hidden by a correct expected string");
for (const falseOperation of [
  "Probability density is the unsquared modulus of the wavefunction, rather than the modulus squared.",
  "Probability density is the real part of the wavefunction instead of its squared modulus.",
  "Probability density is the cubed modulus of the wavefunction, rather than its modulus squared.",
  "Probability density uses the imaginary part of the wavefunction; its squared modulus is a different quantity.",
  "Probability density equals the reciprocal of the modulus squared of the wavefunction.",
  "Probability density is the inverse of the squared modulus of the wavefunction.",
  "Probability density equals the square root of the modulus squared of the wavefunction.",
  "Probability density equals the logarithm of the modulus squared of the wavefunction.",
  "Probability density equals an unspecified transform of the squared modulus of the wavefunction.",
  "The reciprocal of the modulus squared of the wavefunction gives probability density.",
  "The modulus squared of the wavefunction divided by two gives probability density.",
  "Probability density equals sqrt(|psi|^2).",
  "Probability density equals 1 / |psi|^2.",
  "Probability density equals log(|psi|^2).",
  "Probability density equals |psi|^2 + 1.",
  "Probability density involves an inverse operator on the squared modulus of the wavefunction.",
]) {
  assert.equal(buildSourceConceptRepresentation(born.question, {
    ...bp, qualitativeClaims: [{ id: "false_operation", claim: falseOperation, expected: true }],
  }), null, "a false affirmed operation cannot borrow words from its negated alternative");
  assert.equal(buildSourceConceptRepresentation(born.question, plan(born.question, falseOperation, born.expected)), null, "a correct expected operation cannot conceal a false claim operation");
}
assert(buildSourceConceptRepresentation(born.question, plan(born.question,
  "Probability density is the modulus squared of the wavefunction, rather than the unsquared modulus.", born.expected)),
"an affirmed correct operation must not be rejected because its denied alternative is wrong");
for (const directOperation of [
  "The squared modulus of the wavefunction gives probability density.",
  "psi(x,t) is a complex amplitude whose magnitude squared yields the probability density at x.",
  "psi is a probability amplitude, its modulus squared gives probability density.",
  "Probability density = |psi(x,t)|^2.",
]) assert(buildSourceConceptRepresentation(born.question, {
  ...bp, qualitativeClaims: [{ id: "direct_operation", claim: directOperation, expected: true }],
}), "a bounded affirmative equality or direct transformation must bind");
assert.equal(buildSourceConceptRepresentation(born.question, {
  ...bp, qualitativeClaims: [{ id: "hints_only", claim: "Discuss quantum probability density.", expected: true,
    relatedEntityHints: ["wavefunction", "modulus squared"] }],
}), null, "entity hints alone cannot establish the transformation operation");
assert.equal(buildSourceConceptRepresentation(born.question, { ...bp, visualRequirement: "none" }), null);
assert.equal(buildSourceConceptRepresentation(born.question, { ...bp, givens: [{ id: "invented", symbol: "A", value: 2, provenance: "given" }] }), null, "reference graph cannot conceal source numeric obligations");
assert.equal(buildSourceConceptRepresentation("Explain constructors.", plan("Explain constructors.", "Inheritance", "A subclass inherits from a superclass")), null, "an unrelated OOP relation cannot replace construction");
assert.equal(buildSourceConceptRepresentation("Explain the heart.", plan("Explain the heart.", "Blood flow", "Heart sends blood to lungs")), null, "a partial chamber path cannot certify the circulation");
const circulation = cases.find((test) => test.id === "circulation")!;
assert.equal(buildSourceConceptRepresentation(circulation.question, plan(circulation.question, "Blood flows from the left ventricle to the lungs.", circulation.expected)), null, "reference facts cannot conceal false chamber flow in the claim");
assert.equal(buildSourceConceptRepresentation("Explain an action potential.", plan("Explain an action potential.", "Phases", "Sodium leaves during depolarization and potassium enters during repolarization.")), null, "reversed physiological ion flow must decline");
const neuron = cases.find((test) => test.id === "neuron")!;
assert.equal(buildSourceConceptRepresentation(neuron.question, plan(neuron.question, "Sodium ions leave during depolarisation.", neuron.expected)), null, "a correct expected string cannot conceal reversed ion flow in the claim");
const induction = cases.find((test) => test.id === "induction")!;
assert.equal(buildSourceConceptRepresentation(induction.question, plan(induction.question, induction.claim, induction.expected)), null, "a broad field/emf hint without the named reference law is insufficient");
assert.equal(buildSourceConceptRepresentation(induction.question, {
  ...plan(induction.question, "Induced emf causes the magnetic flux to change.", induction.expected), lawIds: induction.lawIds,
}), null, "a reversed Faraday relation cannot borrow a correct law tag");
assert.equal(buildSourceConceptRepresentation(induction.question, {
  ...plan(induction.question, "Constant magnetic flux induces an emf instead of changing magnetic flux inducing it.", induction.expected), lawIds: induction.lawIds,
}), null, "constant flux cannot substitute for the flux-change operation");
const constructor = cases.find((test) => test.id === "constructor")!;
assert.equal(buildSourceConceptRepresentation(constructor.question, plan(constructor.question,
  "The initialized object creates the constructor when its instance is created.", constructor.expected)), null,
"reversed object-construction causality must reject");
assert.equal(buildSourceConceptRepresentation(constructor.question, plan(constructor.question,
  "The constructor is invoked after the object is fully initialized.", constructor.expected)), null,
"constructor invocation after completed initialization must reject");

// Wording and subject holdouts use the same relations and generic graph layout.
for (const question of ["What does a wave function mean?", "How is a wave-function interpreted?", "Describe quantum wavefunctions."]) {
  assert(buildSourceConceptRepresentation(question, plan(question, born.claim, born.expected)));
}
for (const question of ["What is a constructor?", "Describe constructor invocation for new objects."]) {
  const c = cases.find((test) => test.id === "constructor")!;
  assert(buildSourceConceptRepresentation(question, plan(question, c.claim, c.expected)));
}
const output = process.argv.find((argument) => argument.startsWith("--render-dir="))?.slice("--render-dir=".length);
if (output) {
  mkdirSync(output, { recursive: true });
  for (const entry of compiled) {
    writeFileSync(`${output}/${entry.id}.json`, JSON.stringify(entry, null, 2));
    writeFileSync(`${output}/${entry.id}.svg`, renderSceneSvg(entry.primitives, { title: `Synthetic ${entry.id} relationship representation`, subtitle: "Question representation; nonmetric reference-bound topology" }));
  }
}
console.log("source concept representation verification passed: five semantic graphs, holdouts, source negatives and admission mutations");
