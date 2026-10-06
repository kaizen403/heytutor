/** Complete original UCM callers: normalized operand proof and every IR entity. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../../src/index";
import * as C from "@heytutor/tutor-core";

const capture = JSON.parse(readFileSync(new URL("./fixtures/w2-ucm-actual-claims-20261006/actual-exchange.json", import.meta.url), "utf8")) as { planResponseBodies: string[]; irResponseBody: string };
const contents = capture.planResponseBodies.map(body => JSON.parse(body).choices[0].message.content as string);
const wire = contents.map(content => JSON.parse(content) as E.TurnPlanV3);
const question = wire[1]!.question;
const original = C.parseTurnPlanV3Content(contents[1]!, question); assert.ok(original);
assert.equal(C.parseTurnPlanV3Content(contents[0]!, question), null);
const rawContent = JSON.parse(capture.irResponseBody).choices[0].message.content as string;
const rawIR = JSON.parse(rawContent);
const problem = E.validateProblemIR(C.normalizeProblemIRModelOutput(rawIR, question, original), question).problem; assert.ok(problem);
const candidate = E.synthesizeFamilyScene({ question, turnPlan: original, problemIR: problem }); assert.ok(candidate);
let cases = 0;
const failures: string[] = [];

async function check(label: string, plan: E.TurnPlanV3, ir: E.ProblemIR, accept: boolean) {
  cases++;
  const before = structuredClone({ plan, ir });
  try {
    // No generated IR, substituted Plan or pruning of original rows obtains admission.
    for (const key of ["givens", "unknowns", "derived", "qualitativeClaims"] as const) {
      for (const row of (plan === wire[0] ? wire[0]! : original!)[key]) {
        const retained = plan[key].find(other => other.id === row.id); assert.ok(retained, label + "/original " + row.id);
        if ("symbol" in row && "symbol" in retained) { assert.equal(retained.symbol, row.symbol); assert.equal(retained.unit, row.unit); }
      }
    }
    for (const key of ["facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"] as const) {
      for (const row of problem![key]) {
        const retained = ir[key].find(other => other.id === row.id); assert.ok(retained);
        if (key === "representationIntents" && label.endsWith(" linked")) {
          assert.ok("entityIds" in retained && "entityIds" in row);
          for (const id of row.entityIds) assert.ok(retained.entityIds.includes(id));
          assert.deepEqual({ ...retained, entityIds: row.entityIds }, row);
        } else assert.deepEqual(retained, row, label + "/original IR " + row.id);
      }
    }
    assert.ok(E.validateProblemIR(ir, question).valid, label + "/typed IR");
    const authority = { question, turnPlan: plan, problemIR: ir };
    assert.equal(E.uniformCircularCallerIssues(question, ir, plan).every(issue => issue.severity !== "fatal"), accept, label + "/caller");
    assert.equal(!!E.synthesizeFamilyScene(authority), accept, label + "/family");
    assert.equal(E.validateSceneSourceAuthority(candidate!.document, question, ir, plan).every(issue => issue.severity !== "fatal"), accept, label + "/central");
    const compiled = E.compileSceneDocument(candidate!.document, { sourceAuthority: authority });
    assert.equal(compiled.ok, accept, label + "/compile"); assert.equal(!!compiled.renderScene, accept, label + "/render");
    const unmodifiedIR = ir === problem;
    const responseContent = unmodifiedIR ? rawContent : JSON.stringify(ir);
    const api = await C.planProblemAuthorityV1(question, plan, {
      proxyUrl: "https://offline.invalid", timeoutMs: 3000,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: responseContent } }] }), { status: 200 }),
    });
    assert.ok(api, label + "/API response");
    if (accept) {
      assert.ok(!("status" in api), label + "/ordinary API");
      assert.equal(api.audit.status, "verified"); assert.ok(api.projection);
      assert.deepEqual(api.problemIR, ir); assert.equal(api.rawContent, responseContent);
      assert.deepEqual(api.solverResult.values.map(value => value.approximate), [8, 5 * Math.PI]);
    } else {
      assert.ok("status" in api && api.status === "source_declined", label + "/ordinary API refusal");
      assert.deepEqual(api.rawTurnPlan, plan);
      assert.deepEqual(api.rawProblemIR, unmodifiedIR ? rawIR : ir);
      assert.ok(!("projection" in api), label + "/no projection before refusal");
    }
    console.log("PASS " + label);
  } catch (error) {
    failures.push(label + ": " + (error instanceof Error ? error.message : String(error)));
    console.log("FAIL " + failures.at(-1));
  }
  assert.deepEqual({ plan, ir }, before, label + "/original inputs immutable");
}
async function mutation(label: string, edit: (plan: E.TurnPlanV3) => void, accept: boolean) {
  const plan = structuredClone(original!); edit(plan); await check(label, plan, problem!, accept);
}
function omega(plan: E.TurnPlanV3) {
  plan.derived.push({ id: "omega", symbol: "omega", unit: "rad/s", value: .4, provenance: "derived", sourceText: "omega = v/r", dependsOn: ["v", "r"] });
}
await check("unchanged wire alternate", wire[1]!, problem, true);
await check("unchanged parsed alternate", original, problem, true);
await check("whole primary remains negative", wire[0]!, problem, false);

const equations = [
  { index: 0, text: "a_c = omega^2*r = 8 m/s^2", deps: ["omega", "r"] },
  { index: 0, text: "a_c = ω²*r = 8 m/s² directed inward", deps: ["omega", "r"] },
  { index: 0, text: "a_c = omega^2*r, directed radially inward", deps: ["omega", "r"] },
  { index: 1, text: "T = 2*pi/omega = 5*pi ≈ 15.708 s", deps: ["omega"] },
  { index: 1, text: "T = 2*π/ω = 5*π ≈ 15.708 s", deps: ["omega"] },
];
const placements = [
  (text: string) => text,
  (text: string) => "Speed is constant; " + text,
  (text: string) => text + "; Speed is constant",
  (text: string) => "Speed is constant\n" + text + "; Tangential acceleration is zero.",
];
for (const [i, equation] of equations.entries()) for (const [j, place] of placements.entries()) {
  for (const accept of [true, false]) await mutation(`equation${i} placement${j} ${accept ? "correct" : "wrong direct"} graph`, plan => {
    omega(plan);
    plan.derived[equation.index]!.sourceText = place(equation.text);
    plan.derived[equation.index]!.dependsOn = accept ? equation.deps : ["v", "r"];
  }, accept);
}
for (const [label, text] of [
  ["numeric first", "a_c = 8 m/s^2 = omega^2*r"],
  ["later equation", "a_c = 8 m/s^2; Speed is constant; a_c = omega^2*r directed inward"],
  ["self member", "a_c = a_c = omega^2*r"],
]) for (const accept of [true, false]) await mutation(`${label} ${accept ? "correct" : "wrong direct"} graph`, plan => {
  omega(plan); plan.derived[0]!.sourceText = text; plan.derived[0]!.dependsOn = accept ? ["omega", "r"] : ["v", "r"];
}, accept);
for (const accept of [true, false]) await mutation(`both symbolic laws ${accept ? "complete" : "missing intermediate"}`, plan => {
  omega(plan); plan.derived[0]!.sourceText = "a_c = v^2/r = omega^2*r = 8 m/s^2";
  plan.derived[0]!.dependsOn = accept ? ["v", "r", "omega"] : ["v", "r"];
}, accept);
for (const accept of [true, false]) await mutation(`normalized omega from period ${accept ? "correct" : "wrong direct"} graph`, plan => {
  omega(plan); plan.derived.at(-1)!.sourceText = "Speed is constant; ω = 2*π/T = 0.4 rad/s";
  plan.derived.at(-1)!.dependsOn = accept ? ["T"] : ["v", "r"];
  plan.derived[0]!.sourceText = "a_c = ω²*r = 8 m/s² directed inward"; plan.derived[0]!.dependsOn = ["omega", "r"];
}, accept);
await mutation("numeric expanded intermediate", plan => {
  omega(plan); plan.derived[0]!.sourceText = "a_c = 0.4^2*50 = 8 m/s^2"; plan.derived[0]!.dependsOn = ["omega", "r"];
}, true);
await mutation("direct law with pi glyph", plan => { plan.derived[1]!.sourceText = "Speed is constant; T = 2*π*r/v = 5*π ≈ 15.708 s"; }, true);
await mutation("false prose still declines", plan => {
  omega(plan); plan.derived[0]!.sourceText = "Speed is variable; a_c = omega^2*r = 8 m/s^2"; plan.derived[0]!.dependsOn = ["omega", "r"];
}, false);
await mutation("wrong units still decline", plan => {
  omega(plan); plan.derived[0]!.sourceText = "Speed is constant; a_c = omega^2*r = 8 N"; plan.derived[0]!.dependsOn = ["omega", "r"];
}, false);
await mutation("cycle with normalized equations", plan => {
  omega(plan); plan.derived.at(-1)!.sourceText = "Speed is constant; omega = 2*π/T"; plan.derived.at(-1)!.dependsOn = ["T"];
  plan.derived[1]!.sourceText = "Speed is constant; T = 2*π/ω = 5*π ≈ 15.708 s"; plan.derived[1]!.dependsOn = ["omega"];
}, false);

for (const linked of [false, true]) for (const label of ["second car with mass 1 kg moving clockwise", "second car", "car"]) {
  const ir = structuredClone(problem);
  ir.entities.push({ ...ir.entities[0]!, id: "foreign", label });
  if (linked) ir.representationIntents[0]!.entityIds.push("foreign");
  await check(`foreign ${label}${linked ? " linked" : " unused"}`, original, ir, false);
}
const extraEntities: Array<[string, E.ProblemIR["entities"][number]]> = [
  ["duplicate path", { ...problem.entities[1]!, id: "duplicate" }],
  ["unproved centre evidence", { id: "centre", kind: "point" as const, label: "centre", evidenceFactIds: ["fSpeed"] }],
  ["foreign force", { id: "force", kind: "point" as const, label: "centripetal force 8 N", evidenceFactIds: ["fRadius"] }],
];
for (const [label, entity] of extraEntities) {
  const ir = structuredClone(problem); ir.entities.push(entity);
  await check(label, original, ir, false);
}
const centre = structuredClone(problem);
centre.entities.push({ id: "centre", kind: "point", label: "centre", evidenceFactIds: ["fRadius"] });
await check("distinct source proved centre", original, centre, true);
const duplicateCentre = structuredClone(centre);
duplicateCentre.entities.push({ ...duplicateCentre.entities.at(-1)!, id: "centre2", label: "center" });
await check("duplicate centre identity", original, duplicateCentre, false);
console.log(`${cases} operand/entity cases, ${failures.length} failures`);
assert.deepEqual(failures, []);
