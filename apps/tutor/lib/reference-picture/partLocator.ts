/**
 * The part locator: where each judged name (or a numbered picture's mark) is
 * printed on a stored picture, so the pen can point at "R1" instead of the
 * whole picture. Runs once, when the picture is stored, after its stroke
 * plan; no model is asked.
 *
 * Source 1 is the Commons SVG's own text (`partLocatorSvg.ts`): exact where
 * the labels are still text. Source 2 reads the raster (`partLocatorOcr.ts`)
 * for bitmaps and SVGs whose labels were converted to outlines. Lines from
 * either source are matched against the record's names (`partLocatorMatch.ts`)
 * and every box must sit on printed ink in the plan's own ink mask.
 *
 * Never wrong over complete: a name printed twice, read twice, or boxed
 * where the plan has no ink gets no part. Any failure or the time budget
 * running out gives no parts at all, and the picture is stored and shown as
 * before. It never throws and takes no caller signal: locating is free work,
 * so a request that goes away mid-locate still gets its picture stored.
 */
import sharp from "sharp";
import { legendMarkKey, normalizeLegendMark, parseReferencePictureParts, type PicturePlacement, type ReferencePictureLegendEntry, type ReferencePicturePart, type ReferencePicturePlan } from "@heytutor/drawing";
import { joinLines, labelKeys, markSetHolds, markStylesMixed, matchLabels, matchMarks, partsFrom, wordKey, type LocatedName, type MatchOutcome, type TextLine } from "./partLocatorMatch";
import { readSvgText, SVG_MAX_BYTES } from "./partLocatorSvg";
import { downloadPicture } from "./wikimediaSearch";

/** The whole locator's budget, fetch included. Measured 28 Oct 2026: an original SVG fetch takes 0.1 to 1.3 s (median 0.23 s) and reading it under 20 ms. */
export const PART_LOCATOR_BUDGET_MS = 4000;
/**
 * A box must have this share of its pixels on printed ink. Text set at plan
 * size measures 12% to 60%; a box that landed on paper (text hidden, covered,
 * or mapped wrong) measures near 0.
 */
const MIN_INK_SHARE = 0.06;
/** And ink in this share of its upright strips, one per half text height, so the box spans the word and not one stroke beside it. */
const MIN_STRIP_SHARE = 0.6;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Reads printed lines off the plan picture. Optional: without one, only SVG text is read. */
export type RasterTextReader = (picturePng: Buffer, plan: { width: number; height: number }, signal: AbortSignal) => Promise<TextLine[]>;

export interface LocatePartsInput {
  /** The Commons candidate, or null for a generated picture. */
  candidate: { mime: string; originalUrl?: string } | null;
  plan: Pick<ReferencePicturePlan, "width" | "height" | "inkMask">;
  /** The picture at plan size, as stored. */
  picturePng: Buffer;
  labels: readonly string[];
  legend?: readonly ReferencePictureLegendEntry[] | null;
  fetchImpl?: FetchLike;
  readRaster?: RasterTextReader | null;
  budgetMs?: number;
}

export interface LocatePartsResult {
  parts: ReferencePicturePart[];
  /** One line for the pipeline's step trail. */
  step: string;
}

/** Decode the plan's ink mask (opaque where the picture has line work) to one byte per pixel. */
export async function decodeInkMask(inkMask: string, width: number, height: number): Promise<Uint8Array | null> {
  if (!inkMask.startsWith("data:image/png;base64,")) return null;
  const { data, info } = await sharp(Buffer.from(inkMask.slice("data:image/png;base64,".length), "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) return null;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = data[i * 4 + 3]! > 127 ? 1 : 0;
  return ink;
}

/**
 * Is this box printed text on the picture: enough ink inside it, spread
 * across its width. A wrong mapping, a label hidden under a shape, or text
 * the raster never drew all fail here.
 */
export function boxOnInk(box: PicturePlacement, ink: Uint8Array, width: number, height: number): boolean {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(width, Math.ceil(box.x + box.width));
  const bottom = Math.min(height, Math.ceil(box.y + box.height));
  if (right - left < 2 || bottom - top < 2) return false;
  const stripWidth = Math.max(2, Math.round((bottom - top) / 2));
  const strips = Math.max(1, Math.round((right - left) / stripWidth));
  const stripInk = new Uint32Array(strips);
  let total = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (!ink[y * width + x]) continue;
      total++;
      stripInk[Math.min(strips - 1, Math.floor(((x - left) * strips) / (right - left)))]!++;
    }
  }
  const inked = stripInk.filter((n) => n > 0).length;
  return total >= MIN_INK_SHARE * (right - left) * (bottom - top) && inked >= Math.ceil(MIN_STRIP_SHARE * strips);
}

/** A word is on the picture when its box's centre is. */
function onPicture(box: PicturePlacement, plan: { width: number; height: number }): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= 0 && cy >= 0 && cx <= plan.width && cy <= plan.height;
}

async function svgLines(input: LocatePartsInput, signal: AbortSignal): Promise<{ lines: TextLine[]; unplaced: string[]; note: string } | null> {
  const url = input.candidate?.originalUrl;
  if (input.candidate?.mime !== "image/svg+xml" || !url) return null;
  try {
    const { bytes } = await downloadPicture(url, { maxBytes: SVG_MAX_BYTES, signal, fetchImpl: input.fetchImpl });
    const read = await readSvgText(bytes.toString("utf8"), input.plan, signal);
    if (!read) return { lines: [], unplaced: [], note: "svg unreadable" };
    return { lines: read.lines, unplaced: read.unplaced, note: `svg ${read.texts} texts${read.skipped ? ` (${read.skipped} left out)` : ""}` };
  } catch (error) {
    return { lines: [], unplaced: [], note: `svg ${error instanceof Error ? error.message : "failed"}` };
  }
}

