import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";
import { parseLinearConstraint, linearConstraintSignature, type ExactPoint } from "../../src/math/linearRegion";
import { addRational, multiplyRational, compareRational, deserializeRational } from "../../src/math/exactRational";

function documentFor(question: string, operator: string, inputs: Record<string, unknown>): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "Show the exact supplied solution." }, quantities: [],
    entities: [{ id: "solution", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct_solution", operator, inputs, outputs: ["solution"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["solution"],
    revealGroups: [{ id: "solution_group", entityIds: ["solution"], dependsOn: [], narrationCue: "graphical solution" }],
    teachingTimeline: [{ id: "reveal_solution", action: "reveal", targetId: "solution_group", dependsOn: [], narrationIntent: "Explain the verified solution." }],
  };
}
function componentsFor(question: string, operator: string, inputs: Record<string, unknown>[]): SceneDocument {
  const document = documentFor(question, operator, inputs[0]!);
  const ids = inputs.map((_, i) => `solution_${i}`);
  document.entities = ids.map(id => ({ id, kind: "linear_region", role: "solution" }));
  document.constructions = inputs.map((value, i) => ({ id: `construct_${i}`, operator, inputs: value, outputs: [ids[i]!] }));
  document.requiredEntityIds = ids;
  document.revealGroups[0]!.entityIds = ids;
  return document;
}

let checks = 0;
const failures: string[] = [];
function check(id: string, action: () => void): void {
  checks++;
  try { action(); console.log(`PASS ${id}`); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); failures.push(id); console.log(`FAIL ${id}: ${message}`); }
}

// Review examples plus four authored variations exercise complete request
// consumption. A successfully scanned affine span alone proves no request.
const uncertain = [
  "Let A=[0,4] and B=[1,2]. Represent A ∩ B' on a number line.",
  "Let A=[0,4] and B=[1,2]. Represent the difference of A and B on a number line.",
  "Let A = [1, 5] and B = [3, 7]. Represent the symmetric difference of A and B on a number line.",
  "Represent x > 2 on one number line and x < 5 on another.",
  "Represent x > 2 on one number line, then x < 5 on another.",
  "Represent x > 2 and, on a second number line, x < 5.",
  "Graph x + y ≤ 4 and x + y ≥ 2 on two different graphs.",
  "Shade the region opposite to x + y ≤ 4.",
  "Show where x + y ≤ 4 is false.",
  "Shade the region where 2x + y ≥ 4 is wrong.",
  "Represent x > 2·5 on a number line.",
  "Let A=[0,4] and B=[1,2]. Draw A ∩ B′ as a set of real numbers.",
  "Let A=[0,4] and B=[1,2]. Plot the elements in A but outside B on a number line.",
  "Display x>2 on the first axis; display x<5 on the next axis.",
  "Indicate the points for which the claim x+y<=4 does not hold.",
  "Graph x+y<=4 if x>=2 in the coordinate plane.",
  "Draw x+y<=4 and x+y>=2 on two graphs.",
  "Represent the union x<0 and x>2 on a number line.",
  "For real x, let I={x:x>1} and J={x:x<3}. Draw K=I intersection J on a number line and show K union J.",
  "Let A=[1,5] and B=[3,7]. Represent union A and B on a number line.",
  "For real x, let I={x:x>1} and J={x:x<3}. Draw Result=I intersection J on a number line and show Result union J.",
  "Represent x<0 then x>2 on a number line.",
  "Graph x+y<=8 if x>1.",
  "If x>1 then graph x+y<=8.",
  "Represent complement x<0 on a number line.",
];
for (const [i, question] of uncertain.entries()) check(`uncertain-reader-${i + 1}`, () => assert.equal(buildLinearSourceDocument(question), null, question));

