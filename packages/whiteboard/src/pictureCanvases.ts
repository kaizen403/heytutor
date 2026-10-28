import Konva from "konva";

/**
 * The canvases the board makes for reference pictures, and when it frees them.
 *
 * iOS Safari caps the memory of every live canvas in a tab, and a canvas
 * that script has dropped still counts until the collector reaches it; past
 * the cap every canvas, the board's own layers included, paints blank. A
 * lecture seek re-lands every page at duration 0, so a picture that built
 * its line work on each land blanked the board after a few scrubs. So:
 *   - a picture's line work (the picture kept only where its ink mask has
 *     ink) is built once per device pixel size and shared by every node that
 *     shows it, on every land, until the picture's owner lets it go;
 *   - a pass's own canvases (the reveal the pencil paints into, the scaled
 *     copy a fill sweeps from) are freed when the pass ends, or when their
 *     node is destroyed if a kept partial reveal outlives the pass;
 *   - once the owner lets a picture go (`releaseBoardPicture`), its line work
 *     is freed as soon as nothing on any board shows or holds it.
 * Every way a picture leaves the board (CLEAR, an erase, a page clear, a
 * rollback, an abort, the stage unmounting) destroys its nodes, and a group's
 * destroy destroys its children, so a node's destroy is where it lets go.
 * Zeroing a canvas's size frees its backing store in Safari at once;
 * dropping the reference alone waits for the collector.
 */

/** What a picture's line work is made from; a `BoardPicture` is one. */
export interface PictureSources {
  image: CanvasImageSource;
  inkMask: CanvasImageSource;
}

/** How a node holds what it shows, so its destroy lets go of the right thing. */
export type PictureHold =
  /** The shared line work: one hold, dropped on destroy. */
  | "line-work"
  /** A canvas the pass made for this node alone: freed on destroy. */
  | "pass"
  /** The decoded picture itself: owned by the asset, never freed here. */
  | "picture";

type LineWork = { canvas: HTMLCanvasElement; holds: number };
type PictureCanvases = {
  /** By device pixel size, `${width}x${height}`. */
  lineWork: Map<string, LineWork>;
  /** Nodes on any board that show the picture in any form. */
  nodes: number;
  /** The owner let it go: free each canvas as soon as nothing holds it. */
  retired: boolean;
};

const pictures = new WeakMap<PictureSources, PictureCanvases>();

/** Free a canvas's backing store now (Safari counts it until then). */
export function freeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function canvasesOf(picture: PictureSources): PictureCanvases {
  let entry = pictures.get(picture);
  if (!entry) {
    entry = { lineWork: new Map(), nodes: 0, retired: false };
    pictures.set(picture, entry);
  }
  return entry;
}

function freeIdleLineWork(entry: PictureCanvases): void {
  for (const [size, lineWork] of entry.lineWork) {
    if (lineWork.holds > 0) continue;
    freeCanvas(lineWork.canvas);
    entry.lineWork.delete(size);
  }
}

/** A canvas of `width` x `height` device px, for one pass to own. */
export function passCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = Konva.Util.createCanvasElement();
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The picture's line work at `width` x `height` device px, held until
 * `releasePictureLineWork`. Built the first time a size is asked for and
 * reused by every later land; a size nothing holds is freed when another is
 * built, since that means the pixel ratio changed under it.
 */
export function holdPictureLineWork(picture: PictureSources, width: number, height: number): HTMLCanvasElement {
  const entry = canvasesOf(picture);
  const size = `${width}x${height}`;
  let lineWork = entry.lineWork.get(size);
  if (!lineWork) {
    freeIdleLineWork(entry);
    const canvas = passCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(picture.image, 0, 0, width, height);
      // Keep the picture only where the mask has ink: the line work.
      context.globalCompositeOperation = "destination-in";
      context.drawImage(picture.inkMask, 0, 0, width, height);
      context.globalCompositeOperation = "source-over";
    }
    lineWork = { canvas, holds: 0 };
    entry.lineWork.set(size, lineWork);
  }
  lineWork.holds++;
  return lineWork.canvas;
}

/** Drop one hold taken by `holdPictureLineWork`. */
export function releasePictureLineWork(picture: PictureSources, canvas: HTMLCanvasElement): void {
  const entry = pictures.get(picture);
  if (!entry) return;
  for (const [size, lineWork] of entry.lineWork) {
    if (lineWork.canvas !== canvas) continue;
    lineWork.holds = Math.max(0, lineWork.holds - 1);
    if (lineWork.holds === 0 && entry.retired) {
      freeCanvas(canvas);
      entry.lineWork.delete(size);
    }
    return;
  }
}

function letGo(picture: PictureSources, image: CanvasImageSource | undefined, hold: PictureHold): void {
  if (!image) return;
  if (hold === "line-work") releasePictureLineWork(picture, image as HTMLCanvasElement);
  else if (hold === "pass") freeCanvas(image as HTMLCanvasElement);
}

