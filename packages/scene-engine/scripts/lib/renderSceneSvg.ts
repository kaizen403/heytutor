/**
 * Offline rasterizer for a compiled RenderScene.
 *
 * The engine's only renderer is the Konva whiteboard in the browser, which
 * means no gate has ever been able to *look* at a diagram. This turns the
 * 12 render primitive kinds into plain SVG so probes, golden checks, and
 * humans can see exactly what the engine drew, without a browser.
 *
 * Board geometry mirrors `@heytutor/drawing` boardZones: canvas 1200×700,
 * diagram zone x 400–1160 / y 140–520, compiler default viewport 410,55 740×555.
 */
import type { RenderPrimitive, RenderScene } from "../../src/types";

export const BOARD_WIDTH = 1200;
export const BOARD_HEIGHT = 700;

export interface RenderSvgOptions {
  /** Line printed top-left of the board. */
  title?: string;
  /** Monospace line under the title (family, tier, assertions …). */
  subtitle?: string;
  /** Draw the diagram-zone and compiler-viewport guides. Default true. */
  guides?: boolean;
  /** Ink colour. Default near-black. */
  ink?: string;
  /** Label colour. Default red so engine labels stand out from geometry. */
  labelColor?: string;
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

export function primitiveToSvg(primitive: RenderPrimitive, marker: string, ink: string, labelColor: string): string {
  const points = primitive.points;
  const stroke = `fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const poly = (list: RenderPrimitive["points"]): string => list.map((point) => `${point.x},${point.y}`).join(" ");
  const anchor = points[0];
  const inlineLabel = primitive.text && primitive.kind !== "label" && primitive.kind !== "dimension" && anchor
    ? `<text x="${anchor.x + 6}" y="${anchor.y - 6}" font-size="13" fill="${labelColor}">${escapeXml(primitive.text)}</text>`
    : "";
  switch (primitive.kind) {
    case "point":
      return anchor ? `<circle cx="${anchor.x}" cy="${anchor.y}" r="4" fill="${ink}"/>${inlineLabel}` : "";
    case "line":
    case "polyline":
      return points.length >= 2 ? `<polyline points="${poly(points)}" ${stroke}/>${inlineLabel}` : "";
    case "polygon":
      return points.length >= 3
        ? `<polygon points="${poly(points)}" fill="rgba(31,111,139,.12)" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>${inlineLabel}`
        : "";
    case "rectangle": {
      if (points.length < 2) return "";
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return `<rect x="${x}" y="${y}" width="${Math.max(...xs) - x}" height="${Math.max(...ys) - y}" ${stroke}/>${inlineLabel}`;
    }
    case "ray":
    case "vector": {
      const start = points[0];
      const end = points.at(-1);
      if (!start || !end) return "";
      return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" ${stroke} marker-end="url(#${marker})"/>${inlineLabel}`;
    }
    case "circle":
      return anchor ? `<circle cx="${anchor.x}" cy="${anchor.y}" r="${primitive.radius ?? 0}" ${stroke}/>${inlineLabel}` : "";
    case "arc":
      return anchor
        ? `<path d="${arcPath(anchor.x, anchor.y, primitive.radius ?? 0, primitive.startAngle ?? 0, primitive.endAngle ?? 0)}" ${stroke}/>${inlineLabel}`
        : "";
    case "axes": {
      if (points.length !== 4) return "";
      const [x0, x1, y0, y1] = points as [RenderPrimitive["points"][number], RenderPrimitive["points"][number], RenderPrimitive["points"][number], RenderPrimitive["points"][number]];
      return `<line x1="${x0.x}" y1="${x0.y}" x2="${x1.x}" y2="${x1.y}" ${stroke} marker-end="url(#${marker})"/>`
        + `<line x1="${y0.x}" y1="${y0.y}" x2="${y1.x}" y2="${y1.y}" ${stroke} marker-end="url(#${marker})"/>${inlineLabel}`;
    }
    case "dimension": {
      const start = points[0];
      const end = points[1];
      if (!start || !end) return "";
      const text = primitive.text
        ? `<text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 5}" font-size="12" text-anchor="middle" fill="${labelColor}">${escapeXml(primitive.text)}</text>`
        : "";
      return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" fill="none" stroke="${ink}" stroke-width="1.2" marker-start="url(#${marker})" marker-end="url(#${marker})"/>${text}`;
    }
    case "label":
      return anchor
        ? `<text x="${anchor.x}" y="${anchor.y}" font-size="13" text-anchor="middle" fill="${labelColor}">${escapeXml(primitive.text ?? "")}</text>`
        : "";
    default:
      return "";
  }
}

/** Full 1200×700 board as a standalone SVG document. */
export function renderSceneSvg(scene: RenderScene, options: RenderSvgOptions = {}): string {
  const ink = options.ink ?? "#141821";
  const labelColor = options.labelColor ?? "#B93A2C";
  const guides = options.guides ?? true;
  const body = scene.primitives.map((primitive) => primitiveToSvg(primitive, "arrowhead", ink, labelColor)).join("\n");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${ink}"/></marker></defs>`,
    `<rect width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="#FDFDFB"/>`,
    guides ? `<rect x="400" y="140" width="760" height="380" fill="none" stroke="#C9CFDA" stroke-dasharray="4 4"/>` : "",
    guides ? `<rect x="410" y="55" width="740" height="555" fill="none" stroke="#ECE9D8"/>` : "",
    options.title ? `<text x="20" y="28" font-size="16" fill="#222">${escapeXml(options.title)}</text>` : "",
    options.subtitle ? `<text x="20" y="48" font-size="12" font-family="ui-monospace, Menlo, monospace" fill="#666">${escapeXml(options.subtitle)}</text>` : "",
    body,
    "</svg>",
  ].filter(Boolean).join("\n");
}

/** Several boards tiled on one page, each at half size. */
export function contactSheetSvg(
  cells: ReadonlyArray<{ scene: RenderScene; title: string; subtitle?: string }>,
  columns = 2,
): string {
  const cellWidth = BOARD_WIDTH / 2;
  const cellHeight = BOARD_HEIGHT / 2;
  const rows = Math.ceil(cells.length / columns);
  const inner = cells.map((cell, index) => {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const board = renderSceneSvg(cell.scene, { title: cell.title, subtitle: cell.subtitle })
      .replace(/^[\s\S]*?<\/defs>/, "")
      .replace(/<\/svg>\s*$/, "");
    return `<g transform="translate(${x},${y}) scale(0.5)">${board}</g><rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="none" stroke="#9AA3B2"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth * columns}" height="${cellHeight * rows}" viewBox="0 0 ${cellWidth * columns} ${cellHeight * rows}" font-family="ui-sans-serif, system-ui, sans-serif">`
    + `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#141821"/></marker></defs>`
    + `<rect width="100%" height="100%" fill="#FFFFFF"/>${inner}</svg>`;
}
