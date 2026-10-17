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
