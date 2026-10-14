// Fourth-check contract: unproved discrete mentions now decline by default.
import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { readLinearSourceLineName, validateLinearSourceBinding } from "../../src/compile/linearRegionSource";

type Case = { question: string; operator?: string; inputs?: Record<string, unknown> };
const interval = { variable: "x", expression: { intersection: [{ inequality: "x>2" }, { inequality: "x<6" }] } };
const left = { variable: "x", expression: { inequality: "x<4" } };
const actual: Case[] = [
  { question: "Explain how to graph x<3 on a number line for integer x.", inputs: { variable: "x", expression: { inequality: "x<3" } } },
  { question: "Represent the integer solutions of 2 < x < 6 on a number line.", inputs: interval },
  { question: "Represent the integer solution set of 2 < x < 6 on a number line.", inputs: interval },
  { question: "Mark the integer points satisfying -1 ≤ x < 3 on a number line.", inputs: { variable: "x", expression: { intersection: [{ inequality: "x>=-1" }, { inequality: "x<3" }] } } },
  { question: "Represent x > 2 and x < 6 for integer values on a number line.", inputs: interval },
  { question: "Draw the integer solutions of x ≤ 3 and x > -2 on a number line.", inputs: { variable: "x", expression: { intersection: [{ inequality: "x<=3" }, { inequality: "x>-2" }] } } },
  { question: "Mark the integer points in the region x + y ≤ 3, x ≥ 0, y ≥ 0.", operator: "linear_feasible_region", inputs: { variables: ["x", "y"], constraints: ["x+y<=3", "x>=0", "y>=0"] } },
  ...["x is an integer", "x ∈ Z", "x ∈ N", "x ∈ W", "x is a whole number", "when x is a natural number", "x ∈ N and represent"].map(statement => ({ question: `Represent x<4 on a number line; ${statement}.`, inputs: left })),
  { question: "Represent {x : x ∈ Z, x<4} on a number line.", inputs: left },
  { question: "Represent x < 4 on a number line where x is in N.", inputs: left },
  { question: "Represent x < 4, x ∈ I, on a number line.", inputs: left },
  { question: "Solve 3x + 8 > 2 when x ∈ I.", inputs: { variable: "x", expression: { inequality: "3x+8>2" } } },
  { question: "Find the integral values of x satisfying 2 < x < 6. Show them on a number line.", inputs: interval },
  { question: "Find the integral solutions of 2 < x < 6 on a number line.", inputs: interval },
  { question: "Represent the whole numbers satisfying x < 4 on a number line.", inputs: left },
  { question: "Represent the natural numbers satisfying x < 4 on a number line.", inputs: left },
  { question: "How many integer values of x satisfy 2 < x < 6? Show them on a number line.", inputs: interval },
  { question: "Find all integers x such that -3 < x ≤ 2 on a number line.", inputs: { variable: "x", expression: { intersection: [{ inequality: "x>-3" }, { inequality: "x<=2" }] } } },
  { question: "List the integers satisfying -3 < x ≤ 2 on a number line.", inputs: { variable: "x", expression: { intersection: [{ inequality: "x>-3" }, { inequality: "x<=2" }] } } },
  { question: "Graph the solution set of x < 3 where x is a positive integer.", inputs: { variable: "x", expression: { inequality: "x<3" } } },
];
const variations: Case[] = [
  ...["Teach me how to", "Help me", "Describe how to", "Walk me through how to"].map(head => ({ question: `${head} graph x<4 on a number line for integer x.`, inputs: left })),
  ...["integer solutions", "integral values", "integer points", "integral solutions"].map(object => ({ question: `Show the ${object} satisfying x<4 on a number line.`, inputs: left })),
  ...["whole numbers", "natural numbers", "all integers x", "integer values of x"].map(object => ({ question: `Find ${object} satisfying x<4 on a number line.`, inputs: left })),
  ...["I", "N", "Z", "W"].map(domain => ({ question: `Graph x<4 where x is in ${domain}.`, inputs: left })),
  ...["positive integer", "negative integer", "nonnegative integer", "non-positive integer"].map(domain => ({ question: `Represent x<4 for x belonging to the ${domain} domain.`, inputs: left })),
  ...["I", "N", "Z", "W"].map(domain => ({ question: `Explain x<4 on a number line for x ∈ ${domain}.`, inputs: left })),
  ...["Q1:", "Q2a:", "Question 3:", "Q12b:"].map(prefix => ({ question: `${prefix} Explain how to graph x<4 on a number line for integer x.`, inputs: left })),
];
function documentFor(question: string, operator = "number_line_set", inputs: Record<string, unknown> = left): SceneDocument {
  return { schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "candidate continuous solution" }, quantities: [],
    entities: [{ id: "result", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct", operator, inputs: structuredClone(inputs), outputs: ["result"] }], assertions: [], relations: [], annotations: [],
    requiredEntityIds: ["result"], revealGroups: [{ id: "setup", entityIds: ["result"], dependsOn: [], narrationCue: "Read the solution." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Read the solution." }] };
}
let checks = 0;
const failures: string[] = [];
function check(name: string, action: () => void): void {
  checks++; try { action(); } catch (error) { failures.push(`${name}: ${String(error)}`); }
}
for (const [i, row] of [...actual, ...variations].entries()) {
  const document = documentFor(row.question, row.operator, row.inputs);
  check(`discrete-${i} reader supplies no continuous figure`, () => assert.equal(buildLinearSourceDocument(row.question), null));
  check(`discrete-${i} independent original domain veto`, () => assert(validateLinearSourceBinding(document).some(issue => issue.code === "linear_source_mismatch")));
  check(`discrete-${i} continuous candidate fails atomically`, () => {
    const result = compileSceneDocument(document);
    assert.equal(result.ok, false); assert.equal(result.renderScene, null);
    assert(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
  });
}
for (const [i, question] of [
  "Represent x<4 on a number line with integer coefficients.",
  "Graph 2x+y<=4 with integer coefficients in the coordinate plane.",
  "Graph x<4; the inequality has integer coefficients.",
  "Represent x<4 with an integer coefficient on a number line.",
  "GRAPH x<4 ON A NUMBER LINE WITH INTEGER COEFFICIENTS.",
  "Represent x<4 on a number line with integer-coefficients.",
].entries()) check(`integer coefficient remains continuous-${i}`, () => {
  const built = buildLinearSourceDocument(question); assert(built); assert(compileSceneDocument(built).ok);
});
for (const [i, statement] of [
  "Write integer solutions as a caption.", "Label the graph with the text whole numbers.",
  "Explain whether x is in N.", "Ask whether x takes integral values.",
  "Do not restrict x to positive integers.", "If x is an integer, explain the alternate method.",
  "x is not a whole number.", "x is in I is not required.",
  "Should we graph only integer values?", "Show the words natural numbers as a label.",
  "Explain what 'for integer x' means.",
].entries()) check(`unproved displayed or asked discrete cue fails closed-${i}`, () => {
  const question = `Graph x<4 on a number line. ${statement}`;
  const candidate = documentFor(question);
  assert(validateLinearSourceBinding(candidate).some(issue => issue.code === "linear_source_mismatch"));
  assert(!compileSceneDocument(candidate).ok);
});
for (const statement of ["Explain the integer convention.", "Describe integer inclusion status.", "Explain integer values."]) {
  check(`unproved integer prose never becomes reader authority: ${statement}`, () => {
    const question = `Graph x<4 on a number line. ${statement}`;
    assert.equal(buildLinearSourceDocument(question), null);
    assert(validateLinearSourceBinding(documentFor(question)).some(issue => issue.code === "linear_source_mismatch"));
  });
}
for (const alias of ["I", "N", "Z", "W"]) check(`discrete-named alias membership declines by default-${alias}`, () => {
  const question = `For real x, let ${alias}={x:x<4}. Draw ${alias} on a number line. State x belongs to ${alias}.`;
  const candidate = documentFor(question);
  assert(validateLinearSourceBinding(candidate).some(issue => issue.code === "linear_source_mismatch"));
  assert(!compileSceneDocument(candidate).ok);
});
check("coefficient-only discussion remains continuous", () => {
  const question = "Graph x<4 on a number line. Explain why integer coefficients are useful.";
  assert.deepEqual(validateLinearSourceBinding(documentFor(question)), []);
  assert(compileSceneDocument(documentFor(question)).ok);
});
for (const [i, prefix] of ["Q1:", "Q2a:", "Q12:", "Q103b:", "Question 3:"].entries()) {
  const question = `${prefix} 2x+y=7 and x-y=2. Solve graphically.`;
  const candidate = documentFor(question, "linear_system", { variables: ["x", "y"], equations: ["2x+y=7", "x-y=2"] });
  check(`question prefix is not a line name-${i}`, () => assert.equal(readLinearSourceLineName(`${prefix} `), undefined));
  check(`question prefix reader has no boundary name-${i}`, () => {
    const built = buildLinearSourceDocument(question); assert(built);
    const result = compileSceneDocument(built); assert(result.ok && result.renderScene);
    assert(!result.renderScene.primitives.some(p => p.provenance?.linearRole === "boundary_name"));
  });
  check(`question prefix planner has no boundary name-${i}`, () => {
    const result = compileSceneDocument(candidate); assert(result.ok && result.renderScene);
    assert(!result.renderScene.primitives.some(p => p.provenance?.linearRole === "boundary_name"));
  });
}
for (const name of ["Q1", "Q2a", "L1", "P_2"]) check(`genuine named line preserved-${name}`, () => {
  assert.equal(readLinearSourceLineName(`line named ${name}: `), name);
  const question = `Graph line named ${name}: x+y=4 and line called M: x-y=2.`;
  const result = compileSceneDocument(documentFor(question, "linear_system", { variables: ["x", "y"], equations: ["x+y=4", "x-y=2"] }));
  assert(result.ok && result.renderScene);
  assert(result.renderScene.primitives.some(p => p.kind === "label" && p.text === name));
});
for (const [i, statement] of [
  "Explain why the assertion x is an integer is false.",
  "Explain why the assumption x in Z is invalid.",
  "Discuss the statement that x is in N is false.",
  "Demonstrate the notation x in Z without imposing it.",
  "Describe the claim x in Z as an example of notation.",
  "Explain the false statement x in Z.",
  "Explain why the claim x belongs to W is incorrect.",
  "Show x in I as a hypothetical statement.",
  "Describe the notation x ∈ Z without assuming that domain.",
  "Discuss the proposition that x is a positive integer is false.",
  "Explain the assertion x ∈ N as notation rather than a premise.",
  "Explain the false statement x in N using x=-1 as a counterexample.",
].entries()) check(`mentioned proposition supplies no type fact-${i}`, () => {
  const question = `Graph x<4 on a number line. ${statement}`;
  assert.equal(buildLinearSourceDocument(question), null);
  const candidate = documentFor(question);
  assert(validateLinearSourceBinding(candidate).some(issue => issue.code === "linear_source_mismatch"));
  assert(!compileSceneDocument(candidate).ok);
});
for (const [i, question] of [
  "Explain why the assertion x<4 holds for integer x on a number line.",
  "Demonstrate how to graph x<4 for integer x without captions.",
  "Describe the graph of x<4 with given integer x.",
  "Given the assumption that x is an integer, graph x<4 on a number line.",
  "Given that x ∈ I, represent x<4 on a number line.",
  "How do I graph x<4 on a number line for integer x?",
  "How can I graph x<4 on a number line for integer x?",
  "I want to graph x<4 on a number line for integer x.",
].entries()) check(`supplied domain remains authoritative through teaching prose-${i}`, () => {
  assert.equal(buildLinearSourceDocument(question), null);
  const result = compileSceneDocument(documentFor(question));
  assert.equal(result.ok, false); assert.equal(result.renderScene, null);
  assert(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
console.log(`discrete domain facts: ${checks - failures.length}/${checks} checks pass; failures ${failures.length}; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, failures.join("\n"));
