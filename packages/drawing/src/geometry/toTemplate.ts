import type { DiagramTemplate } from "../templates/types";
import type { CompiledScene } from "./compileTypes";
import type { SceneSpec } from "./sceneSpec";

/**
 * Adapt a compiled scene into a DiagramTemplate so existing intro / guard /
 * snap machinery keeps working without a parallel board-plan type.
 */
export function compiledSceneToTemplate(
  compiled: CompiledScene,
  spec?: SceneSpec,
): DiagramTemplate {
  const commandIndices = compiled.commands.map((_, index) => index);
  const narration =
    compiled.introSegments[0]?.narration ||
    spec?.introNarration ||
    `here is the ${compiled.diagramType.replace(/_/g, " ")} setup on the board.`;

  return {
    id: `compiler_${compiled.diagramType}`,
    name: compiled.diagramType.replace(/_/g, " "),
    test: /$^/,
    commands: compiled.commands,
    anchors: compiled.anchors,
    allowLlmDrawInDiagramZone: compiled.allowLlmDrawInDiagramZone,
    plannerGenerated: true,
    promptAddon: compiled.promptAddon,
    introPhases:
      commandIndices.length > 0
        ? [
            {
              narration,
              commandIndices,
            },
          ]
        : undefined,
  };
}
