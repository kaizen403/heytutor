/**
 * Temporary testing switch. Login, onboarding, and the staff gate stay off
 * until AUTH_REQUIRED=1 (set NEXT_PUBLIC_AUTH_REQUIRED=1 as well so the
 * client matches). Account pages still work against the device cookie user.
 *
 * Lives next to `lib/auth.ts`, not under `lib/auth/`, so client components
 * can import it without pulling the server Auth.js module.
 */
export function isAuthDisabled(): boolean {
  return process.env.AUTH_REQUIRED !== "1" && process.env.NEXT_PUBLIC_AUTH_REQUIRED !== "1";
}
