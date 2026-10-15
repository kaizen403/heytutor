import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPromoCode, findPromoCode } from "../../lib/billing/promoCodes";
import { promoCodeInput } from "../../lib/billing/paymentCatalog";
import { razorpayOffer } from "../../lib/billing/razorpayProtocol";
import { convertUsdOffer, parseEcbReferenceRates } from "../../lib/billing/exchangeRate";
import { createPriceQuote, readPriceQuote } from "../../lib/billing/priceQuote";

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

// The code: what a buyer types, and what never matches.
const ph50 = findPromoCode("PH50");
assert.equal(ph50?.percentOff, 50, "PH50 is fifty percent off");
assert.equal(findPromoCode(promoCodeInput("  ph50 "))?.code, "PH50", "case and surrounding spaces do not matter");
assert.equal(findPromoCode("PH50", Date.parse("2030-01-01T00:00:00Z"))?.code, "PH50", "PH50 has no expiry");
for (const other of ["PH10OFF", "PH5", "PH500", "PH 50", "", "constructor", "__proto__", "TOSTRING", null, 50]) {
  assert.equal(findPromoCode(other), null, `${String(other)} is not a promo code`);
}
assert.equal(promoCodeInput("   "), null, "a blank field sends no code");
assert.equal(promoCodeInput("x".repeat(80))?.length, 32, "a pasted essay is bounded before it reaches the catalog");

// The price: Plus halves, the allowance does not, credits stay at cost.
const plus = applyPromoCode(razorpayOffer("plus"), ph50);
assert.deepEqual(plus, { planId: "plus", amount: 1450, currency: "USD", usageMillicents: 12000, promoCode: "PH50" });
assert.deepEqual(applyPromoCode(razorpayOffer("lesson_top_up"), ph50), razorpayOffer("lesson_top_up"), "credits sell at the usage they buy");
assert.deepEqual(applyPromoCode(razorpayOffer("plus"), null), razorpayOffer("plus"), "no code, full price");
const now = Date.parse("2026-10-02T12:00:00Z");
const fx = parseEcbReferenceRates("<Cube><Cube time='2026-10-01'><Cube currency='USD' rate='1.2'/><Cube currency='INR' rate='114'/></Cube></Cube>", now);
assert.equal(applyPromoCode(convertUsdOffer(razorpayOffer("plus"), fx), ph50).amount, 137750, "INR halves after conversion");
const odd = applyPromoCode({ ...razorpayOffer("plus"), amount: 255_317, currency: "INR" }, ph50);
assert(Number.isSafeInteger(odd.amount) && odd.amount === 127_659, "an odd paise total rounds to a whole paise");

// The quote: the discount is server signed and survives to checkout intact.
const secret = "promo-test-secret";
const quote = createPriceQuote(plus, secret, now);
assert.deepEqual(readPriceQuote(quote, "plus", secret, now + 1000), plus, "the signed quote carries the code to the purchase row");
assert.deepEqual(readPriceQuote(createPriceQuote(razorpayOffer("plus"), secret, now), "plus", secret, now), razorpayOffer("plus"), "a full price quote carries no code");
const [payload, signature] = quote.split(".");
const stripped = JSON.parse(Buffer.from(payload!, "base64url").toString()) as Record<string, unknown>;
delete stripped.promoCode;
assert.throws(() => readPriceQuote(`${Buffer.from(JSON.stringify(stripped)).toString("base64url")}.${signature}`, "plus", secret, now), /quote/, "a client cannot edit a signed discount");
const unknownCode = createPriceQuote({ ...plus, promoCode: "FREE100" }, secret, now);
assert.throws(() => readPriceQuote(unknownCode, "plus", secret, now), /price_changed/, "a withdrawn or unknown code kills its outstanding quotes");

const creditsAtHalf = createPriceQuote({ ...razorpayOffer("lesson_top_up"), amount: 500, promoCode: "PH50" }, secret, now);
assert.throws(() => readPriceQuote(creditsAtHalf, "lesson_top_up", secret, now), /price_changed/, "a code never discounts a plan it does not cover");

// The wiring: the catalog signs the discounted offer; the code table stays off the client.
const route = read("app/api/billing/catalog/route.ts");
assert(/const offer = applyPromoCode\(full, promo\);[\s\S]*createPriceQuote\(offer,/.test(route), "the catalog signs the discounted offer, not the full one");
assert(read("lib/billing/razorpayPurchases.ts").includes("existing.promoCode !== (offer.promoCode ?? null)"), "an idempotent replay cannot swap the code");
assert(read("lib/billing/razorpayApi.ts").includes("promo_code: offer.promoCode"), "the Razorpay order names the code");
assert(/promoCode\s+String\?\s+@map\("promo_code"\)/.test(read("prisma/schema.prisma")), "the purchase row stores the code");
assert(read("prisma/migrations/24_add_purchase_promo_code/migration.sql").includes('ADD COLUMN "promo_code" TEXT'), "the column is additive");
assert(read("features/account/PlanUsageCard.tsx").includes("<PromoCodeField"), "the plans page offers the promo field");
assert(/onboarding\?next=\$\{encodeURIComponent\(next\)\}/.test(read("lib/auth/requireOnboarded.ts")), "a new student keeps a /usage?promo=PH50 link through onboarding");
for (const client of ["lib/billing/usePaymentCatalog.ts", "features/account/PromoCodeField.tsx", "features/account/PlanUsageCard.tsx"]) {
  assert(!read(client).includes("promoCodes"), `${client} must not bundle the code table`);
}
console.log("✓ PH50 halves Plus in USD and INR, keeps the full allowance, leaves credits at cost, and is signed through checkout");
