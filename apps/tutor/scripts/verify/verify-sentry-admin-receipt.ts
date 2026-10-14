import assert from "node:assert/strict";
import { sentryReceiptEventUrl } from "../../lib/admin/sentryLink";
const id = "a".repeat(32);
const receipt = { sentryEventId: id, sentryFailureEvent: { timestamp: 1, message: "Tutor turn failed" },
  sentryReportedAt: null, sentryNextAttemptAt: new Date() };
assert.match(sentryReceiptEventUrl(receipt)!, /sentry\.io/);
assert.equal(sentryReceiptEventUrl({ ...receipt, sentryFailureEvent: { timestamp: 1 }, sentryNextAttemptAt: null }), null,
  "cancelled timestamp-only reservations have no active event link");
assert.equal(sentryReceiptEventUrl({ ...receipt, sentryFailureEvent: null, sentryNextAttemptAt: null }), null);
assert.match(sentryReceiptEventUrl({ ...receipt, sentryFailureEvent: null, sentryNextAttemptAt: null, sentryReportedAt: new Date() })!, /sentry\.io/);
assert.equal(sentryReceiptEventUrl({ ...receipt, sentryEventId: "not-an-id" }), null);
console.log("Admin links are visible for pending/reported receipts, hidden for cancelled reservations");
