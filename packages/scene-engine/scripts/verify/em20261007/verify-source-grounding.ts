import { strict as assert } from "node:assert";
import { validateProblemIR, type ExpressionNodeIR, type QuestionSourceEvidence } from "../../../src/ir/problemIR";
import {
  groundExplicitModel,
  modelAdmission,
} from "../../../src/physics/em20261007/admission";
import { standardCases } from "../../../src/physics/em20261007/consume";

type Mutation = {
  readonly assumption?: string;
  readonly conflictingAssumption?: string;
  readonly key?: string;
  readonly sourceRole?: string;
  readonly sourceUnit?: string;
  readonly sourceValue?: number;
  readonly expressionValue?: number;
  readonly unlinkExpressionEvidence?: boolean;
  readonly staleOffset?: boolean;
};

function expression(
  id: string,
  value: number,
  evidenceFactId: string,
  unlinkEvidence: boolean,
): { id: string; valueType: "scalar"; root: ExpressionNodeIR; evidenceFactIds: string[] } {
  return {
    id,
    valueType: "scalar",
    root: { kind: "number", value },
    evidenceFactIds: unlinkEvidence ? [] : [evidenceFactId],
  };
}

function fixture(model: string, inputs: Readonly<Record<string, number>>, mutation: Mutation = {}) {
  const admission = modelAdmission(model);
  assert(admission, `missing admission ${model}`);
  const assumptions = [...admission.assumptions];
  const firstAssumption = assumptions[0];
  if (mutation.assumption !== undefined && firstAssumption !== undefined) assumptions[0] = mutation.assumption;
  const roleRows = Object.entries(admission.roles).map(([key, role]) => {
    const sourceValue = mutation.key === key && mutation.sourceValue !== undefined ? mutation.sourceValue : inputs[key];
    assert.equal(typeof sourceValue, "number", `${model}.${key} ordinary input missing`);
    return {
      key,
      role,
      sourceRole: mutation.key === key && mutation.sourceRole !== undefined ? mutation.sourceRole : role.role,
      sourceUnit: mutation.key === key && mutation.sourceUnit !== undefined ? mutation.sourceUnit : role.unit,
      sourceValue,
      expressionValue: mutation.key === key && mutation.expressionValue !== undefined ? mutation.expressionValue : inputs[key]!,
    };
  });
  const segments = [
    ...assumptions.map((assumption) => `The model is ${assumption}.`),
    ...(mutation.conflictingAssumption ? [`The model is ${mutation.conflictingAssumption}.`] : []),
    ...roleRows.map((row) => `The ${row.sourceRole} is ${row.sourceValue} ${row.sourceUnit}.`),
    "Find the requested result.",
  ];
  const question = segments.join(" ");
  const evidence = (quote: string, stale = false): QuestionSourceEvidence => {
    const start = question.indexOf(quote);
    assert(start >= 0, `quote missing: ${quote}`);
    return {
      source: "question",
      start: stale ? start + 1 : start,
      end: start + quote.length,
      quote,
    };
  };
  const facts = [
    ...assumptions.map((assumption, index) => {
      const quote = `The model is ${assumption}.`;
      return { id: `assumption_${index}`, kind: "assumption", statement: `Generated statement says ${admission.assumptions[index] ?? assumption}.`, evidence: evidence(quote) };
    }),
    ...(mutation.conflictingAssumption ? [{
      id: "assumption_conflict",
      kind: "assumption",
      statement: "Generated statement hides a conflict.",
      evidence: evidence(`The model is ${mutation.conflictingAssumption}.`),
    }] : []),
    ...roleRows.map((row, index) => {
      const quote = `The ${row.sourceRole} is ${row.sourceValue} ${row.sourceUnit}.`;
      return {
        id: `fact_${row.key}`,
        kind: "given",
        // Deliberately trustworthy-looking generated prose: admission must use
        // the exact source span instead of this statement.
        statement: `The ${row.role.role} is stated in ${row.role.unit}.`,
        evidence: evidence(quote, mutation.staleOffset === true && index === 0),
      };
    }),
    {
      id: "asked",
      kind: "requested",
      statement: "Find the requested result.",
      evidence: evidence("Find the requested result."),
    },
  ];
  const expressions = roleRows.map((row) => expression(
    row.key,
    row.expressionValue,
    `fact_${row.key}`,
    mutation.unlinkExpressionEvidence === true && mutation.key === row.key,
  ));
  return {
    question,
    problem: {
      schemaVersion: "problem-ir/v1",
      id: `sourceGrounding_${model.replace(/[^A-Za-z0-9_]/g, "_")}`,
      question,
      facts,
      entities: [],
      expressions,
      constraints: [],
      representationIntents: [],
      solveRequests: [{
        id: "explicitModel",
        kind: "explicit_physical_model",
        model,
        bindings: roleRows.map((row) => ({
          key: row.key,
          role: row.role.role,
          unit: row.role.unit,
          expressionId: row.key,
          evidenceFactId: `fact_${row.key}`,
        })),
        evidenceFactIds: ["asked"],
        resultBinding: { turnPlanQuantityId: "result", symbol: "result", unit: "1", evidenceFactIds: ["asked"] },
      }],
    },
  };
}

