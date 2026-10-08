import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { validateProblemIR, type ExpressionNodeIR, type QuestionSourceEvidence } from "../../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../../src/ir/solver";
import { groundExplicitModel, modelAdmission, modelAdmissionEvidenceText, modelAdmissionRequiredAssumptions, modelAdmissionRole } from "../../../src/physics/em20261007/admission";
import { consumePhysicalModel, explicitPhysicalModelScene, standardCases } from "../../../src/physics/em20261007/consume";

const close = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));

function fixture(modelName: string, ordinary: Readonly<Record<string, number>>, outputSymbol?: string) {
  const admission = modelAdmission(modelName);
  assert(admission, `${modelName}: every public physical model needs a source admission contract`);
  const roles = Object.fromEntries(Object.keys(ordinary).map((key) => {
    const role = modelAdmissionRole(modelName, key, ordinary);
    assert(role, `${modelName}.${key}: ordinary input needs an admitted source role`);
    return [key, role];
  }));
  const assumptions = modelAdmissionRequiredAssumptions(modelName, ordinary);
  const segments = [
    ...assumptions.map((assumption) => `The model is ${assumption}.`),
    ...Object.keys(roles).map((key) => modelAdmissionEvidenceText(modelName, key, ordinary[key]!, ordinary)!),
    `Find ${outputSymbol ?? "the requested representation"}.`,
  ];
  const question = segments.join(" ");
  const evidence = (quote: string): QuestionSourceEvidence => {
    const start = question.indexOf(quote);
    assert(start >= 0, `${modelName}: missing source quote ${quote}`);
    return { source: "question", start, end: start + quote.length, quote };
  };
  const facts = [
    ...assumptions.map((assumption, index) => {
      const quote = `The model is ${assumption}.`;
      return { id: `assumption_${index}`, kind: "assumption", statement: quote, evidence: evidence(quote) };
    }),
    ...Object.entries(roles).map(([key]) => {
      const quote = modelAdmissionEvidenceText(modelName, key, ordinary[key]!, ordinary)!;
      return { id: `fact_${key}`, kind: "given", statement: quote, evidence: evidence(quote) };
    }),
    {
      id: "asked",
      kind: "requested",
      statement: `Find ${outputSymbol ?? "the requested representation"}.`,
      evidence: evidence(`Find ${outputSymbol ?? "the requested representation"}.`),
    },
  ];
  const expressions = Object.keys(roles).map((key) => ({
    id: `expr_${key}`,
    valueType: "scalar" as const,
    root: { kind: "number", value: ordinary[key] } as ExpressionNodeIR,
    evidenceFactIds: [`fact_${key}`],
  }));
  const request = {
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
  };
  const problem = {
    schemaVersion: "problem-ir/v1",
    id: `admission_${modelName.replace(/[^A-Za-z0-9_]/g, "_")}`,
    question,
    facts,
    entities: [],
    expressions,
    constraints: [],
    representationIntents: [],
    solveRequests: [request],
  };
  return { question, problem, request };
}

