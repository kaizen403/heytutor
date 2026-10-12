import { strict as assert } from "node:assert";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import { buildLinearSourceDocument } from "../../src/compile/linearRegionSource";
import { solveLinearFigure } from "../../src/math/linearRegion";
import { exactRationalToNumber } from "../../src/math/exactRational";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

const question = "Maximize Z=3x+2y subject to x>=0,y>=0,x+y<=8 and x<=5. Show the feasible region and all corners.";
function plan(source: string, values: Array<[string, number, string?]>): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question: source, visualRequirement: "required", givens: [], unknowns: values.map(([symbol, , unit], index) => ({ id: `q${index}`, symbol, ...(unit === undefined ? {} : { unit }) })), derived: values.map(([symbol, value, unit], index) => ({ id: `q${index}`, symbol, value, provenance: "derived", ...(unit === undefined ? {} : { unit }) })), qualitativeClaims: [], lawIds: [], assumptions: [] };
}
const doc = buildLinearSourceDocument(question)!;
assert.equal(doc.constructions[0]!.operator, "linear_feasible_region");
const inputs = doc.constructions[0]!.inputs;
const native = solveLinearFigure({ kind: "linear_feasible_region", constraints: inputs.constraints as string[], objective: inputs.objective as { expression: string; sense: "max" } });
assert.equal(native.kind, "linear_feasible_region");
assert.equal(native.objective?.extremum.status, "attained");
if (native.objective?.extremum.status === "attained") assert.equal(exactRationalToNumber(native.objective.extremum.value), 21);
const stale = plan(question, [["Z", 999]]);
const issues = validateLinearSourcePlan(question, stale);
console.log(JSON.stringify({ independentlyComputedObjective: 21, retainedPlannerValue: stale.derived[0]!.value, issues }));
assert.ok(issues.some(issue => issue.severity === "fatal"), "A native correct feasible region cannot authorize a stale objective scalar when no ProblemIR was supplied");
let checks = 5;
function accepted(source: string, values: Array<[string, number, string?]>, reason: string, change?: (candidate: TurnPlanV3) => void) {
  assert.ok(buildLinearSourceDocument(source), `Whole original source must be independently supported: ${reason}`);
  const candidate = plan(source, values); change?.(candidate);
  const before = JSON.stringify(candidate);
  assert.deepEqual(validateLinearSourcePlan(source, candidate), [], reason);
  assert.equal(JSON.stringify(candidate), before, "Numeric agreement does not correct/project planner values"); checks += 3;
}
function refused(source: string, values: Array<[string, number, string?]>, reason: string, change?: (candidate: TurnPlanV3) => void) {
  assert.ok(buildLinearSourceDocument(source), `Refusal cannot be caused by an unsupported source: ${reason}`);
  const candidate = plan(source, values); change?.(candidate);
  const before = JSON.stringify(candidate);
  assert.ok(validateLinearSourcePlan(source, candidate).some(issue => issue.severity === "fatal"), reason);
  assert.equal(JSON.stringify(candidate), before, "A mismatch remains a refusal, never a reconciliation"); checks += 3;
}
accepted(question, [["Z", 21]], "Independent vertex values 0,16,15,21 prove maximum21");
accepted(question, [["Z", 21, "1"]], "Explicit dimensionless unit1");
accepted(question, [["Z", 21, ""]], "Empty schema unit is dimensionless");
accepted(question, [["\\mathrm{Z}", 21]], "Only exact scalar symbol formatting is normalized");
for (const wrong of [31, -21, 20, 999, 21.001]) refused(question, [["Z", wrong]], `Stale objective ${wrong} cannot pair with the exact source figure`);
refused(question, [["Z", 21, "rupees"]], "An undeclared dimensional objective unit is not guessed");
refused(question, [["Z", 21]], "Unknown role dimensional unit cannot hide behind omitted result unit", candidate => { candidate.unknowns[0]!.unit = "rupees"; });
refused(question, [["Z", 21]], "Changed planned question cannot replace the trusted original source", candidate => { candidate.question = question.replace("3x+2y", "5x+2y"); });
refused(question, [["Z", 999]], "A finite source objective cannot be disguised as a given", candidate => { const answer = candidate.derived.pop()!; candidate.givens.push({ ...answer, provenance: "given" }); });
refused(question, [["Z", 999]], "Source alias binding cannot be hidden behind an unrelated result symbol", candidate => { candidate.derived[0]!.symbol = "unrelated"; });
const intermediate = plan(question, [["perimeter", 999], ["Z_A", 999]]);
intermediate.unknowns = [];
assert.deepEqual(validateLinearSourcePlan(question, intermediate), [], "Unrelated intermediates retain the existing audit; no guessed corner/objective symbol join"); checks++;
const noAnswer = plan(question, []);
assert.deepEqual(validateLinearSourcePlan(question, noAnswer), [], "Missing finite answers do not invent numeric contradictions"); checks++;
accepted(question, [["perimeter", 999]], "An unproved perimeter role stays with the existing planner/solver checks");
accepted(question, [["answer", 21]], "An unproved unknown role cannot veto a correct independently proved objective with the same id", candidate => { candidate.derived[0]!.symbol = "Z"; });
refused(question, [["answer", 999]], "Unknown-role deferral cannot hide a wrong proved objective", candidate => { candidate.derived[0]!.symbol = "Z"; });
accepted(question.replace("Z=3x+2y", "3x+2y"), [["Z", 999]], "Unlabelled source does not supply authority to veto an unrelated planner alias");
accepted(question.replace("Z=3x+2y", "3x+2y"), [["Z", 21]], "An unproved alias does not veto a correct planner answer");
accepted(question.replace("Z=3x+2y", "3x+2y"), [["maximum", 21]], "Explicit maximum role binds the native source sense without inventing an objective label");
accepted(question, [["maximum", 21], ["max", 21]], "Source maximum semantic role is independently recomputed");
refused(question, [["maximum", 999]], "Stale requested maximum semantic role");
refused(question, [["minimum", 0]], "Minimum answer cannot substitute for a source maximum request");
accepted(question.replace("Maximize", "Minimize"), [["minimum", 0], ["min", 0]], "Matching minimum semantics preserve the source objective sense");
refused(question.replace("Maximize", "Minimize"), [["maximum", 21]], "Maximum role cannot substitute for a requested minimum");
refused("Maximize Z=x subject to x>=0,y>=0,x<1 and y<=1. Show feasible region.", [["maximum", 1]], "Explicit semantic maximum must be attained, not a finite limit");
const aliasSource = "Profit is Z=3x+2y. Maximize Profit subject to x>=0,y>=0,x+y<=8 and x<=5. Show all corners.";
accepted(aliasSource, [["Profit", 21], ["Z", 21]], "Explicit complete original noun alias and objective label agree");
refused(aliasSource, [["Profit", 999]], "Explicit noun alias is bound to the same exact objective");
const constant = "Maximize C=9 subject to x>=0,y>=0,x+y<=8 and x<=5. Show the feasible region.";
accepted(constant, [["C", 9]], "Constant objectives retain their actual constant");
refused(constant, [["C", 0]], "Objective constants cannot be dropped");
accepted(question.replace("Z=3x+2y", "Z=3x+2y+10"), [["Z", 31]], "Affine objective constant adds10 to all vertices");
refused(question.replace("Z=3x+2y", "Z=3x+2y+10"), [["Z", 21]], "Stale value after objective constant change");
accepted(question.replace("Z=3x+2y", "Z=2*(3x+2y)"), [["Z", 42]], "Scaled source objective is recomputed exactly");
refused(question.replace("Z=3x+2y", "Z=2*(3x+2y)"), [["Z", 21]], "Scaling the source objective cannot reuse an old maximum");
accepted(question.replace("Maximize Z=3x+2y", "Minimize Z=-3x-2y"), [["Z", -21]], "Source minimum preserves its negative objective");
refused(question.replace("Maximize Z=3x+2y", "Minimize Z=-3x-2y"), [["Z", 21]], "Wrong sign is fatal");
refused(question.replace("x+y<=8", "x+y<8").replace("x<=5", "x<5"), [["Z", 21]], "Finite unattained limit cannot stand for the requested maximum");
refused("Maximize Z=x subject to x>=0,y>=0,x<1 and y<=1. Show feasible region.", [["Z", 1]], "Strict feasible set has supremum1 but no maximum1");
accepted("Maximize Z=x subject to x>=0,y>=0,x<=1 and y<=1. Show feasible region.", [["Z", 1]], "Closed attained neighbor has actual maximum1");
const unbounded = "Maximize Z=x+y subject to x>=0 and y>=0. Show the feasible region.";
refused(unbounded, [["Z", 999]], "Unbounded objective has no finite planner answer");
refused("Maximize Z=x+y subject to x>=2,x<=1 and y>=0. Show the feasible region.", [["Z", 0]], "Infeasible region has no finite objective answer");
accepted(question.replace("x+y<=8", "2x+2y<=16"), [["Z", 21]], "Equivalent scaled source constraints preserve the extremum");
refused(question.replace("x+y<=8", "x+y<=9"), [["Z", 21]], "Changed source constraint changes objective23, cannot accept21");
const tiny = "Maximize Z=1e-16*x subject to x>=0,y>=0,x+y<=1. Show the feasible region.";
accepted(tiny, [["Z", 1e-16]], "Tiny exact maximum is independently recomputed without absolute tolerance floor");
refused(tiny, [["Z", 0]], "Wrong zero cannot replace a tiny positive exact maximum");
refused(tiny, [["Z", -1e-16]], "Tiny wrong sign cannot pass a unit-sized absolute tolerance");
refused(tiny.replace("1e-16", "1e-325"), [["Z", 0]], "An exact nonzero objective cannot silently underflow to an authorized zero");
refused(tiny.replace("1e-16", "1e309"), [["Z", 0]], "A finite planner value cannot replace an exact result outside numeric display range");
refused(constant.replace("C=9", "C=0"), [["C", 1e-18]], "Exact zero cannot admit a small stale scalar");
const optimalQuestion = question + " Find the optimal point.";
accepted(optimalQuestion, [["Z", 21], ["x", 5], ["y", 3]], "Exact optimal face is zero-dimensional and attained at(5,3)");
refused(optimalQuestion, [["Z", 21], ["x", 999], ["y", 3]], "Correct objective cannot authorize a stale optimal coordinate");
refused(optimalQuestion, [["x", 999]], "Optimal coordinate id cannot hide behind an unrelated symbol", candidate => { candidate.derived[0]!.symbol = "answer"; });
refused(optimalQuestion, [["x", 3]], "Swapping optimal x/y roles cannot reuse the same unknown id", candidate => { candidate.derived[0]!.symbol = "y"; });
accepted(question, [["Z", 21], ["x", 5]], "Unrequested bare x has no native optimum role to veto");
refused(optimalQuestion.replace("Z=3x+2y", "Z=x+y"), [["Z", 8], ["x", 5]], "An optimal edge has no globally unique x/y scalar");
refused(optimalQuestion.replace("x+y<=8", "x+y<8").replace("x<=5", "x<5"), [["Z", 21], ["x", 5]], "An unattained finite limit does not authorize an optimal point");
const sys07 = "The lines 2x - y = 5 and -3x + 2y = -4 meet at P. Graph both lines, label P, and find its x-coordinate.";
const sys06 = "Solve the pair x + y = 6 and x - y = 2 by the graphical method. Label their point of intersection.";
accepted(sys07, [["x_P", 6], ["y_P", 7]], "A requested x-coordinate and its intermediate y-coordinate are independently source-bound");
accepted(sys06, [["x", 4], ["y", 2]], "Both original source variables from a unique pair");
accepted("Solve the pair x+y=6 and x-y=2 in the coordinate plane. Label the intersection.", [["x", 4], ["y", 2]], "Incidental coordinate-plane prose is not a numeric coordinate request");
accepted("The graphs y=(3/2)x+4 and y=-(1/2)x+10 cross at P. Show the graphs and find the exact coordinates of P.", [["x_P", 3], ["y_P", 8.5]], "A direct exact tuple request shares source point identity without a scalar-set cast");
accepted("The lines x+y=6 and x-y=2 meet at P. Graph both lines and find the coordinates of P.", [["x_P", 4], ["y_P", 2]], "Direct intersection tuple target");
accepted("Solve the pair x+y=6 and x-y=2 by the graphical method. Find x and y.", [["x", 4], ["y", 2]], "Explicit complete source variable pair request");
accepted("Solve the pair x+y=6 and x-y=2 by the graphical method. Find the values of y and x.", [["x", 4], ["y", 2]], "Reordered direct original variables remain the same source pair");
for (const suffix of ["find the coordinates of Q.", "find twice the coordinates of P.", "find the exact coordinates of P in centimeters.", "find its coordinates."]) {
  const source = `The lines x+y=6 and x-y=2 meet at P. Mark Q=(1,1) and ${suffix}`;
  if (buildLinearSourceDocument(source)) accepted(source, [["x_P", 4], ["y_P", 2]], `Unsupported tuple semantics stay with existing planner/solver authority: ${suffix}`);
  else { assert.equal(buildLinearSourceDocument(source), null); checks++; }
}
refused(sys07, [["x_P", 7]], "Incorrect intersection scalar");
refused(sys07, [["y_P", 6]], "Wrong intermediate coordinate");
accepted(sys07, [["x_Q", 6]], "An unproved different point alias does not borrow source intersection authority");
for (const symbol of ["xP", "x(P)", "answer", "perimeter"]) accepted(sys07, [[symbol, 999]], `An unproved alias cannot supply a source-plan veto: ${symbol}`);
accepted(sys07, [["xP", 6]], "An unproved unknown alias cannot contradict a correct, independently proved derived coordinate with the same id", candidate => { candidate.derived[0]!.symbol = "x_P"; });
refused(sys07, [["xP", 7]], "Deferring an unknown alias cannot authorize a wrong proved derived coordinate", candidate => { candidate.derived[0]!.symbol = "x_P"; });
const systemIntermediate = plan(sys07, [["perimeter", 999]]);
systemIntermediate.unknowns = [];
assert.deepEqual(validateLinearSourcePlan(sys07, systemIntermediate), [], "Unrelated system intermediates keep the existing audit rather than a guessed coordinate join"); checks++;
refused(sys06, [["x", 4, "cm"]], "No undeclared Cartesian units");
refused(sys06, [["x", 2]], "Original scalar id cannot change coordinate variable", candidate => { candidate.derived[0]!.symbol = "y"; });
refused(sys06, [["x", 999]], "Source coordinate binding cannot be disguised as an unrelated result", candidate => { candidate.derived[0]!.symbol = "answer"; });
refused(sys06.replace("x - y = 2", "x - y = 4"), [["x", 4], ["y", 2]], "Changing original system cannot accept stale coordinates");
for (const suffix of [
  "Mark Q=(1,1) and find the x-coordinate of Q.",
  "Mark Q=(1,1) and find its x-coordinate.",
  "find the square of its x-coordinate.",
  "find twice its x-coordinate.",
  "find the negative of its x-coordinate.",
  "find its x-coordinate in centimeters.",
]) {
  const source = `The lines x+y=6 and x-y=2 meet at P. Graph both lines and ${suffix}`;
  if (buildLinearSourceDocument(source)) accepted(source, [["x_P", 4]], `Unsupported transformed coordinate request stays with existing planner/solver authority: ${suffix}`);
  else { assert.equal(buildLinearSourceDocument(source), null, `Unsupported full query can never obtain native source admission: ${suffix}`); checks++; }
}
accepted("The lines x+y=6 and x-y=2 meet at P. Mark Q=(1,1) and find the x-coordinate of P.", [["x_P", 4], ["y_P", 2]], "Explicit correct intersection target is distinguished from unrelated original reference point");
refused("Solve the pair x+y=6 and 2x+2y=12 by the graphical method.", [["x", 4]], "A coincident pair cannot prove a unique source variable");
refused("Solve the pair x+y=6 and 2x+2y=14 by the graphical method.", [["x", 4]], "A parallel pair cannot prove a finite intersection");
assert.deepEqual(validateLinearSourcePlan("Explain why prime numbers are infinite.", null), [], "Nonlinear/unrelated source stays outside this narrow native authority"); checks++;
assert.deepEqual(validateLinearSourcePlan(question, null), [], "A missing plan is not a numeric contradiction"); checks++;
assert.deepEqual(validateLinearSourcePlan(question, undefined), [], "Native whole-source proof can stand alone without a supplied plan"); checks++;
console.log(`Linear source-plan numeric agreement gate passed: ${checks} checks`);
