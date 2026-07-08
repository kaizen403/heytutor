import { CIRCUIT_TEMPLATE } from "./circuit";
import { CIRCLE_TEMPLATE } from "./circle";
import { CIRCULAR_MOTION_TEMPLATE } from "./circularMotion";
import { COORDINATE_AXES_TEMPLATE } from "./coordinateAxes";
import { FBD_TEMPLATE } from "./fbd";
import { INCLINE_FBD_TEMPLATE } from "./inclineFbd";
import { PROJECTILE_TEMPLATE } from "./projectile";
import { HORIZONTAL_SPRING_TEMPLATE } from "./horizontalSpring";
import { RAMP_SPRING_TEMPLATE } from "./rampSpring";
import { buildCircuitPrecisionSegments } from "./circuitPrecision";

import { OPTICS_RAY_TEMPLATE } from "./opticsRay";
import { buildOpticsPrecisionSegments } from "./opticsPrecision";
import { PV_DIAGRAM_TEMPLATE } from "./pvDiagram";
import { WAVE_SHM_TEMPLATE } from "./waveShm";
import { ENERGY_LEVELS_TEMPLATE } from "./energyLevels";
import { ELECTROSTATICS_TEMPLATE } from "./electrostatics";
import { MAGNETISM_TEMPLATE } from "./magnetism";
import { GRAVITATION_TEMPLATE } from "./gravitation";

import { THREE_D_AXES_TEMPLATE } from "./threeDAxes";
import { UNIT_CIRCLE_TRIG_TEMPLATE } from "./unitCircleTrig";
import { COMPLEX_ARGAND_TEMPLATE } from "./complexArgand";
import { CALCULUS_GRAPH_TEMPLATE } from "./calculusGraph";
import { PROBABILITY_VENN_TEMPLATE } from "./probabilityVenn";

import { ORGANIC_HEXAGON_TEMPLATE } from "./organicHexagon";
import { GALVANIC_CELL_TEMPLATE } from "./galvanicCell";
import { LEWIS_STRUCTURE_TEMPLATE } from "./lewisStructure";
import { COORDINATION_GEO_TEMPLATE } from "./coordinationGeo";
import { REACTION_ARROW_TEMPLATE } from "./reactionArrow";

import type { DiagramTemplate } from "./types";

/** Order matters — more specific templates before generic ones. */
export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  // Physics — specific mechanics
  CIRCULAR_MOTION_TEMPLATE,
  HORIZONTAL_SPRING_TEMPLATE,
  RAMP_SPRING_TEMPLATE,
  PROJECTILE_TEMPLATE,
  CIRCUIT_TEMPLATE,
  INCLINE_FBD_TEMPLATE,
  FBD_TEMPLATE,

  // Physics — thermal, waves, EM, modern
  OPTICS_RAY_TEMPLATE,
  PV_DIAGRAM_TEMPLATE,
  WAVE_SHM_TEMPLATE,
  ENERGY_LEVELS_TEMPLATE,
  ELECTROSTATICS_TEMPLATE,
  MAGNETISM_TEMPLATE,
  GRAVITATION_TEMPLATE,

  // Chemistry
  ORGANIC_HEXAGON_TEMPLATE,
  GALVANIC_CELL_TEMPLATE,
  COORDINATION_GEO_TEMPLATE,
  LEWIS_STRUCTURE_TEMPLATE,
  REACTION_ARROW_TEMPLATE,

  // Maths — specific geometry
  UNIT_CIRCLE_TRIG_TEMPLATE,
  COMPLEX_ARGAND_TEMPLATE,
  CALCULUS_GRAPH_TEMPLATE,
  THREE_D_AXES_TEMPLATE,
  PROBABILITY_VENN_TEMPLATE,

  // Maths — generic (last resort)
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

/** Narrated step-by-step diagram intro before the LLM lesson segments. */
export function buildTemplateIntroSegments(
  template: DiagramTemplate,
  question?: string,
): import("../drawingProtocol").TutorSegment[] {
  const skeleton = getTemplateSkeletonCommands(template);
  const circuitPrecisionSegments = buildCircuitPrecisionSegments(template, question);
  if (circuitPrecisionSegments.length > 0) {
    return circuitPrecisionSegments;
  }

  const precisionSegments = buildOpticsPrecisionSegments(template, question);

  if (template.introPhases && template.introPhases.length > 0) {
    const introSegments = template.introPhases
      .map((phase) => {
        const commands = phase.commandIndices
          .map((index) => template.commands[index])
          .filter((cmd): cmd is NonNullable<typeof cmd> => cmd !== undefined && cmd.type !== "LABEL" && cmd.type !== "WRITE")
          .map((cmd) => templateToDrawCommand(cmd));

        if (commands.length === 0) {
          return null;
        }

        return {
          narration: phase.narration,
          command: commands[0] ?? null,
          commands,
          templateIntro: true,
        };
      })
      .filter((segment): segment is NonNullable<typeof segment> => segment !== null);

    return [...introSegments, ...precisionSegments];
  }

  if (skeleton.length === 0) {
    return precisionSegments;
  }

  const commands = skeleton.map((cmd) => templateToDrawCommand(cmd));
  return [
    {
      narration: `here is the ${template.name} setup on the board.`,
      command: commands[0] ?? null,
      commands,
      templateIntro: true,
    },
    ...precisionSegments,
  ];
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
