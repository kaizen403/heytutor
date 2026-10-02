import { PaymentError } from "./razorpayConfig";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requirePaymentOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const expected = new URL(process.env.AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || request.url).origin;
  if ((origin && origin !== expected) || site === "cross-site") throw new PaymentError("invalid_request", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new PaymentError("invalid_request", 400);
}

export async function readPaymentBody(request: Request, limit = 32_768): Promise<string> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > limit) throw new PaymentError("invalid_request", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PaymentError("invalid_request", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readPaymentJson(request: Request): Promise<Record<string, unknown>> {
  requirePaymentOrigin(request);
  const raw = await readPaymentBody(request);
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new PaymentError("invalid_request", 400); }
}
