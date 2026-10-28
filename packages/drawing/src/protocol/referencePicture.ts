/**
 * Reference pictures: the default-off tier that draws a real diagram (a
 * Wikimedia Commons file or a generated image) when no verified figure could
 * be drawn. The server finds, judges and stores the picture and its stroke
 * plan; the board reveals the picture under the pencil along those strokes.
 *
 * This is not scene-engine geometry and is never presented as verified. The
 * picture's authority is the server record: only a picture the server stored
 * after its judge accepted it has an id, and the board, persistence and
 * replay all resolve the id back to that record.
 */
import { measureTextWidth } from "../handwriting/handwriting";
import { BOARD_TYPE_SCALE, wrapBoardText } from "../layout/boardTypography";

export const REFERENCE_PICTURE_PLAN_VERSION = "reference-picture-plan/v1" as const;

/** Board placement params of a `DRAW_PICTURE` command, in order. */
export const DRAW_PICTURE_PARAM_COUNT = 6;

/**
 * Which reveal pass a `DRAW_PICTURE` command draws. `legend` exists only for a
 * picture whose parts are numbered: the pen writes the key beside the card
 * after the colour is in, so the hand swaps once, pencil to pen, and keeps
 * the pen for the teaching that follows.
 */
export const PICTURE_PASS = { outline: 0, fill: 1, legend: 2 } as const;
export type PicturePass = keyof typeof PICTURE_PASS;

/**
 * One reveal pass: polylines in the picture's own pixel space. Each stroke is
 * a flat `[x0, y0, x1, y1, ...]` list. The brush reveals the picture's pixels
 * within `brushPx / 2` of the path, so the outline pass shows the line work
 * and the fill pass shows the colour.
 */
export interface ReferencePicturePass {
  brushPx: number;
  strokes: number[][];
  /** Sum of polyline lengths in picture px, for pacing. */
  lengthPx: number;
}

export interface ReferencePicturePlan {
  version: typeof REFERENCE_PICTURE_PLAN_VERSION;
  /** Picture pixel size the strokes and the mask are expressed in. */
  width: number;
  height: number;
  /**
   * The picture's paper colour, `#rrggbb`. The board lays a card of this
   * colour first, so paper pixels never need a stroke and dark line work stays
   * readable on the dark board.
   */
  paper: string;
  /**
   * `data:image/png;base64,...`, `width` x `height`. Opaque white where the
   * picture has line work (ink), transparent elsewhere. The outline pass
   * reveals the picture only through this mask; the fill pass reveals all of it.
   */
  inkMask: string;
  outline: ReferencePicturePass;
  fill: ReferencePicturePass;
}

/**
 * Where a picture may sit on the 1200x700 board: the right of the board,
 * taller than the verified diagram zone so a labelled diagram stays legible,
 * with room under it for the credit line.
 */
export const REFERENCE_PICTURE_ZONE = { x: 410, y: 118, width: 750, height: 480 } as const;
/** Baseline y of the credit line, under the zone. */
export const REFERENCE_PICTURE_CREDIT_Y = 616;

/**
 * One entry of a numbered picture's key: the mark printed on the drawing
 * ("1", "12", "3a", "B") and the part it names ("Right atrium").
 */
export interface ReferencePictureLegendEntry {
  mark: string;
  label: string;
}

/** What the server returns and stores for one accepted picture. */
export interface ReferencePictureRecord {
  id: string;
  source: "wikimedia" | "generated";
  /** Commons file title, or a short description for a generated picture. */
  title: string;
  /** Commons page, or null for a generated picture. */
  pageUrl: string | null;
  license: string;
  licenseUrl: string | null;
  artist: string;
  /** Same-origin image URL. */
  imageUrl: string;
  /** Same-origin stroke plan URL. */
  planUrl: string;
  width: number;
  height: number;
  /** The judge's one-line reading of what the picture shows. */
  shows: string;
  /**
   * Names the student can read on the board: the labels printed on the
   * picture, verbatim, and for a numbered picture the names in its key.
   */
  labels: string[];
  /**
   * A numbered picture's key, one entry per mark on the drawing, checked by
   * the judge against the drawn parts. The board writes it beside the card.
   * Absent for a picture labelled with names (or not at all).
   */
  legend?: ReferencePictureLegendEntry[];
  /**
   * Where named parts are printed on the picture (`parseReferencePictureParts`).
   * Absent on pictures stored before parts were located, and for a part the
   * locator could not place with certainty.
   */
  parts?: ReferencePicturePart[];
  /** The stored plan's size and pass lengths, so commands need no plan fetch. */
  plan: { width: number; height: number; outlineLengthPx: number; fillLengthPx: number };
}

