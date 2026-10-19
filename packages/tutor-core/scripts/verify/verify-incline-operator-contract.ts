/** Compact and detailed incline requests must expose the inputs the engine requires. */
import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { buildSceneDocumentPlannerPrompt, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";

let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert.ok(value, message); }
const required = ["mass", "gravity", "angleDeg", "mu", "motion", "displayScale", "forceScale", "accelScale", "units"];
const values: Record<string, unknown> = { mass: 2, gravity: 10, angleDeg: 30, mu: 0.2, motion: "down", displayScale: 2, forceScale: 0.1, accelScale: 0.2, units: { mass: "kg", gravity: "m/s^2" } };
for (const contracts of [selectConstructionInputContracts(["incline_friction"], []), selectConstructionInputContracts(["incline_friction"]), buildSceneDocumentPlannerPrompt("Show the forces on a sliding block.")]) {
  const line = contracts.split("\n").find((candidate) => candidate.startsWith("- incline_friction: {"));
  check(line, "the incline contract is present");
  const offered = line.match(/^-[^{]+\{([^}]+)\}/)![1]!.split(",");
  for (const key of required) check(offered.includes(key), `the offered shape includes required ${key}`);
  check(line.includes('mass:"kg"') && line.includes('gravity:"m/s^2"'), "working units remain explicit in compact and detailed requests");
  const inputs = Object.fromEntries(offered.map((key) => { check(key in values, `${key} is an executable offered input`); return [key, values[key]]; }));
  const ids = ["incline", "body", "weight", "normal", "friction", "acceleration"];
  const doc: SceneDocument = {
    schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "contract" }, quantities: [],
    entities: ids.map((id, index) => ({ id, kind: index === 0 ? "segment" : index === 1 ? "point" : "vector", role: id })),
    constructions: [{ id: "forces", operator: "incline_friction", inputs, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "reveal-forces", entityIds: ids, dependsOn: [], narrationCue: "forces" }], teachingTimeline: [],
  };
  const compiled = compileSceneDocument(doc);
  check(compiled.ok && compiled.renderScene, `the offered input shape compiles: ${JSON.stringify(compiled.report.issues)}`);
}
console.log(`incline planner contract: ${checks} checks passed`);
