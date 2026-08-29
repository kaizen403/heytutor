/**
 * Render the instrument art to a standalone SVG for visual review.
 *
 * Reads the same shape tables `VirtualCursor` renders on the board, so the
 * picture a designer looks at is the object the tutor actually holds.
 *
 *   pnpm --filter @heytutor/whiteboard preview /tmp/instruments.svg
 */

import { writeFileSync } from "node:fs";
import {
  instrumentMetrics,
  instrumentPalette,
  instrumentShapes,
  type InstrumentKind,
  type InstrumentPalette,
  type InstrumentShape,
} from "../src/instruments";
import { RESTING_TILT, instrumentSwapPose, tiltForHeading } from "../src/penChoreography";

const BOARD = "#F8F6F0";
const LABEL = "#7A7468";
const HEADING = "#3A342A";
/** The board's highlighter colour — a highlighter is yellow whatever the pen is. */
const HIGHLIGHTER_INK = "#FFD84D";
/** Exactly the palette offered in Settings → marker colour. */
const SETTINGS_COLOURS: Array<[string, string]> = [
  ["navy", "#1B2A4A"],
  ["black", "#222222"],
  ["blue", "#81A6C6"],
  ["red", "#D64545"],
  ["green", "#4CAF7D"],
  ["purple", "#9B7ED9"],
  ["orange", "#E8913A"],
];

function renderShape(shape: InstrumentShape, palette: InstrumentPalette): string {
  const fill = shape.fill ? palette[shape.fill] : "none";
  const stroke = shape.stroke ? ` stroke="${palette[shape.stroke]}" stroke-width="${shape.strokeWidth ?? 0.4}"` : "";
  const opacity = shape.opacity !== undefined ? ` opacity="${shape.opacity}"` : "";
  const filter = shape.shadow ? ' filter="url(#drop)"' : "";
  if (shape.kind === "rect") {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.radius ?? 0}" fill="${fill}"${stroke}${opacity}${filter} stroke-linejoin="round"/>`;
  }
  if (shape.kind === "circle") {
    return `<circle cx="${shape.x}" cy="${shape.y}" r="${shape.radius}" fill="${fill}"${stroke}${opacity}${filter}/>`;
  }
  const pts: string[] = [];
  for (let i = 0; i < shape.points.length; i += 2) pts.push(`${shape.points[i]},${shape.points[i + 1]}`);
  if (shape.kind === "stroke") {
    return `<polyline points="${pts.join(" ")}" fill="none"${stroke}${opacity}/>`;
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"${stroke}${opacity}${filter} stroke-linejoin="round"/>`;
}

/** The colour a given instrument is held in, mirroring the board exactly. */
function inkFor(kind: InstrumentKind, settingsColour: string): string {
  return kind === "highlighter" ? HIGHLIGHTER_INK : settingsColour;
}

function instrument(
  kind: InstrumentKind,
  settingsColour: string,
  x: number,
  y: number,
  rotation: number,
  { spin = 0, lift = 0, scale = 1 }: { spin?: number; lift?: number; scale?: number } = {},
): string {
  const palette = instrumentPalette(kind, inkFor(kind, settingsColour));
  const { pivotY } = instrumentMetrics(kind);
  const body = instrumentShapes(kind).map((shape) => renderShape(shape, palette)).join("");
  return `<g transform="translate(${x} ${y}) rotate(${rotation}) scale(${scale})">
    <ellipse cx="0.8" cy="1.4" rx="${(3.6 + lift * 0.22).toFixed(2)}" ry="${(1.4 + lift * 0.07).toFixed(2)}" fill="#000" opacity="${Math.max(0.04, 0.17 - lift * 0.007).toFixed(3)}" transform="rotate(${-rotation})"/>
    <g transform="translate(0 ${-lift})"><g transform="translate(0 ${pivotY}) rotate(${spin}) translate(0 ${-pivotY})">${body}</g></g>
  </g>`;
}

function text(x: number, y: number, body: string, size = 9, fill = LABEL, anchor = "middle"): string {
  return `<text x="${x}" y="${y}" font-family="ui-sans-serif, system-ui" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${body}</text>`;
}

const rows: string[] = [];

// 1 — the three tools, each doing its own job.
const TOOLS: Array<[InstrumentKind, string, number]> = [
  ["pen", "pen · solving", RESTING_TILT.write],
  ["pencil", "pencil · diagrams", RESTING_TILT.draw],
  ["highlighter", "highlighter · marking up", RESTING_TILT.highlight],
];
TOOLS.forEach(([kind, caption, tilt], index) => {
  const cx = 150 + index * 210;
  rows.push(instrument(kind, SETTINGS_COLOURS[0]![1], cx, 150, tilt, { scale: 2.1 }));
  rows.push(text(cx, 200, caption, 12, HEADING));
  rows.push(text(cx, 216, `rests at ${tilt}°`));
});

// 2 — every settings colour, pen and pencil, at 2.4x so the nib is readable.
SETTINGS_COLOURS.forEach(([name, hex], index) => {
  const cx = 90 + index * 118;
  rows.push(instrument("pen", hex, cx - 24, 400, RESTING_TILT.write, { scale: 2.4 }));
  rows.push(instrument("pencil", hex, cx + 26, 400, RESTING_TILT.draw, { scale: 2.4 }));
  rows.push(text(cx, 432, name, 10));
  rows.push(`<rect x="${cx - 16}" y="440" width="32" height="8" rx="4" fill="${hex}"/>`);
});

// 3 — the pen → pencil flip, sampled across its arc.
[0, 0.18, 0.34, 0.46, 0.54, 0.66, 0.82, 1].forEach((progress, index) => {
  const pose = instrumentSwapPose(progress);
  const kind: InstrumentKind = pose.showIncoming ? "pencil" : "pen";
  const cx = 74 + index * 104;
  rows.push(`<g opacity="${pose.opacity.toFixed(3)}">${instrument(kind, SETTINGS_COLOURS[0]![1], cx, 540, RESTING_TILT.write, { spin: pose.spin, lift: pose.lift, scale: pose.scale })}</g>`);
  rows.push(text(cx, 566, progress.toFixed(2)));
});

// 4 — how far the barrel leans as a stroke changes heading.
[-90, -45, 0, 45, 90, 135, 180].forEach((heading, index) => {
  const tilt = tiltForHeading(heading, RESTING_TILT.write);
  const cx = 84 + index * 118;
  rows.push(instrument("pen", SETTINGS_COLOURS[0]![1], cx, 650, tilt, { scale: 1.3 }));
  rows.push(text(cx, 676, `${heading}° → ${tilt.toFixed(1)}°`));
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="700" viewBox="0 0 880 700">
  <defs><filter id="drop" x="-60%" y="-60%" width="220%" height="220%">
    <feDropShadow dx="0.9" dy="1.1" stdDeviation="2.4" flood-color="#000" flood-opacity="0.42"/>
  </filter></defs>
  <rect width="880" height="700" fill="${BOARD}"/>
  ${text(20, 32, "Three real tools", 13, HEADING, "start")}
  ${text(20, 268, "Settings marker colour → pen + pencil (2.4×: nib, grip, lead, band)", 13, HEADING, "start")}
  ${text(20, 492, "Pen → pencil flip", 13, HEADING, "start")}
  ${text(20, 604, "Barrel lean by stroke heading", 13, HEADING, "start")}
${rows.join("\n")}
</svg>
`;

const target = process.argv[2] ?? "instruments-preview.svg";
writeFileSync(target, svg);
console.log(`preview-instruments: wrote ${target}`);
