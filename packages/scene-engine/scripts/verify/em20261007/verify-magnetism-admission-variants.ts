import { strict as assert } from "node:assert";
import { validateProblemIR, type ExpressionNodeIR, type ProblemIR, type QuestionSourceEvidence } from "../../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../../src/ir/solver";
import { modelAdmission, modelAdmissionEvidenceText, modelAdmissionRole } from "../../../src/physics/em20261007/admission";
import { consumePhysicalModel, explicitPhysicalModelScene } from "../../../src/physics/em20261007/consume";

const cases: ReadonlyArray<readonly [string, Readonly<Record<string, number>>]> = [
  ["mf.wire", { mu0: 2 * Math.PI, I: 3, d: 3, start: -3, end: 3 }],
  ["mf.wire", { mu0: 2 * Math.PI, I: 3, d: 2, amperian: 1, externalI: 5, externalRadius: 6 }],
  ["mf.arc", { mu0: 4 * Math.PI, I: -2, delta: Math.PI, R: 2, startAngle: Math.PI / 2, startLead: 4, endLead: 4 }],
  ["mf.loop", { mu0: 2, I: -3, R: 2, x: -2, N: 4, axisAngle: Math.PI / 2 }],
  ["mf.toroid", { mu0: 2 * Math.PI, N: 5, I: -2, a: 3, b: 7, r: 2, ideal: 1 }],
  ["mm.earth", { Bh: 3, Bv: -4, declination: Math.PI / 2, northX: 1, northY: 0 }],
  ["mm.materials", { shown: 1, kind: 1, T1: 100, chi1: 0.006, T2: 200, chi2: 0.003, T3: 300, chi3: 0.002, Tc: 80 }],
  ["mm.dipole", { mu0: 4 * Math.PI, m: 2, r: 2, axial: 1, poleHalfSeparation: 1 }],
  ["mf.revolving", { q: -2, v: 3, r: 4, period: 8 * Math.PI / 3, direction: -1, mass: 5 }],
  ["mf.galvanometer", { N: 10, I: -0.01, A: 2, B: 1, k: 1, G: 100 }],
  ["mf.ampere", { stated: 1, currentSI: 1 }],
  ["mf.loop_torque", { I: -2, Ax: 1, Ay: 2, Az: 3, Bx: 4, By: -1, Bz: 2, N: 3 }],
  ["mf.dipole_moment", { I: -2, A: 5, N: 3, nx: 0, ny: 0, nz: -1 }],
  ["mf.cyclotron", { q: -1, m: 2, B: -2, v: 3, timing: 1, gapVoltage: 5, crossing: 1, rfSign: 1 }],
  ["mf.dipole_torque", { mx: 1, my: 2, mz: 3, Bx: 4, By: -1, Bz: 2, energy: 1 }],
  ["mf.lorentz", { q: -2, vx: 3, vy: 0, vz: 0, Bx: 0, By: 0, Bz: 4, Ex: 1, Ey: 2, Ez: 0 }],
  ["mf.selector", { E: -6, B: 2, crossed: 1, q: -2, vx: -3 }],
];

function fixture(model: string, inputs: Readonly<Record<string, number>>, outputSymbol?: string): ProblemIR {
  const admission = modelAdmission(model);
  assert(admission, `${model}: missing admission`);
  const roles = Object.fromEntries(Object.keys(inputs).map((key) => {
    const admitted = modelAdmissionRole(model, key);
    assert(admitted, `${model}.${key}: missing role`);
    return [key, admitted];
  }));
  const segments = [
    ...admission.assumptions.map((assumption) => `The model is ${assumption}.`),
    ...Object.keys(roles).map((key) => modelAdmissionEvidenceText(model, key, inputs[key]!)!),
    `Find ${outputSymbol ?? "the requested representation"}.`,
  ];
  const question = segments.join(" ");
  const evidence = (quote: string): QuestionSourceEvidence => {
    const start = question.indexOf(quote);
    assert(start >= 0);
    return { source: "question", start, end: start + quote.length, quote };
  };
  return {
    schemaVersion: "problem-ir/v1",
    id: `variant_${model.replace(".", "_")}`,
    question,
    facts: [
      ...admission.assumptions.map((assumption, index) => { const quote = `The model is ${assumption}.`; return { id: `assumption_${index}`, kind: "assumption" as const, statement: quote, evidence: evidence(quote) }; }),
      ...Object.entries(roles).map(([key]) => { const quote = modelAdmissionEvidenceText(model, key, inputs[key]!)!; return { id: `fact_${key}`, kind: "given" as const, statement: quote, evidence: evidence(quote) }; }),
      { id: "asked", kind: "requested", statement: `Find ${outputSymbol ?? "the requested representation"}.`, evidence: evidence(`Find ${outputSymbol ?? "the requested representation"}.`) },
    ],
    entities: [],
    expressions: Object.keys(roles).map((key) => ({ id: `expr_${key}`, valueType: "scalar", root: { kind: "number", value: inputs[key] } as ExpressionNodeIR, evidenceFactIds: [`fact_${key}`] })),
    constraints: [],
    representationIntents: [],
    solveRequests: [{ id: "explicitModel", kind: "explicit_physical_model", model, bindings: Object.entries(roles).map(([key, inputRole]) => ({ key, role: inputRole.role, unit: inputRole.unit, expressionId: `expr_${key}`, evidenceFactId: `fact_${key}` })), evidenceFactIds: ["asked"], ...(outputSymbol ? { resultBinding: { turnPlanQuantityId: "requestedResult", symbol: outputSymbol, unit: "1", evidenceFactIds: ["asked"] } } : {}) }],
  };
}

const solver = new LocalDeterministicSolverProvider();
let checks = 0;
for (const [model, inputs] of cases) {
  const consumed = consumePhysicalModel(model, { ...inputs });
  assert.equal(consumed.status, "scene", `${model}: variant does not consume`);
  if (consumed.status !== "scene") continue;
  const certified = consumed.document.source.certified as Record<string, number>;
  const admission = modelAdmission(model)!;
  const proved = admission.scalar(inputs);
  assert.deepEqual(Object.keys(proved).sort(), Object.keys(certified).sort(), `${model}: optional scalar keys diverge`);
  for (const [key, expected] of Object.entries(certified)) assert(Math.abs(proved[key]! - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${model}.${key}: optional scalar diverges`);
  const output = admission.resultKind === "representation" ? undefined : Object.keys(certified)[0];
  const problem = fixture(model, inputs, output);
  assert(validateProblemIR(problem, problem.question).problem, `${model}: optional source-bound IR rejected`);
  assert(explicitPhysicalModelScene(problem.question, problem).document, `${model}: optional source-bound live scene rejected`);
  const result = await solver.solve(problem);
  assert.equal(result.status, "solved", `${model}: optional deterministic solve failed`);
  assert.equal(validateSolverResult(result, problem).valid, true, `${model}: optional result boundary failed`);
  for (const group of admission.optionalGroups ?? []) {
    if (!group.every((key) => key in inputs)) continue;
    const partial = structuredClone(problem);
    const request = partial.solveRequests[0]!;
    assert(request.kind === "explicit_physical_model");
    request.bindings = request.bindings!.filter((binding) => binding.key !== group.at(-1));
    assert.equal(validateProblemIR(partial, partial.question).problem, null, `${model}: partial optional group accepted`);
  }
  checks += 1;
}

console.log(`magnetism optional source-admission checks passed (${checks} variants)`);
