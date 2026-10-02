import { MAX_JSON_BODY_BYTES } from "./resourceLimits";

export class RequestBodyError extends Error {
  constructor(message: string, public readonly status: 400 | 408 | 413 | 415) {
    super(message);
    this.name = "RequestBodyError";
  }
}

/** Count bytes before JSON or multipart parsing, including chunked bodies. */
async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("invalid body limit");
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new RequestBodyError("invalid content-length", 400);
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length > maxBytes) throw new RequestBodyError("request body exceeds the size limit", 413);
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new RequestBodyError("request body timed out", 408)), 120_000);
    timeout.unref?.();
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      length += next.value.byteLength;
      // Bound tiny-chunk bookkeeping as well as bytes. Transport chunks are
      // ordinarily tens of KiB, so 8192 is ample for a supported upload.
      if (length > maxBytes || chunks.length >= 8192) throw new RequestBodyError("request body exceeds the size limit", 413);
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("invalid request body", 400);
  } finally {
    if (timeout) clearTimeout(timeout);
    reader.releaseLock();
  }
}

export async function readBoundedText(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<string> {
  const bytes = await readBoundedBytes(request, maxBytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RequestBodyError("request body must be valid UTF-8", 400); }
}

export async function readBoundedJson<T = unknown>(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<T> {
  const text = await readBoundedText(request, maxBytes);
  try { return JSON.parse(text) as T; }
  catch { throw new RequestBodyError("invalid json", 400); }
}

export async function readBoundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBoundedBytes(request, maxBytes);
  try {
    // Request.formData buffers multipart input internally. Give it only the
    // already measured bytes; it never sees the original unbounded stream.
    return await new Request(request.url, {
      method: "POST", headers: request.headers, body: bytes,
    }).formData();
  } catch { throw new RequestBodyError("invalid multipart form data", 400); }
}
