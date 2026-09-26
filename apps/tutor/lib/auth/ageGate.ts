import { isAgeBand, type AgeBand } from "@/lib/account/types";

export type AgeGateDecision =
  | { ok: true; band: "18_plus" }
  | { ok: true; band: "13_17"; guardianEmail: string }
  | { ok: false; reason: "under_13" }
  | { ok: false; reason: "invalid_age" }
  | { ok: false; reason: "guardian_required" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeGuardianEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

export function decideAgeGate(input: {
  ageBand: unknown;
  guardianEmail?: unknown;
}): AgeGateDecision {
  if (!isAgeBand(input.ageBand)) {
    return { ok: false, reason: "invalid_age" };
  }
  if (input.ageBand === "under_13") {
    return { ok: false, reason: "under_13" };
  }
  if (input.ageBand === "18_plus") {
    return { ok: true, band: "18_plus" };
  }
  const guardianEmail = normalizeGuardianEmail(input.guardianEmail);
  if (!guardianEmail) {
    return { ok: false, reason: "guardian_required" };
  }
  return { ok: true, band: "13_17", guardianEmail };
}

export function accountIsRefused(ageBand: AgeBand | null | undefined): boolean {
  return ageBand === "under_13";
}