/** The credit line shown under the picture and stored with the lesson. */
export function referencePictureCredit(record: Pick<ReferencePictureRecord, "source" | "artist" | "license" | "title">): string {
  if (record.source === "generated") return "Illustration generated for this lesson";
  const artist = record.artist.length > 60 ? `${record.artist.slice(0, 57)}...` : record.artist;
  return `${artist}, ${record.license}, via Wikimedia Commons`;
}

export interface PicturePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fit a picture inside `zone`, keeping its aspect ratio, centred. */
export function fitPicture(width: number, height: number, zone: PicturePlacement): PicturePlacement {
  const scale = Math.min(zone.width / Math.max(1, width), zone.height / Math.max(1, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { x: Math.round(zone.x + (zone.width - w) / 2), y: Math.round(zone.y + (zone.height - h) / 2), width: w, height: h };
}

/**
 * `DRAW_PICTURE` params: `[x, y, w, h, pass, boardLengthPx]`. `text` carries
 * the picture id. `boardLengthPx` is the pass's stroke length scaled to the
 * board, which paces the pass like any other ink. Every pass carries the
 * picture's own placement, the legend pass included: the key's column is a
 * pure function of the record (`referencePictureLayout`), so it needs no
 * params of its own, and the executor's aspect check holds for all three.
 */
export function pictureCommandParams(placement: PicturePlacement, pass: PicturePass, plan: ReferencePictureRecord["plan"], legendLengthPx = 0): number[] {
  const scale = placement.width / Math.max(1, plan.width);
  const lengthPx = pass === "legend" ? legendLengthPx : (pass === "outline" ? plan.outlineLengthPx : plan.fillLengthPx) * scale;
  return [placement.x, placement.y, placement.width, placement.height, PICTURE_PASS[pass], Math.round(lengthPx)];
}

/** Same-origin asset URLs for a picture id. */
export function referencePictureAssetUrls(id: string): { imageUrl: string; planUrl: string; recordUrl: string } {
  return { imageUrl: `/api/reference-picture/${id}/image`, planUrl: `/api/reference-picture/${id}/plan`, recordUrl: `/api/reference-picture/${id}` };
}

/** A key longer than this is a crowded picture: it is declined, not drawn. */
export const REFERENCE_PICTURE_LEGEND_MAX_ENTRIES = 24;
/** Longest key name kept; a longer one is a sentence, not a part name. */
export const REFERENCE_PICTURE_LEGEND_LABEL_MAX = 60;
/**
 * The key is written at the board's figure label size (a key names parts of
 * the figure) and never smaller; a long name wraps instead.
 */
export const REFERENCE_PICTURE_LEGEND_FONT_PX = BOARD_TYPE_SCALE.label;
/** Row pitch of the key, board px: one label row and the air under it. */
export const REFERENCE_PICTURE_LEGEND_ROW_PX = 30;
/** Space between a mark and its name. */
const LEGEND_MARK_GAP_PX = 10;
/** Space between two key columns. */
const LEGEND_COLUMN_GUTTER_PX = 24;
/** Space between the card and the key; the card's own 6 px padding is inside it. */
const LEGEND_PICTURE_GAP_PX = 28;
/** Widths a key name may run to before it wraps, widest first. */
const LEGEND_WRAP_WIDTHS = [320, 260, 210, 170] as const;
/**
 * A key costs the picture width. Past this (the picture's shorter side on the
 * board) its numbers are too small to find, so the picture is declined.
 */
export const REFERENCE_PICTURE_LEGEND_MIN_PICTURE_PX = 240;
/**
 * Pen time per key character and per row, 1x media ms. Half the pen's
 * quickest work row pace (tutor-core's 90 ms write floor) and still well over
 * the 24 ms a figure label is lettered at: a key is copied, not composed, and
 * at the work pace a 16 entry key would hold the lesson for 25 s. A row adds
 * the lift to the next one. The legend pass's `boardLengthPx` is this time at
 * the board's ink speed, so the turn's schedule and the board pace the key
 * with the same arithmetic as every other pass (and the same 4 to 14 s range).
 */
const LEGEND_MS_PER_CHAR = 45;
const LEGEND_MS_PER_ROW = 120;
const LEGEND_INK_SPEED_PX_PER_MS = 2;

const LEGEND_MARK = /^[([]?\s*([0-9]{1,2}[a-z]?|[A-Za-z])\s*[)\].:]?$/;
const LEGEND_LABEL = /^[\p{Script=Latin}0-9 ,.;:'’()/&+\-–]+$/u;

/** A mark as printed ("1.", "(3)", "12:") reduced to its bare form, or null when it is not a part mark. */
export function normalizeLegendMark(raw: string): string | null {
  return raw.trim().match(LEGEND_MARK)?.[1] ?? null;
}

/** Marks compare without case: a judge reading "3A" for "3a" is the same mark. */
export function legendMarkKey(mark: string): string {
  return mark.toLowerCase();
}

/**
 * Validate a key from anywhere (judge, store, client, artifacts): every mark
 * a part mark and unique, every name English letters and short, at most
 * `REFERENCE_PICTURE_LEGEND_MAX_ENTRIES` entries. Null when any entry fails:
 * a key with a bad entry is not trimmed, it is refused whole.
 */
export function parseReferencePictureLegend(raw: unknown): ReferencePictureLegendEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > REFERENCE_PICTURE_LEGEND_MAX_ENTRIES) return null;
  const legend: ReferencePictureLegendEntry[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { mark: rawMark, label: rawLabel } = entry as Record<string, unknown>;
    if (typeof rawMark !== "string" && typeof rawMark !== "number") return null;
    if (typeof rawLabel !== "string") return null;
    const mark = normalizeLegendMark(String(rawMark));
    const label = rawLabel.replace(/\s+/g, " ").trim();
    if (!mark || seen.has(legendMarkKey(mark))) return null;
    if (label.length < 2 || label.length > REFERENCE_PICTURE_LEGEND_LABEL_MAX || !LEGEND_LABEL.test(label) || !/\p{L}{2}/u.test(label)) return null;
    seen.add(legendMarkKey(mark));
    legend.push({ mark, label });
  }
  return legend;
}

/** One run of key text: a mark, or one row of a name. `y` is the top of the row, as `writeText` takes it. */
export interface PictureLegendRun {
  text: string;
  x: number;
  y: number;
  role: "mark" | "label";
  /** Index of the key entry the run belongs to. */
  entry: number;
}

export interface PictureLegendLayout {
  /** The key's block, board px, inside `REFERENCE_PICTURE_ZONE`, clear of the card. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  rowPx: number;
  columns: number;
  /** In writing order: each entry's mark, then its name's rows. */
  runs: PictureLegendRun[];
  /** The legend pass's pen time as board ink length (see `LEGEND_MS_PER_CHAR`). */
  inkLengthPx: number;
}

export interface ReferencePictureLayout {
  picture: PicturePlacement;
  legend: PictureLegendLayout | null;
}

interface LegendColumn { width: number; labelWidth: number; rows: number; entries: Array<{ mark: string; lines: string[] }> }

interface LegendSet { columns: LegendColumn[]; markWidth: number; width: number; rows: number; totalRows: number }

/**
 * A key set at one wrap width in `columns` columns, or null when a name cannot
 * wrap at the label size or a column runs out of rows. Entries stay in the
 * key's order and an entry's rows never split across columns.
 */
function setLegend(legend: readonly ReferencePictureLegendEntry[], wrapWidth: number, columns: number, maxRows: number): LegendSet | null {
  const fontSize = REFERENCE_PICTURE_LEGEND_FONT_PX;
  const markWidth = Math.max(...legend.map((entry) => measureTextWidth(entry.mark, fontSize)));
  const set: Array<{ mark: string; lines: string[]; width: number }> = [];
  for (const entry of legend) {
    const lines = wrapBoardText(entry.label, fontSize, wrapWidth);
    if (!lines || lines.length === 0) return null;
    set.push({ mark: entry.mark, lines, width: Math.max(...lines.map((line) => measureTextWidth(line, fontSize))) });
  }
  const totalRows = set.reduce((sum, entry) => sum + entry.lines.length, 0);
  const target = Math.ceil(totalRows / columns);
  const out: LegendColumn[] = [];
  let column: LegendColumn = { width: 0, labelWidth: 0, rows: 0, entries: [] };
  for (const entry of set) {
    if (column.entries.length > 0 && column.rows + entry.lines.length > target && out.length < columns - 1) {
      out.push(column);
      column = { width: 0, labelWidth: 0, rows: 0, entries: [] };
    }
    column.entries.push({ mark: entry.mark, lines: entry.lines });
    column.rows += entry.lines.length;
    column.labelWidth = Math.max(column.labelWidth, entry.width);
  }
  out.push(column);
  for (const c of out) c.width = Math.ceil(markWidth + LEGEND_MARK_GAP_PX + c.labelWidth);
  const rows = Math.max(...out.map((c) => c.rows));
  if (out.length !== columns || rows > maxRows) return null;
  return { columns: out, markWidth, width: out.reduce((sum, c) => sum + c.width, 0) + LEGEND_COLUMN_GUTTER_PX * (columns - 1), rows, totalRows };
}

/**
 * Where a picture and its key sit in `REFERENCE_PICTURE_ZONE`. With no key the
 * picture fills the zone as before. With one, the key is set at the label
 * size in a column (two when one runs out of rows) on the right, the picture
 * is fitted to what is left, and the pair is centred together, so the key
 * stays beside its picture. Of every wrap width and column count that fits,
 * the one leaving the picture largest wins. Null when the key cannot be set
 * at that size or leaves the picture too small to find its numbers: such a
 * picture is declined, never drawn without its key.
 *
 * Pure and deterministic: the live turn, the server's persisted rebuild and
 * the board all place the same ink from the same record.
 */
export function referencePictureLayout(record: { plan: { width: number; height: number }; legend?: readonly ReferencePictureLegendEntry[] | null }): ReferencePictureLayout | null {
  const zone = REFERENCE_PICTURE_ZONE;
  if (!record.legend || record.legend.length === 0) return { picture: fitPicture(record.plan.width, record.plan.height, zone), legend: null };
  const legend = parseReferencePictureLegend(record.legend);
  if (!legend) return null;
  const rowPx = REFERENCE_PICTURE_LEGEND_ROW_PX;
  const maxRows = Math.floor(zone.height / rowPx);
  let best: { set: LegendSet; picture: PicturePlacement; area: number } | null = null;
  for (const columns of [1, 2]) {
    for (const wrapWidth of LEGEND_WRAP_WIDTHS) {
      const set = setLegend(legend, wrapWidth, columns, maxRows);
      if (!set) continue;
      const room = zone.width - set.width - LEGEND_PICTURE_GAP_PX;
      if (room < REFERENCE_PICTURE_LEGEND_MIN_PICTURE_PX) continue;
      const picture = fitPicture(record.plan.width, record.plan.height, { x: zone.x, y: zone.y, width: room, height: zone.height });
      if (Math.min(picture.width, picture.height) < REFERENCE_PICTURE_LEGEND_MIN_PICTURE_PX) continue;
      // Larger picture first; on a tie, fewer columns, then fewer rows.
      const area = picture.width * picture.height;
      if (!best || area > best.area) best = { set, picture, area };
    }
  }
  if (!best) return null;
  const { set } = best;
  const pairWidth = best.picture.width + LEGEND_PICTURE_GAP_PX + set.width;
  // Floored, so the pair never spills a rounding pixel past the zone's right edge.
  const pictureX = Math.floor(zone.x + (zone.width - pairWidth) / 2);
  const picture = { ...best.picture, x: pictureX };
  const x = pictureX + picture.width + LEGEND_PICTURE_GAP_PX;
  const height = set.rows * rowPx;
  const y = Math.round(zone.y + (zone.height - height) / 2);
  const runs: PictureLegendRun[] = [];
  let columnX = x;
  let entryIndex = 0;
  let chars = 0;
  for (const column of set.columns) {
    let row = 0;
    for (const entry of column.entries) {
      const markWidth = measureTextWidth(entry.mark, REFERENCE_PICTURE_LEGEND_FONT_PX);
      // Marks are set flush right, so "9" and "12" end on one edge and every name starts on one line.
      runs.push({ text: entry.mark, x: Math.round(columnX + set.markWidth - markWidth), y: y + row * rowPx, role: "mark", entry: entryIndex });
      entry.lines.forEach((line, index) => {
        runs.push({ text: line, x: Math.round(columnX + set.markWidth + LEGEND_MARK_GAP_PX), y: y + (row + index) * rowPx, role: "label", entry: entryIndex });
      });
      chars += [entry.mark, ...entry.lines].join("").replace(/\s+/g, "").length;
      row += entry.lines.length;
      entryIndex++;
    }
    columnX += column.width + LEGEND_COLUMN_GUTTER_PX;
  }
  const inkLengthPx = Math.round((chars * LEGEND_MS_PER_CHAR + set.totalRows * LEGEND_MS_PER_ROW) * LEGEND_INK_SPEED_PX_PER_MS);
  return {
    picture,
    legend: { x, y, width: set.width, height, fontSize: REFERENCE_PICTURE_LEGEND_FONT_PX, rowPx, columns: set.columns.length, runs, inkLengthPx },
  };
}

/**
 * The picture's board commands: the outline pass, then the fill pass, then
 * for a numbered picture the legend pass, all in `REFERENCE_PICTURE_ZONE`.
 * Pure, so the live turn and the server's persisted intro rebuild produce the
 * same ink from the same record. Empty when the record's key cannot be laid
 * out: a numbered picture is never drawn without its key.
 */
export function referencePictureCommands(record: Pick<ReferencePictureRecord, "id" | "plan" | "legend">): Array<{ type: "DRAW_PICTURE"; params: number[]; text: string; semanticRef: { entityId: string; primitiveId: string } }> {
  const layout = referencePictureLayout(record);
  if (!layout) return [];
  const passes: PicturePass[] = layout.legend ? ["outline", "fill", "legend"] : ["outline", "fill"];
  return passes.map((pass) => ({
    type: "DRAW_PICTURE" as const,
    params: pictureCommandParams(layout.picture, pass, record.plan, layout.legend?.inkLengthPx ?? 0),
    text: record.id,
    semanticRef: { entityId: "reference_picture", primitiveId: `reference_picture.${pass}` },
  }));
}

export function parsePictureCommandParams(params: readonly number[]): { placement: PicturePlacement; pass: PicturePass; boardLengthPx: number } | null {
  if (params.length !== DRAW_PICTURE_PARAM_COUNT || !params.every(Number.isFinite)) return null;
  const [x, y, width, height, passCode, boardLengthPx] = params as [number, number, number, number, number, number];
  if (width <= 0 || height <= 0 || boardLengthPx < 0) return null;
  const pass = passCode === PICTURE_PASS.outline ? "outline" : passCode === PICTURE_PASS.fill ? "fill" : passCode === PICTURE_PASS.legend ? "legend" : null;
  return pass ? { placement: { x, y, width, height }, pass, boardLengthPx } : null;
}

/** Picture ids are server-minted: `rp_` and 24 lowercase hex digits. */
export const REFERENCE_PICTURE_ID = /^rp_[0-9a-f]{24}$/;

export function isReferencePictureId(value: unknown): value is string {
  return typeof value === "string" && REFERENCE_PICTURE_ID.test(value);
}

/** Validate a plan fetched from the server before the board trusts it. */
export function parseReferencePicturePlan(raw: unknown): ReferencePicturePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== REFERENCE_PICTURE_PLAN_VERSION) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096)) return null;
  const pass = (input: unknown): ReferencePicturePass | null => {
    if (!input || typeof input !== "object") return null;
    const p = input as Record<string, unknown>;
    const brushPx = Number(p.brushPx);
    if (!(brushPx > 0 && brushPx < 200) || !Array.isArray(p.strokes) || p.strokes.length > 20_000) return null;
    const strokes: number[][] = [];
    for (const stroke of p.strokes) {
      if (!Array.isArray(stroke) || stroke.length < 4 || stroke.length % 2 !== 0) return null;
      if (!stroke.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
      strokes.push(stroke as number[]);
    }
    const lengthPx = Number(p.lengthPx);
    return Number.isFinite(lengthPx) && lengthPx >= 0 ? { brushPx, strokes, lengthPx } : null;
  };
  const paper = typeof value.paper === "string" && /^#[0-9a-f]{6}$/i.test(value.paper) ? value.paper : null;
  const inkMask = typeof value.inkMask === "string" && value.inkMask.startsWith("data:image/png;base64,") && value.inkMask.length < 2_000_000 ? value.inkMask : null;
  const outline = pass(value.outline);
  const fill = pass(value.fill);
  return outline && fill && paper && inkMask ? { version: REFERENCE_PICTURE_PLAN_VERSION, width, height, paper, inkMask, outline, fill } : null;
}

