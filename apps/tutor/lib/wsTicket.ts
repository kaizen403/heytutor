import { createHmac, timingSafeEqual } from "node:crypto";

const TICKET_TTL_MS = 5 * 60 * 1000;
const TICKET_VERSION = "v1";

function ticketSecret(): string {
  return (
    process.env.WS_TICKET_SECRET?.trim() ||
    process.env.ELEVENLABS_API_KEY?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "heytutor-dev-ws-ticket"
  );
}

function sign(payload: string): string {
  return createHmac("sha256", ticketSecret()).update(payload).digest("base64url");
}

/** Short-lived ticket so cross-origin WS upgrades can auth without the host-only cookie. */
export function mintWsTicket(userId: string, nowMs = Date.now()): string {
  const expiresAt = String(nowMs + TICKET_TTL_MS);
  const payload = `${TICKET_VERSION}.${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyWsTicket(ticket: string, nowMs = Date.now()): boolean {
  const parts = ticket.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const [version, userId, expiresAt, signature] = parts;
  if (version !== TICKET_VERSION || !userId || !expiresAt || !signature) {
    return false;
  }

  const expiresMs = Number(expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs < nowMs) {
    return false;
  }

  const payload = `${version}.${userId}.${expiresAt}`;
  const expected = sign(payload);

  try {
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
