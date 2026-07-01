import { CIRCUIT_TEMPLATE } from "./circuit";
import { CIRCLE_TEMPLATE } from "./circle";
import { CIRCULAR_MOTION_TEMPLATE } from "./circularMotion";
import { COORDINATE_AXES_TEMPLATE } from "./coordinateAxes";
import { FBD_TEMPLATE } from "./fbd";
import { PROJECTILE_TEMPLATE } from "./projectile";
import type { DiagramTemplate } from "./types";

/** Order matters — more specific templates before generic ones. */
export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  CIRCULAR_MOTION_TEMPLATE,
  FBD_TEMPLATE,
  PROJECTILE_TEMPLATE,
  CIRCUIT_TEMPLATE,
  CIRCLE_TEMPLATE,
  COORDINATE_AXES_TEMPLATE,
];

export function matchDiagramTemplate(question: string): DiagramTemplate | null {
  for (const template of DIAGRAM_TEMPLATES) {
    if (template.test.test(question)) {
      return template;
    }
  }
  return null;
}

/** Geometry-only commands pre-drawn before the LLM teaches. Labels are drawn per [STEP] with narration. */
export function getTemplateSkeletonCommands(
  template: DiagramTemplate,
): DiagramTemplate["commands"] {
  return template.commands.filter((cmd) => cmd.type !== "LABEL" && cmd.type !== "WRITE");
}

export function templateToDrawCommand(
  cmd: DiagramTemplate["commands"][number],
  charPosition = 0,
): import("../drawingProtocol").DrawCommand {
  return {
    type: cmd.type,
    params: [...cmd.params],
    text: cmd.text,
    charPosition,
    narrationBefore: "",
    syncable: cmd.type === "LABEL" || cmd.type === "WRITE",
    syncReason: cmd.type === "LABEL" ? "template-anchor" : undefined,
  };
}

export type { DiagramTemplate, TemplateAnchor, TemplateCommand } from "./types";