async function locate(input: LocatePartsInput, signal: AbortSignal): Promise<LocatePartsResult> {
  const notes: string[] = [];
  const svg = await svgLines(input, signal);
  if (svg) notes.push(svg.note);
  let lines = svg?.lines ?? [];
  // The raster is read only when the SVG gave no text at all: mixing the two
  // could read one printed label twice and call it ambiguous, or worse, once
  // in each source and call it two different places.
  if (!lines.length && input.readRaster) {
    try {
      lines = await input.readRaster(input.picturePng, input.plan, signal);
      notes.push(`ocr ${lines.length} lines`);
    } catch (error) {
      notes.push(`ocr ${error instanceof Error ? error.message : "failed"}`);
      lines = [];
    }
  }
  // Text set outside the canvas (a spare translation parked beside the drawing) is not printed: it must not count as a second place.
  lines = lines.map((line) => ({ ...line, words: line.words.filter((w) => onPicture(w.box, input.plan)) })).filter((line) => line.words.length > 0);
  if (!lines.length) return { parts: [], step: `${notes.join(", ") || "no source"}: none` };
  const joined = joinLines(lines);
  const numbered = Boolean(input.legend?.length);
  const matched: MatchOutcome = numbered ? matchMarks(joined, input.legend!) : matchLabels(joined, input.labels);
  // A name also printed where it could not be boxed (rotated, on a path) is
  // printed twice. Each unplaced word is indexed by its key (a mark's key on a
  // numbered picture), so a name is compared only where its first word is.
  const unplaced = (svg?.unplaced ?? []).map((text) => text.split(/\s+/).map(wordKey).filter(Boolean).map((word) => (numbered ? legendMarkKey(normalizeLegendMark(word) ?? "") : word)));
  const starts = new Map<string, Array<[text: number, word: number]>>();
  unplaced.forEach((words, t) => words.forEach((key, i) => { if (key) (starts.get(key) ?? starts.set(key, []).get(key)!).push([t, i]); }));
  const elsewhere = (name: LocatedName) => {
    const keys = numbered ? [legendMarkKey(name.mark!)] : labelKeys(name.label);
    return (starts.get(keys[0]!) ?? []).some(([t, i]) => keys.every((k, j) => unplaced[t]![i + j] === k));
  };
  const outcome: MatchOutcome = { ...matched, located: matched.located.filter((name) => !elsewhere(name)), ambiguous: [...matched.ambiguous, ...matched.located.filter(elsewhere).map((name) => name.mark ?? name.label)] };
  const ink = await decodeInkMask(input.plan.inkMask, input.plan.width, input.plan.height);
  if (!ink) return { parts: [], step: `${notes.join(", ")}: ink mask unreadable` };
  const offInk: LocatedName[] = [];
  let onInk = outcome.located.filter((name) => {
    const ok = boxOnInk(name.box, ink, input.plan.width, input.plan.height);
    if (!ok) offInk.push(name);
    return ok;
  });
  // Marks count only as a set (enough of the key, at one size); a lone digit may be anything.
  const looseMarks = numbered && onInk.length > 0 && !markSetHolds(onInk, input.legend!.length) ? onInk.length : 0;
  if (looseMarks) onInk = [];
  const record = { plan: input.plan, labels: input.labels, legend: input.legend ?? null };
  const parts = parseReferencePictureParts(partsFrom(onInk, input.labels, input.plan), record);
  const named = numbered ? input.legend!.length : input.labels.length;
  const tally = [`${parts.length} of ${named} ${numbered ? "marks" : "names"}`];
  if (outcome.ambiguous.length) tally.push(`${outcome.ambiguous.length} ambiguous`);
  if (offInk.length) tally.push(`${offInk.length} off ink`);
  if (looseMarks) tally.push(`${looseMarks} marks not a set`);
  return { parts, step: `${notes.join(", ")}: ${tally.join(", ")}` };
}

/**
 * Locate a stored picture's parts. Resolves with no parts on any failure or
 * when the budget runs out (which also stops the fetch and the reader);
 * never rejects.
 */
export async function locateReferencePictureParts(input: LocatePartsInput): Promise<LocatePartsResult> {
  if (!input.labels.length && !input.legend?.length) return { parts: [], step: "no names" };
  // A key printing both "01" and "1" was misread; its marks are not looked for.
  if (input.legend?.length && markStylesMixed(input.legend)) return { parts: [], step: "key mixes 01 and 1 marks: none" };
  const budget = new AbortController();
  const signal = budget.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LocatePartsResult>((resolve) => {
    timer = setTimeout(() => {
      budget.abort();
      resolve({ parts: [], step: "timed out" });
    }, input.budgetMs ?? PART_LOCATOR_BUDGET_MS);
  });
  try {
    return await Promise.race([
      locate(input, signal).catch((error: unknown) => ({ parts: [], step: `failed: ${error instanceof Error ? error.message : String(error)}` })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A stored record JSON with its located parts replaced: set when there are
 * some, the key removed when there are none. Pure and idempotent, so a
 * backfill run twice writes the same record.
 */
export function recordWithParts<T extends object>(record: T, parts: readonly ReferencePicturePart[]): Omit<T, "parts"> & { parts?: ReferencePicturePart[] } {
  const rest = { ...record } as Record<string, unknown>;
  delete rest.parts;
  return (parts.length ? { ...rest, parts: parts.map((part) => ({ ...part, box: { ...part.box } })) } : rest) as Omit<T, "parts"> & { parts?: ReferencePicturePart[] };
}
