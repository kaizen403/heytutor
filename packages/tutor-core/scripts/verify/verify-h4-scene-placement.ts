import assert from "node:assert/strict";
import { buildSceneDocumentPlannerPrompt, compactSceneExampleDocument } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocument, repairSceneDocument, normalizeSceneDocumentModelOutput } from "../../src/planners/scenePlannerV2";
import { evaluateCalculusConstruction, validateCalculusConstruction, type CalculusEvaluationContext } from "../../../scene-engine/src/compile/calculusGeometry";
import { evaluateSpaceDerivationConstruction, spaceIncidenceResidual, spaceDirectionResidual, type SpaceDerivationEvaluationContext } from "../../../scene-engine/src/compile/spaceDerivations";
import type { SceneDocument, SceneIssue } from "../../../scene-engine/src/types";

let checks = 0;
function check(value: unknown, message: string): asserts value { assert(value, message); checks++; }
function close(actual: number, expected: number): void { check(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`); }
const operators = ["point", "space_frame", "space_point", "space_line", "plane", "space_project", "space_intersection", "space_segment", "space_vector", "parametric_curve", "curve_anchor", "complex_point"];
function contract(prompt: string): void {
  check(/coordinate-free 3D.*off-axis/i.test(prompt), "coordinate-free representatives need off-axis placement");
  check(/preserve.*(?:source|numeric).*coordinates.*equations.*axes/i.test(prompt), "off-axis guidance must preserve explicit spatial givens and named axes");
  check(prompt.includes("|z-a|") && prompt.includes("|z+w|") && prompt.includes("-w"), "complex distance uses the signed geometric reference");
  check(/curve_anchor[^\n]*actual[^\n]*(?:parameter|x\/t\/theta)/i.test(prompt), "actual-parameter rule must survive every contract form");
  check(/curve_anchor[^\n]*unit[^\n]*domain/i.test(prompt), "anchor parameter uses the curve's declared unit and domain");
  check(prompt.includes("0.5235987755982988"), "radian example must survive compaction and repair");
  check(prompt.includes("0.583") && prompt.includes("0.417"), "domain fractions must be explicitly disallowed for the angular example");
  check(prompt.includes("never a domain fraction"), "legal fractional-valued actual parameters remain allowed");
}
for (const detailed of [undefined, [], ["space_line", "curve_anchor"]]) contract(buildSceneDocumentPlannerPrompt("Explain a geometric setup.", { constructionOperators: operators }, detailed));

const questions = [
  "Explain when two lines in space are coplanar.",
  "Explain the line where two planes intersect and the distance of a point from a plane.",
  "Draw the x axis and the plane z=0. Mark P=(1,2,2) and project it onto z=0.",
  "For x=6 cos theta, y=2 sin theta, -pi<=theta<=pi, mark theta=pi/6 and theta=-pi/6.",
  "For x=t^2,y=t+1 on 10<=t<=20 seconds, mark t=12 seconds.",
  "For x=t^2,y=t+1 on 0<=t<=2 seconds, mark t=0.25 seconds.",
  "If |z|=2, find extrema of |z+6-8i| and the corresponding z values.",
];
const previous = { schemaVersion: "scene-document/v2", constructions: [
  { id: "line", operator: "space_line", inputs: { frame: "F", point: [0, 0, 0], direction: [1, 0, 0] }, outputs: ["L"] },
  { id: "anchor", operator: "curve_anchor", inputs: { curve: "C", at: 0.417 }, outputs: ["Q"] },
] };
const originalFetch = globalThis.fetch;
let mockRequests = 0, maxInitialChars = 0, maxRepairChars = 0;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), "http://mock.invalid/h4-scene");
  const body = JSON.parse(String(init?.body));
  const messages = body.messages as Array<{ content: string }>;
  const prompt = messages.map(message => message.content).join("\n");
  contract(prompt);
  const phase = new Headers(init?.headers).get("x-scene-planner-phase");
  const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
  check(chars <= (phase === "repair" ? 27_000 : 24_500), "original request character caps remain unchanged");
  if (phase === "repair") maxRepairChars = Math.max(maxRepairChars, chars); else maxInitialChars = Math.max(maxInitialChars, chars);
  check(questions.some(question => messages[1]!.content.includes(`QUESTION\n${question}\n`)), "complete original source must remain in every request");
  mockRequests++;
  return Response.json({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only", reason: "mock only" } }) } }] });
};
try {
  for (const question of questions) {
    await planSceneDocument(question, { proxyUrl: "http://mock.invalid/h4-scene", constructionOperators: operators });
    await planSceneDocument(question, { proxyUrl: "http://mock.invalid/h4-scene" });
    await repairSceneDocument(question, previous, [{ code: "assertion_failed", message: "Rebuild from source facts without domain fractions or incidental axes", severity: "fatal" }], { proxyUrl: "http://mock.invalid/h4-scene" });
  }
  assert.equal(mockRequests, questions.length * 3); checks++;
} finally { globalThis.fetch = originalFetch; }

// These deterministic oracles establish what the requested parameters mean.
// They do not claim that a model obeys the prompt or a wrong fraction rejects:
// 0.583 and 0.417 are legal different parameters on this same curve.
const curves = new Map<string, unknown>([
  ["ellipse", { kind: "path", sampledCurve: { curveKind: "parametric", parameterMin: -Math.PI, parameterMax: Math.PI, evaluate: (t: number) => ({ x: 6 * Math.cos(t), y: 2 * Math.sin(t) }) } }],
  ["time", { kind: "path", sampledCurve: { curveKind: "parametric", parameterMin: 10, parameterMax: 20, evaluate: (t: number) => ({ x: t * t, y: t + 1 }) } }],
  ["fractional-time", { kind: "path", sampledCurve: { curveKind: "parametric", parameterMin: 0, parameterMax: 2, evaluate: (t: number) => ({ x: t * t, y: t + 1 }) } }],
]);
const calculus: CalculusEvaluationContext = { number: Number, point: () => ({ x: 0, y: 0 }), geometry: value => curves.get(String(value)) };
for (const at of [Math.PI / 6, -Math.PI / 6]) {
  const [anchor] = evaluateCalculusConstruction("curve_anchor", { curve: "ellipse", at }, calculus);
  check(anchor?.kind === "point", "curve anchor is a derived point");
  close(anchor.calculusAnchor!.parameter, at); close(anchor.point.x, 3 * Math.sqrt(3)); close(anchor.point.y, at > 0 ? 1 : -1);
}
curves.set("wide-ellipse", { kind: "path", sampledCurve: { curveKind: "parametric", parameterMin: -2 * Math.PI, parameterMax: 2 * Math.PI, evaluate: (t: number) => ({ x: 6 * Math.cos(t), y: 2 * Math.sin(t) }) } });
const [sameParameter] = evaluateCalculusConstruction("curve_anchor", { curve: "wide-ellipse", at: -Math.PI / 6 }, calculus);
check(sameParameter?.kind === "point", "changing the display domain preserves the source parameter"); close(sameParameter.point.y, -1);
for (const at of [0.583, 0.417]) {
  const [wrong] = evaluateCalculusConstruction("curve_anchor", { curve: "ellipse", at }, calculus);
  check(wrong?.kind === "point" && wrong.point.y > 0, "fractions do not encode opposite signs on a symmetric angular domain");
  check(wrong.kind === "point" && Math.abs(Math.abs(wrong.point.y) - 1) > 0.05, "fraction mutation differs from the requested angular anchor");
}
const [timeAnchor] = evaluateCalculusConstruction("curve_anchor", { curve: "time", at: 12 }, calculus);
check(timeAnchor?.kind === "point", "time parameter is an actual source time"); close(timeAnchor.point.x, 144); close(timeAnchor.point.y, 13);
const [fractionalTime] = evaluateCalculusConstruction("curve_anchor", { curve: "fractional-time", at: 0.25 }, calculus);
check(fractionalTime?.kind === "point", "an actual fractional source parameter is valid"); close(fractionalTime.calculusAnchor!.parameter, 0.25); close(fractionalTime.point.x, 0.0625); close(fractionalTime.point.y, 1.25);
assert.throws(() => evaluateCalculusConstruction("curve_anchor", { curve: "time", at: 0.2 }, calculus), /domain/); checks++;
assert.throws(() => evaluateCalculusConstruction("curve_anchor", { curve: "ellipse", at: 30 }, calculus), /domain/); checks++;
const unitDocument: SceneDocument = { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "parameter units" }, source: {}, quantities: [],
  entities: [{ id: "C", kind: "polyline" }, { id: "A", kind: "point" }], constructions: [
    { id: "curve", operator: "parametric_curve", inputs: { xExpression: "t^2", yExpression: "t+1", tMin: { value: 10, unit: "s" }, tMax: { value: 20, unit: "s" } }, outputs: ["C"] },
    { id: "anchor", operator: "curve_anchor", inputs: { curve: "C", at: { value: 12, unit: "s" } }, outputs: ["A"] },
  ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["C", "A"], revealGroups: [], teachingTimeline: [] };
for (const [unit, accepted] of [["s", true], ["ms", false], ["rad", false]] as const) {
  const copy = structuredClone(unitDocument); copy.constructions[1]!.inputs.at = { value: 12, unit };
  const issues: SceneIssue[] = [];
  const producers = new Map(copy.constructions.flatMap(call => call.outputs.map(output => [output, call] as const)));
  validateCalculusConstruction(copy.constructions[1]!, 1, copy, producers, issues);
  assert.equal(!issues.some(issue => issue.severity === "fatal"), accepted); checks++;
}

// Representative placements derive their feet and intersections in 3D.
// Explicit source coordinates and axis directions remain exact neighbors.
const world = new Map<string, unknown>([
  ["F", { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 1 } }],
  ["P", { kind: "point", point: { x: 0, y: 0 }, space: { x: 3, y: 4, z: 5 }, spaceFrameId: "F" }],
  ["plane", { kind: "path", spacePlane: { frameId: "F", point: { x: 1, y: 2, z: 2 }, normal: { x: 2, y: 1, z: 3 } } }],
  ["plane2", { kind: "path", spacePlane: { frameId: "F", point: { x: 2, y: 1, z: 3 }, normal: { x: 1, y: 3, z: 2 } } }],
]);
const space: SpaceDerivationEvaluationContext = { number: Number, point: () => ({ x: 0, y: 0 }), geometry: value => world.get(String(value)) };
const [foot] = evaluateSpaceDerivationConstruction("space_project", { frame: "F", point: "P", onto: "plane" }, space);
check(foot?.kind === "point", "off-axis projection is derived");
close(foot.space.x, 6 / 7); close(foot.space.y, 41 / 14); close(foot.space.z, 25 / 14);
close(spaceIncidenceResidual(foot, world.get("plane"))!, 0);
world.set("foot", foot);
const [normal] = evaluateSpaceDerivationConstruction("space_segment", { frame: "F", a: "foot", b: "P" }, space);
close(spaceDirectionResidual(normal, world.get("plane"), "perpendicular")!, 0);
const [intersection] = evaluateSpaceDerivationConstruction("space_intersection", { frame: "F", first: "plane", second: "plane2", tMin: -2, tMax: 2 }, space);
check(intersection?.kind === "path" && intersection.spaceLine !== undefined, "generic planes derive their intersection line");
check(Object.values(intersection.spaceLine.direction).every(component => Math.abs(component) > 1e-6), "the representative intersection is not a coordinate-axis direction");
const meetingPoint = { kind: "point", point: { x: 0, y: 0 }, space: intersection.spaceLine.point, spaceFrameId: "F" };
close(spaceIncidenceResidual(meetingPoint, world.get("plane"))!, 0); close(spaceIncidenceResidual(meetingPoint, world.get("plane2"))!, 0);
const numeric = { constructions: [
  { id: "point", operator: "space_point", inputs: { frame: "F", x: 1, y: 2, z: 2 }, outputs: ["P"] },
  { id: "axis", operator: "space_line", inputs: { frame: "F", point: [0, 0, 0], direction: [1, 0, 0] }, outputs: ["L"] },
  { id: "plane", operator: "plane", inputs: { frame: "F", a: 0, b: 0, c: 1, d: 0 }, outputs: ["Z"] },
] };
assert.deepEqual(compactSceneExampleDocument(numeric).constructions, numeric.constructions); checks++;
assert.deepEqual(normalizeSceneDocumentModelOutput(numeric, questions[2]!).constructions, numeric.constructions); checks++;
console.log(`H4 scene placement: ${checks} full/compact/repair and deterministic-neighbor checks; ${mockRequests} mocked requests, 0 network/model calls; max initial ${maxInitialChars}, repair ${maxRepairChars} chars`);
