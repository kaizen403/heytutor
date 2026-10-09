import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import { boundsOverlap, type LabelBounds } from "../../src/labels/labelEngine";
import type { RenderScene, SceneDocument } from "../../src/types";

export function kitDocument(
  question: string,
  operator: string,
  inputs: Record<string, unknown>,
  quantities: SceneDocument["quantities"] = [],
): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: `verified ${operator} figure` },
    source: { question },
    quantities,
    entities: [{ id: "kit", kind: "group", role: "chemistry kit figure" }],
    constructions: [{ id: "make_kit", operator, inputs, outputs: ["kit"] }],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ["kit"],
    revealGroups: [{ id: "figure", entityIds: ["kit"], dependsOn: [], narrationCue: "reveal the verified chemistry figure" }],
    teachingTimeline: [{ id: "reveal_figure", action: "reveal", targetId: "figure", dependsOn: [], narrationIntent: "show the chemistry" }],
  };
}

export function compileKit(document: SceneDocument): RenderScene {
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.report.issues));
  assert.ok(compiled.renderScene);
  assert.equal(compiled.report.issues.some((issue) => issue.severity === "fatal"), false);
  assert.ok(compiled.renderScene.primitives.length > 0, "kit must compile to visible primitives");
  assert.ok(compiled.renderScene.revealGroups.some((group) => group.entityIds.length > 0), "kit primitives must belong to a reveal group");
  assertReadableLabels(compiled.renderScene);
  return compiled.renderScene;
}

export function assertReadableLabels(scene: RenderScene): void {
  const labels = scene.primitives.filter((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && typeof primitive.text === "string");
  assert.ok(labels.length > 0 && labels.every((label) => label.text!.trim().length > 0), "scene must contain readable label text");
  for (let index = 0; index < labels.length; index += 1) {
    const first = labels[index]!;
    const firstBounds = first.provenance?.labelBounds as LabelBounds | undefined;
    assert.ok(firstBounds, `label ${first.entityId} needs verified ink bounds`);
    assert.ok(firstBounds!.x >= 400 && firstBounds!.x + firstBounds!.width <= 1160 && firstBounds!.y >= 0 && firstBounds!.y + firstBounds!.height <= 700, `label ${first.entityId} must fit the diagram zone`);
    for (const second of labels.slice(index + 1)) {
      const secondBounds = second.provenance?.labelBounds as LabelBounds | undefined;
      assert.ok(secondBounds, `label ${second.entityId} needs verified ink bounds`);
      assert.equal(boundsOverlap(firstBounds!, secondBounds!, 2), false, `labels ${first.entityId} and ${second.entityId} overlap`);
    }
  }
}

export function texts(scene: RenderScene): string[] {
  return scene.primitives.flatMap((primitive) => primitive.text ? [primitive.text] : []);
}

export function assertRejected(document: SceneDocument, messagePart: string): void {
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, false);
  assert.equal(compiled.renderScene, null, "invalid chemistry kit input must fail atomically");
  assert.ok(compiled.report.issues.some((issue) => issue.message.includes(messagePart)), JSON.stringify(compiled.report.issues));
}
