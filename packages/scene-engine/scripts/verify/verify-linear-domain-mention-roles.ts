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
function restrictive(name: string, question: string): void {
  check(`${name}: reader supplies no continuous source figure`, () => assert.equal(buildLinearSourceDocument(question), null));
  check(`${name}: independent domain stays restrictive`, () => assert.ok(validateLinearSourceBinding(candidate(question)).some(issue => issue.code === "linear_source_mismatch")));
  check(`${name}: public candidate fails atomically and stays immutable`, () => {
    const document = candidate(question), before = structuredClone(document), result = compileSceneDocument(document);
    assert.equal(result.ok, false); assert.equal(result.renderScene, null);
    assert.ok(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
    assert.deepEqual(document, before);
  });
}
function neutral(name: string, question: string): void {
  check(`${name}: original domain supplies no veto`, () => assert.deepEqual(validateLinearSourceBinding(candidate(question)), []));
  check(`${name}: public continuous candidate remains complete and immutable`, () => {
    const document = candidate(question), before = structuredClone(document), result = compileSceneDocument(document);
    assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
    assert.deepEqual(document, before);
  });
}
const mention = "Discuss a hypothetical graph of x<4 for real x";
for (const [name, request] of [
  ["this time graph", "this time graph x<4 on a number line for integer x."],
  ["in this case graph", "in this case graph x<4 on a number line for integer x."],
  ["for the moment graph", "for the moment graph x<4 on a number line for integer x."],
  ["this time given", "this time given x is an integer, graph x<4."],
] as const) restrictive(`original later ${name}`, `${mention}, and ${request}`);
restrictive("original secondary example graph", "Graph x<4 on a number line. Discuss the example graph of x<4 for integer x.");
restrictive("original secondary claim to graph", "Graph x<4 on a number line. Explain the claim to graph x<4 for integer x.");
for (const adjunct of ["this time", "in this case", "for the moment"]) {
  restrictive(`${adjunct} actual typed solutions`, `${mention}, and ${adjunct} plot the integer solutions of x<4 on a number line.`);
  restrictive(`${adjunct} declared assumption`, `${mention}, and ${adjunct} given the assumption that x is an integer, graph x<4.`);
  restrictive(`${adjunct} restriction head`, `${mention}, and ${adjunct} restrict x to integers; graph x<4.`);
  restrictive(`${adjunct} domain head`, `${mention}, and ${adjunct} x is an integer; graph x<4.`);
  restrictive(`${adjunct} hypothetical mode`, `${mention}, and ${adjunct} hypothetically graph x<4 for integer x.`);
  restrictive(`${adjunct} negated action`, `${mention}, and ${adjunct} do not graph x<4 for integer x.`);
  restrictive(`${adjunct} display content`, `${mention}, and ${adjunct} label the graph with the text "for integer x".`);
  neutral(`${adjunct} actual real domain`, `${mention}, and ${adjunct} graph x<4 on a number line for real x.`);
}
for (const [head, object] of [
  ["Discuss", "the example plot"],
  ["Explain", "an example graph"],
  ["Describe", "the example solution set"],
  ["Consider", "an example of the graph"],
] as const) restrictive(`secondary example object ${head}`, `Graph x<4 on a number line. ${head} ${object} of x<4 for integer x.`);
for (const [head, proposition, action] of [
  ["Discuss", "claim", "plot"],
  ["Explain", "statement", "draw"],
  ["Describe", "assumption", "graph"],
] as const) restrictive(`cited infinitive ${head}`, `Graph x<4 on a number line. ${head} the ${proposition} to ${action} x<4 for integer x.`);
restrictive("an actual standalone example graph has its own discrete object", "Explain an example graph of x<4 for integer x.");
restrictive("a real actual Explain request keeps its domain", "Explain how to graph x<4 on a number line for integer x.");
restrictive("a real actual Discuss graph request keeps its domain", "Discuss the graph of x<4 on a number line for integer x.");
restrictive("a real assumption survives secondary example discussion", "Given x is an integer, graph x<4 on a number line. Discuss the example graph of x<4 for real x.");
restrictive("a later real restriction survives a cited proposition", "Graph x<4 on a number line. Explain the claim to graph x<4 for real x, and then given x is an integer, graph x<4.");
restrictive("a prehead cited example keeps its nominal role", "Graph x<4 on a number line, and next an example plot of the integer solutions of x<4.");
restrictive("a prehead type claim stays cited", "Graph x<4 on a number line. The claim x is an integer.");
restrictive("a completed example frame does not cite the following command", `${mention}, and in this example graph x<4 on a number line for integer x.`);
restrictive("a completed example frame keeps a real given", `${mention}, and in this example given x is an integer, graph x<4.`);
restrictive("a cited example infinitive is not a completed frame", "Graph x<4 on a number line, and next an example to plot the integer solutions of x<4.");
restrictive("an incomplete preposition still owns its nominal graph", "Graph x<4 on a number line. For the graph of x<4 for integer x, discuss its endpoints.");
restrictive("a modified object name does not become a graph command", "Graph x<4 on a number line. An unfamiliar plot of x<4 for integer x.");
restrictive("an outer draw command owns its graph object", `${mention}, and in this case draw a graph of x<4 on a number line for integer x.`);
console.log(`domain mention roles: ${checks - failures.length}/${checks} checks pass; failures ${failures.length}; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, failures.join("\n"));
