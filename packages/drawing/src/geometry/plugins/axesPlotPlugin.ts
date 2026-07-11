import { DIAGRAM_ZONE } from "../../boardZones";
import type { SceneSpec } from "../sceneSpec";
import type { CompileOptions, CompiledScene, GeometryPlugin } from "../compileTypes";
import {
  anchorsFromLabelCommands,
  buildPromptAddon,
  cmd,
  introSegmentsFromPhases,
} from "../compileTypes";
import type { TemplateCommand } from "../../templates/types";

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const nums = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  return nums.length >= 4 && nums.length % 2 === 0 ? nums : null;
}

/**
 * Axes + sampled function curves for calculus / coordinate plots.
 */
export const axesPlotPlugin: GeometryPlugin = (
  spec: SceneSpec,
  _options: CompileOptions,
): CompiledScene | null => {
  if (spec.kind !== "axes_plot" && spec.kind !== "projectile") return null;

  const originX = DIAGRAM_ZONE.x + 80;
  const originY = DIAGRAM_ZONE.y + DIAGRAM_ZONE.height - 60;
  const xMax = DIAGRAM_ZONE.x + DIAGRAM_ZONE.width - 40;
  const yMin = DIAGRAM_ZONE.y + 30;

  const commands: TemplateCommand[] = [
    cmd("DRAW_LINE", [originX, originY, xMax, originY]),
    cmd("DRAW_LINE", [originX, originY, originX, yMin]),
    cmd("ARROW", [xMax - 30, originY, xMax, originY]),
    cmd("ARROW", [originX, yMin + 30, originX, yMin]),
    cmd("LABEL", [xMax - 20, originY + 28], "x"),
    cmd("LABEL", [originX - 28, yMin + 10], "y"),
  ];

  for (const entity of spec.entities) {
    if (entity.type !== "curve") continue;

    const sampleNums = asNumberArray(entity.attrs?.samples);
    const xScale = typeof entity.attrs?.xScale === "number" ? entity.attrs.xScale : 40;
    const yScale = typeof entity.attrs?.yScale === "number" ? entity.attrs.yScale : 40;
    const dataSpace = entity.attrs?.dataSpace === true || entity.attrs?.data_space === true;

    if (sampleNums) {
      const pts: number[] = [];
      for (let i = 0; i < sampleNums.length; i += 2) {
        const sx = sampleNums[i]!;
        const sy = sampleNums[i + 1]!;
        if (dataSpace) {
          pts.push(originX + sx * xScale, originY - sy * yScale);
        } else {
          pts.push(sx, sy);
        }
      }
      if (pts.length >= 4) {
        commands.push(cmd("DRAW_LINE", pts));
      }
      continue;
    }

    // Optional simple polynomial samples: attrs.fn = "x^2" | "parabola" | "projectile"
    const fn = typeof entity.attrs?.fn === "string" ? entity.attrs.fn.toLowerCase() : "";
    if (fn.includes("parabola") || fn.includes("projectile") || fn === "x^2" || fn === "x**2") {
      const pts: number[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const px = originX + 40 + t * 420;
        const py = originY - 40 - 180 * (4 * t * (1 - t));
        pts.push(px, py);
      }
      commands.push(cmd("DRAW_LINE", pts));
      continue;
    }

    // Default projectile / parabola sketch when no samples provided.
    if (spec.kind === "projectile" || /parabola|projectile/.test(spec.diagramType)) {
      const pts: number[] = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const px = originX + 40 + t * 420;
        const py = originY - 40 - 180 * (4 * t * (1 - t));
        pts.push(px, py);
      }
      commands.push(cmd("DRAW_LINE", pts));
      if (entity.role === "object" || /parabola|projectile/.test(spec.diagramType)) {
        const markX = originX + 40 + 0.55 * 420;
        const markY = originY - 40 - 180 * (4 * 0.55 * (1 - 0.55));
        commands.push(cmd("DRAW_POINT", [markX, markY, 6]));
        commands.push(cmd("LABEL", [markX + 12, markY - 16], entity.text ?? "P"));
      }
    }
  }

  for (const entity of spec.entities) {
    if (entity.type !== "point") continue;
    const xData = typeof entity.attrs?.x === "number" ? entity.attrs.x : null;
    const yData = typeof entity.attrs?.y === "number" ? entity.attrs.y : null;
    if (xData === null || yData === null) continue;
    const xScale = typeof entity.attrs?.xScale === "number" ? entity.attrs.xScale : 40;
    const yScale = typeof entity.attrs?.yScale === "number" ? entity.attrs.yScale : 40;
    const px = originX + xData * xScale;
    const py = originY - yData * yScale;
    commands.push(cmd("DRAW_POINT", [px, py, 5]));
    commands.push(
      cmd("LABEL", [px + 12, py - 14], entity.text ?? entity.id, entity.id),
    );
  }

  const anchors = anchorsFromLabelCommands(commands);
  anchors.push({
    id: "origin",
    labels: ["O", "origin"],
    x: originX - 12,
    y: originY - 12,
    width: 24,
    height: 24,
  });

  const anchorLines = anchors.map(
    (a) => `${a.labels[0] ?? a.id}→(${Math.round(a.x + a.width / 2)},${Math.round(a.y + a.height / 2)})`,
  );

  return {
    ok: commands.length >= 2,
    residual: 0,
    commands,
    anchors,
    introSegments: introSegmentsFromPhases(spec, commands),
    promptAddon: buildPromptAddon(spec, anchorLines),
    diagramType: spec.diagramType,
    kind: spec.kind,
    allowLlmDrawInDiagramZone: false,
    plugin: "axes_plot",
  };
};
