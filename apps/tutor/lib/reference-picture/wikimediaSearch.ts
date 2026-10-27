/**
 * Wikimedia Commons search for reference pictures.
 *
 * Commons diagrams are drawn and reviewed by people, so the picture's truth
 * comes from its author, not from our model. This module only finds and
 * filters candidates: free licence, English or no labels, a usable size. The
 * judge decides whether a candidate fits the question.
 */

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
/** Wikimedia's API policy asks every client for a descriptive agent. */
export const WIKIMEDIA_USER_AGENT = "HeyTutorReferencePicture/1.0 (https://accelute.co; support@accelute.co)";
/** Thumbnail width we fetch: Commons serves fixed steps, and 960 is one. */
export const THUMB_WIDTH = 960;
const MIN_SIDE = 280;
const MAX_ASPECT = 3.2;

export interface PictureCandidate {
  source: "wikimedia";
  title: string;
  pageUrl: string;
  imageUrl: string;
  width: number;
  height: number;
  mime: string;
  license: string;
  licenseUrl: string | null;
  artist: string;
  description: string;
}

/** Free licences only: public domain, CC0, CC BY and CC BY-SA. */
export function isAllowedLicense(license: string): boolean {
  const value = license.trim().toLowerCase();
  if (!value || /\b(nc|nd)\b|non-?commercial|no-?deriv|fair use/.test(value)) return false;
  return /^(cc0|public domain|pd\b|pd-)/.test(value) || /^cc[- ]by(-sa)?\b/.test(value);
}

// A file named "Heart diagram-fa.svg" carries Farsi labels. Commons names
// translated diagrams with a language suffix; we keep English and unsuffixed.
const LANGUAGE_SUFFIX = /[-_ (]([a-z]{2,3}(?:-[a-z]{2,4})?)\)?\.(?:svg|png|jpe?g|gif|webp|tiff?)$/i;
const LANGUAGE_CODES = new Set(("af am ar as az be bg bn bs ca cs cy da de el eo es et eu fa fi fil fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko ku ky la lo lt lv mk ml mn mr ms mt my nb ne nl nn no or pa pl ps pt ro ru sa si sk sl sq sr sv sw ta te tg th tl tr uk ur uz vi zh zh-hans zh-hant pt-br sr-ec sr-el").split(" "));

export function titleLanguage(title: string): string | null {
  const code = title.match(LANGUAGE_SUFFIX)?.[1]?.toLowerCase();
  return code && (code === "en" || LANGUAGE_CODES.has(code)) ? code : null;
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

interface CommonsPage {
  title?: string;
  index?: number;
  imageinfo?: Array<{
    thumburl?: string; thumbwidth?: number; thumbheight?: number;
    width?: number; height?: number; mime?: string; descriptionurl?: string;
    extmetadata?: Record<string, { value?: unknown } | undefined>;
  }>;
}

function meta(page: NonNullable<CommonsPage["imageinfo"]>[number], key: string): string {
  const value = page.extmetadata?.[key]?.value;
  return typeof value === "string" ? stripHtml(value) : "";
}

/** Turn one Commons API page into a candidate, or null when it fails a filter. */
export function candidateFromPage(page: CommonsPage): PictureCandidate | null {
  const info = page.imageinfo?.[0];
  const title = page.title ?? "";
  if (!info?.thumburl || !title) return null;
  const mime = info.mime ?? "";
  if (!/^image\/(png|jpeg|svg\+xml|gif|webp)$/.test(mime)) return null;
  const language = titleLanguage(title);
  if (language && language !== "en") return null;
  const width = info.thumbwidth ?? info.width ?? 0;
  const height = info.thumbheight ?? info.height ?? 0;
  if (Math.min(width, height) < MIN_SIDE || Math.max(width, height) / Math.max(1, Math.min(width, height)) > MAX_ASPECT) return null;
  const license = meta(info, "LicenseShortName");
  if (!isAllowedLicense(license)) return null;
  return {
    source: "wikimedia",
    title,
    pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    imageUrl: info.thumburl,
    width,
    height,
    mime,
    license,
    licenseUrl: meta(info, "LicenseUrl") || null,
    artist: meta(info, "Artist").slice(0, 200) || "Wikimedia Commons contributor",
    description: meta(info, "ImageDescription").slice(0, 1200),
  };
}

export function commonsSearchUrl(query: string, limit: number): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: String(limit),
    gsrsearch: `${query} filetype:bitmap|drawing`,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ImageDescription",
  });
  return `${COMMONS_API}?${params}`;
}

/**
 * Commons relevance ranks translated and scanned files beside clean diagrams.
 * Measured 27 Oct 2026: the top three for "nephron diagram" were a Polish
 * label set and two transport charts; for "AC generator diagram", three 1870s
 * engravings. Prefer drawings (SVG, then PNG) and explicit English files.
 */
export function rankCandidates(candidates: readonly PictureCandidate[]): PictureCandidate[] {
  const score = (c: PictureCandidate, index: number) =>
    index - (c.mime === "image/svg+xml" ? 3 : c.mime === "image/png" ? 1 : 0) - (titleLanguage(c.title) === "en" ? 2 : 0) +
    (/\b(PSM|scan|photo|photograph|engraving|page)\b/i.test(c.title) ? 4 : 0);
  return candidates.map((c, i) => ({ c, s: score(c, i) })).sort((a, b) => a.s - b.s).map((x) => x.c);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Search Commons with every query at once and interleave their results, best
 * first from each, so a later phrase still contributes candidates (on 27 Oct
 * 2026 the only clean neuron diagram came from the third phrase while the
 * first filled every slot). A failed query is skipped; the caller decides what
 * an empty list means.
 */
export async function searchCommons(queries: readonly string[], options: { limit?: number; perQuery?: number; signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<PictureCandidate[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = options.limit ?? 8;
  const lists = await Promise.all(queries.map((q) => q.trim()).filter(Boolean).slice(0, 4).map(async (query) => {
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000);
      const response = await fetchImpl(commonsSearchUrl(query, options.perQuery ?? 12), { signal, headers: { "User-Agent": WIKIMEDIA_USER_AGENT, "Api-User-Agent": WIKIMEDIA_USER_AGENT }, cache: "no-store" });
      if (!response.ok) return [];
      const body = (await response.json()) as { query?: { pages?: CommonsPage[] } };
      return [...(body.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(candidateFromPage).filter((c): c is PictureCandidate => c !== null);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return [];
    }
  }));
  const seen = new Set<string>();
  const out: PictureCandidate[] = [];
  for (let rank = 0; out.length < limit && lists.some((list) => rank < list.length); rank++) {
    for (const list of lists) {
      const candidate = list[rank];
      if (!candidate || seen.has(candidate.title)) continue;
      seen.add(candidate.title);
      out.push(candidate);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Download a candidate's thumbnail, refusing anything over `maxBytes`. The
 * Commons API hands back direct thumbnail URLs, so a redirect is refused
 * rather than followed to a host nobody checked, and the body is read in
 * chunks so an oversized one is cut off instead of buffered.
 */
export async function downloadPicture(url: string, options: { maxBytes?: number; signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<{ bytes: Buffer; contentType: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? 6_000_000;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !/(^|\.)wikimedia\.org$/.test(parsed.hostname)) throw new Error(`Refusing picture host ${parsed.hostname}`);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const response = await fetchImpl(url, { signal, headers: { "User-Agent": WIKIMEDIA_USER_AGENT }, cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`Picture download failed: ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`Picture is not an image: ${contentType}`);
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Picture too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Picture has no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new Error("Picture too large");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { bytes: Buffer.concat(chunks), contentType };
}
