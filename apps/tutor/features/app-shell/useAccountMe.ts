"use client";

import { useEffect, useState } from "react";
import type { AccountProfile } from "@/lib/account/types";
import type { AccountSettings } from "@/lib/account/userSettings";
import type { AppShellProfile } from "./types";

export type AccountMe = {
  profile: AccountProfile;
  settings: AccountSettings;
};

export function toShellProfile(profile: AccountProfile | null | undefined): AppShellProfile {
  if (!profile) return null;
  return {
    name: profile.name,
    image: profile.image,
    email: profile.email,
    examGoal: profile.examGoal,
    classYear: profile.classYear,
  };
}

export function useAccountMe() {
  const [me, setMe] = useState<AccountMe | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/me")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AccountMe;
      })
      .then((data) => {
        if (!cancelled && data) setMe(data);
      })
      .catch(() => {
        /* stay null; shell still renders */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return me;
}
