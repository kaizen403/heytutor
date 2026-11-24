import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileGeneratedSceneGuide, validateProblemIR, validateSceneDocument, validateTurnPlanV3,
  type ProblemIR, type SceneDocument, type TurnPlanV3 } from "../../src/index";
import { certifyNativeGuideSourceBindings } from "../../src/compile/nativeGuideSourceBindings";

let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("Result-unit binding verification forbids network"); };

type Input = { question: string; plan: TurnPlanV3; problem: ProblemIR; document: SceneDocument };
type Source = "atomic" | "dimensionless";
type Control = { name: string; source: Source; expected: boolean; mutate: (input: Input) => void };

// Fixtures supply only the original question, accepted plan and ProblemIR.
// The real source compiler must independently reconstruct the full document.
function prove(question: string, planRaw: unknown, problemRaw: unknown): Input {
  const plan = validateTurnPlanV3(planRaw, question);
  const problem = validateProblemIR(problemRaw, question);
  assert(plan.valid && plan.plan, JSON.stringify(plan.issues));
  assert(problem.valid && problem.problem, JSON.stringify(problem.issues));
  const original = JSON.stringify([question, planRaw, problemRaw]);
  const guide = compileGeneratedSceneGuide({ question, turnPlan: plan.plan, problemIR: problem.problem });
  assert(guide.ok, JSON.stringify(guide));
  const checked = validateSceneDocument(structuredClone(guide.guide.sourceScene.document));
  assert(checked.document && checked.report.valid, JSON.stringify(checked.report.issues));
  assert.equal(JSON.stringify([question, planRaw, problemRaw]), original, "source compilation must retain its inputs");
  return { question, plan: plan.plan, problem: problem.problem, document: checked.document };
}

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/native-source-lecture.json", import.meta.url), "utf8")) as
  Array<{ name: string; question: string; turnPlan: unknown; problemIR: unknown }>;
const atomicFixture = fixtures.find(row => row.name.includes("rutherford"));
assert(atomicFixture, "the captured physical-charge Rutherford source fixture must be present");
const atomic = prove(atomicFixture.question, atomicFixture.turnPlan, atomicFixture.problemIR);
assert(atomic.document.quantities.some(quantity => quantity.id === "rMin" && quantity.value === 45.504 &&
  quantity.unit === "fm" && quantity.provenance === "derived"), "the fm result must come from original-source proof");

const question = "Solve the pair x + y = 5 and x - y = 1. Find the x-coordinate of the intersection. Plot both lines.";
const fact = (id: string, kind: "given" | "requested", quote: string): ProblemIR["facts"][number] => {
  const start = question.indexOf(quote);
  assert(start >= 0);
  return { id, kind, statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } };
};
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [],
  unknowns: [{ id: "x_result", symbol: "x", unit: "1" }],
  derived: [{ id: "x_result", symbol: "x", value: 3, unit: "1", provenance: "derived", sourceText: "x = (5+1)/2", dependsOn: [] }],
  qualitativeClaims: [], lawIds: ["simultaneous linear equations"], assumptions: [], visualRequirement: "required" };
const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "unitless_coordinate", question,
  facts: [fact("f1", "given", "x + y = 5"), fact("f2", "given", "x - y = 1"),
    fact("fQuery", "requested", "Find the x-coordinate of the intersection")], entities: [],
  expressions: [
    { id: "left", valueType: "function", root: { kind: "binary", operator: "-", left: { kind: "number", value: 5 },
      right: { kind: "variable", name: "x" } }, evidenceFactIds: ["f1"] },
    { id: "right", valueType: "function", root: { kind: "binary", operator: "-", left: { kind: "variable", name: "x" },
      right: { kind: "number", value: 1 } }, evidenceFactIds: ["f2"] },
  ], constraints: [], representationIntents: [], solveRequests: [{ id: "intersection_x", kind: "intersections",
    leftExpressionId: "left", rightExpressionId: "right", variable: "x", domain: { min: -10, max: 10 },
    resultBinding: { turnPlanQuantityId: "x_result", symbol: "x", unit: "1", evidenceFactIds: ["fQuery"] } }] };
const dimensionless = prove(question, plan, problem);
assert(dimensionless.document.quantities.some(quantity => quantity.id === "x_result" && quantity.value === 3 &&
  quantity.unit === "1" && quantity.provenance === "derived"), "the dimensionless coordinate requires its own source proof");
const originals = { atomic, dimensionless };
const originalBytes = JSON.stringify(originals);

