"use client";
import { useId, useState } from "react";
import { SiteButton } from "@/components/ui/site-button";
import type { CatalogPromo } from "@/lib/billing/paymentCatalog";

export function PromoCodeField({ promo, verdict, loading, onChange, disabled }: {
  /** The code the buyer entered, as sent to the catalog. */
  promo: string | null;
  /** The catalog's answer for that code. */
  verdict: CatalogPromo | null;
  loading: boolean;
  onChange: (code: string | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const answered = promo !== null && verdict?.code === promo ? verdict : null;
  if (answered && answered.percentOff !== null) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <p role="status" className="text-sky-300">{answered.code} applied: {answered.percentOff}% off Plus.</p>
        <SiteButton size="xs" disabled={disabled} onClick={() => { setDraft(""); onChange(null); }}>Remove</SiteButton>
      </div>
    );
  }
  return (
    <form
      className="text-xs text-white/60"
      onSubmit={event => { event.preventDefault(); if (draft.trim()) onChange(draft); }}
    >
      <label htmlFor={id}>Promo code</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={id}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          maxLength={32}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Enter code"
          disabled={disabled}
          className="w-40 rounded-lg border border-white/15 bg-[#17212c] px-3 py-2 uppercase text-frost placeholder:normal-case placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <SiteButton type="submit" size="sm" disabled={disabled || !draft.trim()}>Apply</SiteButton>
      </div>
      {promo !== null && !answered && loading ? <p role="status" className="mt-2">Checking {promo}…</p> : null}
      {answered ? <p role="status" className="mt-2">{answered.code} is not a valid promo code.</p> : null}
    </form>
  );
}
