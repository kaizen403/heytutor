/** Cosmetic input only. AI pixels never supply scientific marks or source claims. */
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import sharp, { type OutputInfo } from "sharp";
import { SCIENTIFIC_STYLE_SCHEMA, SCIENTIFIC_STYLE_PALETTES,
  type ScientificStylePaletteId } from "@heytutor/scene-engine";

export const GENERATED_SCENE_STYLE_SAMPLE_SCHEMA = "generated-scene-style-sample/v1" as const;
export const GENERATED_SCENE_STYLE_SAMPLE_POLICY_VERSION = "complete-rgb5-color-histogram/v3" as const;
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 4_000_000;
const MAX_DIMENSION = 2048;
const MAX_PNG_CHUNKS = 4096;
const HUE_BINS = 36;
// Palette sampling needs pixel data and only small fixed-size color headers.
// Text, ICC/EXIF and vendor metadata may decompress independently of pixel
// bounds, so reject them before a native decoder can allocate their contents.
const PNG_CORE_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
const PNG_HEADER_LIMITS: Record<string, number> = {
  sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9, sBIT: 4, bKGD: 6, hIST: 512, tIME: 7,
};
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface ScientificSceneStyleSample {
  readonly accepted: false;
  readonly automaticAdmission: false;
  readonly style: Readonly<{ schema: typeof SCIENTIFIC_STYLE_SCHEMA; paletteId: ScientificStylePaletteId }>;
  readonly receipt: Readonly<{
    schema: typeof GENERATED_SCENE_STYLE_SAMPLE_SCHEMA;
    policyVersion: typeof GENERATED_SCENE_STYLE_SAMPLE_POLICY_VERSION;
    rawImageHash: string;
    decodeInputHash: string;
    omittedMetadataChunks: number;
    encodedBytes: number;
    selectedBy: "ai_color_sample" | "engine_default";
    reason?: "white_or_neutral" | "insufficient_chroma";
    sample: Readonly<{
      sampledPixels: number;
      whitePixels: number;
      neutralPixels: number;
      chromaticPixels: number;
      hueHistogram: readonly number[];
      meanSaturationPermille: number;
    }>;
  }>;
}

