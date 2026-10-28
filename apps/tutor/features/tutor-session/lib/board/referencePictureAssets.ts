import { blendPictureIntoBoard, boardPictureInUse, releaseBoardPicture, type BoardPicture } from "@heytutor/whiteboard";
import {
  isReferencePictureId,
  parseReferencePictureLegend,
  parseReferencePicturePlan,
  referencePictureAssetUrls,
  referencePictureCredit,
  type ReferencePicturePlan,
  type ReferencePictureRecord,
} from "@heytutor/drawing";

/**
 * A reference picture resolved to everything the board needs to draw it: the
 * server record (its authority and its credit), the validated stroke plan,
 * and both images decoded. Every byte comes from this origin (the image route
 * and the plan's `data:` mask), so the board's snapshots and export frames
 * stay readable; never point these at a cross-origin URL.
 */
export interface ReferencePictureAsset {
  id: string;
  record: ReferencePictureRecord;
  plan: ReferencePicturePlan;
  image: HTMLImageElement;
  inkMask: HTMLImageElement;
  credit: string;
  /** What `WhiteboardHandle.drawPicture` takes. */
  board: BoardPicture;
}

/** The executor gives up on a picture that has not arrived by then and teaches on. */
export const REFERENCE_PICTURE_LOAD_TIMEOUT_MS = 15_000;
/**
 * Decoded pictures are a few MB each and a lesson rarely shows more than a
 * couple, but a long session or a lecture with many pictures must not grow
 * without bound. A seek re-lands every page, so every picture of the lecture
 * being watched should stay cached; past this many the oldest goes.
 */
export const REFERENCE_PICTURE_CACHE_LIMIT = 12;

/**
 * A load that just failed is not retried at once. Export and seek run on a
 * clock that does not wait for the network, so a draw after a failed preload
 * must be skipped straight away rather than polled for the whole timeout.
 */
const FAILURE_RETRY_MS = 20_000;

const ready = new Map<string, ReferencePictureAsset>();
const loading = new Map<string, Promise<ReferencePictureAsset>>();
const failedAt = new Map<string, number>();

function noteFailure(id: string): void {
  const now = Date.now();
  // Only recent failures matter, so the map holds no more than a burst of them.
  for (const [failed, at] of failedAt) if (now - at >= FAILURE_RETRY_MS) failedAt.delete(failed);
  failedAt.set(id, now);
}

function recentlyFailed(id: string): boolean {
  const at = failedAt.get(id);
  if (at === undefined) return false;
  if (Date.now() - at < FAILURE_RETRY_MS) return true;
  failedAt.delete(id);
  return false;
}

/**
 * Most recent last. Past the limit the oldest picture the board does not show
 * goes first; if every one is on the board the oldest goes anyway, and it
 * keeps drawing (its nodes hold the image, and the board frees its line work
 * only once nothing shows it). An evicted picture's board canvases are
 * released, so a long session holds at most the limit's worth of them.
 */
function remember(asset: ReferencePictureAsset): void {
  ready.delete(asset.id);
  ready.set(asset.id, asset);
  while (ready.size > REFERENCE_PICTURE_CACHE_LIMIT) {
    let victim: ReferencePictureAsset | undefined;
    let oldest: ReferencePictureAsset | undefined;
    for (const cached of ready.values()) {
      if (cached === asset) continue;
      oldest ??= cached;
      if (!boardPictureInUse(cached.board)) { victim = cached; break; }
    }
    const evicted = victim ?? oldest;
    if (!evicted) break;
    ready.delete(evicted.id);
    releaseBoardPicture(evicted.board);
  }
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function decodeImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error("picture decoded to nothing");
  return image;
}

/**
 * The record route may answer with the record or with `{ picture }`. A
 * numbered picture's key must parse whole: a record whose key is malformed is
 * no record, so the picture is skipped rather than drawn with unnamed numbers.
 */
function parseRecord(raw: unknown, id: string): ReferencePictureRecord | null {
  const value = raw && typeof raw === "object" && "picture" in raw ? (raw as { picture: unknown }).picture : raw;
  if (!value || typeof value !== "object") return null;
  const record = value as ReferencePictureRecord;
  if (record.id !== id || (record.source !== "wikimedia" && record.source !== "generated")) return null;
  if (typeof record.artist !== "string" || typeof record.license !== "string" || typeof record.title !== "string") return null;
  if (record.legend === undefined) return record;
  const legend = parseReferencePictureLegend(record.legend);
  return legend ? { ...record, legend } : null;
}

