export function staffEmailsFromEnv(value = process.env.STAFF_EMAILS): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isStaffEmail(email: string | null | undefined, allowlist = staffEmailsFromEnv()): boolean {
  if (!email) return false;
  return allowlist.includes(normalizeEmail(email));
}

/** Env `STAFF_EMAILS` plus rows from the `admins` table. */
export function isAdminAllowlisted(
  email: string | null | undefined,
  tableEmails: readonly string[],
  envAllowlist = staffEmailsFromEnv(),
): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (isStaffEmail(normalized, envAllowlist)) return true;
  return tableEmails.some((entry) => normalizeEmail(entry) === normalized);
}
