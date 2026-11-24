import assert from "node:assert/strict";
import { analyzePhysicalCurve } from "../../src/physics/physicalCurveModels";
import { parseMathExpression } from "../../src/math/expression";
import { readFileSync } from "node:fs";
import { generatorFor } from "../../src/archetypes/generators";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { validateSourceBindingObservable } from "../../src/physics/sourceBindingObservable";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
const read = (expression: string, low: number, high: number, kind: "decay" | "binding") => {
  try { return analyzePhysicalCurve(expression, low, high, kind); } catch { return null; }
};
let checks = 0;
for (const scale of [0.125, 1, 3.0769230769230766, 24]) {
  const decay = `(${scale})*(1*exp(-${Math.LN2}*x))`;
  const model = read(decay, 0, 4, "decay");
  assert(model && "amplitude" in model);
  assert.equal(model.amplitude, scale);
  assert.equal(model.normalizedPopulation, scale === 1);
  assert(model.normalizedHalfLifeTime);
  const parsed = parseMathExpression(decay);
  for (const x of [0, 0.5, 1, 2, 4]) {
    const jet = parsed.certifiedJetAt(x);
    assert(jet.value > jet.errorBounds.value && jet.derivative < -jet.errorBounds.derivative);
    assert(Math.abs(jet.value - scale * 2 ** (-x)) <= jet.errorBounds.value + 8 * Number.EPSILON * scale);
    checks++;
  }
}
for (const scale of [0.25, 1, 24]) for (const [volume, surface, charge] of [[15.8, 18.3, 0.1634], [18, 20, 0.18]]) {
  const expression = `(${scale})*(${volume}-${surface}*x^(-1/3)-${charge}*x^(2/3))`;
  const result = read(expression, 4, 240, "binding");
  assert(result && "peak" in result);
  assert.equal(result.peak, surface / (2 * charge));
  const parsed = parseMathExpression(expression);
  for (const x of [4, result.peak / 2, result.peak * 1.5, 240]) {
    const jet = parsed.certifiedJetAt(x);
    assert(jet.value > jet.errorBounds.value);
    assert(x < result.peak ? jet.derivative > jet.errorBounds.derivative : jet.derivative < -jet.errorBounds.derivative);
    checks++;
  }
  assert(Math.abs(parsed.evaluate(result.peak) - result.maximum) < 1e-10);
}
for (const [expression, low, high, kind] of [
  ["-2*exp(-x)", 0, 4, "decay"], ["2*exp(x)", 0, 4, "decay"],
  ["2*(exp(-x)+0.1*sin(x))", 0, 4, "decay"], ["2*exp(-x)-3", 0, 4, "decay"],
  ["exp(-x)", -1, 4, "decay"], ["exp(-x)", 4, 4, "decay"],
  ["24*(15.8-18.3*x^(-1/3)-0.1634*x^(2/3))", 0, 240, "binding"],
  ["24*(15.8-18.3*x^(-1/3)-0.1634*x^(2/3))", 80, 240, "binding"],
  ["-24*(15.8-18.3*x^(-1/3)-0.1634*x^(2/3))", 4, 240, "binding"],
  ["24*(1-18.3*x^(-1/3)-0.1634*x^(2/3))", 4, 240, "binding"],
  ["24*(15.8-18.3*x^(-1/3)+0.1634*x^(2/3))", 4, 240, "binding"],
  ["24*(15.8-18.3*x^(-1/3)-0.1634*x^(2/3)+sin(x))", 4, 240, "binding"],
  ["(1-exp(-x))*exp(-x)+0.1*(1-exp(-x/10))*exp(-x/10)", 0, 40, "binding"],
] as const) { assert.equal(read(expression, low, high, kind), null, expression); checks++; }
// Existing closed classes keep their original whole-expression grouping.
assert(read("8.5*(1-exp(-x/3))-0.01*x", 0, 100, "binding")); checks++;
// Preserve the actual current-main generator and its conventional y-x axis
// designator, with the same source, mathematical and geometry obligations.
const probes = JSON.parse(readFileSync(new URL("../../../../data/syllabus-probes/physics-unit-18.json", import.meta.url), "utf8")) as
  { questions: Array<{ id: string; question: string }> };
const bindingProbes = probes.questions.filter(row => row.id.includes("|binding-energy-per-nucleon|"));
assert.equal(bindingProbes.length, 3);
const generate = generatorFor("binding_energy_curve"); assert(generate);
for (const { question } of bindingProbes) {
  const document = generate({ question, slots: {}, sources: {}, quantities: [], schematic: false }); assert(document);
  assert(compileSceneDocument(document).ok, "the unchanged main binding generator retains source proof"); checks++;
  for (const lower of [synthesizeFamilyScene, synthesizeLastResortScene]) {
    assert.equal(lower({ question })?.family, "analytic_curve", "actual main public lowering retains its generator"); checks++;
  }
  for (const variant of ["swapped", "unrelated", "explicit_conflict", "extra_axes", "unproved_model", "wrong_peak"] as const) {
    const bad = structuredClone(document), axes = bad.constructions.find(item => item.operator === "axes")!;
    const curve = bad.constructions.find(item => item.operator === "function_curve")!;
    if (variant === "swapped") bad.entities.find(entity => axes.outputs.includes(entity.id))!.label = "A-B/A";
    if (variant === "unrelated") bad.entities.find(entity => axes.outputs.includes(entity.id))!.label = "v-t";
    if (variant === "explicit_conflict") axes.inputs.xLabel = "t";
    if (variant === "extra_axes") {
      bad.entities.push({ id: "other_axes", kind: "axes", role: "axes", label: "B/A-A" });
      bad.constructions.push({ ...structuredClone(axes), id: "make_other_axes", outputs: ["other_axes"] });
    }
    if (variant === "unproved_model") curve.inputs.expression = "24*(15.8-18.3*x^(-1/3)-0.1634*x^(2/3)+sin(x))";
    if (variant === "wrong_peak") {
      const peak = bad.entities.find(entity => entity.id === "peak")!; peak.label = "maximum";
      bad.constructions.find(item => item.outputs.includes(peak.id))!.inputs.x = 4;
    }
    assert(validateSourceBindingObservable(bad).some(issue => issue.severity === "fatal"), variant); checks++;
  }
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [],
    qualitativeClaims: [{ id: "wrong_axis", claim: "The vertical axis B/A represents electrical current.", expected: true }],
    lawIds: [], assumptions: [], visualRequirement: "required" };
  assert(validateSourceBindingObservable(document, plan).some(issue => issue.code === "binding_observable_axes_unproved"),
    "a composite designator cannot evade a conflicting accepted-plan axis meaning"); checks++;
}
console.log(`native physical curve compatibility: ${checks} derivative, endpoint, grouping, domain, actual main generators and axis/peak negative controls pass`);
