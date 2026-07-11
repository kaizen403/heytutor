import { DIAGRAM_ZONE } from "../../boardZones";
import type { SceneSpec } from "../sceneSpec";
import type { CompileOptions, CompiledScene, GeometryPlugin } from "../compileTypes";
import {
  anchorsFromLabelCommands,
  buildPromptAddon,
  cmd,
  introSegmentsFromPhases,
} from "../compileTypes";
import { solveConstraints } from "../solver";
import type { TemplateCommand } from "../../templates/types";

/**
 * Euclidean constructions: triangles, circles, intersections from Scene IR.
 */
export const euclideanPlugin: GeometryPlugin = (
  spec: SceneSpec,
  _options: CompileOptions,
): CompiledScene | null => {
  if (spec.kind !== "euclidean") return null;

  const solved = solveConstraints(spec);
  const commands: TemplateCommand[] = [];
  const pointIds = new Set(
    [...solved.points.keys()].filter((id) =>
      spec.entities.some((e) => e.id === id && e.type === "point"),
    ),
  );

  for (const entity of spec.entities) {
    if (entity.type === "circle") {
      const center = entity.center ? solved.points.get(entity.center) : undefined;
      const r =
        typeof entity.attrs?.r === "number"
          ? entity.attrs.r
          : typeof entity.attrs?.radius === "number"
            ? entity.attrs.radius
            : 70;
      if (center) {
        commands.push(cmd("DRAW_CIRCLE", [center.x, center.y, r]));
      }
      continue;
    }

    if (entity.type === "segment" || entity.type === "line" || entity.type === "ray") {
      const a = entity.from ? solved.points.get(entity.from) : undefined;
      const b = entity.to ? solved.points.get(entity.to) : undefined;
      if (a && b) {
        commands.push(cmd("DRAW_LINE", [a.x, a.y, b.x, b.y]));
      }
      continue;
    }

    if (entity.type === "polygon" && entity.points && entity.points.length >= 3) {
      const pts = entity.points
        .map((id) => solved.points.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i]!;
        const p1 = pts[(i + 1) % pts.length]!;
        commands.push(cmd("DRAW_LINE", [p0.x, p0.y, p1.x, p1.y]));
      }
      continue;
    }

    if (entity.type === "arc") {
      const center = entity.center ? solved.points.get(entity.center) : undefined;
      const r = typeof entity.attrs?.r === "number" ? entity.attrs.r : 50;
      const startDeg = typeof entity.attrs?.start_deg === "number" ? entity.attrs.start_deg : 0;
      const endDeg = typeof entity.attrs?.end_deg === "number" ? entity.attrs.end_deg : 90;
      if (center) {
        commands.push(cmd("DRAW_ARC", [center.x, center.y, r, startDeg, endDeg]));
      }
      continue;
    }

    if (entity.type === "point" && pointIds.has(entity.id)) {
      const p = solved.points.get(entity.id);
      if (p) {
        commands.push(cmd("DRAW_POINT", [p.x, p.y, 5]));
      }
    }

    if (entity.type === "label") {
      const target =
        (entity.from && solved.points.get(entity.from)) ||
        (entity.center && solved.points.get(entity.center));
      const text = entity.text ?? entity.id;
      if (target) {
        const ox = typeof entity.attrs?.dx === "number" ? entity.attrs.dx : 14;
        const oy = typeof entity.attrs?.dy === "number" ? entity.attrs.dy : -18;
        commands.push(cmd("LABEL", [target.x + ox, target.y + oy], text, entity.id));
      }
    }

    if (entity.type === "arrow") {
      const a = entity.from ? solved.points.get(entity.from) : undefined;
      const b = entity.to ? solved.points.get(entity.to) : undefined;
      if (a && b) {
        commands.push(cmd("ARROW", [a.x, a.y, b.x, b.y]));
      }
    }
  }

  if (commands.length === 0) {
    const cx = DIAGRAM_ZONE.centerX;
    const cy = DIAGRAM_ZONE.centerY;
    commands.push(
      cmd("DRAW_LINE", [cx - 120, cy + 80, cx + 120, cy + 80]),
      cmd("DRAW_LINE", [cx + 120, cy + 80, cx, cy - 100]),
      cmd("DRAW_LINE", [cx, cy - 100, cx - 120, cy + 80]),
      cmd("LABEL", [cx - 140, cy + 90], "A"),
      cmd("LABEL", [cx + 130, cy + 90], "B"),
      cmd("LABEL", [cx - 10, cy - 120], "C"),
    );
  }

  const anchors = anchorsFromLabelCommands(commands);
  for (const [id, point] of solved.points) {
    if (!anchors.some((a) => a.id === id)) {
      anchors.push({
        id,
        labels: [id],
        x: point.x - 12,
        y: point.y - 12,
        width: 24,
        height: 24,
      });
    }
  }

  const anchorLines = anchors.map(
    (a) => `${a.labels[0] ?? a.id}→(${Math.round(a.x + a.width / 2)},${Math.round(a.y + a.height / 2)})`,
  );

  const usable =
    commands.length >= 2 &&
    (solved.ok || solved.residual < 50 || spec.constraints.length === 0);

  return {
    ok: usable,
    residual: solved.residual,
    commands,
    anchors,
    introSegments: introSegmentsFromPhases(spec, commands),
    promptAddon: buildPromptAddon(spec, anchorLines),
    diagramType: spec.diagramType,
    kind: "euclidean",
    allowLlmDrawInDiagramZone: (spec.allowAdditions?.length ?? 0) > 0,
    plugin: "euclidean",
    degradeReason: usable ? undefined : "high_residual",
  };
};
