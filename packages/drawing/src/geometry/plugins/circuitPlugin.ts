import type { SceneSpec } from "../sceneSpec";
import type { CompileOptions, CompiledScene, GeometryPlugin } from "../compileTypes";
import {
  anchorsFromLabelCommands,
  buildPromptAddon,
  emptyCompiled,
  segmentsToCommands,
} from "../compileTypes";
import { CIRCUIT_TEMPLATE } from "../../templates/circuit";
import { buildCircuitPrecisionSegments } from "../../templates/circuitPrecision";

/**
 * Circuit domain plugin — lifts circuitPrecision builders into the compiler.
 */
export const circuitPlugin: GeometryPlugin = (
  spec: SceneSpec,
  options: CompileOptions,
): CompiledScene | null => {
  if (spec.kind !== "circuit") return null;
  const question = options.question?.trim();
  if (!question) {
    return emptyCompiled(spec, "circuit", "missing_question");
  }

  const segments = buildCircuitPrecisionSegments(CIRCUIT_TEMPLATE, question);
  if (segments.length === 0) {
    return emptyCompiled(spec, "circuit", "precision_build_failed");
  }

  const commands = segmentsToCommands(segments);
  const anchors = [
    ...CIRCUIT_TEMPLATE.anchors,
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
      { ...spec, promptAddon: CIRCUIT_TEMPLATE.promptAddon || spec.promptAddon },
      anchorLines,
    ),
    diagramType: spec.diagramType || "circuit",
    kind: "circuit",
    allowLlmDrawInDiagramZone: false,
    plugin: "circuit",
  };
};
