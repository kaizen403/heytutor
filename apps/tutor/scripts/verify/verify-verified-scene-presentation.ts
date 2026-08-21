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
if (presentation.introSegments.length !== 6) throw new Error("semantic reveal phases were not staged");
if (presentation.introSegments.some((segment) => segment.narration.trim() === "")) throw new Error("scene stages must be narrated while drawing");
if (presentation.introSegments.some((segment) => !segment.command)) throw new Error("scene narration must remain paired with ink");
if (presentation.diagram.commands.filter((command) => command.type === "LABEL").length !== 3) throw new Error("duplicate entity labels were emitted");
const label = presentation.diagram.commands.find((command) => command.type === "LABEL" && command.text === "A");
if (label?.params[0] !== 460 || label.params[1] !== 274) throw new Error("compiled label offset was not preserved");
const absoluteLabel = presentation.diagram.commands.find((command) => command.type === "LABEL" && command.text === "AB");
if (absoluteLabel?.params[1] !== 384) throw new Error("absolute scene-engine label position was changed by the adapter");
const relocatedLabel = presentation.diagram.commands.find((command) => command.type === "LABEL" && command.text === "R_eq = 36 Ω");
if (!relocatedLabel || relocatedLabel.params[1] === absoluteLabel?.params[1]) throw new Error("colliding absolute labels were not separated by the adapter");
if (presentation.diagram.commands.some((command) => command.text?.includes("magnified"))) throw new Error("verbose prose leaked into diagram labels");
if (presentation.diagram.commands.some((command) => command.text === "Ray 1")) throw new Error("helper entity label leaked into the diagram");
if (presentation.diagram.commands.filter((command) =>
  command.type === "DRAW_LINE" && command.visualStyle?.strokeRole !== "trace"
).length !== 1) throw new Error("duplicate primary geometry commands were emitted");
const plannedTrace = presentation.diagram.commands.find((command) =>
  command.visualStyle?.strokeRole === "trace"
);
if (plannedTrace?.semanticRef?.entityId !== "ab" || plannedTrace.semanticRef.actionId !== "focus_ab") {
  throw new Error("timeline focus did not preserve verified semantic ownership");
}
const focusNarration = presentation.introSegments
  .map((segment) => segment.narration)
  .find((narration) => /Segment AB is the edge/i.test(narration));
if (!focusNarration) {
  throw new Error("focus stages must speak the planner's narration intent");
}
if (/will use in the reasoning/i.test(focusNarration)) {
  throw new Error("focus stages must not inject the canned reasoning filler phrase");
}
if (/^Before we calculate/i.test(focusNarration)) {
  throw new Error("focus stages must not wrap planner prose in a stock preface");
}
if (!presentation.diagram.promptAddon.includes("Do not emit DRAW_*")) throw new Error("teaching draw guard is missing");
if (!presentation.diagram.promptAddon.includes("[FOCUS:entity_id]")) throw new Error("semantic focus contract is missing");

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
const labelSegments = labelHeavyPresentation.introSegments.filter((segment) =>
  segment.commands?.some((command) => command.type === "LABEL"),
);
if (labelSegments.length !== 2) {
  throw new Error("five verified labels must be split into two short spoken batches");
}
if (labelSegments.some((segment) => (segment.commands?.length ?? 0) > 4)) {
  throw new Error("a spoken label batch may not serialize more than four labels");
}
for (const segment of labelSegments) {
  for (const command of segment.commands ?? []) {
    if (command.text && !segment.narration.includes(command.text)) {
      throw new Error(`label narration did not name ${command.text}`);
    }
  }
}

console.log("verified scene presentation verification passed");