export function polylineLength(stroke: readonly number[]): number {
  let total = 0;
  for (let i = 2; i + 1 < stroke.length; i += 2) total += Math.hypot(stroke[i]! - stroke[i - 2]!, stroke[i + 1]! - stroke[i - 1]!);
  return total;
}

/** A picture label longer than this is a caption, not a part name. */
export const REFERENCE_PICTURE_LABEL_MAX = 120;
export const REFERENCE_PICTURE_LABELS_MAX = 80;

/**
 * The one label rule for judge, store and client: trimmed strings, captions
 * over `REFERENCE_PICTURE_LABEL_MAX` dropped, at most 80. Dropping a caption
 * keeps the picture; on 27 Oct 2026 one 186 character phase caption made the
 * client refuse a correct cell cycle picture outright.
 */
export function normalizeReferencePictureLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter((label) => label.length > 0 && label.length <= REFERENCE_PICTURE_LABEL_MAX)
    .slice(0, REFERENCE_PICTURE_LABELS_MAX);
}

/**
 * A located part: where a judged label, or a numbered picture's mark, is
 * printed on the picture. Found once when the picture is stored, from the
 * Commons SVG's own text or by reading the stored picture, and kept only when
 * the printed text matches a judged name that occurs once. It is what lets
 * `[FOCUS:reference_picture.part.<n>]` bring the pen to "R1" instead of the
 * whole picture. A name with no located part can be said, never pointed at.
 */