function accepted(model: string, inputs: Readonly<Record<string, number>>, mutation: Mutation = {}): boolean {
  const item = fixture(model, inputs, mutation);
  const validated = validateProblemIR(item.problem, item.question);
  return Boolean(validated.problem) && groundExplicitModel(item.question, item.problem).ok;
}

const admittedNames = [
  "dc.wheatstone",
  "ce.drift",
  "ce.current_density",
  "ce.power",
  "ce.joule",
  "ce.resistivity",
  "ce.resistance",
  "ce.temperature",
  "ce.cell",
  "ce.iv_ohmic",
] as const;
const cases = new Map(standardCases().map((item) => [item.modelName, item.ordinary]));

for (const model of admittedNames) {
  const inputs = cases.get(model);
  assert(inputs, `missing ordinary case ${model}`);
  assert.equal(accepted(model, inputs), true, `${model}: ordinary source-grounded control must pass`);
  const admission = modelAdmission(model)!;
  const key = Object.keys(admission.roles)[0]!;
  const value = inputs[key]!;
  assert.equal(accepted(model, inputs, { key, expressionValue: value + 101 }), false, `${model}: stale expression value must reject`);
  assert.equal(accepted(model, inputs, { key, sourceRole: "unrelated quantity" }), false, `${model}: forged generated role statement must reject`);
  assert.equal(accepted(model, inputs, { key, sourceUnit: "wrong-unit" }), false, `${model}: source-unit mismatch must reject`);
  assert.equal(accepted(model, inputs, { key, unlinkExpressionEvidence: true }), false, `${model}: expression/fact evidence link must be atomic`);
  assert.equal(accepted(model, inputs, { staleOffset: true }), false, `${model}: stale source offsets must reject`);
  const assumption = admission.assumptions[0];
  if (assumption) {
    assert.equal(accepted(model, inputs, { assumption: `not ${assumption}` }), false, `${model}: negated assumption must reject`);
  }
}

const wheatstone = cases.get("dc.wheatstone")!;
assert.equal(accepted("dc.wheatstone", wheatstone, { assumption: "unbalanced" }), false, "unbalanced must not satisfy balanced by substring");
assert.equal(accepted("dc.wheatstone", wheatstone, { conflictingAssumption: "unbalanced" }), false, "conflicting balanced/unbalanced premises must reject atomically");
assert.equal(accepted("ce.power", cases.get("ce.power")!, { key: "I", sourceValue: -2, expressionValue: 2 }), false, "source sign must bind to expression sign");

console.log(`source grounding checks passed (${admittedNames.length} admitted models)`);
