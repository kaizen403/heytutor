import type { SceneDocument } from "../../../src/types";

export interface IncompleteConstraintCase {
  id: string;
  question: string;
  planar: boolean;
  source: string[];
  forceFullCandidate?: boolean;
  completeHasIsolatedPostfix?: boolean;
  expression?: Record<string, unknown>;
}
const review: Array<[string, boolean, string[]]> = [
  ["Shade x + y < 4 with x >= 0 and y >= 0. Explain step by step.", true, ["x+y<4", "x>=0", "y>=0"]],
  ["Draw the region x + y < 4, x >= 0, y >= 0. Explain step by step.", true, ["x+y<4", "x>=0", "y>=0"]],
  ["Shade x + y < 4 where x and y are nonnegative, and explain each step slowly like a friendly teacher.", true, ["x+y<4", "x>=0", "y>=0"]],
  ["Shade x + y < 4 for x >= 0 and y >= 0, and explain each step slowly like a friendly teacher.", true, ["x+y<4", "x>=0", "y>=0"]],
  ["Solve 2x - 3 < 5 where x > 0 and show it on a number line. Explain step by step.", false, ["2x-3<5", "x>0"]],
  ["Solve 2x - 3 < 5 and x > 0 on a number line, step by step please.", false, ["2x-3<5", "x>0"]],
  ["Solve 2x - 3 < 5 for positive x and show it on a number line, explaining like a friendly teacher.", false, ["2x-3<5", "x>0"]],
  ["Shade x + y < 4 where x and y are nonnegative and the coefficients of x and y are positive.", true, ["x+y<4", "x>=0", "y>=0"]],
  ["Shade x + y < 4 where the coefficients of x and y are positive and x and y are nonnegative.", true, ["x+y<4", "x>=0", "y>=0"]],
  ["Shade x + y < 4, given that the coefficients of x and y are positive, x and y are positive.", true, ["x+y<4", "x>0", "y>0"]],
];
export const incompleteConstraintCases: IncompleteConstraintCase[] = review.map(([question, planar, source], i) => ({ id: `review-${i+1}`, question, planar, source, completeHasIsolatedPostfix: i === 8 }));
incompleteConstraintCases.push({ id: "first-quadrant-only", question: "Shade the region in the first quadrant. Explain patiently.", planar: true, source: ["x>=0", "y>=0"] });
for (const [word, relation] of [["positive", ">"], ["negative", "<"], ["nonnegative", ">="], ["non-negative", ">="], ["nonpositive", "<="], ["non-positive", "<="]] as const) {
  incompleteConstraintCases.push({ id: `sign-prefix-${word}`, question: `Graph 2x-3<5 for ${word} x on a number line. Explain patiently.`, planar: false, source: ["2x-3<5", `x${relation}0`] });
  incompleteConstraintCases.push({ id: `sign-list-${word}`, question: `Shade x+y<4 where x and y are ${word}. Explain patiently.`, planar: true, source: ["x+y<4", `x${relation}0`, `y${relation}0`] });
}
for (const [id, extra, source] of [
  ["reversed", "0 < x", ["x>0"]], ["scaled", "2x > 0", ["x>0"]],
  ["chained", "0 < x < 3", ["x>0", "x<3"]],
  ["opposite-same-boundary", "x > 0 and x < 0", ["x>0", "x<0"]],
  ["strict-same-boundary", "x > 0 and x >= 0", ["x>0", "x>=0"]],
] as Array<[string, string, string[]]>) incompleteConstraintCases.push({ id, question: `Solve 2x-3<5 and ${extra} on a number line. Explain patiently.`, planar: false, source: ["2x-3<5", ...source] });
export const unprovedSignCases: IncompleteConstraintCase[] = [
  "positive solutions are required", "x must be positive", "for not positive x", "for not nonnegative x", "for possibly positive x", "x is not positive", "x positive hona chahiye", "x may be negative or nonnegative", "x has positive values", "x must be non-negative", "x must be nonpositive",
].map((restriction, i) => ({ id: `unproved-sign-${i}`, question: `Graph 2x-3<5 on a number line. ${restriction}. Explain patiently.`, planar: false, source: ["2x-3<5"] }));
export const unprovedMathTailCases: IncompleteConstraintCase[] = [
  "Graph x<4z on a number line.", "Graph x<4 z on a number line.", "Graph x<4 unknown(x) on a number line.", "Graph x<4/2 patiently on a number line.", "Graph x<4*(x+1) patiently on a number line.",
].map((question, i) => ({ id: `unproved-math-tail-${i}`, question, planar: false, source: ["2x-3<5"] }));
export const unprovedScopeCases: IncompleteConstraintCase[] = [
  { id: "source-negation", question: "Solve 2x-3<5 and not (x>0) on a number line. Give a friendly explanation.", planar: false, source: ["2x-3<5", "x>0"], forceFullCandidate: true },
  { id: "source-complement", question: "Graph the complement of x>0 on a number line. Explain each choice patiently.", planar: false, source: ["x>0"] },
  { id: "source-union-not-intersection", question: "Graph x<0 or x>3 on a number line. Give a friendly explanation.", planar: false, source: ["x<0", "x>3"], forceFullCandidate: true },
  { id: "candidate-union-not-intersection", question: "Graph x>0 and x<3 on a number line. Give a friendly explanation.", planar: false, source: ["x>0", "x<3"], expression: { union: [{ inequality: "x>0" }, { inequality: "x<3" }] } },
  { id: "source-planar-negation", question: "Shade the points not satisfying x+y<4. Explain each choice patiently.", planar: true, source: ["x+y<4"] },
  ...["x is at least zero", "x is no greater than zero", "x must exceed zero", "x is below zero"].map((claim, i) => ({ id: `unowned-native-domain-${i}`, question: `Graph 2x-3<5 on a number line, where ${claim}. Explain gently.`, planar: false, source: ["2x-3<5"] })),
];
unprovedScopeCases.push(
  ...["unless", "except", "xor", "setminus", "minus"].map(operator => ({ id: `unsupported-operator-${operator}`, question: `Graph x<4 ${operator} x>1 on a number line. Explain patiently.`, planar: false, source: ["x<4", "x>1"], forceFullCandidate: true })),
  { id: "unsupported-operator-neither-nor", question: "Graph neither x<4 nor x>1 on a number line. Explain patiently.", planar: false, source: ["x<4", "x>1"], forceFullCandidate: true },
);
export function incompleteConstraintCandidate(row: IncompleteConstraintCase, complete = false): SceneDocument {
  const constraints = complete || row.forceFullCandidate ? row.source : row.source.slice(0, 1);
  return { schemaVersion: "scene-document/v2", source: { question: row.question }, visualDecision: { mode: "scene", reason: "Show the supplied solution." }, quantities: [],
    entities: [{ id: "region", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct", operator: row.planar ? complete ? "linear_feasible_region" : "linear_half_plane" : "number_line_set", inputs: row.planar ? complete ? { variables: ["x", "y"], constraints } : { variables: ["x", "y"], inequality: constraints[0] } : { variable: "x", expression: row.expression ?? (constraints.length === 1 ? { inequality: constraints[0] } : { intersection: constraints.map(inequality => ({ inequality })) }) }, outputs: ["region"] }],
    assertions: [], relations: [], annotations: [], requiredEntityIds: ["region"], revealGroups: [{ id: "setup", entityIds: ["region"], dependsOn: [], narrationCue: "Explain the solution." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Explain the solution." }] };
}
export const uncertaintyControls: IncompleteConstraintCase[] = [
  { id: "unknown-prose-only", question: "Shade x+y<4. Explain step by step like a friendly teacher.", planar: true, source: ["x+y<4"] },
  { id: "uncertain-number-line", question: "Solve 2x-3<5 on a number line, explaining patiently.", planar: false, source: ["2x-3<5"] },
  { id: "neutral-coefficient-property", question: "Shade x+y<4. The coefficients of x and y are positive.", planar: true, source: ["x+y<4"] },
  { id: "reversed-own-comparison", question: "Graph 4>x on a number line. Explain patiently.", planar: false, source: ["2x-3<5"] },
  { id: "nonmathematical-not-prose", question: "Graph x<4 on a number line. Please do not rush.", planar: false, source: ["2x-3<5"] },
  { id: "nonmathematical-or-prose", question: "Graph x<4 and explain clearly, or use short sentences.", planar: false, source: ["2x-3<5"] },
  { id: "unfamiliar-adverb-after-rhs", question: "Graph x<4 patiently on a number line.", planar: false, source: ["2x-3<5"] },
  { id: "unfamiliar-planar-adverb-after-rhs", question: "Shade x+y<4 cautiously in the coordinate plane.", planar: true, source: ["x+y<4"] },
  { id: "no-comparisons-unknown-prose", question: "Explain this patiently @.", planar: false, source: ["2x-3<5"] },
  { id: "equivalent-scaled", question: "Graph 4x-6<10 on a number line. Explain patiently.", planar: false, source: ["2x-3<5"] },
];

/** Independently complete planner controls for the refusal-only seam. These
 * do not give the source reader a new figure-producing grammar. */
export interface IncompleteSourcePreservationCase extends IncompleteConstraintCase {
  refuse?: boolean;
  objective?: { expression: string; sense: "max" | "min" };
}
export const incompleteSourcePreservationCases: IncompleteSourcePreservationCase[] = [
  ...[
    "x is an element of R", "x is a member of the real numbers", "x can be a fraction",
    "x ek vastavik sankhya hai", "x एक वास्तविक संख्या है", "x R mein hai", "दिखाओ. x is real",
    "x chosen from R", "x restricted to the real numbers", "x taken from ℝ", "x from the set R",
  ].map((role, index) => ({ id: `proved-real-role-${index}`, question: `Graph x<4 on a number line. ${role}.`, planar: false, source: ["x<4"] })),
  { id: "proved-real-prefix", question: "The coefficients are integers. Graph x<4 on a number line for real x.", planar: false, source: ["x<4"] },
  { id: "proved-repeated-real-request", question: "Discuss a hypothetical graph of x<4 for real x, and then graph x<4 on a number line for real x.", planar: false, source: ["x<4"] },
  { id: "proved-typed-real-amounts", question: "A workshop chooses real nonnegative production amounts x and y. Its limits are x+y<=8 and x+2y<=11. Revenue is Z=2x+3y. Find the maximum revenue.", planar: true, source: ["x>=0", "y>=0", "x+y<=8", "x+2y<=11"], objective: { expression: "2x+3y", sense: "max" } },
  { id: "proved-double-complement", question: "Represent the complement of the complement of x<0 on a number line.", planar: false, source: ["x<0"] },
  { id: "proved-not-satisfying", question: "Represent the set not satisfying x<0 on a number line.", planar: false, source: ["x<0"], expression: { complement: { inequality: "x<0" } } },
  { id: "proved-opposite-region", question: "Shade the region opposite to x+y<=4.", planar: true, source: ["x+y>4"] },
  { id: "proved-whole-mixed-number", question: "Represent x>2 1/2 on a number line.", planar: false, source: ["x>5/2"] },
  ...[
    "x can only be a fraction", "x cannot be a fraction", "x must be a fraction", "x can be a fraction excluding zero",
    "x chosen from R excluding zero", "x is a member of the real numbers except zero",
  ].map((role, index) => ({ id: `unproved-real-qualification-${index}`, question: `Graph x<4 on a number line. ${role}.`, planar: false, source: ["x<4"], refuse: true })),
  ...["possibly", "not", "only possibly"].map((modifier, index) => ({ id: `unproved-typed-domain-qualification-${index}`, question: `Graph x+y<4. ${modifier} real positive variables x and y. Explain patiently.`, planar: true, source: ["x+y<4", "x>0", "y>0"], refuse: true })),
  ...["or negative", "possibly negative", "negative", "possibly production"].map((modifier, index) => ({ id: `unproved-typed-domain-internal-qualification-${index}`, question: `Graph x+y<4. Let real positive ${modifier} variables x and y. Explain patiently.`, planar: true, source: ["x+y<4", "x>0", "y>0"], refuse: true })),
  { id: "real-role-cannot-hide-later-domain", question: "Graph x<4 on a number line. x is a member of the real numbers. x>0. Explain patiently.", planar: false, source: ["x<4"], refuse: true },
  { id: "real-role-cannot-hide-verbal-domain", question: "Graph x<4 on a number line. x can be a fraction. x must exceed zero. Explain patiently.", planar: false, source: ["x<4"], refuse: true },
  { id: "real-request-cannot-hide-then-operand", question: "Discuss x<4 for real x and then graph x>0 on a number line for real x.", planar: false, source: ["x<4", "x>0"], refuse: true },
  { id: "unary-wrong-polarity", question: "Represent the complement of the complement of x<0 on a number line.", planar: false, source: ["x<0"], expression: { complement: { inequality: "x<0" } }, refuse: true },
  { id: "unary-wrong-region-side", question: "Shade the region opposite to x+y<=4.", planar: true, source: ["x+y<=4"], refuse: true },
  { id: "unary-cannot-drop-domain", question: "Represent the complement of the complement of x<0 and x>-3 on a number line.", planar: false, source: ["x<0"], refuse: true },
  { id: "unary-cannot-drop-operand", question: "Represent the complement of the complement of x<0 or z on a number line.", planar: false, source: ["x<0"], refuse: true },
  { id: "mixed-number-wrong-product", question: "Represent x>2 1/2 on a number line.", planar: false, source: ["x>1"], refuse: true },
  { id: "mixed-number-wrong-boundary", question: "Represent x>2 1/2 on a number line.", planar: false, source: ["x>=5/2"], refuse: true },
];
