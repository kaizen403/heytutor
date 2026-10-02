import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  razorpayOffer,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  readPayment,
  addBillingMonth,
} from "../../lib/billing/razorpayProtocol";
import { razorpayReady, requireRazorpayConfig, razorpayCurrencyEnabled } from "../../lib/billing/razorpayConfig";

const signature = createHmac("sha256", "test-secret").update("order_123|pay_123").digest("hex");
assert(verifyCheckoutSignature("order_123", "pay_123", signature, "test-secret"));
assert(!verifyCheckoutSignature("order_other", "pay_123", signature, "test-secret"));
assert(!verifyCheckoutSignature("order_123", "pay_123", "bad", "test-secret"));
const body = '{"event":"payment.captured"}';
const webhookSignature = createHmac("sha256", "webhook-secret").update(body).digest("hex");
assert(verifyWebhookSignature(body, webhookSignature, "webhook-secret"));
assert(!verifyWebhookSignature(`${body} `, webhookSignature, "webhook-secret"));
assert(!verifyWebhookSignature(body, webhookSignature, ""));

assert.deepEqual(razorpayOffer("plus"), { planId: "plus", amount: 2900, currency: "USD", usageMillicents: 12000 });
assert.equal(razorpayOffer("lesson_top_up").usageMillicents, 10000);
const testConfig: NodeJS.ProcessEnv = { BILLING_PROVIDER: "razorpay", RAZORPAY_KEY_ID: "rzp_test_config", RAZORPAY_KEY_SECRET: "test-secret", RAZORPAY_WEBHOOK_SECRET: "webhook-secret", NODE_ENV: "test" };
assert(razorpayReady(testConfig));
assert(!razorpayReady({ ...testConfig, RAZORPAY_WEBHOOK_SECRET: "" }), "callback-only configuration cannot enable checkout");
assert(!razorpayReady({ ...testConfig, NODE_ENV: "production" }), "production rejects accidental test checkout");
assert(razorpayReady({ ...testConfig, NODE_ENV: "production", RAZORPAY_ALLOW_TEST_MODE: "1" }), "staging explicitly enables test checkout");
assert(!requireRazorpayConfig({ ...testConfig, NODE_ENV: "production", RAZORPAY_KEY_ID: "rzp_live_config" }).testMode);
assert(razorpayCurrencyEnabled("INR", testConfig));
assert(razorpayCurrencyEnabled("USD", testConfig), "test mode supports international checkout");
const liveConfig: NodeJS.ProcessEnv = { ...testConfig, NODE_ENV: "production", RAZORPAY_KEY_ID: "rzp_live_config" };
assert(!razorpayCurrencyEnabled("USD", liveConfig), "live USD needs account enablement");
assert(razorpayCurrencyEnabled("USD", { ...liveConfig, RAZORPAY_USD_ENABLED: "1" }));

const payment = { id: "pay_123", entity: "payment", order_id: "order_123", amount: 1900, currency: "USD", status: "captured", captured: true, amount_refunded: 0 };
assert.equal(readPayment(payment).status, "captured");
assert.throws(() => readPayment({ ...payment, amount: 19.5 }));
assert.throws(() => readPayment({ ...payment, amount_refunded: 1901 }));
assert.throws(() => readPayment({ ...payment, id: "../payments" }));
assert.equal(addBillingMonth(new Date("2028-01-31T12:30:00Z")).toISOString(), "2028-02-29T12:30:00.000Z");
assert.equal(addBillingMonth(new Date("2027-01-31T12:30:00Z")).toISOString(), "2027-02-28T12:30:00.000Z");
console.log("✓ Razorpay signatures, authoritative prices, payment validation, and monthly expiry");
