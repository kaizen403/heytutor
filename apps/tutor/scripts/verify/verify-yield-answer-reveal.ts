import assert from "node:assert/strict";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  takeDeferredAnnotations,
  remainingDeferredAnnotations,
} from "@heytutor/drawing";
import type { SceneDocument, RenderScene } from "@heytutor/scene-engine";
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "computed range" },
  source: { question: "Find range R.", answerLabelEntityIds: ["range"] },
  quantities: [],
  entities: [{ id: "range", kind: "segment", role: "range", label: "R=80 m" }],
  constructions: [],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["range"],
  revealGroups: [
    {
      id: "setup",
      entityIds: ["range"],
      dependsOn: [],
      narrationCue: "The range R=80 m gives the answer.",
    },
  ],
  teachingTimeline: [],
};
const render: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: [
    {
      id: "path",
      entityId: "range",
      groupId: "setup",
      kind: "line",
      points: [
        { x: 500, y: 400 },
        { x: 900, y: 400 },
      ],
    },
    {
      id: "label",
      entityId: "range",
      groupId: "setup",
      kind: "label",
      points: [{ x: 700, y: 425 }],
      text: "R=80 m",
      labelPlacement: "absolute",
    },
  ],
  revealGroups: document.revealGroups,
  timeline: [],
  entityBounds: { range: { x: 500, y: 400, width: 400, height: 25 } },
};
const presentation = buildVerifiedDiagramPresentation(document, render);
assert(!presentation.diagram.promptAddon.includes("80"), "hidden answer is not advertised as readable ink");
assert(presentation.diagram.promptAddon.includes("with one of: none"), "hidden answer is not an available ANNOTATE target");
assert(
  presentation.introSegments
    .flatMap((s) => s.commands ?? [])
    .some((c) => c.type === "DRAW_LINE"),
  "verified geometry visible",
);
assert(
  !presentation.introSegments
    .flatMap((s) => s.commands ?? [])
    .some((c) => c.text?.includes("80")),
  "answer ink cannot leak into intro",
);
assert(
  !presentation.introSegments.some((s) => s.narration.includes("80")),
  "answer narration cannot leak into tour",
);
assert.equal(
  takeDeferredAnnotations(presentation.diagram, { entityIds: ["range"] })
    .length,
  0,
  "early focus cannot reveal answer",
);
assert(
  remainingDeferredAnnotations(presentation.diagram).some(
    (c) => c.text === "R=80 m",
  ),
  "answer released after teaching",
);
const ordinary = buildVerifiedDiagramPresentation(
  { ...document, source: { question: "Find range R." } },
  render,
);
assert(ordinary.diagram.promptAddon.includes('"R=80 m" = [FOCUS:range]'), "ordinary labels stay in the readable-parts list");
assert(
  ordinary.introSegments
    .flatMap((s) => s.commands ?? [])
    .some((c) => c.text === "R=80 m"),
  "off behavior unchanged",
);
// Annotation primitives carry their own id, not the group's entity id.
const annotatedDocument: SceneDocument = {
  ...document,
  source: { question: "Find range R.", answerLabelAnnotationIds: ["answer"] },
  entities: [{ id: "range", kind: "segment", role: "range", label: "R" }],
  annotations: [
    { id: "answer", kind: "label", targetIds: ["range"], text: "R=80 m" },
  ],
};
const annotatedRender: RenderScene = {
  ...render,
  primitives: render.primitives.map((primitive) =>
    primitive.kind === "label"
      ? {
          ...primitive,
          entityId: "answer",
          provenance: { annotationId: "answer" },
        }
      : primitive,
  ),
};
const annotated = buildVerifiedDiagramPresentation(
  annotatedDocument,
  annotatedRender,
);
assert(!annotated.diagram.promptAddon.includes("80"), "hidden annotation is not advertised as readable ink");
const mixed = buildVerifiedDiagramPresentation(annotatedDocument, {
  ...render,
  primitives: [
    render.primitives[0]!,
    { ...render.primitives[1]!, text: "R" },
    { ...render.primitives[1]!, id: "answer_label", provenance: { annotationId: "answer" } },
  ],
});
assert(mixed.diagram.promptAddon.includes('"R" = [FOCUS:range]'), "visible symbolic sibling remains readable");
assert(!mixed.diagram.promptAddon.includes("80"), "hidden answer cannot replace its visible symbolic sibling");
// Greptile #182 (verifiedScenePresentation.ts:354): the answer and the ordinary
// symbol share entityId "range". Naming "range" must release "R" now, never "R=80 m".
{
  // The timeline holds the ordinary symbol for an ANNOTATE beat, so it cannot be
  // pulled into the intro and must be released by naming the entity.
  const held = buildVerifiedDiagramPresentation({
    ...annotatedDocument,
    teachingTimeline: [{ id: "show_r", action: "annotate", targetId: "range", dependsOn: [], narrationIntent: "name the range" }],
  } as SceneDocument, {
    ...render,
    primitives: [
      render.primitives[0]!,
      { ...render.primitives[1]!, text: "R" },
      { ...render.primitives[1]!, id: "answer_label", provenance: { annotationId: "answer" } },
    ],
  });
  const introTexts = held.introSegments.flatMap((segment) => segment.commands ?? []).map((command) => command.text);
  assert(!introTexts.includes("R"), "fixture holds the ordinary symbol for its ANNOTATE beat");
  const taken = takeDeferredAnnotations(held.diagram, { entityIds: ["range"] }).map((command) => command.text);
  assert(introTexts.includes("R") || taken.includes("R"), "the ordinary symbol sharing the answer's entity is released when named");
  assert(!taken.some((text) => text?.includes("80")), "naming the entity never releases its answer");
  assert(remainingDeferredAnnotations(held.diagram).some((command) => command.text === "R=80 m"), "the answer still appears at completion");
}
assert(
  !annotated.introSegments.some((segment) => segment.narration.includes("80")),
  "answer annotation cannot leak through its owning group's narration",
);
assert(
  !annotated.introSegments
    .flatMap((segment) => segment.commands ?? [])
    .some((command) => command.text?.includes("80")),
  "answer annotation stays hidden during intro",
);
assert.equal(
  takeDeferredAnnotations(annotated.diagram, { entityIds: ["answer", "range"] })
    .length,
  0,
  "neither annotation nor target focus releases the answer",
);
assert(
  remainingDeferredAnnotations(annotated.diagram).some(
    (command) => command.text === "R=80 m",
  ),
  "answer annotation is released at completion",
);
console.log(
  "yield-answer-reveal: geometry now, answers after teaching, no focus/tour leak, off unchanged",
);

