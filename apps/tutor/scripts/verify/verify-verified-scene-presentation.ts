import type { RenderScene, SceneDocument } from "@heytutor/scene-engine";
import {
  isBlockedVerifiedDiagramCommand,
  parseDrawingCommands,
} from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/verifiedScenePresentation";

const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "test" },
  source: { question: "test" },
  quantities: [],
  entities: [
    { id: "a", kind: "point", role: "start", label: "A" },
    { id: "ab", kind: "segment", role: "edge" },
    { id: "ray", kind: "vector", role: "incident ray", label: "Ray 1" },
  ],
  constructions: [],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["a", "ab"],
  revealGroups: [
    { id: "setup", entityIds: ["a"], dependsOn: [], narrationCue: "show A" },
    { id: "edge", entityIds: ["ab"], dependsOn: ["setup"], narrationCue: "join the edge" },
  ],
  teachingTimeline: [
    { id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "mark A" },
    { id: "reveal_edge", action: "reveal", targetId: "edge", dependsOn: ["reveal_setup"], narrationIntent: "draw AB" },
    {
      id: "focus_ab",
      action: "focus",
      targetId: "ab",
      dependsOn: ["reveal_edge"],
      narrationIntent: "Segment AB is the edge we need for the rest of the argument.",
    },
  ],
};

const renderScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: [
    { id: "p_a", entityId: "a", groupId: "setup", kind: "point", points: [{ x: 450, y: 300 }], text: "A" },
    { id: "p_label_a", entityId: "a", groupId: "setup", kind: "label", points: [{ x: 450, y: 300 }], text: "A", labelPlacement: "above" },
    { id: "p_ab", entityId: "ab", groupId: "edge", kind: "line", points: [{ x: 450, y: 300 }, { x: 700, y: 300 }] },
    { id: "p_ab_label", entityId: "ab", groupId: "edge", kind: "label", points: [{ x: 700, y: 400 }], text: "AB", labelPlacement: "absolute" },
    { id: "p_result_label", entityId: "result", groupId: "edge", kind: "label", points: [{ x: 700, y: 400 }], text: "R_eq = 36 Ω", labelPlacement: "absolute" },
    { id: "p_ab_duplicate", entityId: "ab_duplicate", groupId: "edge", kind: "line", points: [{ x: 450, y: 300 }, { x: 700, y: 300 }] },
    { id: "p_ray", entityId: "ray", groupId: "edge", kind: "vector", points: [{ x: 450, y: 300 }, { x: 700, y: 250 }], text: "Ray 1" },
    { id: "p_ray_label", entityId: "ray", groupId: "edge", kind: "label", points: [{ x: 560, y: 270 }], text: "Ray 1" },
    { id: "p_verbose", entityId: "a", groupId: "setup", kind: "label", points: [{ x: 600, y: 500 }], text: "Image (real, inverted, magnified)" },
  ],
  revealGroups: document.revealGroups,
  timeline: document.teachingTimeline,
  entityBounds: {
    a: { x: 445, y: 295, width: 10, height: 10 },
    ab: { x: 450, y: 300, width: 250, height: 0 },
  },
};

