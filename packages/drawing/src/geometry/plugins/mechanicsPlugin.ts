import type { SceneSpec } from "../sceneSpec";
import type { CompileOptions, CompiledScene, GeometryPlugin } from "../compileTypes";
import {
  anchorsFromLabelCommands,
  buildPromptAddon,
  emptyCompiled,
  segmentsToCommands,
} from "../compileTypes";
import { FBD_TEMPLATE } from "../../templates/fbd";
import { INCLINE_FBD_TEMPLATE } from "../../templates/inclineFbd";
import { ROLLING_INCLINE_TEMPLATE } from "../../templates/rollingIncline";
import type { DiagramTemplate } from "../../templates/types";
import { buildTemplateIntroSegments } from "../../templates/registry";

function pickMechanicsTemplate(spec: SceneSpec, question: string): DiagramTemplate {
  const q = `${spec.diagramType} ${question}`.toLowerCase();
  if (/\brolls?\b|\brolling\b/.test(q) && /\bincline|inclined|ramp|slope\b/.test(q)) {
    return ROLLING_INCLINE_TEMPLATE;
  }
  if (spec.kind === "incline" || /\bincline|inclined\s+plane|ramp|slope\b/.test(q)) {
    return INCLINE_FBD_TEMPLATE;
  }
  return FBD_TEMPLATE;
}

/**
 * Mechanics domain plugin — lifts FBD / incline / rolling fixtures into the compiler.
 */
export const mechanicsPlugin: GeometryPlugin = (
  spec: SceneSpec,
  options: CompileOptions,
): CompiledScene | null => {
  if (spec.kind !== "fbd" && spec.kind !== "incline") return null;
  const question = options.question?.trim() || spec.introNarration || spec.diagramType;
  const template = pickMechanicsTemplate(spec, question);
  const segments = buildTemplateIntroSegments(template, question).map((segment) => ({
    ...segment,
    templateIntro: true,
  }));

  if (segments.length === 0) {
    return emptyCompiled(spec, "mechanics", "template_build_failed");
  }

  const commands = segmentsToCommands(segments);
  const anchors = [
    ...template.anchors,
    ...anchorsFromLabelCommands(commands),
  ].filter((anchor, index, all) => all.findIndex((a) => a.id === anchor.id) === index);

  const anchorLines = anchors.map(
    (a) => `${a.labels[0] ?? a.id}→(${Math.round(a.x + a.width / 2)},${Math.round(a.y + a.height / 2)})`,
  );

  return {
    ok: true,
    residual: 0,
    commands,
    anchors,
    introSegments: segments,
    promptAddon: buildPromptAddon(
      { ...spec, promptAddon: template.promptAddon || spec.promptAddon },
      anchorLines,
    ),
    diagramType: template.id || spec.diagramType,
    kind: spec.kind,
    allowLlmDrawInDiagramZone: false,
    plugin: "mechanics",
  };
};
