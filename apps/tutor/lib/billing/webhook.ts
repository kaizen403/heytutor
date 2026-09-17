import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_MS = 5 * 60 * 1000;

function decodeSecret(secret: string): Buffer {
  if (secret.startsWith("whsec_")) {
    return Buffer.from(secret.slice("whsec_".length), "base64");
  }
  return Buffer.from(secret, "utf8");
}

export function verifyAutumnWebhookSignature(input: {
  payload: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  secret: string;
  nowMs?: number;
}): boolean {
  const { payload, svixId, svixTimestamp, svixSignature, secret } = input;
  if (!payload || !svixId || !svixTimestamp || !svixSignature || !secret) {
    return false;
  }
  const timestampMs = Number(svixTimestamp) * (svixTimestamp.length <= 10 ? 1000 : 1);
  if (!Number.isFinite(timestampMs)) return false;
  const now = input.nowMs ?? Date.now();
  if (Math.abs(now - timestampMs) > MAX_SKEW_MS) return false;

  const toSign = `${svixId}.${svixTimestamp}.${payload}`;
  const digest = createHmac("sha256", decodeSecret(secret)).update(toSign).digest("base64");
  const expected = Buffer.from(digest);
  return svixSignature.split(/[,\s]+/).some((part) => {
    const value = part.startsWith("v1,") || part.startsWith("v1=")
      ? part.slice(3)
      : part.startsWith("v1")
        ? part.slice(2).replace(/^[,=]/, "")
        : part;
    if (!value) return false;
    try {
      const given = Buffer.from(value);
      return given.length === expected.length && timingSafeEqual(given, expected);
    } catch {
      return false;
    }
  });
}

export function readWebhookHeaders(headers: Headers): {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
} {
  return {
    svixId: headers.get("svix-id") ?? headers.get("webhook-id") ?? "",
    svixTimestamp: headers.get("svix-timestamp") ?? headers.get("webhook-timestamp") ?? "",
    svixSignature: headers.get("svix-signature") ?? headers.get("webhook-signature") ?? "",
  };
}

export function planIdFromWebhookPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = "data" in payload ? (payload as { data?: unknown }).data : payload;
  if (!data || typeof data !== "object") return null;
  const changes = "plan_changes" in data ? (data as { plan_changes?: unknown }).plan_changes : null;
  if (!Array.isArray(changes)) return null;
  for (const change of changes) {
    if (!change || typeof change !== "object") continue;
    const action = "action" in change ? String((change as { action?: unknown }).action) : "";
    if (action !== "activated") continue;
    const subscription = "subscription" in change ? (change as { subscription?: unknown }).subscription : null;
    if (!subscription || typeof subscription !== "object") continue;
    const planId = "plan_id" in subscription
      ? (subscription as { plan_id?: unknown }).plan_id
      : "planId" in subscription
        ? (subscription as { planId?: unknown }).planId
        : null;
    if (typeof planId === "string" && planId.trim()) return planId.trim();
  }
  return null;
}

export function customerIdFromWebhookPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = "data" in payload ? (payload as { data?: unknown }).data : payload;
  if (!data || typeof data !== "object") return null;
  const id =
    "customer_id" in data
      ? (data as { customer_id?: unknown }).customer_id
      : "customerId" in data
        ? (data as { customerId?: unknown }).customerId
        : null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}
