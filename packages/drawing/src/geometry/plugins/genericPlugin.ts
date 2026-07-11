import { DIAGRAM_ZONE } from "../../boardZones";
import type { SceneSpec } from "../sceneSpec";
import type { CompileOptions, CompiledScene, GeometryPlugin } from "../compileTypes";
import {
  anchorsFromLabelCommands,
  buildPromptAddon,
  cmd,
  introSegmentsFromPhases,
  segmentsFromCommands,
} from "../compileTypes";
import { solveConstraints } from "../solver";
import type { TemplateCommand } from "../../templates/types";

/**
 * Generic fallback: rects, axes-ish frames, labeled points, constrained lines.
 */
export const genericPlugin: GeometryPlugin = (
  spec: SceneSpec,
  _options: CompileOptions,
): CompiledScene | null => {
  const solved = solveConstraints(spec);
  const commands: TemplateCommand[] = [];

  for (const entity of spec.entities) {
    switch (entity.type) {
      case "rect": {
        const x =
          typeof entity.attrs?.x === "number"
            ? entity.attrs.x
            : DIAGRAM_ZONE.centerX - 40;
        const y =
          typeof entity.attrs?.y === "number"
            ? entity.attrs.y
            : DIAGRAM_ZONE.centerY - 30;
        const w = typeof entity.attrs?.width === "number" ? entity.attrs.width : 80;
        const h = typeof entity.attrs?.height === "number" ? entity.attrs.height : 50;
        commands.push(cmd("DRAW_RECT", [x, y, w, h]));
        break;
      }
      case "circle": {
        const center = entity.center ? solved.points.get(entity.center) : undefined;
        const cx = center?.x ?? (typeof entity.attrs?.x === "number" ? entity.attrs.x : DIAGRAM_ZONE.centerX);
        const cy = center?.y ?? (typeof entity.attrs?.y === "number" ? entity.attrs.y : DIAGRAM_ZONE.centerY);
        const r = typeof entity.attrs?.r === "number" ? entity.attrs.r : 60;
        commands.push(cmd("DRAW_CIRCLE", [cx, cy, r]));
        break;
      }
      case "segment":
      case "line":
      case "ray": {
        const a = entity.from ? solved.points.get(entity.from) : undefined;
        const b = entity.to ? solved.points.get(entity.to) : undefined;
        if (a && b) {
          commands.push(cmd("DRAW_LINE", [a.x, a.y, b.x, b.y]));
        }
        break;
      }
      case "arrow": {
        const a = entity.from ? solved.points.get(entity.from) : undefined;
        const b = entity.to ? solved.points.get(entity.to) : undefined;
        if (a && b) {
          commands.push(cmd("ARROW", [a.x, a.y, b.x, b.y]));
        } else if (
          typeof entity.attrs?.x1 === "number" &&
          typeof entity.attrs?.y1 === "number" &&
          typeof entity.attrs?.x2 === "number" &&
          typeof entity.attrs?.y2 === "number"
        ) {
          commands.push(
            cmd("ARROW", [
              entity.attrs.x1,
              entity.attrs.y1,
              entity.attrs.x2,
              entity.attrs.y2,
            ]),
          );
        }
        break;
      }
      case "point": {
        const p = solved.points.get(entity.id);
        if (p) {
          commands.push(cmd("DRAW_POINT", [p.x, p.y, 5]));
        }
        break;
      }
      case "label": {
        const target =
          (entity.from && solved.points.get(entity.from)) ||
          (typeof entity.attrs?.x === "number" && typeof entity.attrs?.y === "number"
            ? { x: entity.attrs.x, y: entity.attrs.y }
            : undefined);
        if (target && entity.text) {
          commands.push(cmd("LABEL", [target.x, target.y], entity.text, entity.id));
        }
        break;
      }
      case "dimension": {
        const a = entity.from ? solved.points.get(entity.from) : undefined;
        const b = entity.to ? solved.points.get(entity.to) : undefined;
        const offset = typeof entity.attrs?.offset === "number" ? entity.attrs.offset : -28;
        if (a && b) {
          commands.push(cmd("DIMENSION", [a.x, a.y, b.x, b.y, offset], entity.text));
        }
        break;
      }
      case "polygon": {
        const pts = (entity.points ?? [])
          .map((id) => solved.points.get(id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p));
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i]!;
          const p1 = pts[(i + 1) % pts.length]!;
          commands.push(cmd("DRAW_LINE", [p0.x, p0.y, p1.x, p1.y]));
        }
        break;
      }
      default:
        break;
    }
  }

  // Incline / FBD helpers from quantities when IR is sparse.
  if (commands.length < 2 && (spec.kind === "incline" || spec.kind === "fbd")) {
    const angle = spec.quantities?.angle_deg ?? 30;
    const rad = (angle * Math.PI) / 180;
    const baseX = DIAGRAM_ZONE.x + 80;
    const baseY = DIAGRAM_ZONE.y + DIAGRAM_ZONE.height - 80;
    const run = 360;
    const rise = run * Math.tan(rad);
    commands.push(
      cmd("DRAW_LINE", [baseX, baseY, baseX + run, baseY]),
      cmd("DRAW_LINE", [baseX, baseY, baseX + run, baseY - rise]),
      cmd("DRAW_LINE", [baseX + run, baseY, baseX + run, baseY - rise]),
      cmd("DRAW_RECT", [baseX + run * 0.45 - 20, baseY - rise * 0.45 - 35, 40, 30]),
      cmd("LABEL", [baseX + 40, baseY + 24], `${angle}°`),
    );
  }

  if (commands.length < 2) {
    return {
      ok: false,
      residual: solved.residual,
      commands,
      anchors: [],
      introSegments: [],
      promptAddon: spec.promptAddon,
      diagramType: spec.diagramType,
      kind: spec.kind,
      allowLlmDrawInDiagramZone: false,
      plugin: "generic",
      degradeReason: "insufficient_geometry",
    };
  }

  // Plan accuracy gate: high residual is not an authoritative diagram.
  if (!solved.ok || solved.residual > 40) {
    return {
      ok: false,
      residual: solved.residual,
      commands,
      anchors: anchorsFromLabelCommands(commands),
      introSegments: [],
      promptAddon: spec.promptAddon,
      diagramType: spec.diagramType,
      kind: spec.kind,
      allowLlmDrawInDiagramZone: false,
      plugin: "generic",
      degradeReason: "high_residual",
    };
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

  return {
    ok: true,
    residual: solved.residual,
    commands,
    anchors,
    introSegments: introSegmentsFromPhases(spec, commands),
    promptAddon: buildPromptAddon(spec, anchorLines),
    diagramType: spec.diagramType,
    kind: spec.kind,
    allowLlmDrawInDiagramZone: (spec.allowAdditions?.length ?? 0) > 0,
    plugin: "generic",
    degradeReason: solved.ok ? undefined : "high_residual",
  };
};
