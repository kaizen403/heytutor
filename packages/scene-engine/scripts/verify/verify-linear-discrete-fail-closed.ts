import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";

function candidate(question: string, operator = "number_line_set"): SceneDocument {
  const inputs = operator === "number_line_set" ? { variable: "x", expression: { inequality: "x<4" } }
    : operator === "linear_half_plane" ? { variables: ["x", "y"], inequality: "x+y<4" }
      : operator === "linear_feasible_region" ? { variables: ["x", "y"], constraints: ["x>=0", "y>=0", "x+y<4"] }
        : { variables: ["x", "y"], equations: ["x+y=4", "x-y=2"] };
  return { schemaVersion: "scene-document/v2", source: { question }, quantities: [],
    visualDecision: { mode: "scene", reason: "Show the supplied continuous solution." },
    entities: [{ id: "result", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct", operator, inputs, outputs: ["result"] }],
    assertions: [], relations: [], annotations: [], requiredEntityIds: ["result"],
    revealGroups: [{ id: "setup", entityIds: ["result"], dependsOn: [], narrationCue: "Read the solution." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Read the solution." }] };
}

// Cross product, not a collection of recognised declaration templates. Unknown,
// quoted and hypothetical roles must also decline when a discrete cue remains.
const questions = new Set<string>();
for (const word of ["integer", "integers", "integral", "whole", "natural", "counting", "prime", "primes", "odd", "even", "lattice"]) {
  for (const phrase of [
    `If x has ${word} values, graph x<4 on a number line.`,
    `Graph x<4 on a number line for ${word} x.`,
    `Which ${word} values satisfy x<4? Show the graph.`,
    `Show x<4; x must take ${word} values.`,
    `Plot the ${word} solutions of x<4.`,
    `Represent x<4, with ${word} membership undecided.`,
    `Graph x<4. Discuss a hypothetical ${word} solution.`,
    `Graph x<4. Label it with the word '${word}'.`,
    `Explain how to graph x<4 under the ${word} convention.`,
    `With integer coefficients, graph x<4 for ${word} values.`,
  ]) questions.add(phrase);
}
for (const symbol of ["I", "Z", "N", "W", "ℤ", "ℕ", "\\mathbb{Z}", "\\mathbb N"]) for (const suffix of ["", "+", "⁺", "0", "₀", "-", "⁻", "_0", "_{+}", "^+"]) {
  questions.add(`If x ∈ ${symbol}${suffix}, find the solution set of x<4 and graph it on a number line.`);
  questions.add(`Graph x<4 on a number line (x ∈ ${symbol}${suffix}).`);
  questions.add(`Graph x<4 where x is in ${symbol}${suffix}.`);
}
for (const set of ["{1,2,3}", "{1}", "{-2, 0, 2, ...}", "{0; 1; 2}"]) questions.add(`For x ∈ ${set}, graph x<4 on a number line.`);
assert(questions.size >= 100);
let checks = 0;
const failures: string[] = [];
function check(name: string, work: () => void): void {
  checks++; try { work(); } catch (error) { failures.push(`${name}: ${String(error)}`); }
}
for (const [i, question] of [...questions].entries()) {
  check(`generated ${i}: no source figure`, () => assert.equal(buildLinearSourceDocument(question), null));
  check(`generated ${i}: planner veto is independent of reader proof`, () => {
    const document = candidate(question), before = structuredClone(document);
    assert(validateLinearSourceBinding(document).some(issue => issue.code === "linear_source_mismatch"));
    const result = compileSceneDocument(document);
    assert(!result.ok && result.renderScene === null);
    assert(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
    assert.deepEqual(document, before);
  });
}
for (const [operator, question] of [
  ["linear_half_plane", "Shade x+y<4 for points with integer coordinates."],
  ["linear_feasible_region", "Graph x>=0, y>=0, x+y<4 for lattice points."],
  ["linear_system", "Solve x+y=4 and x-y=2 for natural numbers, graphically."],
] as const) check(`${operator}: continuous planner cannot erase discrete source`, () => {
  const result = compileSceneDocument(candidate(question, operator));
  assert(!result.ok && result.renderScene === null);
  assert(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
for (const suffix of ["with integer coefficients", "with an integer coefficient", "with integer-coefficients", "over the real numbers", "for real x", "where x ∈ R", "where x ∈ ℝ"]) {
  check(`short safe phrase ${suffix}`, () => {
    const document = candidate(`Graph x<4 on a number line ${suffix}.`), before = structuredClone(document);
    assert.deepEqual(validateLinearSourceBinding(document), []);
    assert(compileSceneDocument(document).ok);
    assert.deepEqual(document, before);
  });
}
check("LaTeX fraction braces are not a scalar roster domain", () => {
  const question = "Graph x < \\frac{1}{2} on a number line for real x.";
  const document = candidate(question);
  document.constructions[0]!.inputs = { variable: "x", expression: { inequality: "x<1/2" } };
  assert.deepEqual(validateLinearSourceBinding(document), []);
  assert(compileSceneDocument(document).ok);
  const built = buildLinearSourceDocument(question);
  assert(built && compileSceneDocument(built).ok);
});
console.log(`${checks - failures.length}/${checks} fail-closed checks; ${questions.size} generated wordings; ${failures.length} failures; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, failures.join("\n"));
