import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";

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
const typedProofIds = ["typed-first-quadrant", "typed-interval-difference"];
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

console.log(`${checks - failures.length}/${checks} domain allow-list checks; ${selected.length} negative questions; ${cases.filter(item => item.origin === "review").length} review examples; ${cases.filter(item => item.origin === "generated").length} new generated wordings; ${selectedId ? 0 : controls.length} continuous controls; ${typedChecks} typed source-proof checks; ${failures.length} failures; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, failures.join("\n"));
