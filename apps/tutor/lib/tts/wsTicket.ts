import { createHmac, timingSafeEqual } from "node:crypto";

const TICKET_TTL_MS = 5 * 60 * 1000;
const TICKET_VERSION = "v1";
const DEV_TICKET_SECRET = "heytutor-dev-ws-ticket";

export function ticketSecret(env: NodeJS.ProcessEnv = process.env, nodeEnv = env.NODE_ENV): string {
  const dedicated = env.WS_TICKET_SECRET?.trim();
  if (dedicated) return dedicated;
  if (nodeEnv === "production") {
    throw new Error("WS_TICKET_SECRET is required in production");
  }
  return DEV_TICKET_SECRET;
}

function sign(payload: string, env?: NodeJS.ProcessEnv): string {
  return createHmac("sha256", ticketSecret(env)).update(payload).digest("base64url");
}

/** Short-lived ticket so cross-origin WS upgrades can auth without the host-only cookie. */
export function mintWsTicket(userId: string, nowMs = Date.now(), env?: NodeJS.ProcessEnv): string {
  const expiresAt = String(nowMs + TICKET_TTL_MS);
  const payload = `${TICKET_VERSION}.${userId}.${expiresAt}`;
  return `${payload}.${sign(payload, env)}`;
}

export function readWsTicket(
  ticket: string,
  nowMs = Date.now(),
  env?: NodeJS.ProcessEnv,
): { userId: string } | null {
  const parts = ticket.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const [version, userId, expiresAt, signature] = parts;
  if (version !== TICKET_VERSION || !userId || !expiresAt || !signature) {
    return null;
  }

  const expiresMs = Number(expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs < nowMs) {
    return null;
  }

  const payload = `${version}.${userId}.${expiresAt}`;
  const expected = sign(payload, env);

  try {
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return null;
    }
    return { userId };
  } catch {
    return null;
  }
}

export function verifyWsTicket(ticket: string, nowMs = Date.now(), env?: NodeJS.ProcessEnv): boolean {
  return readWsTicket(ticket, nowMs, env) !== null;
}
