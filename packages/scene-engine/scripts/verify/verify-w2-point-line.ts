import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { validatePointLineSourceInputs } from "../../src/ir/pointLineSource";
import type { SceneDocument } from "../../src/types";
import { pointLineSourceDocument } from "../../src/ir/pointLineProgram";
import type { ProblemIR } from "../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { visualObligationIssues } from "../../src/synthesize/visualObligations";

const question = "Find the perpendicular distance of P(0,0) from the line 3x+4y-25=0.";
function document(line: Record<string, unknown>, finite = false): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Source point, infinite line and its perpendicular." }, source: { question },
    quantities: [], entities: [
      { id: "P", kind: "point", role: "source point", label: "P" },
      { id: "L", kind: finite ? "segment" : "line", role: "source line", label: "L" },
      { id: "d", kind: "segment", role: "certified perpendicular", label: "d=5" },
    ], constructions: [
      { id: "point", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["P"] },
      { id: "line", operator: "line_relation", inputs: line, outputs: ["L"] },
      { id: "distance", operator: "point_line_distance", inputs: { point: "P", a: 3, b: 4, c: -25 }, outputs: ["d"] },
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["P", "L", "d"],
    revealGroups: [{ id: "all", entityIds: ["P", "L", "d"], dependsOn: [], narrationCue: "The source point and its perpendicular to the source line." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "all", dependsOn: [], narrationIntent: "Reveal the complete source geometry." }],
  };
}
function admitted(scene: SceneDocument): boolean {
  const validated = validateSceneDocument(scene);
  if (!validated.document) return false;
  if (validatePointLineSourceInputs(validated.document, question).some(row => row.severity === "fatal")) return false;
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok) assert.equal(compiled.renderScene, null);
  return compiled.ok && compiled.renderScene !== null;
}
assert.ok(admitted(document({ mode: "slope", line: { a: 3, b: 4, c: -25 } })), "an independently certified infinite line_relation must carry the measured source line");
assert.ok(admitted(document({ mode: "slope", line: { a: -6, b: -8, c: 50 } })), "proportional coefficients preserve the same line");
assert.ok(!admitted(document({ mode: "slope", line: { a: 3, b: 4, c: 25 } })), "a parallel line at equal distance is a different source line");
assert.ok(!admitted(document({ mode: "slope", p: [3, 4], q: [7, 1] }, true)), "a finite segment cannot substitute for the source infinite line");
assert.ok(!admitted(document({ mode: "slope", line: "L" })), "a cyclic line must not become source authority");
console.log("W2 point-line: five composed-line admission and rejection controls pass");
for (const source of [
  question,
  "Find the perpendicular distance from P(1,2) to y=2x+5.",
  "Find the distance of A(2,-3) from x=7.",
  "Find the perpendicular distance of the origin from y-3=2(x-1).",
  "Find the distance of P(3,4) from 3x+4y-25=0.",
]) {
  const scene = pointLineSourceDocument(source);
  assert.ok(scene, source);
  const checked = validateSceneDocument(scene);
  assert.ok(checked.document, JSON.stringify(checked.report));
  const compiled = compileSceneDocument(checked.document);
  assert.ok(compiled.ok, JSON.stringify(compiled.report));
}
console.log("W2 point-line: five complete source projection programs compile");

