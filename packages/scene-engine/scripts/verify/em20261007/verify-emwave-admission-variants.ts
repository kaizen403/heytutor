import assert from "node:assert/strict";
import type { ExpressionNodeIR, ProblemIR, QuestionSourceEvidence } from "../../../src/ir/problemIR";
import { validateProblemIR } from "../../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../../src/ir/solver";
import {
  explicitModelScalar,
  modelAdmission,
  modelAdmissionEvidenceText,
  modelAdmissionRequiredAssumptions,
  modelAdmissionRole,
} from "../../../src/physics/em20261007/admission";
import { explicitPhysicalModelScene } from "../../../src/physics/em20261007/consume";

function fixture(model: string, inputs: Record<string, number>): { question: string; problem: ProblemIR } {
  const admission = modelAdmission(model);
  assert(admission, `${model}: registered admission`);
  const assumptions = modelAdmissionRequiredAssumptions(model, inputs);
  const roles = Object.fromEntries(Object.keys(inputs).map((key) => {
    const value = modelAdmissionRole(model, key, inputs);
    assert(value, `${model}.${key}: admitted role`);
    return [key, value];
  }));
  const output = Object.keys(explicitModelScalar(model, inputs) ?? {})[0];
  const ask = output ? `Find ${output}.` : "Draw the requested representation.";
  const segments = [
    ...assumptions.map((assumption) => `The source states ${assumption}.`),
    ...Object.keys(inputs).map((key) => modelAdmissionEvidenceText(model, key, inputs[key]!, inputs)!),
    ask,
  ];
  const question = segments.join(" ");
  const evidence = (quote: string): QuestionSourceEvidence => {
    const start = question.indexOf(quote);
    assert(start >= 0, `${model}: source quote ${quote}`);
    return { source: "question", start, end: start + quote.length, quote };
  };
  const assumptionFacts = assumptions.map((assumption, index) => {
    const quote = `The source states ${assumption}.`;
    return { id: `assumption_${index}`, kind: "assumption" as const, statement: quote, evidence: evidence(quote) };
  });
  const givenFacts = Object.keys(inputs).map((key) => {
    const quote = modelAdmissionEvidenceText(model, key, inputs[key]!, inputs)!;
    return { id: `given_${key}`, kind: "given" as const, statement: quote, evidence: evidence(quote) };
  });
  const expressions = Object.keys(inputs).map((key) => ({
    id: `expr_${key}`,
    valueType: "scalar" as const,
    root: { kind: "number", value: inputs[key]! } as ExpressionNodeIR,
    evidenceFactIds: [`given_${key}`],
  }));
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1",
    id: `emwave_${model.replace(".", "_")}`,
    question,
    facts: [...assumptionFacts, ...givenFacts, { id: "asked", kind: "requested", statement: ask, evidence: evidence(ask) }],
    entities: [], expressions, constraints: [], representationIntents: [],
    solveRequests: [{
      id: "explicitModel", kind: "explicit_physical_model", model,
      bindings: Object.entries(roles).map(([key, role]) => ({ key, role: role.role, unit: role.unit, expressionId: `expr_${key}`, evidenceFactId: `given_${key}` })),
      evidenceFactIds: ["asked"],
      ...(output ? { resultBinding: { turnPlanQuantityId: "result", symbol: output, unit: "1", evidenceFactIds: ["asked"] } } : {}),
    }],
  };
  return { question, problem };
}

const cases: Array<[string, Record<string, number>]> = [
  ["emw.triad", { crossed: 1, kSign: -1, eSign: 1, theta: 0 }],
  ["emw.amplitude", { c: 3, B: 2, crossed: 1, kSign: -1, eSign: -1, theta: Math.PI / 3, lambda: 2, phase: 0.4, time: 0.2 }],
  ["emw.speed", { mu0: 2, eps0: 0.5, medium: 0, f: 4, lambda: 0.25 }],
  ["emw.speed", { mu0: 2, eps0: 0.5, medium: 1, isotropic: 1, lossless: 1, muR: 1, epsR: 4, f: 2, lambda: 0.25 }],
  ["emw.energy", { eps0: 2, E: 3, c: 0.5, convention: 1, reflection: 1, mu0: 2, kSign: -1, eSign: 1, theta: 0 }],
  ["emw.energy", { eps0: 2, E: 3, c: 0.5, convention: 2, reflection: 0, mu0: 2 }],
  ["emw.production", { q: -1, a: 2, farField: 1, dipole: 1, axisAngle: 0, outgoingAngle: Math.PI / 2 }],
  ["emw.production", { q: 1, a: 2, antenna: 1, length: 1, frequency: 3, farField: 1, dipole: 1, axisAngle: 0, outgoingAngle: Math.PI / 2 }],
  ["emw.spectrum", { shown: 1, order: -1, boundUnit: 1, edge0: 1, edge1: 2, edge2: 3, edge3: 4, edge4: 5, edge5: 6, edge6: 7, edge7: 8 }],
  ["emw.spectrum", { shown: 1, boundUnit: 2, radioMin: 7, radioMax: 8, microwaveMin: 6, microwaveMax: 7, infraredMin: 5, infraredMax: 6, visibleMin: 4, visibleMax: 5, ultravioletMin: 3, ultravioletMax: 4, xrayMin: 2, xrayMax: 3, gammaMin: 1, gammaMax: 2 }],
  ["emw.applications", { radio: 1, microwave: 0, infrared: 0, visible: 1, ultraviolet: 0, xray: 0, gamma: 0, sourceContext: 1, useCode: 1, useCode2: 5 }],
  ["emw.displacement", { eps0: 2, dPhi: 5, conduction: 20, continuity: 1, dielectric: 1, epsR: 2, linear: 1, homogeneous: 1, area: 5, dE: 1, uniform: 1 }],
  ["emw.displacement", { eps0: 2, dPhi: 0, conduction: 0, continuity: 1 }],
];

