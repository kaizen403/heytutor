import type {
  DiagramTemplate,
  TemplateAnchor,
  TemplateCommand,
  TutorSegment,
} from "@heytutor/drawing";
import type { DiagramPlan, PlannerCommand } from "@heytutor/tutor-core";
import { templateToDrawCommand } from "@heytutor/drawing";

/**
 * Convert a planner DiagramPlan into a synthetic DiagramTemplate so it flows
 * through the existing intro-segment, anchor, and blocking machinery.
 *
 * Planner diagrams are always authoritative — the teaching LLM must not redraw
 * over the planner's geometry.
 */
export function planToTemplate(plan: DiagramPlan): DiagramTemplate {
  const commands: TemplateCommand[] = plan.commands.map(toTemplateCommand);
  const anchors: TemplateAnchor[] = plan.anchors.map(toTemplateAnchor);

  // Build a single intro phase containing all commands. The runtime splits
  // DRAW_* (drawn immediately) from LABEL (drawn with narration) inside
  // buildTemplateIntroSegments, so listing them together is safe.
  const commandIndices = commands.map((_, index) => index);

  const template: DiagramTemplate = {
    id: `planner_${plan.diagramType}`,
    name: plan.diagramType.replace(/_/g, " "),
    // Never used at runtime (matching already happened), but required by type.
    test: /$^/,
    commands,
    anchors,
    allowLlmDrawInDiagramZone: false,
    plannerGenerated: true,
    promptAddon: plan.promptAddon,
    introPhases:
      commandIndices.length > 0
        ? [
            {
              narration:
                plan.introNarration.length > 0
                  ? plan.introNarration
                  : `here is the ${plan.diagramType.replace(/_/g, " ")} setup on the board.`,
              commandIndices,
            },
          ]
        : undefined,
  };

  return template;
}

/** Build intro segments from a planner template, mirroring buildTemplateIntroSegments. */
export function buildPlannerIntroSegments(
  template: DiagramTemplate,
): TutorSegment[] {
  if (!template.introPhases || template.introPhases.length === 0) {
    // Fallback: draw all skeleton commands in one segment.
    const skeleton = template.commands.filter(
      (cmd) => cmd.type !== "WRITE",
    );
    if (skeleton.length === 0) return [];
    const commands = skeleton.map((cmd) => templateToDrawCommand(cmd));
    return [
      {
        narration: `here is the ${template.name} setup on the board.`,
        command: commands[0] ?? null,
        commands,
        templateIntro: true,
      },
    ];
  }

  return template.introPhases.map((phase) => {
    const commands = phase.commandIndices
      .map((index) => template.commands[index])
      .filter((cmd): cmd is NonNullable<typeof cmd> => cmd !== undefined && cmd.type !== "WRITE")
      .map((cmd) => templateToDrawCommand(cmd));
    return {
      narration: phase.narration,
      command: commands[0] ?? null,
      commands,
      templateIntro: true,
    };
  });
}

function toTemplateCommand(cmd: PlannerCommand): TemplateCommand {
  return {
    type: cmd.type as TemplateCommand["type"],
    params: [...cmd.params],
    text: cmd.text,
  };
}

function toTemplateAnchor(anchor: DiagramPlan["anchors"][number]): TemplateAnchor {
  return {
    id: anchor.id,
    labels: [...anchor.labels],
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
  };
}
