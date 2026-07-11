import type { TemplateCommand } from "../templates/types";
import type { CompiledScene } from "./compileTypes";

/**
 * Light post-compile repair: round params, drop empty commands, clamp obvious
 * out-of-canvas coordinates. Full geometrySnap remains at LLM draw time for
 * annotation/ray snaps against anchors.
 */
export function repairCompiledCommands(
  compiled: CompiledScene,
  canvas = { width: 1200, height: 700 },
): CompiledScene {
  const commands: TemplateCommand[] = [];
  for (const command of compiled.commands) {
    if (!command.type) continue;
    const params = command.params.map((value, index) => {
      if (!Number.isFinite(value)) return 0;
      // Clamp x-like (even indices for LINE endpoints) loosely to canvas.
      if (index % 2 === 0 && (command.type.startsWith("DRAW_") || command.type === "LABEL" || command.type === "ARROW")) {
        return Math.round(Math.min(Math.max(value, 0), canvas.width));
      }
      if (index % 2 === 1 && (command.type.startsWith("DRAW_") || command.type === "LABEL" || command.type === "ARROW")) {
        return Math.round(Math.min(Math.max(value, 0), canvas.height));
      }
      return Math.round(value);
    });
    commands.push({ ...command, params });
  }

  return {
    ...compiled,
    commands,
  };
}