export interface ReferencePicturePart {
  /**
   * `reference_picture.part.<n>`: n is the 1-based position of `label` in the
   * record's `labels`, so a backfill that locates one more name never
   * renumbers the others (a lesson saved before it replays the same rings).
   */
  id: string;
  /** The judged name it answers to: a printed label verbatim, or the key's name for `mark`. */
  label: string;
  /** For a numbered picture, the mark printed on the drawing ("3", "12a"). */
  mark?: string;
  /** The printed text's box on the picture, plan px (`plan.width` x `plan.height`). */
  box: PicturePlacement;
  /** How the box was found: the SVG's text element, or reading the raster. */
  source: "svg" | "ocr";
}

export const REFERENCE_PICTURE_PART_PREFIX = "reference_picture.part." as const;
export const REFERENCE_PICTURE_PARTS_MAX = 60;
const PART_ID = /^reference_picture\.part\.([1-9][0-9]{0,2})$/;
/** Smallest printed text box kept, plan px: below this it is a speck, not a word. */
const PART_MIN_SIDE_PX = 3;
/** A label box taller than this share of the picture is a region, not printed text. */
const PART_MAX_HEIGHT_SHARE = 0.25;

/** The part id for the name at `labelIndex` (0-based) in the record's `labels`. */
export function referencePicturePartId(labelIndex: number): string {
  return `${REFERENCE_PICTURE_PART_PREFIX}${labelIndex + 1}`;
}

