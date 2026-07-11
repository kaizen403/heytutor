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

function pickOpticsTemplate(spec: SceneSpec, question: string): DiagramTemplate {
  const q = `${spec.diagramType} ${question} ${JSON.stringify(spec.quantities ?? {})}`.toLowerCase();
  if (/\bprism\b|deviation/.test(q)) return OPTICS_PRISM_TEMPLATE;
  if (/\btir\b|critical\s+angle|optical\s+fib/.test(q)) return OPTICS_TIR_TEMPLATE;
  if (/telescope|microscope|instrument/.test(q)) return OPTICS_INSTRUMENT_TEMPLATE;
  if (/two\s+lenses|lens\s+combo|combination\s+of\s+lenses/.test(q)) return OPTICS_LENS_COMBO_TEMPLATE;
  if (/slab|refraction\s+(?:at\s+)?(?:a\s+)?plane|glass\s+slab/.test(q)) {
    return OPTICS_REFRACTION_PLANE_TEMPLATE;
  }
  if (/mirror|concave|convex\s+mirror|radius\s+of\s+curvature/.test(q)) {
    return OPTICS_MIRROR_TEMPLATE;
  }
  return OPTICS_LENS_TEMPLATE;
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
  const intro = buildOpticsPrecisionIntro(template, question);
  if (!intro || intro.segments.length === 0) {
    return emptyCompiled(spec, "optics", "precision_build_failed");
  }

  const commands = segmentsToCommands(intro.segments);
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
    introSegments: intro.segments,
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
