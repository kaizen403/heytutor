import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { mock } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { prisma } from "../../lib/db/prisma";
import { loadRazorpayAccess } from "../../lib/billing/razorpayPurchases";

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const userId = randomUUID();
let authenticated = true;
let actorId: string = userId;
const actor = () => ({ userId: actorId, email: null, staff: false, lectureLab: false, skipGates: false, skipAutumn: true });
const authExports = {
  requireSpendActor: async () => authenticated ? actor() : Response.json({ code: "unauthorized" }, { status: 401 }),
  isSpendActor: (value: unknown) => !(value instanceof Response),
};
mock.module(resolve(root, "lib/billing/actor.ts"), { namedExports: authExports });
mock.module(resolve(root, "lib/billing/gate.ts"), { namedExports: authExports });
const checkout = load(resolve(root, "app/api/billing/checkout/route.ts")) as typeof import("../../app/api/billing/checkout/route");
const catalog = load(resolve(root, "app/api/billing/catalog/route.ts")) as typeof import("../../app/api/billing/catalog/route");
const topUp = load(resolve(root, "app/api/billing/top-up/route.ts")) as typeof import("../../app/api/billing/top-up/route");
const verify = load(resolve(root, "app/api/billing/razorpay/verify/route.ts")) as typeof import("../../app/api/billing/razorpay/verify/route");
const webhook = load(resolve(root, "app/api/billing/razorpay/webhook/route.ts")) as typeof import("../../app/api/billing/razorpay/webhook/route");
const status = load(resolve(root, "app/api/billing/razorpay/status/route.ts")) as typeof import("../../app/api/billing/razorpay/status/route");

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname.startsWith("/heytutor_razorpay_verify_"), "Dedicated local test database required");
  Object.assign(process.env, { BILLING_PROVIDER: "razorpay", RAZORPAY_KEY_ID: "rzp_test_routes", RAZORPAY_KEY_SECRET: "test-secret", RAZORPAY_WEBHOOK_SECRET: "webhook-secret", AUTH_URL: "https://example.test", NODE_ENV: "test" });
  await prisma.user.create({ data: { id: userId } });
  const originalFetch = globalThis.fetch;
  let apiCalls = 0;
  let captured = false;
  let providerUnavailable = false;
  let providerOrderId = "";
  let expectedAmount = 2900;
  let expectedCurrency = "USD";
  let rateCalls = 0;
  const payment = () => ({ id: "pay_routetest", order_id: providerOrderId, amount: expectedAmount, currency: expectedCurrency, captured, status: captured ? "captured" : "authorized", amount_refunded: 0 });
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml") {
      rateCalls++;
      return new Response(`<Cube time='${new Date().toISOString().slice(0, 10)}'><Cube currency='USD' rate='1.1'/><Cube currency='INR' rate='104.5'/></Cube>`);
    }
    assert(String(input).startsWith("https://api.razorpay.com/v1/"), "only fixed provider endpoints are requested");
    apiCalls++;
    if (providerUnavailable) throw new Error("upstream timeout");
    if (String(input).endsWith("/orders")) {
      const body = JSON.parse(String(init?.body)) as { amount: number; currency: string; receipt: string };
      assert.equal(body.amount, expectedAmount, "the provider receives exactly the displayed, signed price");
      assert.equal(body.currency, expectedCurrency);
      providerOrderId = `order_${body.receipt.replaceAll("-", "")}`;
      return Response.json({ ...body, id: providerOrderId });
    }
    return Response.json(String(input).endsWith("/payments") && String(input).includes("/orders/") ? { items: [payment()] } : payment());
  };
  const request = (path: string, body: unknown, origin = "https://example.test") => new Request(`https://example.test${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  try {
    authenticated = false;
    assert.equal((await checkout.POST(request("/api/billing/checkout", {}))).status, 401);
    authenticated = true;
    assert.equal((await checkout.POST(request("/api/billing/checkout", {}, "https://evil.test"))).status, 403);
    assert.equal((await checkout.POST(request("/api/billing/checkout", null))).status, 400);
    assert.equal((await checkout.POST(request("/api/billing/checkout", { planId: "free", idempotencyKey: randomUUID() }))).status, 400);
    assert.equal((await checkout.POST(request("/api/billing/checkout", { planId: "pro", idempotencyKey: randomUUID() }))).status, 400, "the retired plan cannot be bought");
    const usdResponse = await catalog.GET(new Request("https://example.test/api/billing/catalog?currency=USD", { headers: { origin: "https://accelute.co" } }));
    assert.equal(usdResponse.headers.get("access-control-allow-origin"), "https://accelute.co");
    const staging = await catalog.GET(new Request("https://example.test/api/billing/catalog?currency=USD", { headers: { origin: "https://dev.accelute.pages.dev" } }));
    assert.equal(staging.headers.get("access-control-allow-origin"), "https://dev.accelute.pages.dev");
    const usd = await usdResponse.json();
    assert.deepEqual(Object.keys(usd.plans), ["plus", "lesson_top_up"]);
    assert.equal(usd.plans.plus.amount, 2900);
    assert.equal(usd.plans.lesson_top_up.amount, 1000);
    assert.equal(JSON.stringify(usd).includes("test-secret"), false, "public prices never expose private keys");
    const quote = usd.plans.plus.quote;
    assert.equal((await checkout.POST(request("/checkout", { planId: "plus", idempotencyKey: randomUUID() }))).status, 409, "missing price confirmation never creates an order");
    assert.equal((await checkout.POST(request("/checkout", { planId: "plus", idempotencyKey: randomUUID(), quote: quote + "x" }))).status, 400, "tampered prices never create an order");
    assert.equal(apiCalls, 0, "bad requests never reach the provider");
    const idempotencyKey = randomUUID();
    const response = await checkout.POST(request("/api/billing/checkout", { planId: "plus", idempotencyKey, quote, amount: 1, currency: "INR" }));
    assert.equal(response.status, 200);
    const data = await response.json() as { checkout: { purchaseId: string; orderId: string; keyId: string } };
    const replay = await checkout.POST(request("/api/billing/checkout", { planId: "plus", idempotencyKey, quote }));
    assert.equal((await replay.json()).checkout.purchaseId, data.checkout.purchaseId);
    assert.equal(apiCalls, 1, "idempotent checkout does not create another provider order");
    const signature = createHmac("sha256", "test-secret").update(`${providerOrderId}|pay_routetest`).digest("hex");
    const callback = { purchaseId: data.checkout.purchaseId, razorpay_order_id: providerOrderId, razorpay_payment_id: "pay_routetest", razorpay_signature: signature };
    actorId = "different-user";
    assert.equal((await verify.POST(request("/verify", callback))).status, 400);
    actorId = userId;
    assert.equal((await verify.POST(request("/verify", { ...callback, razorpay_signature: "0".repeat(64) }))).status, 400);
    assert.equal((await verify.POST(request("/verify", callback))).status, 202);
    assert.equal((await loadRazorpayAccess(userId)).planId, "free", "authorization alone never grants access");
    const webhookBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_routetest" } } } });
    const webhookRequest = (signature: string) => new Request("https://example.test/webhook", { method: "POST", headers: { "x-razorpay-signature": signature }, body: webhookBody });
    assert.equal((await webhook.POST(webhookRequest("bad"))).status, 400);
    const webhookSig = createHmac("sha256", "webhook-secret").update(webhookBody).digest("hex");
    captured = true;
    providerUnavailable = true;
    assert.equal((await webhook.POST(webhookRequest(webhookSig))).status, 503, "provider failures trigger delivery retry");
    providerUnavailable = false;
    const results = await Promise.all([verify.POST(request("/verify", callback)), webhook.POST(webhookRequest(webhookSig)), webhook.POST(webhookRequest(webhookSig))]);
    assert.deepEqual(results.map(result => result.status), [200, 204, 204]);
    assert.equal((await prisma.billingPurchase.count({ where: { userId, status: "paid" } })), 1);
    assert.equal((await loadRazorpayAccess(userId)).planId, "plus");
    actorId = "different-user";
    assert.equal((await status.GET(new Request(`https://example.test/status?purchaseId=${data.checkout.purchaseId}`))).status, 404);
    actorId = userId;
    const recovered = await status.GET(new Request(`https://example.test/status?purchaseId=${data.checkout.purchaseId}`));
    assert.equal((await recovered.json()).status, "paid");
    const india = await (await catalog.GET(new Request("https://example.test/api/billing/catalog", { headers: { "x-vercel-ip-country": "IN" } }))).json();
    assert.equal(india.currency, "INR", "hosting country selects India automatically");
    assert.equal(india.plans.plus.amount, 275500);
    assert.equal(india.plans.lesson_top_up.amount, 95000);
    assert.equal((await checkout.POST(request("/checkout", { planId: "plus", idempotencyKey, quote: india.plans.plus.quote }))).status, 409, "one purchase cannot change currencies on replay");
    expectedAmount = india.plans.plus.amount;
    expectedCurrency = "INR";
    const indianCheckout = await checkout.POST(request("/checkout", { planId: "plus", idempotencyKey: randomUUID(), quote: india.plans.plus.quote }));
    assert.equal(indianCheckout.status, 200);
    assert.equal((await indianCheckout.json()).checkout.currency, "INR", "India is actually charged INR");
    expectedAmount = india.plans.lesson_top_up.amount;
    assert.equal((await topUp.POST(request("/top-up", { idempotencyKey: randomUUID(), quote: india.plans.lesson_top_up.quote }))).status, 200);
    assert.equal((await topUp.POST(request("/top-up", { idempotencyKey: randomUUID(), quote: india.plans.plus.quote }))).status, 409, "a plan quote cannot buy credits");
    await catalog.GET(new Request("https://example.test/api/billing/catalog?currency=INR"));
    assert.equal(rateCalls, 1, "a recent exchange rate is reused");
    const outsideIndia = await (await catalog.GET(new Request("https://example.test/api/billing/catalog", { headers: { "cf-ipcountry": "US" } }))).json();
    assert.equal(outsideIndia.currency, "USD");
    process.env.RAZORPAY_KEY_ID = "rzp_live_routes";
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.RAZORPAY_USD_ENABLED = "0";
    assert.equal((await (await catalog.GET(new Request("https://example.test/api/billing/catalog?currency=USD"))).json()).available, false, "live international checkout waits for account activation");
    assert.equal((await checkout.POST(request("/checkout", { planId: "plus", idempotencyKey: randomUUID(), quote }))).status, 503);
    Object.assign(process.env, { NODE_ENV: "test" });
    process.env.RAZORPAY_KEY_ID = "rzp_test_routes";
    process.env.BILLING_PROVIDER = "autumn";
    assert.equal((await checkout.POST(request("/checkout", { planId: "plus" }))).status, 503, "new purchases cannot fall back to an old catalog");
    process.env.BILLING_PROVIDER = "razorpay";
    const oversized = new Request("https://example.test/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(32769) });
    assert.equal((await checkout.POST(oversized)).status, 413);
    console.log("✓ Razorpay auth, captured authority, retries, recovery, localized signed prices, INR credits, and sole-plan checkout");
  } finally { globalThis.fetch = originalFetch; await prisma.user.delete({ where: { id: userId } }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