export function isReferencePicturePartId(value: unknown): value is string {
  return typeof value === "string" && PART_ID.test(value.trim().toLowerCase());
}

/**
 * A numbered picture's key entry as a focus target, named by its printed mark
 * (`reference_picture.key.3`, `reference_picture.key.12a`), never by its place
 * in the list: on a key whose marks skip (1, 2, 4, 5) "part 4" must be
 * `key.4`, or the model's natural id rings the wrong row. Sub-anchors add
 * `.mark` (on the drawing) and `.row` (the key row).
 */
export const REFERENCE_PICTURE_KEY_PREFIX = "reference_picture.key." as const;
const KEY_ID = /^reference_picture\.key\.([0-9]{1,2}[a-z]?|[a-z])(?:\.(?:mark|row))?$/;

export function referencePictureKeyId(mark: string): string {
  return `${REFERENCE_PICTURE_KEY_PREFIX}${legendMarkKey(mark)}`;
}

/** A key target or one of its sub-anchors. */
export function isReferencePictureKeyId(value: unknown): value is string {
  return typeof value === "string" && KEY_ID.test(value.trim().toLowerCase());
}

/** Any part or key focus id, sub-anchors included (not the whole picture). */
export function isReferencePicturePartFocusId(value: unknown): value is string {
  return isReferencePicturePartId(value) || isReferencePictureKeyId(value);
}

