"use client";
import { useId } from "react";
import type { CheckoutCurrency } from "@/lib/billing/paymentCatalog";

export function PaymentCurrencyPicker({ currency, onChange, disabled }: {
  currency: CheckoutCurrency | null;
  onChange: (currency: CheckoutCurrency) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 text-xs text-white/60">
      <label htmlFor={id}>Pay in</label>
      <select id={id} value={currency ?? ""} disabled={disabled || !currency} onChange={event => onChange(event.target.value === "INR" ? "INR" : "USD")}
        className="rounded-lg border border-white/15 bg-[#17212c] px-3 py-2 text-frost focus:outline-none focus:ring-2 focus:ring-sky-500">
        <option value="" disabled>Finding your currency…</option>
        <option value="INR">INR · ₹</option>
        <option value="USD">USD · $</option>
      </select>
    </div>
  );
}