const difference = { intersection: [
  { intersection: [{ inequality: "x>=0" }, { inequality: "x<=4" }] },
  { complement: { intersection: [{ inequality: "x>=1" }, { inequality: "x<=2" }] } },
] };
for (const [i, question] of [uncertain[0]!, uncertain[1]!, uncertain[11]!, uncertain[12]!].entries()) check(`uncertain-valid-planner-set-${i + 1}`, () => {
  const result = compileSceneDocument(documentFor(question, "number_line_set", { variable: "x", expression: difference }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
for (const [i, question] of [uncertain[7]!, uncertain[8]!, uncertain[14]!].entries()) check(`uncertain-valid-planner-side-${i + 1}`, () => {
  const result = compileSceneDocument(documentFor(question, "linear_half_plane", { variables: ["x", "y"], inequality: "x+y>4" }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
check("uncertain-valid-planner-symmetric-difference", () => {
  const a = { intersection: [{ inequality: "x>=1" }, { inequality: "x<=5" }] };
  const b = { intersection: [{ inequality: "x>=3" }, { inequality: "x<=7" }] };
  const expression = { union: [{ intersection: [a, { complement: b }] }, { intersection: [b, { complement: a }] }] };
  const result = compileSceneDocument(documentFor(uncertain[2]!, "number_line_set", { variable: "x", expression }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
check("uncertain-valid-planner-middle-dot", () => {
  const result = compileSceneDocument(documentFor(uncertain[10]!, "number_line_set", { variable: "x", expression: { inequality: "x>5/2" } }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
check("uncertain-valid-planner-wrong-side-request", () => {
  const result = compileSceneDocument(documentFor(uncertain[9]!, "linear_half_plane", { variables: ["x", "y"], inequality: "2x+y<4" }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
for (const [i, question] of uncertain.slice(3, 7).entries()) check(`uncertain-multiple-planner-operands-${i + 1}`, () => {
  // A planner can own separate components. The whole-question reader must
  // not bind either component to its guessed single conjunction.
  const candidate = documentFor(question, i === 3 ? "linear_half_plane" : "number_line_set", i === 3
    ? { variables: ["x", "y"], inequality: "x+y<=4" }
    : { variable: "x", expression: { inequality: "x>2" } });
  assert.deepEqual(validateLinearSourceBinding(candidate), []);
});
for (const [i, question] of uncertain.slice(17, 22).entries()) check(`unconsumed-operator-has-no-binding-authority-${i + 1}`, () => {
  // These requests contain additional or ambiguous mathematical scope. This
  // component only probes absence of reader authority, not scene completeness.
  assert.deepEqual(validateLinearSourceBinding(documentFor(question, "number_line_set", { variable: "x", expression: { inequality: "x<0" } })), []);
});
for (const [i, question] of uncertain.slice(22, 24).entries()) check(`unproved-conditional-correct-planner-${i + 1}`, () => {
  const result = compileSceneDocument(documentFor(question, "linear_feasible_region", { variables: ["x", "y"], constraints: ["x+y<=8", "x>1"] }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
check("unproved-prefix-complement-correct-planner", () => {
  const result = compileSceneDocument(documentFor(uncertain[24]!, "number_line_set", { variable: "x", expression: { complement: { inequality: "x<0" } } }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
check("closed-if-possible-request", () => {
  const question = "Graph x+y<=8 if possible.";
  const reader = buildLinearSourceDocument(question);
  assert.ok(reader);
  assert.ok(compileSceneDocument(reader).ok);
});
for (const [i, expression, accepted] of [
  [1, { complement: { inequality: "x<0" } }, true],
  [2, { inequality: "x<0" }, false],
] as Array<[number, Record<string, unknown>, boolean]>) check(`proved-unary-not-${i}`, () => {
  const result = compileSceneDocument(documentFor("Represent not x<0 on a number line.", "number_line_set", { variable: "x", expression }));
  assert.equal(Boolean(result.ok && result.renderScene), accepted, JSON.stringify(result.report.issues));
});

for (const [i, question, planar] of [
  [1, "Represent x>2 and x<5 using two number lines.", false],
  [2, "Represent x>2 and x<5 with two number lines.", false],
  [3, "Represent each solution set x>2 and x<5 on a number line.", false],
  [4, "Graph x+y<=4 and x+y>=2. Use two graphs.", true],
  [5, "Graph x+y<=4 and x+y>=2. Draw two graphs.", true],
  [6, "Represent x>2 and x<5 with two different number lines.", false],
  [7, "Use two number lines to represent x>2 and x<5.", false],
  [8, "Graph x+y<=4 and x+y>=2 as two graphs.", true],
  [9, "Draw two graphs for x+y<=4 and x+y>=2.", true],
] as Array<[number, string, boolean]>) check(`plural-display-scope-${i}`, () => {
  assert.equal(buildLinearSourceDocument(question), null);
  const candidate = componentsFor(question, planar ? "linear_half_plane" : "number_line_set", planar
    ? [{ variables: ["x", "y"], inequality: "x+y<=4" }, { variables: ["x", "y"], inequality: "x+y>=2" }]
    : [{ variable: "x", expression: { inequality: "x>2" } }, { variable: "x", expression: { inequality: "x<5" } }]);
  assert.deepEqual(validateLinearSourceBinding(candidate), []);
});
for (const [i, question] of [
  "Represent x>2 and x<5 on one number line.",
  "Represent x>2 and x<5 using one number line.",
  "Graph x+y<=4 and x+y>=2 on one graph.",
  "Graph x+y<=4 and x+y>=2. Draw one graph.",
].entries()) check(`single-display-scope-${i + 1}`, () => {
  const reader = buildLinearSourceDocument(question);
  assert.ok(reader);
  assert.ok(compileSceneDocument(reader).ok);
});
check("descriptive-two-graphs-retains-proved-coordinate-authority", () => {
  const question = "Teach me how the two graphs 2x + y = 7 and x - y = 2 show a unique solution.";
  const reader = buildLinearSourceDocument(question);
  assert.ok(reader);
  assert.ok(compileSceneDocument(reader).ok);
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [],
    unknowns: [{ id: "y", symbol: "y" }], derived: [{ id: "y", symbol: "y", value: 1, provenance: "derived" }],
    qualitativeClaims: [], lawIds: [], assumptions: [] };
  assert.deepEqual(validateLinearSourcePlan(question, plan), []);
  plan.derived[0]!.value = -1;
  assert.ok(validateLinearSourcePlan(question, plan).some(issue => issue.code === "linear_source_plan_value_mismatch"));
});
for (const [i, question] of [
  "Graph only the boundary of x+y<=4.",
  "Draw only the boundary of x+y<=4.",
  "Plot the boundary line of x+y<=4.",
  "Represent only the boundary points of x+y<=4.",
  "Show the boundary of the region x+y<=4 only.",
  "Draw the exact boundary of x+y<=4.",
  "Graph x+y<=4. Draw only its boundary.",
].entries()) check(`boundary-result-scope-${i + 1}`, () => {
  assert.equal(buildLinearSourceDocument(question), null);
  assert.deepEqual(validateLinearSourceBinding(documentFor(question, "linear_system", { variables: ["x", "y"], equations: ["x+y=4", "x+y=4"] })), []);
});
for (const [i, question] of ["Graph x+y<=4 and label its boundary.", "Shade x+y<=4 and show its boundary."].entries()) check(`region-with-boundary-annotation-${i + 1}`, () => {
  const reader = buildLinearSourceDocument(question);
  assert.ok(reader);
  const result = compileSceneDocument(reader);
  assert.ok(result.ok && result.renderScene);
  assert.ok(result.renderScene.primitives.some(primitive => primitive.provenance?.linearRole === "feasible_fill"));
});
for (const [i, statement] of [
  "Do not restrict x to integers.",
  "No restriction to integers is intended.",
  "The domain includes real numbers, not only integers.",
  "Do not treat x as integers.",
  "An integer restriction does not apply.",
  "It is not limited to whole numbers.",
  "Are integers required?",
  "Let x not be an integer.",
  "An integer x is not required.",
].entries()) check(`unproved-discrete-domain-statement-${i + 1}`, () => {
  const question = `Represent x<3 on a number line. ${statement}`;
  assert.equal(buildLinearSourceDocument(question), null);
  const result = compileSceneDocument(documentFor(question, "number_line_set", { variable: "x", expression: { inequality: "x<3" } }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
});
for (const [i, statement] of [
  "for integer x.", "for natural numbers x.", "with x in Z.", "over Z.",
  ". x is an integer.", ". Restrict x to whole numbers.",
  "for x∈ℤ.", "for x ∈ ℤ.", "for x ∈ℤ.",
  "for x \\in \\mathbb{Z}.",
  "for x \\in \\mathbb{N}.",
  ". Let x be an integer.", ". Given integer x.",
].entries()) check(`proved-discrete-domain-${i + 1}`, () => {
  const question = `Graph x<3 ${statement}`;
  assert.equal(buildLinearSourceDocument(question), null);
  const result = compileSceneDocument(documentFor(question, "number_line_set", { variable: "x", expression: { inequality: "x<3" } }));
  assert.ok(!result.ok && result.renderScene === null && result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
for (const inequality of ["x<2.5", "x<.5", "x<5/2", "x<2.5e1", "x<2e-1", "2x-1<7"]) check(`proved-discrete-domain-scalar-${inequality}`, () => {
  const question = `Represent ${inequality} on a number line in Z.`;
  assert.equal(buildLinearSourceDocument(question), null);
  const result = compileSceneDocument(documentFor(question, "number_line_set", { variable: "x", expression: { inequality } }));
  assert.ok(!result.ok && result.renderScene === null && result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
check("proved-real-set-alias-is-not-an-integer-domain", () => {
  const question = "For real x, let Z={x:x<3} and I={x:x>0}. Draw Result=Z intersection I on a number line. State x belongs to Z.";
  assert.equal(buildLinearSourceDocument(question), null, "The extra bare-x membership request is unproved");
  const candidate = documentFor(question, "number_line_set", { variable: "x", expression: { intersection: [{ inequality: "x<3" }, { inequality: "x>0" }] } });
  assert.deepEqual(validateLinearSourceBinding(candidate), []);
  assert.ok(compileSceneDocument(candidate).ok);
});
check("planar-witness-proof-budget-defers", () => {
  const question = `Shade the complement of (${Array(16).fill("x+y<1").join(" or ")}).`;
  const inputs = { variables: ["x", "y"], constraints: Array(16).fill("x+y>=1") };
  const result = compileSceneDocument(documentFor(question, "linear_feasible_region", inputs));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const wrong = compileSceneDocument(documentFor(question, "linear_feasible_region", { ...inputs, constraints: [...Array(15).fill("x+y>=1"), "x+y>=2"] }));
  assert.ok(!wrong.ok && wrong.renderScene === null && wrong.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
for (const [i, statement] of [
  "Mark the intersection AT THE ORIGIN.", "Mark the intersection at THE origin.",
  "The lines meet at THE origin.", "The lines cross at THE origin.",
  "Show the point of intersection at THE origin.",
  "Mark the intersection at AN origin.", "Mark the intersection at BY origin.",
  "Mark the intersection at A point.",
].entries()) check(`grammatical-origin-is-not-a-name-${i + 1}`, () => {
  const question = `Graph x+y=0 and x-y=0. ${statement}`;
  const result = compileSceneDocument(documentFor(question, "linear_system", { variables: ["x", "y"], equations: ["x+y=0", "x-y=0"] }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.ok(!result.renderScene.primitives.some(primitive => primitive.provenance?.linearSourceNames));
  assert.ok(result.renderScene.primitives.some(primitive => primitive.text === "One solution"));
});
for (const [i, prefix] of ["WHY", "RHS", "AND", "AT", "IN"].entries()) check(`grammatical-colon-is-not-a-name-${i + 1}`, () => {
  const result = compileSceneDocument(documentFor(`Explain ${prefix}: x+y=0 and x-y=0.`, "linear_system", { variables: ["x", "y"], equations: ["x+y=0", "x-y=0"] }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.ok(!result.renderScene.primitives.some(primitive => primitive.provenance?.linearRole === "boundary_name"));
});
for (const [id, question, operator, inputs] of [
  ["double-complement", "Represent the complement of the complement of x<0 on a number line.", "number_line_set", { variable: "x", expression: { inequality: "x<0" } }],
  ["unfamiliar-adverb", "Show x<3 cautiously on a number line.", "number_line_set", { variable: "x", expression: { inequality: "x<3" } }],
  ["non-native-angle", "Find the angle between the lines x-y=0 and x+y=0.", "linear_system", { variables: ["x", "y"], equations: ["x-y=0", "x+y=0"] }],
  ["non-native-distance", "Find the distance between the parallel lines 3x+4y=7 and 3x+4y=12.", "linear_system", { variables: ["x", "y"], equations: ["3x+4y=7", "3x+4y=12"] }],
  ["unknown-named-system-modifier", "Graph L1: x+y=6 and L2: x-y=2 cautiously. The lines meet at P.", "linear_system", { variables: ["x", "y"], equations: ["x+y=6", "x-y=2"] }],
] as Array<[string, string, string, Record<string, unknown>]>) check(`unproved-source-defers-${id}`, () => {
  assert.equal(buildLinearSourceDocument(question), null);
  const result = compileSceneDocument(documentFor(question, operator, inputs));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.ok(!result.renderScene.primitives.some(primitive => primitive.provenance?.linearSourceNames), "Unproved requests supply no inferred source names");
});

const proseSystems = [
  ["Solve graphically: 2x + y = 7 and x - y = 2.", ["2x+y=7", "x-y=2"]],
  ["Solve: 2x + y = 7 and x - y = 2 graphically.", ["2x+y=7", "x-y=2"]],
  ["Draw the graphs of the pair of equations: x + y = 4 and x - y = 2.", ["x+y=4", "x-y=2"]],
  ["Explain a graphical system whose crossing has fractional coordinates: 2x + 3y = 7 and 3x - 2y = 1. Keep the intersection exact.", ["2x+3y=7", "3x-2y=1"]],
  ["Solve 2x + y = 7 and x - y = 2 graphically and mark the intersection clearly.", ["2x+y=7", "x-y=2"]],
  ["Solve graphically: x + y = 5 and x - y = 1.", ["x+y=5", "x-y=1"]],
  ["Plot this simultaneous pair: 2x+y=7 and x-y=2. Show the intersection accurately.", ["2x+y=7", "x-y=2"]],
  ["Use a graph to solve these equations: x+y=5 and x-y=1. Label the intersection neatly.", ["x+y=5", "x-y=1"]],
  ["Consider these lines: 2x+y=7 and x-y=2. Draw their point of intersection carefully.", ["2x+y=7", "x-y=2"]],
  ["Demonstrate the calculation: x+y=5 and x-y=1. Mark the intersection precisely.", ["x+y=5", "x-y=1"]],
  ["Show the line below: x+y=6 and x-y=2. Mark the intersection at once.", ["x+y=6", "x-y=2"]],
  ["Show the line above: x+y=6 and x-y=2. Mark the intersection at once.", ["x+y=6", "x-y=2"]],
  ["Sketch the line afterwards: x+y=6 and x-y=2. Show the intersection at once.", ["x+y=6", "x-y=2"]],
  ["Graph the line carefully: x+y=6 and x-y=2. Indicate the intersection at once.", ["x+y=6", "x-y=2"]],
] as Array<[string, string[]]>;
for (const [i, [question, equations]] of proseSystems.entries()) check(`prose-not-planner-names-${i + 1}`, () => {
  const result = compileSceneDocument(documentFor(question, "linear_system", { variables: ["x", "y"], equations }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.ok(!result.renderScene.primitives.some(primitive => primitive.provenance?.linearRole === "boundary_name"), "Ordinary prose must not name a line");
  assert.ok(result.renderScene.primitives.some(primitive => primitive.text === "One solution"));
  assert.ok(!result.renderScene.primitives.some(primitive => primitive.provenance?.linearSourceNames), "Ordinary prose must not name the intersection");
});
for (const [i, [question, equations]] of proseSystems.entries()) check(`prose-not-reader-names-${i + 1}`, () => {
  const document = buildLinearSourceDocument(question);
  if (!document) return; // Unproved request grammar may defer to the planner.
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.ok(!result.renderScene.primitives.some(primitive => primitive.provenance?.linearRole === "boundary_name"));
  assert.ok(result.renderScene.primitives.some(primitive => primitive.text === "One solution"), `${equations}: unique intersection summary missing`);
  assert.ok(!result.renderScene.primitives.some(primitive => primitive.provenance?.linearSourceNames));
});

for (const [i, question, lineNames, point] of [
  [1, "Graph L1: x+y=6 and L2: x-y=2. The lines meet at P.", ["L1", "L2"], "P"],
  [2, "Graph l: x+y=6 and m: x-y=2. Mark the intersection P.", ["l", "m"], "P"],
  [3, "Graph AB: x+y=6 and CD: x-y=2. The intersection is called Crossing.", ["AB", "CD"], "Crossing"],
  [4, "Graph line named Alpha: x+y=6 and line called Beta: x-y=2. The intersection is named Meet.", ["Alpha", "Beta"], "Meet"],
  [5, "Graph A: x+y=6 and B: x-y=2. The lines meet at P.", ["A", "B"], "P"],
  [6, "Graph l: x+y=6 and m: x-y=2. The lines meet at A.", ["l", "m"], "A"],
] as Array<[number, string, string[], string]>) check(`explicit-names-survive-${i}`, () => {
  const result = compileSceneDocument(documentFor(question, "linear_system", { variables: ["x", "y"], equations: ["x+y=6", "x-y=2"] }));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  for (const name of lineNames) assert.ok(result.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === name), `Missing ${name}`);
  assert.ok(result.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === point), `Missing ${point}`);
});

for (const [i, inequality] of ["x+y>=4", "x+y<4", "x+2y<=4", "x+y<=5"].entries()) check(`proved-wrong-inequality-${i + 1}`, () => {
  const result = compileSceneDocument(documentFor("Shade x+y<=4.", "linear_half_plane", { variables: ["x", "y"], inequality }));
  assert.ok(!result.ok && result.renderScene === null && result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
for (const [i, inequality, accepted] of [
  [1, "x+y>4", true], [2, "x+y>=4", false], [3, "x+y<=4", false], [4, "x+y<4", false],
] as Array<[number, string, boolean]>) check(`proved-negated-half-plane-${i}`, () => {
  const result = compileSceneDocument(documentFor("Shade the complement of x+y<=4.", "linear_half_plane", { variables: ["x", "y"], inequality }));
  assert.equal(Boolean(result.ok && result.renderScene), accepted, JSON.stringify(result.report.issues));
  if (!accepted) assert.ok(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
check("proved-planar-redundant-leaf-identity", () => {
  const result = compileSceneDocument(documentFor("Graph x<=1 and x<=2.", "linear_feasible_region", { variables: ["x", "y"], constraints: ["x<=1", "x<=3"] }));
  assert.ok(!result.ok && result.renderScene === null && result.report.issues.some(issue => issue.code === "linear_source_mismatch"), "An unchanged final region cannot authorize a changed source boundary");
});
check("unproved-declared-coordinate-role", () => {
  const question = "Find the point of intersection of the lines 2x+y=7 and x-y=2.";
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [],
    unknowns: [{ id: "intersection_x", symbol: "P_x" }], derived: [{ id: "intersection_x", symbol: "x", value: 3, provenance: "derived" }],
    qualitativeClaims: [], lawIds: [], assumptions: [] };
  assert.deepEqual(validateLinearSourcePlan(question, plan), []);
  plan.derived[0]!.value = 4;
  assert.ok(validateLinearSourcePlan(question, plan).some(issue => issue.code === "linear_source_plan_value_mismatch"), "An unknown alias never exempts a proved wrong numeric coordinate");
});
for (const reader of [false, true]) check(`default-view-facts-and-anchors-${reader ? "reader" : "planner"}`, () => {
  const question = "Solve graphically: x + y = 5 and x - y = 1.";
  const equations = ["x+y=5", "x-y=1"];
  const document = reader ? buildLinearSourceDocument(question) : documentFor(question, "linear_system", { variables: ["x", "y"], equations });
  assert.ok(document);
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const marks = result.renderScene.primitives;
  const points = (primitive: typeof marks[number]) => primitive.provenance!.worldPoints as ExactPoint[];
  for (const label of marks.filter(primitive => primitive.kind === "label")) assert.equal(label.provenance?.fontPx, 19);
  for (const equation of equations) {
    const row = parseLinearConstraint(equation, ["x", "y"], true)[0]!;
    const label = marks.find(primitive => primitive.provenance?.linearRole === "boundary_label" && primitive.text
      && linearConstraintSignature(parseLinearConstraint(primitive.text, ["x", "y"], true)[0]!) === linearConstraintSignature(row));
    assert.ok(label, `Original equation ${equation} must survive`);
    for (const point of points(label)) assert.equal(compareRational(addRational(
      multiplyRational(deserializeRational(row.a), deserializeRational(point.x)),
      multiplyRational(deserializeRational(row.b), deserializeRational(point.y))), deserializeRational(row.rhs)), 0);
  }
  const intersection = marks.find(primitive => primitive.provenance?.linearRole === "intersection_label");
  assert.equal(intersection?.text, "(3, 2)");
  assert.deepEqual(points(intersection!), [{ x: { numerator: "3", denominator: "1" }, y: { numerator: "2", denominator: "1" } }]);
  const origin = marks.find(primitive => primitive.provenance?.linearRole === "tick" && primitive.text === "0");
  assert.ok(origin);
  assert.deepEqual(points(origin), [{ x: { numerator: "0", denominator: "1" }, y: { numerator: "0", denominator: "1" } }]);
});
console.log(`Linear reader certainty: ${checks - failures.length}/${checks} passed; ${failures.length} failed`);
assert.equal(failures.length, 0, `Failed: ${failures.join(", ")}`);
