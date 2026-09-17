import type { LearnerRole } from "@/lib/account/types";

/** Chosen on the login buttons before Google (or local) sign-in. */
export const LOGIN_ROLES = ["student", "individual"] as const;

export type LoginRole = (typeof LOGIN_ROLES)[number];

export const HTUTOR_LOGIN_ROLE_COOKIE = "htutor_login_role";

export function isLoginRole(value: unknown): value is LoginRole {
  return value === "student" || value === "individual";
}

/** Individuals skip the college question and land on the non-college setup. */
export function learnerRoleForLogin(role: LoginRole | null | undefined): LearnerRole | null {
  if (role === "individual") return "other";
  return null;
}

export function loginRoleCookie(role: LoginRole): string {
  return `${HTUTOR_LOGIN_ROLE_COOKIE}=${role}; Path=/; Max-Age=1800; SameSite=Lax`;
}