/** Names compare without case or spacing: "R 1" printed, "R1" judged. */
export function referencePicturePartKey(label: string): string {
  return label.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * Validate located parts from anywhere (locator, store, client, artifacts).
 * Unlike the key, a bad part is dropped alone: the picture stays, that part
 * just cannot be pointed at. A part is kept only when its name is one the
 * record already shows (a printed label, or the key name its mark carries),
 * its id is that name's place in `labels` (`referencePicturePartId`),
 * its box lies on the picture and is the size of printed text, and no other
 * part claims the same name, mark or id.
 */
export function parseReferencePictureParts(
  raw: unknown,
  record: { plan: { width: number; height: number }; labels: readonly string[]; legend?: readonly ReferencePictureLegendEntry[] | null },
): ReferencePicturePart[] {
  if (!Array.isArray(raw)) return [];
  const { width: planW, height: planH } = record.plan;
  const printed = new Map(record.labels.map((label) => [referencePicturePartKey(label), label] as const));
  const position = new Map<string, number>();
  record.labels.forEach((label, index) => { if (!position.has(referencePicturePartKey(label))) position.set(referencePicturePartKey(label), index); });
  const keyed = new Map((record.legend ?? []).map((entry) => [legendMarkKey(entry.mark), entry] as const));
  const parts: ReferencePicturePart[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const seenMarks = new Set<string>();
  for (const entry of raw.slice(0, REFERENCE_PICTURE_PARTS_MAX * 2)) {
    if (parts.length >= REFERENCE_PICTURE_PARTS_MAX) break;
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
    if (!PART_ID.test(id) || seenIds.has(id)) continue;
    const source = value.source === "svg" || value.source === "ocr" ? value.source : null;
    const box = value.box as Record<string, unknown> | null | undefined;
    if (!source || !box || typeof box !== "object") continue;
    const [x, y, w, h] = [box.x, box.y, box.width, box.height].map(Number) as [number, number, number, number];
    if (![x, y, w, h].every(Number.isFinite)) continue;
    if (w < PART_MIN_SIDE_PX || h < PART_MIN_SIDE_PX || h > planH * PART_MAX_HEIGHT_SHARE) continue;
    if (x < 0 || y < 0 || x + w > planW || y + h > planH) continue;
    let label: string | undefined;
    let mark: string | undefined;
    if (value.mark != null) {
      const bare = normalizeLegendMark(String(value.mark));
      const keyEntry = bare ? keyed.get(legendMarkKey(bare)) : undefined;
      if (!keyEntry || seenMarks.has(legendMarkKey(keyEntry.mark))) continue;
      mark = keyEntry.mark;
      label = keyEntry.label;
    } else if (typeof value.label === "string") {
      label = printed.get(referencePicturePartKey(value.label));
    }
    if (!label || seenNames.has(referencePicturePartKey(label))) continue;
    // The id is the name's place in `labels`; any other numbering is refused.
    const index = position.get(referencePicturePartKey(label));
    if (index === undefined || id !== referencePicturePartId(index)) continue;
    seenIds.add(id);
    seenNames.add(referencePicturePartKey(label));
    if (mark) seenMarks.add(legendMarkKey(mark));
    parts.push({ id, label, ...(mark ? { mark } : {}), box: { x, y, width: w, height: h }, source });
  }
  return parts;
}

/** A part's box on the board: the same mapping the pencil's strokes use (picture px scaled into the placement). */
export function referencePicturePartBoardRect(
  part: Pick<ReferencePicturePart, "box">,
  placement: PicturePlacement,
  plan: { width: number; height: number },
): PicturePlacement {
  const sx = placement.width / Math.max(1, plan.width);
  const sy = placement.height / Math.max(1, plan.height);
  return {
    x: placement.x + part.box.x * sx,
    y: placement.y + part.box.y * sy,
    width: part.box.width * sx,
    height: part.box.height * sy,
  };
}

/** The board box of one key entry (its mark and every row of its name), or null when the layout has no such entry. */
export function referencePictureLegendEntryRect(legend: PictureLegendLayout, entry: number): PicturePlacement | null {
  const runs = legend.runs.filter((run) => run.entry === entry);
  if (runs.length === 0) return null;
  const left = Math.min(...runs.map((run) => run.x));
  const right = Math.max(...runs.map((run) => run.x + measureTextWidth(run.text, legend.fontSize)));
  const top = Math.min(...runs.map((run) => run.y));
  const bottom = Math.max(...runs.map((run) => run.y)) + legend.rowPx;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
