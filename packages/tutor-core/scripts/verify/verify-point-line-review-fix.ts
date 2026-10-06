import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import * as engineSource from "../../../scene-engine/src/index";
import * as coreSource from "../../src/index";
const engine: typeof engineSource = process.argv.includes("--source-engine") ? engineSource : await import("@heytutor/scene-engine");
const core: typeof coreSource = process.argv.includes("--built") ? await import("../../dist/index.js") : coreSource;
const { selectFastVerifiedRepresentation, selectVerifiedRepresentation, buildSourceGroundedRepresentation } = await import("../../../../apps/tutor/features/tutor-session/lib/scene/representationFallback");
type Input = {problem: engineSource.ProblemIR; plan: engineSource.TurnPlanV3; wire: unknown};
// Pin the complete review originals; mutations operate only on own clones.
for (const [file, expected] of [
  ["point-line-fresh-review-20261006.json", "d0e2349920c1ef7b3502c1b975cd2eefe517683d25d23ab656db27d88073daf1"],
  ["point-line-full-caller-20261006.json", "17b3a62cf0eceebfc20815ef42eaa60e6c032cff5c8a63c2954b9b3d622e18ac"],
]) assert.equal(createHash("sha256").update(readFileSync(new URL("../../../scene-engine/scripts/verify/fixtures/" + file, import.meta.url))).digest("hex"), expected, `${file}: frozen whole originals`);
const frozen = JSON.parse(readFileSync(new URL("../../../scene-engine/scripts/verify/fixtures/point-line-fresh-review-20261006.json", import.meta.url), "utf8")) as {cases: Array<{name: string; input: Input}>};
const capture = JSON.parse(readFileSync(new URL("../../../scene-engine/scripts/verify/fixtures/point-line-full-caller-20261006.json", import.meta.url), "utf8")) as {problem: engineSource.ProblemIR; plans: engineSource.TurnPlanV3[]; wire: unknown};
const receipts: unknown[] = [];
const failures: string[] = [];
let checks = 0;
function check(value: unknown, message: string) { checks++; if (!value) failures.push(message); }
async function exercise(name: string, input: Input, reference: engineSource.ProblemIR, positive = false) {
  const {problem, plan, wire} = input, before = JSON.stringify(input);
  const doc = engine.pointLineSourceDocument(reference.question, reference);
  assert.ok(doc, `${name}: reference has a complete source program`);
  const caller = engine.pointLineCallerIssues(plan.question, problem, plan);
  check(positive ? caller.length === 0 : caller.some(i => i.severity === "fatal"), `${name}: caller authority`);
  const compiled = engine.compileSceneDocument(doc, {sourceAuthority: {question: plan.question, problemIR: problem, turnPlan: plan}});
  check(positive ? compiled.ok && !!compiled.renderScene : !compiled.ok && compiled.renderScene === null, `${name}: atomic compiler`);
  const api = await core.planProblemAuthorityV1(plan.question, plan, {proxyUrl: "https://offline.invalid", timeoutMs: 10000,
    fetchImpl: async () => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(wire)}}]}), {status: 200})});
  check(positive ? api && !("status" in api) && api.audit.status === "verified" && api.audit.bindings.length === 3
    : api && "status" in api && api.status === "source_declined", `${name}: ordinary API`);
  if (api && "status" in api) {
    check(JSON.stringify(api.rawProblemIR) === JSON.stringify(wire), `${name}: raw whole wire retained`);
    check(JSON.stringify(api.rawTurnPlan) === JSON.stringify(plan), `${name}: raw whole Plan retained`);
  }
  if (positive && api && !("status" in api)) {
    check(JSON.stringify(api.problemIR) === JSON.stringify(core.liftCompactProblemIR(wire, plan.question)), `${name}: entire unsimplified IR retained`);
    const originalPerp = problem.constraints.find(c => c.id === "cPerp");
    check(originalPerp && "entityIds" in originalPerp && api.problemIR.constraints.some(c => c.id === "cPerp" && c.kind === "perpendicular" && c.entityIds.join() === originalPerp.entityIds.join()), `${name}: original PF perpendicular operands retained`);
  }
  const referenceCompile = engine.compileSceneDocument(doc, {sourceAuthority: {question: reference.question, problemIR: reference}});
  assert.ok(referenceCompile.ok && referenceCompile.renderScene, `${name}: independent complete reference compiles`);
  const exactReference = {sceneDocument: doc, renderScene: referenceCompile.renderScene, validationReport: referenceCompile.report};
  const selections = [];
  for (const families of [undefined, core.inferSceneCapabilities(plan.question, {turnPlan: plan, problemIR: problem, lawIds: plan.lawIds}).families]) {
    for (const exact of [undefined, exactReference]) {
      const options = {question: plan.question, turnPlan: plan, problemIR: problem, families, exact};
      const normal = selectVerifiedRepresentation(options), fast = selectFastVerifiedRepresentation(options);
      check(positive ? normal.tier === "exact_verified" && normal.renderScene.primitives.length > 0 : normal.renderScene.primitives.length === 0, `${name}: normal app atomic selection`);
      check(positive || !fast || fast.renderScene.primitives.length === 0, `${name}: fast app cannot recover ink`);
      if (positive) check(problem.entities.every(entity => normal.sceneDocument.entities.some(e => e.id === entity.id && e.kind === entity.kind)), `${name}: every original actor remains in scene`);
      if (!positive) check(normal.sceneDocument.source.question === plan.question, `${name}: whole source retained in refusal`);
      selections.push({tier: normal.tier, ink: normal.renderScene.primitives.length, reason: normal.reason, document: normal.sceneDocument, scene: normal.renderScene});
    }
  }
  if (!positive) {
    let fallbackRefused = false;
    try { fallbackRefused = buildSourceGroundedRepresentation(plan.question, plan).renderScene.primitives.length === 0; }
    catch { fallbackRefused = true; }
    check(fallbackRefused, `${name}: direct source fallback cannot recover ink`);
  }
  check(JSON.stringify(input) === before, `${name}: full originals untouched`);
  receipts.push({name, positive, caller, compileOk: compiled.ok, compileInk: compiled.renderScene?.primitives.length ?? 0,
    apiStatus: api && ("status" in api ? api.status : api.audit.status), input, api, selections});
}
const horizontal = frozen.cases.find(c => c.name === "horizontal-control")!.input.problem;
for (const c of frozen.cases) await exercise(c.name, c.input, c.name.startsWith("horizontal") ? horizontal : capture.problem, c.name === "horizontal-control");
for (const [index, plan] of capture.plans.entries()) await exercise(`original-capture-${index + 1}`, {problem: capture.problem, plan, wire: capture.wire}, capture.problem, true);
// Independent attacks retain the whole captured caller. Even terms that
// vanish at every sampled x cannot authorize an unbound source variable.
const attacks: Array<[string, (input: Input) => void]> = [
  ["free-x-whitespace-hidden", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+0*x _P";}],
  ["free-x-zero-product", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+0*x";}],
  ["free-x-cancelled", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+x-x";}],
  ["free-x-inside-abs", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+abs(x)";}],
  ["free-x-inside-sqrt", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+sqrt(x^2)";}],
  ["free-x-compensated-at-multiple-samples", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+x*(x-1)*(x-2)";}],
  ["free-x-tuple", i => {i.plan.qualitativeClaims[1]!.expected = "(x_F,y_F)=(0.28+x,1.04)";}],
  ["free-x-vector-scale", i => {i.plan.qualitativeClaims[1]!.expected = "F=P-((s+x)/(a^2+b^2))*(a,b)";}],
  ["free-x-incidence-zero-product", i => {i.plan.qualitativeClaims[2]!.expected = "3*0.28+4*1.04-5+0*x=0";}],
  ["unbound-y", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+0*y";}],
  ["unbound-pi", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+0*pi";}],
  ["unbound-symbol-prefix", i => {i.plan.derived.find(r => r.id === "fx")!.sourceText = "x_F=0.28+0*x_P_other";}],
  ["point-as-line-assumption", i => {i.plan.assumptions.push("The line is exactly P=(1,2)");}],
  ["requested-foot-as-line-hint", i => {i.plan.qualitativeClaims[1]!.relatedEntityHints = ["line the perpendicular foot"];}],
  ["requested-combined-quote-as-line-hint", i => {i.plan.qualitativeClaims[1]!.relatedEntityHints = ["line perpendicular distance from P=(1,2) to 3x+4y-5=0"];}],
  ["line-quote-as-point-hint", i => {i.plan.qualitativeClaims[1]!.relatedEntityHints = ["3x+4y-5=0"];}],
  ["numeric-coincidence-original-AST", i => {i.problem.expressions[1]!.root = {kind: "binary", operator: "+", left: {kind: "number", value: 0.2}, right: {kind: "number", value: 0.08}};
    (i.wire as {expressions: Array<{expr: string}>}).expressions[1]!.expr = "0.2+0.08";}],
];
for (const [name, edit] of attacks) {
  const input = structuredClone({problem: capture.problem, plan: capture.plans[1]!, wire: capture.wire});
  edit(input); await exercise(name, input, capture.problem);
}

// Feet are supplied independent line points; source points are displaced
// along the known normal. No solver output is used to generate expectations.
const oracles: Array<{name: string; p: string; point: [number,number]; abc: [number,number,number]; foot: [number,number]; d: number}> = [
  {name: "oblique", p: "P", point: [1,2], abc: [3,4,-5], foot: [7/25,26/25], d: 6/5},
  {name: "vertical", p: "A", point: [-2,3], abc: [1,0,-5], foot: [5,3], d: 7},
  {name: "horizontal", p: "Q", point: [4,-3], abc: [0,1,-2], foot: [4,2], d: 5},
  {name: "negative-oblique", p: "B", point: [0,0], abc: [1,-1,-6], foot: [3,-3], d: Math.sqrt(18)},
  {name: "incidence-zero", p: "P", point: [3,4], abc: [3,4,-25], foot: [3,4], d: 0},
];
for (const oracle of oracles) {
  const [x,y] = oracle.point, [a,b,c] = oracle.abc;
  const pointText = `${oracle.p}=(${x},${y})`, lineText = `${a}x${b<0?"":"+"}${b}y${c<0?"":"+"}${c}=0`;
  const question = `Find the distance and perpendicular foot F from ${pointText} to ${lineText}.`;
  const plan = structuredClone(capture.plans[0]!); plan.question = question; plan.qualitativeClaims = [];
  plan.givens.forEach((row,index) => {row.value = [x,y,a,b,c][index]!; row.sourceText = index < 2 ? pointText : lineText;
    if (index < 2) row.symbol = `${index === 0 ? "x" : "y"}_${oracle.p}`;});
  plan.derived.forEach((row,index) => {row.value = [oracle.d,...oracle.foot][index]!; row.sourceText = `${row.symbol}=${row.value}`;});
  const wire = structuredClone(capture.wire) as {facts: Array<{statement: string; quote: string}>; entities: Array<{id: string; label: string}>; expressions: Array<{expr: string}>; constraints: Array<{entityIds: string[]}>; representationIntents: Array<{entityIds: string[]}>};
  wire.facts.forEach((f,index) => {f.statement = f.quote = [pointText,lineText,"distance","perpendicular foot F"][index]!;});
  wire.entities[0]!.id = wire.entities[0]!.label = oracle.p; wire.entities[1]!.label = lineText; wire.entities[2]!.label = "F";
  for (const constraint of wire.constraints) constraint.entityIds = constraint.entityIds.map(id => id === "P" ? oracle.p : id);
  wire.representationIntents[0]!.entityIds = [oracle.p,"L","F"];
  const residual = `(${a})*(${x})+(${b})*(${y})${c<0?"-":"+"}${Math.abs(c)}`, norm = `(${a})^2+(${b})^2`;
  wire.expressions.forEach((e,index) => {e.expr = [ `abs(${residual})/sqrt(${norm})`, `(${x})-(${a})*(${residual})/(${norm})`, `(${y})-(${b})*(${residual})/(${norm})` ][index]!;});
  const checked = engine.validateProblemIR(core.liftCompactProblemIR(wire, question), question);
  assert.ok(checked.problem && checked.valid, `${oracle.name}: actual complete lifted IR`);
  const problem = checked.problem;
  const input = {problem, plan, wire};
  await exercise(`independent-${oracle.name}`, input, problem, true);
  const source = engine.readPointLineProgram(question);
  check(source.status === "ok" && Math.abs(source.distance-oracle.d) < 1e-12 && Math.abs(source.foot.x-oracle.foot[0]) < 1e-12 && Math.abs(source.foot.y-oracle.foot[1]) < 1e-12, `${oracle.name}: independent analytic oracle`);
  if (oracle.name === "incidence-zero") {
    const selected = selectVerifiedRepresentation({question, problemIR: problem, turnPlan: plan});
    check(!selected.sceneDocument.assertions.some(a => a.predicate === "perpendicular"), "incidence: no fabricated angle for zero displacement");
    check(selected.sceneDocument.entities.filter(e => e.id === "P" || e.id === "F").length === 2, "incidence: separate original point/foot identities");
  }
  const unsupported = structuredClone(input);
  unsupported.problem.question = unsupported.plan.question = question + " Also find a circle radius.";
  await exercise(`whole-extra-query-${oracle.name}`, unsupported, problem);
  const noCaller = selectVerifiedRepresentation({question: unsupported.plan.question});
  check(noCaller.renderScene.primitives.length === 0, `${oracle.name}: source decline survives missing caller`);
}
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (output) writeFileSync(output, JSON.stringify({checks, failures, receipts}, null, 2));
console.log(JSON.stringify({checks, failures}, null, 2));
assert.equal(failures.length, 0, failures.join("\n"));