/**
 * A Konva.Image that shows a reference picture and lets go of what it shows
 * when it is destroyed. A plain image until `showPicture` binds it, so a
 * Konva clone stays an ordinary image that frees nothing.
 */
export class PictureImage extends Konva.Image {
  private shown: { picture: PictureSources; hold: PictureHold } | null = null;

  /** Show `image`, held as `hold`, letting go of whatever was shown before. */
  showPicture(picture: PictureSources, image: CanvasImageSource, hold: PictureHold): this {
    const previous = this.shown;
    const previousImage = this.image();
    if (previous?.picture !== picture) canvasesOf(picture).nodes++;
    this.shown = { picture, hold };
    this.image(image);
    if (previous) {
      // The caller took a fresh hold on what it hands in; only a pass canvas
      // shown again must not be freed under itself.
      if (!(previousImage === image && previous.hold === "pass")) letGo(previous.picture, previousImage, previous.hold);
      if (previous.picture !== picture) leaveBoard(previous.picture);
    }
    return this;
  }

  override destroy(): this {
    const shown = this.shown;
    this.shown = null;
    if (shown) {
      letGo(shown.picture, this.image(), shown.hold);
      leaveBoard(shown.picture);
    }
    return super.destroy();
  }
}

function leaveBoard(picture: PictureSources): void {
  const entry = pictures.get(picture);
  if (!entry) return;
  entry.nodes = Math.max(0, entry.nodes - 1);
  if (entry.retired && entry.nodes === 0) freeIdleLineWork(entry);
}

/** Whether any board still shows the picture or holds its line work. */
export function boardPictureInUse(picture: PictureSources): boolean {
  const entry = pictures.get(picture);
  if (!entry) return false;
  if (entry.nodes > 0) return true;
  for (const lineWork of entry.lineWork.values()) if (lineWork.holds > 0) return true;
  return false;
}

/**
 * The owner is done with the picture (its asset cache evicted it): free its
 * line work now, or the moment the last node showing it is destroyed. A
 * picture still on the board keeps drawing until then; drawing it again
 * after this builds fresh line work that is freed as soon as it is let go.
 */
export function releaseBoardPicture(picture: PictureSources): void {
  const entry = canvasesOf(picture);
  entry.retired = true;
  freeIdleLineWork(entry);
}

/**
 * Paper lighter than this (Rec. 601 luma, 0 to 255) is keyed out so the
 * picture blends into the board; darker paper (a grey film still, a coloured
 * plate) keeps its card, since removing it would eat the picture itself.
 */
export const BLEND_PAPER_MIN_LUMA = 180;
/** Alpha this small after keying is paper noise (JPEG ringing, scan grain). */
const BLEND_NOISE_ALPHA = 10;

export function paperLuma(paper: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(paper);
  if (!m) return 0;
  return 0.299 * parseInt(m[1]!, 16) + 0.587 * parseInt(m[2]!, 16) + 0.114 * parseInt(m[3]!, 16);
}

/**
 * Colour to alpha against the picture's paper, in place: each pixel becomes
 * the least opaque colour that, laid over the paper, gives the original back.
 * Paper turns fully transparent, ink stays exactly its colour, and an
 * antialiased edge keeps its partial cover, so the picture lies on the board
 * like ink printed on it, with no white box and no halo.
 */
export function keyPaperToAlpha(data: Uint8ClampedArray, paper: readonly [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    let alpha = 0;
    for (let c = 0; c < 3; c++) {
      const v = data[i + c]!;
      const p = paper[c]!;
      const a = v > p ? (p < 255 ? (v - p) / (255 - p) : 0) : v < p ? (p > 0 ? (p - v) / p : 0) : 0;
      if (a > alpha) alpha = a;
    }
    const a255 = Math.round(alpha * 255);
    if (a255 <= BLEND_NOISE_ALPHA) {
      data[i + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const p = paper[c]!;
      data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c]! - p) / alpha + p)));
    }
    data[i + 3] = Math.round((a255 * data[i + 3]!) / 255);
  }
}

/**
 * The picture as the board shows it: keyed to transparent paper when the
 * paper is light (`blended`), or the decoded picture untouched otherwise.
 * The keyed canvas belongs to the picture's asset like the decoded image
 * did; the board never frees it.
 */
export function blendPictureIntoBoard(image: CanvasImageSource & { width: number; height: number }, paper: string): { image: CanvasImageSource; blended: boolean } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(paper);
  if (!m || paperLuma(paper) < BLEND_PAPER_MIN_LUMA) return { image, blended: false };
  const width = "naturalWidth" in image ? (image as HTMLImageElement).naturalWidth : image.width;
  const height = "naturalHeight" in image ? (image as HTMLImageElement).naturalHeight : image.height;
  if (!(width > 0 && height > 0)) return { image, blended: false };
  const canvas = Konva.Util.createCanvasElement();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { image, blended: false };
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  keyPaperToAlpha(pixels.data, [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]);
  ctx.putImageData(pixels, 0, 0);
  return { image: canvas, blended: true };
}
