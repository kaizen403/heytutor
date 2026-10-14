// Fourth-check contract: unproved discrete mentions now decline by default.
import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument, type SceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";

function candidate(question: string): SceneDocument {
  return { schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "Show the supplied continuous solution." }, quantities: [],
    entities: [{ id: "result", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct", operator: "number_line_set", inputs: { variable: "x", expression: { inequality: "x<4" } }, outputs: ["result"] }],
    assertions: [], relations: [], annotations: [], requiredEntityIds: ["result"],
    revealGroups: [{ id: "setup", entityIds: ["result"], dependsOn: [], narrationCue: "Read the solution." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Read the solution." }] };
}
let checks = 0;
const failures: string[] = [];
function check(name: string, action: () => void): void {
  checks++; try { action(); } catch (error) { failures.push(`${name}: ${String(error)}`); }
}
const exact = "Graph x<4 on a number line. Discuss a hypothetical graph of x<4 for integer x.";
check("hypothetical request supplies no independent source figure", () => assert.equal(buildLinearSourceDocument(exact), null));
check("hypothetical discrete cue fails closed", () => assert(validateLinearSourceBinding(candidate(exact)).some(issue => issue.code === "linear_source_mismatch")));
check("the continuous figure is refused through the public boundary", () => {
  const document = candidate(exact), before = structuredClone(document), result = compileSceneDocument(document);
  assert(!result.ok && result.renderScene === null, JSON.stringify(result.report.issues));
  assert.deepEqual(document, before);
});
for (const [name, statement] of [
  ["illustrative graph", "Explain an illustrative graph of x<4 for integer x."],
  ["imaginary example", "Consider an imaginary example of x<4 for integer x."],
  ["hypothetical solution set", "Show a hypothetical solution set of x<4 for integer values of x."],
  ["hypothetical symbolic domain", "Discuss a hypothetical graph of x<4 over Z."],
  ["imaginary assumption in a plot", "Explain an imaginary plot of x<4 assuming x belongs to the whole numbers."],
] as const) {
  const question = `Graph x<4 on a number line. ${statement}`;
  check(`${name}: uncertainty supplies no source figure`, () => assert.equal(buildLinearSourceDocument(question), null));
  check(`${name}: mentioned discrete cue fails closed`, () => assert(validateLinearSourceBinding(candidate(question)).some(issue => issue.code === "linear_source_mismatch")));
  check(`${name}: continuous public candidate refuses atomically and stays immutable`, () => {
    const document = candidate(question), before = structuredClone(document), result = compileSceneDocument(document);
    assert(!result.ok && result.renderScene === null, JSON.stringify(result.report.issues));
    assert.deepEqual(document, before);
  });
}
for (const [name, question] of [
  ["given before hypothetical sentence", `Given x is an integer. ${exact}`],
  ["given after hypothetical sentence", `${exact} Given x is an integer.`],
  ["same-clause given before a mentioned graph", "Given x is an integer, graph x<4 on a number line and discuss a hypothetical graph of x<4 for real x."],
  ["same-clause assumption after a mentioned graph", "Discuss a hypothetical graph of x<4 for integer x, but assume x is an integer for the actual graph of x<4 on a number line."],
  ["actual assumption in a graphical request", "Graph x<4 assuming x is an integer. Show it on a number line."],
  ["genuine Explain request", "Explain how to graph x<4 on a number line for integer x."],
  ["genuine Discuss request", "Discuss the graph of x<4 for integer x on a number line."],
] as const) {
  check(`${name}: real discrete domain supplies no continuous reader figure`, () => assert.equal(buildLinearSourceDocument(question), null));
  check(`${name}: independent type remains restrictive`, () => assert.ok(validateLinearSourceBinding(candidate(question)).some(issue => issue.code === "linear_source_mismatch")));
  check(`${name}: wrong continuous public candidate fails atomically and stays immutable`, () => {
    const document = candidate(question), before = structuredClone(document), result = compileSceneDocument(document);
    assert.equal(result.ok, false); assert.equal(result.renderScene, null);
    assert.ok(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
    assert.deepEqual(document, before);
  });
}
check("integer coefficients leave both reader and supplied figure continuous", () => {
  const question = "Graph x<4 on a number line with integer coefficients.";
  const built = buildLinearSourceDocument(question); assert.ok(built && compileSceneDocument(built).ok);
  assert.deepEqual(validateLinearSourceBinding(candidate(question)), []);
  assert.ok(compileSceneDocument(candidate(question)).ok);
});
for (const statement of ["Explain whether x is an integer.", "Discuss the integer convention.", "Explain a hypothetical graph of x<4 if x might be an integer."]) {
  check(`unproved discrete request fails closed: ${statement}`, () => {
    const question = `Graph x<4 on a number line. ${statement}`;
    assert.equal(buildLinearSourceDocument(question), null);
    assert(validateLinearSourceBinding(candidate(question)).some(issue => issue.code === "linear_source_mismatch"));
    assert(!compileSceneDocument(candidate(question)).ok);
  });
}
for (const statement of [
  "Explain an example of a graph of x<4 for integer x.",
  "Discuss a graph of x<4 for integer x as a hypothetical example.",
]) {
  const question = `Graph x<4 on a number line. ${statement}`;
  check(`secondary mentioned graph remains uncertain: ${statement}`, () => assert.equal(buildLinearSourceDocument(question), null));
  check(`secondary discrete cue fails closed: ${statement}`, () => assert(validateLinearSourceBinding(candidate(question)).some(issue => issue.code === "linear_source_mismatch")));
  check(`primary continuous figure is refused beside a discrete cue: ${statement}`, () => assert(!compileSceneDocument(candidate(question)).ok));
  for (const given of [`Given x is an integer. ${question}`, `${question} Given x is an integer.`]) {
    check(`a real given survives the secondary graph role: ${given}`, () => {
      const result = compileSceneDocument(candidate(given));
      assert.equal(result.ok, false); assert.equal(result.renderScene, null);
      assert.ok(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
    });
  }
}
check("a standalone teaching example retains its requested discrete object", () => {
  const question = "Explain an example of a graph of x<4 for integer x.";
  const result = compileSceneDocument(candidate(question));
  assert.equal(buildLinearSourceDocument(question), null);
  assert.equal(result.ok, false); assert.equal(result.renderScene, null);
  assert.ok(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
});
for (const question of [
  "Graph a non-hypothetical graph of x<4 for integer x.",
  "Explain a non-hypothetical plot of x<4 for integer x.",
  "Graph a real rather than hypothetical graph of x<4 for integer x.",
  "Graph a non hypothetical graph of x<4 for integer x.",
  "Explain a non-illustrative diagram of x<4 for integer x.",
  "Graph a real instead of imaginary plot of x<4 for integer x.",
]) check(`a negated example modifier retains the real domain: ${question}`, () => {
  const document = candidate(question), before = structuredClone(document), result = compileSceneDocument(document);
  assert.equal(buildLinearSourceDocument(question), null);
  assert.ok(validateLinearSourceBinding(document).some(issue => issue.code === "linear_source_mismatch"));
  assert.equal(result.ok, false); assert.equal(result.renderScene, null);
  assert.ok(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
  assert.deepEqual(document, before);
});
console.log(`hypothetical domain roles: ${checks - failures.length}/${checks} checks pass; failures ${failures.length}; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, failures.join("\n"));
