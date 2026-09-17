import { createHmac } from "node:crypto";
import {
  customerIdFromWebhookPayload,
  planIdFromWebhookPayload,
  verifyAutumnWebhookSignature,
} from "../../lib/billing/webhook";
import { billingBody, billingStatus } from "../../lib/billing/errors";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const secret = `whsec_${Buffer.from("billing-webhook-secret").toString("base64")}`;
const payload = JSON.stringify({
  type: "billing.updated",
  data: {
    customer_id: "user-1",
    plan_changes: [{ action: "activated", subscription: { plan_id: "plus" } }],
  },
});
const svixId = "msg_1";
const svixTimestamp = String(Math.floor(Date.now() / 1000));
const signed = `${svixId}.${svixTimestamp}.${payload}`;
const digest = createHmac("sha256", Buffer.from("billing-webhook-secret")).update(signed).digest("base64");

assert(
  verifyAutumnWebhookSignature({
    payload,
    secret,
    svixId,
    svixTimestamp,
    svixSignature: `v1,${digest}`,
  }),
  "valid svix signature is accepted",
);
assert(
  !verifyAutumnWebhookSignature({
    payload,
    secret,
    svixId,
    svixTimestamp,
    svixSignature: "v1,aaaa",
  }),
  "tampered signature is refused",
);
assert(
  !verifyAutumnWebhookSignature({
    payload,
    secret,
    svixId,
    svixTimestamp: String(Math.floor(Date.now() / 1000) - 20 * 60),
    svixSignature: `v1,${digest}`,
  }),
  "stale timestamp is refused",
);

assert(customerIdFromWebhookPayload(JSON.parse(payload)) === "user-1", "webhook customer id");
assert(planIdFromWebhookPayload(JSON.parse(payload)) === "plus", "webhook activated plan");

assert(billingStatus("out_of_credits") === 402, "out of usage is 402");
assert(billingStatus("rate_limited") === 429, "rate is 429");
assert(billingStatus("autumn_unavailable") === 503, "missing Autumn is 503");
assert(billingBody("out_of_credits", 0).code === "out_of_credits", "stable JSON code");
assert(billingBody("out_of_credits", 0).remaining === 0, "stable JSON remainingPct payload");

console.log("✓ Autumn webhook signatures and billing error JSON");
