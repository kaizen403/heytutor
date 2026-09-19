import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mintWsTicket, ticketSecret, verifyWsTicket } from "../../lib/tts/wsTicket";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ticket = mintWsTicket("user-123", 1_000_000);
if (!verifyWsTicket(ticket, 1_000_000)) {
  throw new Error("fresh ws ticket failed verification");
}
if (verifyWsTicket(ticket, 1_000_000 + 6 * 60 * 1000)) {
  throw new Error("expired ws ticket was accepted");
}
if (verifyWsTicket(ticket.slice(0, -2) + "xx", 1_000_000)) {
  throw new Error("tampered ws ticket was accepted");
}
if (verifyWsTicket("not-a-ticket", 1_000_000)) {
  throw new Error("garbage ws ticket was accepted");
}

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

assert(
  ticketSecret(env({ NODE_ENV: "development" }), "development") === "heytutor-dev-ws-ticket",
  "dev may use the dedicated local ticket secret",
);
assert(
  ticketSecret(env({ WS_TICKET_SECRET: "dedicated" }), "production") === "dedicated",
  "production uses WS_TICKET_SECRET when set",
);
try {
  ticketSecret(env({ ELEVENLABS_API_KEY: "xi", DATABASE_URL: "postgres://x" }), "production");
  throw new Error("production must not fall back to other secrets");
} catch (error) {
  assert(
    error instanceof Error && error.message.includes("WS_TICKET_SECRET"),
    "production without WS_TICKET_SECRET must throw",
  );
}

const source = readFileSync(resolve(import.meta.dirname, "../../lib/tts/wsTicket.ts"), "utf8");
assert(!source.includes("ELEVENLABS_API_KEY"), "ticket HMAC must not reuse the ElevenLabs key");
assert(!source.includes("DATABASE_URL"), "ticket HMAC must not reuse DATABASE_URL");

console.log("verify-ws-ticket: mint/verify/expiry/tamper checks passed");
