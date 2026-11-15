"use client";

import { useEffect, useState } from "react";
import { captureException } from "@sentry/nextjs";
import { AccountPageFrame } from "./AccountPageFrame";
import { PlanUsageCard } from "./PlanUsageCard";
import type { AccountProfile } from "@/lib/account/types";
import { SiteButton } from "@/components/ui/site-button";

export function UsageScreen({ selectedPlan }: { selectedPlan?: "plus" | null }) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    void fetch("/api/account/me", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load account");
        return response.json();
      })
      .then((data: { profile?: AccountProfile }) => {
        if (cancelled) return;
        controller.signal.throwIfAborted();
        if (!data?.profile?.id) throw new Error("Account identity unavailable");
        setProfile(data.profile);
        setLoadState("ready");
      }).catch((error: unknown) => {
        if (cancelled) return;
        setLoadState("error");
        captureException(error, { tags: { area: "usage-profile-read" } });
      }).finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [loadAttempt]);

  return (
    <AccountPageFrame
      title="Plans and usage"
      subtitle="Go further with Plus, add credits, and view your purchases."
    >
      {loadState === "ready" ? <PlanUsageCard ageBand={profile?.ageBand} selectedPlan={selectedPlan} /> : (
        <div role="status" className="space-y-3 text-sm text-frost">
          <p>{loadState === "error" ? "Could not load your account." : "Loading account…"}</p>
          {loadState === "error" && <SiteButton size="sm" onClick={() => {
            setLoadState("loading");
            setLoadAttempt((current) => current + 1);
          }}>Retry loading account</SiteButton>}
        </div>
      )}
    </AccountPageFrame>
  );
}