// Compiler-generated values must pass the same end-to-end staging boundary.
import { validateProductionSceneCandidate } from "@/features/tutor-session/lib/scene/productionSceneSelection";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
const question = "In Cartesian coordinates, A=(0,0), B=(3,4). Show the distance AB.";
const distancePlan = createFallbackTurnPlanV3(question);
distancePlan.unknowns = [{ id: "distance", symbol: "d", unit: "" }];
distancePlan.visualRequirement = "required";
for (const label of [undefined, "d"]) {
  const candidate: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "Distance" },
    quantities: [], entities: [{ id: "A", kind: "point", role: "endpoint A" }, { id: "B", kind: "point", role: "endpoint B" }, { id: "distance", kind: "segment", role: "distance AB", ...(label ? { label } : {}) }],
    constructions: [{ id: "aPoint", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["A"] }, { id: "bPoint", operator: "point", inputs: { x: 3, y: 4 }, outputs: ["B"] }, { id: "makeDistance", operator: "coordinate_distance", inputs: { a: "A", b: "B" }, outputs: ["distance"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["distance"],
    revealGroups: [{ id: "distanceGroup", entityIds: ["distance"], dependsOn: [], narrationCue: "Distance." }], teachingTimeline: [],
  };
  const accepted = validateProductionSceneCandidate({ candidate: candidate as unknown as Record<string, unknown>, question, turnPlan: distancePlan, yieldPolicy: "verified_parts" });
  assert(accepted.valid && accepted.value, JSON.stringify(accepted.errors));
  const stagedDistance = buildVerifiedDiagramPresentation(accepted.value.document, accepted.value.renderScene);
  assert(!stagedDistance.diagram.promptAddon.includes("d=5"), "computed answer must not enter the readable prompt");
  assert(!stagedDistance.introSegments.flatMap(s => s.commands ?? []).some(c => c.text?.includes("d=5")), "computed answer must not enter the intro");
  assert.equal(takeDeferredAnnotations(stagedDistance.diagram, { entityIds: ["distance"] }).length, 0);
  assert(remainingDeferredAnnotations(stagedDistance.diagram).some(c => c.text?.includes("d=5")), "computed answer remains available after teaching");
}
