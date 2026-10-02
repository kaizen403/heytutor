import { MAX_QUESTION_IMAGE_DATA_URL_CHARS } from "@/lib/llm/extractQuestion";

const QUESTION_IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type QuestionImage = {
  dataUrl: string;
  mimeType: string;
  ext: string;
  bytes: Uint8Array;
};

const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;

function safeDimensions(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_SIDE &&
    height <= MAX_IMAGE_SIDE &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

/** Static raster headers only. Never expand compressed image data here. Every
 * chunk/segment walk advances within the already bounded uploaded bytes. */
function validImageContent(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") {
    if (
      bytes.length < 33 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      !safeDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    )
      return false;
    let sawData = false;
    for (let position = 8; position + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(position);
      if (length > bytes.length - position - 12) return false;
      const kind = bytes.toString("ascii", position + 4, position + 8);
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT") return false;
      if (kind === "IDAT") sawData = true;
      position += 12 + length;
      if (kind === "IEND")
        return length === 0 && sawData && position === bytes.length;
    }
    return false;
  }
  if (mimeType === "image/jpeg") {
    if (
      bytes.length < 10 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff ||
      bytes[bytes.length - 1] !== 0xd9
    )
      return false;
    let position = 2;
    while (position + 4 <= bytes.length) {
      if (bytes[position++] !== 0xff) return false;
      while (bytes[position] === 0xff) position += 1;
      const marker = bytes[position++];
      if (marker === undefined || marker === 0xda || marker === 0xd9)
        return false;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (position + 2 > bytes.length) return false;
      const length = bytes.readUInt16BE(position);
      if (length < 2 || position + length > bytes.length) return false;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        return (
          length >= 8 &&
          safeDimensions(
            bytes.readUInt16BE(position + 5),
            bytes.readUInt16BE(position + 3),
          )
        );
      }
      position += length;
    }
    return false;
  }
  if (mimeType === "image/webp") {
    if (
      bytes.length < 20 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP" ||
      bytes.readUInt32LE(4) !== bytes.length - 8
    )
      return false;
    let sawFrame = false;
    let validCanvas = true;
    for (let position = 12; position + 8 <= bytes.length;) {
      const kind = bytes.toString("ascii", position, position + 4);
      const length = bytes.readUInt32LE(position + 4);
      const start = position + 8;
      if (length > bytes.length - start) return false;
      if (kind === "ANIM" || kind === "ANMF") return false;
      if (kind === "VP8X") {
        if (length !== 10 || (bytes[start]! & 2) !== 0) return false;
        validCanvas = safeDimensions(
          bytes.readUIntLE(start + 4, 3) + 1,
          bytes.readUIntLE(start + 7, 3) + 1,
        );
        if (!validCanvas) return false;
      } else if (kind === "VP8 " || kind === "VP8L") {
        if (sawFrame) return false;
        sawFrame = true;
        if (kind === "VP8 ") {
          if (
            length < 10 ||
            !bytes
              .subarray(start + 3, start + 6)
              .equals(Buffer.from([0x9d, 0x01, 0x2a])) ||
            !safeDimensions(
              bytes.readUInt16LE(start + 6) & 0x3fff,
              bytes.readUInt16LE(start + 8) & 0x3fff,
            )
          )
            return false;
        } else {
          if (length < 5 || bytes[start] !== 0x2f) return false;
          const bits = bytes.readUInt32LE(start + 1);
          if (
            !safeDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
          )
            return false;
        }
      }
      position = start + length + (length % 2);
      if (position === bytes.length) return sawFrame && validCanvas;
    }
    return false;
  }
  if (mimeType === "image/gif") {
    if (
      bytes.length < 14 ||
      !["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) ||
      !safeDimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
    )
      return false;
    let position =
      13 + (bytes[10]! & 0x80 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
    let frames = 0;
    const skipBlocks = (start: number): number => {
      let next = start;
      while (next < bytes.length) {
        const length = bytes[next++]!;
        if (length === 0) return next;
        if (length > bytes.length - next) return -1;
        next += length;
      }
      return -1;
    };
    while (position >= 0 && position < bytes.length) {
      const kind = bytes[position++]!;
      if (kind === 0x3b) return frames === 1 && position === bytes.length;
      if (kind === 0x21) {
        position = skipBlocks(position + 1);
        continue;
      }
      if (
        kind !== 0x2c ||
        position + 9 > bytes.length ||
        ++frames > 1 ||
        !safeDimensions(
          bytes.readUInt16LE(position + 4),
          bytes.readUInt16LE(position + 6),
        )
      )
        return false;
      const packed = bytes[position + 8]!;
      position += 9 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
      position = skipBlocks(position + 1); // bounded LZW data sub-blocks
    }
  }
  return false;
}

export function readQuestionImage(image: unknown): QuestionImage | null {
  if (typeof image !== "string") return null;
  const trimmed = image.trim();
  const match =
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(trimmed);
  if (!match?.[1] || !match[2]) return null;
  const mimeType = match[1].toLowerCase();
  const ext = QUESTION_IMAGE_EXT[mimeType];
  if (!ext || trimmed.length > MAX_QUESTION_IMAGE_DATA_URL_CHARS) return null;
  const base64 = match[2].replace(/\s+/g, "");
  try {
    const bytes = Buffer.from(base64, "base64");
    if (
      bytes.length === 0 ||
      bytes.toString("base64").replace(/=+$/, "") !==
        base64.replace(/=+$/, "") ||
      !validImageContent(bytes, mimeType)
    )
      return null;
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
      ext,
      bytes,
    };
  } catch {
    return null;
  }
}
