/**
 * Draw one board page at the real sizes, with the real glyphs.
 *
 * `pnpm --filter @heytutor/drawing preview:typography` writes an SVG showing
 * every role on the scale and how a long row wraps in each column, so the
 * writing style can be looked at rather than argued about.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BOARD_TYPE_SCALE,
  WORK_CONTINUATION_INDENT,
  fitBoardText,
} from "../src/layout/boardTypography";
import { BOARD_CANVAS, WORK_ZONE } from "../src/layout/boardZones";
import { textToStrokePaths } from "../src/handwriting/handwriting";

const INK = "#1B2A4A";
const PENCIL = "#5C5F6B";

async function inkText(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color = INK,
): Promise<string> {
  const paths = await textToStrokePaths(text, x, y, fontSize);
  return paths
    .flatMap((glyph) => glyph.strokes)
    .map(
      (stroke) =>
        `<path d="${stroke.pathData}" fill="none" stroke="${color}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
}

async function workColumn(
  lines: readonly string[],
  columnWidth: number,
  topY: number,
): Promise<{ svg: string; rows: number }> {
  const parts: string[] = [];
  let y = topY;
  let rows = 0;
  for (const line of lines) {
    const { fontSize, lines: wrapped } = fitBoardText(line, {
      role: "work",
      maxWidth: columnWidth,
    });
    for (const [index, row] of wrapped.entries()) {
      const x = WORK_ZONE.marginX + (index === 0 ? 0 : WORK_CONTINUATION_INDENT);
      parts.push(await inkText(row, x, y, fontSize));
      y += WORK_ZONE.lineHeight;
      rows += 1;
    }
  }
  return { svg: parts.join(""), rows };
}

const DERIVATION = [
  "Given: u = -20 cm, f = -15 cm",
  "want v = image distance",
  "1/f = 1/u + 1/v",
  "1/v = 1/f - 1/u",
  "1/v = 1/(-15) - 1/(-20)",
  "v > 0 -> real image, same side as object",
];

async function main(): Promise<void> {
  const { width, height } = BOARD_CANVAS;
  const parts: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height * 2 + 40}" fill="#FBFAF6"/>`,
  ];

  // Page one: a figure holds the right of the board, so the column is narrow.
  parts.push(await inkText("Concave mirror", WORK_ZONE.marginX, 58, BOARD_TYPE_SCALE.heading));
  const narrow = await workColumn(DERIVATION, WORK_ZONE.maxTextWidth, 145);
  parts.push(narrow.svg);
  // A stand-in figure with a label and a measurement, at their own sizes, and
  // one construction line in pencil.
  parts.push(
    `<line x1="480" y1="300" x2="1120" y2="300" stroke="${INK}" stroke-width="2.4"/>`,
    `<path d="M 560 190 A 190 190 0 0 1 560 410" fill="none" stroke="${INK}" stroke-width="2.6"/>`,
    `<line x1="700" y1="300" x2="700" y2="196" stroke="${PENCIL}" stroke-width="1.6" stroke-dasharray="6 5"/>`,
  );
  parts.push(await inkText("principal axis", 940, 320, BOARD_TYPE_SCALE.label));
  parts.push(await inkText("F", 690, 316, BOARD_TYPE_SCALE.label));
  parts.push(await inkText("15 cm", 606, 246, BOARD_TYPE_SCALE.annotation, PENCIL));

  // Page two: the same lesson with no figure, so the column has the board.
  const offset = height + 40;
  parts.push(`<g transform="translate(0 ${offset})">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#FBFAF6"/>`);
  parts.push(await inkText("Concave mirror", WORK_ZONE.marginX, 58, BOARD_TYPE_SCALE.heading));
  const full = await workColumn(DERIVATION, WORK_ZONE.fullWidthTextWidth, 145);
  parts.push(full.svg);
  parts.push("</g>");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height * 2 + 40}" viewBox="0 0 ${width} ${height * 2 + 40}">${parts.join("")}</svg>`;
  const out = resolve(process.argv[2] ?? "board-typography.svg");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(
    `preview-board-typography: ${out}\n` +
      `  heading ${BOARD_TYPE_SCALE.heading} · work ${BOARD_TYPE_SCALE.work} · ` +
      `work beside a figure ${BOARD_TYPE_SCALE.workNarrow} · label ${BOARD_TYPE_SCALE.label} · ` +
      `annotation ${BOARD_TYPE_SCALE.annotation}\n` +
      `  ${DERIVATION.length} lines took ${narrow.rows} rows beside a figure and ${full.rows} without one`,
  );
}

void main();
