/** Parent full-caller variants on complete truthful controls, plus unsafe stone. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as E from "../../src/index";
import { normalizeProblemIRModelOutput } from "../../../tutor-core/src/planners/problemPlannerV1";
import { parseTurnPlanV3Content } from "../../../tutor-core/src/planners/turnPlannerV3";
import { rawStoredTurnSourceIssues } from "../../../../apps/tutor/lib/scene/storedSceneSource";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";
import { restoreVerifiedDiagramFromTurn } from "../../../../apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram";
const load = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const f = load("./fixtures/w2-ucm-actual-claims-20261006/actual-exchange.json");
const content = JSON.parse(f.planResponseBodies[1]).choices[0].message.content;
const question = JSON.parse(content).question;
const actualPlan = parseTurnPlanV3Content(content, question)!;
const actualIR = JSON.parse(JSON.parse(f.irResponseBody).choices[0].message.content);
const captures = ["car", "stone", "clockwise"].map(name => {
  const c = load(`./fixtures/w2-ucm-live-20261006/w2-ucm-${name}.json`);
  return { name, question: c.question as string, plan: c.canonicalPlan as E.TurnPlanV3, rawIR: c.rawIRs[0] };
});
const originalStone = structuredClone(captures[1]!);
// A separate, explicitly truthful control. Original capture remains immutable
// and is tested as a negative below; no positive uses rounded v as an operand.
captures[1]!.plan = structuredClone(captures[1]!.plan);
captures[1]!.plan.derived[0]!.sourceText = "v = 2*pi*r/T = 2*pi*0.8/2 = 0.8*pi ≈ 2.513";
captures[1]!.plan.derived[1]!.sourceText = "a_c = v^2/r = (2*pi*0.8/2)^2/0.8 = 0.8*pi^2 ≈ 7.896";
captures[1]!.name = "truthful-stone-control";
captures.unshift({ name: "actual-complete-alternate", question, plan: actualPlan, rawIR: actualIR });
let checks = 0;
for (const c of captures) {
  const checked = E.validateProblemIR(normalizeProblemIRModelOutput(c.rawIR, c.question, c.plan), c.question);
  assert.ok(checked.problem);
  const problem = checked.problem;
  const scene = E.synthesizeFamilyScene({ question: c.question, turnPlan: c.plan, problemIR: problem }); assert.ok(scene, c.name);
  function seams(label: string, p: E.TurnPlanV3 | null, ir: E.ProblemIR | null, accept: boolean) {
    const before = structuredClone({ p, ir });
    const admission = { document: scene!.document, question: c.question, turnPlan: p, problemIR: ir, tier: "qualitative_verified" as const };
    const stored = { question: c.question, sceneDocument: scene!.document, sceneArtifacts: { turnPlan: p, problemIR: ir, representationTier: "qualitative_verified" as const } };
    assert.equal(liveSceneSaveFailure(admission) === null, accept, label + "/live");
    assert.equal(sceneSaveAdmissionFailure(admission) === null, accept, label + "/save");
    assert.equal(rawStoredTurnSourceIssues(scene!.document, stored).every(row => row.severity !== "fatal"), accept, label + "/read");
    assert.equal(!!restoreVerifiedDiagramFromTurn(stored), accept, label + "/restore");
    assert.equal(E.uniformCircularCallerIssues(c.question, ir, p).length === 0, accept, label + "/caller");
    assert.equal(E.validateSceneSourceAuthority(scene!.document, c.question, ir, p).every(row => row.severity !== "fatal"), accept, label + "/central");
    const compiled = E.compileSceneDocument(scene!.document, { sourceAuthority: { question: c.question, problemIR: ir, turnPlan: p } });
    assert.equal(compiled.ok, accept, label + "/compile"); if (!accept) assert.equal(compiled.renderScene, null);
    assert.equal(!!E.synthesizeFamilyScene({ question: c.question, problemIR: ir, turnPlan: p }), accept, label + "/family");
    assert.deepEqual({ p, ir }, before, label + "/immutability"); checks += 9;
  }
  for (const variant of ["control", "extraForce", "stale", "noPlan", "noIR", "emptyPlan", "renamedBinding", "renamedUnknown", "wrongSymbol", "wrongUnit", "falseClaim", "falseFact"] as const) {
    const p = structuredClone(c.plan), ir = structuredClone(problem);
    if (variant === "extraForce") p.unknowns.push({ id: "extraForce", symbol: "F", unit: "N" });
    if (variant === "stale") p.derived[0]!.value += 1;
    if (variant === "emptyPlan") { p.givens = []; p.derived = []; p.unknowns = []; p.assumptions = []; p.qualitativeClaims = []; }
    if (variant === "renamedBinding") ir.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "otherRequestedId";
    if (variant === "renamedUnknown") { const old = p.unknowns[0]!.id; p.unknowns[0]!.id = "renamed"; p.derived.find(row => row.id === old)!.id = "renamed"; }
    if (variant === "wrongSymbol") ir.solveRequests[0]!.resultBinding!.symbol = "unbound";
    if (variant === "wrongUnit") ir.solveRequests[0]!.resultBinding!.unit = "N";
    if (variant === "falseClaim") p.qualitativeClaims.push({ id: "false", claim: "Acceleration is zero because speed is constant", expected: true });
    if (variant === "falseFact") ir.facts.find(row => row.kind === "given")!.statement = "The body travels on a straight line";
    seams(c.name + "/" + variant, variant === "noPlan" ? null : p, variant === "noIR" ? null : ir, variant === "control");
  }
  if (c.name === "truthful-stone-control") seams("original unsafe stone", originalStone.plan, problem, false);
}
console.log(`${checks} complete actual caller/lifecycle checks passed (original unsafe stone negative)`);
