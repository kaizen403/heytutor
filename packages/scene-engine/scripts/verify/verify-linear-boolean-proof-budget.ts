import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";

function candidate(question: string, constraints: string[]): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "Show the supplied exact region." }, quantities: [],
    entities: [{ id: "region", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct_region", operator: "linear_feasible_region",
      inputs: { variables: ["x", "y"], constraints }, outputs: ["region"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["region"],
    revealGroups: [{ id: "solution", entityIds: ["region"], dependsOn: [], narrationCue: "solution" }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "solution", dependsOn: [], narrationIntent: "Explain the solution." }],
  };
}

let checks = 0;
const failures: string[] = [];
function check(id: string, action: () => void): void {
  checks++;
  try { action(); console.log(`PASS ${id}`); }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}
function refuses(question: string, constraints: string[]): void {
  const document = candidate(question, constraints);
  assert.ok(validateLinearSourceBinding(document).some(issue => issue.code === "linear_source_mismatch" && issue.severity === "fatal"),
    "A completely read Boolean request requires a completed equivalence proof");
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, false);
  assert.equal(compiled.renderScene, null, "An unproved region cannot reach the canvas");
}
function accepts(question: string, constraints: string[]): void {
  const document = candidate(question, constraints);
  assert.deepEqual(validateLinearSourceBinding(document), [], "Exact duplicate proof rows must not consume the witness budget");
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
}

for (const repeat of [14, 15, 20]) check(`union-is-not-intersection-${repeat}`, () => {
  refuses(`Shade (x>=0 and ${Array(repeat).fill("y>=0").join(" and ")}) or x<=2.`, ["x>=0", "y>=0", "x<=2"]);
});
check("parenthesized-union-is-not-intersection", () => {
  refuses(`Shade (x>=0 and ${Array(15).fill("y>=0").join(" and ")}) or (x<=2).`, ["x>=0", "y>=0", "x<=2"]);
});
for (const [id, first, repeated, other, constraints] of [
  ["scaled", "2x>=0", "3y>=0", "4x<=8", ["x>=0", "y>=0", "x<=2"]],
  ["strict", "x>0", "y>0", "x<2", ["x>0", "y>0", "x<2"]],
  ["mirrored", "x<=0", "y<=0", "x>=-2", ["x<=0", "y<=0", "x>=-2"]],
] as Array<[string, string, string, string, string[]]>) check(`union-polarity-${id}`, () => {
  refuses(`Shade (${first} and ${Array(15).fill(repeated).join(" and ")}) or ${other}.`, constraints);
});
check("branch-expansion-exhaustion-refuses", () => {
  refuses(`Shade ${Array(6).fill("(x>=0 or y>=0)").join(" and ")}.`, ["x>=0", "y>=0"]);
});
check("repeated-equivalent-union-remains-valid", () => {
  accepts(`Shade (x>=0 and ${Array(15).fill("y>=0").join(" and ")}) or (x>=0 and y>=0).`, ["x>=0", "y>=0"]);
});
check("scaled-repeated-equivalent-union-remains-valid", () => {
  accepts(`Shade (2x>=0 and ${Array(15).fill("3y>=0").join(" and ")}) or (x>=0 and y>=0).`, ["x>=0", "y>=0"]);
});
check("closed-group-before-unparenthesized-equivalent-operand", () => {
  accepts(`Shade (${Array(16).fill("2x>=0").join(" and ")}) or x>=0.`, ["x>=0"]);
});
check("ordinary-proved-complement-remains-valid", () => {
  accepts("Shade the complement of x+y<=4.", ["x+y>4"]);
});
check("uncertain-prose-still-cannot-veto-planner", () => {
  accepts("Shade the region opposite to x+y<=4.", ["x+y>4"]);
});
for (const [id, question] of [
  ["empty-parentheses", "Shade x>=0 () and y>=0."],
  ["unmatched-closing", "Shade x>=0 ) and y>=0."],
  ["unread-operand", "Shade x>=0 or z and y>=0."],
]) check(`uncertain-grammar-still-defers-${id}`, () => {
  assert.equal(buildLinearSourceDocument(question!), null);
  // The 18 Oct final owner review supersedes only empty mathematical groups
  // and the omitted z operand. Keep original questions, candidates, reader-null
  // expectations and the already passing unmatched-closing observation.
  if (id === "empty-parentheses" || id === "unread-operand") refuses(question!, ["x>=0", "y>=0"]);
  else assert.deepEqual(validateLinearSourceBinding(candidate(question!, ["x>=0", "y>=0"])), []);
});
console.log(`Linear Boolean proof budget: ${checks - failures.length}/${checks} passed`);
assert.deepEqual(failures, []);