export class GeneratedSceneStyleSampleError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`); this.name = "GeneratedSceneStyleSampleError";
  }
}
function fail(code: string, message: string): never { throw new GeneratedSceneStyleSampleError(code, message); }

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const nativeLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const nativeName = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const nativeBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const nativeSet = Uint8Array.prototype.set;

/** Intrinsic access avoids getters, iterators, species and proxy callbacks. */
function snapshotPng(raw: Uint8Array): Buffer {
  if (!ArrayBuffer.isView(raw) || Reflect.apply(nativeName, raw, []) !== "Uint8Array")
    fail("style_sample_bytes", "A genuine unshared Uint8Array PNG frame is required");
  try { Reflect.apply(nativeBufferLength, Reflect.apply(nativeBuffer, raw, []), []); }
  catch { fail("style_sample_bytes", "Shared or detached byte frames are unsupported"); }
  const length: number = Reflect.apply(nativeLength, raw, []);
  if (length < PNG_SIGNATURE.length || length > MAX_PNG_BYTES)
    fail("style_sample_budget", "The complete encoded PNG must fit the 8 MiB budget");
  const bytes = Buffer.alloc(length);
  Reflect.apply(nativeSet, bytes, [raw]);
  return bytes;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function chunkCrc(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]!) & 255]!;
  return (crc ^ 0xffffffff) >>> 0;
}

/** Animation chunks are rejected even when a decoder would silently read frame one. */
function inspectPng(bytes: Buffer): { width: number; height: number; decodeBytes: Buffer; omittedMetadataChunks: number } {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail("style_sample_png", "Only a complete PNG is supported");
  let offset = 8, chunks = 0, width = 0, height = 0, sawData = false;
  const decodeParts = [bytes.subarray(0, 8)];
  let omittedMetadataChunks = 0;
  while (offset < bytes.length) {
    if (++chunks > MAX_PNG_CHUNKS || offset + 12 > bytes.length)
      fail("style_sample_png", "The PNG chunk envelope is incomplete or exceeds its budget");
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) fail("style_sample_png", "The PNG chunk is truncated");
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (chunkCrc(bytes, offset + 4, end - 4) !== bytes.readUInt32BE(end - 4))
      fail("style_sample_png", "The PNG chunk checksum is invalid");
    if (kind === "acTL" || kind === "fcTL" || kind === "fdAT")
      fail("style_sample_frame", "Only a single nonanimated PNG frame is supported");
    // MAI emits C2PA provenance in caBX. Validate its complete raw envelope,
    // retain the original hash, then omit only this non-pixel box before Sharp.
    // It is never decompressed, interpreted or treated as scientific evidence.
    if (kind === "caBX") omittedMetadataChunks++;
    else if (!PNG_CORE_CHUNKS.has(kind) && (!Object.hasOwn(PNG_HEADER_LIMITS, kind) || length > PNG_HEADER_LIMITS[kind]!))
      fail("style_sample_metadata", "Palette sampling refuses unused or oversized metadata before decoding");
    if (kind === "PLTE" && length > 768 || kind === "tRNS" && length > 256)
      fail("style_sample_metadata", "Palette and transparency headers exceed their fixed PNG bounds");
    if (chunks === 1) {
      if (kind !== "IHDR" || length !== 13) fail("style_sample_png", "The PNG requires one leading image header");
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS)
        fail("style_sample_frame", "The PNG exceeds the 2048 dimension or 4 million pixel budget");
    } else if (kind === "IHDR") fail("style_sample_png", "The PNG has duplicate image headers");
    if (kind === "IDAT") sawData = true;
    if (kind !== "caBX") decodeParts.push(bytes.subarray(offset, end));
    if (kind === "IEND") {
      if (length !== 0 || !sawData || end !== bytes.length)
        fail("style_sample_png", "The complete PNG must end after its image data");
      return { width, height, omittedMetadataChunks,
        decodeBytes: omittedMetadataChunks ? Buffer.concat(decodeParts) : bytes };
    }
    offset = end;
  }
  fail("style_sample_png", "The complete PNG has no terminal chunk");
}

interface ColorFeature { hue: number; saturation: number; }
function colorFeature(red: number, green: number, blue: number): ColorFeature {
  const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue), chroma = maximum - minimum;
  let hue = 0;
  if (chroma) {
    if (maximum === red) hue = ((green - blue) / chroma) % 6;
    else if (maximum === green) hue = (blue - red) / chroma + 2;
    else hue = (red - green) / chroma + 4;
  }
  return { hue: (hue * 60 + 360) % 360, saturation: maximum ? chroma / maximum : 0 };
}
function paletteFeature(hex: string): ColorFeature {
  const value = Number.parseInt(hex.slice(1), 16);
  return colorFeature(((value >>> 16) >> 3) * 8 + 4, (((value >>> 8) & 255) >> 3) * 8 + 4, ((value & 255) >> 3) * 8 + 4);
}
const paletteFeatures = SCIENTIFIC_STYLE_PALETTES.map(palette => ({
  paletteId: palette.paletteId, ink: paletteFeature(palette.ink), fill: paletteFeature(palette.regionFill),
}));
function colorDistance(left: ColorFeature, right: ColorFeature): number {
  const difference = Math.abs(left.hue - right.hue), hue = Math.min(difference, 360 - difference) / 180;
  return hue * hue + 0.25 * (left.saturation - right.saturation) ** 2;
}

/** Full-image RGB5 counts retain no positions. Rearranging pixels cannot change
 * this summary or palette choice. No downsampling, source question or semantic
 * reading is involved; each selected color still comes from the engine. */
export async function sampleScientificSceneStyle(png: Uint8Array): Promise<ScientificSceneStyleSample> {
  // Copy and hash before the first await; the caller cannot change either later.
  const bytes = snapshotPng(png), frame = inspectPng(bytes);
  const rawImageHash = createHash("sha256").update(bytes).digest("hex");
  const decodeInputHash = createHash("sha256").update(frame.decodeBytes).digest("hex");
  const image = sharp(frame.decodeBytes, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
  let decoded: { data: Buffer; info: OutputInfo };
  try {
    const metadata = await image.metadata();
    if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1 || metadata.delay || metadata.loop !== undefined ||
        metadata.width !== frame.width || metadata.height !== frame.height)
      fail("style_sample_frame", "The decoded PNG must match its single complete frame");
    decoded = await image.flatten({ background: "white" }).removeAlpha().toColourspace("srgb")
      .raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof GeneratedSceneStyleSampleError) throw error;
    fail("style_sample_decode", "The complete PNG could not be decoded without warnings");
  }
  const sampledPixels = frame.width * frame.height;
  if (decoded.info.channels !== 3 || decoded.info.width !== frame.width || decoded.info.height !== frame.height ||
      decoded.data.length !== sampledPixels * 3) fail("style_sample_decode", "Expected one complete normalized RGB frame");
  const histogram = new Uint32Array(32 * 32 * 32);
  for (let offset = 0; offset < decoded.data.length; offset += 3) {
    const bin = (decoded.data[offset]! >> 3) * 1024 + (decoded.data[offset + 1]! >> 3) * 32 + (decoded.data[offset + 2]! >> 3);
    histogram[bin] = histogram[bin]! + 1;
    if (offset && offset % (262_144 * 3) === 0) await setImmediate();
  }
  const hueHistogram = Array<number>(HUE_BINS).fill(0), scores = paletteFeatures.map(() => 0);
  let whitePixels = 0, neutralPixels = 0, chromaticPixels = 0, totalSaturation = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    const count = histogram[bin]!;
    if (!count) continue;
    const red = (bin >>> 10) * 8 + 4, green = ((bin >>> 5) & 31) * 8 + 4, blue = (bin & 31) * 8 + 4;
    const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue);
    if (minimum >= 240) { whitePixels += count; continue; }
    if (maximum < 32 || maximum - minimum < 16) { neutralPixels += count; continue; }
    const feature = colorFeature(red, green, blue), hueBin = Math.min(HUE_BINS - 1, Math.floor(feature.hue / 10));
    chromaticPixels += count; totalSaturation += feature.saturation * count;
    hueHistogram[hueBin] = hueHistogram[hueBin]! + count;
    for (let index = 0; index < paletteFeatures.length; index++) {
      const palette = paletteFeatures[index]!;
      scores[index] = scores[index]! + count * Math.min(colorDistance(feature, palette.ink), colorDistance(feature, palette.fill));
    }
  }
  const reason = chromaticPixels === 0 ? "white_or_neutral" : chromaticPixels * 1000 < sampledPixels ? "insufficient_chroma" : undefined;
  let paletteId: ScientificStylePaletteId = "slate";
  if (!reason) {
    let selected = 0;
    for (let index = 1; index < scores.length; index++) if (scores[index]! < scores[selected]!) selected = index;
    paletteId = paletteFeatures[selected]!.paletteId;
  }
  const sample = Object.freeze({ sampledPixels, whitePixels, neutralPixels, chromaticPixels,
    hueHistogram: Object.freeze(hueHistogram), meanSaturationPermille: chromaticPixels ? Math.round(totalSaturation * 1000 / chromaticPixels) : 0 });
  return Object.freeze({ accepted: false, automaticAdmission: false,
    style: Object.freeze({ schema: SCIENTIFIC_STYLE_SCHEMA, paletteId }),
    receipt: Object.freeze({ schema: GENERATED_SCENE_STYLE_SAMPLE_SCHEMA,
      policyVersion: GENERATED_SCENE_STYLE_SAMPLE_POLICY_VERSION, rawImageHash, decodeInputHash,
      omittedMetadataChunks: frame.omittedMetadataChunks, encodedBytes: bytes.length,
      selectedBy: reason ? "engine_default" : "ai_color_sample", ...(reason ? { reason } : {}), sample }) });
}
