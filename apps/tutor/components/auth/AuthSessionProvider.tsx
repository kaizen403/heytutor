"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { isAuthDisabled } from "@/lib/authDisabled";

/**
 * Auth.js session wrapper. Off only for AUTH_DISABLED local testing so a
 * leftover session cookie cannot crash localhost. On in every other case.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  if (isAuthDisabled()) {
    return children;
  }
  return <SessionProvider>{children}</SessionProvider>;
}
