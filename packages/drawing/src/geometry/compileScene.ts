import type { SceneSpec } from "./sceneSpec";
import type { CompileOptions, CompiledScene } from "./compileTypes";
import { opticsPlugin } from "./plugins/opticsPlugin";
import { circuitPlugin } from "./plugins/circuitPlugin";
import { mechanicsPlugin } from "./plugins/mechanicsPlugin";
import { euclideanPlugin } from "./plugins/euclideanPlugin";
import { axesPlotPlugin } from "./plugins/axesPlotPlugin";
import { genericPlugin } from "./plugins/genericPlugin";
import { repairCompiledCommands } from "./postCompileRepair";

/**
 * Geometry Compiler: SceneSpec → DrawCommands + anchors + intro segments.
 * Domain plugins run first; generic constraint solver is the fallback.
 */
export function compileScene(
  spec: SceneSpec,
  options: CompileOptions = {},
): CompiledScene {
  const plugins = [
    opticsPlugin,
    circuitPlugin,
    mechanicsPlugin,
    euclideanPlugin,
    axesPlotPlugin,
    genericPlugin,
  ];

  for (const plugin of plugins) {
    const result = plugin(spec, options);
    if (result?.ok) {
      return repairCompiledCommands(result);
    }
  }

  const generic = genericPlugin(spec, options);
  if (generic?.ok) {
    return repairCompiledCommands(generic);
  }

  return {
    ok: false,
    residual: 999,
    commands: [],
    anchors: [],
    introSegments: [],
    promptAddon: spec.promptAddon,
    diagramType: spec.diagramType,
    kind: spec.kind,
    allowLlmDrawInDiagramZone: false,
    plugin: "none",
    degradeReason: generic?.degradeReason ?? "compile_failed",
  };
}
