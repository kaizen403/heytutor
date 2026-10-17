import type { SceneDocument } from "../../../src/types";

export type Shape = "number_line_set" | "linear_half_plane";
const reviewPhrases = [
  "where x is selected from Z", "where x is picked from N", "where x is drawn from Z",
  "where x comes from N", "with x from Z", "where x is limited to N", "where x is any value from W",
  "within Z", "on Z", "ko Z mein hal karo", "ko N me solve karo", "x ko Z me se lo",
  "x ko N me se chuno", "x ko Z se lo", "x Z se lo", "x ko sirf N se lijiye",
  "x ki values N se lo", "x ke liye Z lo", "Z mein x ke liye", "x sirf Z mein", "x, y ko Z me se lo",
];
export const unprovedSetSymbolCases = reviewPhrases.flatMap((phrase, i) => (["number_line_set", "linear_half_plane"] as const).map(shape => ({
  id: `review-${i}-${shape}`, shape,
  question: `${shape === "number_line_set" ? "Solve 2x - 3 < 5" : "Shade x + y < 4"} ${phrase} ${shape === "number_line_set" ? "and show it on a number line" : "on the coordinate plane"}.`,
})));
const reviewLiterals = [
  "Solve 2x - 3 < 5 where x is selected from Z, and show it on a number line.",
  "Solve 2x - 3 < 5 where x is picked from N, and show it on a number line.",
  "Solve 2x - 3 < 5 where x is drawn from Z, and show it on a number line.",
  "Solve 2x - 3 < 5 where x comes from N, and show it on a number line.",
  "Solve 2x - 3 < 5 with x from Z, and show it on a number line.",
  "Solve 2x - 3 < 5 where x is limited to N, and show it on a number line.",
  "Solve 2x - 3 < 5 where x is any value from W, and show it on a number line.",
  "Solve 2x - 3 < 5 within Z and show it on a number line.",
  "Solve 2x - 3 < 5 on Z and show it on a number line.",
  "2x - 3 < 5 ko Z mein hal karo aur number line par dikhao.",
  "2x - 3 < 5 ko N me solve karo aur number line par dikhao.",
  "x ko Z me se lo aur 2x - 3 < 5 ko number line par dikhao.",
  "x ko N me se chuno aur 2x - 3 < 5 ko number line par dikhao.",
  "x ko Z se lo aur 2x - 3 < 5 ko number line par dikhao.",
  "x Z se lo, 2x - 3 < 5 ko number line par dikhao.",
  "x ko sirf N se lijiye aur 2x - 3 < 5 ko number line par dikhaiye.",
  "x ki values N se lo, 2x - 3 < 5 ko number line par dikhao.",
  "x ke liye Z lo aur 2x - 3 < 5 ko number line par dikhao.",
  "Z mein x ke liye 2x - 3 < 5 ko number line par dikhao.",
  "x sirf Z mein, 2x - 3 < 5 ko number line par dikhao.",
  "x, y ko Z me se lo aur x + y < 4 ko graph par shade karo.",
];
for (const [index, question] of reviewLiterals.entries()) for (const shape of ["number_line_set", "linear_half_plane"] as const) {
  unprovedSetSymbolCases.push({ id: `literal-review-${index}-${shape}`, shape,
    question: shape === "number_line_set" ? question.replaceAll("x + y < 4", "2x - 3 < 5")
      : question.replaceAll("2x - 3 < 5", "x + y < 4").replaceAll("number line", "coordinate plane"),
  });
}
for (const symbol of ["N", "W", "Z", "I", "Q", "ℕ", "ℤ", "ℚ", "Z+", "𝐐", "Ｗ", String.raw`\mathbb{Q}`, "N₀", "N_0", "Z_{+}", "Z_+", "Z0", "Q_+", "Z_0^+", "Q_{>0}", "N_k", "Z_p", "Q_{long_modifier}", "N_foo", "Z_{positive}", "Q1"]) {
  for (const phrase of [`${symbol} is where x lives`, `x is confined to ${symbol}`, `x ${symbol} se lo`, `within ${symbol}`, `x ${symbol}`, `${symbol} x ke liye`, `x is sampled from ${symbol}`, `x takes values inside ${symbol}`]) {
    for (const shape of ["number_line_set", "linear_half_plane"] as const) unprovedSetSymbolCases.push({
      id: `generated-${unprovedSetSymbolCases.length}`, shape,
      question: `${shape === "number_line_set" ? "Graph 2x - 3 < 5 on a number line" : "Shade x + y < 4 on the coordinate plane"}. ${phrase}.`,
    });
  }
}
for (const letter of ["N", "W", "Z", "I", "Q", "Q1"]) {
  for (const prefix of [
    `Maximize ${letter}=x+y subject to x>=0,y>=0,x+y<4.`,
    `Shade x+y<4. Mark ${letter}=(1,1).`,
    `Graph ${letter}: x+y=4 and x-y=2.`,
  ]) unprovedSetSymbolCases.push({ id: `collision-${unprovedSetSymbolCases.length}`, shape: "linear_half_plane", question: `${prefix} x is selected from ${letter}.` });
  unprovedSetSymbolCases.push({ id: `collision-${unprovedSetSymbolCases.length}`, shape: "number_line_set", question: `Let ${letter}=[0,5]. Draw ${letter} on a number line. x is selected from ${letter}.` });
  unprovedSetSymbolCases.push({ id: `fake-colon-${letter}`, shape: "number_line_set", question: `Graph 2x-3<5 on a number line. x from ${letter}:` });
}
unprovedSetSymbolCases.push({ id: "ordinal-domain-collision", shape: "number_line_set", question: "Q1: Graph 2x-3<5 on a number line. x selected from Q1." });
for (const target of ["Z", "W"]) for (const request of ["Find the minimum of Z.", "Minimize W.", "Show the maximizing point of W graphically."]) {
  unprovedSetSymbolCases.push({ id: `uncertain-objective-collision-${target}-${request}`, shape: "linear_half_plane",
    question: `Maximize Z=x+y subject to x>=0,y>=0,x+y<4. ${request} x, y selected from ${target}.` });
}
for (const continuation of [
  "Which of P and Q belongs to the shaded solution set? x selected from Q.",
  "Which of P and Q belongs to the shaded solution set except 0?",
  "Classify its membership in Q.",
]) unprovedSetSymbolCases.push({ id: `point-query-collision-${continuation}`, shape: "linear_half_plane",
  question: `Graph x+y<4. Mark P=(0,0) and Q=(1,1). ${continuation}` });
