import type { DrawCommandType } from "../drawingProtocol";

export interface TemplateAnchor {
  /** Stable id used for annotation snapping, e.g. "theta", "F", "O". */
  id: string;
  /** Label text variants that map to this anchor (board text, normalized). */
  labels: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateCommand {
  type: DrawCommandType;
  params: number[];
  text?: string;
  /** When set on LABEL/WRITE, registers this anchor after drawing. */
  anchorId?: string;
}

export interface DiagramTemplate {
  id: string;
  name: string;
  test: RegExp;
  /** Fixed geometry drawn by runtime before the LLM teaches. */
  commands: TemplateCommand[];
  anchors: TemplateAnchor[];
  /**
   * Short per-lesson prompt addon (~10–20 lines). Injected only when this template matches.
   * The LLM must NOT redraw skeleton ink — only explain, annotate, and write algebra.
   */
  promptAddon: string;
}
