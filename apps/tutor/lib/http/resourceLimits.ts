export const MAX_JSON_BODY_BYTES = 512 * 1024;
export const MAX_TURN_BODY_BYTES = 36 * 1024 * 1024;
export const MAX_STT_BODY_BYTES = 11 * 1024 * 1024;
export const MAX_PHOTO_BODY_BYTES = 2 * 1024 * 1024;

/** Transport limits also cover requests whose caller omits Content-Length. */
export function requestBodyLimitForPath(pathname: string): number {
  if (/^\/api\/boards\/[^/]+\/turns\/?$/.test(pathname)) return MAX_TURN_BODY_BYTES;
  if (pathname === "/api/stt") return MAX_STT_BODY_BYTES;
  if (pathname === "/api/extract-question") return MAX_PHOTO_BODY_BYTES;
  // Auth providers send small URL-encoded bodies; webhook signature handlers
  // retain their original bytes inside this same bounded transport envelope.
  return MAX_JSON_BODY_BYTES;
}
