"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { isAuthDisabled } from "@/lib/authDisabled";

/**
 * Auth.js session wrapper. Off while login is disabled so a leftover session
 * cookie cannot crash localhost. On when AUTH_REQUIRED / NEXT_PUBLIC_AUTH_REQUIRED
 * is set, so `signIn` and the session cookie stay in sync.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  if (isAuthDisabled()) {
    return children;
  }
  return <SessionProvider>{children}</SessionProvider>;
}
