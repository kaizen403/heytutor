/** Optional split-deploy origins. Empty = same origin as the page. */
function envValue(key: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[key];
  return typeof value === "string" ? value : undefined;
}

export function getPublicApiOrigin(): string {
  const origin = envValue("NEXT_PUBLIC_API_ORIGIN")?.trim();
  return origin?.replace(/\/$/, "") ?? "";
}

export function getPublicWsOrigin(): string {
  const origin = envValue("NEXT_PUBLIC_WS_ORIGIN")?.trim();
  return origin?.replace(/\/$/, "") ?? "";
}

export function resolveApiUrl(path: string): string {
  const apiOrigin = getPublicApiOrigin();
  if (!apiOrigin) {
    return path;
  }
  return `${apiOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function resolveWebSocketUrl(path: string, traceId?: string, sessionId?: string): string {
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

  return url.toString();
}
