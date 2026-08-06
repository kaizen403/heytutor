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
export interface VerifiedDiagram {
  id: "verified_scene";
  name: string;
  commands: VerifiedDiagramCommand[];
  anchors: VerifiedDiagramAnchor[];
  reveals: VerifiedDiagramReveal[];
  promptAddon: string;
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
