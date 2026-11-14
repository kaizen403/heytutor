import { MAX_QUESTION_IMAGE_DATA_URL_CHARS } from "@/lib/llm/extractQuestion";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Longest edge and JPEG quality, tried in order until the upload fits the server limit. */
const ENCODE_ATTEMPTS: ReadonlyArray<readonly [maxEdge: number, quality: number]> = [
  [1600, 0.82],
  [1280, 0.74],
  [1024, 0.68],
  [800, 0.6],
];
/** A small crop is enlarged to this longest edge (at most 3x) so its text keeps enough vision tokens. */
const MIN_EDGE = 1024;
const MAX_UPSCALE = 3;

export function questionImageScale(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  if (longest < MIN_EDGE) return Math.min(MAX_UPSCALE, MIN_EDGE / longest, maxEdge / longest);
  return Math.min(1, maxEdge / longest);
}

function encodeBitmap(bitmap: ImageBitmap, maxEdge: number, quality: number): string {
  const scale = questionImageScale(bitmap.width, bitmap.height, maxEdge);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not read that image.");
  }
  // JPEG has no alpha: a transparent PNG of dark text would turn black on black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) {
    throw new Error("Could not read that image.");
  }
  return dataUrl;
}

export async function compressQuestionImage(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Image is too large. Use a photo under 8 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    // A dense page scan can exceed the server limit even at 1600px; the server
    // would only answer "send a JPEG", so shrink here until it fits.
    for (const [maxEdge, quality] of ENCODE_ATTEMPTS) {
      const dataUrl = encodeBitmap(bitmap, maxEdge, quality);
      if (dataUrl.length <= MAX_QUESTION_IMAGE_DATA_URL_CHARS) {
        return dataUrl;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("That photo is too detailed to send. Try a closer shot of just the question.");
}
