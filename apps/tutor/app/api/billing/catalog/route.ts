import { razorpayCurrencyEnabled, razorpayTestMode, usesRazorpay } from "@/lib/billing/razorpayConfig";
import { razorpayOffer } from "@/lib/billing/razorpayProtocol";
import { convertUsdOffer, loadUsdInrRate } from "@/lib/billing/exchangeRate";
import { createPriceQuote } from "@/lib/billing/priceQuote";

export async function GET(request: Request): Promise<Response> {
  const razorpay = usesRazorpay();
  const selected = new URL(request.url).searchParams.get("currency");
  const country = request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry");
  const currency = selected === "INR" || (!selected && country === "IN") ? "INR" : "USD";
  const rate = currency === "INR" ? await loadUsdInrRate() : null;
  const available = razorpay && razorpayCurrencyEnabled(currency) && (currency === "USD" || !!rate);
  const plans = Object.fromEntries((["plus", "lesson_top_up"] as const).map(planId => {
    const usd = razorpayOffer(planId);
    const offer = currency === "USD" ? usd : rate ? convertUsdOffer(usd, rate) : null;
    if (!offer) return [planId, null];
    return [planId, { amount: offer.amount, currency: offer.currency,
      quote: razorpay && available ? createPriceQuote(offer, process.env.RAZORPAY_KEY_SECRET!.trim()) : null,
    }];
  }));
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
  const origin = request.headers.get("origin");
  const allowed = ["https://accelute.co", "https://www.accelute.co"];
  allowed.push("https://dev.accelute.co", "https://accelute.pages.dev", "https://dev.accelute.pages.dev");
  if (process.env.NODE_ENV !== "production") allowed.push("http://localhost:5173");
  if (process.env.NEXT_PUBLIC_LANDING_URL) {
    try { allowed.push(new URL(process.env.NEXT_PUBLIC_LANDING_URL).origin); } catch { /* invalid configuration */ }
  }
  if (origin && allowed.includes(origin)) headers.set("access-control-allow-origin", origin);
  return Response.json({ provider: razorpay ? "razorpay" : "autumn", available, testMode: razorpay && razorpayTestMode(), currency,
    fxDate: rate?.date ?? null, unavailableReason: currency === "INR" && !rate ? "exchange_rate_unavailable" : !available ? "payments_unavailable" : null, plans }, { headers });
}