unprovedSetSymbolCases.push({ id: "unknown-membership-target", shape: "linear_half_plane", question: "Graph x+y<4. Mark P=(1,1). Classify its membership in Q." });
for (const restriction of ["x, y selected from Z at every corner", "x, y on Z value", "x, y from Z at each corner", "x, y within Z value"]) {
  unprovedSetSymbolCases.push({ id: `scalar-value-domain-${restriction}`, shape: "linear_half_plane",
    question: `Maximize Z=x+y subject to x>=0,y>=0,x+y<4, showing Z at every corner. ${restriction}.` });
}
for (const restriction of ["x selected from I", "x on I", "x within I"]) {
  unprovedSetSymbolCases.push({ id: `typed-alias-domain-${restriction}`, shape: "number_line_set",
    question: `For real x, let I={x:x>1} and J={x:x<3}. Draw K=I intersection J on a number line. ${restriction}.` });
}
for (const request of ["Mark P and Q. x selected from Q.", "Label Q in Q."]) {
  unprovedSetSymbolCases.push({ id: `marked-point-domain-${request}`, shape: "linear_half_plane",
    question: `Graph x+y<4. Mark P=(0,0) and Q=(1,1). ${request}` });
}
const distinctCases = new Map(unprovedSetSymbolCases.map(row => [`${row.shape}:${row.question}`, row]));
unprovedSetSymbolCases.splice(0, unprovedSetSymbolCases.length, ...distinctCases.values());
export function setSymbolCandidate(question: string, shape: Shape): SceneDocument {
  return { schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "Show the solution." }, quantities: [],
    entities: [{ id: "region", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct", operator: shape, inputs: shape === "number_line_set" ? { variable: "x", expression: { inequality: "2x-3<5" } } : { variables: ["x", "y"], inequality: "x+y<4" }, outputs: ["region"] }],
    assertions: [], relations: [], annotations: [], requiredEntityIds: ["region"],
    revealGroups: [{ id: "setup", entityIds: ["region"], dependsOn: [], narrationCue: "Explain the solution." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Explain the solution." }] };
}
