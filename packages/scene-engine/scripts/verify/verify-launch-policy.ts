import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import { prepareVerifiedParts } from "../../src/compile/verifiedParts";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
const document: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question: "Show the unit vector i." },
  visualDecision: { mode: "scene", reason: "Vector." }, quantities: [],
  entities: [{ id: "o", kind: "point", role: "origin" }, { id: "v", kind: "vector", role: "vector", label: "i" }],
  constructions: [
    { id: "make_o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] },
    { id: "make_v", operator: "vector", inputs: { start: "o", direction: [1, 2], length: Math.sqrt(5) }, outputs: ["v"] },
  ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["o", "v"],
  revealGroups: [{ id: "setup", entityIds: ["o", "v"], dependsOn: [], narrationCue: "Vector." }], teachingTimeline: [],
};
const original = structuredClone(document);
const legacy = compileSceneDocument(document);
assert(legacy.ok, "unset flag retains the pre-rollout compiler");
assert.deepEqual(compileSceneDocument(document, { yieldPolicy: "off" }), legacy);
const enabled = compileSceneDocument(document, { yieldPolicy: "verified_parts" });
assert(!enabled.ok && enabled.report.issues.some(i => i.code === "declared_geometry_contradiction"));
assert.deepEqual(document, original, "compiler options never mutate the input");
const admitted = prepareVerifiedParts(document, { enabled: true }).document;
const saved = validateSceneDocument(JSON.parse(JSON.stringify(admitted))).document;
assert(saved, "saved scene retains schema validity");
assert.deepEqual(compileSceneDocument(saved), enabled, "persistence recompiles the admitted policy");
assert.deepEqual(compileSceneDocument(saved, { yieldPolicy: "off" }), legacy, "explicit off wins over saved marker");
const offAdmission = prepareVerifiedParts(admitted, { enabled: false }).document;
assert.equal(offAdmission.source.diagramYieldPolicy, undefined, "off admission strips any model-supplied marker");
assert.deepEqual(compileSceneDocument(offAdmission), legacy);
console.log("launch policy: default off, explicit opt-in, immutable options, persisted recompilation and off override pass");
