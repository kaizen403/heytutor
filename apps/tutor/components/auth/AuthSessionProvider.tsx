"use client";

import type { ReactNode } from "react";

/**
 * Auth.js session wrapper. Login is off for testing, so this is a passthrough
 * — mounting `next-auth/react` on every page was crashing localhost after a
 * leftover session cookie. Put `<SessionProvider>` back when AUTH_REQUIRED=1.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return children;
}