const presentation = buildVerifiedDiagramPresentation(document, renderScene);
if (presentation.diagram.id !== "verified_scene") throw new Error("wrong verified diagram id");
if (presentation.introSegments.length !== 1) {
  throw new Error(`the verified intro must be one spoken beat, got ${presentation.introSegments.length}`);
}
if (presentation.introSegments.some((segment) => segment.narration.trim() === "")) throw new Error("scene stages must be narrated while drawing");
if (presentation.introSegments.some((segment) => !segment.command)) throw new Error("scene narration must remain paired with ink");
if (presentation.diagram.commands.filter((command) => command.type === "LABEL").length !== 3) throw new Error("duplicate entity labels were emitted");
const label = presentation.diagram.commands.find((command) => command.type === "LABEL" && command.text === "A");
if (!label) throw new Error("point label A is missing");
{
  // Placement is asserted as a requirement, not as a remembered coordinate:
  // the label must honour "above", stay attached to its point, and — the part
  // the old ten-offset guess got wrong — not sit on top of the AB line at
  // y=300 that runs right through the anchor.
  const [lx, ly] = label.params as [number, number, number];
  const height = 32;
  const width = 22;
  if (!(ly + height <= 300)) {
    throw new Error(`label A must sit above the anchor and clear the AB line, got y=${ly}`);
  }
  if (!(lx + width >= 450 - 40 && lx <= 450 + 40)) {
    throw new Error(`label A must stay attached to its point at x=450, got x=${lx}`);
  }
  if (!(300 - (ly + height) <= 60)) {
    throw new Error(`label A drifted too far from its point, gap ${300 - (ly + height)}`);
  }
}
const absoluteLabel = presentation.diagram.commands.find((command) => command.type === "LABEL" && command.text === "AB");
if (absoluteLabel?.params[1] !== 384) throw new Error("absolute scene-engine label position was changed by the adapter");
const measurementLabel = presentation.diagram.commands.find((command) => command.type === "LABEL" && command.text === "R_eq = 36 Ω");
if (!measurementLabel) throw new Error("measurement label is missing from the compiled command list");
if (measurementLabel.params[1] !== absoluteLabel?.params[1]) {
  throw new Error("adapter must not relocate absolute scene-engine labels");
}
if (presentation.diagram.commands.some((command) => command.text?.includes("magnified"))) throw new Error("verbose prose leaked into diagram labels");
if (presentation.diagram.commands.some((command) => command.text === "Ray 1")) throw new Error("helper entity label leaked into the diagram");
if (presentation.diagram.commands.filter((command) =>
  command.type === "DRAW_LINE" && command.visualStyle?.strokeRole !== "trace"
).length !== 1) throw new Error("duplicate primary geometry commands were emitted");
if (presentation.diagram.commands.some((command) =>
  command.visualStyle?.strokeRole === "trace" && command.semanticRef?.actionId
)) {
  throw new Error("timeline focus traces must not be baked into the opening figure");
}
if (presentation.introSegments.some((segment) =>
  (segment.commands ?? []).some((command) =>
    command.type === "CIRCLE_AROUND" || command.type === "LABEL" || command.type === "DIMENSION"
  )
)) {
  throw new Error("the opening figure must not circle, label, or dimension until the lecture names a part");
}
if (presentation.introSegments.some((segment) => /Segment AB is the edge/i.test(segment.narration))) {
  throw new Error("focus narration must wait for the lecture, not the intro");
}
if (!presentation.diagram.deferredAnnotations?.some((entry) =>
  entry.commands.some((command) => command.type === "LABEL" && command.text === "A")
)) {
  throw new Error("identity labels must be deferred for FOCUS during the lecture");
}
if (!presentation.diagram.promptAddon.includes("Do not emit DRAW_*")) throw new Error("teaching draw guard is missing");
if (!presentation.diagram.promptAddon.includes("[FOCUS:entity_id]")) throw new Error("semantic focus contract is missing");
if (!presentation.diagram.promptAddon.includes("[EMPHASIZE:last]")) throw new Error("work-area emphasize contract is missing");
if (presentation.diagram.promptAddon.includes("WRITE only for equations")) {
  throw new Error("teaching must be allowed to write names and definitions, not only equations");
}
if (!presentation.diagram.promptAddon.includes("student notebook")) {
  throw new Error("teaching must treat the work column as a notebook");
}
if (!presentation.diagram.deferredAnnotations?.some((entry) =>
  entry.commands.some((command) => command.text === "R_eq = 36 Ω")
)) {
  throw new Error("measurement labels must be deferred for staged ANNOTATE reveal");
}
if (presentation.introSegments.some((segment) =>
  (segment.commands ?? []).some((command) => command.text === "R_eq = 36 Ω")
)) {
  throw new Error("measurement labels must not ink during the intro reveal");
}

const nonMetricDocument: SceneDocument = {
  ...document,
  source: {
    question: "test",
    representationTier: "question_representation",
    nonMetric: true,
  },
};
const nonMetricPresentation = buildVerifiedDiagramPresentation(nonMetricDocument, renderScene);
if (!nonMetricPresentation.diagram.promptAddon.includes("intentionally non-metric")) {
  throw new Error("non-metric representation prompt guard is missing");
}
if (!nonMetricPresentation.diagram.promptAddon.includes("do not infer scale")) {
  throw new Error("teaching model may still infer metric claims from a fallback representation");
}
if (!nonMetricPresentation.diagram.caption?.includes("Do not read scale from this figure.")) {
  throw new Error("non-metric figures must show a caption that forbids reading scale");
}
if (nonMetricPresentation.diagram.name !== "source-grounded conceptual representation") {
  throw new Error("fallback representation was presented as an exact semantic scene");
}

