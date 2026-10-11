import { parseStoredObjectKey } from "./keys";
import { getObjectStoreConfig } from "./config";

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

type MeasurementUrlPolicy = {
  bucket?: string;
  publicBaseUrls?: readonly string[];
  mediaOrigins?: readonly string[];
};

function measurementUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u0020\u007f\\]/.test(trimmed) || trimmed.startsWith("//")) return null;
  // URL normalizes dot segments before exposing pathname. Reject them from
  // the original path, including encoded spellings, before that normalization.
  const rawPath = trimmed.split(/[?#]/, 1)[0]!;
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(rawPath) || /%2f|%5c|%00|%25/i.test(rawPath)) return null;
  const parsed = urlFromMaybeRelative(trimmed);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) return null;
  return parsed;
}

/**
 * Normalize retained lecture references for read-only measurement only.
 * The June R2 writer persisted `${R2_PUBLIC_BASE_URL}/${key}`; playback may
 * wrap it in `/api/lecture-audio?src=`. Resolve that key against configured
 * storage, never fetch the URL or relax authenticated serving/deletion keys.
 */
export function lectureKeyForStorageMeasurement(
  url: string,
  owner: { boardId: string; turnId: string },
  policy?: MeasurementUrlPolicy,
): string | null {
  const config = policy ? null : getObjectStoreConfig();
  const settings: MeasurementUrlPolicy = policy ?? {
    bucket: config?.bucket,
    publicBaseUrls: [process.env.S3_PUBLIC_BASE_URL ?? "", process.env.R2_PUBLIC_BASE_URL ?? ""],
    mediaOrigins: ["https://app.accelute.co", "https://dev.accelute.co", process.env.AUTH_URL ?? "", process.env.NEXTAUTH_URL ?? ""],
  };
  const ownedKey = (key: string | null): string | null => {
    if (!key || key.trim() !== key) return null;
    const ref = parseStoredObjectKey(key);
    return ref?.kind === "lecture" && ref.boardId === owner.boardId && ref.turnId === owner.turnId ? key : null;
  };
  const parsed = measurementUrl(url);
  if (!parsed) return null;
  if (parsed.pathname === MEDIA_API_PATH || parsed.pathname === LECTURE_AUDIO_API_PATH) {
    const relative = url.trim().startsWith("/");
    if (!relative && !(settings.mediaOrigins ?? []).some((origin) => measurementUrl(origin)?.origin === parsed.origin)) return null;
    const keys = parsed.searchParams.getAll("key");
    const sources = parsed.searchParams.getAll("src");
    if (keys.length === 1 && sources.length === 0) return ownedKey(keys[0]!);
    if (parsed.pathname !== LECTURE_AUDIO_API_PATH || keys.length !== 0 || sources.length !== 1) return null;
    // One historical wrapper only. Nested proxies are not a persisted object.
    return publicKey(measurementUrl(sources[0]!));
  }
  return publicKey(parsed);

  function publicKey(source: URL | null): string | null {
    if (!source || source.protocol !== "https:") return null;
    for (const value of settings.publicBaseUrls ?? []) {
      const base = measurementUrl(value);
      if (!base || base.protocol !== "https:" || base.search || base.origin !== source.origin) continue;
      const prefix = `${base.pathname.replace(/\/$/, "")}/`;
      if (source.pathname.startsWith(prefix)) {
        try {
          const key = ownedKey(decodeURIComponent(source.pathname.slice(prefix.length)));
          if (key) return key;
        } catch { return null; }
      }
    }
    // Old private/public S3 URLs may use virtual-hosted or path-style bucket
    // addressing. Bind to this configured bucket, not an arbitrary AWS host.
    const bucket = settings.bucket;
    if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
    const awsSuffix = /\.amazonaws\.com(?:\.cn)?$/;
    if (!awsSuffix.test(source.hostname)) return null;
    const host = source.hostname.replace(awsSuffix, "");
    let path: string | null = null;
    if (host.startsWith(`${bucket}.`) && /^s3(?:[.-][a-z0-9-]+)?$/.test(host.slice(bucket.length + 1))) path = source.pathname.slice(1);
    else if (/^s3(?:[.-][a-z0-9-]+)?$/.test(host) && source.pathname.startsWith(`/${bucket}/`)) path = source.pathname.slice(bucket.length + 2);
    if (!path) return null;
    try { return ownedKey(decodeURIComponent(path)); }
    catch { return null; }
  }
}
