/**
 * Client for `POST /api/reference-picture`: find, judge and store one real
 * diagram picture for a turn whose verified figure was not drawn. Never
 * throws. A decline, an error status, a malformed body, the deadline and an
 * abort all resolve to a reason, so the turn can always fall back to text.
 */
import { resolveApiUrl, withTurnTraceHeaders, type DiagramSubject } from "@heytutor/tutor-core";
import { isReferencePictureId, parseReferencePictureLegend, type ReferencePictureRecord,
  normalizeReferencePictureLabels, parseReferencePictureParts,
} from "@heytutor/drawing";

/**
 * Hard ceiling on one request. The route's own stages are bounded (Commons
 * search 6 s per query, download 10 s, judge 45 s), and a generated picture
 * adds its own call, so 45 s covers a slow judge without letting a hung
 * connection hold the turn.
 */
export const REFERENCE_PICTURE_CLIENT_TIMEOUT_MS = 45_000;

export type ReferencePictureResult =
  | { status: "ready"; picture: ReferencePictureRecord; cached?: boolean; required?: boolean }
  | { status: "declined" | "unavailable"; reason: string; required?: boolean };

export interface ReferencePictureRequest {
  question: string;
  subject?: DiagramSubject | "biology";
  boardId?: string | null;
  traceId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Semantic requirement only; it never grants authority to draw a picture. */
  onRequirement?: (required: boolean) => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function positive(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : null;
}

function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The record as the board will use it. Every field the board, the prompt and
 * persistence read is checked here, so a malformed body is a decline rather
 * than a picture with no size or an id the server never minted.
 */
export function parseReferencePictureRecord(value: unknown): ReferencePictureRecord | null {
  if (!record(value) || !isReferencePictureId(value.id)) return null;
  const source = value.source === "wikimedia" || value.source === "generated" ? value.source : null;
  const title = text(value.title, 400);
  const license = text(value.license, 200);
  const artist = text(value.artist, 400);
  const imageUrl = text(value.imageUrl, 400);
  const planUrl = text(value.planUrl, 400);
  const shows = text(value.shows, 600);
  const width = positive(value.width, 8192);
  const height = positive(value.height, 8192);
  // Null is a real value here (a generated picture has no Commons page).
  const pageUrl = value.pageUrl === null ? null : text(value.pageUrl, 1000) ?? undefined;
  const licenseUrl = value.licenseUrl === null || value.licenseUrl === undefined ? null : text(value.licenseUrl, 1000) ?? undefined;
  const labels = Array.isArray(value.labels) ? normalizeReferencePictureLabels(value.labels) : null;
  const plan = record(value.plan) ? value.plan : null;
  const planWidth = positive(plan?.width, 4096);
  const planHeight = positive(plan?.height, 4096);
  const outlineLengthPx = nonnegative(plan?.outlineLengthPx);
  const fillLengthPx = nonnegative(plan?.fillLengthPx);
  // A numbered picture's key is kept whole or the record is refused: dropped,
  // the board would draw the picture's numbers with no names beside them.
  const legend = value.legend === undefined || value.legend === null ? undefined : parseReferencePictureLegend(value.legend);
  if (legend === null) return null;
  if (!source || title === null || license === null || artist === null || imageUrl === null || planUrl === null ||
      shows === null || width === null || height === null || labels === null || pageUrl === undefined ||
      licenseUrl === undefined || planWidth === null || planHeight === null || outlineLengthPx === null || fillLengthPx === null) return null;
  // Located parts are checked one by one: a bad part loses its pointing, the
  // picture stays. The server sends none while part focus is off.
  const parts = parseReferencePictureParts(value.parts, { plan: { width: planWidth, height: planHeight }, labels, legend });
  return {
    id: value.id, source, title, pageUrl, license, licenseUrl, artist, imageUrl, planUrl, width, height, shows,
    labels: [...labels],
    ...(legend ? { legend } : {}),
    ...(parts.length > 0 ? { parts } : {}),
    plan: { width: planWidth, height: planHeight, outlineLengthPx, fillLengthPx },
  };
}

/** The typed boundary for a response body, shared with the verify script. */
export function referencePictureResultFromResponse(body: unknown): ReferencePictureResult {
  if (!record(body)) return { status: "unavailable", reason: "invalid_response" };
  const requirement = body.required === true ? { required: true } : {};
  if (body.status === "ready") {
    const picture = parseReferencePictureRecord(body.picture);
    return picture ? { status: "ready", picture, ...(body.cached === true ? { cached: true } : {}), ...requirement } : { status: "unavailable", reason: "invalid_picture", ...requirement };
  }
  if (body.status === "declined") {
    const reason = typeof body.reason === "string" && /^[a-z0-9_:-]{1,64}$/i.test(body.reason) ? body.reason : "declined_unspecified";
    return { status: "declined", reason, ...requirement };
  }
  return { status: "unavailable", reason: "invalid_response" };
}

/** At most two NDJSON frames; bounds apply to legacy JSON bodies too. */
const MAX_RESPONSE_BYTES = 128 * 1024;

async function readPictureResponse(response: Response, signal: AbortSignal, onRequirement: (required: boolean) => void): Promise<ReferencePictureResult> {
  if (!response.body) throw new Error("missing body");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const streaming = response.headers.get("content-type")?.split(";")[0]?.trim() === "application/x-ndjson";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let buffer = "";
  let frames = 0;
  let discovered = false;
  const frame = (line: string): ReferencePictureResult | null => {
    if (++frames > 2) throw new Error("too many frames");
    const value: unknown = JSON.parse(line);
    if (!record(value)) throw new Error("invalid frame");
    if (value.type === "requirement" && frames === 1 && typeof value.required === "boolean") {
      discovered = true;
      onRequirement(value.required);
      return null;
    }
    if (value.type !== "result") throw new Error("invalid frame");
    if (!discovered && typeof value.required === "boolean") onRequirement(value.required);
    return referencePictureResultFromResponse(value);
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      bytes += value?.byteLength ?? 0;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("response too large");
      buffer += decoder.decode(value, { stream: !done });
      if (streaming) {
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const result = frame(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (result) return result;
        }
      }
      if (done) break;
    }
    if (streaming) {
      const result = buffer ? frame(buffer) : null;
      if (!result) throw new Error("missing result");
      return result;
    }
    const body: unknown = JSON.parse(buffer);
    if (record(body) && typeof body.required === "boolean") onRequirement(body.required);
    return referencePictureResultFromResponse(body);
  } finally {
    signal.removeEventListener("abort", cancel);
    // Includes parse failures, deadline and early final frames. Release both
    // the response reader and any upstream work still attached to its body.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function requestReferencePicture(input: ReferencePictureRequest): Promise<ReferencePictureResult> {
  const timeoutMs = input.timeoutMs ?? REFERENCE_PICTURE_CLIENT_TIMEOUT_MS;
  let timeout: AbortSignal | undefined;
  let required = false;
  const onRequirement = (value: boolean) => {
    required ||= value;
    input.onRequirement?.(value);
  };
  try {
    timeout = AbortSignal.timeout(timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    signal.throwIfAborted();
    const response = await (input.fetchImpl ?? fetch)(resolveApiUrl("/api/reference-picture"), {
      method: "POST",
      credentials: "include",
      headers: withTurnTraceHeaders({ "content-type": "application/json", accept: "application/x-ndjson" }, {
        traceId: input.traceId ?? undefined,
        sessionId: input.boardId ?? undefined,
      }),
      signal,
      body: JSON.stringify({
        question: input.question,
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.boardId ? { boardId: input.boardId } : {}),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { status: "unavailable", reason: `http_${response.status}` };
    }
    const result = await readPictureResponse(response, signal, onRequirement);
    signal.throwIfAborted();
    return { ...result, ...(required ? { required: true } : {}) };
  } catch {
    return {
      status: "unavailable",
      reason: input.signal?.aborted ? "aborted" : timeout?.aborted ? "deadline" : "transport",
      ...(required ? { required: true } : {}),
    };
  }
}
