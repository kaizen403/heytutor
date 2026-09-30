/**
 * Lecture MP3s are stored privately on S3. Persist writes a same-origin
 * `/api/media?key=` URL. Legacy public hosts still go through `/api/lecture-audio?src=`.
 * Blob and same-origin URLs stay direct.
 */

/** Bytes of a `data:` URL. Lecture clips use these only as a fallback. */
export function dataUrlToBytes(url: string): Uint8Array | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return null;
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  try {
    if (meta.includes(";base64")) {
      const binary = atob(payload.replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

export function lectureAudioFetchUrl(
  url: string,
  origin: string | null = typeof location === "undefined" ? null : location.origin,
): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (origin && parsed.origin === origin) return trimmed;
  } catch {
    return trimmed;
  }

  return `/api/lecture-audio?src=${encodeURIComponent(trimmed)}`;
}

export function isAllowedLectureAudioSource(
  src: string,
  publicBaseUrl: string | null,
): boolean {
  if (!publicBaseUrl?.trim()) return false;
  try {
    const allowed = new URL(publicBaseUrl);
    const incoming = new URL(src);
    if (incoming.protocol !== "https:") return false;
    if (incoming.username || incoming.password) return false;
    return incoming.origin === allowed.origin;
  } catch {
    return false;
  }
}
