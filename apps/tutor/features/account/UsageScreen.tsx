"use client";

import { useEffect, useState } from "react";
import { AccountPageFrame } from "./AccountPageFrame";
import { PlanUsageCard } from "./PlanUsageCard";
import type { AccountProfile } from "@/lib/account/types";

export function UsageScreen() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);

  useEffect(() => {
    void fetch("/api/account/me")
      .then((response) => response.json())
      .then((data: { profile?: AccountProfile }) => {
        if (data.profile) setProfile(data.profile);
      });
  }, []);

  return (
    <AccountPageFrame
      title="Plans and usage"
      subtitle="Plus, Pro, and extra usage. Included usage resets each calendar month."
    >
      <PlanUsageCard ageBand={profile?.ageBand} />
    </AccountPageFrame>
  );
}
