/**
 * Admission of a complete authored scene and delivery of the operators needed
 * to author it are deterministic. Model adherence is measured on held-out
 * rows separately; this gate does not claim a mocked response proves that.
 */
import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, SCENE_DOCUMENT_PLANNER_PROMPT } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocument, repairSceneDocument } from "../../src/planners/scenePlannerV2";

let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}
const cases = [
  {
    question: "Explain electromagnetic waves and their characteristics.",
    operators: ["space_frame", "space_point", "space_vector", "space_cross"],
    guidance: "E cross B",
  },
  {
    question: "Explain electric dipole field and superposition at an observation point.",
    operators: ["electric_field", "vector_sum", "vector_scale", "vector_projection", "circle_tangent_at"],
    guidance: "each contribution",
  },
  {
    question: "Explain the transformer circuit and its primary and secondary coils.",
    operators: ["symbol", "connect", "circle", "rectangle", "polygon"],
    guidance: "every source, load, instrument",
  },
  {
    question: "Explain the magnetic field due to a solenoid.",
    operators: ["rectangle", "polygon", "circle_tangent_at"],
    guidance: "current sense",
  },
] as const;
const capabilities = cases.map((item) => inferSceneCapabilities(item.question, {
  turnPlan: { visualRequirement: "required", givens: [] },
}));
for (const [index, item] of cases.entries()) {
  const caps = capabilities[index]!;
  const prompt = buildSceneDocumentPlannerPrompt(item.question, caps);
  if (index === 0) check(caps.proofPredicates.includes("angle_between"), "E/B/propagation can prove directed sense, not only perpendicularity");
  check(prompt.length + 800 <= 24_500, `${item.question}: initial transport budget`);
  check(prompt.includes(item.guidance), `${item.question}: composition invariant reaches planner`);
  for (const operator of item.operators) {
    check(caps.constructionOperators.includes(operator), `${item.question}: ${operator} is offered`);
    check(prompt.includes(`- ${operator}: {`) || new RegExp(`^- [a-z_/]*${operator}[a-z_/]*: \\{`, "m").test(prompt), `${item.question}: ${operator} contract reaches planner`);
  }
}
for (const rule of [
  "every requested state, member and view",
  "one representative per requested state",
  "Narration cannot replace required geometry or direction",
]) check(SCENE_DOCUMENT_PLANNER_PROMPT.includes(rule), `${rule}: global completeness contract`);

// A source-faithful physical frame needs all E, B and k. Derive B=k×E,
// then verify E×B points along k; reversing B preserves perpendicularity but
// must fail the directed relation. The oracle is (0,0,1)×(0,-1,0)=(1,0,0).
const scene: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "normalized physical-frame representative" },
  source: { question: "Draw an electromagnetic wave travelling along +x with E along +z, deriving B from E and propagation.", representationTier: "qualitative_verified", nonMetric: true },
  quantities: [],
  entities: [
    { id: "anchor", kind: "point" }, { id: "frame", kind: "polyline" },
    { id: "O", kind: "point" }, { id: "pk", kind: "point" }, { id: "pe", kind: "point" },
    { id: "k", kind: "vector", role: "propagation", label: "k" },
    { id: "E", kind: "vector", role: "electric field", label: "E" },
    { id: "B", kind: "vector", role: "magnetic field", label: "B" },
    { id: "S", kind: "vector", role: "energy propagation", label: "S" },
  ],
  constructions: [
    { id: "anchor_make", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["anchor"] },
    { id: "frame_make", operator: "space_frame", inputs: { origin: "anchor", axisLength: 1.4 }, outputs: ["frame"] },
    { id: "origin_make", operator: "space_point", inputs: { frame: "frame", x: 0, y: 0, z: 0 }, outputs: ["O"] },
    { id: "pk_make", operator: "space_point", inputs: { frame: "frame", x: 1, y: 0, z: 0 }, outputs: ["pk"] },
    { id: "pe_make", operator: "space_point", inputs: { frame: "frame", x: 0, y: 0, z: 1 }, outputs: ["pe"] },
    { id: "k_make", operator: "space_vector", inputs: { frame: "frame", start: "O", end: "pk" }, outputs: ["k"] },
    { id: "E_make", operator: "space_vector", inputs: { frame: "frame", start: "O", end: "pe" }, outputs: ["E"] },
    { id: "B_make", operator: "space_cross", inputs: { frame: "frame", a: "k", b: "E" }, outputs: ["B"] },
    { id: "S_make", operator: "space_cross", inputs: { frame: "frame", a: "E", b: "B", scale: 0.7 }, outputs: ["S"] },
  ],
  relations: [],
  assertions: [
    { id: "transverse", predicate: "perpendicular", entities: ["E", "B"], expected: true, severity: "fatal" },
    { id: "sense", predicate: "angle_between", entities: ["S", "k"], expected: { value: 0, unit: "degree" }, severity: "fatal" },
  ],
  annotations: [], requiredEntityIds: ["frame", "O", "pk", "pe", "k", "E", "B", "S"],
  revealGroups: [{ id: "fields", entityIds: ["frame", "O", "pk", "pe", "k", "E", "B", "S"], dependsOn: [] }],
  teachingTimeline: [],
};
function compile(document: SceneDocument) {
  const validated = validateSceneDocument(document);
  return validated.document ? compileSceneDocument(validated.document) : null;
}
const positive = compile(scene);
check(positive?.ok, `complete physical-frame scene compiles: ${JSON.stringify(positive?.report.issues ?? validateSceneDocument(scene).report.issues)}`);
for (const id of ["E", "B", "k"]) check(positive?.renderScene?.primitives.some((mark) => mark.entityId === id), `${id} is actual physical ink`);
const reversed = structuredClone(scene);
reversed.constructions.find((item) => item.id === "B_make")!.inputs = { frame: "frame", a: "E", b: "k" };
check(!compile(reversed)?.ok, "reversed B cannot prove E×B along propagation");

// Exercise the actual initial/repair transport, with fetch explicitly mocked.
const originalFetch = globalThis.fetch;
const requests: Array<{ messages: Array<{ content: string }> }> = [];
globalThis.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(scene) } }] }), { status: 200 });
};
try {
  const options = { ...capabilities[0]!, proxyUrl: "http://planner.test", timeoutMs: 2000 };
  await planSceneDocument(cases[0].question, options);
  await repairSceneDocument(cases[0].question, scene, [{ code: "assertion_failed", message: "Preserve all three physical directions.", severity: "fatal" }], options);
  check(requests.length === 2, "initial and repair requests are both captured");
  for (const [index, request] of requests.entries()) {
    const content = request.messages.map((message) => message.content).join("\n");
    check(content.length <= (index === 0 ? 24_500 : 27_000), "completeness contracts keep transport budgets");
    for (const operator of cases[0].operators) check(content.includes(`- ${operator}: {`), `${operator} survives ${index === 0 ? "initial" : "repair"} transport`);
    check(content.includes("every requested state, member and view"), "multi-state contract survives transport");
  }
} finally { globalThis.fetch = originalFetch; }
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`physics completeness contract: ${checks} checks passed (offers, transport, physical-frame positive/negative)`);
