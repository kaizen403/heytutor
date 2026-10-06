import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as engine from "../../src/index";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { readMatrixProductSourceProgram } from "../../src/compile/matrixSourceBinding";
import { callers, planMutations, irMutations } from "./fixtures/w2-matrix-actual-caller-fix-20261006/cases";
let checks = 0;
const renderDir = process.argv.find(arg => arg.startsWith("--render-dir="))?.slice("--render-dir=".length);
if (renderDir) mkdirSync(renderDir, { recursive: true });
function equal(value: unknown, expected: unknown, label: string) { assert.deepEqual(value, expected, label); checks++; }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function rational(value: number | string) {
  const [n, d = "1"] = String(value).split("/");
  return { numerator: n!, denominator: d };
}
for (const caller of callers) {
  freeze(caller);
  const { id, question, plan, problemIR, products } = caller;
  const before = JSON.stringify(caller);
  const result = engine.applySourceQuantityAuthority(plan, problemIR, question);
  equal(result.plan === plan, true, `${id}: original Plan reference`);
  equal(result.outcomes[0]?.declineFigure, false, `${id}: admitted`);
  equal(engine.matrixProductSourcePlanIssues(question, plan), [], `${id}: complete Plan`);
  equal(engine.matrixProductFullIRIssues(question, problemIR), [], `${id}: complete IR`);
  const prepared = engine.prepareMatrixProductSourceAuthority(question, plan, problemIR);
  assert(prepared);
  equal(prepared.plan === plan && prepared.problemIR === problemIR, true, `${id}: entire original caller references`);
  equal(prepared.correction.audit, { originalIssues: [], withdrawn: [], dependencies: [] }, `${id}: no pruning audit`);
  equal(prepared.correction.sourceAliases, [], `${id}: no surrogate aliases`);
  equal(readMatrixProductSourceProgram(question)!.products.map(p => p.geometry.matrixArray.exactEntries), products.map(matrix => matrix.map(row => row.map(rational))), `${id}: independent literal ordered-product oracles`);
  const scene = engine.synthesizeFamilyScene({ question, turnPlan: plan, problemIR });
  assert(scene);
  equal(scene.tier, "qualitative_verified", `${id}: nonmetric table`);
  const compiled = engine.compileSceneDocument(prepared.document, { sourceAuthority: { question, turnPlan: plan, problemIR } });
  equal(compiled.ok, true, `${id}: normal compiler`);
  if (renderDir) writeFileSync(join(renderDir, `${id}.svg`), renderSceneSvg(compiled.renderScene!, { title: question, subtitle: "Source ordered products; qualitative_verified, nonmetric table" }));
  // Match all emitted cell values/positions, rather than just counting ink.
  const source = readMatrixProductSourceProgram(question)!;
  for (const [i, product] of source.products.entries()) {
    const entity = prepared.document.entities.find(e => e.label === product.name)!;
    const cells = compiled.renderScene!.primitives.filter(p => p.entityId === entity.id && p.provenance?.matrixCell);
    const wanted = products[i]!.flatMap((row, r) => row.map((value, c) => ({ row: r, column: c, exactValue: rational(value) })));
    equal(JSON.parse(JSON.stringify(cells.map(c => c.provenance!.matrixCell))).map((c: { row: number; column: number; exactValue: object }) => ({ row: c.row, column: c.column, exactValue: c.exactValue })).sort((a: { row: number; column: number }, b: { row: number; column: number }) => a.row - b.row || a.column - b.column), wanted, `${id}/${product.name}: complete exact emitted cells`);
    equal(cells.every(c => c.provenance!.matrixNonmetric === true), true, `${id}: spacing never numeric authority`);
  }
  equal(JSON.stringify(caller), before, `${id}: frozen whole caller immutable`);
  if (id.startsWith("actual")) continue;
  const falsePlan = structuredClone(plan);
  falsePlan.qualitativeClaims.at(-1)!.expected = String(falsePlan.qualitativeClaims.at(-1)!.expected).includes("!=")
    ? String(falsePlan.qualitativeClaims.at(-1)!.expected).replace("!=", "=")
    : String(falsePlan.qualitativeClaims.at(-1)!.expected).replace("=", "!=");
  equal(engine.matrixProductSourcePlanIssues(question, falsePlan).length > 0, true, `${id}: false entire local equality refuses`);
  equal(engine.synthesizeFamilyScene({ question, turnPlan: falsePlan, problemIR }), null, `${id}: no wrong compound ink`);
}
const actual = callers[1]!;
for (const [name, mutate] of Object.entries(planMutations)) {
  const plan = structuredClone(actual.plan); mutate(plan); freeze(plan);
  const before = JSON.stringify(plan);
  equal(engine.matrixProductSourcePlanIssues(actual.question, plan).length > 0, true, `${name}: whole Plan refuses`);
  const outcome = engine.applySourceQuantityAuthority(plan, actual.problemIR, actual.question);
  equal(outcome.plan === plan, true, `${name}: exact refused Plan reference`);
  equal(outcome.outcomes[0]?.declineFigure, true, `${name}: reported refusal`);
  equal(engine.correctMatrixProductSourcePlan(actual.question, plan), null, `${name}: no repair/pruning`);
  equal(engine.synthesizeFamilyScene({ question: actual.question, turnPlan: plan, problemIR: actual.problemIR }), null, `${name}: no family ink`);
  equal(JSON.stringify(plan), before, `${name}: all refused fields retained`);
}
for (const [name, mutate] of Object.entries(irMutations)) {
  const problemIR = structuredClone(actual.problemIR); mutate(problemIR); freeze(problemIR);
  const before = JSON.stringify(problemIR);
  equal(engine.matrixProductFullIRIssues(actual.question, problemIR).length > 0, true, `${name}: complete IR refuses`);
  const outcome = engine.applySourceQuantityAuthority(actual.plan, problemIR, actual.question);
  equal(outcome.plan === actual.plan, true, `${name}: entire refused Plan retained`);
  equal(outcome.outcomes[0]?.declineFigure, true, `${name}: IR refusal`);
  equal(engine.prepareMatrixProductSourceAuthority(actual.question, actual.plan, problemIR), null, `${name}: no generated IR`);
  equal(JSON.stringify(problemIR), before, `${name}: full refused IR retained`);
}
for (const tail of [" Find determinant A.", " A is singular.", " Find inverse A.", " Find AC.", " Is AB symmetric?"]) {
  const question = actual.question + tail;
  const problemIR = { ...actual.problemIR, question };
  equal(engine.matrixProductSourcePlanIssues(question, { ...actual.plan, question }).length > 0, true, `whole source ${tail}`);
  equal(engine.synthesizeFamilyScene({ question, turnPlan: { ...actual.plan, question }, problemIR }), null, `no residual source ink ${tail}`);
}
for (const caller of callers.slice(1)) {
  const plan = structuredClone(caller.plan);
  plan.qualitativeClaims.forEach((claim, index) => {
    if (index < 2) {
      const product = readMatrixProductSourceProgram(caller.question)!.products[index]!;
      claim.claim = `${product.name} is the matrix product ${product.left} times ${product.right}`;
    } else claim.claim = String(claim.claim).slice(String(claim.claim).indexOf("matrix multiplication")).replace("matrix", "Matrix");
  });
  plan.lawIds = ["matrix-multiplication-definition", ...readMatrixProductSourceProgram(caller.question)!.products.map(p => `matrix multiplication definition: (${p.name})ij = sum_k ${p.left}_ik ${p.right}_kj`)];
  equal(engine.matrixProductSourcePlanIssues(caller.question, plan), [], `${caller.id}: existing canonical whole claims still prove`);
  equal(engine.applySourceQuantityAuthority(plan, caller.problemIR, caller.question).plan === plan, true, `${caller.id}: original canonical law/claim fields retained`);
}
let getters = 0;
const accessor = { ...actual.plan };
Object.defineProperty(accessor, "lawIds", { get() { getters++; return []; } });
equal(engine.matrixProductSourcePlanIssues(actual.question, accessor).length > 0, true, "accessor rejected");
equal(getters, 0, "accessor not executed");
equal(engine.matrixProductSourcePlanIssues(actual.question, Object.create(actual.plan)).length > 0, true, "inherited Plan rejected");
const cyclic = { ...actual.plan }; Object.assign(cyclic, { cycle: cyclic });
equal(engine.matrixProductSourcePlanIssues(actual.question, cyclic).length > 0, true, "cyclic Plan rejected");
console.log(`PASS ${checks} actual1304 both Plans + four independent whole ordered products, complete Plan/IR/source negatives, frozen callers (source)`);
