import assert from "node:assert/strict";
import { validateSceneDocument } from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput, planSceneDocumentWithRepair } from "../../src/planners/scenePlannerV2";
import { buildSceneDocumentPlannerPrompt } from "../../src/planners/scenePlannerV2Prompt";

// Synthetic reproduction of a captured malformed relation declaration. No
// source measurements or identities from the captured lesson are retained.
const question = "Show a point on a line.";
const candidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "source incidence" }, source: { question }, quantities: [],
  entities: [{ id: "P", kind: "point" }, { id: "line", kind: "line" }],
  constructions: [
    { id: "makeP", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["P"] },
    { id: "makeLine", operator: "line", inputs: { point: "P", direction: [1, 0] }, outputs: ["line"] },
  ],
  relations: [{ predicate: "on", entities: ["P", "line"] }],
  assertions: [], annotations: [], requiredEntityIds: ["P", "line"], revealGroups: [{ id: "setup", entityIds: ["P", "line"], dependsOn: [] }], teachingTimeline: [],
};
const nativeFetch = globalThis.fetch;
try {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    // The provider stub follows exactly the schema the real request names.
    // Without a Relation contract it reproduces the captured shorthand.
    const prompt = JSON.parse(String(init?.body)).messages.at(-1).content as string;
    const response = prompt.includes("Relation:{id,predicate,entities,value?}")
      ? { ...candidate, relations: [{ id: "onP", ...candidate.relations[0]! }] }
      : candidate;
    return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] });
  };
  const planned = await planSceneDocumentWithRepair(question, document => {
    const result = validateSceneDocument(document);
    return { valid: !!result.document, errors: result.report.issues, value: result.document };
  }, { proxyUrl: "https://synthetic.invalid/chat", timeoutMs: 1000 });
  assert.ok(planned?.validation.valid, `request must specify relation ids without consuming all repairs: ${JSON.stringify(planned?.validation.errors)}`);
  assert.equal(calls, 2, "both initial candidates survive without schema-only repairs");
  assert.equal(planned.validation.value!.relations.length, 1, "retain the relation");
  assert.deepEqual(planned.validation.value!.relations[0]!.entities, ["P", "line"]);
} finally { globalThis.fetch = nativeFetch; }
const normalize = (relations: unknown[]) => normalizeSceneDocumentModelOutput({ ...candidate, relations }, question);
const once = normalize(candidate.relations);
assert.deepEqual(normalizeSceneDocumentModelOutput(once, question), once, "idempotent");
assert.deepEqual(candidate.relations, [{ predicate: "on", entities: ["P", "line"] }], "do not mutate callers");
const collision = normalize([{ id: "relation_1", predicate: "on", entities: ["P", "line"] }, candidate.relations[0]]);
assert.equal(validateSceneDocument(collision).document, null, "normalization cannot admit a missing relation id");
for (const relations of [
  [{ id: "P", predicate: "on", entities: ["P", "line"] }],
  [{ predicate: "on", entities: ["P", "line"] }],
  [{ id: "", predicate: "on", entities: ["P", "line"] }],
  [{ predicate: "on", entities: ["missing", "line"] }],
]) assert.equal(validateSceneDocument(normalize(relations)).document, null, "explicit invalid ids and references remain invalid");
assert.match(buildSceneDocumentPlannerPrompt(question), /Relation:\{id,predicate,entities,value\?\}/, "request names the full relation shape");
console.log("scene relation contract: actual request names complete relation identity; malformed captures and invalid references remain declined");