const regionDocument: SceneDocument = {
  ...document,
  entities: [
    ...document.entities,
    { id: "bounded_region", kind: "function_region", role: "bounded region" },
  ],
  constructions: [{
    id: "construct_region",
    operator: "function_region",
    inputs: { upper: "upper_curve", lower: "lower_curve", xMin: -2, xMax: 2 },
    outputs: ["bounded_region"],
  }],
  revealGroups: [{ id: "region", entityIds: ["bounded_region"], dependsOn: [], narrationCue: "show the bounded region" }],
  teachingTimeline: [{
    id: "reveal_region",
    action: "reveal",
    targetId: "region",
    dependsOn: [],
    narrationIntent: "The shaded region is the area enclosed by the two curves.",
  }],
};
const regionScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: [
    {
      id: "p_region",
      entityId: "bounded_region",
      groupId: "region",
      kind: "polygon",
      points: [
        { x: 500, y: 180 },
        { x: 700, y: 180 },
        { x: 650, y: 340 },
        { x: 550, y: 340 },
      ],
    },
    {
      id: "p_region_label",
      entityId: "bounded_region",
      groupId: "region",
      kind: "label",
      points: [{ x: 1080, y: 300 }],
      text: "bounded region",
      labelPlacement: "absolute",
    },
  ],
  revealGroups: regionDocument.revealGroups,
  timeline: regionDocument.teachingTimeline,
  entityBounds: { bounded_region: { x: 500, y: 180, width: 200, height: 160 } },
};
const regionPresentation = buildVerifiedDiagramPresentation(regionDocument, regionScene);
const regionCommand = regionPresentation.diagram.commands.find((command) =>
  command.semanticRef?.entityId === "bounded_region");
if (regionCommand?.visualStyle?.fillRole !== "region") {
  throw new Error("verified function region did not receive a background fill role");
}
const rightEdgeLabel = regionPresentation.diagram.commands.find((command) =>
  command.type === "LABEL" && command.text === "bounded region");
if (!rightEdgeLabel || rightEdgeLabel.params[0]! <= 900) {
  throw new Error("expanded diagram viewport label was clamped into the legacy layout");
}

const parsedFocus = parseDrawingCommands("[STEP]notice segment AB. [FOCUS:ab][/STEP]");
const focusCommand = parsedFocus.commands[0];
if (focusCommand?.type !== "FOCUS" || focusCommand.text !== "ab") {
  throw new Error("semantic focus tag was not parsed");
}
if (isBlockedVerifiedDiagramCommand(focusCommand, presentation.diagram)) {
  throw new Error("verified semantic focus target was blocked");
}
const parsedSpotlight = parseDrawingCommands("[STEP]notice segment AB. [FOCUS:ab|spotlight][/STEP]").commands[0]!;
if (isBlockedVerifiedDiagramCommand(parsedSpotlight, presentation.diagram)) {
  throw new Error("FOCUS spotlight on a verified target was blocked");
}
const parsedEmphasize = parseDrawingCommands("[STEP]keep this. [EMPHASIZE:last][/STEP]").commands[0]!;
if (isBlockedVerifiedDiagramCommand(parsedEmphasize, presentation.diagram)) {
  throw new Error("EMPHASIZE must be allowed beside a verified diagram");
}
const invalidFocus = parseDrawingCommands("[STEP]notice this. [FOCUS:made_up_target][/STEP]").commands[0]!;
if (!isBlockedVerifiedDiagramCommand(invalidFocus, presentation.diagram)) {
  throw new Error("unknown semantic focus target was accepted");
}

