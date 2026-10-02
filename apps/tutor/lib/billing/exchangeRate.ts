import type { PaymentOffer } from "./razorpayProtocol";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const MAX_AGE_MS = 7 * 86_400_000; // Weekends and bank holidays have no new reference.
export interface ReferenceRate { usdToInr: number; date: string }

export function parseEcbReferenceRates(xml: string, now = Date.now()): ReferenceRate {
  const date = xml.match(/\btime=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const published = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (!date || !Number.isFinite(published) || new Date(published).toISOString().slice(0, 10) !== date || published > now || now - published > MAX_AGE_MS) throw new Error("Missing or stale exchange rate");
  const rates: Record<string, number> = {};
  for (const cube of xml.matchAll(/<[^>]*\bCube\b[^>]*>/g)) {
    const currency = cube[0].match(/\bcurrency=['"]([A-Z]{3})['"]/)?.[1];
    const raw = cube[0].match(/\brate=['"]([0-9.]+)['"]/)?.[1];
    if (currency && raw) rates[currency] = Number(raw);
  }
  const usdToInr = rates.INR / rates.USD;
  if (!Number.isFinite(usdToInr) || usdToInr < 5 || usdToInr > 500) throw new Error("Invalid exchange rate");
  return { usdToInr, date };
}

export function convertUsdOffer(offer: PaymentOffer, rate: ReferenceRate): PaymentOffer {
  const amount = Math.round(offer.amount * rate.usdToInr);
  if (offer.currency !== "USD" || !Number.isSafeInteger(amount) || amount < 100 || amount > 100_000_000) throw new Error("Invalid local price");
  return { ...offer, amount, currency: "INR" };
}

let cached: ReferenceRate | null = null;
let retryAt = 0;
let inflight: Promise<ReferenceRate | null> | null = null;
export async function loadUsdInrRate(): Promise<ReferenceRate | null> {
  const now = Date.now();
  if (now < retryAt) return cached && now - Date.parse(`${cached.date}T00:00:00Z`) <= MAX_AGE_MS ? cached : null;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch(ECB_URL, { signal: AbortSignal.timeout(4000), cache: "no-store", redirect: "error" });
      if (!response.ok || Number(response.headers.get("content-length")) > 100_000) throw new Error("Rate unavailable");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Rate unavailable");
      const decoder = new TextDecoder();
      let xml = "";
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 100_000) throw new Error("Rate too large");
          xml += decoder.decode(chunk.value, { stream: true });
        }
        cached = parseEcbReferenceRates(xml + decoder.decode());
        retryAt = Date.now() + 6 * 3_600_000;
      } finally { await reader.cancel().catch(() => undefined); }
    } catch { retryAt = Date.now() + 5 * 60_000; }
    return cached && Date.now() - Date.parse(`${cached.date}T00:00:00Z`) <= MAX_AGE_MS ? cached : null;
  })().finally(() => { inflight = null; });
  return inflight;
}
