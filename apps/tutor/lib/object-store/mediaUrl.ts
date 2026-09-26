import { parseStoredObjectKey } from "./keys";

const MEDIA_API_PATH = "/api/media";
const LECTURE_AUDIO_API_PATH = "/api/lecture-audio";

export function mediaProxyUrl(key: string): string {
  return `${MEDIA_API_PATH}?key=${encodeURIComponent(key)}`;
}

function urlFromMaybeRelative(value: string): URL | null {
  try {
    if (value.startsWith("/")) {
      return new URL(value, "http://heytutor.invalid");
    }
    return new URL(value);
  } catch {
    return null;
  }
}

/** Pull a stored object key out of `/api/media?key=` or `/api/lecture-audio?key=`. */
export function mediaKeyFromUrl(url: string): string | null {
  const parsed = urlFromMaybeRelative(url.trim());
  if (!parsed) return null;
  if (parsed.pathname !== MEDIA_API_PATH && parsed.pathname !== LECTURE_AUDIO_API_PATH) {
    return null;
  }
  const key = parsed.searchParams.get("key")?.trim() ?? "";
  return parseStoredObjectKey(key) ? key : null;
}
