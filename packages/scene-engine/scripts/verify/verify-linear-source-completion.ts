import assert from "node:assert/strict";
import { buildLinearSourceDocument } from "../../src/compile/linearRegionSource";
import { compileSceneDocument, type SceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";

function halfPlaneCandidate(question: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Show the requested solution." },
    source: { question }, quantities: [],
    entities: [{ id: "region", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "build", operator: "linear_half_plane", inputs: { inequality: "x+y<=8" }, outputs: ["region"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["region"],
    revealGroups: [{ id: "view", entityIds: ["region"], dependsOn: [], narrationCue: "Solution" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "view", dependsOn: [], narrationIntent: "Explain the source." }],
  };
}

const excludedPoint = "Graph x+y<=8, excluding P=(1,1).";
assert.equal(buildLinearSourceDocument(excludedPoint), null, "An excluded source point changes the set and cannot become an included reference point");
const rejected = compileSceneDocument(halfPlaneCandidate(excludedPoint));
assert.deepEqual(validateLinearSourceBinding(halfPlaneCandidate(excludedPoint)), [], "Unsupported exclusion scope supplies no reader binding authority");
const additionalGraph = "Graph x+y<=8 and plot x+2.";
assert.equal(buildLinearSourceDocument(additionalGraph), null, "A requested graph expression cannot disappear behind a complete inequality");
const partialGraph = compileSceneDocument(halfPlaneCandidate(additionalGraph));
assert.deepEqual(validateLinearSourceBinding(halfPlaneCandidate(additionalGraph)), [], "Unsupported additional graph scope supplies no reader binding authority");
// These intentionally partial candidates are observations, not assertions of
// a correct planner document; only the reader refusal/no-veto seam is certified.
console.log(JSON.stringify({ excludedCandidateAccepted: rejected.ok, partialCandidateAccepted: partialGraph.ok }));
console.log("verify-linear-source-completion: 4 exclusion/additional-graph checks passed");

let checks = 4;
for (const question of [
  "Graph x+y<=8, exclude P=(1,1).",
  "Graph x+y<=8 with the exclusion of P=(1,1).",
  "Graph x+y<=8 without P=(1,1).",
  "Graph x+y<=8 and plot x.",
  "Graph x+y<=8 and show x/2.",
  "Graph x+y<=8 and draw (x+2).",
  "Graph x+y<=8 and plot 2x.",
  "Plot x+2. Graph x+y<=8.",
  "Graph x+y<=8 and plot z.",
]) {
  assert.equal(buildLinearSourceDocument(question), null, question);
  assert.deepEqual(validateLinearSourceBinding(halfPlaneCandidate(question)), [], question);
  checks += 2;
}
for (const question of [
  "Graph x+y<=8. Mark P=(1,1).",
  "The lines x+y=6 and x-y=2 meet at P. Find its x-coordinate.",
  "The lines x+y=6 and x-y=2 meet at P. Find the x coordinate of P.",
  "Solve x+y=6 and x-y=2. Find x and y.",
  "Show x<2 or x>5 on a number line and state whether 2 belongs to the set.",
  "Let C=[-4,2) and D=(2,5]. Represent C union D on a number line and state whether 2 belongs to it.",
  "Maximize Z=3x+4y under x>=0,y>=0,x+y<=7 and 2x+y<=10.",
]) {
  const document = buildLinearSourceDocument(question);
  assert.ok(document, question);
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, `${question}: ${JSON.stringify(result.report.issues)}`);
  checks += 2;
}
for (const modifier of ["the square of", "twice", "the negative of"]) {
  const question = `The lines x+y=6 and x-y=2 meet at P. Find ${modifier} its x-coordinate.`;
  assert.equal(buildLinearSourceDocument(question), null, "An unsupported coordinate operation cannot be discarded as prose");
  checks++;
}
for (const request of ["Find x squared.", "Find its x-coordinate squared.", "Find its x-coordinate in centimeters."]) {
  const question = `The lines x+y=6 and x-y=2 meet at P. ${request}`;
  assert.equal(buildLinearSourceDocument(question), null, "An unsupported request suffix cannot be discarded as prose");
  checks++;
}
const systemQuestion = "The lines x+y=6 and x-y=2 meet at P. P=(1,1). Graph both lines and mark P.";
assert.equal(buildLinearSourceDocument(systemQuestion), null, "A named source intersection cannot contradict the exact tuple given for that point");
const systemCandidate = halfPlaneCandidate(systemQuestion);
systemCandidate.constructions[0]!.operator = "linear_system";
systemCandidate.constructions[0]!.inputs = { equations: ["x+y=6", "x-y=2"] };
const conflictingIntersection = compileSceneDocument(systemCandidate);
assert.ok(!conflictingIntersection.ok && conflictingIntersection.renderScene === null, "Raw system candidates cannot omit a conflicting original intersection relation");
checks += 2;
for (const question of [
  systemQuestion.replace("P=(1,1)", "P=(4,2)"),
  systemQuestion.replace("P=(1,1)", "Q=(1,1)").replace("mark P", "mark Q"),
]) {
  const document = buildLinearSourceDocument(question);
  assert.ok(document, "Equal named intersections and unrelated original reference points remain admissible");
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const raw = structuredClone(systemCandidate); raw.source.question = question;
  assert.ok(compileSceneDocument(raw).ok, "Normal compilation preserves the same consistent source point relation");
  checks += 3;
}
for (const [equations, tuple] of [
  [["x+y=6", "x+y=7"], "(4,2)"],
  [["x+y=6", "2x+2y=12"], "(4,2)"],
] as const) {
  const question = `The lines ${equations[0]} and ${equations[1]} meet at P. P=${tuple}. Graph both lines and mark P.`;
  assert.equal(buildLinearSourceDocument(question), null, "A named tuple cannot establish a unique intersection for a nonunique source pair");
  const raw = structuredClone(systemCandidate);
  raw.source.question = question; raw.constructions[0]!.inputs = { equations: [...equations] };
  const result = compileSceneDocument(raw);
  assert.ok(!result.ok && result.renderScene === null, "A nonunique named intersection must reject atomically in normal compilation");
  checks += 2;
}
for (const phrase of ["meet at point P", "meet at the point P", "cross at point P", "have intersection point P", "Meet at P", "have Intersection Point P"]) {
  const question = `The lines x+y=6 and x-y=2 ${phrase}. P=(1,1). Graph both lines and mark P.`;
  assert.equal(buildLinearSourceDocument(question), null, `A descriptor before the original intersection name cannot hide the conflicting tuple: ${phrase}`);
  const raw = structuredClone(systemCandidate); raw.source.question = question;
  const result = compileSceneDocument(raw);
  assert.ok(!result.ok && result.renderScene === null, phrase);
  const consistent = buildLinearSourceDocument(question.replace("P=(1,1)", "P=(4,2)"));
  assert.ok(consistent && compileSceneDocument(consistent).ok, `A descriptor preserves a consistent source intersection: ${phrase}`);
  checks += 3;
}
console.log(`verify-linear-source-completion: ${checks} exclusion/complete-expression/query checks passed`);
