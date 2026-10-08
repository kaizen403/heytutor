import { strict as assert } from "node:assert";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../../src/ir/solver";
import { validateProblemIR, type ExpressionNodeIR, type ProblemIR, type QuestionSourceEvidence } from "../../../src/ir/problemIR";
import { modelAdmission, modelAdmissionEvidenceText, modelAdmissionRole } from "../../../src/physics/em20261007/admission";
import { explicitPhysicalModelScene, standardCases } from "../../../src/physics/em20261007/consume";

function fixture(modelName: string, outputSymbol?: string): ProblemIR {
  const item = standardCases().find((candidate) => candidate.modelName === modelName);
  const admission = modelAdmission(modelName);
  assert(item && admission, `${modelName}: missing standard case or admission`);
  const roles = Object.fromEntries(Object.keys(item.ordinary).map((key) => {
    const role = modelAdmissionRole(modelName, key);
    assert(role, `${modelName}.${key}: missing source role`);
    return [key, role];
  }));
  const segments = [
    ...admission.assumptions.map((assumption) => `The model is ${assumption}.`),
    ...Object.keys(roles).map((key) => modelAdmissionEvidenceText(modelName, key, item.ordinary[key]!)!),
    `Find ${outputSymbol ?? "the requested representation"}.`,
  ];
  const question = segments.join(" ");
  const evidence = (quote: string): QuestionSourceEvidence => {
    const start = question.indexOf(quote);
    assert(start >= 0);
    return { source: "question", start, end: start + quote.length, quote };
  };
  const facts = [
    ...admission.assumptions.map((assumption, index) => {
      const quote = `The model is ${assumption}.`;
      return { id: `assumption_${index}`, kind: "assumption" as const, statement: quote, evidence: evidence(quote) };
    }),
    ...Object.entries(roles).map(([key]) => {
      const quote = modelAdmissionEvidenceText(modelName, key, item.ordinary[key]!)!;
      return { id: `fact_${key}`, kind: "given" as const, statement: quote, evidence: evidence(quote) };
    }),
    {
      id: "asked",
      kind: "requested" as const,
      statement: `Find ${outputSymbol ?? "the requested representation"}.`,
      evidence: evidence(`Find ${outputSymbol ?? "the requested representation"}.`),
    },
  ];
  return {
    schemaVersion: "problem-ir/v1",
    id: `solver_${modelName.replace(/[^A-Za-z0-9_]/g, "_")}`,
    question,
    facts,
    entities: [],
    expressions: Object.keys(roles).map((key) => ({
      id: `expr_${key}`,
      valueType: "scalar" as const,
      root: { kind: "number", value: item.ordinary[key] } as ExpressionNodeIR,
      evidenceFactIds: [`fact_${key}`],
    })),
    constraints: [],
    representationIntents: [],
    solveRequests: [{
      id: "explicitModel",
      kind: "explicit_physical_model",
      model: modelName,
      bindings: Object.entries(roles).map(([key, role]) => ({
        key,
        role: role.role,
        unit: role.unit,
        expressionId: `expr_${key}`,
        evidenceFactId: `fact_${key}`,
      })),
      evidenceFactIds: ["asked"],
      ...(outputSymbol ? {
        resultBinding: { turnPlanQuantityId: "requestedResult", symbol: outputSymbol, unit: "1", evidenceFactIds: ["asked"] },
      } : {}),
    }],
  };
}

const provider = new LocalDeterministicSolverProvider();

const representation = fixture("ce.iv_samples");
assert(validateProblemIR(representation, representation.question).problem);
const representationResult = await provider.solve(representation);
assert.equal(representationResult.status, "solved", "a proved no-output representation is a completed request");
assert.deepEqual(representationResult.values, [], "a representation must not invent a scalar value");
assert.deepEqual(representationResult.proofs, [], "a representation must not invent numeric proof evidence");
assert.equal(validateSolverResult(representationResult, representation).valid, true);

const numeric = fixture("ce.carrier_density", "I");
assert(validateProblemIR(numeric, numeric.question).problem);
const numericResult = await provider.solve(numeric);
assert.equal(numericResult.status, "solved");
assert.equal(numericResult.values.length, 1);
assert.equal(numericResult.proofs.length, 1);
assert.equal(validateSolverResult(numericResult, numeric).valid, true);

const missingBinding = fixture("ce.carrier_density");
const missingBindingResult = await provider.solve(missingBinding);
assert.equal(missingBindingResult.status, "failed", "a numeric physical model cannot masquerade as a representation");
assert.equal(validateSolverResult(missingBindingResult, missingBinding).valid, true);

const ambiguous = structuredClone(representation);
ambiguous.solveRequests.push({ ...structuredClone(ambiguous.solveRequests[0]!), id: "secondModel" });
assert.equal(validateProblemIR(ambiguous, ambiguous.question).problem, null, "one ProblemIR cannot ambiguously select two physical scenes");

const fourPoint = structuredClone(representation);
for (const [key, role, unit, value] of [["i3", "observation 3 current", "A", 4], ["v3", "observation 3 voltage", "V", 16]] as const) {
  const quote = `The ${role} is ${value} ${unit}.`;
  const start = fourPoint.question.length + 1;
  fourPoint.question += ` ${quote}`;
  fourPoint.facts.push({ id: `fact_${key}`, kind: "given", statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } });
  fourPoint.expressions.push({ id: `expr_${key}`, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: [`fact_${key}`] });
  const request = fourPoint.solveRequests[0]!;
  assert(request.kind === "explicit_physical_model");
  request.bindings!.push({ key, role, unit, expressionId: `expr_${key}`, evidenceFactId: `fact_${key}` });
}
assert(validateProblemIR(fourPoint, fourPoint.question).problem, "a complete fourth observation must remain source-grounded");
assert(explicitPhysicalModelScene(fourPoint.question, fourPoint).document, "a complete fourth observation must reach the live scene");
const incompleteFourPoint = structuredClone(fourPoint);
const incompleteRequest = incompleteFourPoint.solveRequests[0]!;
assert(incompleteRequest.kind === "explicit_physical_model");
incompleteRequest.bindings = incompleteRequest.bindings!.filter((binding) => binding.key !== "v3");
assert.equal(validateProblemIR(incompleteFourPoint, incompleteFourPoint.question).problem, null, "a partial sequence item must reject atomically");

console.log("explicit representation solver checks passed (qualitative empty, numeric proved, missing binding rejected)");
