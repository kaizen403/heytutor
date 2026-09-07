import type {
  DrawCommand,
  DrawCommandSemanticRef,
  DrawCommandType,
  DrawCommandVisualStyle,
  TutorSegment,
} from "./drawingProtocol";

export interface VerifiedDiagramAnchor {
  id: string;
  labels: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VerifiedDiagramGroup {
  id: string;
  entityIds: string[];
}

export interface VerifiedDeferredAnnotation {
  entityId: string;
  commands: VerifiedDiagramCommand[];
}

export interface VerifiedDiagramCommand {
  type: DrawCommandType;
  params: number[];
  text?: string;
  anchorId?: string;
  visualStyle?: DrawCommandVisualStyle;
  semanticRef?: DrawCommandSemanticRef;
}

export interface VerifiedDiagramReveal {
  narration: string;
  commandIndices: number[];
  kind?: "reveal" | "focus" | "annotate";
  targetId?: string;
}

/** Runtime envelope for geometry that has passed scene-engine validation. */
/**
 * What a symbol on the figure means. A diagram is labelled `R_1` rather than
 * "Resistor 1 (12 Ω)" so the geometry stays readable — this carries the
 * expansion the board hands back when a student asks for it.
 */
export interface VerifiedLabelFact {
  /** The symbol exactly as drawn. */
  symbol: string;
  /** Expanded name — "Resistor 1". */
  title: string;
  /** Solved value with unit — "12 Ω". */
  value?: string;
  provenance?: "given" | "derived" | "assumed";
  /** The planner's one-line justification, when it recorded one. */
  detail?: string;
}

export interface VerifiedDiagram {
  id: "verified_scene";
  name: string;
  commands: VerifiedDiagramCommand[];
  anchors: VerifiedDiagramAnchor[];
  reveals: VerifiedDiagramReveal[];
  promptAddon: string;
  groups?: VerifiedDiagramGroup[];
  caption?: string;
  deferredAnnotations?: VerifiedDeferredAnnotation[];
  /** Normalized symbol → meaning, for the label inspector. */
  labelGlossary?: Record<string, VerifiedLabelFact>;
  /** DSA code-lesson board split: FOCUS is spotlight-only, no marker traces. */
  layout?: "standard" | "code_lesson";
}

export interface VerifiedDiagramPresentation {
  diagram: VerifiedDiagram;
  introSegments: TutorSegment[];
}

/**
 * Does this diagram put anything on the board?
 *
 * A representation can compile to nothing at all: a plasma-frequency question
 * once reached the board as a `question_representation` with zero primitives,
 * and a reversibility question as a bare pair of axes with no curve. The
 * teaching prompt still announced "a diagram has been compiled and is being
 * explained as it is revealed" and offered "none" as the focus targets, so the
 * tutor talked about a figure the student could not see. An empty figure is
 * not a figure; a turn holding one must teach as text only.
 *
 * Trace strokes are transient review gestures, not the figure itself, so they
 * do not count as ink.
 */
export function verifiedDiagramHasDrawableInk(
  diagram: Pick<VerifiedDiagram, "commands"> | null | undefined,
): boolean {
  return Boolean(
    diagram?.commands.some((command) => command.visualStyle?.strokeRole !== "trace"),
  );
}

export function verifiedDiagramCommandToDrawCommand(
  command: VerifiedDiagramCommand,
  charPosition = 0,
): DrawCommand {
  return {
    type: command.type,
    params: [...command.params],
    text: command.text,
    charPosition,
    narrationBefore: "",
    syncable: command.type === "LABEL" || command.type === "WRITE",
    syncReason: command.type === "LABEL" ? "verified-scene-label" : undefined,
    visualStyle: command.visualStyle,
    semanticRef: command.semanticRef,
  };
}