const labelHeavyDocument: SceneDocument = {
  ...document,
  entities: Array.from({ length: 5 }, (_, index) => ({
    id: `quantity_${index + 1}`,
    kind: "point" as const,
    role: "measured quantity",
    label: `q${index + 1}`,
  })),
  requiredEntityIds: [],
  revealGroups: [{
    id: "quantities",
    entityIds: Array.from({ length: 5 }, (_, index) => `quantity_${index + 1}`),
    dependsOn: [],
    narrationCue: "show the measured quantities",
  }],
  teachingTimeline: [{
    id: "reveal_quantities",
    action: "reveal",
    targetId: "quantities",
    dependsOn: [],
    narrationIntent: "These labels identify the measured quantities.",
  }],
};
const labelHeavyScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: Array.from({ length: 5 }, (_, index) => ({
    id: `label_${index + 1}`,
    entityId: `quantity_${index + 1}`,
    groupId: "quantities",
    kind: "label" as const,
    points: [{ x: 470 + index * 90, y: 260 }],
    text: `q${index + 1}`,
    labelPlacement: "absolute" as const,
  })),
  revealGroups: labelHeavyDocument.revealGroups,
  timeline: labelHeavyDocument.teachingTimeline,
  entityBounds: {},
};
const labelHeavyPresentation = buildVerifiedDiagramPresentation(labelHeavyDocument, labelHeavyScene);
if (labelHeavyPresentation.introSegments.some((segment) =>
  (segment.commands ?? []).some((command) => command.type === "LABEL")
)) {
  throw new Error("quantity labels must not ink during the intro reveal");
}
if ((labelHeavyPresentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands)
  .filter((command) => command.type === "LABEL").length ?? 0) !== 5) {
  throw new Error("every verified label must stay available for FOCUS/ANNOTATE");
}

const pointFocusDocument: SceneDocument = {
  ...document,
  teachingTimeline: [
    ...document.teachingTimeline,
    {
      id: "focus_a",
      action: "focus",
      targetId: "a",
      dependsOn: ["reveal_setup"],
      narrationIntent: "This is A, the starting point.",
    },
  ],
};
const pointFocusPresentation = buildVerifiedDiagramPresentation(pointFocusDocument, {
  ...renderScene,
  timeline: pointFocusDocument.teachingTimeline,
});
if (pointFocusPresentation.introSegments.some((segment) =>
  /this is a, the starting point/i.test(segment.narration)
  || (segment.commands ?? []).some((command) => command.type === "CIRCLE_AROUND")
)) {
  throw new Error("point identity circling must wait for lecture FOCUS, not the intro");
}
if (!pointFocusPresentation.diagram.deferredAnnotations?.some((entry) =>
  entry.entityId === "a" && entry.commands.some((command) => command.type === "LABEL")
)) {
  throw new Error("point A must keep a deferred label for lecture FOCUS");
}

const encloseScene: RenderScene = {
  ...renderScene,
  primitives: [
    ...renderScene.primitives,
    {
      id: "ring_a",
      entityId: "ring_a",
      groupId: "setup",
      kind: "rectangle",
      points: [
        { x: 440, y: 290 },
        { x: 460, y: 290 },
        { x: 460, y: 310 },
        { x: 440, y: 310 },
      ],
      provenance: { annotation: "enclose", annotationId: "ring_a", transient: false },
    },
    {
      id: "shade_ab",
      entityId: "shade_ab",
      groupId: "edge",
      kind: "rectangle",
      points: [
        { x: 450, y: 290 },
        { x: 700, y: 290 },
        { x: 700, y: 310 },
        { x: 450, y: 310 },
      ],
      provenance: { annotation: "highlight", annotationId: "shade_ab", fillRole: "region", transient: false },
    },
  ],
};
const enclosePresentation = buildVerifiedDiagramPresentation(document, encloseScene);
if (!enclosePresentation.diagram.commands.some((command) => command.type === "CIRCLE_AROUND")) {
  throw new Error("enclose annotations must become CIRCLE_AROUND from compiled bounds");
}
if (!enclosePresentation.diagram.commands.some((command) => command.type === "HIGHLIGHT")) {
  throw new Error("highlight annotations must become HIGHLIGHT from compiled bounds");
}
if (enclosePresentation.introSegments.some((segment) =>
  (segment.commands ?? []).some((command) =>
    command.type === "CIRCLE_AROUND" || command.type === "HIGHLIGHT"
  )
)) {
  throw new Error("enclose and highlight ink must wait for lecture ANNOTATE, not the intro");
}

console.log("verified scene presentation verification passed");
