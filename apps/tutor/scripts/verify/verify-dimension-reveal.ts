import type { RenderScene, SceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { focusTraceCommands, isDsaConstructionGuide, isFocusTraceInk } from "../../features/tutor-session/lib/scene/diagramInk";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "measured rod" },
  source: { question: "A rod has length L. Show its measured endpoints." },
  quantities: [],
  entities: [
    { id: "rod", kind: "segment", role: "rod" },
    { id: "length", kind: "dimension", role: "length", label: "L" },
  ],
  constructions: [],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["rod", "length"],
  revealGroups: [{ id: "setup", entityIds: ["rod", "length"], dependsOn: [], narrationCue: "Here is the rod." }],
  teachingTimeline: [],
};

const scene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: [
    { id: "rod_ink", entityId: "rod", groupId: "setup", kind: "line", points: [{ x: 750, y: 180 }, { x: 750, y: 420 }] },
    { id: "length_bar", entityId: "length", groupId: "setup", kind: "dimension", points: [{ x: 800, y: 180 }, { x: 800, y: 420 }], provenance: { measurementRole: "bar" } },
    { id: "length_witness_a", entityId: "length", groupId: "setup", kind: "line", points: [{ x: 750, y: 180 }, { x: 805, y: 180 }], provenance: { measurementRole: "witness", dashed: true, strokeRole: "construction" } },
    { id: "length_witness_b", entityId: "length", groupId: "setup", kind: "line", points: [{ x: 750, y: 420 }, { x: 805, y: 420 }], provenance: { measurementRole: "witness", dashed: true, strokeRole: "construction" } },
    { id: "length_label", entityId: "length", groupId: "setup", kind: "label", points: [{ x: 835, y: 300 }], text: "L", labelPlacement: "absolute" },
  ],
  revealGroups: document.revealGroups,
  timeline: [],
  entityBounds: { rod: { x: 750, y: 180, width: 1, height: 240 }, length: { x: 750, y: 180, width: 85, height: 240 } },
};

// Before the measurement is named, none of its bar, witnesses, or label may
// leak into the opening figure and imply a partly marked distance.
const unnamed = buildVerifiedDiagramPresentation(document, scene);
assert(unnamed.introSegments.every((segment) => (segment.commands ?? []).every((command) => command.semanticRef?.entityId !== "length")), "measurement witnesses appeared before the distance was named");
const withheld = unnamed.diagram.deferredAnnotations?.find((entry) => entry.entityId === "length");
assert(withheld?.commands.length === 4, "the measurement must withhold its two witnesses, bar, and label together");

// Naming the dimension releases the complete measurement, with the original
// point-to-point witness coordinates intact in the drawing transport.
const namedDocument: SceneDocument = {
  ...document,
  revealGroups: [{ ...document.revealGroups[0]!, narrationCue: "Here is the rod and its length L." }],
};
const named = buildVerifiedDiagramPresentation(namedDocument, { ...scene, revealGroups: namedDocument.revealGroups });
const measurement = named.introSegments.flatMap((segment) => segment.commands ?? []).filter((command) => command.semanticRef?.entityId === "length");
assert(measurement.length === 4, "naming the dimension must reveal the entire measurement");
assert(!named.diagram.deferredAnnotations?.some((entry) => entry.entityId === "length"), "a named measurement was only partly revealed");
const firstWitness = measurement.find((command) => command.semanticRef?.primitiveId === "length_witness_a");
assert(firstWitness?.params.join(",") === "750,180,805,180", "witness endpoints moved during presentation");
assert(firstWitness.visualStyle?.measurementRole === "witness", "drawing transport lost measurement ownership");
assert(!isDsaConstructionGuide(firstWitness), "the runtime would erase a verified measurement witness");
assert(isDsaConstructionGuide({ visualStyle: { strokeRole: "construction", dashed: true } }), "unmeasured construction scribbles must remain filtered");
assert(!isFocusTraceInk(firstWitness), "a tutor must trace the measured span rather than its witness scaffolding");
assert(measurement.some((command) => command.type === "DIMENSION" && isFocusTraceInk(command)), "the verified measurement bar must supply the tutor's exact trace path");
const crowdedMeasurement = {
  ...named.diagram,
  commands: [...named.diagram.commands, {
    type: "DRAW_LINE" as const,
    params: [800, 300, 850, 280],
    semanticRef: { entityId: "length", primitiveId: "length_label_leader" },
    visualStyle: { strokeRole: "construction" as const },
  }],
};
const trace = focusTraceCommands(crowdedMeasurement, new Set(["length"]));
assert(trace.length === 1 && trace[0]?.type === "DIMENSION", "measurement focus must follow only the verified span, excluding its label leader");

const ledScene: RenderScene = { ...scene, primitives: [...scene.primitives, {
  id: "length_label_leader", entityId: "length", groupId: "setup", kind: "line", points: [{ x: 800, y: 300 }, { x: 830, y: 300 }],
  provenance: { labelLeader: true, strokeRole: "construction" },
}] };
const ledUnnamed = buildVerifiedDiagramPresentation(document, ledScene);
assert(ledUnnamed.introSegments.every((segment) => (segment.commands ?? []).every((command) => command.semanticRef?.primitiveId !== "length_label_leader")), "a label callout must wait with its unnamed label");
const ledNamed = buildVerifiedDiagramPresentation(namedDocument, { ...ledScene, revealGroups: namedDocument.revealGroups });
assert(ledNamed.diagram.commands.find((command) => command.semanticRef?.primitiveId === "length_label_leader")?.visualStyle?.labelLeader === true, "drawing transport must retain label-callout ownership");

const ordinaryFigure = {
  ...named.diagram,
  commands: [{ type: "DRAW_LINE" as const, params: [750, 180, 750, 420], semanticRef: { entityId: "rod", primitiveId: "rod_ink" } },
    { type: "DRAW_LINE" as const, params: [750, 300, 790, 280], semanticRef: { entityId: "rod", primitiveId: "rod_label_leader" }, visualStyle: { strokeRole: "construction" as const, labelLeader: true } }],
};
assert(focusTraceCommands(ordinaryFigure, new Set(["rod"])).length === 1, "figure focus must exclude its label callout line");

// A worked example also needs to retain real measurements. Its marker-noise
// filter must distinguish these from transient dashed construction scribbles.
const code = buildVerifiedDiagramPresentation(document, scene, { layout: "code_lesson" });
const codeMeasurement = code.introSegments.flatMap((segment) => segment.commands ?? []).filter((command) => command.semanticRef?.entityId === "length");
assert(codeMeasurement.length === 4, "code lesson filtering erased verified measurement witnesses");

console.log("verify-dimension-reveal: measurements reveal together and preserve their endpoints");
