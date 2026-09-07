/**
 * Lecture MP3s live on the public R2 host after persist. The browser cannot
 * always `fetch` that host (CORS, r2.dev blocked), so export goes through a
 * same-origin proxy. Blob and same-origin URLs stay direct.
 */

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
