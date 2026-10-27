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

export const REFERENCE_PICTURE_PLAN_VERSION = "reference-picture-plan/v1" as const;

/** Board placement params of a `DRAW_PICTURE` command, in order. */
export const DRAW_PICTURE_PARAM_COUNT = 6;

/** Which reveal pass a `DRAW_PICTURE` command draws. */
export const PICTURE_PASS = { outline: 0, fill: 1 } as const;
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
  /** Labels the judge read on the picture, verbatim. */
  labels: string[];
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
 * board, which paces the pass like any other ink.
 */
export function pictureCommandParams(placement: PicturePlacement, pass: PicturePass, plan: ReferencePictureRecord["plan"]): number[] {
  const scale = placement.width / Math.max(1, plan.width);
  const lengthPx = pass === "outline" ? plan.outlineLengthPx : plan.fillLengthPx;
  return [placement.x, placement.y, placement.width, placement.height, PICTURE_PASS[pass], Math.round(lengthPx * scale)];
}

/** Same-origin asset URLs for a picture id. */
export function referencePictureAssetUrls(id: string): { imageUrl: string; planUrl: string; recordUrl: string } {
  return { imageUrl: `/api/reference-picture/${id}/image`, planUrl: `/api/reference-picture/${id}/plan`, recordUrl: `/api/reference-picture/${id}` };
}

/**
 * The picture's board commands: the outline pass, then the fill pass, both in
 * `REFERENCE_PICTURE_ZONE`. Pure, so the live turn and the server's persisted
 * intro rebuild produce the same ink from the same record.
 */
export function referencePictureCommands(record: Pick<ReferencePictureRecord, "id" | "plan">): Array<{ type: "DRAW_PICTURE"; params: number[]; text: string; semanticRef: { entityId: string; primitiveId: string } }> {
  const placement = fitPicture(record.plan.width, record.plan.height, REFERENCE_PICTURE_ZONE);
  return (["outline", "fill"] as const).map((pass) => ({
    type: "DRAW_PICTURE" as const,
    params: pictureCommandParams(placement, pass, record.plan),
    text: record.id,
    semanticRef: { entityId: "reference_picture", primitiveId: `reference_picture.${pass}` },
  }));
}

export function parsePictureCommandParams(params: readonly number[]): { placement: PicturePlacement; pass: PicturePass; boardLengthPx: number } | null {
  if (params.length !== DRAW_PICTURE_PARAM_COUNT || !params.every(Number.isFinite)) return null;
  const [x, y, width, height, passCode, boardLengthPx] = params as [number, number, number, number, number, number];
  if (width <= 0 || height <= 0 || boardLengthPx < 0) return null;
  const pass = passCode === PICTURE_PASS.outline ? "outline" : passCode === PICTURE_PASS.fill ? "fill" : null;
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
