/** Complete actual exchange replay; source and own public ESM, no provider/DB. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeProblemIRModelOutput } from "../../../tutor-core/src/planners/problemPlannerV1";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { ProblemIR } from "../../src/ir/problemIR";
const native = process.argv.includes("--native");
const E: typeof import("../../src/index") = await import(native ? "../../dist/index.js" : "../../src/index.ts");
const C = await import("../../../tutor-core/dist/index.js");
const f = JSON.parse(readFileSync(new URL("./fixtures/w2-ucm-actual-claims-20261006/actual-exchange.json", import.meta.url), "utf8"));
const contents = f.planResponseBodies.map((body: string) => JSON.parse(body).choices[0].message.content as string);
const rawPlans = contents.map((text: string) => JSON.parse(text));
const question = rawPlans[1].question as string;
const rawIRContent = JSON.parse(f.irResponseBody).choices[0].message.content as string;
const rawIR = JSON.parse(rawIRContent);
const plan = C.parseTurnPlanV3Content(contents[1], question);
assert.ok(plan);
assert.equal(C.parseTurnPlanV3Content(contents[0], question), null, "unaltered primary ID mismatch remains negative");
// The production parser adds its server-owned visual requirement and illustration
// assumption. Preserve wire bytes and every original semantic field separately.
const originalActual = structuredClone(plan);
for (const key of ["givens", "unknowns", "derived", "qualitativeClaims", "lawIds"] as const) assert.deepEqual(plan[key], rawPlans[1][key]);
assert.deepEqual(plan.assumptions.slice(0, rawPlans[1].assumptions.length), rawPlans[1].assumptions);
const checked = E.validateProblemIR(normalizeProblemIRModelOutput(rawIR, question, plan), question);
assert.ok(checked.problem);
const problem = checked.problem;
for (const key of ["facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"] as const) {
  assert.deepEqual(problem[key].map(row => row.id), rawIR[key].map((row: { id: string }) => row.id));
}
assert.equal(problem.entities.find(row => row.id === "track")?.kind, "curve");
assert.equal(problem.entities.find(row => row.id === "track")?.label, "circular track");
const fetchImpl: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  assert.ok(body.messages.some((row: { content: string }) => row.content.includes(question)));
  return new Response(f.irResponseBody, { status: 200 });
};
const ordinary = (p: TurnPlanV3) => C.planProblemAuthorityV1(question, p, { proxyUrl: "https://offline.invalid", timeoutMs: 3000, fetchImpl });
console.log("SOURCE_OBLIGATIONS", JSON.stringify({ conflicts: E.uniformCircularRuntimePlanConflicts(question, plan), caller: E.uniformCircularCallerIssues(question, problem, plan) }));
const actual = await ordinary(plan);
console.log("ACTUAL_API", JSON.stringify(actual && "status" in actual ? { status: actual.status, issues: actual.issueCodes } : { audit: actual?.audit.status, projection: !!actual?.projection }));
if (process.argv.includes("--record")) writeFileSync(process.argv[process.argv.indexOf("--record") + 1]!, JSON.stringify({ mode: native ? "native" : "source", question, plan, originalRawIR: rawIR, normalizerProblemIR: problem, ordinaryAPI: actual }, null, 2) + "\n");
assert.ok(actual && !("status" in actual), "unchanged complete actual alternate must pass ordinary API");
assert.equal(actual.audit.status, "verified");
assert.ok(actual.projection);
assert.deepEqual(actual.problemIR, problem, "ordinary API preserves full real normalizer typed IR");
assert.equal(actual.rawContent, rawIRContent, "returned IR bytes preserved");
assert.deepEqual(actual.solverResult.values.map(row => row.approximate), [8, 5 * Math.PI]);
assert.deepEqual(plan, originalActual);
assert.deepEqual(rawIR, JSON.parse(rawIRContent));
// Also replay the complete wire alternate literally, before server visual
// normalization. Neither route gets a smaller plan or a substitute IR.
const wireBefore = structuredClone(rawPlans[1]);
const wireActual = await ordinary(rawPlans[1]);
assert.ok(wireActual && !("status" in wireActual));
assert.equal(wireActual.audit.status, "verified");
assert.deepEqual(wireActual.problemIR, problem);
assert.deepEqual(rawPlans[1], wireBefore);
const primary = await ordinary(rawPlans[0]);
assert.ok(primary && "status" in primary && primary.status === "source_declined");
assert.deepEqual(primary.rawTurnPlan, rawPlans[0]);
assert.deepEqual(primary.rawProblemIR, rawIR);
if (process.argv.includes("--record")) writeFileSync(process.argv[process.argv.indexOf("--record") + 1]!, JSON.stringify({
  mode: native ? "native" : "source", question, plan, originalRawIR: rawIR, normalizerProblemIR: problem,
  ordinaryAPI: actual, wireActualPlan: rawPlans[1], wireOrdinaryAPI: wireActual,
  primaryRawPlan: rawPlans[0], primaryOrdinaryAPI: primary,
}, null, 2) + "\n");
const scene = E.synthesizeFamilyScene({ question, turnPlan: plan, problemIR: problem });
assert.ok(scene);
let checks = 0;
async function seams(label: string, p: TurnPlanV3, ir: ProblemIR, accept: boolean, checkPlanReconciliation = true) {
  const beforePlan = structuredClone(p), beforeIR = structuredClone(ir);
  const authority = { question, turnPlan: p, problemIR: ir };
  assert.equal(E.uniformCircularCallerIssues(question, ir, p).every(row => row.severity !== "fatal"), accept, label + "/caller");
  assert.equal(!!E.synthesizeFamilyScene(authority), accept, label + "/family");
  assert.equal(E.validateSceneSourceAuthority(scene!.document, question, ir, p).every(row => row.severity !== "fatal"), accept, label + "/central");
  const compiled = E.compileSceneDocument(scene!.document, { sourceAuthority: authority });
  assert.equal(compiled.ok, accept, label + "/compile");
  assert.equal(!!compiled.renderScene, accept, label + "/atomic ink");
  const applied = E.applySourceQuantityAuthority(p, ir, question);
  if (checkPlanReconciliation) assert.equal(applied.outcomes.every(row => !row.declineFigure), accept, label + "/reconcile");
  if (!accept && checkPlanReconciliation) { assert.deepEqual(applied.plan, p); assert.ok(applied.outcomes.every(row => row.corrections.length === 0)); }
  assert.deepEqual(p, beforePlan); assert.deepEqual(ir, beforeIR);
  checks += 8;
}
await seams("complete actual", plan, problem, true);
await seams("complete original primary", rawPlans[0], problem, false);
const mutations: Array<[string, (p: TurnPlanV3) => void]> = [
  ["outward", p => { p.qualitativeClaims[0]!.claim = p.qualitativeClaims[0]!.claim.replace("inward", "outward"); }],
  ["parallel", p => { p.qualitativeClaims[0]!.claim = p.qualitativeClaims[0]!.claim.replace("perpendicular", "parallel"); }],
  ["wrong path", p => { p.qualitativeClaims[0]!.claim = p.qualitativeClaims[0]!.claim.replace("circular track", "second circle"); }],
  ["nonzero tangential", p => { p.qualitativeClaims[1]!.claim = p.qualitativeClaims[1]!.claim.replace("is zero", "is nonzero"); }],
  ["total zero", p => { p.qualitativeClaims[1]!.claim += "; the acceleration is zero"; }],
  ["false expected zero", p => { p.qualitativeClaims[1]!.expected = "a_c = 0"; }],
  ["wrong tangential units", p => { p.qualitativeClaims[1]!.expected = "a_t = 0 N"; }],
  ["wrong circumference", p => { p.qualitativeClaims[2]!.claim = p.qualitativeClaims[2]!.claim.replace("2*pi*r", "pi*r"); }],
  ["wrong formula same value", p => { p.qualitativeClaims[2]!.claim = p.qualitativeClaims[2]!.claim.replace("T = 2*pi*r/v", "T = 15.707963267948966*31/31"); }],
  ["wrong exact intermediate", p => { p.qualitativeClaims[2]!.expected = "T = 2*pi*50/20 = 4*pi ≈ 15.71 s"; }],
  ["approximate intermediate reused", p => { p.qualitativeClaims[2]!.expected = "T ≈ 15.71 = 5*pi s"; }],
  ["false decimal precision", p => { p.qualitativeClaims[2]!.expected = "T = 5*pi ≈ 15.710 s"; }],
  ["wrong expected radius", p => { p.qualitativeClaims[2]!.expected = "T = 2*pi*51/20 ≈ 15.71 s"; }],
  ["wrong source radius", p => { p.assumptions[1] = "Track is a perfect circle of radius 51 m"; }],
  ["false pi", p => { p.assumptions[2] = "Use pi ≈ 3.14" + "0000000000000"; }],
  ["new pi given", p => { p.assumptions[2] = "Given pi = 3.141592653589793"; }],
  ["foreign force", p => { p.qualitativeClaims[0]!.claim += "; force is 8 N"; }],
  ["foreign mass", p => { p.assumptions.push("Mass is 1 kg"); }],
  ["invented sense", p => { p.assumptions.push("The car moves clockwise"); }],
  ["invented phase", p => { p.assumptions.push("The car starts at the east point"); }],
  ["unrelated arithmetic", p => { p.qualitativeClaims[2]!.expected += "; 1 = 1"; }],
  ["unsupported tail", p => { p.qualitativeClaims[2]!.claim += " and friction is negligible"; }],
  ["false derived prose", p => { p.derived[0]!.sourceText += "; acceleration is zero"; }],
  ["wrong written period", p => { p.derived[1]!.value += 1e-8; }],
  ["decimal tolerance without equation proof", p => { p.derived[1]!.sourceText = "Speed is constant"; }],
  ["decimal tolerance without explicit approx", p => { p.derived[1]!.sourceText = "T = 2*pi*r/v"; }],
  ["wrong given radius scalar", p => { p.givens[1]!.value += .01; }],
  ["direction on period", p => { p.qualitativeClaims[2]!.expected = "T = 5*pi s directed inward"; }],
  ["canceling arithmetic in expected", p => { p.qualitativeClaims[2]!.expected = "T = 2*pi*50/20*31/31 ≈ 15.71 s"; }],
];
for (const [label, mutate] of mutations) {
  const bad: TurnPlanV3 = structuredClone(plan); mutate(bad);
  const result = await ordinary(bad);
  assert.ok(result && "status" in result && result.status === "source_declined", label + "/ordinary typed refusal");
  assert.deepEqual(result.rawTurnPlan, bad); assert.deepEqual(result.rawProblemIR, rawIR);
  assert.equal(result.rawContent, rawIRContent);
  // Pure scalar reconciliation computes source values; admission and the
  // ordinary API must reject the original caller before that correction.
  const scalarOnly = ["wrong written period", "decimal tolerance without equation proof", "decimal tolerance without explicit approx", "wrong given radius scalar"].includes(label);
  await seams(label, bad, problem, false, !scalarOnly);
  checks += 4;
}
// Typed caller mutations keep the complete remaining graph.
for (const [label, mutate] of [
  ["wrong IR radius", (ir: ProblemIR) => { ir.facts[1]!.statement = "circular track radius is 51 m"; }],
  ["wrong track identity", (ir: ProblemIR) => { ir.entities[1]!.kind = "point"; }],
  ["wrong request ID", (ir: ProblemIR) => { ir.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "other"; }],
] as const) { const bad = structuredClone(problem); mutate(bad); const responseBody = JSON.stringify({ choices: [{ message: { content: JSON.stringify(bad) } }] });
  const declined = await C.planProblemAuthorityV1(question, plan, { proxyUrl: "https://offline.invalid", timeoutMs: 3000, fetchImpl: async () => new Response(responseBody, { status: 200 }) });
  assert.ok(declined && "status" in declined && declined.status === "source_declined", label + "/ordinary typed IR refusal");
  assert.deepEqual(declined.rawProblemIR, bad);
  await seams(label, plan, bad, false, false); }
// Same operators on different independently solved source values; no fixture ID routing.
for (const [radius, speed] of [[4, 6], [8, 12], [25, 5]]) {
  const q = `A car moves at a constant speed of ${speed} m/s around a circular track of radius ${radius} m. Find its centripetal acceleration and time for one revolution.`;
  const p: TurnPlanV3 = structuredClone(plan); p.question = q;
  p.givens[0]!.value = speed; p.givens[0]!.sourceText = `constant speed of ${speed} m/s`;
  p.givens[1]!.value = radius; p.givens[1]!.sourceText = `radius ${radius} m`;
  p.derived[0]!.value = speed ** 2 / radius; p.derived[0]!.sourceText = "a_c = v^2/r";
  p.derived[1]!.value = 2 * Math.PI * radius / speed; p.derived[1]!.sourceText = "T = 2*pi*r/v";
  p.qualitativeClaims[0]!.expected = `a_c = v^2/r = ${speed ** 2 / radius} m/s^2 directed inward`;
  p.qualitativeClaims[2]!.expected = `T = 2*pi*${radius}/${speed} ≈ ${(2 * Math.PI * radius / speed).toFixed(2)} s`;
  p.assumptions[1] = `Track is a perfect circle of radius ${radius} m`;
  assert.deepEqual(E.uniformCircularRuntimePlanConflicts(q, p), [], "independent values"); checks++;
}
console.log(`${checks} actual full-plan ${native ? "native" : "source"} checks passed`);
