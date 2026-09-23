import { parseStoredObjectKey } from "./keys";

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/wav",
]);

export function contentTypeForStoredKey(key: string): string {
  const parsed = parseStoredObjectKey(key);
  if (parsed?.kind === "lecture") return parsed.ext === "wav" ? "audio/wav" : "audio/mpeg";
  if (parsed?.kind === "image") return IMAGE_TYPES[parsed.ext] ?? "application/octet-stream";
  return "application/octet-stream";
}

export function isAllowedMediaContentType(value: string): boolean {
  return ALLOWED_MEDIA_TYPES.has(value.toLowerCase().split(";", 1)[0]?.trim() ?? "");
}

export function contentDispositionForKey(key: string): string {
  const parsed = parseStoredObjectKey(key);
  if (parsed?.kind === "lecture") return `inline; filename="lecture.${parsed.ext}"`;
  if (parsed?.kind === "image") return `inline; filename="question.${parsed.ext}"`;
  return 'attachment; filename="download"';
}
