import type { SceneSpec } from "../sceneSpec";
import type { CompileOptions, CompiledScene, GeometryPlugin } from "../compileTypes";
import {
  anchorsFromLabelCommands,
  buildPromptAddon,
  emptyCompiled,
  segmentsToCommands,
} from "../compileTypes";
import {
  OPTICS_LENS_TEMPLATE,
  OPTICS_MIRROR_TEMPLATE,
  OPTICS_PRISM_TEMPLATE,
  OPTICS_TIR_TEMPLATE,
  OPTICS_INSTRUMENT_TEMPLATE,
  OPTICS_LENS_COMBO_TEMPLATE,
  OPTICS_REFRACTION_PLANE_TEMPLATE,
} from "../../templates/opticsFamily";
import type { DiagramTemplate } from "../../templates/types";
import {
  buildOpticsPrecisionIntro,
  classifyOptics,
} from "../../templates/opticsPrecision";
import {
  buildTemplateIntroSegments,
  getTemplateSkeletonCommands,
  templateToDrawCommand,
} from "../../templates/registry";
import type { TutorSegment } from "../../drawingProtocol";
import { getSegmentCommands } from "../../drawingProtocol";

function pickOpticsTemplate(spec: SceneSpec, question: string): DiagramTemplate {
  const q = `${spec.diagramType} ${question} ${JSON.stringify(spec.quantities ?? {})}`.toLowerCase();
  if (/\bprism\b|deviation/.test(q)) return OPTICS_PRISM_TEMPLATE;
  if (/\btir\b|critical\s+angle|optical\s+fib/.test(q)) return OPTICS_TIR_TEMPLATE;
  if (/telescope|microscope|instrument/.test(q)) return OPTICS_INSTRUMENT_TEMPLATE;
  // Combo before single lens/mirror — "concave lens" must not fall through to mirrors.
  if (
    /two\s+(?:thin\s+)?lenses|lens\s+combo|combination\s+of\s+(?:thin\s+)?lenses|equivalent\s+focal|in\s+contact\s+with\s+(?:a\s+)?(?:concave|convex)\s+lens|lenses?\s+in\s+contact|convex\s+lens[\s\S]{0,80}concave\s+lens|concave\s+lens[\s\S]{0,80}convex\s+lens/.test(
      q,
    )
  ) {
    return OPTICS_LENS_COMBO_TEMPLATE;
  }
  if (/slab|refraction\s+(?:at\s+)?(?:a\s+)?plane|glass\s+slab/.test(q)) {
    return OPTICS_REFRACTION_PLANE_TEMPLATE;
  }
  // Require "mirror" (or RoC) — bare "concave"/"convex" alone are usually lenses.
  if (/\bmirror\b|concave\s+mirror|convex\s+mirror|radius\s+of\s+curvature/.test(q)) {
    return OPTICS_MIRROR_TEMPLATE;
  }
  return OPTICS_LENS_TEMPLATE;
}

function skeletonIntroSegments(template: DiagramTemplate, question: string): TutorSegment[] {
  // Prefer phased template intro (axis + optic geometry). Precision overlays
  // for combo/instrument are mostly labels and need this skeleton first.
  const phased = buildTemplateIntroSegments(template, question);
  const geometryOnly = phased.filter((segment) => {
    const cmds = getSegmentCommands(segment);
    return cmds.some((c) => c.type.startsWith("DRAW_"));
  });
  if (geometryOnly.length > 0) {
    return geometryOnly.map((segment) => ({ ...segment, templateIntro: true }));
  }

  const skeleton = getTemplateSkeletonCommands(template);
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

/**
 * Optics domain plugin — lifts opticsPrecision builders into the compiler.
 */
export const opticsPlugin: GeometryPlugin = (
  spec: SceneSpec,
  options: CompileOptions,
): CompiledScene | null => {
  if (spec.kind !== "optics") return null;
  const question = options.question?.trim();
  if (!question) {
    return emptyCompiled(spec, "optics", "missing_question");
  }

  const template = pickOpticsTemplate(spec, question);
  const skeletonSegments = skeletonIntroSegments(template, question);
  const precision = buildOpticsPrecisionIntro(template, question);
  const precisionSegments = (precision?.segments ?? []).map((segment) => ({
    ...segment,
    templateIntro: true,
  }));

  const introSegments = [...skeletonSegments, ...precisionSegments];
  if (introSegments.length === 0) {
    return emptyCompiled(spec, "optics", "precision_build_failed");
  }

  const commands = segmentsToCommands(introSegments);
  const labelAnchors = anchorsFromLabelCommands(commands);
  const anchors = [...template.anchors, ...labelAnchors].filter(
    (anchor, index, all) => all.findIndex((a) => a.id === anchor.id) === index,
  );

  const classify = classifyOptics(template, question);
  const anchorLines = anchors.map(
    (a) => `${a.labels[0] ?? a.id}→(${Math.round(a.x + a.width / 2)},${Math.round(a.y + a.height / 2)})`,
  );

  return {
    ok: true,
    residual: 0,
    commands,
    anchors,
    introSegments,
    promptAddon: buildPromptAddon(
      {
        ...spec,
        promptAddon: template.promptAddon || spec.promptAddon,
      },
      anchorLines,
    ),
    diagramType: classify.matched_template_id || spec.diagramType,
    kind: "optics",
    allowLlmDrawInDiagramZone: template.allowLlmDrawInDiagramZone === true,
    plugin: "optics",
  };
};
