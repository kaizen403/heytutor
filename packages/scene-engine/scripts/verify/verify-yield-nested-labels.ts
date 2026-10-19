import assert from "node:assert/strict";
import { validateLabelOwnerTruth } from "../../src/compile/labelOwnerTruth";
import type { RenderPrimitive, SceneDocument } from "../../src/types";

const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  source: { question: "Identify the two nested circular regions." },
  visualDecision: { mode: "scene", reason: "Nested regions." },
  quantities: [],
  entities: [{ id: "inner", kind: "circle", role: "inner region", label: "cavity" }],
  constructions: [], relations: [], assertions: [], annotations: [],
  requiredEntityIds: [], revealGroups: [], teachingTimeline: [],
};

for (const scale of [0.5, 1, 3]) {
  for (const center of [{ x: 0, y: 0 }, { x: 720, y: 350 }]) {
    const inner: RenderPrimitive = { id: "inner", entityId: "inner", groupId: "first", kind: "circle", points: [center], radius: 40 * scale };
    const outer: RenderPrimitive = { id: "outer", entityId: "outer", groupId: "later", kind: "circle", points: [center], radius: 120 * scale };
    const label: RenderPrimitive = { id: "name", entityId: "inner", groupId: "first", kind: "label", text: "cavity", points: [{ x: center.x, y: center.y - 52 * scale }] };
    const issues = validateLabelOwnerTruth(document, [inner, outer, label]);
    assert.equal(issues.length, 1, "an inner-region name in a surrounding region needs an explicit attachment");
    const exterior = { ...label, points: [{ x: center.x, y: center.y - 240 * scale }] };
    assert.equal(validateLabelOwnerTruth(document, [inner, outer, exterior]).length, 1, "an inner-region name beyond the enclosing boundary still needs attachment");
    assert.equal(issues[0]?.path, "entities[0].label");
    assert.equal(issues[0]?.failureKind, "proof");
    assert.equal(validateLabelOwnerTruth(document, [inner, outer, { ...label, points: [center] }]).length, 0, "an interior label names its own region");
    assert.equal(validateLabelOwnerTruth(document, [inner, label]).length, 0, "an isolated circle keeps its nearby exterior name");
    assert.equal(validateLabelOwnerTruth(document, [inner, { ...outer, points: [{ x: center.x + 110 * scale, y: center.y }] }, label]).length, 0, "overlap alone does not prove enclosure");
    const tether: RenderPrimitive = { id: "name_leader", entityId: "inner", groupId: "first", kind: "line", points: [{ x: center.x, y: center.y - 40 * scale }, label.points[0]!], provenance: { labelLeader: true } };
    assert.equal(validateLabelOwnerTruth(document, [inner, outer, { ...label, provenance: { usesLeader: true } }, tether]).length, 0, "an explicit boundary attachment disambiguates the nested owner");
  }
}
console.log("yield nested labels: enclosing regions cannot silently take an inner region's name");
