/** Optional split-deploy origins. Empty = same origin as the page. */
function normalizeOrigin(origin: string | undefined): string {
  const value = origin?.trim();
  return value ? value.replace(/\/$/, "") : "";
}

const PUBLIC_API_ORIGIN = normalizeOrigin(
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_ORIGIN : undefined,
);

const PUBLIC_WS_ORIGIN = normalizeOrigin(
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_WS_ORIGIN : undefined,
);

export function getPublicApiOrigin(): string {
  return PUBLIC_API_ORIGIN;
}

export function getPublicWsOrigin(): string {
  return PUBLIC_WS_ORIGIN;
}

export function resolveApiUrl(path: string): string {
  const apiOrigin = getPublicApiOrigin();
  if (!apiOrigin) {
    return path;
  }
  return `${apiOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function resolveWebSocketUrl(
  path: string,
  traceId?: string,
  sessionId?: string,
  ticket?: string,
): string {
  if (typeof window === "undefined") {
    return path;
  }

  const wsOrigin = getPublicWsOrigin();
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = wsOrigin
    ? new URL(path.startsWith("/") ? path : `/${path}`, wsOrigin)
    : new URL(`${protocol}//${window.location.host}${path.startsWith("/") ? path : `/${path}`}`);

  if (traceId) {
    url.searchParams.set("traceId", traceId);
  }
  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  }
  if (ticket) {
    url.searchParams.set("ticket", ticket);
  }

  return url.toString();
}

/** True when WS is not same-origin, so the host-only uid cookie will not be sent. */
export function isCrossOriginWebSocket(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const wsOrigin = getPublicWsOrigin();
  if (!wsOrigin) {
    return false;
  }
  try {
    return new URL(wsOrigin).origin !== window.location.origin;
  } catch {
    return true;
  }
}
