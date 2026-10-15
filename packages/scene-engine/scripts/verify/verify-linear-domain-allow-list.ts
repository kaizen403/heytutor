import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { readLinearSourceSystemLabels, validateLinearSourceBinding } from "../../src/compile/linearRegionSource";
import { linearPointSatisfies, solveLinearFigure } from "../../src/math/linearRegion";

type Group = "membership" | "normalization" | "roster" | "hindi" | "alternate";
type Shape = "number_line_set" | "linear_half_plane" | "linear_feasible_region";
type Case = { id: string; group: Group; question: string; shape: Shape; origin: "review" | "generated" | "mutation"; objective?: boolean; inputs?: Record<string, unknown> };
const cases: Case[] = [];
function add(group: Group, id: string, question: string, shape: Shape = "number_line_set", objective = false): void {
  cases.push({ group, id, question, shape, objective, origin: "review" });
}

// Exact fifth-review wordings, including each explicitly named shorthand variant.
add("membership", "review-upper-in", "Graph 2x - 3 < 5 on a number line. x IN Z.");
add("membership", "review-mixed-in", "Graph 2x - 3 < 5 on a number line, x In Z.");
add("membership", "review-upper-belongs", "Graph 2x - 3 < 5 on a number line, x Belongs To Z.");
add("membership", "review-planar-upper", "Shade x + y < 4 for x, y IN Z.", "linear_half_plane");
add("normalization", "review-epsilon", "Solve 2x - 3 < 5, x ε Z, and represent it on a number line.");
add("normalization", "review-lunate-epsilon", "Solve 2x - 3 < 5 , x ϵ Z and represent it on a number line.");
add("normalization", "review-latex-epsilon", String.raw`Solve 2x - 3 < 5, x \epsilon Z, and represent it on a number line.`);
add("normalization", "review-latex-varepsilon", String.raw`Solve 2x - 3 < 5, x \varepsilon N, and represent it on a number line.`);
add("normalization", "review-cyrillic-membership", "Solve 2x - 3 < 5, x є N, and represent it on a number line.");
add("normalization", "review-small-membership", "Solve 2x - 3 < 5, x ∊ Z, and represent it on a number line.");
add("normalization", "review-integer-program", "Maximise Z = 3x + 2y subject to x + y <= 4, x >= 0, y >= 0, x, y ε N. Draw the feasible region.", "linear_feasible_region", true);
add("roster", "review-unicode-minus-roster", "Given x ∈ {−3, −2, −1, 0, 1, 2, 3, 4, 5}, solve 2x − 3 < 5 and represent the solution on a number line.");
add("roster", "review-en-dash-roster", "Solve 2x - 3 < 5 for x ∈ {–1, 0, 1} and represent it on a number line.");
add("roster", "review-leading-ellipsis-roster", "Given x ∈ {..., -2, -1, 0, 1, 2, ...}, solve 2x - 3 < 5 and represent it on a number line.");
add("roster", "review-unicode-ellipsis-roster", "Given x ∈ {…, −2, −1, 0, 1, 2, …}, solve 2x - 3 < 5 and represent it on a number line.");
add("roster", "review-spaced-ellipsis-roster", "Solve 2x - 3 < 5 for x ∈ {0, 1, 2, . . . } and represent it on a number line.");
add("roster", "review-latex-ldots-roster", String.raw`Solve 2x - 3 < 5 for x \in \{\ldots, -2, -1, 0, 1, 2, \ldots\} and represent it on a number line.`);
add("roster", "review-latex-dots-roster", String.raw`Solve 2x - 3 < 5 for x \in \{-3, -2, \dots, 5\} and represent it on a number line.`);
add("roster", "review-latex-cdots-roster", String.raw`Solve 2x - 3 < 5 for x \in \{\cdots, -2, -1, 0, 1, 2, \cdots\} and represent it on a number line.`);
add("roster", "review-planar-roster", "Shade x + y < 4 where x, y ∈ {−2, −1, 0, 1, 2}.", "linear_half_plane");
add("hindi", "review-hindi-poornank", "यदि x एक पूर्णांक है, तो 2x - 3 < 5 को संख्या रेखा पर दर्शाइए।");
add("hindi", "review-hindi-prakrit", "2x - 3 < 5 को हल कीजिए, जहाँ x एक प्राकृत संख्या है, और संख्या रेखा पर दिखाइए।");
add("hindi", "review-hindi-membership", "2x - 3 < 5, x ∈ पूर्णांक, संख्या रेखा पर दिखाइए।");
add("hindi", "review-hinglish-poornank", "Agar x ek poornank hai, to 2x - 3 < 5 ko number line par dikhaiye.");
add("hindi", "review-hinglish-purn", "x ek purn sankhya hai. 2x - 3 < 5 ko number line par represent karo.");
add("hindi", "review-hinglish-prakritik", "x prakritik sankhya hai, 2x - 3 < 5 ko number line par dikhao.");
add("hindi", "review-planar-hinglish", "Shade x + y < 4 where x and y are poornank.", "linear_half_plane");
add("alternate", "review-element", "Solve 2x - 3 < 5 where x is an element of Z, and show it on a number line.");
add("alternate", "review-member", "Solve 2x - 3 < 5 where x is a member of W, and show it on a number line.");
add("alternate", "review-belongs-set", "Solve 2x - 3 < 5, x belongs to the set Z, and show it on a number line.");
add("alternate", "review-replacement-is", "Solve 2x - 3 < 5 when the replacement set is N, and represent it on a number line.");
add("alternate", "review-replacement-as", "Taking the replacement set as Z, solve 2x - 3 < 5 and represent it on a number line.");
add("alternate", "review-domain", "Solve 2x - 3 < 5 with domain Z and show it on a number line.");
add("alternate", "review-domain-colon", "Solve 2x - 3 < 5 (domain: Z) and show it on a number line.");
add("alternate", "review-universe", "U = Z. Solve 2x - 3 < 5 and show it on a number line.");
for (const [name, notation] of [
  ["mathbf", String.raw`\mathbf{Z}`], ["mathrm", String.raw`\mathrm{Z}`],
  ["Bbb", String.raw`\Bbb Z`], ["command", String.raw`\Z`], ["fullwidth", "Ｚ"], ["bold", "𝐙"],
] as const) add("alternate", `review-set-notation-${name}`, `Solve 2x - 3 < 5, x \\in ${notation}, and show it on a number line.`);
// Keep the two literal Unicode review examples as well as the LaTeX companions.
add("normalization", "review-fullwidth-literal", "Solve 2x - 3 < 5, x ∈ Ｚ, and show it on a number line.");
add("normalization", "review-bold-literal", "Solve 2x - 3 < 5, x ∈ 𝐙, and show it on a number line.");

// Each witness isolates one production branch. In particular, unknown Q does
// not independently match an English discrete-word or known discrete-symbol check.
for (const [id, group, question] of [
  ["mutation-membership", "membership", "Graph 2x - 3 < 5 on a number line. x IN Q."],
  ["mutation-normalization", "normalization", "Graph 2x - 3 < 5 on a number line. x ε Q."],
  ["mutation-roster", "roster", "Graph 2x - 3 < 5 on a number line. Use values {..., -2, -1, 0, 1, ...}."],
  ["mutation-hindi", "hindi", "Graph 2x - 3 < 5 on a number line. x ek poornank hai."],
  ["mutation-alternate", "alternate", "Graph 2x - 3 < 5 on a number line (domain: Q)."],
] as const) cases.push({ id, group, question, shape: "number_line_set", origin: "mutation" });

