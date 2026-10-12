import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";

// Public compiler source-binding regressions: examples use independently chosen
// numbers except the explicitly identified minimized stored-candidate replay.
function documentFor(operator: string, inputs: Record<string, unknown>, question: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "A graphical solution is required." },
    source: { question }, quantities: [],
    entities: [{ id: "solution", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct_solution", operator, inputs, outputs: ["solution"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["solution"],
    revealGroups: [{ id: "solution_group", entityIds: ["solution"], dependsOn: [], narrationCue: "graphical solution" }],
    teachingTimeline: [{ id: "reveal_solution", action: "reveal", targetId: "solution_group", dependsOn: [], narrationIntent: "Explain the verified solution." }],
  };
}
interface Case { id: string; operator: string; inputs: Record<string, unknown>; question: string; accept?: boolean; originalRejectionCodes?: string[] }
const cases: Case[] = [{
  id: "stored-minimal-half-plane",
  operator: "linear_half_plane",
  inputs: { variables: ["x", "y"], inequality: "-2x-3y<=6", view: { xMin: -5, xMax: 3, yMin: -4, yMax: 3 } },
  question: "Teach me the graph of -2x - 3y <= 6, including how to choose which half-plane to shade.",
  accept: true,
}, ...[
  ["minimize-prefix", "Graph -2x - 3y <= 6."],
  ["minimize-graph-of", "Graph of -2x - 3y <= 6."],
  ["minimize-plain", "-2x - 3y <= 6"],
  ["minimize-teach-prefix", "Teach me the graph of -2x - 3y <= 6."],
  ["minimize-suffix", "-2x - 3y <= 6, including how to choose which half-plane to shade."],
  ["minimize-including", "-2x - 3y <= 6, including."],
  ["minimize-hyphenated-prose", "-2x - 3y <= 6, half-plane."],
  ["minimize-unhyphenated-prose", "-2x - 3y <= 6, half plane."],
].map(([id, question]) => ({ id: id!, operator: "linear_half_plane", inputs: { variables: ["x", "y"], inequality: "-2x-3y<=6", view: { xMin: -5, xMax: 3, yMin: -4, yMax: 3 } }, question: question!, accept: true }))];
const planarView = { xMin: -2, xMax: 20, yMin: -2, yMax: 20 };
const halfPlane = (id: string, question: string, inequality: string, accept = true): Case => ({
  id, question, operator: "linear_half_plane", inputs: { variables: ["x", "y"], inequality, view: planarView }, accept,
});
cases.push(...[
  ["spacing", "Graph -7x + 4y <= 9.", " -7 * x + 4 * y <= 9 "],
  ["unicode-relation", "Graph -7x + 4y ≤ 9.", "-7x+4y<=9"],
  ["ascii-relation", "Graph -7x + 4y <= 9.", "-7x+4y≤9"],
  ["term-order", "Graph -7x + 4y <= 9.", "4y-7x<=9"],
  ["variable-rhs", "Graph -7x + 4y <= 9.", "4y<=9+7x"],
  ["positive-scale", "Graph -7x + 4y <= 9.", "-21x+12y<=27"],
  ["negative-scale-correct-flip", "Graph -7x + 4y <= 9.", "21x-12y>=-27"],
  ["swapped-sides", "Graph -7x + 4y <= 9.", "9>=4y-7x"],
  ["rational-scale", "Graph -7x + 4y <= 9.", "-7x/2+2y<=9/2"],
  ["when-delimiter", "Graph -7x + 4y <= 9 when its boundary crosses both axes.", "-7x+4y<=9"],
].map(([id, question, inequality]) => halfPlane(id!, question!, inequality!)));
cases.push(...[
  ["changed-rhs", "-7x+4y<=10"],
  ["changed-coefficient", "-6x+4y<=9"],
  ["changed-strictness", "-7x+4y<9"],
  ["flipped-weak-side", "-7x+4y>=9"],
  ["negative-scale-missing-flip", "21x-12y<=-27"],
  ["omitted-variable-rhs", "4y<=9"],
].map(([id, inequality]) => halfPlane(id!, "Graph -7x + 4y <= 9.", inequality!, false)));
cases.push(...[
  ["unknown-addend", "Graph -7x + 4y + z <= 9."],
  ["unknown-function", "Graph -7x + f(y) <= 9."],
  ["unknown-coefficient-word", "Graph -7x + 4y <= 9foo."],
  ["nonlinear-source", "Graph -7x + 4y*y <= 9."],
  ["unknown-hyphen-math", "Graph foo-bar+x <= 9."],
  ["hyphen-rhs-math", "Graph -7x + 4y <= foo-bar."],
].map(([id, question]) => halfPlane(id!, question!, "-7x+4y<=9", false)));
const region = (id: string, question: string, constraints = ["x>=0", "y>=0", "x+y<=8", "x+2y<=11"], objective = { expression: "2x+3y", sense: "max" }, accept = true): Case => ({
  id, question, operator: "linear_feasible_region", inputs: { variables: ["x", "y"], constraints, objective, view: planarView }, accept,
});
const regionSource = "Maximize Z = 2x + 3y subject to x >= 0, y >= 0, x + y <= 8 and x + 2y <= 11.";
cases.push(
  region("region-equivalent-reordered", regionSource, ["3x+6y<=33", "0<=2y", "8>=y+x", "-x<=0"]),
  region("objective-gerund", "Explain maximizing Z = 2x + 3y subject to x >= 0, y >= 0, x + y <= 8 and x + 2y <= 11."),
  region("objective-postfix", "Show Z = 2x + 3y maximized over x >= 0, y >= 0, x + y <= 8 and x + 2y <= 11."),
  region("objective-irrelevant-direction-prose", "The feasible region can have a finite maximum: maximize Z = 2x + 3y for x >= 0, y >= 0, x + y <= 8 and x + 2y <= 11."),
  region("objective-separated-definition", "Real nonnegative variables x and y satisfy x + y <= 8 and x + 2y <= 11. Profit is Z = 2x + 3y. Find the maximum profit."),
  region("objective-separate-amount-domain", "A factory chooses real nonnegative production amounts x and y. Its limits are x + y <= 8 and x + 2y <= 11. Revenue is Z = 2x + 3y. Find the maximum revenue."),
  region("source-consider-prose", "For x >= 0 and y >= 0, consider x + y <= 8 and x + 2y <= 11. Explain maximizing Z = 2x + 3y."),
  region("objective-reordered-expression", regionSource, undefined, { expression: "y+y+x+x+y", sense: "max" }),
  region("objective-changed-value", regionSource, undefined, { expression: "2x+4y", sense: "max" }, false),
  region("objective-changed-sense", regionSource, undefined, { expression: "2x+3y", sense: "min" }, false),
  region("objective-changed-constant", regionSource, undefined, { expression: "2x+3y+1", sense: "max" }, false),
  region("constraint-omitted-domain", regionSource, ["x>=0", "x+y<=8", "x+2y<=11"], undefined, false),
  region("constraint-union-topology", regionSource.replace(" and x + 2y", " or x + 2y"), undefined, undefined, false),
  region("constraint-changed-strictness", regionSource, ["x>=0", "y>=0", "x+y<8", "x+2y<=11"], undefined, false),
);
const numberLine = (id: string, question: string, expression: Record<string, unknown>, accept = true): Case => ({
  id, question, operator: "number_line_set", inputs: { variable: "x", expression }, accept,
});
const intervalUnion = { union: [
  { intersection: [{ inequality: "x>=-5" }, { inequality: "x<2" }] },
  { intersection: [{ inequality: "x>2" }, { inequality: "x<=7" }] },
] };
cases.push(
  numberLine("interval-named-union", "Let C = [-5, 2) and D = (2, 7]. Show C union D on a number line.", intervalUnion),
  numberLine("interval-named-intersection", "Let C = (-infinity, 2] and D = [2, infinity). Show C intersection D on a number line.", { intersection: [{ inequality: "x<=2" }, { inequality: "x>=2" }] }),
  numberLine("interval-named-complement", "Let C = [-5, 2). Show the complement of C on a number line.", { complement: { intersection: [{ inequality: "x>=-5" }, { inequality: "x<2" }] } }),
  numberLine("interval-open-closure-mutation", "Let C = [-5, 2) and D = (2, 7]. Show C union D on a number line.", { inequality: "x>=-5" }, false),
  numberLine("interval-unknown-name", "Let C = [-5, 2). Show C union E on a number line.", { intersection: [{ inequality: "x>=-5" }, { inequality: "x<2" }] }, false),
  numberLine("interval-omitted-declared-domain", "Let C = [-5, 2). Show C on a number line for x >= 0.", { intersection: [{ inequality: "x>=-5" }, { inequality: "x<2" }] }, false),
  numberLine("interval-unsupported-operation", "Let C = [-5, 2). Show C except {-1} on a number line.", { intersection: [{ inequality: "x>=-5" }, { inequality: "x<2" }] }, false),
  numberLine("interval-variable-endpoint", "Let C = [-5, x). Show C on a number line.", { inequality: "x>=-5" }, false),
  numberLine("boolean-changed-leaf-same-set", "Show x<0 or x>=0 on a number line.", { union: [{ inequality: "x<1" }, { inequality: "x>=1" }] }, false),
);
cases.push(...[
  ["source-superscript-left", "Graph x²+y<=6.", "y<=6"],
  ["source-superscript-right", "Graph x+y<=6².", "x+y<=6"],
  ["source-subscript-left", "Graph x₁+y<=6.", "y<=6"],
  ["source-square-root", "Graph √x+y<=6.", "x+y<=6"],
  ["source-unicode-product", "Graph x∗x+y<=6.", "x+y<=6"],
  ["source-plus-minus", "Graph x+y<=6 ± 1.", "x+y<=6"],
  ["source-em-dash-arithmetic", "Graph x+y<=6—1.", "x+y<=6"],
  ["source-fraction-slash", "Graph 1⁄x+y<=6.", "x+y<=6"],
  ["source-adjoining-nonlinear", "Graph x+y<=6; z².", "x+y<=6"],
  ["point-unicode-scaling-tail", "Graph x+y<=6. Mark P=(1,2)∗2.", "x+y<=6"],
].map(([id, question, inequality]) => halfPlane(id!, question!, inequality!, false)));
cases.push(
  region("objective-contradictory-reference", `${regionSource} Find the minimum of Z.`, undefined, undefined, false),
  region("objective-contradictory-unknown-reference", `${regionSource} Minimize W.`, undefined, undefined, false),
  region("objective-irrelevant-other-minimum", `${regionSource} The minimum temperature is irrelevant.`),
  numberLine("interval-mixed-or-program", "Let C=[-5,2). Show C or x>=4.", { intersection: [{ inequality: "x>=-5" }, { inequality: "x<2" }, { inequality: "x>=4" }] }, false),
  numberLine("interval-capitalized-unknown", "Let C=[-5,2). Show C Union E.", { intersection: [{ inequality: "x>=-5" }, { inequality: "x<2" }] }, false),
  region("objective-undefined-target", "Z = 2x + 3y. Find the maximum value of W for x >= 0, y >= 0, x + y <= 8 and x + 2y <= 11.", undefined, undefined, false),
  region("objective-unrelated-maximum", "The maximum temperature is 9. Z = 2x + 3y for x >= 0, y >= 0, x + y <= 8 and x + 2y <= 11.", undefined, undefined, false),
  halfPlane("half-plane-dangling-boolean", "Graph x+y<=6 or y.", "x+y<=6", false),
  numberLine("number-line-dangling-boolean", "Show x>=0 or x.", { inequality: "x>=0" }, false),
  { id: "point-axis-order-mutation", operator: "linear_half_plane", inputs: { variables: ["y", "x"], inequality: "x+2y<6" }, question: "Graph x+2y<6. Mark P=(3,1).", accept: false },
  halfPlane("source-colon-scalar-adjacency", "Graph x+y<=6:2.", "x+y<=6", false),
  halfPlane("source-question-scalar-adjacency", "Graph x+y<=6?2.", "x+y<=6", false),
  halfPlane("source-decimal-comma-adjacency", "Graph x+y<=6,5.", "x+y<=6", false),
  halfPlane("source-standard-decimal", "Graph x+y<=6.0.", "x+y<=6"),
  region("source-comma-complete-next-constraint", "Maximize Z=2x+3y subject to x>=0,y>=0,x<=6,2y<=5.", ["x>=0", "y>=0", "x<=6", "2y<=5"]),
  { ...halfPlane("source-scientific-trailing-dot-large", "Graph x+y<=6.e2.", "x+y<=600"), inputs: { variables: ["x", "y"], inequality: "x+y<=600", view: { xMin: -200, xMax: 800, yMin: -200, yMax: 800 } } },
  halfPlane("source-scientific-trailing-dot-large-truncation", "Graph x+y<=6.e2.", "x+y<=6", false),
  halfPlane("source-scientific-trailing-dot-small", "Graph x+y<=6.e-2.", "x+y<=3/50"),
  halfPlane("source-scientific-trailing-dot-small-truncation", "Graph x+y<=6.e-2.", "x+y<=6", false),
  { id: "region-canonical-axis-order", operator: "linear_feasible_region", inputs: { variables: ["x", "y"], constraints: ["x>=0", "y>=0", "x+2y<=6"], view: planarView }, question: "Graph the feasible region x>=0, y>=0 and x+2y<=6.", accept: true },
  { id: "region-derived-tuple-axis-order", operator: "linear_feasible_region", inputs: { variables: ["y", "x"], constraints: ["x>=0", "y>=0", "x+2y<=6"], view: planarView }, question: "Graph the feasible region x>=0, y>=0 and x+2y<=6.", accept: false },
  { id: "system-canonical-axis-order", operator: "linear_system", inputs: { variables: ["x", "y"], equations: ["2x+y=5", "x-y=1"], view: planarView }, question: "Solve the system 2x+y=5 and x-y=1 graphically.", accept: true },
  { id: "system-derived-tuple-axis-order", operator: "linear_system", inputs: { variables: ["y", "x"], equations: ["2x+y=5", "x-y=1"], view: planarView }, question: "Solve the system 2x+y=5 and x-y=1 graphically.", accept: false },
  { id: "half-plane-canonical-axis-order", operator: "linear_half_plane", inputs: { variables: ["y", "x"], inequality: "x+2y<=6", view: planarView }, question: "Graph x+2y<=6.", accept: false },
  halfPlane("source-given-point-membership-prose", "Graph x+y<9 and mark P=(2,3) and Q=(4,6). Which of P and Q belongs to the shaded solution set?", "x+y<9"),
  halfPlane("source-given-point-bare-boolean", "Graph x+y<9 or P. Mark P=(2,3).", "x+y<9", false),
  region("objective-derived-minimizing-point", "Minimize Z=2x+3y for x>=0, y>=0, x+y<=8 and x+2y<=11. Show its corners and minimizing point graphically.", undefined, { expression: "2x+3y", sense: "min" }),
  region("objective-derived-maximum-exists", `${regionSource} Determine whether a finite maximum exists.`),
  region("objective-derived-contradictory-point", `${regionSource} Show its minimizing point graphically.`, undefined, undefined, false),
  region("objective-derived-unknown-point-reference", `${regionSource} Show the maximizing point of W graphically.`, undefined, undefined, false),
  region("objective-derived-contradictory-result", `${regionSource} Determine whether a finite minimum exists.`, undefined, undefined, false),
);
// These cases never supplied a completed source proof. Preserve their exact
// questions and candidates, but test the certainty boundary rather than claim
// that parser failure is mathematical disagreement. Candidate compilation is
// recorded below, not asserted as correctness of a partial planner document.
const unprovedSources = new Map<string, string>([
  ...["unknown-addend", "unknown-function", "unknown-coefficient-word", "nonlinear-source", "unknown-hyphen-math", "hyphen-rhs-math",
    "source-superscript-left", "source-superscript-right", "source-subscript-left", "source-square-root", "source-unicode-product", "source-plus-minus", "source-em-dash-arithmetic", "source-fraction-slash", "source-adjoining-nonlinear"]
    .map(id => [id, "The complete affine operand grammar is unsupported"] as const),
  ...["interval-unknown-name", "interval-omitted-declared-domain", "interval-unsupported-operation", "interval-variable-endpoint", "interval-mixed-or-program", "interval-capitalized-unknown"]
    .map(id => [id, "The complete named-set operation or shared domain scope is unproved"] as const),
  ...["objective-contradictory-reference", "objective-contradictory-unknown-reference", "objective-undefined-target", "objective-unrelated-maximum", "objective-derived-contradictory-point", "objective-derived-unknown-point-reference", "objective-derived-contradictory-result"]
    .map(id => [id, "Additional objective request/target semantics are outside the native source proof"] as const),
  ...["half-plane-dangling-boolean", "number-line-dangling-boolean", "source-given-point-bare-boolean"]
    .map(id => [id, "The complete Boolean operand program is unproved"] as const),
  ...["source-colon-scalar-adjacency", "source-question-scalar-adjacency", "source-decimal-comma-adjacency"]
    .map(id => [id, "The scalar punctuation has unresolved numeric meaning"] as const),
]);
for (const id of unprovedSources.keys()) assert.ok(cases.some(entry => entry.id === id), `Unproved-source case ${id} must still exist`);
const replayArgument = process.argv.find((arg) => arg.startsWith("--replay-stored="));
const replayCases: Case[] = [];
if (replayArgument) {
  const directory = resolve(replayArgument.slice("--replay-stored=".length));
  const seen = new Set<string>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    const run = JSON.parse(readFileSync(resolve(directory, file), "utf8")) as {
      probeId: string; question: string; diagram: { rejectedOperatorCalls: Array<{ operator: string; rawArguments: string; errorCodes: string[] }> };
    };
    for (const call of run.diagram.rejectedOperatorCalls) {
      if (!call.errorCodes.includes("linear_source_mismatch") || !["linear_half_plane", "linear_feasible_region", "linear_system", "number_line_set"].includes(call.operator)) continue;
      const key = JSON.stringify([run.question, call.operator, call.rawArguments]);
      if (seen.has(key)) continue;
      seen.add(key);
      replayCases.push({ id: `${run.probeId}#${replayCases.length}`, question: run.question, operator: call.operator, inputs: JSON.parse(call.rawArguments) as Record<string, unknown>, originalRejectionCodes: call.errorCodes });
    }
  }
}
const outcomes = [...cases, ...replayCases].map((entry) => {
  const candidate = documentFor(entry.operator, entry.inputs, entry.question);
  const result = compileSceneDocument(candidate);
  const unprovedReason = unprovedSources.get(entry.id);
  const readerRefused = unprovedReason ? buildLinearSourceDocument(entry.question) === null : undefined;
  const bindingIssues = unprovedReason ? validateLinearSourceBinding(candidate) : undefined;
  return { ...entry, actualAccepted: result.ok && result.renderScene !== null, unprovedReason, readerRefused, bindingIssues,
    issues: result.report.issues, passed: unprovedReason ? readerRefused && bindingIssues?.length === 0
      : entry.accept === undefined ? undefined : entry.accept ? result.ok && result.renderScene !== null : !result.ok && result.renderScene === null };
});
const evidenceArgument = process.argv.find((arg) => arg.startsWith("--evidence="));
if (evidenceArgument) {
  const path = resolve(evidenceArgument.slice("--evidence=".length));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema: "linear-source-equivalence/v1", outcomes }, null, 2) + "\n");
}
for (const entry of outcomes) console.log(`${entry.passed === undefined ? entry.actualAccepted ? "REPLAY ADMITTED" : "REPLAY REFUSED" : entry.passed ? "PASS" : "FAIL"} ${entry.id}: ${entry.unprovedReason ? `reader refusal/no-veto (${entry.unprovedReason}); candidate compilation is observational; ` : ""}${JSON.stringify(entry.issues)}`);
assert.equal(outcomes.slice(0, cases.length).filter((entry) => !entry.passed).length, 0, "every source-equivalence regression must match its expected acceptance");
console.log(`linear source equivalence: ${cases.length} contract cases passed; stored minimal replays ${replayCases.length ? `${outcomes.slice(cases.length).filter((entry) => entry.actualAccepted).length} admitted, ${outcomes.slice(cases.length).filter((entry) => !entry.actualAccepted).length} refused (observations, no expected-acceptance assertion)` : "not requested"}`);