async function loadReferencePicture(id: string, known?: ReferencePictureRecord): Promise<ReferencePictureAsset> {
  const urls = referencePictureAssetUrls(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFERENCE_PICTURE_LOAD_TIMEOUT_MS);
  try {
    const [rawRecord, rawPlan, imageBlob] = await Promise.all([
      known ? Promise.resolve(known) : fetchJson(urls.recordUrl, controller.signal),
      fetchJson(urls.planUrl, controller.signal),
      fetch(urls.imageUrl, { credentials: "same-origin", signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`${urls.imageUrl} answered ${response.status}`);
        return response.blob();
      }),
    ]);
    const record = parseRecord(rawRecord, id);
    if (!record) throw new Error(`reference picture ${id} has no valid record`);
    const plan = parseReferencePicturePlan(rawPlan);
    if (!plan) throw new Error(`reference picture ${id} has no valid stroke plan`);
    // A blob URL is same-origin, so drawing it never taints the board canvas.
    // The decoded element keeps its pixels once loaded; the URL only pins the
    // blob, so it is revoked as soon as the decode settles, either way.
    const imageUrl = URL.createObjectURL(imageBlob);
    let decoded: [HTMLImageElement, HTMLImageElement];
    try {
      decoded = await Promise.all([decodeImage(imageUrl), decodeImage(plan.inkMask)]);
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
    const [image, inkMask] = decoded;
    const credit = referencePictureCredit(record);
    // Light paper is keyed to transparent so the picture blends into the
    // board instead of sitting on a white box (owner, 28 Oct 2026).
    const shown = blendPictureIntoBoard(image, plan.paper);
    return {
      id,
      record,
      plan,
      image,
      inkMask,
      credit,
      board: { id, image: shown.image, ...(shown.blended ? { blended: true } : {}), inkMask, plan, credit, ...(record.legend ? { legend: record.legend } : {}) },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and decode a picture, once per id. Replay, seek and MP4 export run on
 * a clock that does not wait for the network, so they must await this for
 * every picture id in the lesson before they start; the live turn may call it
 * as soon as the server returns the record (pass it to skip a fetch).
 */
export function preloadReferencePicture(id: string, record?: ReferencePictureRecord): Promise<ReferencePictureAsset> {
  if (!isReferencePictureId(id)) return Promise.reject(new Error(`not a reference picture id: ${String(id)}`));
  const cached = ready.get(id);
  if (cached) {
    remember(cached);
    return Promise.resolve(cached);
  }
  const pending = loading.get(id);
  if (pending) return pending;
  if (recentlyFailed(id)) return Promise.reject(new Error(`reference picture ${id} failed to load moments ago`));
  const load = loadReferencePicture(id, record).then(
    (asset) => {
      loading.delete(id);
      remember(asset);
      return asset;
    },
    (error: unknown) => {
      // Remembered briefly, not for good: a later turn may ask again.
      loading.delete(id);
      noteFailure(id);
      throw error;
    },
  );
  loading.set(id, load);
  return load;
}

/** The decoded picture if it is already here, without waiting. */
export function peekReferencePicture(id: string): ReferencePictureAsset | null {
  return ready.get(id) ?? null;
}

/**
 * The picture for a command about to draw: at once if preloaded, else after
 * the fetch, polled so a cancelled turn is released within a frame or two
 * instead of holding its atomic intro for the whole timeout. Null on any
 * failure, timeout or cancellation; the caller skips the picture and teaches on.
 */
export async function awaitReferencePicture(
  id: string,
  options: { isCancelled?: () => boolean; timeoutMs?: number } = {},
): Promise<ReferencePictureAsset | null> {
  const cached = peekReferencePicture(id);
  if (cached) return cached;
  const outcome: { asset?: ReferencePictureAsset | null } = {};
  preloadReferencePicture(id).then(
    (asset) => { outcome.asset = asset; },
    (error: unknown) => {
      outcome.asset = null;
      console.warn("[reference-picture] could not load", id, error);
    },
  );
  const deadline = Date.now() + (options.timeoutMs ?? REFERENCE_PICTURE_LOAD_TIMEOUT_MS);
  while (outcome.asset === undefined) {
    if (options.isCancelled?.() || Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return outcome.asset;
}
