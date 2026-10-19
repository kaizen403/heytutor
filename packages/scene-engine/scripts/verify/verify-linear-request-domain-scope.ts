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
const exact = "Discuss a hypothetical graph of x<4 for real x, and also graph x<4 on a number line for integer x.";
check("compound discrete request supplies no continuous source figure", () => assert.equal(buildLinearSourceDocument(exact), null));
check("the later actual integer request supplies an independent domain veto", () => assert.ok(validateLinearSourceBinding(candidate(exact)).some(issue => issue.code === "linear_source_mismatch")));
check("the later actual integer request rejects a continuous public candidate atomically", () => {
  const document = candidate(exact), before = structuredClone(document), result = compileSceneDocument(document);
  assert.equal(result.ok, false); assert.equal(result.renderScene, null);
  assert.ok(result.report.issues.some(issue => issue.code === "linear_source_mismatch"));
  assert.deepEqual(document, before);
});
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
for (const modifier of ["also", "additionally", "then", "separately", "now", "explicitly"]) {
  for (const [name, request] of [
    ["actual graph", "graph x<4 on a number line for integer x."],
    ["typed solution object", "plot the integer solutions of x<4 on a number line."],
    ["actual assumption", "assume x is an integer, and graph x<4 on a number line."],
    ["polite modal request", "can you graph x<4 on a number line for integer x?"],
    ["independent domain statement", "x is an integer for the actual graph, and graph x<4 on a number line."],
  ] as const) restrictive(`${modifier} ${name}`, `${mention}, and ${modifier} ${request}`);
  restrictive(`${modifier} secondary hypothetical object`, `Graph x<4 on a number line, and ${modifier} explain a hypothetical graph of x<4 for integer x.`);
  restrictive(`${modifier} negated draw request`, `Graph x<4 on a number line, and ${modifier} do not graph x<4 for integer x.`);
  restrictive(`${modifier} quoted display content`, `Graph x<4 on a number line, and ${modifier} label the graph with the text "for integer x".`);
  neutral(`${modifier} real domain`, `${mention}, and ${modifier} graph x<4 on a number line for real x.`);
}
for (const modifier of ["next", "again", "once more"]) {
  for (const [name, request] of [
    ["actual graph", "graph x<4 for integer x."],
    ["typed solution object", "plot the integer solutions of x<4 on a number line."],
    ["actual given", "given integer x, graph x<4 on a number line."],
    ["actual restriction", "restrict x to integers; graph x<4 on a number line."],
    ["independent domain statement", "x is an integer; graph x<4 on a number line."],
  ] as const) restrictive(`${modifier} ${name}`, `${mention}, and ${modifier} ${request}`);
  restrictive(`${modifier} hypothetical manner stays local`, `${mention}, and ${modifier} hypothetically graph x<4 for integer x.`);
  restrictive(`${modifier} negated draw stays local`, `${mention}, and ${modifier} do not draw x<4 for integer x.`);
  restrictive(`${modifier} hypothetical example stays local`, `${mention}, and ${modifier} show x<4 for integer x as a hypothetical example.`);
  neutral(`${modifier} real request stays local`, `${mention}, and ${modifier} graph x<4 for real x.`);
}
for (const modifier of ["then please explicitly", "please also", "then clearly", "now actually"]) {
  restrictive(`combined request modifiers ${modifier}`, `${mention}, and ${modifier} draw x<4 on a number line for integer x but do not display labels.`);
}
restrictive("independent restrict head", `${mention}, and now please restrict x to integers, then graph x<4 on a number line.`);
restrictive("symbolic domain head", `${mention}, and also x in Z, and graph x<4 on a number line.`);
restrictive("actual Explain request", `${mention}, and additionally explain how to graph x<4 for integer x on a number line.`);
restrictive("actual Discuss request", `${mention}, and also discuss the graph of x<4 for integer x on a number line.`);
restrictive("an initial modified typed object", "Additionally please show the integer solutions of x<4 on a number line.");
restrictive("actual given before later examples", "Given x is an integer, graph x<4 on a number line, and also discuss a hypothetical graph of x<4 for real x.");
restrictive("a negated integer request supplies no type", `${mention}, and also do not graph x<4 for integer x.`);
restrictive("a modal domain question supplies no type", "Graph x<4 on a number line, and now should we graph x<4 for integer x?");
restrictive("an explicit hypothetical modifier is not consumed", `${mention}, and also hypothetically graph x<4 for integer x.`);
neutral("integer coefficient display does not type x", "Graph x<4 on a number line, and additionally explain why integer coefficients are useful.");
restrictive("a cited type claim remains a mentioned proposition", "Graph x<4 on a number line. The claim x is an integer.");
restrictive("a nominal hypothetical predicate remains unproved", `${mention}, and also a hypothetical x is an integer.`);
restrictive("a mentioned integer solution example has no request head", "Graph x<4 on a number line, and next an example plot of the integer solutions of x<4.");
restrictive("an infinitive description is not an independently requested object", "Graph x<4 on a number line, and next an example to plot the integer solutions of x<4.");
restrictive("an explicitly tentative instruction stays neutral", `${mention}, and next perhaps graph x<4 for integer x.`);
restrictive("a conditional local instruction stays neutral", `${mention}, and next if asked graph x<4 for integer x.`);
restrictive("a real assumption remains restrictive next to a hypothetical mode", "Given x is an integer, graph x<4 on a number line, and next hypothetically graph x<4 for real x.");
restrictive("a declared assumption preserves its supported proposition role", "Given the assumption that x is an integer, graph x<4 on a number line, and next explain a hypothetical graph for real x.");
restrictive("a modified genuine assumption retains its premise role", `${mention}, and once more given the assumption that x is an integer, graph x<4 on a number line.`);
restrictive("a later explicit wanted graph retains its actual domain", `${mention}, and next I want to graph x<4 on a number line for integer x.`);
restrictive("the local mark head owns its requested typed points", `${mention}, and once more mark the integer points satisfying x<4 on a number line.`);
restrictive("a local mark request for caption content stays neutral", `${mention}, and once more mark the text integer points as a caption.`);
restrictive("a local label request for typed words stays neutral", `${mention}, and next label the graph with the text integer points.`);
console.log(`request domain scope: ${checks - failures.length}/${checks} checks pass; failures ${failures.length}; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, failures.join("\n"));
