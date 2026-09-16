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

export function readQuestionImage(image: unknown): QuestionImage | null {
  if (typeof image !== "string") return null;
  const trimmed = image.trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(trimmed);
  if (!match?.[1] || !match[2]) return null;
  const mimeType = match[1].toLowerCase();
  const ext = QUESTION_IMAGE_EXT[mimeType];
  if (!ext || trimmed.length > MAX_QUESTION_IMAGE_DATA_URL_CHARS) return null;
  const base64 = match[2].replace(/\s+/g, "");
  try {
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    if (bytes.length === 0) return null;
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
