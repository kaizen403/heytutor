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
}

export interface VerifiedDiagramPresentation {
  diagram: VerifiedDiagram;
  introSegments: TutorSegment[];
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
