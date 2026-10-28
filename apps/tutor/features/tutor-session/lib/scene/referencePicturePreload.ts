/**
 * Bounded preloads of reference picture assets (image and stroke plan), so
 * a picture is never drawn before its pixels arrive: the live turn waits for
 * them before it commits to the picture, and replay, restore and export wait
 * before their timelines start. Never throws; a failed or slow preload is a
 * `false`, and the caller decides what that means (the live turn teaches as
 * text, a replay draws whatever the board can).
 */
import type { ReferencePictureRecord } from "@heytutor/drawing";
import { preloadReferencePicture } from "../board/referencePictureAssets";
import { referencePictureIdsOfTurns } from "./restoreReferencePicture";

/** Same-origin, immutable assets: past this, the network is the problem. */
export const REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS = 8_000;

/** `record` is the live turn's fresh record, which spares the board a fetch. */
export async function preloadReferencePictureWithin(
  id: string,
  timeoutMs = REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS,
  record?: ReferencePictureRecord,
  preload: (id: string, record?: ReferencePictureRecord) => Promise<unknown> = preloadReferencePicture,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => preload(id, record)).then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs)); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * An MP4 export may wait this long for its pictures: it runs on a virtual
 * clock that never waits for the network, so a picture not here before the
 * first frame would be drawn late against its cue or not at all.
 */
export const REFERENCE_PICTURE_EXPORT_PRELOAD_TIMEOUT_MS = 30_000;

/**
 * Preload every picture a set of stored turns will draw, in parallel, and
 * name the ones that did not arrive in time. Live replay and restore draw
 * whatever the board can; an export refuses to start without them.
 */
export async function preloadReferencePicturesForTurns(
  turns: Parameters<typeof referencePictureIdsOfTurns>[0],
  timeoutMs = REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS,
  preload?: (id: string) => Promise<unknown>,
): Promise<{ missing: string[] }> {
  return preloadReferencePictureIds(referencePictureIdsOfTurns(turns), timeoutMs, preload);
}

/** Preload pictures by id in parallel; name the ones not here within `timeoutMs`. */
export async function preloadReferencePictureIds(
  ids: readonly string[],
  timeoutMs = REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS,
  preload?: (id: string) => Promise<unknown>,
): Promise<{ missing: string[] }> {
  if (ids.length === 0) return { missing: [] };
  const ready = await Promise.all(ids.map((id) => preloadReferencePictureWithin(id, timeoutMs, undefined, preload)));
  return { missing: ids.filter((_, i) => !ready[i]) };
}