let checks = 0;
const solver = new LocalDeterministicSolverProvider();
for (const item of standardCases()) {
  const direct = item.build();
  const certified = direct.source.certified ?? {};
  assert(certified && typeof certified === "object" && !Array.isArray(certified), `${item.modelName}: certified record required`);
  const outputs = Object.entries(certified).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  if (item.declaredScope === "solved") assert(outputs.length > 0, `${item.modelName}: solved model has no certified output`);
  else assert.equal(outputs.length, 0, `${item.modelName}: non-solved model carries false numeric certification`);
  const output = outputs[0];
  for (const [variant, inputs] of [["ordinary", item.ordinary], ["altered", item.altered]] as const) {
    const { question, problem } = fixture(item.modelName, inputs, output?.[0]);
    const validation = validateProblemIR(problem, question);
    assert(validation.problem, `${item.modelName}/${variant}: source admission rejected: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const grounded = groundExplicitModel(question, problem);
    assert.equal(grounded.ok, true, `${item.modelName}/${variant}: source-grounded model did not bind`);
    const selected = explicitPhysicalModelScene(question, problem);
    assert(selected.handled && selected.document, `${item.modelName}/${variant}: live family seam did not select the admitted model`);
    assert.equal(selected.document.source.question, question, `${item.modelName}/${variant}: source question was not retained`);
    const structural = validateSceneDocument(selected.document);
    assert(structural.document, `${item.modelName}/${variant}: admitted document is structurally invalid`);
    if (structural.document.visualDecision.mode === "scene") {
      const compiled = compileSceneDocument(structural.document);
      assert(compiled.ok && compiled.renderScene, `${item.modelName}/${variant}: admitted live document does not compile`);
    }
    const proved = modelAdmission(item.modelName)!.scalar(inputs);
    const raw = consumePhysicalModel(item.modelName, inputs);
    assert.equal(raw.status, "scene", `${item.modelName}/${variant}: independently admitted inputs must build`);
    assert(raw.status === "scene");
    const rawCertified = raw.document.source.certified ?? {};
    assert.deepEqual(Object.keys(proved).sort(), Object.keys(rawCertified).sort(), `${item.modelName}/${variant}: scalar/raw-document certified keys diverge`);
    for (const [key, expected] of Object.entries(rawCertified)) {
      if (typeof expected === "number") assert(close(proved[key]!, expected), `${item.modelName}/${variant}.${key}: scalar/raw-document value diverges`);
    }
    const liveCertified = selected.document.source.certified ?? {};
    assert.deepEqual(Object.keys(liveCertified), output ? [output[0]] : [], `${item.modelName}/${variant}: live scene must expose only the requested certified output`);
    for (const [key, expected] of Object.entries(liveCertified)) {
      if (typeof expected === "number") assert(close(proved[key]!, expected), `${item.modelName}/${variant}.${key}: scalar/document value diverges`);
    }
    const solved = await solver.solve(problem);
    assert.equal(solved.status, "solved", `${item.modelName}/${variant}: deterministic provider did not complete the admitted request`);
    assert.equal(validateSolverResult(solved, problem).valid, true, `${item.modelName}/${variant}: deterministic result failed its independent boundary`);
    assert.equal(solved.values.length, item.declaredScope === "solved" ? 1 : 0, `${item.modelName}/${variant}: scalar cardinality disagrees with declared scope`);
    assert.equal(solved.proofs.length, item.declaredScope === "solved" ? 1 : 0, `${item.modelName}/${variant}: proof cardinality disagrees with declared scope`);

    const wrongRole = structuredClone(problem);
    wrongRole.solveRequests[0]!.bindings[0]!.role = "unrelated quantity";
    assert.equal(validateProblemIR(wrongRole, question).problem, null, `${item.modelName}/${variant}: forged source role must reject atomically`);
    const wrongUnit = structuredClone(problem);
    wrongUnit.solveRequests[0]!.bindings[0]!.unit = "forged-unit";
    assert.equal(validateProblemIR(wrongUnit, question).problem, null, `${item.modelName}/${variant}: forged source unit must reject atomically`);
    const staleValue = structuredClone(problem);
    const firstExpression = staleValue.expressions[0]?.root;
    assert(firstExpression && firstExpression.kind === "number");
    firstExpression.value += firstExpression.value === 0 ? 1 : Math.max(1, Math.abs(firstExpression.value) * 0.25);
    assert.equal(validateProblemIR(staleValue, question).problem, null, `${item.modelName}/${variant}: a value absent from its exact quote must reject atomically`);
    const shiftedEvidence = structuredClone(problem);
    shiftedEvidence.facts[0]!.evidence.start += 1;
    assert.equal(validateProblemIR(shiftedEvidence, question).problem, null, `${item.modelName}/${variant}: a non-exact source span must reject atomically`);
    const firstAssumption = modelAdmissionRequiredAssumptions(item.modelName, inputs)[0];
    if (firstAssumption) {
      const conflictingQuestion = `${question} The source explicitly says not ${firstAssumption}.`;
      const conflicting = structuredClone(problem);
      conflicting.question = conflictingQuestion;
      assert.equal(validateProblemIR(conflicting, conflictingQuestion).problem, null, `${item.modelName}/${variant}: a conflicting source assumption must reject atomically`);
    }
    checks += 1;
  }
}

console.log(`all-model source admission checks passed (${checks} ordinary/altered cases)`);