const domainPhrases: Record<Group, readonly string[]> = {
  membership: ["{v} IN Q", "{v} In S", "{v} OVER K", "{v} Over W", "{v} BELONGS TO Q", "{v} Belongs To S", "{v} iN N", "{v} bElOnGs To K"],
  normalization: ["{v} ε Q", "{v} ϵ K", "{v} є S", "{v} ∊ W", String.raw`{v} \epsilon Q`, String.raw`{v} \varepsilon K`, "{v} ∈ 𝐐", "{v} ∈ Ｓ"],
  roster: ["Use values {…, −3, −1, 1, …}", "Use values {. . ., -4, 0, 4, . . .}", String.raw`Use values \{\ldots, -5, 0, 5, \ldots\}`, String.raw`Use values \{\dots, -6, 0, 6, \dots\}`, String.raw`Use values \{\cdots, -7, 0, 7, \cdots\}`, "Use values {–4; –2; 0; 2}", "Use values {1/2, 3/2, 5/2}", "Use values {..., 0, ...}"],
  hindi: ["{v} पूर्णांक हैं", "{v} पूर्ण संख्या हैं", "{v} प्राकृत संख्या हैं", "{v} प्राकृतिक संख्या हैं", "{v} purnank hai", "{v} poorn sankhya hai", "{v} prakrit sankhya hai", "{v} prakritik sankhya hai"],
  alternate: ["{v} is an element of Q", "{v} is a member of S", "replacement set = K", "replacement set as Q", "domain: S", "U = K", "{v} belongs to the set Q", String.raw`{v} \in \mathsf{Q}`],
};
const shapes: Shape[] = ["number_line_set", "linear_half_plane", "linear_feasible_region"];
for (const group of Object.keys(domainPhrases) as Group[]) for (const [i, phrase] of domainPhrases[group].entries()) for (const shape of shapes) {
  const v = shape === "number_line_set" ? "x" : "x, y";
  const request = shape === "number_line_set" ? "For the classroom exercise, graph 2x - 3 < 5 on a number line."
    : shape === "linear_half_plane" ? "For the classroom exercise, shade x + y < 4."
      : "For the classroom exercise, draw the feasible region x >= 0, y >= 0, x + y < 4.";
  cases.push({ id: `generated-${group}-${i}-${shape}`, group, shape, question: `${request} ${phrase.replaceAll("{v}", v)}.`, origin: "generated" });
}
// Real sets with extra restrictions are not the unrestricted continuous domain.
for (const target of ["R+", "R_0", "R except 0", "real numbers excluding 0", "R intersect Q", String.raw`R \setminus \{0\}`, "R with x != 1", "real numbers greater than 0", "R*", String.raw`R\Z`, "R∩N", "r", "R^2", "R²"]) {
  cases.push({ id: `restricted-real-${cases.length}`, group: "alternate", shape: "number_line_set", question: `Graph 2x - 3 < 5 on a number line. x ∈ ${target}.`, origin: "generated" });
}
cases.push({ id: "scalar-leading-plane-domain", group: "alternate", shape: "number_line_set", question: "In R^2, graph 2x - 3 < 5 on a number line.", origin: "generated" });
cases.push({ id: "restricted-real-comma", group: "alternate", shape: "number_line_set", question: "Graph 2x - 3 < 5 on a number line. x ∈ R, excluding 0.", origin: "generated" });
cases.push({ id: "restricted-real-semicolon", group: "alternate", shape: "number_line_set", question: "Graph 2x - 3 < 5 on a number line. x ∈ R; except 0.", origin: "generated" });
for (const [id, question] of [
  ["request-restriction-nonzero", "Graph 2x - 3 < 5 on a number line. x ∈ R. Graph only nonzero values."],
  ["request-restriction-excluding", "Graph 2x - 3 < 5 on a number line. x ∈ R. Draw the solution excluding 0."],
  ["request-restriction-neq", "Graph 2x - 3 < 5 on a number line. x ∈ R. Draw the solution with x != 0."],
  ["negated-membership", "Graph 2x - 3 < 5 on a number line. x ∉ Z."],
  ["negated-real-membership", "Graph 2x - 3 < 5 on a number line. x ∉ R."],
  ["negated-real-notin-command", String.raw`Graph 2x - 3 < 5 on a number line. x \notin R.`],
  ["negated-real-split-latex", String.raw`Graph 2x - 3 < 5 on a number line. x \not\in R.`],
  ["negated-real-not-word", "Graph 2x - 3 < 5 on a number line. x not in R."],
  ["real-tail-complement", "Graph 2x - 3 < 5 on a number line. x ∈ R. Draw the complement of the solution."],
  ["over-affine-suffix-unbound", "Graph 2x - 3 < 5 on a number line over x > 0."],
  ["real-tail-boundary-only", "Graph 2x - 3 < 5 on a number line. x ∈ R. Draw only the boundary of the solution."],
] as const) cases.push({ id, group: "alternate", shape: "number_line_set", question, origin: "generated" });
for (const [id, question] of [
  ["plural-elements", "Shade x + y < 4. x and y ARE ELEMENTS OF Z."],
  ["plural-members", "Shade x + y < 4. x and y ARE MEMBERS OF N."],
  ["plural-members-W", "Shade x + y < 4. x and y are members of W."],
] as const) cases.push({ id, group: "alternate", shape: "linear_half_plane", question, origin: "generated" });
cases.push({ id: "real-header-unsupported-emdash", group: "alternate", shape: "linear_half_plane", question: "x,y∈R. Graph x+y<=6—1.", origin: "generated", inputs: { variables: ["x", "y"], inequality: "x+y<=6-1" } });
assert(cases.filter(item => item.origin === "generated").length >= 120);
assert.equal(new Set(cases.map(item => item.question)).size, cases.length, "Each added question must be distinct");

