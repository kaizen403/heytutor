import assert from "node:assert/strict";
import { buildLinearSourceDocument, validateLinearSourceBinding } from "../../src/compile/linearRegionSource";
import { compileSceneDocument, type SceneDocument } from "../../src/index";

interface Refusal {
  group: string;
  question: string;
  operator: string;
  inputs: Record<string, unknown>;
  builderOnly?: boolean;
}

function candidate(test: Refusal): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Show the requested solution." },
    source: { question: test.question }, quantities: [],
    entities: [{ id: "solution", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "build", operator: test.operator, inputs: test.inputs, outputs: ["solution"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["solution"],
    revealGroups: [{ id: "view", entityIds: ["solution"], dependsOn: [], narrationCue: "Solution" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "view", dependsOn: [], narrationIntent: "Explain the source." }],
  };
}

const refusals: Refusal[] = [{
  group: "repeated-complement",
  question: "Represent the complement of the complement of x<0 on a number line.",
  operator: "number_line_set",
  inputs: { variable: "x", expression: { complement: { inequality: "x<0" } } },
}, {
  group: "multiple-requests",
  question: "Let A=[1,5] and B=[3,7]. Find A union B and A intersection B on a number line.",
  operator: "number_line_set",
  inputs: { variable: "x", expression: { intersection: [{ inequality: "x>=1" }, { inequality: "x<=5" }] } },
}, {
  group: "multiple-requests",
  question: "Let A=(-2,4] and B=[1,6). Represent A ∪ B and A ∩ B on the number line.",
  operator: "number_line_set",
  inputs: { variable: "x", expression: { intersection: [{ inequality: "x>-2" }, { inequality: "x<=4" }] } },
}, {
  group: "multiple-requests",
  question: "Represent each of the following on a number line: x>2; x<=-1.",
  operator: "number_line_set",
  inputs: { variable: "x", expression: { intersection: [{ inequality: "x>2" }, { inequality: "x<=-1" }] } },
}, {
  group: "multiple-requests",
  question: "Show x>=3 on a number line. Also show x<1 on a number line.",
  operator: "number_line_set",
  inputs: { variable: "x", expression: { intersection: [{ inequality: "x>=3" }, { inequality: "x<1" }] } },
}, {
  group: "multiple-requests",
  question: "Draw the graphs of 2x+y<=4 and x-y>1 on separate axes.",
  operator: "linear_feasible_region",
  inputs: { variables: ["x", "y"], constraints: ["2x+y<=4", "x-y>1"] },
}, {
  group: "multiple-request-variants",
  question: "Represent each of x>2 and x<=-1 on a number line.",
  operator: "number_line_set", inputs: { variable: "x", expression: { intersection: [{ inequality: "x>2" }, { inequality: "x<=-1" }] } },
}, {
  group: "multiple-request-variants",
  question: "Represent x>2 on a number line. x<=-1 on a number line.",
  operator: "number_line_set", inputs: { variable: "x", expression: { intersection: [{ inequality: "x>2" }, { inequality: "x<=-1" }] } },
}, {
  group: "implicit-planar-domain",
  question: "Shade the region x+y<=4 in the first quadrant.",
  operator: "linear_half_plane", inputs: { variables: ["x", "y"], inequality: "x+y<=4" },
}, {
  group: "implicit-planar-domain",
  question: "Maximise Z=3x+2y subject to x+y<=4, 2x-y>=-2 with non-negativity restrictions.",
  operator: "linear_feasible_region", inputs: { constraints: ["x+y<=4", "2x-y>=-2"], objective: { expression: "3x+2y", sense: "max" } },
}, ...["in N", "over Z", "in W"].map(domain => ({
  group: "discrete-domain",
  question: `Solve 2x-1<7 ${domain} and represent it on a number line.`,
  operator: "number_line_set", inputs: { variable: "x", expression: { inequality: "2x-1<7" } },
})), {
  group: "mixed-fraction",
  question: "Represent x>2 1/2 on a number line.",
  operator: "number_line_set", inputs: { variable: "x", expression: { inequality: "x>1" } },
}, {
  group: "mixed-fraction",
  question: "Represent x>2 \\frac{1}{2} on a number line.",
  operator: "number_line_set", inputs: { variable: "x", expression: { inequality: "x>1" } },
}, {
  group: "trailing-union-domain",
  question: "Represent on a number line: x<1 or x>3 where x>=0.",
  operator: "number_line_set", inputs: { variable: "x", expression: { union: [{ inequality: "x<1" }, { intersection: [{ inequality: "x>3" }, { inequality: "x>=0" }] }] } },
}, {
  group: "trailing-union-comma-domain",
  question: "Represent on a number line: x<1 or x>3, x>=0.",
  operator: "number_line_set", inputs: { variable: "x", expression: { union: [{ inequality: "x<1" }, { intersection: [{ inequality: "x>3" }, { inequality: "x>=0" }] }] } },
}, {
  group: "between-lines-strip",
  question: "Shade the region between the lines x+y=2 and x+y=5.",
  operator: "linear_system", inputs: { variables: ["x", "y"], equations: ["x+y=2", "x+y=5"] },
}, {
  group: "interval-minus",
  question: "Let A=[1,5] and B=[3,7]. Represent A minus B on a number line.",
  operator: "number_line_set", inputs: { variable: "x", expression: { intersection: [{ inequality: "x>=1" }, { inequality: "x<=5" }, { inequality: "x>=3" }, { inequality: "x<=7" }] } },
}, ...[
  "Find the angle between the lines x-y=0 and x+y=0.",
  "Find the distance between the parallel lines 3x+4y=7 and 3x+4y=12.",
  "Find the bisectors of the angles between the lines x+y-1=0 and x-y+1=0.",
  "Find the slopes of the lines x+y=2 and x-y=5.",
  "Find the intersection of y=2x+1 and y=-x+4, and the tangent of the acute angle between them.",
  "Find the reflection of the intersection of x+y=4 and x-y=2 in the origin.",
  "Find the area of the region x+y<=4, x>=0, y>=0.",
].map(question => ({
  group: "planner-owned-request", question,
  operator: "linear_system", inputs: { equations: ["x-y=0", "x+y=0"] }, builderOnly: true,
}))];

const selected = process.argv[2];
let checks = 0;
const failures: string[] = [];
for (const test of refusals.filter(test => !selected || test.group === selected)) {
  try {
    assert.equal(buildLinearSourceDocument(test.question), null, `Reader must decline ${test.group}: ${test.question}`);
    if (test.builderOnly) { checks++; continue; }
    assert.ok(validateLinearSourceBinding(candidate(test)).some(issue => issue.severity === "fatal"), `Raw linear candidates must not certify a partial source parse: ${test.question}`);
    const compiled = compileSceneDocument(candidate(test));
    assert.ok(!compiled.ok && compiled.renderScene === null, `Refusal must be atomic: ${test.question}`);
    checks += 3;
  } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
}
assert.equal(failures.length, 0, failures.join("\n"));
if (selected) assert.ok(checks > 0, `Unknown refusal group: ${selected}`);
else {
  for (const [question, operator] of [
    ["Represent x <= 3 on a number line.", "number_line_set"],
    ["Represent -2 < x <= 5 on a number line.", "number_line_set"],
    ["Represent x < -1 or x >= 2 on a number line.", "number_line_set"],
    ["Represent the complement of x<0 on a number line.", "number_line_set"],
    ["Let A=[1,5] and B=[3,7]. Represent A union B on a number line.", "number_line_set"],
    ["Shade 2x+3y<=12, x>=0, y>=0.", "linear_feasible_region"],
    ["Shade x+y>4.", "linear_half_plane"],
    ["Shade x+y>=2, x>=0, y>=0.", "linear_feasible_region"],
    ["Shade x+y<=2 and x+y>=5.", "linear_feasible_region"],
    ["Solve the pair 2x+y=7 and x-y=2 graphically.", "linear_system"],
    ["Find the point of intersection of the lines 2x+y=7 and x-y=2.", "linear_system"],
    ["Graph the system 3x=9 and x=-1.", "linear_system"],
    ["Maximise Z=3x+2y subject to x+y<=4, x>=0, y>=0.", "linear_feasible_region"],
    ["Real nonnegative variables x and y satisfy x+y<=8 and x+2y<=11. Profit is Z=2x+3y. Find the maximum profit.", "linear_feasible_region"],
    ["For real x,y>=0, graph the feasible region 2x+3y<=11 and 4x+y<=9. Maximise Z=5x+4y. Also mark A=(1,1) and classify feasibility.", "linear_feasible_region"],
  ]) {
    const document = buildLinearSourceDocument(question!);
    assert.ok(document, `Supported complete source must remain admitted: ${question}`);
    assert.equal(document.constructions[0]!.operator, operator);
    const compiled = compileSceneDocument(document);
    assert.ok(compiled.ok && compiled.renderScene, `${question}: ${JSON.stringify(compiled.report.issues)}`);
    checks += 3;
  }
}
console.log(`verify-linear-source-admission: ${checks} checks passed${selected ? ` (${selected})` : ""}`);