const fullQuestion = "Find the distance and perpendicular foot H from P(0,0) to 3x+4y-25=0.";
function fact(id: string, kind: "given" | "requested", quote: string): ProblemIR["facts"][number] {
  const start = fullQuestion.indexOf(quote);
  assert.ok(start >= 0);
  return { id, kind, statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } };
}
const full: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "pointLineAuthoredCore", question: fullQuestion,
  facts: [fact("pointFact", "given", "P(0,0)"), fact("lineFact", "given", "3x+4y-25=0"), fact("requestFact", "requested", "distance and perpendicular foot H")],
  entities: [
    { id: "P", kind: "point", label: "P", evidenceFactIds: ["pointFact"] },
    { id: "line", kind: "line", label: "L", evidenceFactIds: ["lineFact"] },
    { id: "foot", kind: "point", label: "H", evidenceFactIds: ["requestFact"] },
  ], expressions: [
    { id: "ePx", valueType: "scalar", root: { kind: "number", value: 0 }, evidenceFactIds: ["pointFact"] },
    { id: "ePy", valueType: "scalar", root: { kind: "number", value: 0 }, evidenceFactIds: ["pointFact"] },
    { id: "distance", valueType: "scalar", root: { kind: "binary", operator: "/", left: { kind: "call", function: "abs", argument: { kind: "number", value: -25 } }, right: { kind: "call", function: "sqrt", argument: { kind: "number", value: 25 } } }, evidenceFactIds: ["pointFact", "lineFact", "requestFact"] },
  ], constraints: [{ id: "footIncident", kind: "incident", entityIds: ["foot", "line"], evidenceFactIds: ["requestFact"] }],
  representationIntents: [{ id: "whole", kind: "graph", entityIds: ["P", "line", "foot"], evidenceFactIds: ["pointFact", "lineFact", "requestFact"] }],
  solveRequests: [{ id: "distanceAnswer", kind: "evaluate", expressionId: "distance", resultBinding: { turnPlanQuantityId: "distanceValue", symbol: "d", evidenceFactIds: ["requestFact"] } }],
};
const bound = pointLineSourceDocument(fullQuestion, full);
assert.ok(bound, "a full IR retains every fact, point, line, foot, dimension and incident obligation");
assert.deepEqual(visualObligationIssues(full, bound), []);
assert.ok(synthesizeFamilyScene({ question: fullQuestion, problemIR: full }), "the normal family admission carries the full IR");
const wrongAnswer = structuredClone(full);
wrongAnswer.expressions[2]!.root = { kind: "number", value: 25 };
assert.equal(pointLineSourceDocument(fullQuestion, wrongAnswer), null, "a correct figure cannot certify a different requested result");
const equalWrongRole = structuredClone(full);
equalWrongRole.expressions[0]!.id = "opaqueEqualZero";
assert.equal(pointLineSourceDocument(fullQuestion, equalWrongRole), null, "equal-valued dimensions do not bind an opaque source role");
const extra = structuredClone(full);
extra.entities.push({ id: "Q", kind: "point", label: "Q", evidenceFactIds: ["pointFact"] });
extra.representationIntents[0]!.entityIds.push("Q");
assert.equal(pointLineSourceDocument(fullQuestion, extra), null, "an extra body is never dropped or consumed by another body");
const footRenamed = structuredClone(full);
footRenamed.entities[2]!.label = "Q";
assert.equal(pointLineSourceDocument(fullQuestion, footRenamed), null, "an explicit requested H cannot be renamed Q");
const falseFoot = structuredClone(bound);
falseFoot.constructions.find(row => row.operator === "project")!.operator = "point";
falseFoot.constructions.find(row => row.id === "project_source_point")!.inputs = { x: 7, y: 1, coordinateSpace: "world" };
assert.ok(validatePointLineSourceInputs(falseFoot, fullQuestion).some(issue => issue.severity === "fatal"), "a different point on the line is not the perpendicular foot even without proof annotations");
const wrongTuple = structuredClone(bound);
wrongTuple.annotations.push({ id: "footClaim", kind: "label", targetIds: ["foot"], text: "H=(7,1)" });
assert.ok(validatePointLineSourceInputs(wrongTuple, fullQuestion).some(issue => issue.severity === "fatal"), "a false foot coordinate caption rejects independently");
const wrongIdentity = structuredClone(bound);
wrongIdentity.entities.find(entity => entity.id === "P")!.label = "Q(0,0)";
assert.ok(validatePointLineSourceInputs(wrongIdentity, fullQuestion).some(issue => issue.severity === "fatal"), "coordinate captions cannot mask a source point rename");
const nonfinite = structuredClone(bound);
nonfinite.annotations.push({ id: "badPoint", kind: "label", targetIds: ["P"], text: "P=(NaN,0)" });
assert.ok(validatePointLineSourceInputs(nonfinite, fullQuestion).some(issue => issue.severity === "fatal"), "malformed input is a fatal issue instead of throwing through admission");
console.log("W2 point-line: full-IR normal admission and eight source/identity/result rejection controls pass");