function candidate(question: string, shape: Shape, objective = false, inequality = "2x-3<5"): SceneDocument {
  const inputs = shape === "number_line_set" ? { variable: "x", expression: { inequality } }
    : shape === "linear_half_plane" ? { variables: ["x", "y"], inequality: "x+y<4" }
      : { variables: ["x", "y"], constraints: objective ? ["x+y<=4", "x>=0", "y>=0"] : ["x>=0", "y>=0", "x+y<4"], ...(objective ? { objective: { expression: "3x+2y", sense: "max" } } : {}) };
  return { schemaVersion: "scene-document/v2", source: { question }, quantities: [],
    visualDecision: { mode: "scene", reason: "Show the supplied continuous solution." },
    entities: [{ id: "result", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct", operator: shape, inputs, outputs: ["result"] }],
    assertions: [], relations: [], annotations: [], requiredEntityIds: ["result"],
    revealGroups: [{ id: "setup", entityIds: ["result"], dependsOn: [], narrationCue: "Read the solution." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Read the solution." }] };
}

const selectorIndex = process.argv.indexOf("--case");
const selectedId = selectorIndex >= 0 ? process.argv[selectorIndex + 1] : undefined;
const resourceInnerId = "urgent-rational-resource-inner";
const resourceReadyMarker = "H3_LINEAR_RESOURCE_NATIVE_READY";
const typedProofIds = ["typed-first-quadrant", "typed-interval-difference", "urgent-continuous", "urgent-system-real", "urgent-quadrant-complement", "urgent-rational-domain", "urgent-quadrant-I", "urgent-quadrant-scope", "urgent-rational-variable-names", "urgent-continuous-property", "urgent-number-line-duplicates", "urgent-real-domain-complement", "urgent-rational-resource", "urgent-coefficient-subject", "urgent-rational-takes", "urgent-rational-joint-subject", "urgent-universe-symbol-role", resourceInnerId];
if (selectorIndex >= 0) assert(selectedId && (cases.some(item => item.id === selectedId) || typedProofIds.includes(selectedId)), "--case must name an existing case or typed proof group");
const selected = selectedId ? cases.filter(item => item.id === selectedId) : cases;
let checks = 0;
const failures: string[] = [];
function check(name: string, work: () => void): void {
  checks++;
  try { work(); } catch (error) { failures.push(`${name}: ${String(error)}`); }
}
for (const item of selected) {
  check(`${item.id}: reader declines`, () => assert.equal(buildLinearSourceDocument(item.question), null));
  check(`${item.id}: independent planner veto`, () => {
    const document = candidate(item.question, item.shape, item.objective);
    if (item.inputs) document.constructions[0]!.inputs = item.inputs;
    const before = structuredClone(document);
    const issues = validateLinearSourceBinding(document);
    const result = compileSceneDocument(document);
    assert(issues.some(issue => issue.code === "linear_source_mismatch"), `${item.question} compiled=${result.ok} rendered=${result.renderScene !== null}`);
    assert(!result.ok && result.renderScene === null, item.question);
    assert(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
    assert.deepEqual(document, before);
  });
}

// Positive companions exercise the same real-domain boundary and the actual
// compiler. They prevent a trivial reject-all repair from satisfying this gate.
const controls: { id: string; question: string; shape: Shape; inequality?: string; reader?: boolean; objective?: boolean; inputs?: Record<string, unknown> }[] = [
  { id: "ordinary-real", question: "Graph 2x - 3 < 5 on a number line for real x.", shape: "number_line_set", reader: true },
  { id: "uppercase-real", question: "Graph 2x - 3 < 5 on a number line. x IN R.", shape: "number_line_set" },
  { id: "epsilon-real", question: "Graph 2x - 3 < 5 on a number line. x ε R.", shape: "number_line_set" },
  { id: "unicode-real", question: "Graph 2x - 3 < 5 on a number line. x ∈ ℝ.", shape: "number_line_set" },
  { id: "fullwidth-real", question: "Graph 2x - 3 < 5 on a number line. x ∈ Ｒ.", shape: "number_line_set" },
  { id: "bold-real", question: "Graph 2x - 3 < 5 on a number line. x ∈ 𝐑.", shape: "number_line_set" },
  { id: "latex-real", question: String.raw`Graph 2x - 3 < 5 on a number line, x \in \mathbb{R}.`, shape: "number_line_set" },
  { id: "belongs-real", question: "Graph 2x - 3 < 5 on a number line. x Belongs To R.", shape: "number_line_set" },
  { id: "element-real", question: "Graph 2x - 3 < 5 on a number line. x is an element of R.", shape: "number_line_set" },
  { id: "member-real", question: "Graph 2x - 3 < 5 on a number line. x is a member of the real numbers.", shape: "number_line_set" },
  { id: "replacement-real", question: "Graph 2x - 3 < 5 on a number line. The replacement set is R.", shape: "number_line_set" },
  { id: "domain-real", question: "Graph 2x - 3 < 5 on a number line (domain: R).", shape: "number_line_set" },
  { id: "universe-real", question: "U = R. Graph 2x - 3 < 5 on a number line.", shape: "number_line_set" },
  { id: "integer-coefficients", question: "Graph 2x - 3 < 5 on a number line with integer coefficients.", shape: "number_line_set", reader: true },
  { id: "coefficient-declaration", question: "The coefficients are integers. Graph 2x - 3 < 5 on a number line for real x.", shape: "number_line_set" },
  { id: "ordinary-fraction", question: "Graph x < 1/2 on a number line for real x.", shape: "number_line_set", inequality: "x<1/2", reader: true },
  { id: "latex-fraction", question: String.raw`Graph x < \frac{1}{2} on a number line for real x.`, shape: "number_line_set", inequality: "x<1/2", reader: true },
  { id: "latex-negative-fraction", question: String.raw`Graph x < \frac{-3}{2} on a number line for real x.`, shape: "number_line_set", inequality: "x<-3/2", reader: true },
  { id: "fraction-coefficient", question: String.raw`Graph \frac{1}{2}x < 2 on a number line for real x.`, shape: "number_line_set", inequality: "1/2x<2", reader: true },
  { id: "fraction-valued-real", question: "Graph 2x - 3 < 5 on a number line. x can be a fraction.", shape: "number_line_set" },
  { id: "coordinate-plane", question: "Shade x + y < 4 in the coordinate plane.", shape: "linear_half_plane", reader: true },
  { id: "real-plane", question: "In R^2, shade x + y < 4.", shape: "linear_half_plane" },
  { id: "planar-real", question: "Shade x + y < 4 for x, y IN R.", shape: "linear_half_plane" },
  { id: "feasible-real", question: "Draw the feasible region x >= 0, y >= 0, x + y < 4 for x, y ∈ R.", shape: "linear_feasible_region" },
  { id: "objective-real", question: "Maximise Z = 3x + 2y subject to x + y <= 4, x >= 0, y >= 0, x, y ε R. Draw the feasible region.", shape: "linear_feasible_region", objective: true },
  { id: "intersection-coordinate-plane", question: "Graph the intersection of x >= -3 and y >= 4 in the coordinate plane.", shape: "linear_feasible_region", inputs: { variables: ["x", "y"], constraints: ["x>=-3", "y>=4"] }, reader: true },
  { id: "point-membership-request", question: "Graph 3x-y>5. Mark A=(2,1) and B=(0,0). State which points belong to the half-plane.", shape: "linear_half_plane", inputs: { variables: ["x", "y"], inequality: "3x-y>5" }, reader: true },
  { id: "plural-members-real", question: "Shade x + y < 4. x, y are members of the real numbers.", shape: "linear_half_plane" },
  { id: "recorded-tuple-query", question: "Graph x + 2y < 6. On the same graph, indicate whether P = (1, 1) is in the solution region.", shape: "linear_half_plane", inputs: { variables: ["x", "y"], inequality: "x+2y<6" }, reader: true },
  { id: "recorded-boundary-points-query", question: "Graph the set of all real ordered pairs satisfying -4x < 2. State whether points on the boundary belong to it.", shape: "linear_half_plane", inputs: { variables: ["x", "y"], inequality: "-4x<2" }, reader: true },
  { id: "recorded-boundary-query", question: "For real x and y, graph -2(2x - y) >= 3y - 9. Label the boundary and both intercepts; shade the solution half-plane. Mark P = (1,4), Q = (2,2), and R = (2,1), then classify their membership. Show whether the boundary belongs to the set.", shape: "linear_half_plane", inputs: { variables: ["x", "y"], inequality: "-2(2x-y)>=3y-9" }, reader: true },
];
if (!selectedId) for (const item of controls) check(`continuous ${item.id}: draws without source mutation`, () => {
  const document = candidate(item.question, item.shape, item.objective, item.inequality);
  if (item.inputs) document.constructions[0]!.inputs = item.inputs;
  const before = structuredClone(document);
  assert.deepEqual(validateLinearSourceBinding(document), [], item.question);
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene !== null, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
  if (item.reader) {
    const built = buildLinearSourceDocument(item.question);
    assert(built && compileSceneDocument(built).ok, `Reader control: ${item.question}`);
  }
});
let typedChecks = 0;
function typedCheck(group: string, name: string, work: () => void): void {
  if (selectedId && selectedId !== group) return;
  typedChecks++;
  check(`${group}: ${name}`, work);
}
function expectTypedAccepted(document: SceneDocument): void {
  const before = structuredClone(document), issues = validateLinearSourceBinding(document), result = compileSceneDocument(document);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert(result.ok && result.renderScene !== null, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
  const built = buildLinearSourceDocument(document.source.question!);
  assert(built && compileSceneDocument(built).ok, `Complete reader proof: ${document.source.question}`);
}
function expectTypedRejected(document: SceneDocument, readerMustDecline = false): void {
  const before = structuredClone(document), issues = validateLinearSourceBinding(document), result = compileSceneDocument(document);
  assert(issues.some(issue => issue.code === "linear_source_mismatch"), `${document.source.question} compiled=${result.ok} rendered=${result.renderScene !== null}`);
  assert(!result.ok && result.renderScene === null);
  assert.deepEqual(document, before);
  if (readerMustDecline) assert.equal(buildLinearSourceDocument(document.source.question!), null);
}
const quadrantQuestion = "Shade x+y<=4 in the first quadrant.";
typedCheck("typed-first-quadrant", "source qualifier proves both axis restrictions", () => {
  const document = candidate(quadrantQuestion, "linear_feasible_region");
  document.constructions[0]!.inputs = { variables: ["x", "y"], constraints: ["x+y<=4", "x>=0", "y>=0"] };
  expectTypedAccepted(document);
});
typedCheck("typed-first-quadrant", "half-plane cannot omit the source quadrant", () => {
  const document = candidate(quadrantQuestion, "linear_half_plane");
  document.constructions[0]!.inputs = { variables: ["x", "y"], inequality: "x+y<=4" };
  expectTypedRejected(document);
});
typedCheck("typed-first-quadrant", "unsupported other quadrant is not guessed", () => {
  const document = candidate("Shade x+y<=4 in the second quadrant.", "linear_feasible_region");
  document.constructions[0]!.inputs = { variables: ["x", "y"], constraints: ["x+y<=4", "x>=0", "y>=0"] };
  expectTypedRejected(document, true);
});

const differenceQuestion = "Let A=[0,4] and B=[1,2]. Plot the elements in A but outside B on a number line.";
const intervalA = { intersection: [{ inequality: "x>=0" }, { inequality: "x<=4" }] };
const intervalB = { intersection: [{ inequality: "x>=1" }, { inequality: "x<=2" }] };
const difference = { intersection: [intervalA, { complement: intervalB }] };
function differenceDocument(question: string, expression: unknown): SceneDocument {
  const document = candidate(question, "number_line_set");
  document.constructions[0]!.inputs = { variable: "x", expression };
  return document;
}
typedCheck("typed-interval-difference", "literal interval bindings prove intersection with complement", () => {
  expectTypedAccepted(differenceDocument(differenceQuestion, difference));
});
for (const [name, expression] of [
  ["cannot omit the exclusion interval", intervalA],
  ["union does not replace the requested difference", { union: [intervalA, intervalB] }],
  ["closed lower exclusion endpoint remains excluded", { intersection: [intervalA, { complement: { intersection: [{ inequality: "x>1" }, { inequality: "x<=2" }] } }] }],
  ["closed upper exclusion endpoint remains excluded", { intersection: [intervalA, { complement: { intersection: [{ inequality: "x>=1" }, { inequality: "x<2" }] } }] }],
] as const) typedCheck("typed-interval-difference", name, () => expectTypedRejected(differenceDocument(differenceQuestion, expression)));
for (const question of [
  "Plot the elements in A but outside B on a number line.",
  "Let A=[0,4]. Plot the elements in A but outside B on a number line.",
  "Let B=[1,2]. Plot the elements in A but outside B on a number line.",
]) typedCheck("typed-interval-difference", `unknown interval binding declines: ${question}`, () => expectTypedRejected(differenceDocument(question, difference), true));

// Preserve the original442 checks above. These regressions independently test
// the reader, exact candidate authority and rendered system-label ownership.
const continuousQuestion = "Graph x<4 on a number line. The domain is continuous.";
typedCheck("urgent-continuous", "explicit continuous domain accepts the correct ray through reader and planner", () => {
  expectTypedAccepted(candidate(continuousQuestion, "number_line_set", false, "x<4"));
});
typedCheck("urgent-continuous", "a continuous domain does not change the ray boundary", () => {
  expectTypedRejected(candidate(continuousQuestion, "number_line_set", false, "x<=4"));
});
for (const question of [
  "Graph x<4 on a number line. The domain is not continuous.",
  "Graph x<4 on a number line. The domain is continuous and integer.",
  "Graph x<4 on a number line. The domain is continuous. x IN Z.",
  "Graph x<4 on a number line. The domain is continuous. x not in R.",
]) typedCheck("urgent-continuous", `negated or mixed domain remains denied: ${question}`, () => {
  expectTypedRejected(candidate(question, "number_line_set", false, "x<4"), true);
});

function systemDocument(question: string, equations = ["x+y=6", "x-y=2"]): SceneDocument {
  const document = candidate(question, "linear_feasible_region");
  document.constructions[0]!.operator = "linear_system";
  document.constructions[0]!.inputs = { variables: ["x", "y"], equations };
  return document;
}
const systemRealQuestion = "Graph x+y=6 and x-y=2. x IN R.";
typedCheck("urgent-system-real", "real membership accepts the exact two-line system through reader and planner", () => {
  expectTypedAccepted(systemDocument(systemRealQuestion));
});
typedCheck("urgent-system-real", "real membership prose owns no line or intersection label", () => {
  const labels = readLinearSourceSystemLabels(systemRealQuestion, { kind: "linear_system", variables: ["x", "y"], equations: ["x+y=6", "x-y=2"] });
  assert.deepEqual(labels, { lines: [{ names: [], interceptAxes: [] }, { names: [], interceptAxes: [] }] });
  const result = compileSceneDocument(systemDocument(systemRealQuestion));
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert(!result.renderScene.primitives.some(primitive => primitive.kind === "label" && /\b(?:IN|domain)\b|^R$/i.test(primitive.text ?? "")), "membership prose must never become diagram ink");
});
typedCheck("urgent-system-real", "domain normalization does not alter either source equation", () => {
  expectTypedRejected(systemDocument(systemRealQuestion, ["x+y=6", "x-y=3"]));
});
for (const question of [
  "Graph x+y=6 and x-y=2. x in R.",
  "Graph x+y=6 and x-y=2. x ∈ ℝ.",
  "Graph x+y=6 and x-y=2. x IN R. y IN R.",
]) typedCheck("urgent-system-real", `equivalent real-domain syntax remains accepted: ${question}`, () => expectTypedAccepted(systemDocument(question)));
for (const question of [
  "Graph x+y=6 and x-y=2. x IN Z.",
  "Graph x+y=6 and x-y=2. x NOT IN R.",
  "Graph x+y=6 and x-y=2. x IN R. y IN Z.",
]) typedCheck("urgent-system-real", `integer or negated domain remains denied: ${question}`, () => expectTypedRejected(systemDocument(question), true));

const complementQuadrantQuestion = "Shade the complement of x+y<=4 in the first quadrant.";
function quadrantComplementDocument(question: string, constraints = ["x+y>4", "x>=0", "y>=0"]): SceneDocument {
  const document = candidate(question, "linear_feasible_region");
  document.constructions[0]!.inputs = { variables: ["x", "y"], constraints };
  return document;
}
typedCheck("urgent-quadrant-complement", "the correct planner complements the half-plane within the source quadrant", () => {
  const document = quadrantComplementDocument(complementQuadrantQuestion), before = structuredClone(document);
  assert.deepEqual(validateLinearSourceBinding(document), []);
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
});
typedCheck("urgent-quadrant-complement", "the reader either declines or proves the quadrant stays outside the complement", () => {
  const built = buildLinearSourceDocument(complementQuadrantQuestion);
  if (!built) return;
  const result = compileSceneDocument(built);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const construction = built.constructions.find(item => item.operator === "linear_feasible_region");
  assert(construction, "this convex source result requires one proved feasible intersection");
  const constraints = construction.inputs.constraints;
  assert(Array.isArray(constraints) && constraints.every(value => typeof value === "string"));
  const solution = solveLinearFigure({ kind: "linear_feasible_region", variables: ["x", "y"], constraints });
  assert.equal(solution.kind, "linear_feasible_region");
  if (solution.kind !== "linear_feasible_region") return;
  for (const [x, y, included] of [[3, 3, true], [0, 5, true], [5, 0, true], [4, 0, false], [1, 1, false], [-1, 6, false], [6, -1, false], [-1, -1, false]] as const) {
    assert.equal(linearPointSatisfies(solution.constraints, { x: { numerator: String(x), denominator: "1" }, y: { numerator: String(y), denominator: "1" } }), included, `source membership at (${x},${y})`);
  }
});
for (const [name, constraints] of [
  ["cannot complement the quadrant as well", ["x+y>4"]],
  ["cannot include negative x", ["x+y>4", "y>=0"]],
  ["cannot include negative y", ["x+y>4", "x>=0"]],
  ["cannot include the original closed boundary", ["x+y>=4", "x>=0", "y>=0"]],
  ["cannot omit the requested complement", ["x+y<=4", "x>=0", "y>=0"]],
  ["the quadrant includes its positive axes", ["x+y>4", "x>0", "y>0"]],
] as const) typedCheck("urgent-quadrant-complement", name, () => expectTypedRejected(quadrantComplementDocument(complementQuadrantQuestion, [...constraints])));
for (const question of [
  "Shade the complement of x+y<=4 in the first quadrant. x, y IN Z.",
  "Shade the complement of x+y<=4 in the first quadrant. x IN R. y IN Z.",
  "Shade the complement of x+y<=4 in the first quadrant. x not in R.",
]) typedCheck("urgent-quadrant-complement", `source quadrant never erases a discrete or negated domain: ${question}`, () => expectTypedRejected(quadrantComplementDocument(question), true));

for (const domain of ["rational", "irrational"]) for (const lane of ["number-line", "half-plane", "system"] as const) {
  const question = lane === "number-line" ? `Graph x<4 on a number line. x is ${domain}.`
    : lane === "half-plane" ? `Shade x+y<4. x is ${domain}.`
      : `Graph x+y=6 and x-y=2. x is ${domain}.`;
  typedCheck("urgent-rational-domain", `${lane} reader refuses plain ${domain} variable domain`, () => assert.equal(buildLinearSourceDocument(question), null));
  typedCheck("urgent-rational-domain", `${lane} planner cannot erase plain ${domain} variable domain`, () => {
    const document = lane === "system" ? systemDocument(question)
      : candidate(question, lane === "number-line" ? "number_line_set" : "linear_half_plane", false, "x<4");
    expectTypedRejected(document);
  });
}
typedCheck("urgent-rational-domain", "rational coefficients do not restrict the real variable domain", () => {
  const question = "Graph x<4 on a number line with rational coefficients for real x.";
  expectTypedAccepted(candidate(question, "number_line_set", false, "x<4"));
});
typedCheck("urgent-rational-domain", "an actual rational coefficient retains its exact real half-plane", () => {
  const question = "Shade (1/2)x+y<4 for real x and y.";
  const document = candidate(question, "linear_half_plane");
  document.constructions[0]!.inputs = { variables: ["x", "y"], inequality: "(1/2)x+y<4" };
  expectTypedAccepted(document);
});

const quadrantIQuestion = "Shade x+y<=4 within quadrant I.";
typedCheck("urgent-quadrant-I", "the explicit Roman-numeral qualifier proves the first quadrant", () => {
  expectTypedAccepted(quadrantComplementDocument(quadrantIQuestion, ["x+y<=4", "x>=0", "y>=0"]));
});
for (const [name, constraints] of [
  ["cannot omit both quadrant axes", ["x+y<=4"]],
  ["cannot flip the x axis domain", ["x+y<=4", "x<=0", "y>=0"]],
  ["cannot flip the y axis domain", ["x+y<=4", "x>=0", "y<=0"]],
  ["cannot replace the source quadrant with its opposite", ["x+y<=4", "x<=0", "y<=0"]],
] as const) typedCheck("urgent-quadrant-I", name, () => expectTypedRejected(quadrantComplementDocument(quadrantIQuestion, [...constraints])));
typedCheck("urgent-quadrant-I", "a Roman-numeral qualifier keeps the quadrant outside a preceding complement", () => {
  expectTypedAccepted(quadrantComplementDocument("Shade the complement of x+y<=4 within quadrant I."));
});
typedCheck("urgent-quadrant-I", "a Roman-numeral qualifier cannot be omitted from the complemented result", () => {
  expectTypedRejected(quadrantComplementDocument("Shade the complement of x+y<=4 within quadrant I.", ["x+y>4"]));
});

const globalParenthesizedQuadrant = "Shade the complement of (x+y<=4) in the first quadrant.";
typedCheck("urgent-quadrant-scope", "a global postfix quadrant remains outside the parenthesized complement", () => {
  expectTypedAccepted(quadrantComplementDocument(globalParenthesizedQuadrant));
});
for (const [name, constraints] of [
  ["opposite inequality", ["x+y<=4", "x>=0", "y>=0"]],
  ["flipped axes", ["x+y>4", "x<0", "y<0"]],
] as const) typedCheck("urgent-quadrant-scope", `global postfix rejects ${name}`, () => {
  expectTypedRejected(quadrantComplementDocument(globalParenthesizedQuadrant, [...constraints]));
});
for (const question of [
  "Shade the complement of (x+y<=4 in the first quadrant).",
  "Shade the complement of (x+y<=4 and x>=0 and y>=0).",
]) {
  for (const [name, constraints] of [
    ["the convex global-postfix result", ["x+y>4", "x>=0", "y>=0"]],
    ["the uncomplemented conjunction", ["x+y<=4", "x>=0", "y>=0"]],
    ["an opposite-quadrant intersection", ["x+y>4", "x<0", "y<0"]],
  ] as const) typedCheck("urgent-quadrant-scope", `an internal qualifier cannot become ${name}: ${question}`, () => {
    expectTypedRejected(quadrantComplementDocument(question, [...constraints]));
  });
}

for (const domain of ["rational", "irrational"]) for (const lane of ["number-line", "half-plane", "system"] as const) {
  const question = lane === "number-line" ? `Graph t<4 on a number line. t is ${domain}.`
    : lane === "half-plane" ? `Shade u+v<4. u is ${domain}.`
      : `Graph u+v=6 and u-v=2. v is ${domain}.`;
  typedCheck("urgent-rational-variable-names", `${lane} native variable names cannot erase ${domain} predicates`, () => {
    const document = lane === "system" ? systemDocument(question, ["u+v=6", "u-v=2"])
      : candidate(question, lane === "number-line" ? "number_line_set" : "linear_half_plane");
    document.constructions[0]!.inputs = lane === "number-line" ? { variable: "t", expression: { inequality: "t<4" } }
      : lane === "half-plane" ? { variables: ["u", "v"], inequality: "u+v<4" }
        : { variables: ["u", "v"], equations: ["u+v=6", "u-v=2"] };
    expectTypedRejected(document, true);
  });
}
typedCheck("urgent-rational-variable-names", "rational coefficients remain safe with a native scalar variable", () => {
  const question = "Graph t<4 on a number line with rational coefficients for real t.";
  const document = candidate(question, "number_line_set");
  document.constructions[0]!.inputs = { variable: "t", expression: { inequality: "t<4" } };
  const before = structuredClone(document);
  assert.deepEqual(validateLinearSourceBinding(document), []);
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
});
typedCheck("urgent-rational-variable-names", "native real-domain system keeps exact variables and owns no prose labels", () => {
  const question = "Graph u+v=6 and u-v=2. u ∈ R and v ∈ R.";
  const document = systemDocument(question, ["u+v=6", "u-v=2"]);
  document.constructions[0]!.inputs = { variables: ["u", "v"], equations: ["u+v=6", "u-v=2"] };
  const before = structuredClone(document);
  assert.deepEqual(validateLinearSourceBinding(document), []);
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
  assert.deepEqual(readLinearSourceSystemLabels(question, { kind: "linear_system", variables: ["u", "v"], equations: ["u+v=6", "u-v=2"] }), { lines: [{ names: [], interceptAxes: [] }, { names: [], interceptAxes: [] }] });
  assert(!result.renderScene.primitives.some(primitive => primitive.kind === "label" && /∈|^R$/.test(primitive.text ?? "")), "real-domain declarations must not become system labels");
});
typedCheck("urgent-rational-variable-names", "native real-domain normalization cannot change an equation", () => {
  const document = systemDocument("Graph u+v=6 and u-v=2. u ∈ R and v ∈ R.", ["u+v=6", "u-v=3"]);
  document.constructions[0]!.inputs = { variables: ["u", "v"], equations: ["u+v=6", "u-v=3"] };
  expectTypedRejected(document);
});
typedCheck("urgent-rational-variable-names", "a mixed scalar subject list retains its native rational restriction", () => {
  expectTypedRejected(candidate("Graph x<4 on a number line. x and z are rational.", "number_line_set", false, "x<4"), true);
});
typedCheck("urgent-rational-variable-names", "a mixed planar subject list retains both native rational restrictions", () => {
  const document = systemDocument("Graph u+v=6 and u-v=2. u,v,w are rational.", ["u+v=6", "u-v=2"]);
  document.constructions[0]!.inputs = { variables: ["u", "v"], equations: ["u+v=6", "u-v=2"] };
  expectTypedRejected(document, true);
});

function propertyDocument(question: string, lane: "number-line" | "half-plane" | "system", native = false): SceneDocument {
  const first = native ? lane === "number-line" ? "t" : "u" : "x", second = native ? "v" : "y";
  const document = lane === "system" ? systemDocument(question) : candidate(question, lane === "number-line" ? "number_line_set" : "linear_half_plane");
  document.constructions[0]!.inputs = lane === "number-line" ? { variable: first, expression: { inequality: `${first}<4` } }
    : lane === "half-plane" ? { variables: [first, second], inequality: `${first}+${second}<4` }
      : { variables: [first, second], equations: [`${first}+${second}=6`, `${first}-${second}=2`] };
  return document;
}
const propertyRequests = [
  ["number-line", "Graph x<4 on a number line."],
  ["half-plane", "Shade x+y<4."],
  ["system", "Graph x+y=6 and x-y=2."],
] as const;
for (const [lane, request] of propertyRequests) {
  typedCheck("urgent-continuous-property", `${lane} typed continuous property accepts the actual real source`, () => {
    expectTypedAccepted(propertyDocument(`${request} x has a continuous domain.`, lane));
  });
  for (const [name, declaration] of [
    ["mixed integer membership", "x has a continuous domain. x IN Z."],
    ["excluding-zero qualification", "x has a continuous domain excluding 0."],
    ["unknown named domain qualification", "x has a continuous domain called S."],
  ] as const) typedCheck("urgent-continuous-property", `${lane} property cannot erase ${name}`, () => {
    expectTypedRejected(propertyDocument(`${request} ${declaration}`, lane), true);
  });
}
for (const [lane, question] of [
  ["number-line", "Graph t<4 on a number line. t has a continuous domain."],
  ["system", "Graph u+v=6 and u-v=2. u and v have a continuous domain."],
] as const) typedCheck("urgent-continuous-property", `${lane} property uses the actual native variable names`, () => {
  const document = propertyDocument(question, lane, true), before = structuredClone(document);
  assert.deepEqual(validateLinearSourceBinding(document), []);
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
  assert(!result.renderScene.primitives.some(primitive => primitive.kind === "label" && /\b(?:has|have|continuous|domain)\b/i.test(primitive.text ?? "")), "typed domain prose must not become labels");
});
for (const question of [
  "Graph t<4 on a number line. t has a continuous domain. t IN Z.",
  "Graph t<4 on a number line. t has a continuous domain excluding 0.",
]) typedCheck("urgent-continuous-property", `native variable property preserves the full restriction: ${question}`, () => {
  expectTypedRejected(propertyDocument(question, "number-line", true), true);
});

for (const question of [
  "Graph x>=0 on a number line. x∈R,x>=0.",
  "Graph x>=0 on a number line. x∈ℝ,x>=0.",
  "Graph x>=0 on a number line. x∈R,2x>=0.",
]) typedCheck("urgent-number-line-duplicates", `an equivalent repeated source bound does not change the ray: ${question}`, () => {
  expectTypedAccepted(candidate(question, "number_line_set", false, "x>=0"));
});
typedCheck("urgent-number-line-duplicates", "a distinct extra bound remains a required source constraint", () => {
  expectTypedRejected(candidate("Graph x>=0 on a number line. x∈R,x<=4.", "number_line_set", false, "x>=0"));
});
typedCheck("urgent-number-line-duplicates", "equal canonical leaf sets do not equate union with intersection", () => {
  const question = "Graph x>=0 and x<=4 on a number line. x∈R,x>=0.";
  const document = candidate(question, "number_line_set");
  document.constructions[0]!.inputs = { variable: "x", expression: { union: [{ inequality: "x>=0" }, { inequality: "x<=4" }] } };
  expectTypedRejected(document);
});
typedCheck("urgent-number-line-duplicates", "two-equation systems cannot omit an additional source domain constraint", () => {
  expectTypedRejected(systemDocument("Graph x+y=6 and x-y=2. x∈R,x>=0."), true);
});

const scopedRealDomainQuestion = "Graph the complement of x<4 on a number line. x∈R with x>=0.";
typedCheck("urgent-real-domain-complement", "a later typed domain restricts the completed number-line complement", () => {
  expectTypedAccepted(differenceDocument(scopedRealDomainQuestion, { intersection: [{ complement: { inequality: "x<4" } }, { inequality: "x>=0" }] }));
});
typedCheck("urgent-real-domain-complement", "canonical leaf agreement cannot move a global domain inside complement", () => {
  expectTypedRejected(differenceDocument(scopedRealDomainQuestion, { complement: { intersection: [{ inequality: "x<4" }, { inequality: "x>=0" }] } }));
});

// A property of coefficients is not a property of a variable whose name is
// inside that complete subject. Keep later actual domain restrictions intact.
const coefficientSubjectControls: { id: string; question: string; lane: "number-line" | "half-plane" | "system"; native?: boolean; fraction?: boolean }[] = [
  { id: "exact-review", question: "Graph x<4 on a number line. The coefficients of x are rational.", lane: "number-line" },
  { id: "native-singular", question: "Graph t<4 on a number line. The coefficient of t is rational.", lane: "number-line", native: true },
  { id: "planar-plural", question: "Shade x+y<4. The coefficients of x and y are rational.", lane: "half-plane" },
  { id: "native-system-plural", question: "Graph u+v=6 and u-v=2. The coefficients of u and v are rational.", lane: "system", native: true },
  { id: "actual-rational-fraction", question: "Graph (1/2)t<2 on a number line. The coefficient of t is rational.", lane: "number-line", native: true, fraction: true },
  { id: "coefficient-case", question: "Graph x<4 on a number line. THE COEFFICIENTS OF x ARE RATIONAL.", lane: "number-line" },
  { id: "mixed-coefficient-list", question: "Graph x<4 on a number line. The coefficients of x and z are rational.", lane: "number-line" },
  { id: "comma-coefficient-list", question: "Graph u+v=6 and u-v=2. The coefficients of u,v are rational.", lane: "system", native: true },
  { id: "compound-coefficient-subject", question: "Graph x<4 on a number line. The coefficients of x and the coefficients of z are rational.", lane: "number-line" },
];
for (const fixture of coefficientSubjectControls) typedCheck("urgent-coefficient-subject", `${fixture.id}: complete coefficient subject does not veto its real figure`, () => {
  const document = propertyDocument(fixture.question, fixture.lane, fixture.native);
  if (fixture.fraction) document.constructions[0]!.inputs = { variable: "t", expression: { inequality: "(1/2)t<2" } };
  const before = structuredClone(document), issues = validateLinearSourceBinding(document), result = compileSceneDocument(document);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
  const built = buildLinearSourceDocument(fixture.question);
  if (built) assert(compileSceneDocument(built).ok, "a reader figure must still carry complete source proof");
});
const coefficientDomainRestrictions: { id: string; question: string; lane: "number-line" | "half-plane" | "system"; native?: boolean }[] = [
  { id: "later-x-rational", question: "Graph x<4 on a number line. The coefficients of x are rational. x is rational.", lane: "number-line" },
  { id: "later-t-irrational", question: "Graph t<4 on a number line. The coefficient of t is rational. t is irrational.", lane: "number-line", native: true },
  { id: "later-u-rational", question: "Shade u+v<4. The coefficients of u and v are rational. u is rational.", lane: "half-plane", native: true },
  { id: "later-v-rational", question: "Graph u+v=6 and u-v=2. The coefficients of u and v are rational. v is rational.", lane: "system", native: true },
  { id: "later-mixed-scalar", question: "Graph x<4 on a number line. The coefficients of x and z are rational. x and z are rational.", lane: "number-line" },
  { id: "later-mixed-system", question: "Graph u+v=6 and u-v=2. The coefficients of u,v are rational. u,v,w are rational.", lane: "system", native: true },
  { id: "later-unknown-domain", question: "Graph x<4 on a number line. The coefficients of x are rational. x IN S.", lane: "number-line" },
  { id: "same-clause-variable", question: "Graph x<4 on a number line. The coefficients of x are rational, and x is irrational.", lane: "number-line" },
];
for (const fixture of coefficientDomainRestrictions) typedCheck("urgent-coefficient-subject", `${fixture.id}: coefficient prose cannot erase a later variable restriction`, () => {
  expectTypedRejected(propertyDocument(fixture.question, fixture.lane, fixture.native), true);
});

const rationalTakingControls: { id: string; question: string; lane: "number-line" | "half-plane" | "system"; inputs: Record<string, unknown>; restricted: boolean }[] = [
  { id: "exact-coefficient-taking-positive", question: "Graph x<4 on a number line. The coefficients of x take rational values.", lane: "number-line", inputs: { variable: "x", expression: { inequality: "x<4" } }, restricted: false },
  { id: "coefficient-taking-preserves-variable-tail", question: "Graph x<4 on a number line. The coefficients of x take rational values and x takes rational values.", lane: "number-line", inputs: { variable: "x", expression: { inequality: "x<4" } }, restricted: true },
  { id: "exact-u-rational", question: "Graph u<4 on a number line. u takes rational values.", lane: "number-line", inputs: { variable: "u", expression: { inequality: "u<4" } }, restricted: true },
  { id: "native-t-only-irrational", question: "Graph t<4 on a number line. t takes only irrational values.", lane: "number-line", inputs: { variable: "t", expression: { inequality: "t<4" } }, restricted: true },
  { id: "planar-plural-only-rational", question: "Shade x+y<4. x and y take only rational values.", lane: "half-plane", inputs: { variables: ["x", "y"], inequality: "x+y<4" }, restricted: true },
  { id: "mixed-system-irrational", question: "Graph u+v=6 and u-v=2. u,v,w take irrational values.", lane: "system", inputs: { variables: ["u", "v"], equations: ["u+v=6", "u-v=2"] }, restricted: true },
  { id: "coefficient-taking-is-not-variable-taking", question: "Graph u+v=6 and u-v=2. The coefficients of u and v take rational values.", lane: "system", inputs: { variables: ["u", "v"], equations: ["u+v=6", "u-v=2"] }, restricted: false },
];
for (const fixture of rationalTakingControls) typedCheck("urgent-rational-takes", fixture.id, () => {
  const document = propertyDocument(fixture.question, fixture.lane);
  document.constructions[0]!.inputs = fixture.inputs;
  if (fixture.restricted) expectTypedRejected(document, true);
  else {
    const before = structuredClone(document), issues = validateLinearSourceBinding(document), result = compileSceneDocument(document);
    assert.deepEqual(issues, [], JSON.stringify(issues));
    assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
    assert.deepEqual(document, before);
  }
});

// A shared predicate still restricts a native variable when a coefficient
// noun is another conjunct in the whole subject, including a different owner.
const jointRationalSubjects: { id: string; question: string; lane: "number-line" | "half-plane" | "system"; native?: boolean }[] = [
  { id: "exact-joint-x", question: "Graph x<4 on a number line. x and the coefficients of x are rational.", lane: "number-line" },
  { id: "native-joint-t", question: "Graph t<4 on a number line. t and the coefficient of t are irrational.", lane: "number-line", native: true },
  { id: "native-planar-joint-taking", question: "Shade u+v<4. u and the coefficient of v take only rational values.", lane: "half-plane", native: true },
  { id: "native-system-joint-v", question: "Graph u+v=6 and u-v=2. v and the coefficients of u are rational.", lane: "system", native: true },
  { id: "mixed-owner-joint-x", question: "Graph x<4 on a number line. x and the coefficients of z are rational.", lane: "number-line" },
];
for (const fixture of jointRationalSubjects) typedCheck("urgent-rational-joint-subject", fixture.id, () => {
  expectTypedRejected(propertyDocument(fixture.question, fixture.lane, fixture.native), true);
});

// Lowercase coordinate u inside an equation is not the universal-set head U.
for (const question of [
  "Graph t+u=6 and t-u=2.",
  "Graph t+u=6 and t-u=2. The coefficients of t and u are rational.",
]) typedCheck("urgent-universe-symbol-role", `native t/u equations preserve case-sensitive variable roles: ${question}`, () => {
  const document = systemDocument(question, ["t+u=6", "t-u=2"]);
  document.constructions[0]!.inputs = { variables: ["t", "u"], equations: ["t+u=6", "t-u=2"] };
  const before = structuredClone(document), issues = validateLinearSourceBinding(document), result = compileSceneDocument(document);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
  assert(!result.renderScene.primitives.some(primitive => primitive.kind === "label" && /coefficients?/i.test(primitive.text ?? "")), "coefficient prose cannot become an equation label");
});
for (const set of ["Z", "Q"]) typedCheck("urgent-universe-symbol-role", `uppercase U retains its unsupported universe ${set}`, () => {
  const document = systemDocument(`Graph t+u=6 and t-u=2. U=${set}.`, ["t+u=6", "t-u=2"]);
  document.constructions[0]!.inputs = { variables: ["t", "u"], equations: ["t+u=6", "t-u=2"] };
  expectTypedRejected(document, true);
});

// Startup is measured separately from actual engine work. Flush readiness
// after imports/fixture initialization and immediately before the first case.
if (selectedId === resourceInnerId) await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${resourceReadyMarker}\n`, (error) => error ? reject(error) : resolve());
});

// Only the dedicated child executes adversarial parser inputs. A stuck native
// call cannot prevent the parent gate from killing its own child after5s.
if (selectedId === resourceInnerId) for (const count of [40, 200]) for (const spaced of [false, true]) {
  typedCheck(resourceInnerId, `bounded ${spaced ? "spaced" : "concatenated"} subject text ${count}`, () => {
    const question = `Graph x<4 on a number line. ${(spaced ? "and " : "and").repeat(count)} tail.`;
    process.stdout.write(`resource reader start ${count} ${spaced ? "spaced" : "concatenated"}\n`);
    const start = performance.now();
    assert.equal(buildLinearSourceDocument(question), null, "unknown prose is not a source-reader figure");
    const readerMs = performance.now() - start;
    const document = candidate(question, "number_line_set", false, "x<4"), before = structuredClone(document);
    const compilerStart = performance.now(), result = compileSceneDocument(document);
    assert.equal(typeof result.ok, "boolean", "the actual native compiler must complete");
    assert.deepEqual(document, before, "boundedness checks must preserve the native candidate");
    process.stdout.write(JSON.stringify({ resourceCase: count, spaced, readerMs, compilerMs: performance.now() - compilerStart, nativeCompiled: result.ok }) + "\n");
  });
}
// Retain the original four inputs above and exercise the coefficient-prefix
// matcher separately. These use the same bounded child and real public APIs.
if (selectedId === resourceInnerId) for (const count of [40, 200]) for (const spaced of [false, true]) {
  typedCheck(resourceInnerId, `bounded coefficient-prefix ${spaced ? "spaced" : "concatenated"} subject text ${count}`, () => {
    const question = `Graph x<4 on a number line. The coefficients of ${(spaced ? "and " : "and").repeat(count)} tail.`;
    process.stdout.write(`resource coefficient reader start ${count} ${spaced ? "spaced" : "concatenated"}\n`);
    const start = performance.now();
    assert.equal(buildLinearSourceDocument(question), null, "unknown coefficient-prefix prose is not a source-reader figure");
    const readerMs = performance.now() - start;
    const document = candidate(question, "number_line_set", false, "x<4"), before = structuredClone(document);
    const compilerStart = performance.now(), result = compileSceneDocument(document);
    assert.equal(typeof result.ok, "boolean", "the actual native compiler must complete");
    assert.deepEqual(document, before, "boundedness checks must preserve the native candidate");
    process.stdout.write(JSON.stringify({ resourceCase: count, coefficientPrefix: true, spaced, readerMs, compilerMs: performance.now() - compilerStart, nativeCompiled: result.ok }) + "\n");
  });
}
interface ResourceChildResult {
  pid: number | undefined;
  status: number | null;
  signal: NodeJS.Signals | null;
  failure: string | undefined;
  timeoutPhase: "startup" | "native" | undefined;
  ready: boolean;
  reaped: boolean;
  startupMs: number | undefined;
  nativeMs: number | undefined;
  stdout: string;
  stderr: string;
}
function runResourceChild(): Promise<ResourceChildResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, "--case", resourceInnerId], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const started = performance.now();
    let readyAt: number | undefined, stdout = "", stderr = "", bytes = 0;
    let status: number | null = null, signal: NodeJS.Signals | null = null;
    let failure: string | undefined, timeoutPhase: "startup" | "native" | undefined;
    let reaped = false, finished = false, stopping = false;
    let nativeTimer: ReturnType<typeof setTimeout> | undefined;
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(startupTimer);
      clearTimeout(nativeTimer);
      clearTimeout(reapTimer);
      resolve({ pid: child.pid, status, signal, failure, timeoutPhase,
        ready: readyAt !== undefined, reaped,
        startupMs: readyAt === undefined ? undefined : readyAt - started,
        nativeMs: readyAt === undefined ? undefined : performance.now() - readyAt, stdout, stderr });
    };
    const guardDrain = () => {
      if (reapTimer) return;
      reapTimer = setTimeout(() => {
        failure = `${failure ? `${failure}; ` : ""}own child stdio did not close within2000ms`;
        child.stdout.destroy();
        child.stderr.destroy();
        if (!reaped) {
          failure += "; own child was not reaped";
          child.unref();
        }
        finish();
      }, 2000);
    };
    const stop = (reason: string) => {
      if (stopping) return;
      stopping = true;
      failure = reason;
      clearTimeout(startupTimer);
      clearTimeout(nativeTimer);
      child.kill("SIGKILL"); // Only the exact child created by this helper.
      guardDrain();
    };
    const startupTimer = setTimeout(() => {
      timeoutPhase = "startup";
      stop("startup deadline15000ms");
    }, 15000);
    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = 1024 * 1024 - bytes;
      const text = chunk.subarray(0, Math.max(0, remaining)).toString("utf8");
      bytes += chunk.length;
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (bytes > 1024 * 1024) { stop("output limit1048576bytes"); return; }
      if (!stopping && readyAt === undefined && stdout.split("\n").includes(resourceReadyMarker)) {
        readyAt = performance.now();
        clearTimeout(startupTimer);
        nativeTimer = setTimeout(() => {
          timeoutPhase = "native";
          stop("native deadline5000ms");
        }, 5000);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) => {
      failure = error.message;
      if (child.pid === undefined) finish();
      else stop(error.message);
    });
    child.once("exit", (code, exitSignal) => {
      reaped = true; status = code; signal = exitSignal;
      clearTimeout(startupTimer);
      clearTimeout(nativeTimer);
      guardDrain();
    });
    child.once("close", finish);
  });
}

if (!selectedId || selectedId === "urgent-rational-resource") {
  checks++;
  typedChecks++;
  try {
    const child = await runResourceChild();
    const detail = JSON.stringify(child);
    assert.equal(child.failure, undefined, `Own resource child must complete both bounded phases: ${detail}`);
    assert.equal(child.ready, true, `Child must flush readiness before actual engine work: ${detail}`);
    assert.equal(child.reaped, true, `Own resource child must be reaped: ${detail}`);
    assert.equal(child.status, 0, `Resource child failed: ${detail}`);
    assert.match(child.stdout, /8\/8 domain allow-list checks/, "the child must actually execute all eight native cases");
    process.stdout.write(`resource child phases ${JSON.stringify({ pid: child.pid, startupMs: child.startupMs, nativeMs: child.nativeMs, reaped: child.reaped })}\n`);
    process.stdout.write(`resource child timings ${child.stdout.split("\n").filter(line => line.startsWith("{")).join(" ")}\n`);
  } catch (error) { failures.push(`urgent-rational-resource: adversarial subject text completes inside bounded startup and native phases: ${String(error)}`); }
}

console.log(`${checks - failures.length}/${checks} domain allow-list checks; ${selected.length} negative questions; ${cases.filter(item => item.origin === "review").length} review examples; ${cases.filter(item => item.origin === "generated").length} new generated wordings; ${selectedId ? 0 : controls.length} continuous controls; ${typedChecks} typed source-proof checks; ${failures.length} failures; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, failures.join("\n"));
