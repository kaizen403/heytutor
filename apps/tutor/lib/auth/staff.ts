export function staffEmailsFromEnv(value = process.env.STAFF_EMAILS): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaffEmail(email: string | null | undefined, allowlist = staffEmailsFromEnv()): boolean {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}
