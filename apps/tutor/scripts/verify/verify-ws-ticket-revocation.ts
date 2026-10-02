import assert from "node:assert/strict";
import { test } from "node:test";
import { mintWsTicket, readWsTicket, revokeWsTickets } from "../../lib/tts/wsTicket";
import * as tickets from "../../lib/tts/wsTicket";

const env: NodeJS.ProcessEnv = { WS_TICKET_SECRET: "fake-ticket-revocation-secret", NODE_ENV: "production" };

test("account deletion invalidates previously minted relay tickets immediately", () => {
  const now = Date.now();
  const ticket = mintWsTicket("deleted-ticket-user", now, env);
  assert.deepEqual(readWsTicket(ticket, now, env), { userId: "deleted-ticket-user" });
  revokeWsTickets("deleted-ticket-user", now + 1);
  assert.equal(readWsTicket(ticket, now + 2, env), null);
});

test("revoking one account does not invalidate another account's ticket", () => {
  const now = Date.now();
  const ticket = mintWsTicket("remaining-ticket-user", now, env);
  assert.deepEqual(readWsTicket(ticket, now, env), { userId: "remaining-ticket-user" });
});

test("account revocation immediately closes every live connection, despite one throwing listener", () => {
  const registry = tickets as typeof tickets & { registerWsConnectionRevocation?: (userId: string, callback: () => void) => () => void };
  assert.equal(typeof registry.registerWsConnectionRevocation, "function");
  let closed = 0;
  const unregister = registry.registerWsConnectionRevocation!("live-revoked-user", () => { closed++; });
  registry.registerWsConnectionRevocation!("live-revoked-user", () => { throw new Error("fake close failure"); });
  registry.registerWsConnectionRevocation!("live-revoked-user", () => { closed++; });
  revokeWsTickets("live-revoked-user");
  assert.equal(closed, 2);
  unregister();
  revokeWsTickets("live-revoked-user");
  assert.equal(closed, 2, "revocation listeners must be released after closure");
});
test("unregistering a closed connection keeps later revocation from firing it", () => {
  const registry = tickets as typeof tickets & { registerWsConnectionRevocation?: (userId: string, callback: () => void) => () => void };
  assert.equal(typeof registry.registerWsConnectionRevocation, "function");
  let closed = 0;
  const unregister = registry.registerWsConnectionRevocation!("already-closed-user", () => { closed++; });
  unregister();
  unregister();
  revokeWsTickets("already-closed-user");
  assert.equal(closed, 0);
});
test("an upgrade registering after deletion is closed immediately", () => {
  const registry = tickets as typeof tickets & { registerWsConnectionRevocation?: (userId: string, callback: () => void) => () => void };
  assert.equal(typeof registry.registerWsConnectionRevocation, "function");
  let closed = 0;
  revokeWsTickets("late-upgrade-user");
  const unregister = registry.registerWsConnectionRevocation!("late-upgrade-user", () => { closed++; });
  assert.equal(closed, 1);
  unregister();
});