const solver = new LocalDeterministicSolverProvider();
let checks = 0;
for (const [model, inputs] of cases) {
  const { question, problem } = fixture(model, inputs);
  const validated = validateProblemIR(problem, question);
  assert(validated.problem, `${model}: ${validated.issues.map((issue) => issue.message).join("; ")}`);
  const selected = explicitPhysicalModelScene(question, problem);
  assert(selected.handled && selected.document, `${model}: admitted source variant reaches the family seam`);
  const result = await solver.solve(problem);
  assert.equal(result.status, "solved", `${model}: deterministic solver completion`);
  assert.equal(validateSolverResult(result, problem).valid, true, `${model}: solver result boundary`);
  const wrongUnit = structuredClone(problem);
  wrongUnit.solveRequests[0]!.bindings[0]!.unit = "forged";
  assert.equal(validateProblemIR(wrongUnit, question).problem, null, `${model}: wrong unit rejects`);
  checks += 1;
}

const metreSpectrum = fixture("emw.spectrum", cases[9]![1]);
const metreEdge = metreSpectrum.problem.solveRequests[0]!.bindings.find((binding) => binding.key === "radioMin")!;
assert.equal(metreEdge.unit, "m");
metreEdge.unit = "Hz";
assert.equal(validateProblemIR(metreSpectrum.problem, metreSpectrum.question).problem, null, "wavelength bounds cannot be rebound as hertz");

const partialWave = fixture("emw.amplitude", cases[1]![1]);
partialWave.problem.solveRequests[0]!.bindings = partialWave.problem.solveRequests[0]!.bindings.filter((binding) => binding.key !== "time");
partialWave.problem.expressions = partialWave.problem.expressions.filter((expression) => expression.id !== "expr_time");
partialWave.problem.facts = partialWave.problem.facts.filter((fact) => fact.id !== "given_time");
assert.equal(validateProblemIR(partialWave.problem, partialWave.question).problem, null, "partial phase/orientation variant rejects atomically");

const mixedSpectrum = fixture("emw.spectrum", cases[8]![1]);
for (const [key, value] of Object.entries({ radioMin: 7, radioMax: 8, microwaveMin: 6, microwaveMax: 7, infraredMin: 5, infraredMax: 6, visibleMin: 4, visibleMax: 5, ultravioletMin: 3, ultravioletMax: 4, xrayMin: 2, xrayMax: 3, gammaMin: 1, gammaMax: 2 })) {
  const text = modelAdmissionEvidenceText("emw.spectrum", key, value, { ...cases[8]![1], [key]: value })!;
  const start = mixedSpectrum.question.length;
  mixedSpectrum.question += ` ${text}`;
  mixedSpectrum.problem.question = mixedSpectrum.question;
  mixedSpectrum.problem.facts.push({ id: `given_${key}`, kind: "given", statement: text, evidence: { source: "question", start: start + 1, end: start + 1 + text.length, quote: text } });
  mixedSpectrum.problem.expressions.push({ id: `expr_${key}`, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: [`given_${key}`] });
  const resolved = modelAdmissionRole("emw.spectrum", key, { ...cases[8]![1], [key]: value })!;
  mixedSpectrum.problem.solveRequests[0]!.bindings.push({ key, role: resolved.role, unit: resolved.unit, expressionId: `expr_${key}`, evidenceFactId: `given_${key}` });
}
assert.equal(validateProblemIR(mixedSpectrum.problem, mixedSpectrum.question).problem, null, "adjacent and independent spectrum bounds are mutually exclusive");

console.log(`EM-wave conditional source-admission checks passed (${checks} admitted variants plus unit/group adversaries)`);
