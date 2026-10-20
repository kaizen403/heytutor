import assert from "node:assert/strict";
import { ensureStudentFacingPointMarks, promoteAngleMarkVertices } from "../../src/document/namedPoints";

interface Fixture { id: string; option?: unknown; omit?: boolean; operator?: string; unowned?: boolean; first?: boolean; multiple?: boolean; sharedLegacy?: boolean; retain: boolean }
const fixtures: Fixture[] = [
  { id: "native-incident-vertex-keeps-later-scope", option: true, retain: true },
  { id: "native-incident-vertex-keeps-first-scope", option: true, first: true, retain: true },
  { id: "existing-multiple-scopes-are-not-reassigned", option: true, multiple: true, retain: true },
  { id: "legacy-omitted-option-retains-first-promotion", omit: true, retain: false },
  { id: "legacy-false-option-retains-first-promotion", option: false, retain: false },
  { id: "present-undefined-does-not-enable-retention", option: undefined, retain: false },
  { id: "nonboolean-does-not-enable-retention", option: "true", retain: false },
  { id: "ordinary-angle-keeps-legacy-helper-behavior", operator: "angle_mark", retain: false },
  { id: "world-angle-keeps-legacy-helper-behavior", operator: "space_right_angle_mark", retain: false },
  { id: "shared-legacy-vertex-keeps-legacy-promotion", option: true, sharedLegacy: true, retain: false },
  { id: "unowned-helper-is-outside-the-scope-repair", option: true, unowned: true, retain: false },
];
let failures = 0;
for (const fixture of fixtures) {
  try {
    const raw = { source: { question: "Show the existing construction." },
      entities: [{ id: "vertex", kind: "point", role: "helper point" }, { id: "mark", kind: "right_angle_mark", role: "native mark" }],
      constructions: [{ id: "point", operator: "point", inputs: { x: 1, y: 0 }, outputs: ["vertex"] },
        { id: "mark", operator: fixture.operator ?? "right_angle_mark", inputs: { vertex: "vertex", ...(fixture.omit ? {} : { incidentLineArms: fixture.option }) }, outputs: ["mark"] },
        ...(fixture.sharedLegacy ? [{ id: "legacy", operator: "angle_mark", inputs: { vertex: "vertex" }, outputs: ["legacy"] }] : [])],
      requiredEntityIds: ["vertex", "mark"],
      revealGroups: [{ id: "setup", entityIds: fixture.first ? ["vertex"] : [], dependsOn: [] },
        { id: "later", entityIds: fixture.unowned ? ["mark"] : ["vertex", "mark"], dependsOn: ["setup"] },
        ...(fixture.multiple ? [{ id: "last", entityIds: ["vertex"], dependsOn: ["later"] }] : [])],
    };
    const original = structuredClone(raw);
    const expectedGroups = structuredClone(raw.revealGroups);
    if (!fixture.retain && !expectedGroups[0]!.entityIds.includes("vertex")) expectedGroups[0]!.entityIds.push("vertex");
    for (const normalize of [promoteAngleMarkVertices, ensureStudentFacingPointMarks,
      (document: Record<string, unknown>) => ensureStudentFacingPointMarks(promoteAngleMarkVertices(document))]) {
      const normalized = normalize(structuredClone(raw));
      assert.deepEqual(normalized.revealGroups, expectedGroups, "scope repair may neither advance an owned incident vertex nor change legacy promotion");
      assert.deepEqual(normalized.entities, raw.entities); assert.deepEqual(normalized.constructions, raw.constructions, "no helper geometry is introduced");
      assert.deepEqual(normalized.requiredEntityIds, raw.requiredEntityIds);
    }
    assert.deepEqual(raw, original);
  } catch (error) { failures++; console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`); }
}
console.log(`constructor-law vertex scopes: ${fixtures.length - failures}/${fixtures.length} passed`);
if (failures) process.exitCode = 1;
