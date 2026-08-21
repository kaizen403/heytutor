import { mintWsTicket, verifyWsTicket } from "../../lib/tts/wsTicket";

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

console.log("verify-ws-ticket: mint/verify/expiry/tamper checks passed");