const binding = (input: Input) => {
  const request = input.problem.solveRequests[0];
  assert(request?.resultBinding, "fixture must retain an explicit result request");
  return request.resultBinding;
};
const controls: Control[] = [];
function irUnit(name: string, unit: string | undefined, expected: boolean) {
  controls.push({ name, source: "atomic", expected, mutate: input => {
    if (unit === undefined) delete binding(input).unit; else binding(input).unit = unit;
  } });
}
irUnit("original fm", "fm", true);
irUnit("fm surrounding whitespace", " \tfm\n", true);
for (const unit of ["kg", "pm", "Fm", "FM", "f m", " ", "fm\u200b", "𝐟𝐦", "fm^1", "fm/s"])
  irUnit(`fm must not join ${JSON.stringify(unit)}`, unit, false);
irUnit("fm missing IR unit", undefined, false);
controls.push(
  { name: "derived unit is joined independently", source: "atomic", expected: false,
    mutate: input => { input.plan.derived[0]!.unit = "kg"; } },
  { name: "unknown unit is joined independently", source: "atomic", expected: false,
    mutate: input => { input.plan.unknowns[0]!.unit = "kg"; } },
  { name: "missing IR result binding", source: "atomic", expected: false,
    mutate: input => { delete input.problem.solveRequests[0]!.resultBinding; } },
  { name: "different IR result id", source: "atomic", expected: false,
    mutate: input => { binding(input).turnPlanQuantityId = "another_result"; } },
  { name: "different IR result symbol", source: "atomic", expected: false,
    mutate: input => { binding(input).symbol = "another_symbol"; } },
  { name: "computed source result cannot become given", source: "atomic", expected: false,
    mutate: input => { input.document.quantities.find(quantity => quantity.id === "rMin")!.provenance = "given"; } },
  { name: "requested result must retain the native construction binding", source: "atomic", expected: false,
    mutate: input => {
      const construction = input.document.constructions.find(step => step.operator === "rutherford_scattering");
      assert(construction);
      construction.inputs.resultBindings = { closestApproach: "different_result" };
    } },
);
function scalarUnits(name: string, planUnit: string | undefined, irUnit: string | undefined, expected: boolean) {
  controls.push({ name, source: "dimensionless", expected, mutate: input => {
    for (const quantity of [...input.plan.derived, ...input.plan.unknowns]) {
      if (planUnit === undefined) delete quantity.unit; else quantity.unit = planUnit;
    }
    if (irUnit === undefined) delete binding(input).unit; else binding(input).unit = irUnit;
  } });
}
scalarUnits("dimensionless explicit one", "1", "1", true);
scalarUnits("dimensionless both units missing", undefined, undefined, true);
scalarUnits("dimensionless missing IR unit", "1", undefined, true);
scalarUnits("dimensionless missing plan unit", undefined, "1", true);
// Raw leaf normalization only: structural validators independently decide
// whether blank unit spellings can enter a complete guide.
scalarUnits("dimensionless raw blank unit spelling", "", " \t", true);
scalarUnits("dimensionless surrounding whitespace", " \t1 ", "1", true);
for (const unit of ["kg", "m", "s", "rad", "%", "dimensionless"])
  scalarUnits(`dimensionless must not join ${unit}`, "1", unit, false);
// These isolate string identity at the result-role leaf. They confer no
// physical compound unit on the source-proved dimensionless coordinate.
scalarUnits("leaf only: compound unit whitespace retains tokens", "m s", "m \t s", true);
scalarUnits("leaf only: compound unit tokens cannot concatenate", "m s", "ms", false);
scalarUnits("leaf only: SI letter case remains distinct", "m s", "M s", false);
scalarUnits("leaf only: energy length whitespace retains tokens", "MeV fm", "MeV\tfm", true);
scalarUnits("leaf only: energy length tokens cannot concatenate", "MeV fm", "MeVfm", false);
scalarUnits("leaf only: energy prefix case remains distinct", "MeV fm", "meV fm", false);

for (const control of controls) {
  const input = structuredClone(originals[control.source]);
  control.mutate(input);
  const before = JSON.stringify(input);
  const result = certifyNativeGuideSourceBindings(input);
  assert.equal(result.issues.length === 0, control.expected, `${control.name}: ${JSON.stringify(result.issues)}`);
  assert.equal(JSON.stringify(input), before, `${control.name} must retain source, plan, IR and proof document`);
}
assert.equal(JSON.stringify(originals), originalBytes, "controls cannot mutate the independently proved fixtures");
assert.equal(networkCalls, 0);
console.log(`native result-unit binding: ${controls.length} controls passed after independent atomic and affine source reconstruction; no network`);
